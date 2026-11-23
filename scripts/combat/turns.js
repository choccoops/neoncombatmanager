import { MODULE_ID, HOOKS, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { Cards } from "./cards.js";
import { L, esc } from "../util.js";
import { stepPath } from "../ruler/ruler-core.js";

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
    Hooks.on("updateToken", (token, changed, options) => this.onMove(token, changed, options));
    // Where every token stands, as this client last saw it: a move is measured from there.
    Hooks.on("canvasReady", () => this.seeAll());
    Hooks.on("createToken", (token) => this.see(token));
    Hooks.on("deleteToken", (token) => this.pos.delete(token.id));
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
    // An interrupt takes the Turn and hands it back: nobody's Turn starts or ends by it.
    if (options?.[MODULE_ID]?.interrupt) return;
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
    if (this.lockNext.delete(combatant.id)) {
      await Cards.reminder(actor, null, L(`${LANG}.Reminder.noMove`, { name: esc(actor.name) }));
      // The movement ruler shows only the Run left this Turn.
      if (Settings.get("trackMovement")) {
        const t = combatant.token;
        await this._keepPath(combatant, () => ({ points: t ? [this.centre(t)] : [], metres: 0, noMove: true }));
      }
    }
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
    const { total, roll } = await Conditions.roll(spec.damage, actor);
    await Cards.damage(actor, { amount: total, roll, armor: !!spec.armor, reason: c.name, condition: c.id });
  },

  /* ---------------------------------------- */
  /*  Movement                                */
  /* ---------------------------------------- */

  /** token id -> { x, y, width, height, grid } where it stood when this client last saw it move (or first saw it). */
  pos: new Map(),

  see(token) {
    if (!token?.id) return;
    this.pos.set(token.id, { x: token.x, y: token.y, width: token.width, height: token.height, parent: token.parent });
  },

  seeAll() {
    this.pos.clear();
    for (const t of canvas?.scene?.tokens ?? []) this.see(t);
  },

  resetMove(combatant) {
    // The combatant's own token; failing that (a combat not tied to its scene), the one on the canvas.
    const t = combatant.token ?? canvas?.scene?.tokens?.get?.(combatant.tokenId) ?? null;
    if (t) this.see(t);
    this.moved.set(combatant.id, { metres: 0, points: t ? [this.centre(t)] : [] });
    // The path walked this Turn, for every client's movement ruler (scripts/ruler/ruler.js).
    if (Compat.isActiveGM && Settings.get("trackMovement")) {
      const c = t ? this.centre(t) : null;
      this._keepPath(combatant, () => ({ points: c ? [c] : [], metres: 0, noMove: false }));
    }
  },

  /** combatant id -> the write of its path under way. */
  _writes: new Map(),

  /**
   * Write a combatant's path, one write at a time. Foundry sends only what differs from what
   * this client last heard back, so a second write made before the first had returned was
   * measured against the old Turn's numbers: a first move as long as last Turn's total went
   * out with no distance at all, and the sums after it were off. Each write now waits for the
   * one before, and works out what to write when its turn comes.
   * @param {Combatant} combatant
   * @param {(path: object) => object} make - the path to write, from the one the combatant carries then
   */
  _keepPath(combatant, make) {
    if (typeof combatant?.setFlag !== "function") return Promise.resolve(null);
    const prev = this._writes.get(combatant.id) ?? Promise.resolve();
    const next = prev.then(() => combatant.setFlag(MODULE_ID, "path", make(combatant.flags?.[MODULE_ID]?.path ?? {}))).catch(() => null);
    this._writes.set(combatant.id, next);
    next.then(() => {
      if (this._writes.get(combatant.id) === next) this._writes.delete(combatant.id);
    });
    return next;
  },

  centre(token) {
    const grid = token.parent?.grid?.size ?? canvas?.dimensions?.size ?? 100;
    return { x: token.x + ((Number(token.width) || 1) * grid) / 2, y: token.y + ((Number(token.height) || 1) * grid) / 2 };
  },

  /**
   * A token moved. Whoever it is, where it stands is noted (the next move is measured from
   * there). For the current combatant's (active GM) the distance is added up: every move costs
   * what it measures, whichever way; only Foundry's undo (Ctrl+Z) gives one back; a move that
   * wasn't theirs to make (thrown, pushed, dodging out of a blast) costs nothing.
   */
  onMove(token, changed, options = {}) {
    if (!("x" in changed || "y" in changed)) return;
    const stood = this.pos.get(token.id) ?? null;
    this.see(token);
    if (!Compat.isActiveGM) return;
    const combat = game.combats?.find((c) => c.started && c.combatant?.tokenId === token.id && (!c.scene || c.scene.id === token.parent?.id));
    if (!combat) return;
    const cb = combat.combatant;
    const path = cb.flags?.[MODULE_ID]?.path ?? {};
    // This Turn's sums so far: this client's own, else what the combatant carries (a reload mid-Turn).
    const entry = this.moved.get(cb.id) ?? { metres: Number(path.metres) || 0, points: Array.isArray(path.points) ? path.points : [] };
    if (!Array.isArray(entry.points)) entry.points = Array.isArray(path.points) ? path.points : [];
    const to = this.centre(token);
    const from = stood ? this.centre({ ...stood, parent: token.parent }) : entry.points.at(-1) ?? null;
    const next = stepPath(entry, { from, to, distance: from ? Compat.measure(from, to) : 0, undo: !!options?.isUndo, forced: !!options?.[MODULE_ID]?.free });
    this.moved.set(cb.id, { metres: next.metres, points: next.points });
    if (Settings.get("trackMovement")) {
      const points = next.points.slice(-60);
      const metres = next.metres;
      this._keepPath(cb, (now) => ({ ...now, points, metres }));
    }
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
