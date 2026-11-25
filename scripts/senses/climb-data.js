/**
 * Climbing, pure (tests import it).
 *
 * A ladder (two linked Tiles with a height) or a wall marked climbable is climbed a stretch at a
 * time. Climbing costs 2 m/yds of movement for every m/yd climbed (corebook pg. 169); Grip Feet,
 * or a Grapple Hand's or Grapple Gun's line, take that penalty off. A climber who runs out of
 * movement stays where they are on the ladder until they have more (next Turn, or a Run).
 *
 * A ladder is one lane: climbers keep their order and a body's length (GAP) between them, so the
 * one in front sets the pace of everyone behind. A wall is wide enough to climb side by side.
 *
 * A climber's state (a token flag): { kind: "tile"|"wall", id, at, height, total, base, over, crossed }
 *   at: metres along the climb; total: where it ends (height, or twice that for a wall climbed
 *   over and down the far side); base: the token's elevation at the foot.
 */
export const CLIMB_FLAG = "climb";
export const WALL_FLAG = "climb";
export const GAP = 2;

/** Movement spent per metre climbed. */
export const factorOf = ({ sure = false, line = false } = {}) => (sure || line ? 1 : 2);

/** How far a budget of movement climbs, in whole m/yds. */
export const reachOf = (left, factor = 2) => (Number.isFinite(left) ? Math.max(0, Math.floor((Number(left) || 0) / factor)) : Infinity);

/**
 * One stretch of climbing, up (toward `total`) or down (toward 0).
 * @param {object} o - at; total; dir: "up"|"down"; left: movement left (Infinity when it isn't
 *   counted); factor; ahead: where the nearest climber in the way is (null with none)
 * @returns {{ at: number, climbed: number, cost: number, done: boolean, stopped: null|"movement"|"climber" }}
 */
export function stretch({ at = 0, total = 0, dir = "up", left = Infinity, factor = 2, ahead = null } = {}) {
  const up = dir !== "down";
  const end = up ? total : 0;
  let want = Math.abs(end - at);
  let stopped = null;
  if (ahead !== null && ahead !== undefined) {
    const room = Math.max(0, up ? ahead - GAP - at : at - (ahead + GAP));
    if (room < want) {
      want = room;
      stopped = "climber";
    }
  }
  const can = reachOf(left, factor);
  if (can < want) {
    want = can;
    stopped = "movement";
  }
  const next = Math.round((up ? at + want : at - want) * 10) / 10;
  return { at: next, climbed: want, cost: want * factor, done: next === end, stopped: next === end ? null : stopped };
}

/** The nearest climber in the way on a one-lane climb: above when going up, below when going down. Null with none. */
export function aheadOf(at, others = [], dir = "up") {
  const list = others.map(Number).filter((o) => (dir !== "down" ? o > at : o < at));
  if (!list.length) return null;
  return dir !== "down" ? Math.min(...list) : Math.max(...list);
}

/** How high a climber is above the foot: on a wall climbed over, up one side and down the other. */
export const heightAt = (st) => (st?.over ? Math.min(st.at, st.total - st.at) : Number(st?.at) || 0);

/** A point mirrored across the line through a and b (the far side of a wall). */
export function across(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return { x: p.x, y: p.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const fx = a.x + t * dx;
  const fy = a.y + t * dy;
  return { x: Math.round(2 * fx - p.x), y: Math.round(2 * fy - p.y) };
}

/** How far a point is from the segment a-b. */
export function toSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * A token's elevation at the far end of a climb, so its real height carries over: what it had at
 * the foot, plus the climb, less whatever the floor it arrives on already counts.
 * @param {object} o - base: elevation at the foot; height; floorFrom, floorTo: the heights of the
 *   floors (Levels) at the foot and at the far end (0 where there's none)
 */
export const elevationAfter = ({ base = 0, height = 0, floorFrom = 0, floorTo = 0 } = {}) => Math.round((base + height - (floorTo - floorFrom)) * 10) / 10;

/* ---------------------------------------- */
/*  Chases on a ladder                      */
/* ---------------------------------------- */

/** The DV to leap past the climber in front (Athletics), and to catch the ladder when thrown off it (corebook pg. 181). */
export const LEAP_DV = 15;
export const CATCH_DV = 15;

/** A d10 as Cyberpunk RED reads it: a 10 adds another d10, a 1 takes another d10 off. */
export const d10Total = (first, second = 0) => (first === 10 ? 10 + second : first === 1 ? 1 - second : first);

/** Who's within arm's reach on a one-lane climb: [{ id, at }] a body's length or less above or below. */
export const within = (at, others = []) => others.filter((o) => Math.abs(o.at - at) <= GAP + 0.01);

/** The climber right in front (above), if they're within reach: the one a leap goes past. */
export function inFront(at, others = []) {
  const above = within(at, others).filter((o) => o.at > at).sort((x, y) => x.at - y.at);
  return above[0] ?? null;
}

/** An opposed check: the one acting has to beat the other; a tie goes to the one defending. */
export const beats = (attack, defence) => Number(attack) > Number(defence);

/**
 * Where a leap past the climber in front lands: a body's length above them, or off the top.
 * Null when someone else is already there.
 * @param {object} o - front: where the one being passed is; total; others: where everyone else on the ladder is
 * @returns {{ at: number, done: boolean }|null}
 */
export function leapTo({ front, total, others = [] } = {}) {
  const at = front + GAP;
  if (at >= total) return { at: total, done: true };
  if (others.some((o) => o !== front && Math.abs(o - at) < GAP)) return null;
  return { at, done: false };
}

/** Falling (corebook pg. 181): 2d6 for every full 10 m/yds fallen; under 10, nothing. The formula, or "" for none. */
export function fallDice(height) {
  const tens = Math.floor((Number(height) || 0) / 10);
  return tens > 0 ? `${tens * 2}d6` : "";
}

/** Where a climber's token is drawn, so several on one ladder don't sit on top of each other: each one up the ladder, a step up the map and to alternate sides. */
export const fanOffset = (rank, w, h) => (rank > 0 ? { dx: Math.round((rank % 2 ? 0.3 : -0.3) * w), dy: -Math.round(rank * 0.55 * h) } : { dx: 0, dy: 0 });
