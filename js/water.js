// water.js — 正俯视：杯口大圆内的水色、涟漪、注水滴、扩散场（茶色晕染）
//
// ── 美术替换约定（IMPORTANT）───────────────────────────────────────
// 杯子的渲染遵循严格分层（由 main.js 编排）：
//   1. scene.ART.cupBack(ctx)  — 杯外沿环 + 空杯底色（贴纸化平涂）
//   2. drawCupWater(ctx, w)    — 水色圆（随注水从中心扩张）+ 茶色扩散场
//   3. （杯中草药，漂在水面上，由 herbs.js 绘制）
//   4. drawCupSurfaceFx(ctx,w) — 涟漪 / 溅落水珠（画在草药之上，是水面）
//   5. scene.ART.cupFront(ctx) — 一两条细高光弧
// 未来换贴图：保持同样分层时机即可。
// ────────────────────────────────────────────────────────────────
import * as audio from "./audio.js";

export const CUP = {
  x: 375, // 圆心（出签让位时由 main.js 左移）
  y: 560, // 画面中心偏上
  r: 260, // 杯口外半径
  wall: 26, // 杯壁厚度（外沿环宽）
};

// 杯内可用半径（水面区域）
export function cupInnerR() {
  return CUP.r - CUP.wall;
}

const DIFFUSE_N = 96; // 扩散场分辨率（正方形，映射到杯内圆的外接方）

export class WaterSystem {
  constructor() {
    this.level = 0; // 0..0.85，注水量（俯视下映射为水色圆半径占比）
    this.ripples = []; // {x, y (相对圆心), radius, life}
    this.droplets = []; // 溅落水珠 {x, y, vx, vy, life}（相对圆心）
    this.pouring = false;
    this.flowStrength = 0; // 0..1
    this.flowThickness = 0;
    this.diffuseField = new Float32Array(DIFFUSE_N * DIFFUSE_N);
    this.diffuseFieldNext = new Float32Array(DIFFUSE_N * DIFFUSE_N);
    this.noiseTime = 0;
    this.baseColor = { h: 45, s: 10, l: 92 };
    this.lastRippleSoundTime = -10;
    this.swirl = 0; // 搅拌角速度（rad/s，正=顺时针），由 main 驱动，自然衰减
    // —— 搅拌的水面表现（连续剪切，不用同心圆涟漪）——
    this.wake = []; // 匙头尾迹采样 {x, y, life}（相对圆心，头在末尾）
    this.vortices = []; // 涡脱落 {x, y, rot, dir, life}
    this.stirLevel = 0; // 平滑搅拌强度 0..1（由 main 写入，供高光颤动等）
    this.vortex = 0; // 龙卷风强度 0..1：搅得够猛时涡成形，停手后随 swirl 慢慢平息
    this.vortexAng = 0; // 螺旋臂相位（随 swirl 累积旋转）
    this.vortexX = 0; // 涡心（相对杯心）——在哪儿打圈涡就在哪儿
    this.vortexY = 0;
    this._vortexTX = 0; // 涡心目标（由 stirCenter 写入）
    this._vortexTY = 0;
    this._stirFresh = 0; // >0 表示刚在此处搅拌；归零后涡心向杯心回迁
    this.flowAlpha = 0; // 分层水流弧的可见度（随 swirl 淡入淡出）
    this.flowArcs = [
      { rf: 0.36, ang: 1.1, span: 1.1 }, // rf: 半径占内径比；内层转得快
      { rf: 0.57, ang: 3.7, span: 0.75 },
      { rf: 0.78, ang: 5.3, span: 1.3 },
    ];
    this._vortexTimer = 0;
  }

  reset() {
    this.level = 0;
    this.ripples = [];
    this.droplets = [];
    this.pouring = false;
    this.flowStrength = 0;
    this.swirl = 0;
    this.wake = [];
    this.vortices = [];
    this.stirLevel = 0;
    this.vortex = 0;
    this.vortexX = 0;
    this.vortexY = 0;
    this._vortexTX = 0;
    this._vortexTY = 0;
    this._stirFresh = 0;
    this.flowAlpha = 0;
    this.diffuseField.fill(0);
    this.diffuseFieldNext.fill(0);
  }

