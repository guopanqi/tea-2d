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
  }

  reset() {
    this.level = 0;
    this.ripples = [];
    this.droplets = [];
    this.pouring = false;
    this.flowStrength = 0;
    this.diffuseField.fill(0);
    this.diffuseFieldNext.fill(0);
  }

  // 水色圆当前半径（逻辑像素）
  fillRadius() {
    return (this.level / 0.85) * cupInnerR();
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
    this.noiseTime += dt;
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

// 涟漪与溅落水珠（画在漂浮草药之上——它们属于水面）
export function drawCupSurfaceFx(ctx, water) {
  const { x, y } = CUP;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, cupInnerR(), 0, Math.PI * 2);
  ctx.clip();

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
