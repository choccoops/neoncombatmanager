/**
 * An AV's flight in to land, drawn on each client. The token is already on the pad (one update,
 * no animation); its art is drawn back along the path and bigger (closer to the camera, up in
 * the air), then brought in and set down. The token's bars, name and border ride with the art.
 * Nothing is saved and nothing goes over the network: like Motion, only drawing moves, and each
 * frame we check whether Foundry has placed things fresh before taking our own offset back off.
 */

/** How much bigger the art is drawn in the air. */
export const AIR = 1.45;
/** Rising from the ground to cruise height (a token that was standing on the map). */
export const LIFT_MS = 500;
/** Hover and set down over the pad. */
export const DESCENT_MS = 2600;

const DEG = Math.PI / 180;
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = (t) => 1 - Math.pow(1 - t, 3);

/**
 * The flight from a centre point to the pad's centre: how far back the art starts (dx, dy), how
 * long it cruises (longer for further, within bounds; none when it's already over the pad) and
 * how long it takes to set down. airborne: it starts in the air (it came in hidden, off the map).
 */
export function planFlight({ from, to, gs = 100, airborne = false }) {
  const dx = (from?.x ?? to.x) - to.x;
  const dy = (from?.y ?? to.y) - to.y;
  const dist = Math.hypot(dx, dy);
  const cruise = dist < gs * 0.5 ? 0 : Math.round(Math.min(3200, Math.max(1200, (dist / gs) * 140)));
  return { dx: cruise ? dx : 0, dy: cruise ? dy : 0, gs, cruise, descent: DESCENT_MS, start: airborne ? AIR : 1, total: cruise + DESCENT_MS };
}

/** Where the art is `t` ms in: offset { x, y } (pixels), scale (times its own), turn r (radians). */
export function flightAt(p, t) {
  if (t >= p.total) return { x: 0, y: 0, scale: 1, r: 0, done: true };
  if (t < p.cruise) {
    const k = inOut(t / p.cruise);
    const lift = Math.min(1, t / LIFT_MS);
    return { x: p.dx * (1 - k), y: p.dy * (1 - k), scale: p.start + (AIR - p.start) * lift, r: 0, done: false };
  }
  // Over the pad: settle down from cruise height with a little hover drift and yaw that dies away.
  const u = Math.max(0, t - p.cruise) / p.descent;
  const k = out(u);
  const s = (t - p.cruise) / 1000;
  const calm = 1 - k;
  return {
    x: Math.sin(s * 2.4) * p.gs * 0.03 * calm,
    y: Math.sin(s * 1.7) * p.gs * 0.02 * calm,
    scale: AIR + (1 - AIR) * k,
    r: Math.sin(s * 2) * 2.5 * DEG * calm,
    done: false
  };
}

export const Flight = {
  /** tokenId -> { plan, t0, off, last, done } */
  active: new Map(),
  _ticker: null,

  isFlying(id) {
    return this.active.has(id);
  },

  /** Fly a token's art in along a plan, starting now. done() is called when it has set down. */
  start(token, plan, done = null) {
    if (!token?.mesh) return done?.();
    const prev = this.active.get(token.id);
    if (prev) this._release(token, prev);
    this.active.set(token.id, { plan, t0: performance.now(), off: null, last: null, done });
    this._ensureTicker();
  },

  /** Stop every flight where it is (scene change). */
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
    for (const [id, s] of this.active) {
      const token = canvas.tokens?.get(id);
      const mesh = token?.mesh;
      if (!mesh || mesh.destroyed) {
        this.active.delete(id);
        continue;
      }
      const at = flightAt(s.plan, now - s.t0);
      if (at.done) {
        this.active.delete(id);
        this._release(token, s);
        s.done?.();
        continue;
      }
      const base = this._base(token, s);
      mesh.position.set(base.mx + at.x, base.my + at.y);
      mesh.rotation = base.r + at.r;
      mesh.scale?.set?.(base.sx * at.scale, base.sy * at.scale);
      token.position?.set?.(base.tx + at.x, base.ty + at.y);
      s.off = at;
      s.last = this._read(token);
    }
    if (!this.active.size) this._ensureTicker();
  },

  _read(token) {
    const m = token.mesh;
    return { mx: m.position.x, my: m.position.y, r: m.rotation, sx: m.scale?.x ?? 1, sy: m.scale?.y ?? 1, tx: token.position?.x ?? 0, ty: token.position?.y ?? 0 };
  },

  /** Where Foundry wants things: our last values minus our offset, unless Foundry has set them since. */
  _base(token, s) {
    const now = this._read(token);
    const l = s.last;
    const o = s.off;
    if (!l || !o) return now;
    const same = (a, b) => a === b;
    return {
      mx: same(now.mx, l.mx) && same(now.my, l.my) ? l.mx - o.x : now.mx,
      my: same(now.mx, l.mx) && same(now.my, l.my) ? l.my - o.y : now.my,
      r: same(now.r, l.r) ? l.r - o.r : now.r,
      sx: same(now.sx, l.sx) ? l.sx / o.scale : now.sx,
      sy: same(now.sy, l.sy) ? l.sy / o.scale : now.sy,
      tx: same(now.tx, l.tx) && same(now.ty, l.ty) ? l.tx - o.x : now.tx,
      ty: same(now.tx, l.tx) && same(now.ty, l.ty) ? l.ty - o.y : now.ty
    };
  },

  /** Give everything back to where Foundry had it. */
  _release(token, s) {
    const mesh = token?.mesh;
    if (mesh && !mesh.destroyed && s?.last) {
      const b = this._base(token, s);
      mesh.position.set(b.mx, b.my);
      mesh.rotation = b.r;
      mesh.scale?.set?.(b.sx, b.sy);
      token.position?.set?.(b.tx, b.ty);
    }
    try {
      token?.renderFlags?.set?.({ refreshPosition: true, refreshRotation: true, refreshSize: true });
    } catch {
      /* gone */
    }
  }
};
