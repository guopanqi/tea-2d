// steam.js — 正俯视下的"热气"：水面微光 + 一缕缓慢飘过的半透明雾纹
// 接口与旧版一致（reset/setActive/update(dt, cx, cy)/draw），main.js 无需改动调用方式。
import { cupInnerR } from "./water.js";

export class SteamSystem {
  constructor() {
    this.wisps = []; // 雾纹/微光斑 {x, y (相对圆心), r, phase, speed, dir, life, maxLife, kind}
    this.spawnTimer = 0;
    this.active = false;
    this.cx = 0;
    this.cy = 0;
  }

  reset() {
    this.wisps = [];
    this.spawnTimer = 0;
    this.active = false;
  }

  setActive(active) {
    this.active = active;
  }

  update(dt, originX, originY) {
    this.cx = originX;
    this.cy = originY;
    const R = cupInnerR();

    if (this.active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.wisps.length < 3) {
        this.spawnTimer = 2.5 + Math.random() * 2;
        const a = Math.random() * Math.PI * 2;
        this.wisps.push({
          x: Math.cos(a) * R * 0.5,
          y: Math.sin(a) * R * 0.5,
          r: 40 + Math.random() * 50,
          phase: Math.random() * Math.PI * 2,
          speed: 8 + Math.random() * 6, // 极慢漂过
          dir: Math.random() * Math.PI * 2,
          life: 0,
          maxLife: 6 + Math.random() * 3,
          kind: Math.random() < 0.5 ? "mist" : "light",
        });
      }
    }
    for (const w of this.wisps) {
      w.life += dt;
      w.phase += dt * 0.6;
      // 缓慢飘过 + 径向轻微扭动
      w.x += Math.cos(w.dir) * w.speed * dt + Math.sin(w.phase) * 4 * dt;
      w.y += Math.sin(w.dir) * w.speed * dt + Math.cos(w.phase * 0.8) * 4 * dt;
    }
    this.wisps = this.wisps.filter(
      (w) => w.life < w.maxLife && Math.hypot(w.x, w.y) < R * 1.1
    );
  }

  draw(ctx) {
    if (this.wisps.length === 0) return;
    const R = cupInnerR();
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
    ctx.clip();
    for (const w of this.wisps) {
      const t = w.life / w.maxLife;
      const alpha = Math.sin(t * Math.PI) * (w.kind === "light" ? 0.1 : 0.08);
      if (alpha <= 0.004) continue;
      const g = ctx.createRadialGradient(
        this.cx + w.x, this.cy + w.y, w.r * 0.15,
        this.cx + w.x, this.cy + w.y, w.r
      );
      g.addColorStop(0, `rgba(255, 253, 246, ${alpha})`);
      g.addColorStop(1, "rgba(255, 253, 246, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(this.cx + w.x - w.r, this.cy + w.y - w.r, w.r * 2, w.r * 2);
    }
    ctx.restore();
  }
}
