/**
 * The Awareness Ladder on the tokens and the Alert that follows it, pure (tests import it).
 *
 * 2070 Core Rules ch.06: the enemies of an encounter share one status, Unaware to Spotted; once
 * anyone reaches Alert the district's security response is on its way. Table ruling: an Alert is
 * kept until something is done about it. Put every alerted enemy down before the response is
 * called and the alarm never goes out; the timer counts down to the call.
 */
import { LADDER } from "../roller/rules.js";

/** The Neon Condition an enemy carries at each raised step (Unaware is having none). */
export const AWARE_CONDITIONS = { suspicious: "awareSuspicious", searching: "awareSearching", alert: "awareAlert", spotted: "awareSpotted" };

/** What the tokens show: "alert" (only Alert and Spotted, so sneaking stays tense), "all", or "off". */
export const TOKEN_MODES = ["alert", "all", "off"];

/** The condition to place at a level in a mode, or null. */
export function conditionAt(level, mode = "alert") {
  if (mode === "off" || !AWARE_CONDITIONS[level]) return null;
  if (mode === "alert" && !isAlert(level)) return null;
  return AWARE_CONDITIONS[level];
}

/** Alert or Spotted. */
export const isAlert = (level) => LADDER.indexOf(level) >= LADDER.indexOf("alert");

/** Did the Ladder just climb to Alert (or straight past it) from below? */
export const raised = (from, to) => !isAlert(from) && isAlert(to);

/**
 * The encounter's enemies, from its combatants: { enemies, awake }.
 * @param {object[]} list - [{ player, defeated, out }]: a player's character, marked defeated,
 *   dead / unconscious / asleep
 */
export function tally(list = []) {
  const enemies = list.filter((c) => !c.player);
  return { enemies: enemies.length, awake: enemies.filter((c) => !c.defeated && !c.out).length };
}

/**
 * An Alert beginning now.
 * @param {object} now - { time (world seconds), round, roundSeconds }
 * @param {number} rounds - how long until the response is called (0: no timer)
 */
export function startAlert({ time = 0, round = 0, roundSeconds = 3 } = {}, rounds = 20) {
  const n = Math.max(0, Math.round(Number(rounds) || 0));
  const per = Number(roundSeconds) > 0 ? Number(roundSeconds) : 3;
  return { id: `${time}-${round}-${Math.floor(Math.random() * 1e6)}`, at: time, round, rounds: n, total: n * per, endsAt: time + n * per, endRound: round + n, called: false, dismissed: false };
}

/**
 * Seconds left before the response is called. World time when the clock runs with the Rounds;
 * else counted in Rounds (3 seconds each). 0 without a timer.
 */
export function remaining(alert, { time = 0, round = 0, roundSeconds = 3 } = {}) {
  if (!alert?.total) return 0;
  if (Number(roundSeconds) > 0) return Math.max(0, Math.min(alert.total, alert.endsAt - time));
  return Math.max(0, Math.min(alert.total, (alert.endRound - round) * 3));
}

/** Is a countdown showing: an Alert with a timer that hasn't been called or waved away? */
export const ticking = (alert) => !!alert && alert.total > 0 && !alert.called && !alert.dismissed;

/**
 * What an Alert under way comes to now:
 * - "clear": every enemy is down and the response was never called: the alarm doesn't go out
 * - "call": the countdown ran out: the response is called (the Alert stays)
 * - "run": nothing yet
 */
export function outcome(alert, { enemies = 0, awake = 0, left = 0, clears = true } = {}) {
  if (!alert) return "run";
  if (clears && !alert.called && enemies > 0 && awake === 0) return "clear";
  if (ticking(alert) && left <= 0) return "call";
  return "run";
}

/** The countdown as the timer shows it: seconds and hundredths, "57.00". */
export function clock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(s);
  return `${String(whole).padStart(2, "0")}.${String(Math.floor((s - whole) * 100)).padStart(2, "0")}`;
}
