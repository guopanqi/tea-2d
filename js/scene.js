// scene.js — 静物绘制：桌、盘、杯、壶、光
//
// ── 美术替换约定（IMPORTANT）────────────────────────────────────────────
// 所有静物收敛在 ART 注册表中，每个条目是一个独立 draw 函数：
//   ART.table(ctx)              — 背景+桌面，铺满逻辑画布 1200x800，origin 左上角
//   ART.tray(ctx)               — 陶盘，锚点 TRAY_CENTER，椭圆 rx=TRAY_RADIUS
//   ART.cupBack(ctx)            — 玻璃杯"后壁"（阴影+背面轮廓），锚点 CUP(x, y=杯底中心)
//   ART.cupFront(ctx)           — 玻璃杯"前壁"（高光+杯口），同锚点
//   ART.kettle(ctx, x, y, tilt) — 陶壶，锚点为壶身中心，tilt 弧度；返回壶嘴世界坐标
// 未来把某个函数体换成 ctx.drawImage(img, ...) 即可换成图片素材——
// 保持锚点与标注尺寸一致，其余代码无需改动。
// 杯子严格遵循三明治顺序（由 main.js 编排）：
//   cupBack → 杯中草药 + 水/茶色(water.js) → cupFront
// ─────────────────────────────────────────────────────────────────────
import { TRAY_CENTER, TRAY_RADIUS } from "./herbs.js";
import { CUP } from "./water.js";

export const LOGICAL_W = 1200;
export const LOGICAL_H = 800;

export const KETTLE_HOME = { x: 975, y: 450 };
export const KETTLE_SCALE = 1.5;

// 背景 + 桌面（含木纹）只需画一次到离屏缓存，随后每帧直接贴图
let backgroundCache = null;

function buildBackground() {
  const canvas = document.createElement("canvas");
  canvas.width = LOGICAL_W;
  canvas.height = LOGICAL_H;
  const ctx = canvas.getContext("2d");

  // 宣纸底
  const bgGrad = ctx.createLinearGradient(0, 0, LOGICAL_W, LOGICAL_H);
  bgGrad.addColorStop(0, "#f7f2e8");
  bgGrad.addColorStop(1, "#f0e9da");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 细噪点
  const noiseData = ctx.createImageData(LOGICAL_W, LOGICAL_H);
  for (let i = 0; i < noiseData.data.length; i += 4) {
    const v = 245 + (Math.random() - 0.5) * 14;
    noiseData.data[i] = v;
    noiseData.data[i + 1] = v - 3;
    noiseData.data[i + 2] = v - 12;
    noiseData.data[i + 3] = 10;
  }
  ctx.putImageData(noiseData, 0, 0);

  // 右上窗光
  const lightGrad = ctx.createRadialGradient(
    LOGICAL_W * 0.85, LOGICAL_H * 0.05, 50,
    LOGICAL_W * 0.85, LOGICAL_H * 0.05, 750
  );
  lightGrad.addColorStop(0, "rgba(255,250,230,0.55)");
  lightGrad.addColorStop(1, "rgba(255,250,230,0)");
  ctx.fillStyle = lightGrad;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 桌面（上移，占画面主体约 3/4）
  const tableTop = LOGICAL_H * 0.21;
  const tableGrad = ctx.createLinearGradient(0, tableTop, 0, LOGICAL_H);
  tableGrad.addColorStop(0, "#9c7f5c");
  tableGrad.addColorStop(1, "#6e5637");
  ctx.fillStyle = tableGrad;
  ctx.fillRect(0, tableTop, LOGICAL_W, LOGICAL_H - tableTop);

  // 木纹曲线
  ctx.strokeStyle = "rgba(60,42,20,0.14)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 16; i++) {
    const y0 = tableTop + 10 + i * 38 + Math.random() * 10;
    ctx.beginPath();
    ctx.moveTo(-20, y0);
    ctx.bezierCurveTo(
      LOGICAL_W * 0.3, y0 + Math.sin(i) * 14,
      LOGICAL_W * 0.7, y0 - Math.sin(i * 1.3) * 14,
      LOGICAL_W + 20, y0
    );
    ctx.stroke();
  }

  // 桌面高光（呼应窗光）
  const tableLight = ctx.createRadialGradient(
    LOGICAL_W * 0.8, tableTop + 40, 30,
    LOGICAL_W * 0.8, tableTop + 40, 500
  );
  tableLight.addColorStop(0, "rgba(255,240,200,0.18)");
  tableLight.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = tableLight;
  ctx.fillRect(0, tableTop, LOGICAL_W, LOGICAL_H - tableTop);

  return canvas;
}

