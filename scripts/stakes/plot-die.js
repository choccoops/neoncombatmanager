/**
 * Raising the Stakes: the Plot Die (the user's house rule, Cyberpunk: The Unification Era Core
 * Rules, Chapter 02 "LUCK"). Pure rules, no Foundry.
 *
 * When a Check really matters the GM Raises the Stakes: before the d10, roll a d6.
 *   1   Complication, +2 to the Check     2   Complication, +4 to the Check
 *   3-4 nothing                            5-6 Opportunity
 * Whoever spends it decides: the character's player picks the Opportunity, the GM the Complication.
 * LUCK STAT 5+ may ask for it; LUCK 7+ may Double Down (reroll, once a session) or Force Fate
 * (3 LUCK for an Opportunity without rolling, once a session).
 */

/** What a Plot Die face does: { kind: "complication"|"nothing"|"opportunity", bonus }. */
export function plotResult(face) {
  const d = Number(face);
  if (d === 1) return { face: d, kind: "complication", bonus: 2 };
  if (d === 2) return { face: d, kind: "complication", bonus: 4 };
  if (d === 5 || d === 6) return { face: d, kind: "opportunity", bonus: 0 };
  return { face: d, kind: "nothing", bonus: 0 };
}

/** Opportunities, picked by the character's player. */
export const OPPORTUNITIES = ["aidAlly", "feelingLucky", "criticallyHit", "narrative"];
/** Complications, picked by the GM. */
export const COMPLICATIONS = ["hinderAlly", "feelingUnlucky", "narrative"];

/** LUCK STAT needed for each option. */
export const LUCK_NEEDS = { ask: 5, doubleDown: 7, forceFate: 7 };
/** LUCK spent by Force Fate, and lost by a Complication on a Double Down. */
export const FORCE_FATE_COST = 3;
export const DOUBLE_DOWN_PENALTY = 2;
/** LUCK the Feeling Lucky Opportunity gives back, and Feeling Unlucky takes. */
export const LUCKY_GAIN = 2;
export const UNLUCKY_LOSS = 1;

/**
 * What a character may do with their LUCK around a Raised Stake.
 * @param {object} luck - { value, max }: the pool and the LUCK STAT
 * @param {object} used - { doubleDown, forceFate }: already used this session
 */
export function luckOptions(luck, used = {}) {
  const stat = Number(luck?.max) || 0;
  const pool = Number(luck?.value) || 0;
  return {
    ask: stat >= LUCK_NEEDS.ask,
    doubleDown: stat >= LUCK_NEEDS.doubleDown && pool > 0 && !used.doubleDown,
    forceFate: stat >= LUCK_NEEDS.forceFate && pool >= FORCE_FATE_COST && !used.forceFate
  };
}

/**
 * A Complication on a Double Down reroll costs 2 LUCK; without enough, you take two.
 * @returns {{ luckLost: number, complications: number }}
 */
export function doubleDownCost(result, pool) {
  if (result.kind !== "complication") return { luckLost: 0, complications: 0 };
  const have = Number(pool) || 0;
  if (have >= DOUBLE_DOWN_PENALTY) return { luckLost: DOUBLE_DOWN_PENALTY, complications: 1 };
  return { luckLost: have, complications: 2 };
}

/** LUCK after a change, kept between 0 and the LUCK STAT. */
export function clampLuck(value, delta, max) {
  return Math.max(0, Math.min(Number(max) || 0, (Number(value) || 0) + delta));
}
