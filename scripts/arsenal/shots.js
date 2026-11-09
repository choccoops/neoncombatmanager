import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Core, img } from "../neonfx/core.js";
import { segmentsCross } from "./xray.js";

/**
 * How a Power ricochet and a Smart gun's rounds are drawn (Sequencer, seen by everyone, played by
 * the shooter's client when the attack card is posted). These replace Automated Animations'
 * straight shot for those attacks; everything else about the attack is unchanged.
 *
 * - Ricochet (2070 Ch07): the round flies to a bounce point on the nearest wall that gets it round
 *   to the target with a clear line both ways, throws sparks there, and carries on. The path it
 *   took lingers for a moment.
 * - Smart: the gun locks on (a reticle on each target), then the rounds launch wide and curve in.
 *   Improved Smart rounds glow magenta, steer harder and paint the shooter with a data ring; an
 *   Improved Smart retry loops a round back round from past the target.
 */
const ORANGE = 0xff7a1a;
const SPARK = 0xffd23f;
const SMART = 0x00e5ff;
const ISA = 0xff4fd8;
const HIT = 0xff3b3b;

/** JB2A entries to look for, most specific first (Neon FX's own art stands in without JB2A). */
export const SHOT_JB2A = {
  spark: ["jb2a.impact.001", "jb2a.impact.002", "jb2a.impact.003", "jb2a.impact"],
  hit: ["jb2a.impact.010", "jb2a.impact.004", "jb2a.impact.005", "jb2a.impact"]
};

/** Which look an attack gets: "ricochet", "smart", or null (Automated Animations draws it). */
export function shotLook(a, { on = true } = {}) {
  if (!on || a?.kind !== "attack" || !a.ranged || a.explosive || a.area || a.mode === "suppressive") return null;
  if (a.ricochet) return "ricochet";
  if (a.flavor === "smart") return "smart";
  return null;
}

/** A wall document, read for a bullet: { c, blocks }. Open doors let it by. */
export function shotWall(doc) {
  const door = Number(doc?.door) || 0;
  const open = door > 0 && Number(doc?.ds) === 1;
  return { c: doc?.c ?? [0, 0, 0, 0], blocks: Number(doc?.move ?? 1) !== 0 && !open };
}

const clear = (a, b, walls) => !walls.some((w) => segmentsCross(a, b, { x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] }));

/**
 * Where a ricochet bounces: the point on a wall, facing both the shooter and the target, with a
 * clear line to each, that makes the shortest path. With no such wall nearby, a point off to one
 * side of the line between them (wall: false).
 * @param {object[]} walls - { c: [x1, y1, x2, y2], blocks }
 */
export function bouncePoint(from, to, walls, gs = 100) {
  const solid = walls.filter((w) => w.blocks);
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const reach = span * 0.75 + gs * 6;
  let best = null;
  for (const w of solid) {
    const [x1, y1, x2, y2] = w.c;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) continue;
    if (Math.hypot(x1 - mid.x, y1 - mid.y) > reach + len && Math.hypot(x2 - mid.x, y2 - mid.y) > reach + len) continue;
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const side = (p) => (p.x - x1) * nx + (p.y - y1) * ny;
    const sf = side(from);
    const st = side(to);
    if (!sf || !st || Math.sign(sf) !== Math.sign(st)) continue;
    const s = Math.sign(sf);
    const steps = Math.max(1, Math.floor(len / (gs / 2)));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const p = { x: x1 + (x2 - x1) * t + nx * s * 3, y: y1 + (y2 - y1) * t + ny * s * 3 };
      const d = Math.hypot(p.x - from.x, p.y - from.y) + Math.hypot(to.x - p.x, to.y - p.y);
      if ((best && d >= best.d) || d > span * 3 + gs * 4) continue;
      if (!clear(from, p, solid) || !clear(p, to, solid)) continue;
      best = { x: p.x, y: p.y, d };
    }
  }
  if (best) return { x: Math.round(best.x), y: Math.round(best.y), wall: true };
  const len = span || 1;
  return { x: Math.round(mid.x - ((to.y - from.y) / len) * gs * 1.5), y: Math.round(mid.y + ((to.x - from.x) / len) * gs * 1.5), wall: false };
}

/** How long a round takes over a distance, within bounds (ms). */
export const flightMs = (dist, gs, per = 25, min = 120, max = 320) => Math.round(Math.min(max, Math.max(min, (dist / gs) * per)));

/* ---------------------------------------- */
/*  Pieces                                  */
/* ---------------------------------------- */

/**
 * A round from a to b: a glowing dot (or a streak) moving along the line, bowed out sideways by
 * `bulge` at the middle and ending `endBulge` off the end (pixels, + to the left of travel).
 */
