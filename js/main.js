// main.js — 启动、resize、指针事件路由、主循环
//
// 渲染顺序（正俯视分层，见 scene.js / water.js 顶部注释）：
//   ART.table → ART.tray → 盘中草药 → ART.cupBack(杯环+空杯底)
//   → drawCupWater(水色圆+茶色扩散) → 杯中漂浮草药 → drawCupSurfaceFx(涟漪/水珠)
//   → 水面微光(steam) → ART.cupFront(高光弧) → 壶+注水滴 → 拖拽中的草药 → 茶签 → ART.grain
import * as scene from "./scene.js";
import { Herb, createTrayHerbs, drawHerb, updateHerb, hitTestHerb, HERB_HIT_RADIUS } from "./herbs.js";
import { WaterSystem, drawCupWater, drawCupSurfaceFx, drawPourStream, vortexEyeR, CUP, cupInnerR } from "./water.js";
import { SteamSystem } from "./steam.js";
import { brew, nameTea, HERBS, HERB_ORDER, RECIPE_BOOK, analyzeFormula } from "./brew.js";
import { TeaLabel } from "./label.js";
import * as audio from "./audio.js";

const LOGICAL_W = scene.LOGICAL_W;
const LOGICAL_H = scene.LOGICAL_H;

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const cursorDot = document.getElementById("cursor-dot");
const muteBtn = document.getElementById("mute-btn");
const resetBtn = document.getElementById("reset-btn");
const cabinetBtn = document.getElementById("cabinet-btn");
const cabinet = document.getElementById("herb-cabinet");
const cabinetClose = document.getElementById("cabinet-close");
const cabinetScrim = document.getElementById("cabinet-scrim");
const cabinetGrid = document.getElementById("cabinet-grid");
const recipeList = document.getElementById("recipe-list");
const formulaHud = document.getElementById("formula-hud");
const formulaSummary = document.getElementById("formula-summary");
const formulaChips = document.getElementById("formula-chips");
const formulaMessage = document.getElementById("formula-message");
const undoHerbBtn = document.getElementById("undo-herb");

let scaleFactor = 1;
let offsetX = 0, offsetY = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!vw || !vh) return; // 隐藏/未布局时跳过，避免 0 尺寸产生 NaN
  // fitScale 按 CSS 尺寸对逻辑画布 750×1300 计算
  scaleFactor = Math.min(vw / LOGICAL_W, vh / LOGICAL_H);
  const cssW = LOGICAL_W * scaleFactor;
  const cssH = LOGICAL_H * scaleFactor;
  offsetX = (vw - cssW) / 2;
  offsetY = (vh - cssH) / 2;
  // canvas 铺满整个视口；backing store = CSS 尺寸 × dpr；
  // 绘制变换一次性带上 fitScale×dpr 与居中偏移 ×dpr（Retina/手机 dpr=2 时内容才能铺满）。
  canvas.style.width = vw + "px";
  canvas.style.height = vh + "px";
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  ctx.setTransform(scaleFactor * dpr, 0, 0, scaleFactor * dpr, offsetX * dpr, offsetY * dpr);
}
window.addEventListener("resize", resize);
resize();

// dpr 变化（外接屏拖动/浏览器缩放）时重建 backing store：
// matchMedia(resolution) 监听 + 每次 resize 重读 dpr 双保险
let dprQuery = null;
function watchDpr() {
  if (dprQuery) dprQuery.removeEventListener("change", onDprChange);
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  dprQuery.addEventListener("change", onDprChange);
}
function onDprChange() {
  resize();
  watchDpr();
}
watchDpr();

// ---- 状态 ----
let selectedTrayIds = HERB_ORDER.slice(0, 5);
let trayHerbs = createTrayHerbs(selectedTrayIds);
const cupHerbs = []; // 已落入水中/正在下落的草药实例
const water = new WaterSystem();
const steam = new SteamSystem();
const label = new TeaLabel();

let kettleX = scene.KETTLE_HOME.x;
let kettleY = scene.KETTLE_HOME.y;
let kettleTargetX = kettleX;
let kettleTargetY = kettleY;
let kettleLean = 0; // 注水时的轻微倾侧（俯视示意）
let kettleDragging = false;
let pourHold = 0; // 壶在杯上方按住的时长（控制水流由细到稳）

