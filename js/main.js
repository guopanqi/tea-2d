// main.js — 启动、resize、指针事件路由、主循环
//
// 渲染顺序（三明治约定，见 scene.js / water.js 顶部注释）：
//   ART.table → ART.tray → 盘中草药 → ART.cupBack
//   → 杯中草药 → drawCupWater(水体/茶色/水下遮罩) → ART.cupFront
//   → 热气 → 壶+水流 → 拖拽中的草药 → 茶签
import * as scene from "./scene.js";
import { Herb, createTrayHerbs, drawHerb, updateHerb, hitTestHerb, HERB_HIT_RADIUS } from "./herbs.js";
import { WaterSystem, drawCupWater, drawPourStream, CUP } from "./water.js";
import { SteamSystem } from "./steam.js";
import { brew, nameTea } from "./brew.js";
import { TeaLabel } from "./label.js";
import * as audio from "./audio.js";

const LOGICAL_W = scene.LOGICAL_W;
const LOGICAL_H = scene.LOGICAL_H;

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const cursorDot = document.getElementById("cursor-dot");
const muteBtn = document.getElementById("mute-btn");
const resetBtn = document.getElementById("reset-btn");

let scaleFactor = 1;
let offsetX = 0, offsetY = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  scaleFactor = Math.min(vw / LOGICAL_W, vh / LOGICAL_H);
  const cssW = LOGICAL_W * scaleFactor;
  const cssH = LOGICAL_H * scaleFactor;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr * scaleFactor, 0, 0, dpr * scaleFactor, 0, 0);
  offsetX = (vw - cssW) / 2;
  offsetY = (vh - cssH) / 2;
}
window.addEventListener("resize", resize);
resize();

// ---- 状态 ----
const trayHerbs = createTrayHerbs();
const cupHerbs = []; // 已落入水中/正在下落的草药实例
const water = new WaterSystem();
const steam = new SteamSystem();
const label = new TeaLabel();

let kettleX = scene.KETTLE_HOME.x;
let kettleY = scene.KETTLE_HOME.y;
let kettleTargetX = kettleX;
let kettleTargetY = kettleY;
let kettleTilt = 0;
let kettleTargetTilt = 0;
let kettleDragging = false;

let draggingHerb = null;
let dragOffsetX = 0, dragOffsetY = 0;

// 统一拖拽+停驻查看状态机：
// pointerdown 即拈起；按住且指针基本静止 ~400ms（无论何时）→ 介绍淡入；
// 一移动超过阈值 → 介绍淡出，拖拽无缝继续。
const STILL_THRESHOLD = 10; // 逻辑像素：小于此位移视为"停住"
const STILL_DELAY = 0.4; // 秒：静止多久后介绍浮现
let dragPointerX = 0, dragPointerY = 0;
let stillAnchorX = 0, stillAnchorY = 0;
let stillTime = 0;

let steepTimer = 0;
const FULL_STEEP_SECONDS = 22;
const SETTLE_SECONDS = 2.5; // 计时结束后让扩散场自然趋稳，再浮茶签
let steeping = false;
let steepDone = false;
let settleTimer = 0;
let labelShown = false;

let lastTime = performance.now();

// ---- 坐标转换 ----
function toLogical(clientX, clientY) {
  return {
    x: (clientX - offsetX) / scaleFactor,
    y: (clientY - offsetY) / scaleFactor,
  };
}

// ---- 光标 ----
window.addEventListener("pointermove", (e) => {
  cursorDot.style.left = e.clientX + "px";
  cursorDot.style.top = e.clientY + "px";
  cursorDot.classList.add("active");
});
window.addEventListener("pointerleave", () => {
  cursorDot.classList.remove("active");
});

// ---- 音频初始化（首次 pointerdown）----
function ensureAudio() {
  if (!audio.isInited()) {
    audio.initAudio();
  }
}

muteBtn.addEventListener("click", () => {
  ensureAudio();
  const muted = audio.toggleMuted();
  muteBtn.classList.toggle("muted", muted);
});

resetBtn.addEventListener("click", () => {
  if (!resetBtn.classList.contains("visible")) return;
  softReset();
});

// ---- 指针事件 ----
function distTo(x, y, px, py) {
  const dx = x - px, dy = y - py;
  return Math.sqrt(dx * dx + dy * dy);
}