  // 匙头划水（main 每帧调用；speed: 匙头线速度 逻辑像素/s）
  // 尾迹采样 + 高速时从后缘剥落小旋涡
  stirAt(relX, relY, dt, speed) {
    if (speed < 30) return;
    const last = this.wake[this.wake.length - 1];
    if (!last || Math.hypot(relX - last.x, relY - last.y) > 5) {
      this.wake.push({ x: relX, y: relY, life: 1 });
      if (this.wake.length > 26) this.wake.shift();
    }
    this._vortexTimer -= dt;
    if (speed > 130 && this._vortexTimer <= 0 && this.vortices.length < 4) {
      this.vortices.push({
        x: relX,
        y: relY,
        rot: Math.random() * Math.PI * 2,
        dir: this.swirl >= 0 ? 1 : -1,
        life: 1,
      });
      this._vortexTimer = 0.4 + Math.random() * 0.2;
    }
  }

  // 报告当前画圈的圆心（相对杯心）：涡就在打圈的地方成形
  stirCenter(relX, relY) {
    const lim = this.fillRadius() * 0.62; // 涡眼别贴到水缘
    const d = Math.hypot(relX, relY);
    if (d > lim) {
      relX *= lim / d;
      relY *= lim / d;
    }
    this._vortexTX = relX;
    this._vortexTY = relY;
    this._stirFresh = 0.5;
  }

  // 水色圆当前半径（逻辑像素）
  // "杯感"曲线：锥台杯底截面小，水位起初蹿得快——强 ease-out，
  // 前段快速铺到 ~2/3 满径，后段越来越慢；满杯停在杯内沿留 ~7% 空隙。
  fillRadius() {
    const t = Math.min(1, this.level / 0.85);
    const maxR = cupInnerR() * 0.93;
    return maxR * (1 - Math.pow(1 - t, 2.2));
  }

  addRipple(relX, relY) {
    this.ripples.push({ x: relX, y: relY, radius: 6, life: 1 });
    if (performance.now() / 1000 - this.lastRippleSoundTime > 0.15) {
      audio.playRipple();
      this.lastRippleSoundTime = performance.now() / 1000;
    }
  }

