/**
 * Sight range, pure (tests import it).
 *
 * Foundry lets a token see as far as its line of sight runs: on a lit map, a figure 400 m off is
 * as plain as one across the street, and a scope has nothing to add. Here a character makes out
 * other people only as far as the naked eye reaches (50 m/yds by default); past that the map is
 * still there, hazed, but nobody on it shows. A scope reaches further, down a narrow cone the way
 * it points, and gives up everything to the sides while it's up.
 *
 * How it's done: Foundry's own "light perception" detection (how far a token picks out others in
 * the light) is given that range on each character's token, so Foundry itself hides who is past
 * it and walls still block as they always did. The haze is drawn on each viewer's own screen.
 */

/** The detection mode a token picks others out by where there's light. */
export const LIGHT = "lightPerception";

/**
 * A token's detection modes with light perception held to a range.
 * @param {{id: string, enabled?: boolean, range?: number|null}[]} modes - as the token has them saved
 * @param {number} range - m/yds
 * @returns {{ modes: object[], was: object|null, changed: boolean }} was: the entry as it was (null: there was none)
 */
export function withRange(modes = [], range = 50) {
  const list = (Array.isArray(modes) ? modes : []).map((m) => ({ id: m.id, enabled: m.enabled !== false, range: m.range ?? null }));
  const i = list.findIndex((m) => m.id === LIGHT);
  const was = i >= 0 ? { ...list[i] } : null;
  const r = Math.max(1, Math.round(Number(range) || 50));
  if (i >= 0) list[i] = { ...list[i], enabled: true, range: r };
  else list.push({ id: LIGHT, enabled: true, range: r });
  return { modes: list, was, changed: !was || was.range !== r || !was.enabled };
}

/** The same modes with light perception put back as it was (taken out, when there was none). */
export function withoutRange(modes = [], was = null) {
  const list = (Array.isArray(modes) ? modes : []).map((m) => ({ id: m.id, enabled: m.enabled !== false, range: m.range ?? null }));
  const i = list.findIndex((m) => m.id === LIGHT);
  if (i < 0) return list;
  if (was) list[i] = { id: LIGHT, enabled: was.enabled !== false, range: was.range ?? null };
  else list.splice(i, 1);
  return list;
}

/** How far a token picks others out in the light, from its modes: a number, or Infinity. */
export function lightRange(modes = []) {
  const m = (Array.isArray(modes) ? modes : []).find((x) => x.id === LIGHT && x.enabled !== false);
  return m && Number.isFinite(Number(m.range)) && m.range !== null && Number(m.range) > 0 ? Number(m.range) : Infinity;
}

/**
 * The part of the map a viewer sees clearly, for the haze: a circle around them, or (looking
 * down a cone: a scope up, or a token whose own vision is a cone) a wedge the way they face
 * with a small circle around their feet.
 * @param {object} o - center {x, y} px; range (px); angle (degrees of vision, 360 = all round);
 *   rotation (the token's, degrees; Foundry's 0 faces down the screen); near (px)
 * @returns {{ kind: "circle", x, y, r } | { kind: "cone", x, y, r, from, to, near }} from/to in radians
 */
export function clearShape({ center, range = 0, angle = 360, rotation = 0, near = 0 } = {}) {
  const r = Math.max(0, Number(range) || 0);
  const a = Math.max(0, Math.min(360, Number(angle) || 360));
  if (a >= 360) return { kind: "circle", x: center.x, y: center.y, r };
  const mid = ((Number(rotation) || 0) + 90) * (Math.PI / 180);
  const half = (a / 2) * (Math.PI / 180);
  return { kind: "cone", x: center.x, y: center.y, r, from: mid - half, to: mid + half, near: Math.max(0, Number(near) || 0) };
}

/** Is a point in the clear part? (For tests, and anything that wants to ask.) */
export function inClear(shape, p) {
  const d = Math.hypot(p.x - shape.x, p.y - shape.y);
  if (shape.kind === "circle") return d <= shape.r + 0.5;
  if (d <= shape.near + 0.5) return true;
  if (d > shape.r + 0.5) return false;
  const mid = (shape.from + shape.to) / 2;
  const half = (shape.to - shape.from) / 2;
  let diff = Math.atan2(p.y - shape.y, p.x - shape.x) - mid;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) <= half + 1e-6;
}