function isNearKettle(x, y) {
  return distTo(x, y, kettleX, kettleY) < 80;
}

canvas.addEventListener("pointerdown", (e) => {
  ensureAudio();
  const { x, y } = toLogical(e.clientX, e.clientY);

  if (isNearKettle(x, y)) {
    kettleDragging = true;
    cursorDot.classList.add("grabbing");
    return;
  }

  const herb = hitTestHerb(trayHerbs, x, y, ["tray", "hover"]);
  if (herb) {
    dragOffsetX = herb.x - x;
    dragOffsetY = herb.y - y;
    dragPointerX = x;
    dragPointerY = y;
    startDrag(herb, x, y); // pointerdown 即拈起
  }
});

window.addEventListener("pointermove", (e) => {
  const { x, y } = toLogical(e.clientX, e.clientY);

  if (kettleDragging) {
    kettleTargetX = x;
    kettleTargetY = y;
    return;
  }

  if (draggingHerb) {
    dragPointerX = x;
    dragPointerY = y;
    draggingHerb.targetX = x + dragOffsetX;
    draggingHerb.targetY = y + dragOffsetY;
  }
});

window.addEventListener("pointerup", (e) => {
  const { x, y } = toLogical(e.clientX, e.clientY);
  cursorDot.classList.remove("grabbing");

  if (kettleDragging) {
    kettleDragging = false;
    kettleTargetX = scene.KETTLE_HOME.x;
    kettleTargetY = scene.KETTLE_HOME.y;
  }

  if (draggingHerb) {
    endDrag(draggingHerb, x, y);
    draggingHerb = null;
  }
});

// 悬停态（非拖拽时）
canvas.addEventListener("pointermove", (e) => {
  if (draggingHerb || kettleDragging) return;
  const { x, y } = toLogical(e.clientX, e.clientY);
  for (const h of trayHerbs) {
    if (h.state === "tray" || h.state === "hover") {
      const isHover = distTo(x, y, h.homeX, h.homeY) < HERB_HIT_RADIUS + 5;
      h.state = isHover ? "hover" : "tray";
    }
  }
});

function startDrag(herb, x, y) {
  // 数量限制：同款最多 3 份在杯中，第4次拈起时轻轻飘回（温柔地不允许）
  const countInPlay = cupHerbs.filter((h) => h.herbId === herb.herbId).length;
  if (countInPlay >= 3) {
    herb.state = "returning";
    herb.age = 0;
    herb.returnStartTime = 0;
    herb.returnFromX = herb.x;
    herb.returnFromY = herb.y - 12;
    return;
  }
  herb.state = "dragging";
  herb.targetX = x + dragOffsetX;
  herb.targetY = y + dragOffsetY;
  herb.inspectAlpha = 0;
  draggingHerb = herb;
  stillAnchorX = x;
  stillAnchorY = y;
  stillTime = 0;
  cursorDot.classList.add("grabbing");
  audio.playPickup();
}

function endDrag(herb, x, y) {
  const overCup =
    Math.abs(x - CUP.x) < CUP.rx + 50 &&
    y > CUP.y - CUP.height - 90 &&
    y < CUP.y + 60;
  herb.inspectAlpha = 0;
  if (overCup) {
    dropHerbIntoCup(herb);
  } else {
    herb.state = "returning";
    herb.age = 0;
    herb.returnStartTime = 0;
    herb.returnFromX = herb.x;
    herb.returnFromY = herb.y;
  }
}

function dropHerbIntoCup(trayHerb) {
  // 创建一个新的“杯中草药”实例，原盘中草药归位（盘中不减少）
  const newHerb = new Herb(trayHerb.herbId, trayHerb.x, trayHerb.y);
  newHerb.x = trayHerb.x;
  newHerb.y = trayHerb.y;
  newHerb.state = "falling";
  newHerb.age = 0;
  newHerb.fallVy = 40;
  newHerb.scale = 1.15;
  // 落点在杯口范围内随机
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * CUP.rx * 0.5;
  newHerb.relX = Math.cos(angle) * r;
  newHerb.relY = Math.sin(angle) * CUP.ry * 0.5;
  newHerb.targetCupY = CUP.y - water.level * CUP.height + newHerb.relY;
  cupHerbs.push(newHerb);
  steepDone = false;
  steeping = false;
  steepTimer = 0;
  settleTimer = 0;
  labelShown = false;
  label.hide();
  resetBtn.classList.remove("visible");

  // 原盘中草药飘回原位
  trayHerb.state = "returning";
  trayHerb.age = 0;
  trayHerb.returnStartTime = 0;
  trayHerb.returnFromX = trayHerb.x;
  trayHerb.returnFromY = trayHerb.y - 4;

  audio.playHerbTick(trayHerb.herbId);
}

