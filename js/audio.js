// audio.js — WebAudio 全合成音效集合，无音频文件
// 首次 pointerdown 时由 main.js 调用 initAudio()

let ctx = null;
let masterGain = null;
let muted = false;
let ambientNodes = null;

function now() {
  return ctx ? ctx.currentTime : 0;
}

export function isInited() {
  return !!ctx;
}

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(ctx.destination);
  startAmbient();
}

export function setMuted(m) {
  muted = m;
  if (masterGain) {
    masterGain.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.15);
  }
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

// 生成一段噪声 buffer（白噪声），可复用
function makeNoiseBuffer(seconds = 2) {
  const bufferSize = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// 粉红噪声近似（简单滤波级联）
function makePinkNoiseBuffer(seconds = 4) {
  const bufferSize = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
  }
  return buffer;
}

let noiseBufferCache = null;
let pinkBufferCache = null;

function getNoiseBuffer() {
  if (!noiseBufferCache) noiseBufferCache = makeNoiseBuffer(2);
  return noiseBufferCache;
}

function getPinkBuffer() {
  if (!pinkBufferCache) pinkBufferCache = makePinkNoiseBuffer(4);
  return pinkBufferCache;
}

// ---- 环境底噪：极轻粉红噪声 + 缓慢音量呼吸 ----
function startAmbient() {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = getPinkBuffer();
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1200;

  const gain = ctx.createGain();
  const baseDb = -36;
  const baseLinear = Math.pow(10, baseDb / 20);
  gain.gain.value = baseLinear;

  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start();

  // 缓慢呼吸（LFO 调制音量）
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = baseLinear * 0.4;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  lfo.start();

  ambientNodes = { src, filter, gain, lfo };
}

// ---- 拈起草药：极短高频轻擦 ----
export function playPickup() {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 6000 + Math.random() * 1500;
  filter.Q.value = 2;
  const gain = ctx.createGain();
  const t = now();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.18, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(t);
  src.stop(t + 0.08);
}

// ---- 干茶落盘/落杯底：短促低通噪声 tick，各味中心频率不同 ----
const HERB_TICK_FREQ = {
  chrysanthemum: 2200,
  goji: 900,
  mint: 1600,
  rose: 1400,
  licorice: 1100,
};

export function playHerbTick(herbId) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = HERB_TICK_FREQ[herbId] || 1200;
  filter.Q.value = 1.2;
  const gain = ctx.createGain();
  const t = now();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.linearRampToValueAtTime(0.15, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(t);
  src.stop(t + 0.07);
}

// ---- 落水"扑通"：正弦短音 400Hz -> 150Hz (20ms) + 噪声尾 ----
export function playSplash() {
  if (!ctx) return;
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.02);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.35, t);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  osc.connect(oscGain);
  oscGain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.18);

  // 噪声尾
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(t + 0.005);
  src.stop(t + 0.25);
}

// ---- 涟漪/搅动：低频正弦轻微颤动一下 ----
export function playRipple() {
  if (!ctx) return;
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(90 + Math.random() * 20, t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.linearRampToValueAtTime(0.06, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.32);
}

// ---- 注水：持续白噪声过 band-pass，音调随水位 ----
let pourNode = null;

export function startPour() {
  if (!ctx || pourNode) return;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 400;
  filter.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start();
  pourNode = { src, filter, gain };
}

// waterLevelRatio: 0..1（水位占杯高比例）, flowStrength: 0..1（水流粗细/强度）
export function updatePour(waterLevelRatio, flowStrength) {
  if (!ctx || !pourNode) return;
  const t = now();
  const freq = 400 + waterLevelRatio * 500; // 400 -> 900Hz
  pourNode.filter.frequency.setTargetAtTime(freq, t, 0.08);
  const q = waterLevelRatio > 0.8 ? 4 + (waterLevelRatio - 0.8) * 20 : 0.8;
  pourNode.filter.Q.setTargetAtTime(q, t, 0.1);
  const targetGain = Math.max(0, Math.min(1, flowStrength)) * 0.22;
  pourNode.gain.gain.setTargetAtTime(targetGain, t, 0.05);
}

export function stopPour() {
  if (!ctx || !pourNode) return;
  const t = now();
  pourNode.gain.gain.setTargetAtTime(0.0001, t, 0.12);
  const node = pourNode;
  pourNode = null;
  setTimeout(() => {
    try {
      node.src.stop();
    } catch (e) {}
  }, 500);
}

// ---- 茶签浮现：单音三角波，轻风铃 ----
export function playChime() {
  if (!ctx) return;
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1318.5, t); // E6
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 1.7);
}

// ---- 搅拌：轻柔瓷匙划水声（低通噪声 + 轻微周期起伏）----
let stirNode = null;

export function startStir() {
  if (!ctx || stirNode) return;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 650;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  // 周期起伏（划圈的节奏感）
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 1.6;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  lfo.start();
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start();
  stirNode = { src, filter, gain, lfo };
}

export function updateStir(strength) {
  if (!ctx || !stirNode) return;
  const t = now();
  stirNode.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, strength)) * 0.09, t, 0.08);
  stirNode.filter.frequency.setTargetAtTime(500 + strength * 400, t, 0.1);
}

export function stopStir() {
  if (!ctx || !stirNode) return;
  const t = now();
  stirNode.gain.gain.setTargetAtTime(0.0001, t, 0.15);
  const node = stirNode;
  stirNode = null;
  setTimeout(() => {
    try { node.src.stop(); node.lfo.stop(); } catch (e) {}
  }, 600);
}
