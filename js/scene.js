// scene.js — 静物绘制（正俯视 · 贴纸化）：纸面、颗粒层、浅盘垫、杯口圆、壶
//
// ── 美术替换约定（IMPORTANT）────────────────────────────────────────────
// 所有静物收敛在 ART 注册表中，每个条目是一个独立 draw 函数：
//   ART.table(ctx)            — 米灰纸面背景（含水彩沉淀感），铺满 750x1300，origin 左上
//   ART.tray(ctx)             — 底部浅盘垫（贴纸化圆角条），锚点 TRAY_CENTER
//   ART.cupBack(ctx)          — 杯外沿环 + 空杯底色（贴纸化平涂 + 软投影），锚点 CUP 圆心
//   ART.cupFront(ctx)         — 杯内沿一两条细高光弧（画在水面之上）
//   ART.kettle(ctx, x, y, lean) — 俯视壶（平涂+软投影），lean 为注水时的轻微倾侧；返回壶嘴世界坐标
//   ART.grain(ctx)            — 全画面纸纹颗粒层，每帧最后叠加（低透明度）
// 未来把某个函数体换成 ctx.drawImage(img, ...) 即可换成图片素材——
// 保持锚点与标注尺寸一致，其余代码无需改动。
// 杯的分层顺序（由 main.js 编排）：cupBack → 水色/扩散(water.js) → 杯中草药
// → 水面涟漪(water.js) → cupFront → … → grain 收尾。
// ─────────────────────────────────────────────────────────────────────
import { TRAY_CENTER, TRAY_RX, TRAY_RY } from "./herbs.js";
import { CUP, cupInnerR } from "./water.js";

export const LOGICAL_W = 750;
export const LOGICAL_H = 1300;

export const KETTLE_HOME = { x: 590, y: 220 };

// 调色板（STYLE.md：米灰底 + 低饱和主色 + 食物色只给草药茶汤 + 朱红点缀）
const PALETTE = {
  paper: "#e8e2d6",
  ink: "#4a544c", // 黛青（文字/细线）
  cupRing: "#d8cfbc", // 杯沿环（低饱和茶褐灰）
  cupBase: "#ded7c6", // 空杯底
  mat: "#ddd4bf", // 浅盘垫
  kettleBody: "#8b8577", // 壶身（往灰里掺的茶褐）
  kettleDeep: "#767162",
  accent: "#b03a2e", // 朱红（只做点）
  shadow: "rgba(90, 80, 60, 0.16)", // 贴纸软投影
};

// ---- 纸面背景（画一次缓存）----
let backgroundCache = null;

