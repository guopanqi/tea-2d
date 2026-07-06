// herbs.js — 草药数据引用 + 绘制 + 拈起/下落/漂浮状态机（正俯视 · 食物感贴纸）
//
// ── 美术替换约定（IMPORTANT）────────────────────────────────────────────
// 每味草药的造型收敛在 HERB_ART 注册表中，分 dry（干态）/ steeped（泡开态）
// 两个独立 draw 函数。函数在"局部坐标系"绘制：origin(0,0) 为草药中心，
// 造型基础半径约 15（缩放前）。未来要换成图片素材时，只需把对应函数体
// 替换为 ctx.drawImage(img, -w/2, -h/2, w, h)（锚点保持中心、尺寸对齐
// 基础半径），状态机与其余代码无需任何改动。
// 风格（STYLE.md）：平涂 + 圆钝轮廓（固定 seed 手工不规则）+ 果脯食物感，
// 贴纸软投影由 drawHerb 统一画，造型函数只画本体。
// ─────────────────────────────────────────────────────────────────────
import { HERBS } from "./brew.js";
import { CUP, cupInnerR } from "./water.js";

// 场景坐标（逻辑坐标 750x1300，底部一排）
export const TRAY_CENTER = { x: 375, y: 1105 };
export const TRAY_RX = 330;
export const TRAY_RY = 62;

export const HERB_ART_SCALE = 2.2;
export const HERB_HIT_RADIUS = 62;

const HERB_ORDER = ["chrysanthemum", "goji", "mint", "rose", "licorice"];

// 五味一字排开（间距 130 逻辑像素），微微错落
function trayPositionFor(index, total) {
  const spacing = 130;
  const x = TRAY_CENTER.x + (index - (total - 1) / 2) * spacing;
  const y = TRAY_CENTER.y - 4 + (index % 2 === 0 ? -8 : 8);
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
    this.rotation = (Math.random() - 0.5) * 0.4;
    // 状态: tray | hover | dragging | falling | inwater | returning
    this.state = "tray";
    this.hoverAmount = 0;
    this.spread = 0; // 0..1 泡开程度
    this.opacity = 1;
    this.inspectAlpha = 0;
    this.returnStartTime = 0;
    this.returnFromX = 0;
    this.returnFromY = 0;
    this.age = 0;
    // 俯视落水：定时缓动到落点
    this.fallT = 0;
    this.fallFromX = 0;
    this.fallFromY = 0;
    this.targetCupX = 0;
    this.targetCupY = 0;
    // 俯视漂浮：永不停止的极慢漂移+自转（Koi 式活性）
    this.driftAngle = Math.random() * Math.PI * 2;
    this.spinSpeed = (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.1);
    this.driftEnabled = false; // 由 main 按水量开关
    this.sink = 0; // 0(浮)..1(沉)，绘制时缩小/降透明/压深
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

// ══════════════════ 造型工具 ══════════════════

// 固定 seed 伪随机（轮廓不规则但不闪烁）
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 手工不规则圆（豆形/卵形基底）：顶点少量扰动的闭合曲线
function blobPath(ctx, r, seed, wobble = 0.09, points = 9, squishY = 1) {
  const rand = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 + (rand() - 0.5) * 2 * wobble);
    pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * squishY });
  }
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const p = pts[i];
    const next = pts[(i + 1) % points];
    const mx = (p.x + next.x) / 2, my = (p.y + next.y) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    const nn = pts[(i + 2) % points];
    ctx.quadraticCurveTo(next.x, next.y, (next.x + nn.x) / 2, (next.y + nn.y) / 2);
  }
  ctx.closePath();
}

// ══════════════════ HERB_ART 注册表（可替换美术）══════════════════
// 食物感方向：菊花=糖霜小饼，枸杞=饱满果脯，薄荷=圆叶，玫瑰=胖花苞，甘草=糖渍柠檬片

function chrysanthemumShape(ctx, openness, seed) {
  // 糖霜小饼：奶油色胖花瓣一圈 + 蜜色圆心
  const petals = 9;
  const rand = mulberry32(seed);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + rand() * 0.1;
    const len = (10 + rand() * 2) * (0.72 + openness * 0.38);
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -len * 0.62);
    blobPath(ctx, len * 0.48, seed + i * 7, 0.1, 7, 1.5);
    ctx.fillStyle = "#f6efdc";
    ctx.fill();
    ctx.restore();
  }
  blobPath(ctx, 5.2, seed + 99, 0.06, 8);
  ctx.fillStyle = "#e4b954";
  ctx.fill();
}

