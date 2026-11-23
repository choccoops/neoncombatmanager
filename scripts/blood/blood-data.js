/**
 * Blood, pure (tests import it): who bleeds, how much, where it lands and what a mark looks like.
 *
 * Marks are kept on the scene as small records { x, y, t, s } (a point, a tier, a seed): what
 * each looks like is worked out from its seed, the same on every screen, so nothing but the
 * record is stored or sent.
 *
 * Tiers, least to most:
 *   faint   a few drops a Lightly Wounded character leaves as they move. Too little to see
 *           with the naked eye: it shows under UV (and to the GM).
 *   trail   the trail a Seriously Wounded character leaves as they move.
 *   drag    the smear where a Mortally Wounded or dead body is moved.
 *   splat   a spatter: a Critical Injury, becoming Seriously Wounded.
 *   pool    a pool: becoming Mortally Wounded, flatlining.
 */
export const TIERS = ["faint", "trail", "drag", "splat", "pool"];
/** Seen only under UV (and by the GM). */
export const UV_ONLY = ["faint"];
/** How big each is, in grid squares across. */
export const TIER_SIZE = { faint: 0.22, trail: 0.4, drag: 0.7, splat: 1.1, pool: 1.5 };

/** The spatter a condition arriving leaves under its character, or null. */
export function tierForCondition(c) {
  if (!c) return null;
  if (c.id === "dead") return "pool";
  if (c.id === "mortallyWounded") return "pool";
  if (c.id === "seriouslyWounded") return "splat";
  if (c.category === "critical") return "splat";
  return null;
}

/**
 * What a character leaves behind as they move, by how hurt they are: a faint trail Lightly
 * Wounded, a plain one Seriously Wounded, a smear when a Mortally Wounded or dead body is moved
 * (it isn't walking: it's being dragged). Null: nothing.
 */
export function trailTier(wound) {
  if (wound === "lightlyWounded") return "faint";
  if (wound === "seriouslyWounded") return "trail";
  if (wound === "mortallyWounded" || wound === "dead") return "drag";
  return null;
}

/** Does this body bleed at all: flesh (a person, an animal), not a Full Body Conversion. */
export const bleedsAtAll = ({ meat = false, borg = false } = {}) => !!meat && !borg;

/** A small seeded generator: the same numbers for the same seed, everywhere. */
export function rng(seed) {
  let s = (Math.abs(Math.floor(Number(seed) || 1)) % 2147483646) + 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

/**
 * Where a trail's drops fall along a move: one about every `step` squares, a little off the
 * line, never on the spot it started from. No more than `max` for one move (a teleport across
 * the map isn't a trail).
 * @returns {{ x: number, y: number }[]}
 */
export function dropsAlong(from, to, grid = 100, { step = 1, max = 12, seed = 1 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const every = Math.max(1, grid * step);
  const n = Math.floor(dist / every);
  if (!n || n > max) return [];
  const r = rng(seed);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const k = (i * every) / dist;
    const off = (r() - 0.5) * grid * 0.3;
    out.push({ x: Math.round(from.x + dx * k - (dy / dist) * off), y: Math.round(from.y + dy * k + (dx / dist) * off) });
  }
  return out;
}

/**
 * What a mark looks like: blobs around its point, [{ dx, dy, r, a }] in pixels (a: how solid).
 * A pool is a few big overlapping blobs; a spatter a core with drops flung out; a smear a run
 * of blobs along one direction; a trail a few drops; faint, one or two specks.
 */
export function shapeOf(mark, grid = 100) {
  const r = rng(mark.s);
  const size = (TIER_SIZE[mark.t] ?? 0.4) * grid;
  const out = [];
  const blob = (dx, dy, rad, a) => out.push({ dx: Math.round(dx), dy: Math.round(dy), r: Math.max(1, Math.round(rad)), a: Math.round(a * 100) / 100 });
  switch (mark.t) {
    case "pool":
      for (let i = 0; i < 6; i++) blob((r() - 0.5) * size * 0.5, (r() - 0.5) * size * 0.5, size * (0.22 + r() * 0.18), 0.85);
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2;
        blob(Math.cos(a) * size * 0.6, Math.sin(a) * size * 0.6, size * (0.04 + r() * 0.05), 0.75);
      }
      break;
    case "splat": {
      blob(0, 0, size * 0.2, 0.85);
      for (let i = 0; i < 4; i++) blob((r() - 0.5) * size * 0.3, (r() - 0.5) * size * 0.3, size * (0.08 + r() * 0.08), 0.8);
      for (let i = 0; i < 12; i++) {
        const a = r() * Math.PI * 2;
        const d = size * (0.25 + r() * 0.3);
        blob(Math.cos(a) * d, Math.sin(a) * d, size * (0.015 + r() * 0.04), 0.7);
      }
      break;
    }
    case "drag": {
      const a = r() * Math.PI;
      for (let i = -3; i <= 3; i++) blob(Math.cos(a) * i * size * 0.13 + (r() - 0.5) * size * 0.1, Math.sin(a) * i * size * 0.13 + (r() - 0.5) * size * 0.1, size * (0.1 + r() * 0.08), 0.6);
      break;
    }
    case "trail":
      for (let i = 0; i < 3 + Math.floor(r() * 2); i++) blob((r() - 0.5) * size, (r() - 0.5) * size, size * (0.08 + r() * 0.1), 0.75);
      break;
    default:
      for (let i = 0; i < 1 + Math.floor(r() * 2); i++) blob((r() - 0.5) * size, (r() - 0.5) * size, size * (0.12 + r() * 0.12), 0.5);
  }
  return out;
}

/** Keep the newest `max` marks. */
export const trimMarks = (marks = [], max = 600) => (marks.length > max ? marks.slice(marks.length - max) : marks);

/** Does a viewer see a mark: everything but the faint, which takes UV (or being the GM). */
export const seesMark = (mark, { uv = false, gm = false } = {}) => !UV_ONLY.includes(mark?.t) || uv || gm;

/** The marks left after clearing within `radius` pixels of a point (all of them, with no point). */
export function clearNear(marks = [], at = null, radius = 0) {
  if (!at) return [];
  return marks.filter((m) => Math.hypot(m.x - at.x, m.y - at.y) > radius);
}
