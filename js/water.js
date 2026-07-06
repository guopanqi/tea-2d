// water.js — 水位、水面、涟漪、注水流、扩散场（茶色）
//
// ── 美术替换约定（IMPORTANT）───────────────────────────────────────
// 杯子的渲染遵循严格的"三明治"顺序（由 main.js 编排）：
//   1. scene.ART.cupBack(ctx)   — 杯后壁（玻璃底色/背面轮廓）
//   2. herbs（杯中草药）+ drawCupWater(ctx, ...) — 水体/茶色/水下遮罩
//   3. scene.ART.cupFront(ctx)  — 杯前壁高光与杯口
// drawCupWater 本身也是可替换单元：它在杯体裁剪区域内绘制，
// 未来若改用贴图水体，保持同样的裁剪区域和绘制时机即可。
// ────────────────────────────────────────────────────────────────
import { mixColor } from "./brew.js";
import * as audio from "./audio.js";

export const CUP = {
  x: 660,
  y: 550,
  rx: 112,
  ry: 40,
  height: 235, // 杯体可视高度
  bottomScale: 0.82, // 杯底半径 = rx * bottomScale（上下收分，玻璃茶杯感）
};

// 杯壁在某一竖直位置的内半径（yFromBottom: 距杯底的高度 0..height）
export function cupRadiusAt(yFromBottom) {
  const t = Math.max(0, Math.min(1, yFromBottom / CUP.height));
  const bottomRx = CUP.rx * CUP.bottomScale;
  return bottomRx + (CUP.rx - bottomRx) * t;
}

const DIFFUSE_W = 96;
const DIFFUSE_H = 64;

export class WaterSystem {
  constructor() {
    this.level = 0; // 0..1，占杯高比例
    this.ripples = []; // {x, y (0..1 rel), radius, life}
    this.droplets = []; // 溅起水珠 {x,y,vx,vy,life}
    this.pouring = false;
    this.flowStrength = 0; // 0..1
    this.flowThickness = 0;
    this.herbColorSources = []; // {relX, relY, hue, sat, light} 用于扩散注入
    this.diffuseField = new Float32Array(DIFFUSE_W * DIFFUSE_H); // 浓度场 0..1
    this.diffuseFieldNext = new Float32Array(DIFFUSE_W * DIFFUSE_H);
    this.diffuseColorField = null; // 混合色相场，简单起见用整体色，不逐格
    this.noiseTime = 0;
    this.baseColor = { h: 45, s: 8, l: 92 };
    this.targetHerbIds = [];
    this.lastRippleSoundTime = -10;
  }

  reset() {
    this.level = 0;
    this.ripples = [];
    this.droplets = [];
    this.pouring = false;
    this.flowStrength = 0;
    this.herbColorSources = [];
    this.diffuseField.fill(0);
    this.diffuseFieldNext.fill(0);
    this.targetHerbIds = [];
  }

  addRipple(relX, relY) {
    this.ripples.push({ x: relX, y: relY, radius: 0, life: 1 });
    if (performance.now() / 1000 - this.lastRippleSoundTime > 0.15) {
      audio.playRipple();
      this.lastRippleSoundTime = performance.now() / 1000;
    }
  }

  addSplash(relX, relY, count = 3) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const speed = 60 + Math.random() * 60;
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