function gojiShape(ctx, plump, seed) {
  // 饱满果脯：两三粒胖豆（朱红系食物色）
  const rand = mulberry32(seed);
  const n = 3;
  const size = 1 + plump * 0.16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand();
    ctx.save();
    ctx.translate(Math.cos(a) * 6, Math.sin(a) * 6);
    ctx.rotate(a * 0.6);
    blobPath(ctx, 6.4 * size, seed + i * 13, 0.08, 8, 1.35);
    ctx.fillStyle = plump > 0.3 ? "#c9553a" : "#bc4a30";
    ctx.fill();
    // 平涂小高光点（贴纸感，不做球面渐变）
    ctx.beginPath();
    ctx.arc(-1.8, -2.6, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 220, 190, 0.55)";
    ctx.fill();
    ctx.restore();
  }
}

function mintShape(ctx, openness, seed) {
  // 圆叶两片：低饱和的粉青绿
  const rand = mulberry32(seed);
  const n = 2;
  for (let i = 0; i < n; i++) {
    const a = i * 2.5 + rand() * 0.4;
    const len = 11 * (0.9 + openness * 0.18);
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -len * 0.5);
    blobPath(ctx, len * 0.66, seed + i * 17, 0.08, 8, 1.35);
    ctx.fillStyle = openness > 0.3 ? "#8fb586" : "#9bbc91";
    ctx.fill();
    // 中脉细线（平涂）
    ctx.strokeStyle = "rgba(90, 120, 85, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, len * 0.5);
    ctx.lineTo(0, -len * 0.45);
    ctx.stroke();
    ctx.restore();
  }
}

function roseShape(ctx, openness, seed) {
  // 胖花苞：三瓣圆钝粉瓣叠一颗深心
  const rand = mulberry32(seed);
  const petals = 3 + (openness > 0.5 ? 2 : 0);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + rand() * 0.3;
    const r = 5 + openness * 3;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -r * 0.55);
    blobPath(ctx, 7 + openness * 1.5, seed + i * 11, 0.09, 8);
    ctx.fillStyle = `rgba(214, 142, 162, ${0.92 - i * 0.06})`;
    ctx.fill();
    ctx.restore();
  }
  blobPath(ctx, 3.4, seed + 88, 0.08, 7);
  ctx.fillStyle = "#b26478";
  ctx.fill();
}

function licoriceShape(ctx, _spread, seed) {
  // 糖渍柠檬片：一枚圆片 + 浅色果肉 + 放射细分线
  blobPath(ctx, 11, seed, 0.05, 10);
  ctx.fillStyle = "#dcae5e";
  ctx.fill();
  blobPath(ctx, 8.2, seed + 5, 0.05, 10);
  ctx.fillStyle = "#ecd398";
  ctx.fill();
  ctx.strokeStyle = "rgba(190, 148, 74, 0.5)";
  ctx.lineWidth = 0.9;
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 2.2, Math.sin(a) * 2.2);
    ctx.lineTo(Math.cos(a) * 7.6, Math.sin(a) * 7.6);
    ctx.stroke();
  }
}

// 注册表：每味 dry / steeped 两个入口；seed 用 herbId 哈希保证轮廓固定
function seedOf(herbId, extra = 0) {
  let h = extra;
  for (let i = 0; i < herbId.length; i++) h = (h * 31 + herbId.charCodeAt(i)) | 0;
  return h;
}

export const HERB_ART = {
  chrysanthemum: {
    dry: (ctx) => chrysanthemumShape(ctx, 0.35, seedOf("chrysanthemum")),
    steeped: (ctx, spread) => chrysanthemumShape(ctx, 0.35 + spread * 0.65, seedOf("chrysanthemum")),
  },
  goji: {
    dry: (ctx) => gojiShape(ctx, 0, seedOf("goji")),
    steeped: (ctx, spread) => gojiShape(ctx, spread, seedOf("goji")),
  },
  mint: {
    dry: (ctx) => mintShape(ctx, 0, seedOf("mint")),
    steeped: (ctx, spread) => mintShape(ctx, spread, seedOf("mint")),
  },
  rose: {
    dry: (ctx) => roseShape(ctx, 0.3, seedOf("rose")),
    steeped: (ctx, spread) => roseShape(ctx, 0.3 + spread * 0.7, seedOf("rose")),
  },
  licorice: {
    dry: (ctx) => licoriceShape(ctx, 0, seedOf("licorice")),
    steeped: (ctx, spread) => licoriceShape(ctx, spread, seedOf("licorice")),
  },
};

// ══════════════════ 绘制 ══════════════════