function round(seq, a, b, { tint, delay = 0, duration = 200, size = 0.3, bulge = 0, endBulge = 0, overshoot = 0, opacity = 1, file = img("glow-soft.webp") } = {}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) + overshoot;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const e = seq.effect().file(file).atLocation(a).rotate(-deg).tint(tint).opacity(opacity).zIndex(30)
    .size(typeof size === "number" ? { width: size, height: size } : size, { gridUnits: true })
    .delay(delay).duration(duration + 80).fadeOut(80)
    .animateProperty("sprite", "position.x", { from: 0, to: dist, duration, ease: bulge ? "easeInSine" : "linear" });
  if (bulge || endBulge) {
    const half = Math.round(duration / 2);
    e.animateProperty("sprite", "position.y", { from: 0, to: -bulge, duration: half, ease: "easeOutQuad" })
      .animateProperty("sprite", "position.y", { from: -bulge, to: -endBulge, duration: duration - half, delay: half, ease: "easeInQuad" });
  }
  return e;
}

/** A burst at a point: JB2A where it's installed, else a flash and a ring. */
function burst(seq, at, { tint, delay = 0, size = 0.9, jb2a = null }) {
  const file = jb2a ? Core.jb2a(jb2a, ["orange", "yellow"]) : null;
  if (file) return seq.effect().file(file).atLocation(at).size(size * 1.4, { gridUnits: true }).delay(delay).zIndex(31);
  seq.effect().file(img("glow-soft.webp")).atLocation(at).size(size, { gridUnits: true }).tint(tint).delay(delay).duration(260).fadeOut(200).zIndex(31);
  return seq.effect().file(img("ring-pulse.webp")).atLocation(at).size(size, { gridUnits: true }).tint(tint).delay(delay).duration(380).zIndex(31)
    .animateProperty("spriteContainer", "scale.x", { from: 0.3, to: 1.1, duration: 380, ease: "easeOutCubic" })
    .animateProperty("spriteContainer", "scale.y", { from: 0.3, to: 1.1, duration: 380, ease: "easeOutCubic" })
    .animateProperty("sprite", "alpha", { from: 1, to: 0, duration: 380, absolute: true });
}

/** The line a shot took, lingering a moment. */
function trail(seq, a, b, { tint, delay = 0 }) {
  return seq.effect().file(img("trajectory.webp")).atLocation(a).stretchTo(b).tint(tint).opacity(0.55).delay(delay).duration(1500).fadeIn(80).fadeOut(1000).zIndex(29);
}

/* ---------------------------------------- */
/*  The looks                               */
/* ---------------------------------------- */