  // 在扩散场中某相对位置(0..1,0..1)注入颜色浓度
  injectHerbColor(relX, relY, amount = 1) {
    const gx = Math.floor(relX * DIFFUSE_W);
    const gy = Math.floor(relY * DIFFUSE_H);
    const idx = gy * DIFFUSE_W + gx;
    if (idx >= 0 && idx < this.diffuseField.length) {
      this.diffuseField[idx] = Math.min(1, this.diffuseField[idx] + amount);
    }
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

  update(dt, herbsInWater) {
    // 水位随注水上升
    if (this.pouring && this.flowStrength > 0 && this.level < 0.85) {
      this.level = Math.min(0.85, this.level + this.flowStrength * dt * 0.12);
    }
    if (this.pouring) {
      audio.updatePour(this.level / 0.85, this.flowStrength);
    }

    // 涟漪衰减扩散
    for (const r of this.ripples) {
      r.radius += dt * 55;
      r.life -= dt * 0.9;
    }
    this.ripples = this.ripples.filter((r) => r.life > 0);

    // 水珠物理
    for (const d of this.droplets) {
      d.vy += 220 * dt;
      d.x += d.vx * dt * 0.001;
      d.y += d.vy * dt * 0.001;
      d.life -= dt * 1.8;
    }
    this.droplets = this.droplets.filter((d) => d.life > 0);

    // 扩散场：从草药位置注入 + 模糊扩散
    if (herbsInWater && herbsInWater.length > 0 && this.level > 0.02) {
      for (const h of herbsInWater) {
        this.injectHerbColor(h.relX, h.relY, dt * 0.35);
      }
    }
    this._diffuse(dt);
    this.noiseTime += dt;
  }

  _diffuse(dt) {
    const w = DIFFUSE_W, h = DIFFUSE_H;
    const field = this.diffuseField;
    const next = this.diffuseFieldNext;
    const rate = 0.18;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const c = field[idx];
        const left = field[y * w + Math.max(0, x - 1)];
        const right = field[y * w + Math.min(w - 1, x + 1)];
        const up = field[Math.max(0, y - 1) * w + x];
        const down = field[Math.min(h - 1, y + 1) * w + x];
        const avg = (left + right + up + down) / 4;
        next[idx] = c + (avg - c) * rate;
      }
    }
    this.diffuseField.set(next);
  }

  // 平均浓度（用于判断整体上色程度，非必需）
  averageConcentration() {
    let sum = 0;
    for (let i = 0; i < this.diffuseField.length; i++) sum += this.diffuseField[i];
    return sum / this.diffuseField.length;
  }
}

// ---- 绘制：杯体水面、涟漪、水珠、扩散茶色 ----

// 构造"水体"路径：完整水面椭圆顶弧 + 随杯壁收分的两侧 + 杯底椭圆下弧。
// 茶色/扩散场/水下遮罩全部 clip 在这个路径内，与杯形严丝合缝。
function buildWaterBodyPath(ctx, waterLevel) {
  const { x, y, ry, height } = CUP;
  const waterTopY = y - waterLevel * height;
  const surfR = cupRadiusAt(waterLevel * height) * 0.96; // 水面处内半径
  const botR = cupRadiusAt(0) * 0.96; // 杯底内半径
  const surfRy = ry * 0.94;
  const botRy = ry * 0.9;

  ctx.beginPath();
  // 水面椭圆上半弧（左→右，完整覆盖水面上缘）
  ctx.ellipse(x, waterTopY, surfR, surfRy, 0, Math.PI, Math.PI * 2, false);
  // 右侧壁（跟随收分）
  ctx.lineTo(x + botR, y);
  // 杯底椭圆下半弧（右→左）
  ctx.ellipse(x, y, botR, botRy, 0, 0, Math.PI, false);
  // 左侧壁回到水面
  ctx.closePath();
}

