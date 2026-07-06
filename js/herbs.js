// herbs.js — 草药数据引用 + 绘制 + 拈起/下落/舒展状态机
//
// ── 美术替换约定（IMPORTANT）────────────────────────────────────────────
// 每味草药的造型收敛在 HERB_ART 注册表中，分 dry（干态）/ steeped（泡开态）
// 两个独立 draw 函数。函数在"局部坐标系"绘制：origin(0,0) 为草药中心，
// 造型基础半径约 15（缩放前）。未来要换成图片素材时，只需把对应函数体
// 替换为 ctx.drawImage(img, -w/2, -h/2, w, h)（锚点保持中心、尺寸对齐
// 基础半径），状态机与其余代码无需任何改动。
// ─────────────────────────────────────────────────────────────────────
import { HERBS } from "./brew.js";

// 场景坐标（逻辑坐标 750x1300，竖屏三段式的下段）
export const TRAY_CENTER = { x: 375, y: 1105 };
export const TRAY_RX = 330; // 横向浅盘
export const TRAY_RY = 62;

// 草药整体美术缩放（让盘中形态可读）
export const HERB_ART_SCALE = 2.2;
// 命中半径（逻辑像素，触屏指尖友好）
export const HERB_HIT_RADIUS = 62;

const HERB_ORDER = ["chrysanthemum", "goji", "mint", "rose", "licorice"];

// 五味在浅盘中一字排开（间距 130 逻辑像素，拇指可分辨），微微错落
function trayPositionFor(index, total) {
  const spacing = 130;
  const x = TRAY_CENTER.x + (index - (total - 1) / 2) * spacing;
  const y = TRAY_CENTER.y - 8 + (index % 2 === 0 ? -8 : 8);
  return { x, y };
}

let idCounter = 0;

export class Herb {
  constructor(herbId, homeX, homeY) {
    this.instanceId = ++idCounter;
    this.herbId = herbId;
    this.def = HERBS[herbId];
    this.homeX = homeX;
    this.homeY = homeY;
    this.x = homeX;
    this.y = homeY;
    this.targetX = homeX;
    this.targetY = homeY;
    this.scale = 1;
    this.rotation = (Math.random() - 0.5) * 0.3;
    // 状态: tray | hover | dragging | falling | inwater | returning
    this.state = "tray";
    this.hoverAmount = 0;
    this.spread = 0; // 0..1 舒展/泡发程度
    this.fallVy = 0;
    this.floatY = 0; // 水中浮沉 0(浮)..1(沉底)
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.opacity = 1;
    this.inspectAlpha = 0; // 拖拽中停住时性味介绍的透明度
    this.returnStartTime = 0;
    this.returnFromX = 0;
    this.returnFromY = 0;
    this.age = 0;
  }
}

export function createTrayHerbs() {
  const herbs = [];
  HERB_ORDER.forEach((id, i) => {
    const pos = trayPositionFor(i, HERB_ORDER.length);
    herbs.push(new Herb(id, pos.x, pos.y));
  });
  return herbs;
}

// ══════════════════ HERB_ART 注册表（可替换美术）══════════════════

function chrysanthemumShape(ctx, openness) {
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    const len = 14 * openness;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(3.4, -len * 0.4, 3.4, -len * 0.9, 0, -len);
    ctx.bezierCurveTo(-3.4, -len * 0.9, -3.4, -len * 0.4, 0, 0);
    ctx.fillStyle = "rgba(250, 245, 225, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(200,180,130,0.3)";
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
  ctx.fillStyle = "#c9a13a";
  ctx.fill();
}