export const Shots = {
  get on() {
    return !!Settings.get("arsenalShotFx") && !!Settings.get("arsenalRebuilds") && Core.on;
  },

  /** The look for an attack card's tag here, or null. */
  lookFor(a) {
    return shotLook(a, { on: this.on });
  },

  /** Draw an attack (the shooter's client; Sequencer shows it to everyone). True when drawn. */
  attack(a) {
    const look = this.lookFor(a);
    const from = canvas?.tokens?.get(a?.tokenId)?.center;
    const targets = (a?.targets ?? []).map((id) => canvas.tokens.get(id)).filter(Boolean);
    if (!look || !from || !targets.length) return false;
    const hits = targets.map((t) => {
      const h = (a.hits ?? []).find((x) => x.name === t.name);
      return h?.dv === null || h?.dv === undefined ? true : Number(a.total) > Number(h.dv);
    });
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    if (look === "ricochet") this.ricochet(seq, from, targets[0].center, hits[0]);
    else this.smart(seq, from, targets, hits, { improved: a.ammoType === "smart", autofire: a.mode === "autofire" });
    seq.play();
    return true;
  },

  /** A Power ricochet: to the bounce, sparks, on to the target. */
  ricochet(seq, from, to, hit) {
    const gs = canvas.grid.size;
    const walls = (canvas.walls?.placeables ?? []).map((w) => shotWall(w.document));
    const bounce = bouncePoint(from, to, walls, gs);
    const leg1 = flightMs(Math.hypot(bounce.x - from.x, bounce.y - from.y), gs);
    const leg2 = flightMs(Math.hypot(to.x - bounce.x, to.y - bounce.y), gs);
    const streak = { width: 0.9, height: 0.14 };
    seq.effect().file(img("glow-soft.webp")).atLocation(from).size(0.7, { gridUnits: true }).tint(ORANGE).duration(160).fadeOut(120).zIndex(31);
    trail(seq, from, bounce, { tint: ORANGE });
    trail(seq, bounce, to, { tint: ORANGE, delay: leg1 });
    round(seq, from, bounce, { tint: SPARK, duration: leg1, size: streak, file: img("tracer.webp") });
    burst(seq, bounce, { tint: SPARK, delay: leg1, size: 0.7, jb2a: SHOT_JB2A.spark });
    round(seq, bounce, to, { tint: SPARK, delay: leg1, duration: leg2, size: streak, file: img("tracer.webp"), overshoot: hit ? 0 : gs * 1.5 });
    if (hit) burst(seq, to, { tint: HIT, delay: leg1 + leg2, size: 0.9, jb2a: SHOT_JB2A.hit });
    return bounce;
  },

  /** Smart rounds: lock on, then launch wide and curve in (Improved Smart: harder, magenta). */
  smart(seq, from, targets, hits, { improved = false, autofire = false } = {}) {
    const gs = canvas.grid.size;
    const tint = improved ? ISA : SMART;
    const lock = 380;
    for (const t of targets) {
      const size = Core.artSize(t);
      seq.effect().file(img("reticle-white.webp")).atLocation(t.center).size({ width: size.width * 1.5, height: size.height * 1.5 }).tint(tint).zIndex(28)
        .scaleIn(2.2, lock, { ease: "easeOutCubic" }).duration(lock + 1200).fadeOut(400)
        .loopProperty("spriteContainer", "rotation", { from: 0, to: 90, duration: 1600 });
    }
    if (improved) {
      seq.effect().file(img("data-ring-white.webp")).atLocation(from).size(1.6, { gridUnits: true }).tint(ISA).opacity(0.8).zIndex(27)
        .scaleIn(0.4, 300).duration(lock + 1100).fadeOut(400)
        .loopProperty("spriteContainer", "rotation", { from: 0, to: 360, duration: 2400 });
    }
    const rounds = [];
    targets.forEach((t, ti) => {
      const n = autofire && ti === 0 ? 4 : 1;
      for (let i = 0; i < n; i++) rounds.push({ t, hit: hits[ti], i: rounds.length });
    });
    for (const r of rounds) {
      const to = r.t.center;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const duration = flightMs(dist, gs, 45, 450, 900);
      const side = r.i % 2 ? -1 : 1;
      const bulge = side * Math.min(dist * (improved ? 0.38 : 0.26), gs * (improved ? 4 : 3));
      const miss = r.hit ? {} : { endBulge: side * gs * 0.9, overshoot: gs * 1.4 };
      const delay = lock + r.i * 110;
      round(seq, from, to, { tint, delay, duration, size: improved ? 0.34 : 0.28, bulge, ...miss });
      [0.6, 0.38, 0.22].forEach((opacity, k) => {
        round(seq, from, to, { tint, delay: delay + (k + 1) * 28, duration, size: (improved ? 0.26 : 0.2) - k * 0.04, bulge, opacity, ...miss });
      });
      if (r.hit) burst(seq, to, { tint, delay: delay + duration, size: improved ? 1 : 0.8 });
    }
    return rounds.length;
  },

  /** An Improved Smart retry: the round comes back round from past the target. */
  retry(a, hit) {
    if (!this.on) return false;
    const from = canvas?.tokens?.get(a?.tokenId)?.center;
    const target = canvas?.tokens?.get(a?.targets?.[0]);
    if (!from || !target) return false;
    const gs = canvas.grid.size;
    const to = target.center;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const past = { x: to.x + (dx / len) * gs * 1.6 - (dy / len) * gs, y: to.y + (dy / len) * gs * 1.6 + (dx / len) * gs };
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    const size = Core.artSize(target);
    seq.effect().file(img("reticle-white.webp")).atLocation(to).size({ width: size.width * 1.5, height: size.height * 1.5 }).tint(ISA).zIndex(28)
      .scaleIn(0.4, 250, { ease: "easeOutBack" }).duration(1300).fadeOut(400)
      .loopProperty("sprite", "alpha", { values: [1, 0.2, 1, 0.2, 1, 1, 1], duration: 70, absolute: true });
    const duration = 600;
    round(seq, past, to, { tint: ISA, delay: 200, duration, size: 0.34, bulge: gs * 1.6, ...(hit ? {} : { endBulge: gs * 0.8, overshoot: gs * 1.2 }) });
    [0.55, 0.3].forEach((opacity, k) => round(seq, past, to, { tint: ISA, delay: 200 + (k + 1) * 30, duration, size: 0.24 - k * 0.05, bulge: gs * 1.6, opacity, ...(hit ? {} : { endBulge: gs * 0.8, overshoot: gs * 1.2 }) }));
    if (hit) burst(seq, to, { tint: ISA, delay: 200 + duration, size: 1 });
    seq.play();
    return true;
  }
};
