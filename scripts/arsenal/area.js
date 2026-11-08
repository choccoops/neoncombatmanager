/**
 * Areas, pure (tests import it): the measured template an area attack places, who is inside it,
 * which way a blast throws them, and what the ammo does to everyone it catches.
 *
 * Distances are in m/yds; `grid` is { size, distance } (pixels and m/yds per square), the scene's.
 * 2070 Core Rules Ch07 (Firing Modes): an Explosive covers a 10×10m area centred on the 2×2m
 * square picked; a Shotgun Shell everything in front of the attacker within 6m. One damage roll
 * for everyone, body armor only, and it ablates.
 */

const DEG = Math.PI / 180;
const px = (m, grid) => (m / grid.distance) * grid.size;

/** Template data for an area: a square centred on `center`, or a cone from `origin` toward `toward`. */
export function templateData(area, { center = null, origin = null, toward = null }, grid) {
  if (area.shape === "cone") {
    const dir = Math.atan2(toward.y - origin.y, toward.x - origin.x) / DEG;
    return { t: "cone", x: origin.x, y: origin.y, distance: area.size, direction: (dir + 360) % 360, angle: area.angle ?? 90 };
  }
  const half = px(area.size, grid) / 2;
  // Foundry's rectangle runs from (x, y) along its diagonal: distance = side × √2, at 45°.
  return { t: "rect", x: center.x - half, y: center.y - half, distance: Math.hypot(area.size, area.size), direction: 45 };
}

/** Is a canvas point inside a template (rect or cone data, as above)? */
export function contains(t, point, grid) {
  if (t.t === "rect") {
    const side = px(Number(t.distance) / Math.SQRT2, grid);
    return point.x >= t.x - 0.5 && point.x <= t.x + side + 0.5 && point.y >= t.y - 0.5 && point.y <= t.y + side + 0.5;
  }
  if (t.t === "cone") {
    const r = px(Number(t.distance), grid);
    const dx = point.x - t.x;
    const dy = point.y - t.y;
    const d = Math.hypot(dx, dy);
    if (d > r + 0.5) return false;
    if (d < 1) return true;
    const a = Math.atan2(dy, dx) / DEG;
    const diff = Math.abs((((a - Number(t.direction)) % 360) + 540) % 360 - 180);
    return diff <= Number(t.angle ?? 90) / 2 + 0.01;
  }
  if (t.t === "circle") return Math.hypot(point.x - t.x, point.y - t.y) <= px(Number(t.distance), grid) + 0.5;
  return false;
}

/** The centres of the squares a token covers (a 2×2 token has four). */
export function squaresOf(token, grid) {
  const w = Math.max(1, Math.round(Number(token.width) || 1));
  const h = Math.max(1, Math.round(Number(token.height) || 1));
  const out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.push({ x: token.x + (i + 0.5) * grid.size, y: token.y + (j + 0.5) * grid.size });
  return out;
}

/** Is any square of the token in the area? */
export function tokenInside(t, token, grid) {
  return squaresOf(token, grid).some((p) => contains(t, p, grid));
}

/** The middle of a template's area (for the explosion and the blown-back direction). */
export function centerOf(t, grid) {
  if (t.t === "rect") {
    const half = px(Number(t.distance) / Math.SQRT2, grid) / 2;
    return { x: t.x + half, y: t.y + half };
  }
  if (t.t === "cone") {
    const r = px(Number(t.distance), grid) / 2;
    return { x: t.x + Math.cos(Number(t.direction) * DEG) * r, y: t.y + Math.sin(Number(t.direction) * DEG) * r };
  }
  return { x: t.x, y: t.y };
}

/**
 * Where a token lands when a blast throws it `metres` straight away from `center` (2070 HOUSE
 * RULE, Blown back: 2m from a grenade, 4m from a rocket). A token on the centre square goes the
 * way `fallbackAngle` points (the GM's pick). Returns its new top-left corner, snapped to the grid.
 */
export function blownBack(token, center, metres, grid, fallbackAngle = 0) {
  const w = (Number(token.width) || 1) * grid.size;
  const h = (Number(token.height) || 1) * grid.size;
  const c = { x: token.x + w / 2, y: token.y + h / 2 };
  let dx = c.x - center.x;
  let dy = c.y - center.y;
  if (Math.hypot(dx, dy) < grid.size / 2) {
    dx = Math.cos(fallbackAngle * DEG);
    dy = Math.sin(fallbackAngle * DEG);
  }
  const len = Math.hypot(dx, dy) || 1;
  const d = px(metres, grid);
  const snap = (v) => Math.round(v / grid.size) * grid.size;
  return { x: snap(c.x + (dx / len) * d - w / 2), y: snap(c.y + (dy / len) * d - h / 2) };
}

/** How far a blast throws (Blown back, HOUSE RULE): 4m for rockets and missiles, else 2m. */
export const blowBackMetres = (kind) => (kind === "rocketLauncher" || kind === "missileLauncher" ? 4 : 2);

/**
 * What ammo does to the people it catches, beyond its damage (2070 Item Compendium, Ammo &
 * Explosives; our own wording):
 *   noDamage   - the attack deals no damage
 *   save       - { skill, dv }: each target rolls it, and only a failure suffers the rest
 *   conditions - Neon Conditions put on (all hit, or the ones who failed their save)
 *   onDamage   - Neon Conditions put on whoever took damage through armor
 *   direct     - damage rolled straight to HP on a failed save (no armor, no ablation)
 *   douse      - puts out fire in the area
 *   persist    - the template stays (smoke)
 */
export function ammoEffect({ kind, ammoType, ammoName = "" }) {
  const name = String(ammoName);
  if (kind === "flamethrower") return { conditions: [], onDamage: ["onFireStrong"] };
  if (/\bsonic grenade\b/i.test(name)) return { noDamage: true, save: { skill: "Resist Torture/Drugs", dv: 17 }, conditions: ["concussion", "lostEar"] };
  if (/\barachnid grenade\b/i.test(name)) return { noDamage: true, conditions: ["grappled"] };
  if (/\bco2 grenade\b/i.test(name)) return { noDamage: true, douse: true };
  switch (ammoType) {
    case "incendiary":
      return { onDamage: ["onFireMild"] };
    case "teargas":
      return { noDamage: true, save: { skill: "Resist Torture/Drugs", dv: 13 }, conditions: ["teargassed"] };
    case "flashbang":
      return { noDamage: true, save: { skill: "Resist Torture/Drugs", dv: 15 }, conditions: ["flashbanged"] };
    case "sleep":
      return { noDamage: true, save: { skill: "Resist Torture/Drugs", dv: 13 }, conditions: ["prone", "unconscious"] };
    case "poison":
      return { noDamage: true, save: { skill: "Resist Torture/Drugs", dv: 13 }, direct: "2d6" };
    case "biotoxin":
      return { noDamage: true, save: { skill: "Resist Torture/Drugs", dv: 15 }, direct: "3d6" };
    case "emp":
      return { noDamage: true, save: { skill: "Cybertech", dv: 15 }, conditions: ["emp"] };
    case "smoke":
      return { noDamage: true, persist: true };
    default:
      return {};
  }
}
