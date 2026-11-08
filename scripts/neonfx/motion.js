/**
 * Token motion for Neon FX: the token's own art shakes, trembles, sways or jolts, drawn on each
 * client (nothing is saved, nothing goes over the network). Only the art moves; the token stays
 * where it is, so selecting, targeting and measuring are untouched.
 *
 * Foundry places the art itself and may do so again at any moment (a move, a resize). Each frame
 * we check whether the art is still where we last put it: if so, we take our own offset back
 * off; if not, Foundry has placed it fresh and that becomes the new base. So we never drift and
 * never fight a move.
 */

/** Strongest first: a token with several shows the strongest. */
export const MODES = ["psycho", "glitch", "tremble", "sway"];

const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);

/** Offset { x, y, r } (pixels, radians) for a mode at time `now`; `s` keeps a step-and-hold. */
export function offsetFor(mode, s, now, gs) {
  switch (mode) {
    case "psycho": {
      // Violent: a new jerk every 45 ms, the odd big lurch.
      if (now < s.next) return s.hold;
      const big = Math.random() < 0.2 ? 2.5 : 1;
      s.next = now + 45;
      s.hold = { x: rand(-1, 1) * gs * 0.07 * big, y: rand(-1, 1) * gs * 0.045 * big, r: rand(-4, 4) * DEG };
      return s.hold;
    }
    case "glitch": {
      // Still, then a short jolt every second or so.
      if (now < s.next) return s.hold;
      const jolting = !s.jolting;
      s.jolting = jolting;
      s.next = now + (jolting ? 120 : rand(800, 1600));
      s.hold = jolting ? { x: rand(-1, 1) * gs * 0.05, y: rand(-1, 1) * gs * 0.02, r: rand(-2, 2) * DEG } : { x: 0, y: 0, r: 0 };
      return s.hold;
    }
    case "tremble": {
      if (now < s.next) return s.hold;
      s.next = now + 35;
      s.hold = { x: rand(-1, 1) * gs * 0.012, y: rand(-1, 1) * gs * 0.008, r: rand(-0.6, 0.6) * DEG };
      return s.hold;
    }
    case "sway": {
      const t = now / 1000;
      return {
        x: Math.sin((t * 2 * Math.PI) / 2.6) * gs * 0.04,
        y: Math.sin((t * 2 * Math.PI) / 1.9) * gs * 0.015,
        r: Math.sin((t * 2 * Math.PI) / 3.1) * 3 * DEG
      };
    }
    default:
      return { x: 0, y: 0, r: 0 };
  }
}

export const Motion = {
  /** tokenId -> { mode, next, hold, off, last } */
  active: new Map(),
  _ticker: null,

  /** Give a token a motion mode, or none (null). */
  set(token, mode) {
    if (!token) return;
    const s = this.active.get(token.id);
    if (!mode) {
      if (s) this._release(token, s);
      this.active.delete(token.id);
    } else if (!s) {
      this.active.set(token.id, { mode, next: 0, hold: { x: 0, y: 0, r: 0 }, off: { x: 0, y: 0, r: 0 }, last: null });
    } else if (s.mode !== mode) {
      s.mode = mode;
      s.next = 0;
    }
    this._ensureTicker();
  },

  modeOf(token) {
    return this.active.get(token?.id)?.mode ?? null;
  },

  /** Stop everything (scene change). */
  clear() {
    for (const [id, s] of this.active) this._release(canvas?.tokens?.get?.(id), s);
    this.active.clear();
    this._ensureTicker();
  },

  _ensureTicker() {
    const ticker = canvas?.app?.ticker;
    if (!ticker) return;
    if (this.active.size && !this._ticker) {
      this._ticker = () => this.tick(performance.now());
      ticker.add(this._ticker);
    } else if (!this.active.size && this._ticker) {
      ticker.remove(this._ticker);
      this._ticker = null;
    }
  },

  tick(now) {
    const gs = canvas?.grid?.size ?? 100;
    for (const [id, s] of this.active) {
      const token = canvas.tokens?.get(id);
      const mesh = token?.mesh;
      if (!mesh || mesh.destroyed) {
        this.active.delete(id);
        continue;
      }
      const base = this._base(mesh, s);
      s.off = offsetFor(s.mode, s, now, gs);
      mesh.position.set(base.x + s.off.x, base.y + s.off.y);
      mesh.rotation = base.r + s.off.r;
      s.last = { x: mesh.position.x, y: mesh.position.y, r: mesh.rotation };
    }
    if (!this.active.size) this._ensureTicker();
  },

  /**
   * Where Foundry wants the art: our last spot minus our offset, unless Foundry has placed it
   * since (position and rotation are checked apart: a move doesn't reset the turn).
   */
  _base(mesh, s) {
    const l = s.last;
    const moved = !l || mesh.position.x !== l.x || mesh.position.y !== l.y;
    const turned = !l || mesh.rotation !== l.r;
    return {
      x: moved ? mesh.position.x : l.x - s.off.x,
      y: moved ? mesh.position.y : l.y - s.off.y,
      r: turned ? mesh.rotation : l.r - s.off.r
    };
  },

  /** Put the art back where Foundry had it. */
  _release(token, s) {
    const mesh = token?.mesh;
    if (mesh && !mesh.destroyed && s?.last) {
      const base = this._base(mesh, s);
      mesh.position.set(base.x, base.y);
      mesh.rotation = base.r;
    }
    try {
      token?.renderFlags?.set?.({ refreshPosition: true, refreshRotation: true });
    } catch {
      /* gone */
    }
  }
};
