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
const BLAST = "cpr-neon-combat-manager";

/**
 * A square area's side, in m/yds: what the area says it is (`side`, or the blast a placed
 * template carries), else read back off Foundry's diagonal. The template's own `distance` isn't
 * to be trusted for it: how Foundry turns a diagonal into a square depends on the scene's rule
 * for diagonals, so Neon Arsenal scales it to draw the right square (scripts/arsenal/blast.js).
 */
export function sideOf(t) {
  const own = Number(t?.side) || (t?.flags?.[BLAST]?.blast?.area?.shape === "rect" ? Number(t.flags[BLAST].blast.area.size) : 0);
  return own > 0 ? own : Number(t?.distance) / Math.SQRT2;
}

/** Template data for an area: a square centred on `center`, or a cone from `origin` toward `toward`. */
export function templateData(area, { center = null, origin = null, toward = null }, grid) {
  if (area.shape === "cone") {
    const dir = Math.atan2(toward.y - origin.y, toward.x - origin.x) / DEG;
    return { t: "cone", x: origin.x, y: origin.y, distance: area.size, direction: (dir + 360) % 360, angle: area.angle ?? 90 };
  }
  const half = px(area.size, grid) / 2;
  // Foundry's rectangle runs from (x, y) along its diagonal: distance = side × √2, at 45°.
  return { t: "rect", x: center.x - half, y: center.y - half, distance: Math.hypot(area.size, area.size), direction: 45, side: area.size };
}

/** Is a canvas point inside a template (rect or cone data, as above)? */
export function contains(t, point, grid) {
  if (t.t === "rect") {
    const side = px(sideOf(t), grid);
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
    const half = px(sideOf(t), grid) / 2;
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

/**
 * Where a missed explosive lands, at random (HOUSE RULE: the rules leave it to the GM, Core p.174
 * and 2070 Ch07): the centre of a square within the area around the aimed square (a 10×10m area is
 * 5×5 squares), never the aimed square itself. Returns { x, y, metres } (metres: how far it went).
 * @param {object} aim - the aimed square's centre
 * @param {() => number} rand - 0 ≤ n < 1
 */
export function scatter(aim, size, grid, rand = Math.random) {
  const reach = Math.floor(Math.max(1, Math.round(size / grid.distance)) / 2) || 1;
  const options = [];
  for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) if (i || j) options.push([i, j]);
  const [i, j] = options[Math.min(options.length - 1, Math.floor(rand() * options.length))];
  return { x: aim.x + i * grid.size, y: aim.y + j * grid.size, metres: Math.max(Math.abs(i), Math.abs(j)) * grid.distance };
}

/**
 * Where a token that dodged out of an area ends up: the nearest square just outside it, straight
 * away from its centre, else the next closest direction (2070 Ch07: they leave the blast; Core
 * p.174: outside the blast area). `blocked(from, to)` says a wall is in the way (that direction is
 * then out). Returns the token's new top-left corner, or null when there's no way out.
 */
export function escapeSquare(t, token, grid, blocked = () => false, max = 12) {
  const w = (Number(token.width) || 1) * grid.size;
  const h = (Number(token.height) || 1) * grid.size;
  const from = { x: token.x + w / 2, y: token.y + h / 2 };
  const centre = centerOf(t, grid);
  const away = Math.atan2(from.y - centre.y, from.x - centre.x);
  const turn = (a) => Math.abs(((a - away + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4).sort((a, b) => turn(a) - turn(b));
  if (Math.hypot(from.x - centre.x, from.y - centre.y) > 1) dirs.unshift(away);
  for (const a of dirs) {
    for (let k = 1; k <= max; k++) {
      const x = Math.round((token.x + Math.cos(a) * k * grid.size) / grid.size) * grid.size;
      const y = Math.round((token.y + Math.sin(a) * k * grid.size) / grid.size) * grid.size;
      if (x === token.x && y === token.y) continue;
      if (tokenInside(t, { ...token, x, y }, grid)) continue;
      if (blocked(from, { x: x + w / 2, y: y + h / 2 })) break;
      return { x, y };
    }
  }
  return null;
}

/** How far a blast throws (Blown back, HOUSE RULE): 4m for rockets and missiles, else 2m. */
export const blowBackMetres = (kind) => (kind === "rocketLauncher" || kind === "missileLauncher" ? 4 : 2);

/** A grenade by its kind, named either way: "Sonic Grenade" or the system's "Grenade (Sonic)". */
const grenadeNamed = (name, kind) => new RegExp(`\\b${kind} grenade\\b|\\bgrenade \\(${kind}\\)`, "i").test(name);

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
  if (grenadeNamed(name, "sonic")) return { noDamage: true, save: { skill: "Resist Torture/Drugs", dv: 17 }, conditions: ["concussion", "lostEar"] };
  if (grenadeNamed(name, "arachnid")) return { noDamage: true, conditions: ["grappled"] };
  if (grenadeNamed(name, "co2")) return { noDamage: true, douse: true };
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