// ---- 软重置 ----
let resetting = false;
let resetStep = null;
function softReset() {
  if (resetting) return;
  resetting = true;
  const startLevel = water.level;
  const duration = 1.5;
  let t = 0;
  label.hide();
  resetBtn.classList.remove("visible");

  function step(dt) {
    t += dt;
    const p = Math.min(1, t / duration);
    water.level = startLevel * (1 - p);
    for (const h of cupHerbs) {
      h.opacity = 1 - p;
    }
    if (p >= 1) {
      cupHerbs.length = 0;
      water.reset();
      steam.reset();
      steeping = false;
      steepDone = false;
      steepTimer = 0;
      settleTimer = 0;
      labelShown = false;
      resetting = false;
      return true;
    }
    return false;
  }
  resetStep = step;
}

// ---- 主循环 ----
function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(frame);
}

// 壶的实际绘制位置（含"临近杯口时上提"的防穿模修正）
let kettleDrawX = kettleX, kettleDrawY = kettleY;

function update(dt) {
  if (resetStep) {
    const done = resetStep(dt);
    if (done) resetStep = null;
  }

  // ---- 拖拽停驻检测（统一状态机的核心）----
  if (draggingHerb && draggingHerb.state === "dragging") {
    const moved = distTo(dragPointerX, dragPointerY, stillAnchorX, stillAnchorY);
    if (moved > STILL_THRESHOLD) {
      stillAnchorX = dragPointerX;
      stillAnchorY = dragPointerY;
      stillTime = 0;
    } else {
      stillTime += dt;
    }
    const target = stillTime > STILL_DELAY ? 1 : 0;
    draggingHerb.inspectAlpha += (target - draggingHerb.inspectAlpha) * Math.min(1, dt * 5);
  }

  // ---- 壶跟手弹簧 ----
  kettleX += (kettleTargetX - kettleX) * 0.15;
  kettleY += (kettleTargetY - kettleY) * 0.15;

  // 防穿模：水平方向越靠近杯口，壶被平滑上提，保证壶身低点不插入杯体
  const cupTopY = CUP.y - CUP.height;
  const proximity = Math.max(0, 1 - Math.abs(kettleX - CUP.x) / (CUP.rx + 180));
  const liftedY = Math.min(kettleY, cupTopY - 85);
  kettleDrawX = kettleX;
  kettleDrawY = kettleY + (liftedY - kettleY) * proximity;

  // ---- 倾角：由壶（绘制位置）与杯口的相对位置连续决定 ----
  let desiredTilt = 0;
  if (kettleDragging) {
    const overCupAmount = Math.max(0, 1 - Math.abs(CUP.x - kettleDrawX) / 300);
    // 用户把指针压得越低（原始 kettleY 越深入杯区），倾角越大
    const pressDown = Math.max(0, (kettleY - (cupTopY - 200)) / 260);
    desiredTilt = Math.min(1.15, overCupAmount * (0.3 + pressDown * 1.0));
  }
  kettleTargetTilt = desiredTilt;
  kettleTilt += (kettleTargetTilt - kettleTilt) * 0.12;

  // ---- 是否出水：倾角超过阈值 ----
  const tiltThreshold = 0.28;
  const pouringNow = kettleDragging && kettleTilt > tiltThreshold && water.level < 0.85;
  if (pouringNow && !water.pouring) {
    water.startPour();
  } else if (!pouringNow && water.pouring) {
    water.stopPour();
  }
  if (pouringNow) {
    const strength = Math.min(1, (kettleTilt - tiltThreshold) / (1.1 - tiltThreshold));
    water.flowStrength = strength;
    water.flowThickness = 2.5 + strength * 8;
  } else {
    water.flowThickness *= 0.85;
  }

  // ---- 草药更新 ----
  for (const h of trayHerbs) updateHerb(h, dt);

  const herbsInWaterForDiffuse = [];
  for (const h of cupHerbs) {
    if (h.state === "falling") {
      const groundY = CUP.y - water.level * CUP.height * 0.3 - 10;
      if (h.y >= h.targetCupY - 4 || h.y >= groundY) {
        h.state = "inwater";
        h.y = h.targetCupY;
        audio.playSplash();
        water.addSplash(h.relX, 0);
      }
    } else if (h.state === "inwater") {
      // 水中摆动（水平方向轻微漂）
      h.x = CUP.x + h.relX + Math.sin(h.wobblePhase) * 4;
      const topY = CUP.y - water.level * CUP.height;
      h.y = topY + CUP.ry * 0.3 + h.floatY * (water.level * CUP.height * 0.7);
    }
    updateHerb(h, dt);
    if (h.state === "inwater" && water.level > 0.05) {
      herbsInWaterForDiffuse.push({ relX: (h.x - CUP.x + CUP.rx) / (CUP.rx * 2), relY: 0.5 });
    }
  }

  water._displayColor = brewColorForCurrentState();
  water.update(dt, herbsInWaterForDiffuse);

  // 注水时水流冲击已有草药：轻微扰动
  if (pouringNow) {
    for (const h of cupHerbs) {
      if (h.state === "inwater") {
        h.wobblePhase += dt * 3;
        h.floatY += (Math.random() - 0.5) * 0.01;
      }
    }
    if (Math.random() < 0.3) {
      water.addRipple((Math.random() - 0.5) * 60, 0);
    }
  }

  // ---- 热气 ----
  steam.setActive(water.level > 0.08);
  const steamOriginX = CUP.x;
  const steamOriginY = CUP.y - water.level * CUP.height - 8;
  steam.update(dt, steamOriginX, steamOriginY);

  // ---- 候：浸泡计时 ----
  const hasHerbsInWater = cupHerbs.some((h) => h.state === "inwater");
  if (!kettleDragging && !water.pouring && hasHerbsInWater && water.level > 0.1 && !steepDone) {
    steeping = true;
  }
  if (steeping && !water.pouring && !kettleDragging && !steepDone) {
    steepTimer += dt;
    if (steepTimer >= FULL_STEEP_SECONDS) {
      steepDone = true;
      settleTimer = 0;
    }
  }
  // 计时结束后：扩散场继续自然趋稳 SETTLE_SECONDS，再浮茶签
  if (steepDone && !labelShown) {
    settleTimer += dt;
    if (settleTimer >= SETTLE_SECONDS) {
      labelShown = true;
      finishSteep();
    }
  }

  label.update(dt);
}