  addSplash(relX, relY, count = 4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 50;
      this.droplets.push({
        x: relX,
        y: relY,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1,
      });
    }
    this.addRipple(relX, relY);
    this.addRipple(relX, relY);
  }

  // 在扩散场中某位置注入浓度（rel: 相对圆心的逻辑坐标）
  injectHerbColor(relX, relY, amount = 1) {
    const R = cupInnerR();
    const gx = Math.floor(((relX + R) / (2 * R)) * DIFFUSE_N);
    const gy = Math.floor(((relY + R) / (2 * R)) * DIFFUSE_N);
    if (gx < 0 || gy < 0 || gx >= DIFFUSE_N || gy >= DIFFUSE_N) return;
    const idx = gy * DIFFUSE_N + gx;
    this.diffuseField[idx] = Math.min(1, this.diffuseField[idx] + amount);
  }

  startPour() {
    this.pouring = true;
    audio.startPour();
  }

  stopPour() {
    this.pouring = false;
    this.flowStrength = 0;
    audio.stopPour();
  }

  update(dt, herbSources) {
    // 注水：水色圆扩张（按住时长决定水量）
    if (this.pouring && this.flowStrength > 0 && this.level < 0.85) {
      this.level = Math.min(0.85, this.level + this.flowStrength * dt * 0.12);
    }
    if (this.pouring) {
      audio.updatePour(this.level / 0.85, this.flowStrength);
    }

    // 涟漪扩散衰减
    for (const r of this.ripples) {
      r.radius += dt * 70;
      r.life -= dt * 0.8;
    }
    this.ripples = this.ripples.filter((r) => r.life > 0);

    // 溅落水珠（俯视：向外滑行并消散）
    for (const d of this.droplets) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 0.92;
      d.vy *= 0.92;
      d.life -= dt * 2.2;
    }
    this.droplets = this.droplets.filter((d) => d.life > 0);

    // 扩散场：草药处注入 + 模糊扩散
    if (herbSources && herbSources.length > 0 && this.level > 0.05) {
      for (const s of herbSources) {
        this.injectHerbColor(s.relX, s.relY, dt * 0.35);
      }
    }
    this._diffuse();
    // 搅拌对流：扩散场绕圆心旋转平流 + 混匀加速
    // 起涡时改为内快外慢的剪切旋转，把茶色拉出螺旋纹
    if (Math.abs(this.swirl) > 0.02 && this.level > 0.05) {
      this._advect(this.swirl * dt, this.vortex);
      if (Math.abs(this.swirl) > 0.4) this._diffuse(); // 搅拌时扩散加倍，更快混匀
    }

    // 龙卷风：|swirl| 超过 ~1.2 rad/s 后涡成形（形成快、消散慢）
    const vortexTarget = Math.max(0, Math.min(1, (Math.abs(this.swirl) - 1.2) / 1.8));
    this.vortex +=
      (vortexTarget - this.vortex) *
      Math.min(1, dt * (vortexTarget > this.vortex ? 3 : 1.1));
    this.vortexAng += this.swirl * dt * 1.5;
    // 涡心跟着打圈位置走；停手后慢慢向杯心回迁
    this._stirFresh = Math.max(0, this._stirFresh - dt);
    if (this._stirFresh <= 0) {
      const back = Math.max(0, 1 - dt * 0.25);
      this._vortexTX *= back;
      this._vortexTY *= back;
    }
    this.vortexX += (this._vortexTX - this.vortexX) * Math.min(1, dt * 2.5);
    this.vortexY += (this._vortexTY - this.vortexY) * Math.min(1, dt * 2.5);
    // 涡越强旋转惯性越大，平息得越慢（猛晃后 4~6s 归于平静）
    this.swirl *= Math.max(0, 1 - dt * (0.7 - 0.4 * this.vortex));

    // 尾迹老化（停手后 ~1s 内被水面抚平）
    for (const p of this.wake) p.life -= dt * 1.15;
    while (this.wake.length && this.wake[0].life <= 0) this.wake.shift();

    // 涡：自转 + 随水流切向漂移 + 淡出
    const drift = this.swirl * dt;
    const dcos = Math.cos(drift), dsin = Math.sin(drift);
    for (const v of this.vortices) {
      v.rot += v.dir * dt * 2.4;
      const nx = v.x * dcos - v.y * dsin;
      const ny = v.x * dsin + v.y * dcos;
      v.x = nx;
      v.y = ny;
      v.life -= dt * 0.75;
    }
    this.vortices = this.vortices.filter((v) => v.life > 0);

    // 分层水流弧：内快外慢地绕圆心转，可见度随 swirl 淡入淡出
    const flowTarget = Math.min(1, Math.abs(this.swirl) / 1.4);
    this.flowAlpha += (flowTarget - this.flowAlpha) * Math.min(1, dt * (flowTarget > this.flowAlpha ? 3 : 0.8));
    for (const a of this.flowArcs) {
      a.ang += this.swirl * dt * (1.7 - a.rf);
    }
    this.noiseTime += dt;
  }

  // 场绕涡心旋转 theta（最近邻采样，96x96 足够柔和）
  // shear>0 时内圈转得比外圈快（差速旋转），茶色被拉出螺旋纹
  _advect(theta, shear = 0) {
    const n = DIFFUSE_N;
    const field = this.diffuseField;
    const next = this.diffuseFieldNext;
    const c = (n - 1) / 2;
    const R = cupInnerR();
    // 涡心的网格坐标（网格覆盖 -R..R）
    const cx = c + (this.vortexX / R) * c;
    const cy = c + (this.vortexY / R) * c;
    const cos0 = Math.cos(-theta), sin0 = Math.sin(-theta);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const rx = x - cx, ry = y - cy;
        let cos = cos0, sin = sin0;
        if (shear > 0.02) {
          const rr = Math.min(1, Math.sqrt(rx * rx + ry * ry) / c);
          const th = -theta * (1 + shear * 1.8 * (1 - rr));
          cos = Math.cos(th);
          sin = Math.sin(th);
        }
        const sx = Math.round(cx + rx * cos - ry * sin);
        const sy = Math.round(cy + rx * sin + ry * cos);
        next[y * n + x] =
          sx >= 0 && sy >= 0 && sx < n && sy < n ? field[sy * n + sx] : 0;
      }
    }
    this.diffuseField.set(next);
  }

  _diffuse() {
    const n = DIFFUSE_N;
    const field = this.diffuseField;
    const next = this.diffuseFieldNext;
    const rate = 0.18;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const idx = y * n + x;
        const c = field[idx];
        const left = field[y * n + Math.max(0, x - 1)];
        const right = field[y * n + Math.min(n - 1, x + 1)];
        const up = field[Math.max(0, y - 1) * n + x];
        const down = field[Math.min(n - 1, y + 1) * n + x];
        next[idx] = c + ((left + right + up + down) / 4 - c) * rate;
      }
    }
    this.diffuseField.set(next);
  }
}

// ══════════════════ 绘制 ══════════════════

