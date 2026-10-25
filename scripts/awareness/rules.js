/**
 * Combat Awareness (the Solo's Role Ability): pure rules, no Foundry. A Solo divides their Rank
 * in points among six abilities; some only pay off in steps (Precision Attack every 3 points,
 * Damage Deflection every 2, Fumble Recovery at 4). Cyberpunk RED keeps the points on the Solo
 * role item's abilities and applies them itself; this works out what they do and keeps the
 * total within the Rank.
 */

/** The abilities, in the order the window shows them. `ratio`: points per step; `max`: most worth spending. */
export const ABILITIES = [
  { key: "initiativeReaction", name: "Initiative Reaction", ratio: 1, icon: "fa-solid fa-bolt" },
  { key: "precisionAttack", name: "Precision Attack", ratio: 3, max: 9, icon: "fa-solid fa-crosshairs" },
  { key: "spotWeakness", name: "Spot Weakness", ratio: 1, icon: "fa-solid fa-bullseye" },
  { key: "damageDeflection", name: "Damage Deflection", ratio: 2, max: 10, icon: "fa-solid fa-shield-halved" },
  { key: "threatDetection", name: "Threat Detection", ratio: 1, icon: "fa-solid fa-eye" },
  { key: "fumbleRecovery", name: "Fumble Recovery", ratio: 4, max: 4, icon: "fa-solid fa-dice-one" }
];

export const BY_KEY = Object.fromEntries(ABILITIES.map((a) => [a.key, a]));

/** An ability's key from its name on the role item ("Precision Attack" → "precisionAttack"). */
export function keyOf(name) {
  const n = String(name ?? "").trim().toLowerCase();
  return ABILITIES.find((a) => a.name.toLowerCase() === n)?.key ?? null;
}

const pts = (v) => Math.max(0, Math.floor(Number(v) || 0));

/**
 * What points in an ability do: a number (Initiative +n, attacks +n, damage +n, deflection -n,
 * Perception +n) or, for Fumble Recovery, true/false.
 */
export function abilityEffect(key, points) {
  const p = pts(points);
  const a = BY_KEY[key];
  if (!a) return 0;
  if (key === "fumbleRecovery") return p >= 4;
  return Math.floor(Math.min(p, a.max ?? Infinity) / a.ratio);
}

/** An allocation with every ability present, whole points only. */
export function normalize(alloc = {}) {
  return Object.fromEntries(ABILITIES.map((a) => [a.key, pts(alloc[a.key])]));
}

export function total(alloc = {}) {
  return Object.values(normalize(alloc)).reduce((s, v) => s + v, 0);
}

/**
 * Check an allocation against the Solo's Rank.
 * @returns {{ total, left, over: boolean, wasted: {key, points}[], ok: boolean }} wasted: points
 *   that buy nothing (a 4th point in Precision Attack, past an ability's useful most)
 */
export function check(alloc, rank) {
  const a = normalize(alloc);
  const sum = total(a);
  const r = pts(rank);
  const wasted = ABILITIES.map(({ key, ratio, max }) => {
    const p = a[key];
    const capped = Math.min(p, max ?? Infinity);
    return { key, points: p - capped + (capped % ratio) };
  }).filter((w) => w.points > 0);
  return { total: sum, left: r - sum, over: sum > r, wasted, ok: sum <= r };
}

/**
 * One step up or down on an ability, by its step size: up to the next step that fits in the
 * points left (and its most), down to the step below.
 * @returns {object} the new allocation (unchanged when the step doesn't fit)
 */
export function step(alloc, key, dir, rank) {
  const a = normalize(alloc);
  const ab = BY_KEY[key];
  if (!ab) return a;
  const p = a[key];
  const left = pts(rank) - total(a);
  if (dir > 0) {
    const next = (Math.floor(p / ab.ratio) + 1) * ab.ratio;
    if (next > (ab.max ?? Infinity) || next - p > left) return a;
    return { ...a, [key]: next };
  }
  if (p <= 0) return a;
  const prev = p % ab.ratio ? p - (p % ab.ratio) : p - ab.ratio;
  return { ...a, [key]: Math.max(0, prev) };
}

export function same(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  return ABILITIES.every(({ key }) => x[key] === y[key]);
}

/**
 * When a Solo may reassign, and what it costs (Core p.146): before Initiative or outside combat
 * it's free; once their combat is under way it takes their Action, on their Turn.
 * @param {object} s - inCombat: in a started combat; rolled: has an Initiative; myTurn: it's their Turn;
 *   gm: the GM is doing it
 * @returns {"free"|"action"|"wait"|"gm"} gm: the GM adjusting outside the Solo's Turn (no Action spent)
 */
export function assignMode({ inCombat = false, rolled = false, myTurn = false, gm = false } = {}) {
  if (!inCombat || !rolled) return "free";
  if (myTurn) return "action";
  return gm ? "gm" : "wait";
}