// ══════════════════ ART 注册表（可替换美术）══════════════════

function drawTable(ctx) {
  if (!backgroundCache) backgroundCache = buildBackground();
  ctx.drawImage(backgroundCache, 0, 0);
}

function drawTray(ctx) {
  const { x, y } = TRAY_CENTER;
  const rx = TRAY_RADIUS, ry = TRAY_RADIUS * 0.42;
  ctx.save();
  // 盘影
  ctx.beginPath();
  ctx.ellipse(x + 6, y + 14, rx * 1.02, ry * 1.05, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(40,28,14,0.18)";
  ctx.filter = "blur(8px)";
  ctx.fill();
  ctx.filter = "none";

  // 盘身
  const grad = ctx.createRadialGradient(x, y - ry * 0.3, 14, x, y, rx);
  grad.addColorStop(0, "#e9dfc8");
  grad.addColorStop(1, "#cfc09b");
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(120,100,60,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 内圈
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.78, ry * 0.78, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(120,100,60,0.2)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

// 玻璃杯后壁：投影 + 背面玻璃轮廓（画在水和草药之下）
function drawCupBack(ctx) {
  const { x, y, rx, ry, height } = CUP;
  const topY = y - height;
  const bottomRx = rx * CUP.bottomScale, bottomRy = ry * CUP.bottomScale;

  ctx.save();
  // 杯影
  ctx.beginPath();
  ctx.ellipse(x + 7, y + ry * 0.7 + 10, rx * 1.05, ry * 1.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(40,28,14,0.2)";
  ctx.filter = "blur(9px)";
  ctx.fill();
  ctx.filter = "none";

  // 杯壁基底（半透明玻璃体）
  ctx.beginPath();
  ctx.moveTo(x - rx, topY);
  ctx.lineTo(x - bottomRx, y);
  ctx.ellipse(x, y, bottomRx, bottomRy, 0, Math.PI, 0, true);
  ctx.lineTo(x + rx, topY);
  ctx.ellipse(x, topY, rx, ry, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();

  // 杯口背缘（远侧半椭圆）
  ctx.beginPath();
  ctx.ellipse(x, topY, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 杯底椭圆
  ctx.beginPath();
  ctx.ellipse(x, y, bottomRx, bottomRy, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

// 玻璃杯前壁：侧壁渐变高光 + 杯口前缘（画在水和草药之上）
function drawCupFront(ctx) {
  const { x, y, rx, ry, height } = CUP;
  const topY = y - height;
  const bottomRx = rx * CUP.bottomScale, bottomRy = ry * CUP.bottomScale;

  ctx.save();
  // 前壁玻璃渐变（左右两条竖高光带）
  ctx.beginPath();
  ctx.moveTo(x - rx, topY);
  ctx.lineTo(x - bottomRx, y);
  ctx.ellipse(x, y, bottomRx, bottomRy, 0, Math.PI, 0, true);
  ctx.lineTo(x + rx, topY);
  ctx.ellipse(x, topY, rx, ry, 0, 0, Math.PI, true);
  ctx.closePath();
  const glassGrad = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  glassGrad.addColorStop(0, "rgba(255,255,255,0.10)");
  glassGrad.addColorStop(0.12, "rgba(255,255,255,0.3)");
  glassGrad.addColorStop(0.5, "rgba(255,255,255,0.03)");
  glassGrad.addColorStop(0.88, "rgba(255,255,255,0.24)");
  glassGrad.addColorStop(1, "rgba(255,255,255,0.08)");
  ctx.fillStyle = glassGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 杯口前缘（近侧半椭圆，压在一切之上）
  ctx.beginPath();
  ctx.ellipse(x, topY, rx, ry, 0, 0, Math.PI);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 竖向高光条
  ctx.beginPath();
  ctx.moveTo(x - rx * 0.55, topY + 6);
  ctx.lineTo(x - bottomRx * 0.55, y - 6);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.filter = "blur(3px)";
  ctx.stroke();
  ctx.filter = "none";
  ctx.restore();
}

// 陶壶（侧提，壶嘴朝杯=朝左），支持倾角；返回壶嘴出水口世界坐标。
// tiltAngle 为正值表示向杯口方向倾倒（内部做镜像与转向换算）。
function drawKettle(ctx, kettleX, kettleY, tiltAngle) {
  const S = KETTLE_SCALE;
  ctx.save();
  ctx.translate(kettleX, kettleY);
  ctx.rotate(-tiltAngle); // 壶嘴朝左，倒水是逆时针
  ctx.scale(-S, S); // 水平镜像：原始造型壶嘴朝右

  // 壶影（不随倾角旋转；被提起/倾倒时淡出）
  const shadowAlpha = 0.18 * Math.max(0, 1 - Math.abs(tiltAngle) * 1.2);
  if (shadowAlpha > 0.01) {
    ctx.save();
    ctx.rotate(tiltAngle);
    ctx.beginPath();
    ctx.ellipse(4, 46, 40, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(40,28,14,${shadowAlpha})`;
    ctx.filter = "blur(5px)";
    ctx.fill();
    ctx.restore();
  }

  // 壶身
  const bodyGrad = ctx.createRadialGradient(-10, -10, 5, 0, 0, 55);
  bodyGrad.addColorStop(0, "#9a6b4a");
  bodyGrad.addColorStop(1, "#6b4527");
  ctx.beginPath();
  ctx.moveTo(-38, 0);
  ctx.bezierCurveTo(-42, -30, -25, -48, 0, -50);
  ctx.bezierCurveTo(25, -48, 42, -30, 38, 0);
  ctx.bezierCurveTo(42, 22, 20, 36, 0, 36);
  ctx.bezierCurveTo(-20, 36, -42, 22, -38, 0);
  ctx.closePath();
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(50,30,15,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // 壶盖
  ctx.beginPath();
  ctx.ellipse(0, -48, 14, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#7a5638";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -54, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#6b4527";
  ctx.fill();

  // 壶嘴（朝右指向杯口）
  ctx.beginPath();
  ctx.moveTo(36, -10);
  ctx.bezierCurveTo(58, -14, 70, -8, 76, 4);
  ctx.bezierCurveTo(72, 6, 62, 4, 50, 2);
  ctx.bezierCurveTo(46, -4, 40, -8, 36, -10);
  ctx.closePath();
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(50,30,15,0.35)";
  ctx.stroke();

  // 侧提把手
  ctx.beginPath();
  ctx.moveTo(-30, -20);
  ctx.bezierCurveTo(-55, -25, -55, 5, -32, 12);
  ctx.strokeStyle = "#6b4527";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.restore();

  // 壶嘴出水口世界坐标：局部 (76,4)，先镜像缩放 (-S,S)，再旋转 -tilt，再平移
  const mx = -76 * S, my = 4 * S;
  const cos = Math.cos(-tiltAngle), sin = Math.sin(-tiltAngle);
  return {
    x: kettleX + mx * cos - my * sin,
    y: kettleY + mx * sin + my * cos,
  };
}

export const ART = {
  table: drawTable,
  tray: drawTray,
  cupBack: drawCupBack,
  cupFront: drawCupFront,
  kettle: drawKettle,
};

// 兼容旧命名的薄包装（main.js 也可直接用 ART.*）
export const drawBackground = drawTable;