// 水色圆 + 茶色扩散（画在杯底之上、草药之下）
export function drawCupWater(ctx, water) {
  if (water.level <= 0.002) return;
  const { x, y } = CUP;
  const fillR = water.fillRadius();
  const color = water._displayColor || water.baseColor;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, fillR, 0, Math.PI * 2);
  ctx.clip();

  // 水底色（平涂，食物感的浅汤色）
  ctx.fillStyle = `hsla(${color.h}, ${Math.max(8, color.s - 6)}%, ${Math.min(95, color.l + 8)}%, 0.92)`;
  ctx.fillRect(x - fillR, y - fillR, fillR * 2, fillR * 2);

  // 茶色扩散场（低分辨率放大，映射到杯内圆的外接方）
  const R = cupInnerR();
  drawDiffuseField(ctx, water, x - R, y - R, R * 2, R * 2);

  ctx.restore();

  // 水缘一圈极淡的深色描边（水彩沉淀感，非立体渐变）
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, fillR, 0, Math.PI * 2);
  ctx.strokeStyle = `hsla(${color.h}, ${Math.min(80, color.s + 12)}%, ${Math.max(30, color.l - 18)}%, 0.18)`;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

// 龙卷风涡眼半径（草药绕圈的内界也用它）
export function vortexEyeR(water) {
  return water.fillRadius() * (0.05 + 0.09 * water.vortex);
}