// 茶匙（茶具角，可拈起入杯画圈搅拌）
let spoonX = scene.SPOON_HOME.x;
let spoonY = scene.SPOON_HOME.y;
let spoonTargetX = spoonX;
let spoonTargetY = spoonY;
let spoonRot = scene.SPOON_HOME.rot;
let spoonDragging = false;
let prevSpoonHeading = null; // 匙头速度方向（画圈检测：转向速度，与位置无关）
let prevSpoonX = null, prevSpoonY = null; // 匙头线速度检测（尾迹/涡脱落）
let stirStrength = 0; // 0..1 平滑后的搅拌强度
let stirSoundOn = false;

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

// 出签时杯子向左让位（缓动 ≥1s），茶签落在右侧并排
const CUP_HOME_X = CUP.x;
const CUP_SHIFT = 95;
let cupShift = 0;

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

// 触屏兜底：某些浏览器 touchstart 早于 pointerdown 分发
document.addEventListener("touchstart", ensureAudio, { passive: true });

muteBtn.addEventListener("click", () => {
  ensureAudio();
  const muted = audio.toggleMuted();
  muteBtn.classList.toggle("muted", muted);
});

resetBtn.addEventListener("click", () => {
  if (!resetBtn.classList.contains("visible")) return;
  softReset();
});

function setCabinetOpen(open) {
  cabinet.classList.toggle("open", open);
  cabinetScrim.classList.toggle("open", open);
  cabinet.setAttribute("aria-hidden", String(!open));
  cabinetBtn.setAttribute("aria-expanded", String(open));
}

cabinetBtn.addEventListener("click", () => setCabinetOpen(true));
cabinetClose.addEventListener("click", () => setCabinetOpen(false));
cabinetScrim.addEventListener("click", () => setCabinetOpen(false));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setCabinetOpen(false);
});

function rebuildTray() {
  trayHerbs = createTrayHerbs(selectedTrayIds);
  renderCabinet();
}

function chooseHerbForTray(id) {
  if (draggingHerb) return;
  const index = selectedTrayIds.indexOf(id);
  if (index >= 0) {
    if (selectedTrayIds.length > 1) selectedTrayIds.splice(index, 1);
  } else if (selectedTrayIds.length < 5) {
    selectedTrayIds.push(id);
  } else {
    selectedTrayIds.shift();
    selectedTrayIds.push(id);
  }
  rebuildTray();
}

