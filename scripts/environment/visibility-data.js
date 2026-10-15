/**
 * Seeing in the dark (core rulebook p.129: night or low lighting -1; a task obscured by smoke or
 * darkness -4) and through weather (Night City Weather), and the gear that cancels it: Low
 * Light/Infrared/UV cybereyes reduce penalties from darkness and intangible obscurement (smoke,
 * fog, rain) to 0 (p.360). Pure functions, no Foundry.
 */

/** Light at a spot: "bright" (no penalty), "dim" (-1) or "dark" (-4). */
export const LEVEL_PENALTY = { bright: 0, dim: -1, dark: -4 };

/**
 * How lit a spot is.
 * @param {object} p
 * @param {number} p.darkness - the scene's darkness, 0-1 (SmallTime moves it with the clock)
 * @param {object} [p.global] - { enabled, max }: global illumination lights everything while darkness <= max
 * @param {string|null} [p.lit] - the brightest light source reaching the spot: "bright", "dim" or null
 * @param {boolean} [p.unlit] - inside a darkness source (v12 darkness lights)
 * @param {number} [p.lowAt] - darkness from which it counts as low light
 * @param {number} [p.darkAt] - darkness from which it counts as dark
 */
export function lightLevel({ darkness = 0, global = null, lit = null, unlit = false, lowAt = 0.3, darkAt = 0.7 }) {
  if (unlit) return lit === "bright" ? "dim" : "dark";
  if (lit === "bright") return "bright";
  const d = Number(darkness) || 0;
  if (global?.enabled && d <= (global.max ?? 1)) return d >= darkAt ? "dim" : "bright";
  if (d < lowAt) return "bright";
  if (lit === "dim") return "dim";
  return d >= darkAt ? "dark" : "dim";
}

/** The worse of two levels. */
export function worse(a, b) {
  const order = ["bright", "dim", "dark"];
  return order[Math.max(order.indexOf(a ?? "bright"), order.indexOf(b ?? "bright"))];
}

/**
 * A character's sight penalty.
 * @param {object} p
 * @param {string} p.level - lightLevel()
 * @param {number} [p.weather] - the weather's sight penalty (negative)
 * @param {number} [p.smoke] - other obscurement (negative)
 * @param {boolean} [p.vision] - Low Light/Infrared/UV cybereyes: no darkness or obscurement penalty
 * @param {number} [p.cap] - the most it can add up to (0 for no cap); darkness and fog are both "obscured"
 * @returns {{ total: number, darkness: number, weather: number, condition: string|null }}
 *   condition: lowLight, darkness or obscured (whichever explains most of it), null for none
 */
export function sightPenalty({ level = "bright", weather = 0, smoke = 0, vision = false, cap = 4 }) {
  if (vision) return { total: 0, darkness: 0, weather: 0, condition: null };
  const darkness = LEVEL_PENALTY[level] ?? 0;
  const obscure = Math.min(Number(weather) || 0, 0) + Math.min(Number(smoke) || 0, 0);
  let total = darkness + obscure;
  if (cap > 0) total = Math.max(total, -cap);
  let condition = null;
  if (total < 0) {
    if (obscure < darkness) condition = "obscured";
    else if (level === "dark") condition = "darkness";
    else condition = "lowLight";
  }
  return { total, darkness, weather: obscure, condition };
}

/**
 * The light reaching a point from a set of sources.
 * @param {{x: number, y: number}} point
 * @param {object[]} sources - { x, y, bright, dim, contains?(x, y) } radii in pixels
 * @returns {"bright"|"dim"|null}
 */
export function litBy(point, sources) {
  let best = null;
  for (const s of sources ?? []) {
    const r = Math.max(Number(s.dim) || 0, Number(s.bright) || 0);
    if (!r) continue;
    const d = Math.hypot(point.x - s.x, point.y - s.y);
    if (d > r) continue;
    if (typeof s.contains === "function" && !s.contains(point.x, point.y)) continue;
    if (d <= (Number(s.bright) || 0)) return "bright";
    best = "dim";
  }
  return best;
}