// 水面效果（画在漂浮草药之上——它们属于水面）：
// 分层水流弧 → 龙卷风(涡眼+螺旋臂) → 匙头尾迹 → 涡脱落 → 落水涟漪 → 溅珠
export function drawCupSurfaceFx(ctx, water) {
  const { x, y } = CUP;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, cupInnerR(), 0, Math.PI * 2);
  ctx.clip();

  // 旋转语言的公共圆心：涡心（在哪儿打圈就在哪儿），静止时即杯心
  const vcx = x + water.vortexX;
  const vcy = y + water.vortexY;
  // 涡心离水缘越近，可用半径越小
  const Rv = Math.max(
    30,
    water.fillRadius() - Math.hypot(water.vortexX, water.vortexY)
  );

  // 水体旋转的证据：不同半径上不完整的细弧线，内快外慢；
  // 动量上来后（vortex↑）弧线拉长、顺流一端向心卷入——圆条纹连续渐变成涡流
  if (water.flowAlpha > 0.015 && water.level > 0.05) {
    const v = water.vortex;
    const dir = water.swirl >= 0 ? 1 : -1;
    ctx.lineCap = "round";
    for (const a of water.flowArcs) {
      const rr = Rv * a.rf;
      if (rr < 12) continue;
      const span = a.span * (1 + v * 1.2);
      const steps = 16;
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const ang = a.ang + t * span;
        const d = dir > 0 ? t : 1 - t; // 顺流方向半径渐收
        const r2 = rr * (1 - v * 0.38 * d);
        const px = vcx + Math.cos(ang) * r2;
        const py = vcy + Math.sin(ang) * r2;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = `rgba(255,255,255,${0.13 * water.flowAlpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // 龙卷风：涡心处暗色涡眼（水彩沉淀式的淡径向晕）+ 白色螺旋臂
  if (water.vortex > 0.03 && water.level > 0.05) {
    const v = water.vortex;
    const dir = water.swirl >= 0 ? 1 : -1;
    const color = water._displayColor || water.baseColor;
    const eyeR = vortexEyeR(water);

    // 涡眼：颜色加深下陷（沿用水彩沉淀语言，不做立体感）
    const hue = color.h;
    const sat = Math.min(85, color.s + 20);
    const li = Math.max(24, color.l - 30);
    const g = ctx.createRadialGradient(vcx, vcy, 0, vcx, vcy, eyeR * 3);
    g.addColorStop(0, `hsla(${hue}, ${sat}%, ${li}%, ${0.5 * v})`);
    g.addColorStop(0.45, `hsla(${hue}, ${sat}%, ${li}%, ${0.18 * v})`);
    g.addColorStop(1, `hsla(${hue}, ${sat}%, ${li}%, 0)`);
    ctx.beginPath();
    ctx.arc(vcx, vcy, eyeR * 3, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // 眼缘一圈细白环
    ctx.beginPath();
    ctx.arc(vcx, vcy, eyeR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.3 * v})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 三条长螺旋臂：涡成形过半后才浮现（低涡度时由弯曲的流弧过渡）
    // 用沉淀深色而非白色——浅汤上白线没有对比
    const armA = 0.24 * Math.max(0, (v - 0.3) / 0.7);
    if (armA > 0.012) {
      ctx.lineCap = "round";
      const arms = 3;
      const steps = 22;
      for (let a = 0; a < arms; a++) {
        const a0 = water.vortexAng + (a / arms) * Math.PI * 2;
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const rr = eyeR + (Rv * 0.88 - eyeR) * t;
          const ang = a0 - dir * t * Math.PI * 1.7; // 越靠外越落后 → 拖尾螺旋
          const px = vcx + Math.cos(ang) * rr;
          const py = vcy + Math.sin(ang) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${li}%, ${armA})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }
  }

  // 匙头尾迹：头窄而实、尾宽而淡的拖尾（两层：柔光 + 窄芯）
  const wake = water.wake;
  if (wake.length >= 2) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 1; i < wake.length; i++) {
        const p0 = wake[i - 1];
        const p1 = wake[i];
        const t = i / (wake.length - 1); // 0=尾 1=头
        const life = Math.max(0, Math.min(1, p1.life));
        const alpha = (layer === 0 ? 0.10 : 0.30) * t * life;
        if (alpha < 0.01) continue;
        const width = (layer === 0 ? 1.9 : 1) * (9.5 - t * 6.5);
        ctx.beginPath();
        ctx.moveTo(x + p0.x, y + p0.y);
        ctx.lineTo(x + p1.x, y + p1.y);
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
  }

  // 涡脱落：一小段螺旋，自转 + 漂移 + 淡出
  for (const v of water.vortices) {
    const steps = 14;
    ctx.beginPath();
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const ang = v.rot + v.dir * t * Math.PI * 2.4; // ~1.2 圈
      const rr = 3 + t * 13;
      const px = x + v.x + Math.cos(ang) * rr;
      const py = y + v.y + Math.sin(ang) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.3 * v.life})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  for (const r of water.ripples) {
    ctx.beginPath();
    ctx.arc(x + r.x, y + r.y, r.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.45 * r.life})`;
    ctx.lineWidth = 2 * r.life + 0.5;
    ctx.stroke();
  }

  for (const d of water.droplets) {
    ctx.beginPath();
    ctx.arc(x + d.x, y + d.y, 2 * d.life + 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.6 * d.life})`;
    ctx.fill();
  }
  ctx.restore();
}

function drawDiffuseField(ctx, water, px, py, pw, ph) {
  const field = water.diffuseField;
  const n = DIFFUSE_N;
  const color = water._displayColor || water.baseColor;
  if (!water._offCanvas) {
    water._offCanvas = document.createElement("canvas");
    water._offCanvas.width = n;
    water._offCanvas.height = n;
  }
  const off = water._offCanvas;
  const octx = off.getContext("2d");
  const imgData = octx.createImageData(n, n);
  const noiseT = water.noiseTime;
  for (let yy = 0; yy < n; yy++) {
    for (let xx = 0; xx < n; xx++) {
      const idx = yy * n + xx;
      let c = field[idx];
      // 值噪声扰动边缘
      const nz = Math.sin(xx * 0.3 + noiseT * 0.5) * Math.cos(yy * 0.4 - noiseT * 0.3) * 0.08;
      c = Math.max(0, Math.min(1, c + nz * c));
      const li = Math.max(35, color.l - c * 32);
      const sat = Math.min(80, color.s + c * 32);
      const rgb = hslToRgb(color.h, sat, li);
      const pidx = idx * 4;
      imgData.data[pidx] = rgb[0];
      imgData.data[pidx + 1] = rgb[1];
      imgData.data[pidx + 2] = rgb[2];
      imgData.data[pidx + 3] = Math.min(255, c * 460);
    }
  }
  octx.putImageData(imgData, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(off, px, py, pw, ph);
  ctx.restore();
}

function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// 注水：从壶嘴到落点的一串水滴（俯视示意）
export function drawPourStream(ctx, spoutX, spoutY, targetX, targetY, thickness) {
  if (thickness <= 0.01) return;
  const drops = 5;
  const dx = targetX - spoutX, dy = targetY - spoutY;
  const len = Math.hypot(dx, dy) || 1;
  ctx.save();
  for (let i = 0; i < drops; i++) {
    const t = (i + 0.5) / drops;
    const bow = Math.sin(t * Math.PI) * 8;
    const px = spoutX + dx * t - (dy / len) * bow * 0.4;
    const py = spoutY + dy * t + (dx / len) * bow * 0.4;
    const rr = (0.5 + t * 0.5) * thickness * 0.45;
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210, 226, 230, ${0.65 - t * 0.12})`;
    ctx.fill();
  }
  // 落点扰动
  ctx.beginPath();
  ctx.arc(targetX, targetY, thickness * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
  ctx.restore();
}
