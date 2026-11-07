import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Conditions } from "../conditions/engine.js";
import { LADDER, ladderDV, ladderStep } from "./rules.js";
import { L } from "../util.js";

/**
 * The Awareness Ladder (2070 Core Rules, Ch.06): one status for the enemies in an encounter,
 * Unaware to Spotted, shown to the GM on the carousel with the Stealth DV to beat. Kept on the
 * combat (flags[MODULE].ladder). A combat that starts puts them at Alert, at least.
 */
export const Ladder = {
  init() {
    Hooks.on("updateCombat", (combat, changed) => {
      if (!Compat.isActiveGM || !Settings.get("awarenessLadder") || !("round" in (changed ?? {})) || !combat.started) return;
      if (LADDER.indexOf(this.level(combat)) < LADDER.indexOf("alert")) this.set(combat, "alert").catch(() => null);
    });
  },

  level(combat) {
    const l = combat?.flags?.[MODULE_ID]?.ladder;
    return LADDER.includes(l) ? l : "unaware";
  },

  /** Enemies in the encounter: awake, and asleep or out cold (they count half). */
  counts(combat) {
    let awake = 0;
    let asleep = 0;
    for (const cb of combat?.combatants ?? []) {
      const a = cb.actor;
      if (!a || a.hasPlayerOwner || cb.defeated) continue;
      if (Conditions.has("sleep", a) || Conditions.has("unconscious", a)) asleep++;
      else awake++;
    }
    return { awake, asleep };
  },

  /** For the carousel: { level, label, dv, hint }. */
  context(combat) {
    const level = this.level(combat);
    const counts = this.counts(combat);
    const dv = ladderDV(level, counts);
    return {
      level,
      label: L(`${LANG}.Ladder.${level}`),
      dv,
      hint: dv !== null ? L(`${LANG}.Ladder.DV`, { dv, n: counts.awake + Math.floor(counts.asleep / 2) }) : L(`${LANG}.Ladder.Hint.${level}`),
      top: level === "spotted",
      bottom: level === "unaware"
    };
  },

  async set(combat, level) {
    if (!combat || !LADDER.includes(level)) return;
    await combat.setFlag(MODULE_ID, "ladder", level);
  },

  /** A failed Stealth roll moves them a step up; calming down, a step down. */
  step(combat, dir) {
    return this.set(combat, ladderStep(this.level(combat), dir));
  },

  /** Something obvious (a gunshot, a scream, a body): straight to Alert. */
  obvious(combat) {
    const at = LADDER.indexOf(this.level(combat));
    return this.set(combat, LADDER[Math.max(at, LADDER.indexOf("alert"))]);
  }
};