function gojiShape(ctx, plump) {
  const n = 4;
  const size = 1 + plump * 0.18; // 泡发微微变大变润
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a) * 5.5;
    const dy = Math.sin(a) * 5.5;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.4 * size, 6.6 * size, 0, 0, Math.PI * 2);
    ctx.fillStyle = plump > 0.3 ? "#c9532f" : "#c1401f";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-1, -1.6, 1.7, 2.5, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,160,${0.3 + plump * 0.15})`;
    ctx.fill();
    ctx.restore();
  }
}

function mintShape(ctx, openness) {
  const leaves = 3;
  const len = 16 * (0.9 + openness * 0.2);
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    // 锯齿感：两侧各几段贝塞尔小波
    ctx.bezierCurveTo(6, -len * 0.25, 8, -len * 0.45, 6.5, -len * 0.6);
    ctx.bezierCurveTo(8.5, -len * 0.7, 5, -len * 0.85, 0, -len);
    ctx.bezierCurveTo(-5, -len * 0.85, -8.5, -len * 0.7, -6.5, -len * 0.6);
    ctx.bezierCurveTo(-8, -len * 0.45, -6, -len * 0.25, 0, 0);
    ctx.fillStyle = openness > 0.3 ? "#6fa66b" : "#7fae7a";
    ctx.fill();
    ctx.strokeStyle = "rgba(60,90,55,0.45)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.lineTo(0, -len * 0.88);
    ctx.stroke();
    ctx.restore();
  }
}

function roseShape(ctx, openness) {
  const layers = 3;
  for (let l = 0; l < layers; l++) {
    const petals = 5;
    const r = (3.4 + l * 3.4) * openness;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + l * 0.4;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, -r, 3.6 + l * 0.7, 5 + l * 1.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${170 - l * 10}, ${90 - l * 5}, ${120 - l * 5}, ${0.88 - l * 0.1})`;
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.beginPath();
  ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = "#8c3a52";
  ctx.fill();
}

function licoriceShape(ctx) {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const dx = Math.cos(a) * 4.5;
    const dy = Math.sin(a) * 4.5;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(a * 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, 5.6, 3.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#c9a25a";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.6, 2.2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(140,100,50,0.55)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // 斜切纹理线
    ctx.beginPath();
    ctx.moveTo(-4, -1);
    ctx.lineTo(4, 1);
    ctx.strokeStyle = "rgba(140,100,50,0.3)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  }
}

// 注册表：每味草药 dry / steeped 两个入口。
// 替换美术时：把 dry / steeped 换成各自的 drawImage 即可。
export const HERB_ART = {
  chrysanthemum: {
    dry: (ctx) => chrysanthemumShape(ctx, 0.5),
    steeped: (ctx, spread) => chrysanthemumShape(ctx, 0.5 + spread * 0.5),
  },
  goji: {
    dry: (ctx) => gojiShape(ctx, 0),
    steeped: (ctx, spread) => gojiShape(ctx, spread),
  },
  mint: {
    dry: (ctx) => mintShape(ctx, 0),
    steeped: (ctx, spread) => mintShape(ctx, spread),
  },
  rose: {
    dry: (ctx) => roseShape(ctx, 0.4),
    steeped: (ctx, spread) => roseShape(ctx, 0.4 + spread * 0.6),
  },
  licorice: {
    dry: (ctx) => licoriceShape(ctx),
    steeped: (ctx) => licoriceShape(ctx),
  },
};

// ══════════════════ 绘制 ══════════════════

export function drawHerb(ctx, herb) {
  ctx.save();
  ctx.translate(herb.x, herb.y);
  ctx.rotate(herb.rotation);
  const s = herb.scale * HERB_ART_SCALE;
  ctx.scale(s, s);
  ctx.globalAlpha = herb.opacity;

  // 软阴影（暗示高度）
  if (herb.state === "dragging" || herb.state === "falling") {
    const lift = herb.state === "falling" ? Math.max(0, 12 - herb.age * 40) : 12;
    ctx.save();
    ctx.globalAlpha = herb.opacity * 0.2;
    ctx.beginPath();
    ctx.ellipse(2, lift * 0.5 + 8, 13, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#3d2c1a";
    ctx.filter = "blur(3px)";
    ctx.fill();
    ctx.restore();
  }

  const art = HERB_ART[herb.herbId];
  if (art) {
    if (herb.spread > 0.01) art.steeped(ctx, herb.spread);
    else art.dry(ctx);
  }
  ctx.restore();

  // 名字标签（盘中常显极淡小字，触屏无 hover 也可读；悬停/触到时加深）
  if (herb.state === "tray" || herb.state === "hover") {
    ctx.save();
    ctx.globalAlpha = 0.26 + herb.hoverAmount * 0.55;
    ctx.font = "16px 'Kaiti SC', STKaiti, KaiTi, serif";
    ctx.fillStyle = "#3d4a3e";
    ctx.textAlign = "center";
    ctx.fillText(herb.def.name, herb.x, herb.y + 52);
    ctx.restore();
  }

  // 拖拽中停驻 → 性味介绍在草药旁淡入（竖排两列；靠右边缘时翻到左侧）
  if (herb.state === "dragging" && herb.inspectAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = herb.inspectAlpha;
    const tx = herb.x > 620 ? herb.x - 104 : herb.x + 56;
    const ty = herb.y - 52;
    ctx.font = "17px 'Kaiti SC', STKaiti, KaiTi, serif";
    ctx.fillStyle = "#3d4a3e";
    ctx.textAlign = "left";
    drawVerticalText(ctx, herb.def.nature, tx, ty, 20);
    drawVerticalText(ctx, herb.def.effect, tx + 26, ty, 20);
    ctx.restore();
  }
}

function drawVerticalText(ctx, text, x, y, lineHeight) {
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y + i * lineHeight);
  }
}

