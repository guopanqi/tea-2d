// label.js — 茶签渲染与浮现动画
// 自适应：按内容量伸缩茶签高度；各列内容强制不越过内边框，超长截断（加"…"）。
import * as audio from "./audio.js";

const LABEL_W = 150;
const MIN_H = 300;
const MAX_H = 420;
const PAD_TOP = 40; // 首字基线距上边
const PAD_BOTTOM = 28;

// 四列排版参数：x 为相对左边的偏移
const COLUMNS = [
  { key: "name", x: 30, font: 22, lineHeight: 28 },
  { key: "colorLine", x: 66, font: 14, lineHeight: 17 },
  { key: "effectText", x: 92, font: 12, lineHeight: 15.5 },
  { key: "note", x: 116, font: 11, lineHeight: 14.5 },
];

export class TeaLabel {
  constructor() {
    this.visible = false;
    this.progress = 0; // 0..1 淡入进度
    this.data = null; // {name, note, effectText, colorName}
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.chimePlayed = false;
    this.height = MIN_H;
    this.columns = [];
  }

  show(data, anchorX, anchorY) {
    this.data = data;
    this.visible = true;
    this.progress = 0;
    this.x = anchorX;
    this.y = anchorY;
    this.rotation = (Math.random() - 0.5) * 0.06;
    this.chimePlayed = false;
    this._layout();
  }

  hide() {
    this.visible = false;
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
    // 需求高度 = 上边距 + 字数×行高 + 下边距，取各列最大，夹在范围内
    let needed = MIN_H;
    for (const col of COLUMNS) {
      const n = texts[col.key].length;
      needed = Math.max(needed, PAD_TOP + n * col.lineHeight + PAD_BOTTOM);
    }
    this.height = Math.min(MAX_H, needed);

    // 每列按最终高度截断（超长补"…"），保证不越过内边框
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
    if (!this.visible) return;
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / 1.5);
      if (this.progress > 0.05 && !this.chimePlayed) {
        audio.playChime();
        this.chimePlayed = true;
      }
    }
  }

  draw(ctx) {
    if (!this.visible || !this.data) return;
    const eased = 1 - Math.pow(1 - this.progress, 3);
    const yOffset = (1 - eased) * 30;
    const alpha = eased;
    const w = LABEL_W, h = this.height;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y - yOffset);
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
