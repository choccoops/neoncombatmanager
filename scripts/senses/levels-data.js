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

/** Which other floors are looked onto: "open" only through an opening both stand in (floors are solid), "off" none, "near" the next one up and down, "all" every floor of the building. */
export const VIEW_MODES = ["open", "all", "near", "off"];

/**
 * Who shows on the viewer's floor as a figure from another floor of the same building.
 * @param {object} viewer - { floor, corner } (from Levels.place)
 * @param {object[]} others - [{ id, floor, corner, point, height }]
 * @param {object[]} floors - every floor of the scene
 * @param {string} mode - one of VIEW_MODES
 * @returns {{ id: string, x: number, y: number, up: number }[]} (up: how far above the viewer's floor; negative below)
 */
export function ghostsFor(viewer, others = [], floors = [], mode = "all") {
  if (mode === "off" || !viewer?.floor?.stack || !viewer.corner) return [];
  const heights = [...new Set(floors.filter((f) => f.stack === viewer.floor.stack).map((f) => f.height))].sort((x, y) => x - y);
  const at = heights.indexOf(viewer.floor.height);
  const out = [];
  for (const o of others) {
    if (!stacked(viewer.floor, o.floor) || !o.corner || o.floor.height === viewer.floor.height) continue;
    if (mode === "near" && Math.abs(heights.indexOf(o.floor.height) - at) !== 1) continue;
    const p = onto(o.point, o.corner, viewer.corner);
    out.push({ id: o.id, x: p.x, y: p.y, up: Math.round((o.floor.height - viewer.floor.height) * 10) / 10 });
  }
  return out;
}

/** Is the viewer's target on another floor of its building (the map between them means nothing)? */
export const apart = (pa, pb) => stacked(pa?.floor, pb?.floor);

/**
 * Openings: where a building is open from floor to floor (a stairwell, an atrium, a fire escape).
 * A floor is solid everywhere else: nobody sees or shoots through it. An opening is a Region
 * drawn on one floor of the building; it stands for that part of the plan on every floor.
 *
 * Two people on different floors have a line between them when both stand in the same opening.
 * @param {object[]} openings - [{ stack, shapes, corner }] (corner: its floor Region's top left)
 * @param {object} pa - { floor, corner, point } (from Levels.place)
 * @param {object} pb - the same, for the other
 * @param {(shapes: object[], p: {x,y}) => boolean} inside - the point-in-shapes test
 */
export function openBetween(openings = [], pa, pb, inside) {
  if (!stacked(pa?.floor, pb?.floor) || !pa.corner || !pb.corner) return false;
  return (openings ?? []).some((o) => o.stack === pa.floor.stack && o.corner
    && inside(o.shapes, onto(pa.point, pa.corner, o.corner)) && inside(o.shapes, onto(pb.point, pb.corner, o.corner)));
}