export function drawCupWater(ctx, water) {
  const { x, y, ry, height } = CUP;
  if (water.level <= 0.001) return;

  const waterTopY = y - water.level * height;
  const waterHeightPx = water.level * height;
  const baseColor = water._displayColor || water.baseColor;
  const surfR = cupRadiusAt(water.level * height) * 0.96;
  const surfRy = ry * 0.94;

  ctx.save();
  buildWaterBodyPath(ctx, water.level);
  ctx.clip();

  // 扩散场绘制（低分辨率放大；覆盖范围含水面椭圆上弧到杯底下弧）
  drawDiffuseField(
    ctx, water,
    x - CUP.rx, waterTopY - surfRy,
    CUP.rx * 2, waterHeightPx + surfRy + ry
  );

  // 水下遮罩：带茶色的半透明层盖在水位以下的一切之上（含杯中草药），
  // 做出草药"沉在水里"的进深感——越深处遮罩越浓。
  const maskGrad = ctx.createLinearGradient(0, waterTopY - surfRy, 0, y + ry);
  maskGrad.addColorStop(0, `hsla(${baseColor.h}, ${baseColor.s}%, ${Math.min(94, baseColor.l + 8)}%, 0.28)`);
  maskGrad.addColorStop(1, `hsla(${baseColor.h}, ${Math.min(90, baseColor.s + 10)}%, ${Math.max(20, baseColor.l - 12)}%, 0.5)`);
  ctx.fillStyle = maskGrad;
  ctx.fillRect(x - CUP.rx, waterTopY - surfRy, CUP.rx * 2, waterHeightPx + surfRy + ry);

  ctx.restore();

  // 水面：带茶色但更亮的椭圆面 + 反光边
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, waterTopY, surfR, surfRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${baseColor.h}, ${Math.max(8, baseColor.s - 10)}%, ${Math.min(96, baseColor.l + 14)}%, 0.30)`;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  // 涟漪
  ctx.save();
  for (const r of water.ripples) {
    ctx.beginPath();
    ctx.ellipse(x + r.x, waterTopY + r.y, r.radius, r.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * r.life})`;
    ctx.lineWidth = 1.5 * r.life;
    ctx.stroke();
  }
  ctx.restore();

  // 水珠
  ctx.save();
  for (const d of water.droplets) {
    ctx.beginPath();
    ctx.arc(x + d.x, waterTopY + d.y, 1.8 * d.life + 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210,225,255,${0.8 * d.life})`;
    ctx.fill();
  }
  ctx.restore();
}

function drawDiffuseField(ctx, water, px, py, pw, ph) {
  const field = water.diffuseField;
  const w = DIFFUSE_W, h = DIFFUSE_H;
  const color = water._displayColor || water.baseColor;
  // 低分辨率离屏绘制再放大（自带柔和感）
  if (!water._offCanvas) {
    water._offCanvas = document.createElement("canvas");
    water._offCanvas.width = w;
    water._offCanvas.height = h;
  }
  const off = water._offCanvas;
  const octx = off.getContext("2d");
  const imgData = octx.createImageData(w, h);
  const noiseT = water.noiseTime;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const idx = yy * w + xx;
      let c = field[idx];
      // 值噪声扰动边缘不规则感
      const n = Math.sin(xx * 0.3 + noiseT * 0.5) * Math.cos(yy * 0.4 - noiseT * 0.3) * 0.08;
      c = Math.max(0, Math.min(1, c + n * c));
      const li = Math.max(15, color.l - c * 45);
      const sat = Math.min(85, color.s + c * 40);
      const rgb = hslToRgb(color.h, sat, li);
      const pidx = idx * 4;
      imgData.data[pidx] = rgb[0];
      imgData.data[pidx + 1] = rgb[1];
      imgData.data[pidx + 2] = rgb[2];
      imgData.data[pidx + 3] = Math.min(255, c * 500 + 40);
    }
  }
  octx.putImageData(imgData, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.92;
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

// 注水流：从壶嘴到水面的贝塞尔弧线
export function drawPourStream(ctx, spoutX, spoutY, targetX, targetY, thickness) {
  if (thickness <= 0.01) return;
  const midX = (spoutX + targetX) / 2;
  const midY = spoutY + (targetY - spoutY) * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(spoutX, spoutY);
  ctx.quadraticCurveTo(midX, midY, targetX, targetY);
  ctx.strokeStyle = "rgba(210,228,240,0.75)";
  ctx.lineWidth = Math.max(1, thickness);
  ctx.lineCap = "round";
  ctx.stroke();
  // 内部高光细线
  ctx.beginPath();
  ctx.moveTo(spoutX, spoutY);
  ctx.quadraticCurveTo(midX, midY, targetX, targetY);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(0.5, thickness * 0.35);
  ctx.stroke();
  // 落点扰动
  ctx.beginPath();
  ctx.arc(targetX, targetY, thickness * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
  ctx.restore();
}
