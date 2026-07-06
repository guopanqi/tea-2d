// steam.js — 热气粒子：2-3 缕半透明白色曲线，从杯口上升、扭动、消散

export class SteamSystem {
  constructor() {
    this.wisps = [];
    this.spawnTimer = 0;
    this.active = false;
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
    if (this.active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.wisps.length < 3) {
        this.spawnTimer = 1.4 + Math.random() * 1.2;
        this.wisps.push({
          x: originX + (Math.random() - 0.5) * 30,
          y: originY,
          life: 0,
          maxLife: 3.5 + Math.random() * 1.5,
          phase: Math.random() * Math.PI * 2,
          drift: (Math.random() - 0.5) * 8,
          width: 6 + Math.random() * 4,
        });
      }
    }
    for (const w of this.wisps) {
      w.life += dt;
    }
    this.wisps = this.wisps.filter((w) => w.life < w.maxLife);
  }

  draw(ctx) {
    for (const w of this.wisps) {
      const t = w.life / w.maxLife;
      const riseHeight = 130 * t;
      const opacity = Math.sin(t * Math.PI) * 0.28;
      if (opacity <= 0.005) continue;
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${opacity})`;
      ctx.lineWidth = w.width * (1 - t * 0.5);
      ctx.lineCap = "round";
      ctx.beginPath();
      const segments = 14;
      for (let i = 0; i <= segments; i++) {
        const st = i / segments;
        const y = w.y - riseHeight * st;
        const sway = Math.sin(st * 4 + w.phase + w.life * 1.5) * 10 * st;
        const x = w.x + w.drift * st + sway;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.filter = "blur(2px)";
      ctx.stroke();
      ctx.restore();
    }
  }
}