// ══════════════════ 状态更新 ══════════════════

export function updateHerb(herb, dt) {
  herb.age += dt;
  const springK = 0.12;

  if (herb.state === "dragging") {
    herb.x += (herb.targetX - herb.x) * springK;
    herb.y += (herb.targetY - herb.y) * springK;
    const dx = herb.targetX - herb.x;
    const targetRot = Math.max(-0.35, Math.min(0.35, dx * 0.015));
    herb.rotation += (targetRot - herb.rotation) * 0.15;
    herb.scale += (1.15 - herb.scale) * 0.15;
  } else if (herb.state === "returning") {
    const elapsed = herb.age - herb.returnStartTime;
    const dur = 0.6;
    const t = Math.min(1, elapsed / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const arcHeight = -50 * Math.sin(Math.PI * t);
    herb.x = herb.returnFromX + (herb.homeX - herb.returnFromX) * eased;
    herb.y = herb.returnFromY + (herb.homeY - herb.returnFromY) * eased + arcHeight;
    herb.rotation += (0 - herb.rotation) * 0.08;
    herb.scale += (1 - herb.scale) * 0.1;
    herb.inspectAlpha = Math.max(0, herb.inspectAlpha - dt * 4);
    if (t >= 1) {
      herb.state = "tray";
      herb.x = herb.homeX;
      herb.y = herb.homeY;
      herb.scale = 1;
      herb.rotation = (Math.random() - 0.5) * 0.3;
      herb.inspectAlpha = 0;
    }
  } else if (herb.state === "falling") {
    herb.fallVy += 600 * dt;
    herb.y += herb.fallVy * dt;
    herb.scale += (1 - herb.scale) * 0.2;
    herb.rotation += (0 - herb.rotation) * 0.1;
    herb.inspectAlpha = 0;
  } else if (herb.state === "inwater") {
    herb.wobblePhase += dt * 1.2;
    const floatTarget = herb.def.floats === true ? 0.08 : herb.def.floats === "half" ? 0.45 : 0.85;
    herb.floatY += (floatTarget - herb.floatY) * 0.03;
    herb.spread = Math.min(1, herb.spread + dt * 0.06);
    herb.inspectAlpha = 0;
  } else {
    // tray / hover
    herb.scale += ((herb.state === "hover" ? 1.06 : 1) - herb.scale) * 0.12;
    const hoverTargetY = herb.state === "hover" ? herb.homeY - 3 : herb.homeY;
    herb.y += (hoverTargetY - herb.y) * 0.15;
    herb.x += (herb.homeX - herb.x) * 0.15;
    herb.hoverAmount += ((herb.state === "hover" ? 1 : 0) - herb.hoverAmount) * 0.15;
    herb.inspectAlpha = Math.max(0, herb.inspectAlpha - dt * 4);
  }
}

export function hitTestHerb(herbs, x, y, statesAllowed = ["tray", "hover"]) {
  for (let i = herbs.length - 1; i >= 0; i--) {
    const h = herbs[i];
    if (!statesAllowed.includes(h.state)) continue;
    const dx = x - h.x;
    const dy = y - h.y;
    if (Math.sqrt(dx * dx + dy * dy) < HERB_HIT_RADIUS) return h;
  }
  return null;
}
