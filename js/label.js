// label.js — 茶签渲染与浮现动画（竖屏版·并排方案）
// 茶泡好后杯子向左让位，茶签从画面右侧淡入飘至杯右侧，二者并排互不遮挡。
// 重新开始冲泡（投新草药/再次注水/再沏一盏）时茶签向右淡出飘走。
// 自适应：按内容量伸缩茶签高度；各列内容强制不越过内边框，超长截断（加"…"）。
import * as audio from "./audio.js";
import { CUP } from "./water.js";

const LABEL_W = 140; // 竖屏 750 宽度有限，签身收窄
const MIN_H = 300;
const MAX_H = 420;
const PAD_TOP = 40; // 首字基线距上边
const PAD_BOTTOM = 28;
const DRIFT_DIST = 240; // 从右侧飘入/飘出的行程（逻辑像素）
const CUP_GAP = 26; // 茶签与杯口边缘的间隙

// 四列排版参数：x 为相对左边的偏移（随签宽 140 微调）
const COLUMNS = [
  { key: "name", x: 28, font: 22, lineHeight: 28 },
  { key: "colorLine", x: 62, font: 14, lineHeight: 17 },
  { key: "effectText", x: 86, font: 12, lineHeight: 15.5 },
  { key: "note", x: 110, font: 11, lineHeight: 14.5 },
];

export class TeaLabel {
  constructor() {
    this.mode = "hidden"; // hidden | entering | shown | exiting
    this.progress = 0; // 0(画面外右侧) .. 1(落定杯右)
    this.data = null; // {name, note, effectText, colorName}
    this.rotation = 0;
    this.chimePlayed = false;
    this.height = MIN_H;
    this.columns = [];
  }

  get visible() {
    return this.mode !== "hidden";
  }

  show(data) {
    this.data = data;
    this.mode = "entering";
    this.progress = 0;
    // 纸签感：轻微旋转 1-2°
    this.rotation = (0.017 + Math.random() * 0.017) * (Math.random() < 0.5 ? -1 : 1);
    this.chimePlayed = false;
    this._layout();
  }

  // 重新开始冲泡 → 茶签向右淡出飘走
  exit() {
    if (this.mode === "shown" || this.mode === "entering") {
      this.mode = "exiting";
    }
  }

  hide() {
    this.mode = "hidden";
    this.progress = 0;
    this.data = null;
  }

  // 计算自适应高度与各列截断后的文本
  _layout() {
    const texts = {
      name: this.data.name || "",
      colorLine: `汤色 · ${this.data.colorName || ""}`,
      effectText: this.data.effectText || "",
      note: this.data.note || "",
    };
    let needed = MIN_H;
    for (const col of COLUMNS) {
      const n = texts[col.key].length;
      needed = Math.max(needed, PAD_TOP + n * col.lineHeight + PAD_BOTTOM);
    }
    this.height = Math.min(MAX_H, needed);

    this.columns = COLUMNS.map((col) => {
      const maxChars = Math.floor((this.height - PAD_TOP - PAD_BOTTOM) / col.lineHeight) + 1;
      let text = texts[col.key];
      if (text.length > maxChars) {
        text = text.slice(0, Math.max(1, maxChars - 1)) + "…";
      }
      return { ...col, text };
    });
  }

  update(dt) {
    if (this.mode === "entering") {
      this.progress = Math.min(1, this.progress + dt / 1.5);
      if (this.progress > 0.05 && !this.chimePlayed) {
        audio.playChime();
        this.chimePlayed = true;
      }
      if (this.progress >= 1) this.mode = "shown";
    } else if (this.mode === "exiting") {
      this.progress = Math.max(0, this.progress - dt / 1.0);
      if (this.progress <= 0) this.hide();
    }
  }

  _position() {
    const eased = 1 - Math.pow(1 - this.progress, 3);
    // 落点：杯口圆右侧留出间隙并排（跟随 CUP.x —— 圆心左移让位时签位同步）
    const targetCx = CUP.x + CUP.r + CUP_GAP + LABEL_W / 2;
    const cx = targetCx + (1 - eased) * DRIFT_DIST;
    const cy = CUP.y;
    return { cx, cy, eased };
  }

  draw(ctx) {
    if (!this.visible || !this.data) return;
    const { cx, cy, eased } = this._position();
    const alpha = eased;
    const w = LABEL_W, h = this.height;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(this.rotation);

    // 纸质背景
    ctx.save();
    ctx.shadowColor = "rgba(60,40,20,0.25)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#f7f1e2";
    roundRect(ctx, -w / 2, -h / 2, w, h, 4);
    ctx.fill();
    ctx.restore();

    // 内边框
    ctx.strokeStyle = "rgba(138,111,77,0.5)";
    ctx.lineWidth = 1;
    roundRect(ctx, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 3);
    ctx.stroke();

    // 各列竖排文字
    ctx.textAlign = "center";
    const colors = {
      name: "#3d4a3e",
      colorLine: "#8a6f4d",
      effectText: "#3d4a3e",
      note: "#6b6152",
    };
    for (const col of this.columns) {
      ctx.font = `${col.font}px 'Kaiti SC', STKaiti, KaiTi, serif`;
      ctx.fillStyle = colors[col.key];
      drawVertical(ctx, col.text, -w / 2 + col.x, -h / 2 + PAD_TOP, col.lineHeight);
    }

    ctx.restore();
  }
}

function drawVertical(ctx, text, x, y, lineHeight) {
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y + i * lineHeight);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
