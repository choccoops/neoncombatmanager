/**
 * Levels, pure (tests import it).
 *
 * The floors of a building are often drawn side by side on one scene (and a module such as
 * Multilevel Tokens shows who's on the other ones). The squares between two floors on the map
 * say nothing about how far apart two people really are. A floor here is a Region with:
 *   - a height (m/yds above the ground), and
 *   - a stack: the building it belongs to. Floors of one stack are the same ground plan, so a
 *     spot on one lies straight above or below the same spot on another (measured from each
 *     Region's top left corner).
 * The real distance between two people is then the distance across the plan and the height
 * between them, taken together. Anyone not on a floor stands on the ground (height 0), and a
 * token's own elevation always counts on top.
 *
 * A floor: { region, stack, height }.
 */

/** A floor as the GM gave it, tidied: null when it isn't one. */
export function cleanFloor(f) {
  const height = Number(f?.height);
  if (!f?.region || !Number.isFinite(height)) return null;
  return { region: String(f.region), stack: String(f.stack ?? "").trim(), height: Math.round(height * 10) / 10 };
}

/** The floor someone standing in these Regions is on (the highest, where floors overlap), or null. */
export function floorIn(floors = [], here = []) {
  return (floors ?? []).filter((f) => here.includes(f.region)).sort((x, y) => y.height - x.height)[0] ?? null;
}

/** Two floors of one building, one above the other: their plans line up. */
export const stacked = (fa, fb) => !!fa && !!fb && fa.region !== fb.region && !!fa.stack && fa.stack === fb.stack;

/** A point on one floor, as the same spot on another: measured from each Region's top left corner. */
export const onto = (p, from, to) => ({ x: p.x - from.x + to.x, y: p.y - from.y + to.y });

/** Across and up, together, to the whole m/yd. */
export const through = (across, up) => Math.round(Math.hypot(Number(across) || 0, Number(up) || 0));