function brewColorForCurrentState() {
  const herbIds = cupHerbs
    .filter((h) => h.state === "inwater" || h.state === "falling")
    .map((h) => h.herbId);
  const result = brew({
    herbIds,
    waterLevel: water.level,
    steepSeconds: steepTimer,
    fullSteepSeconds: FULL_STEEP_SECONDS,
  });
  return result.color;
}

function finishSteep() {
  const herbIds = cupHerbs.map((h) => h.herbId);
  const data = nameTea(herbIds);
  label.show(data, CUP.x + CUP.rx + 140, CUP.y - CUP.height * 0.5);
  setTimeout(() => {
    resetBtn.classList.add("visible");
  }, 1600);
}

function render() {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
  scene.ART.table(ctx);
  scene.ART.tray(ctx);

  // 盘中草药
  for (const h of trayHerbs) {
    if (h !== draggingHerb) drawHerb(ctx, h);
  }

  // ---- 杯子三明治 ----
  scene.ART.cupBack(ctx);
  for (const h of cupHerbs) {
    if (h.state === "inwater" || h.state === "falling") {
      drawHerb(ctx, h);
    }
  }
  drawCupWater(ctx, water); // 含水下遮罩：盖在水位以下的草药之上
  scene.ART.cupFront(ctx);

  steam.draw(ctx);

  // 壶（含出水流）
  const spoutPos = scene.ART.kettle(ctx, kettleDrawX, kettleDrawY, kettleTilt);
  if (water.pouring) {
    const targetY = CUP.y - water.level * CUP.height;
    drawPourStream(ctx, spoutPos.x, spoutPos.y, CUP.x, targetY, water.flowThickness);
  }

  // 正在拖拽的草药画在最上层
  if (draggingHerb) drawHerb(ctx, draggingHerb);

  label.draw(ctx);
}

requestAnimationFrame(frame);