export function drawHerb(ctx, herb) {
  const sink = herb.sink || 0;
  ctx.save();
  ctx.translate(herb.x, herb.y);
  ctx.rotate(herb.rotation);
  // 下沉暗示：缩小 5-10% + 透明度略降
  const s = herb.scale * HERB_ART_SCALE * (1 - 0.09 * sink);
  ctx.scale(s, s);
  ctx.globalAlpha = herb.opacity * (1 - 0.14 * sink);

  // 贴纸软投影（拖拽/盘中；水里不投影）
  if (herb.state !== "inwater" && herb.state !== "falling") {
    const lift = herb.state === "dragging" ? 5 : 2.5;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * 0.22;
    ctx.translate(lift * 0.6, lift);
    ctx.fillStyle = "#5a5040";
    ctx.filter = "blur(2px)";
    blobPath(ctx, 13, seedOf(herb.herbId, 3), 0.08, 8);
    ctx.fill();
    ctx.restore();
  }

  const art = HERB_ART[herb.herbId];
  if (art) {
    if (herb.spread > 0.01) art.steeped(ctx, herb.spread);
    else art.dry(ctx);
  }
  // 下沉暗示：色略深（一层极淡的暗色印）
  if (sink > 0.02) {
    blobPath(ctx, 13, seedOf(herb.herbId, 3), 0.08, 8);
    ctx.fillStyle = `rgba(70, 60, 40, ${0.14 * sink})`;
    ctx.fill();
  }
  ctx.restore();

  // 名字标签（盘中常显极淡小字，字距拉大）
  if (herb.state === "tray" || herb.state === "hover") {
    ctx.save();
    ctx.globalAlpha = 0.3 + herb.hoverAmount * 0.45;
    ctx.font = "14px 'Kaiti SC', STKaiti, KaiTi, serif";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
    ctx.fillStyle = "#4a544c";
    ctx.textAlign = "center";
    ctx.fillText(herb.def.name, herb.x + 2, herb.y + 52);
    ctx.restore();
  }

  // 拖拽中停驻 → 性味介绍在草药旁淡入（竖排两列；靠右边缘时翻到左侧）
  if (herb.state === "dragging" && herb.inspectAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = herb.inspectAlpha;
    const tx = herb.x > 620 ? herb.x - 104 : herb.x + 56;
    const ty = herb.y - 52;
    ctx.font = "17px 'Kaiti SC', STKaiti, KaiTi, serif";
    ctx.fillStyle = "#4a544c";
    ctx.textAlign = "left";
    drawVerticalText(ctx, herb.def.nature, tx, ty, 22);
    drawVerticalText(ctx, herb.def.effect, tx + 28, ty, 22);
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
      herb.rotation = (Math.random() - 0.5) * 0.4;
      herb.inspectAlpha = 0;
    }
  } else if (herb.state === "falling") {
    // 俯视落水：0.3s 缓动到落点，同时从拈起比例缩回
    herb.fallT = Math.min(1, herb.fallT + dt / 0.3);
    const e = 1 - Math.pow(1 - herb.fallT, 2);
    herb.x = herb.fallFromX + (herb.targetCupX - herb.fallFromX) * e;
    herb.y = herb.fallFromY + (herb.targetCupY - herb.fallFromY) * e;
    herb.scale = 1.15 - 0.17 * e;
    herb.inspectAlpha = 0;
  } else if (herb.state === "inwater") {
    // 永不停止的极慢漂移 + 极慢自转（画面永远在呼吸）
    herb.rotation += herb.spinSpeed * dt;
    if (herb.driftEnabled) {
      herb.driftAngle += (Math.random() - 0.5) * dt * 1.2;
      const speed = 7; // 逻辑像素/秒，极慢
      herb.x += Math.cos(herb.driftAngle) * speed * dt;
      herb.y += Math.sin(herb.driftAngle) * speed * dt;
      // 软约束在杯内圆里（越界则温柔转向圆心）
      const dx = herb.x - CUP.x, dy = herb.y - CUP.y;
      const dist = Math.hypot(dx, dy);
      const maxR = cupInnerR() * 0.78;
      if (dist > maxR) {
        herb.driftAngle = Math.atan2(-dy, -dx) + (Math.random() - 0.5) * 0.5;
        const pull = (dist - maxR) * 0.5 * dt * 4;
        herb.x -= (dx / dist) * pull;
        herb.y -= (dy / dist) * pull;
      }
    }
    // 泡开 + 沉浮暗示
    herb.spread = Math.min(1, herb.spread + dt * 0.06);
    const sinkTarget = herb.def.floats === true ? 0 : herb.def.floats === "half" ? 0.5 : 1;
    herb.sink += (sinkTarget - herb.sink) * dt * 0.25;
    herb.scale += (1 - herb.scale) * 0.1;
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