function renderCabinet() {
  cabinetGrid.innerHTML = "";
  for (const id of HERB_ORDER) {
    const herb = HERBS[id];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cabinet-herb${selectedTrayIds.includes(id) ? " selected" : ""}`;
    button.title = herb.caution;
    button.innerHTML = `<strong>${herb.name}</strong><span>${herb.nature} · 每份约${herb.portionG}g</span><span>${herb.effect}</span><em>${selectedTrayIds.includes(id) ? "在盘" : "入盘"}</em>`;
    button.addEventListener("click", () => chooseHerbForTray(id));
    cabinetGrid.appendChild(button);
  }
}

function renderRecipes() {
  recipeList.innerHTML = "";
  for (const recipe of RECIPE_BOOK) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recipe-card";
    const ingredients = Object.entries(recipe.counts).map(([id, n]) => `${HERBS[id].name}×${n}`).join(" · ");
    button.innerHTML = `<strong>${recipe.name}</strong><span>${ingredients}</span><small>${recipe.note}</small>`;
    button.addEventListener("click", () => {
      selectedTrayIds = Object.keys(recipe.counts);
      rebuildTray();
    });
    recipeList.appendChild(button);
  }
}

function updateFormulaHud() {
  const ids = cupHerbs.map((h) => h.herbId);
  const analysis = analyzeFormula(ids, 400);
  formulaHud.classList.toggle("caution", analysis.level === "caution");
  formulaSummary.textContent = analysis.entries.length
    ? `${analysis.natureLabel} · ${analysis.totalG.toFixed(1)}g / 400ml`
    : "杯中尚清 · 400ml";
  formulaChips.innerHTML = analysis.entries.map((h) => `<span class="formula-chip">${h.name} × ${h.count}</span>`).join("");
  formulaMessage.textContent = analysis.entries.length
    ? `${analysis.theory} ${analysis.messages.join(" ")}`
    : analysis.messages[0];
  undoHerbBtn.classList.toggle("visible", cupHerbs.length > 0);
}

undoHerbBtn.addEventListener("click", () => {
  const herb = cupHerbs.pop();
  if (!herb) return;
  steepDone = false;
  steeping = false;
  steepTimer = 0;
  settleTimer = 0;
  labelShown = false;
  label.exit();
  resetBtn.classList.remove("visible");
  updateFormulaHud();
});

renderCabinet();
renderRecipes();
updateFormulaHud();

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

  if (distTo(x, y, spoonX, spoonY) < 55) {
    spoonDragging = true;
    prevSpoonHeading = null;
    prevSpoonX = null;
    prevSpoonY = null;
    cursorDot.classList.add("grabbing");
    audio.playPickup();
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

  if (spoonDragging) {
    spoonTargetX = x;
    spoonTargetY = y;
    return;
  }

  if (draggingHerb) {
    dragPointerX = x;
    dragPointerY = y;
    draggingHerb.targetX = x + dragOffsetX;
    draggingHerb.targetY = y + dragOffsetY;
  }
});

function handlePointerEnd(e) {
  const { x, y } = toLogical(e.clientX, e.clientY);
  cursorDot.classList.remove("grabbing");
  // 触屏抬手后自绘光标不应残留；鼠标保持跟随
  if (e.pointerType !== "mouse") {
    cursorDot.classList.remove("active");
  }

  if (kettleDragging) {
    kettleDragging = false;
    kettleTargetX = scene.KETTLE_HOME.x;
    kettleTargetY = scene.KETTLE_HOME.y;
  }

  if (spoonDragging) {
    spoonDragging = false;
    spoonTargetX = scene.SPOON_HOME.x;
    spoonTargetY = scene.SPOON_HOME.y;
    prevSpoonHeading = null;
    prevSpoonX = null;
    prevSpoonY = null;
  }

  if (draggingHerb) {
    endDrag(draggingHerb, x, y);
    draggingHerb = null;
  }
}
window.addEventListener("pointerup", handlePointerEnd);
window.addEventListener("pointercancel", handlePointerEnd);

// 悬停态（非拖拽时）
canvas.addEventListener("pointermove", (e) => {
  if (draggingHerb || kettleDragging || spoonDragging) return;
  const { x, y } = toLogical(e.clientX, e.clientY);
  for (const h of trayHerbs) {
    if (h.state === "tray" || h.state === "hover") {
      const isHover = distTo(x, y, h.homeX, h.homeY) < HERB_HIT_RADIUS + 5;
      h.state = isHover ? "hover" : "tray";
    }
  }
});

function startDrag(herb, x, y) {
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
  const overCup = distTo(x, y, CUP.x, CUP.y) < CUP.r + 40;
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
  newHerb.fallT = 0;
  newHerb.fallFromX = trayHerb.x;
  newHerb.fallFromY = trayHerb.y;
  newHerb.scale = 1.15;
  // 落点在杯内圆里随机（偏内侧）
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * cupInnerR() * 0.55;
  newHerb.targetCupX = CUP.x + Math.cos(angle) * r;
  newHerb.targetCupY = CUP.y + Math.sin(angle) * r;
  cupHerbs.push(newHerb);
  steepDone = false;
  steeping = false;
  steepTimer = 0;
  settleTimer = 0;
  labelShown = false;
  label.exit(); // 重新开始冲泡：茶签向右淡出，杯子随之回中
  resetBtn.classList.remove("visible");

  // 原盘中草药飘回原位
  trayHerb.state = "returning";
  trayHerb.age = 0;
  trayHerb.returnStartTime = 0;
  trayHerb.returnFromX = trayHerb.x;
  trayHerb.returnFromY = trayHerb.y - 4;

  audio.playHerbTick(trayHerb.herbId);
  updateFormulaHud();
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
  label.exit();
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
      updateFormulaHud();
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

  // ---- 杯子让位缓动（出签时圆心左移，签退场时回中）----
  const shiftTarget = (label.mode === "entering" || label.mode === "shown") ? CUP_SHIFT : 0;
  const prevCupX = CUP.x;
  cupShift += (shiftTarget - cupShift) * Math.min(1, dt * 2.2); // ~1.4s 到位
  CUP.x = CUP_HOME_X - cupShift;
  // 杯中草药随圆心平移（漂移速度极慢，跟不上让位动画）
  const cupDx = CUP.x - prevCupX;
  if (cupDx !== 0) {
    for (const h of cupHerbs) {
      h.x += cupDx;
      h.targetCupX += cupDx;
    }
  }

  // ---- 壶跟手弹簧 ----
  kettleX += (kettleTargetX - kettleX) * 0.15;
  kettleY += (kettleTargetY - kettleY) * 0.15;

  // ---- 出水：俯视下"壶到位即出水"，按住时长控制水量 ----
  const spoutOverCup = kettleDragging && distTo(kettleX, kettleY, CUP.x, CUP.y) < CUP.r + 50;
  if (spoutOverCup) pourHold += dt;
  else pourHold = 0;
  const pouringNow = spoutOverCup && water.level < 0.85;
  // 注水时壶轻微倾侧示意
  const leanTarget = pouringNow ? -0.18 : 0;
  kettleLean += (leanTarget - kettleLean) * 0.1;
  if (pouringNow && !water.pouring) {
    water.startPour();
    // 出签后再次注水 = 浸泡重新开始：茶签退场，计时清零
    if (steepDone) {
      steepDone = false;
      labelShown = false;
      steepTimer = 0;
      settleTimer = 0;
      label.exit();
      resetBtn.classList.remove("visible");
    }
  } else if (!pouringNow && water.pouring) {
    water.stopPour();
  }
  if (pouringNow) {
    const strength = Math.min(1, pourHold / 0.6); // 水流由细到稳
    water.flowStrength = strength;
    water.flowThickness = 3 + strength * 8;
  } else {
    water.flowThickness *= 0.85;
  }

  // ---- 茶匙：跟手弹簧 + 画圈搅拌 ----
  spoonX += (spoonTargetX - spoonX) * 0.16;
  spoonY += (spoonTargetY - spoonY) * 0.16;
  // 匙柄朝向：拖动时顺运动方向微转，归位时回到斜放角
  const spoonRotTarget = spoonDragging
    ? Math.max(-1.1, Math.min(0.2, (spoonTargetX - spoonX) * 0.02 - 0.5))
    : scene.SPOON_HOME.rot;
  spoonRot += (spoonRotTarget - spoonRot) * 0.1;

  let stirTarget = 0;
  const spoonInCup = distTo(spoonX, spoonY, CUP.x, CUP.y) < cupInnerR();
  if (spoonDragging && spoonInCup && water.level > 0.05) {
    if (prevSpoonX !== null) {
      const vx = spoonX - prevSpoonX;
      const vy = spoonY - prevSpoonY;
      const speed = Math.hypot(vx, vy) / Math.max(dt, 1e-4);
      // 画圈检测：看匙头自身轨迹的转向速度——在杯里任何位置画圈都算，
      // 不必绕杯心，小圈快画同样能把水带起来
      if (speed > 40) {
        const heading = Math.atan2(vy, vx);
        if (prevSpoonHeading !== null) {
          let dAng = heading - prevSpoonHeading;
          if (dAng > Math.PI) dAng -= Math.PI * 2;
          if (dAng < -Math.PI) dAng += Math.PI * 2;
          // 急折返（来回直线抖动）不算画圈
          if (Math.abs(dAng) < 1.2) {
            const omega = dAng / Math.max(dt, 1e-4); // 轨迹转向角速度 rad/s
            stirTarget = Math.max(-1, Math.min(1, omega / 8));
            const swirlTarget = Math.max(-5.2, Math.min(5.2, omega * 0.5));
            // 持续画圈才逐渐把整杯水带起来：动量慢慢累积（~1-2s 起涡）
            water.swirl += (swirlTarget - water.swirl) * Math.min(1, dt * 1.0);
            if (Math.abs(dAng) > 0.04) {
              // 圈的圆心在速度法线方向上，距离 = 位移/转角——涡就起在打圈处
              const ccx = spoonX - vy / dAng;
              const ccy = spoonY + vx / dAng;
              water.stirCenter(ccx - CUP.x, ccy - CUP.y);
            }
          }
        }
        prevSpoonHeading = heading;
      }
      // 匙头划水：尾迹 + 涡脱落（连续剪切的语言，不用同心圆涟漪）
      water.stirAt(spoonX - CUP.x, spoonY - CUP.y, dt, speed);
    }
    prevSpoonX = spoonX;
    prevSpoonY = spoonY;
  } else {
    prevSpoonHeading = null;
    prevSpoonX = null;
    prevSpoonY = null;
  }
  stirStrength += (Math.abs(stirTarget) - stirStrength) * Math.min(1, dt * 4);
  // 停手后整杯水仍在凭惯性旋转，高光和水声也应逐渐平息，而不是立即消失。
  const residualMotion = Math.min(0.72, Math.abs(water.swirl) / 5);
  const surfaceMotion = Math.max(stirStrength, residualMotion);
  water.stirLevel = surfaceMotion;

  // 搅拌音效
  if (surfaceMotion > 0.08 && !stirSoundOn) {
    audio.startStir();
    stirSoundOn = true;
  } else if (surfaceMotion < 0.04 && stirSoundOn) {
    audio.stopStir();
    stirSoundOn = false;
  }
  if (stirSoundOn) audio.updateStir(surfaceMotion);

  // 杯中草药被切向速度场带动绕圈（内快外慢；随 swirl 衰减慢慢回到慢漂移）
  // 主涡成形后各自进入不同轨道：有的靠内、有的靠外，不会挤成中心一团。
  if (Math.abs(water.swirl) > 0.02) {
    const R = Math.max(1, water.fillRadius());
    const v = water.vortex;
    const vcx = CUP.x + water.vortexX; // 涡心：在哪儿打圈就绕哪儿
    const vcy = CUP.y + water.vortexY;
    for (const h of cupHerbs) {
      if (h.state !== "inwater") continue;
      const dx = h.x - vcx, dy = h.y - vcy;
      const r = Math.hypot(dx, dy) || 1;
      // Rankine 涡：核内近似刚转，核外切速随距离衰减
      // ——远处草药不会被甩去贴杯壁，而是慢慢卷入
      const core = R * 0.45;
      const falloff = r < core ? 1 : core / r;
      const theta = water.swirl * dt * 0.85 * falloff * (1 + 0.5 * v);
      const cos = Math.cos(theta), sin = Math.sin(theta);
      let nx = dx * cos - dy * sin;
      let ny = dx * sin + dy * cos;
      if (v > 0.05) {
        const minR = vortexEyeR(water) + 20; // 眼缘外留位，别叠进涡眼
        const floatShift = h.def.floats === true ? 0.05 : h.def.floats === "half" ? 0 : -0.035;
        const orbitRatio = Math.max(0.26, Math.min(0.72, h.vortexOrbit + floatShift));
        const orbitR = Math.max(minR, Math.min(R - 16, R * orbitRatio));
        const settle = Math.min(1, v * dt * (0.7 + v * 0.9));
        const nextR = r + (orbitR - r) * settle;
        nx *= nextR / r;
        ny *= nextR / r;
      }
      h.x = vcx + nx;
      h.y = vcy + ny;
      // 绕偏心涡旋转可能被甩出水面圆，收回水缘内
      const cdx = h.x - CUP.x, cdy = h.y - CUP.y;
      const cd = Math.hypot(cdx, cdy);
      const maxR = R - 12;
      if (cd > maxR) {
        h.x = CUP.x + (cdx / cd) * maxR;
        h.y = CUP.y + (cdy / cd) * maxR;
      }
      h.rotation += theta * 0.6;
    }
  }

  // ---- 草药更新 ----
  for (const h of trayHerbs) updateHerb(h, dt);

  const herbsInWaterForDiffuse = [];
  for (const h of cupHerbs) {
    updateHerb(h, dt);
    if (h.state === "falling" && h.fallT >= 1) {
      h.state = "inwater";
      audio.playSplash();
      water.addSplash(h.x - CUP.x, h.y - CUP.y);
      if (navigator.vibrate) navigator.vibrate(15); // 不支持则静默跳过
    }
    if (h.state === "inwater") {
      h.driftEnabled = water.level > 0.05; // 有水才漂
      if (water.level > 0.1) {
        herbsInWaterForDiffuse.push({ relX: h.x - CUP.x, relY: h.y - CUP.y });
      }
    }
  }

  const displayColor = brewColorForCurrentState();
  // 水越满汤色越深越饱和（俯视的深度线索）
  displayColor.l = Math.max(36, displayColor.l - water.level * 12);
  displayColor.s = Math.min(90, displayColor.s + water.level * 10);
  water._displayColor = displayColor;
  water.update(dt, herbsInWaterForDiffuse);

  // 注水时水流冲击已有草药：漂移被搅快一点 + 落点涟漪
  if (pouringNow) {
    for (const h of cupHerbs) {
      if (h.state === "inwater") {
        h.driftAngle += (Math.random() - 0.5) * dt * 6;
      }
    }
    if (Math.random() < 0.25) {
      const land = pourLandingPoint();
      water.addRipple(land.x - CUP.x, land.y - CUP.y);
    }
  }

  // ---- 水面微光/雾纹（俯视下的"热气"）----
  steam.setActive(water.level > 0.08);
  steam.update(dt, CUP.x, CUP.y);

  // ---- 候：浸泡计时 ----
  const hasHerbsInWater = cupHerbs.some((h) => h.state === "inwater");
  if (!kettleDragging && !water.pouring && hasHerbsInWater && water.level > 0.1 && !steepDone) {
    steeping = true;
  }
  if (steeping && !water.pouring && !kettleDragging && !steepDone) {
    steepTimer += dt * (1 + stirStrength * 2); // 搅拌时最高 3 倍速浸泡
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

// 注水落点：壶所在方向朝杯心投影，落在杯内圆靠内的一点
function pourLandingPoint() {
  const dx = kettleX - CUP.x, dy = kettleY - CUP.y;
  const len = Math.hypot(dx, dy) || 1;
  const r = Math.min(len, cupInnerR() * 0.45);
  return { x: CUP.x + (dx / len) * r, y: CUP.y + (dy / len) * r };
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
  label.show(data); // 从杯后方升起，位置由 label.js 基于 CUP 计算
  setTimeout(() => {
    resetBtn.classList.add("visible");
  }, 1600);
}

function render() {
  // 清整个 backing store（canvas 铺满视口，留边区域也要清，避免拖拽出界留下残影）
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  scene.ART.table(ctx);
  scene.ART.tray(ctx);

  // 盘中草药
  for (const h of trayHerbs) {
    if (h !== draggingHerb) drawHerb(ctx, h);
  }

  // ---- 杯口圆分层（俯视）----
  scene.ART.cupBack(ctx); // 外沿环 + 空杯底
  drawCupWater(ctx, water); // 水色圆 + 茶色扩散
  for (const h of cupHerbs) {
    if (h.state === "inwater" || h.state === "falling") {
      drawHerb(ctx, h); // 漂在水面上
    }
  }
  drawCupSurfaceFx(ctx, water); // 涟漪/水珠（水面在草药之上）
  steam.draw(ctx); // 水面微光/雾纹
  scene.ART.cupFront(ctx, water.stirLevel, water.noiseTime); // 内沿细高光弧（搅拌时轻微颤动）

  // 壶（含注水滴）与茶匙（茶具角）
  const spoutPos = scene.ART.kettle(ctx, kettleX, kettleY, kettleLean);
  if (water.pouring) {
    const land = pourLandingPoint();
    drawPourStream(ctx, spoutPos.x, spoutPos.y, land.x, land.y, water.flowThickness);
  }
  scene.ART.spoon(ctx, spoonX, spoonY, spoonRot);

  // 正在拖拽的草药画在最上层
  if (draggingHerb) drawHerb(ctx, draggingHerb);

  label.draw(ctx); // 茶签与杯并排

  scene.ART.grain(ctx); // 纸纹颗粒层收尾
}

requestAnimationFrame(frame);