function buildBackground() {
  const canvas = document.createElement("canvas");
  canvas.width = LOGICAL_W;
  canvas.height = LOGICAL_H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 水彩沉淀感：几团极淡的径向深浅不匀
  const blobs = [
    [0.2, 0.15, 360, 0.05], [0.85, 0.3, 300, 0.045],
    [0.5, 0.55, 420, 0.04], [0.15, 0.8, 320, 0.05],
    [0.8, 0.9, 360, 0.045],
  ];
  for (const [fx, fy, r, a] of blobs) {
    const g = ctx.createRadialGradient(
      LOGICAL_W * fx, LOGICAL_H * fy, r * 0.2,
      LOGICAL_W * fx, LOGICAL_H * fy, r
    );
    g.addColorStop(0, `rgba(160, 148, 120, ${a})`);
    g.addColorStop(1, "rgba(160, 148, 120, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  }

  return canvas;
}

// ---- 纸纹颗粒层（画一次缓存，每帧低透明度叠加）----
let grainCache = null;

function buildGrain() {
  const canvas = document.createElement("canvas");
  canvas.width = LOGICAL_W;
  canvas.height = LOGICAL_H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(LOGICAL_W, LOGICAL_H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.random() < 0.5 ? 14 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ══════════════════ ART 注册表（可替换美术）══════════════════

function drawTable(ctx) {
  if (!backgroundCache) backgroundCache = buildBackground();
  ctx.drawImage(backgroundCache, 0, 0);
}

function drawGrain(ctx) {
  if (!grainCache) grainCache = buildGrain();
  ctx.save();
  ctx.globalAlpha = 0.5; // 颗粒本身已很淡，此处再压
  ctx.drawImage(grainCache, 0, 0);
  ctx.restore();
}

// 底部浅盘垫：贴纸化圆角横条
function drawTray(ctx) {
  const { x, y } = TRAY_CENTER;
  const w = TRAY_RX * 2, h = TRAY_RY * 2;
  ctx.save();
  // 软投影（小偏移）
  ctx.fillStyle = PALETTE.shadow;
  ctx.filter = "blur(6px)";
  roundRectPath(ctx, x - w / 2 + 4, y - h / 2 + 7, w, h, h / 2);
  ctx.fill();
  ctx.filter = "none";
  // 平涂盘身
  ctx.fillStyle = PALETTE.mat;
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  // 极淡轮廓
  ctx.strokeStyle = "rgba(120, 108, 80, 0.18)";
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.stroke();
  ctx.restore();
}

// 杯：外沿环 + 空杯底色（俯视，贴纸化）
function drawCupBack(ctx) {
  const { x, y, r } = CUP;
  const innerR = cupInnerR();
  ctx.save();
  // 整杯软投影
  ctx.beginPath();
  ctx.arc(x + 5, y + 9, r, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.shadow;
  ctx.filter = "blur(10px)";
  ctx.fill();
  ctx.filter = "none";

  // 外沿环（平涂圆环）
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x, y, innerR, 0, Math.PI * 2, true);
  ctx.fillStyle = PALETTE.cupRing;
  ctx.fill();
  // 环的极淡轮廓
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(110, 98, 72, 0.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 空杯底色（注水前可见；注水后被水色圆覆盖）
  ctx.beginPath();
  ctx.arc(x, y, innerR, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.cupBase;
  ctx.fill();
  ctx.strokeStyle = "rgba(110, 98, 72, 0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// 杯内沿细高光弧（画在水面之上，贴纸化的"玻璃感"）
function drawCupFront(ctx) {
  const { x, y } = CUP;
  const innerR = cupInnerR();
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y, innerR - 6, -2.2, -1.45);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, innerR - 6, 0.7, 1.15);
  ctx.stroke();
  ctx.restore();
}

// 俯视壶：圆壶身 + 壶嘴（朝向左下的圆钝短嘴）+ 侧提把 + 朱红壶钮
// lean: 注水时轻微倾侧（弧度）。返回壶嘴出水口世界坐标。
function drawKettle(ctx, kx, ky, lean) {
  const BODY_R = 62;
  ctx.save();
  ctx.translate(kx, ky);
  ctx.rotate(lean);

  // 软投影
  ctx.beginPath();
  ctx.arc(4, 8, BODY_R + 4, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.shadow;
  ctx.filter = "blur(8px)";
  ctx.fill();
  ctx.filter = "none";

  // 壶嘴（朝左下，圆钝小舌）
  ctx.beginPath();
  ctx.moveTo(-BODY_R * 0.62, BODY_R * 0.5);
  ctx.quadraticCurveTo(-BODY_R * 1.35, BODY_R * 0.82, -BODY_R * 1.28, BODY_R * 1.02);
  ctx.quadraticCurveTo(-BODY_R * 1.0, BODY_R * 1.06, -BODY_R * 0.42, BODY_R * 0.78);
  ctx.closePath();
  ctx.fillStyle = PALETTE.kettleDeep;
  ctx.fill();

  // 侧提把（右上弧）
  ctx.beginPath();
  ctx.arc(BODY_R * 0.75, -BODY_R * 0.75, BODY_R * 0.62, -0.6, 1.8);
  ctx.strokeStyle = PALETTE.kettleDeep;
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  ctx.stroke();

  // 壶身（平涂圆）
  ctx.beginPath();
  ctx.arc(0, 0, BODY_R, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.kettleBody;
  ctx.fill();
  ctx.strokeStyle = "rgba(70, 62, 48, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 壶盖圆 + 朱红壶钮（全画面唯一的红点缀之一）
  ctx.beginPath();
  ctx.arc(0, 0, BODY_R * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(70, 62, 48, 0.2)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.accent;
  ctx.fill();

  ctx.restore();

  // 壶嘴出水口世界坐标（局部 (-BODY_R*1.28, BODY_R*1.02) 经 lean 旋转）
  const sx = -BODY_R * 1.28, sy = BODY_R * 1.02;
  const cos = Math.cos(lean), sin = Math.sin(lean);
  return {
    x: kx + sx * cos - sy * sin,
    y: ky + sx * sin + sy * cos,
  };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const ART = {
  table: drawTable,
  tray: drawTray,
  cupBack: drawCupBack,
  cupFront: drawCupFront,
  kettle: drawKettle,
  grain: drawGrain,
};

export const drawBackground = drawTable;
