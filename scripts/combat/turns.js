import { MODULE_ID, HOOKS, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { Cards } from "./cards.js";
import { L, esc } from "../util.js";

/** Moving more than this many m/yds on foot in a Turn reopens some Critical Injuries (p.187-188). */
export const MOVE_LIMIT = 4;

/**
 * Turn automation, run by the active GM as the Initiative Queue moves on:
 *  - Turn start: Death Save for the Mortally Wounded (p.188), Drowning and Asphyxiation damage
 *    (p.180), Spinal Injury's lost Action, the Move Action lost to Damaged/Lost Ear or a flashbang.
 *  - Turn end: fire and high radiation damage (p.180-181), electrocution, and Broken Ribs or a
 *    Foreign Object reopening when the character moved more than 4 m/yds on foot.
 * Hooks cpr-neon-combat-manager.turnStart / turnEnd (combat, combatant) fire for other modules.
 */
export const Turns = {
  /** Last Turn seen per combat: { round, turn, combatantId }. */
  last: new Map(),
  /** Metres moved this Turn per combatant, and where its token last stood. */
  moved: new Map(),
  /** Combatants who can't take a Move Action on their next Turn. */
  lockNext: new Set(),

  init() {
    Hooks.on("updateCombat", (combat, changed, options) => this.onUpdate(combat, changed, options));
    Hooks.on("deleteCombat", (combat) => this.last.delete(combat.id));
    Hooks.on("updateToken", (token, changed) => this.onMove(token, changed));
  },

  state(combat) {
    return { round: combat.round, turn: combat.turn, combatantId: combat.combatant?.id ?? null };
  },

  onUpdate(combat, changed, options) {
    if (!Compat.isActiveGM || !combat.started) return;
    if (!("turn" in changed) && !("round" in changed)) return;
    const prev = this.last.get(combat.id) ?? (combat.previous?.combatantId ? { ...combat.previous } : null);
    const cur = this.state(combat);
    this.last.set(combat.id, cur);
    const back = (options?.direction ?? 1) < 0 || (prev && (cur.round < prev.round || (cur.round === prev.round && cur.turn < prev.turn)));
    if (back || (prev && prev.combatantId === cur.combatantId && prev.round === cur.round)) return;
    this._run(combat, prev, cur).catch((err) => console.error(`${MODULE_ID} | turn automation failed`, err));
  },

  async _run(combat, prev, cur) {
    const ended = prev?.combatantId ? combat.combatants.get(prev.combatantId) : null;
    if (ended) {
      await this.turnEnd(combat, ended);
      Hooks.callAll(HOOKS.turnEnd, combat, ended);
    }
    const started = cur.combatantId ? combat.combatants.get(cur.combatantId) : null;
    if (started) {
      await this.turnStart(combat, started);
      Hooks.callAll(HOOKS.turnStart, combat, started);
    }
  },

  async turnStart(combat, combatant) {
    const actor = combatant.actor;
    this.resetMove(combatant);
    if (!actor || combatant.defeated || Conditions.has("dead", actor)) return;
    const conditions = Conditions.active(actor);

    if (Settings.get("deathSaves") && CPR.isMeat(actor) && CPR.woundState(actor) === "mortallyWounded") await Cards.deathSave(actor);

    for (const c of conditions) {
      if (c.turnStart?.damage) await this._damage(actor, c, c.turnStart);
      if (c.remindOnce) {
        const effect = Conditions.effects(actor, c.id)[0];
        if (effect && !effect.getFlag(MODULE_ID, "reminded")) {
          await Cards.reminder(actor, c, L(`${LANG}.Reminder.${c.id}`));
          await effect.setFlag(MODULE_ID, "reminded", true);
        }
      }
      if (c.id === "suppressed") await Cards.reminder(actor, c, L(`${LANG}.Reminder.suppressed`));
    }
    if (this.lockNext.delete(combatant.id)) await Cards.reminder(actor, null, L(`${LANG}.Reminder.noMove`, { name: esc(actor.name) }));
  },

  async turnEnd(combat, combatant) {
    const actor = combatant.actor;
    if (!actor || combatant.defeated || Conditions.has("dead", actor)) return;
    const conditions = Conditions.active(actor);
    for (const c of conditions) if (c.turnEnd?.damage) await this._damage(actor, c, c.turnEnd);

    const metres = this.moved.get(combatant.id)?.metres ?? 0;
    if (Settings.get("trackMovement") && metres > MOVE_LIMIT) {
      for (const c of conditions) {
        if (c.moveDamage) await Cards.damage(actor, { amount: c.moveDamage, reason: L(`${LANG}.Reminder.reopened`, { condition: c.name, metres: Math.round(metres) }), condition: c.id });
        if (c.moveLock) this.lockNext.add(combatant.id);
      }
    }
  },

  async _damage(actor, c, spec) {
    const { total, roll } = Conditions.formula(spec.damage, actor);
    await Cards.damage(actor, { amount: total, roll, armor: !!spec.armor, reason: c.name, condition: c.id });
  },

  /* ---------------------------------------- */
  /*  Movement                                */
  /* ---------------------------------------- */

  resetMove(combatant) {
    const t = combatant.token;
    this.moved.set(combatant.id, { metres: 0, at: t ? { x: t.x, y: t.y } : null });
  },

  /** The current combatant's token moved: add up the distance (active GM). */
  onMove(token, changed) {
    if (!Compat.isActiveGM || !("x" in changed || "y" in changed)) return;
    const combat = game.combats?.find((c) => c.started && c.combatant?.tokenId === token.id && (!c.scene || c.scene.id === token.parent?.id));
    if (!combat) return;
    const cb = combat.combatant;
    const entry = this.moved.get(cb.id) ?? { metres: 0, at: null };
    const now = { x: token.x, y: token.y };
    if (entry.at) {
      const grid = token.parent?.grid?.size ?? canvas?.dimensions?.size ?? 100;
      const half = { x: (token.width * grid) / 2, y: (token.height * grid) / 2 };
      entry.metres += Compat.measure({ x: entry.at.x + half.x, y: entry.at.y + half.y }, { x: now.x + half.x, y: now.y + half.y });
    }
    entry.at = now;
    this.moved.set(cb.id, entry);
  },

  /** Metres the current combatant has moved this Turn. */
  metres(combatantId) {
    return this.moved.get(combatantId)?.metres ?? 0;
  },

  /** Registry of conditions with Turn automation, for the Condition Lab. */
  automated() {
    return Registry.all().filter((c) => c.turnStart || c.turnEnd || c.moveDamage || c.moveLock || c.remindOnce);
  }
};
