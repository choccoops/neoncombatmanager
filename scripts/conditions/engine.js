import { MODULE_ID, SYSTEM_ID, FLAGS, HOOKS, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Registry } from "./registry.js";
import { needsRepair, repairFlags } from "./cpr-flags.js";
import { Cards } from "../combat/cards.js";
import { L, esc } from "../util.js";

const { getProperty } = foundry.utils;

/** Options marking our own writes, so the hooks don't run their side effects twice. */
const QUIET = { [MODULE_ID]: { quiet: true } };

/**
 * Neon Conditions: add, remove and query conditions on actors and tokens, and everything that
 * happens around them (Critical Injury items, exclusive groups, drugs wearing off, defeated
 * combatants, chat). Side effects run from the document hooks, so a condition placed through the
 * token HUD, a macro or another module behaves the same as one placed through this API.
 */
export const Conditions = {
  /* ---------------------------------------- */
  /*  Targets                                 */
  /* ---------------------------------------- */

  /** Actors from Actors, Tokens, TokenDocuments, uuids or arrays of them; default: controlled tokens, else your character. */
  actorsOf(entities = null) {
    let list = entities;
    if (list === null || list === undefined) {
      const controlled = canvas?.tokens?.controlled ?? [];
      list = controlled.length ? controlled : game.user.character ? [game.user.character] : [];
    }
    if (!Array.isArray(list) && !(list instanceof Set)) list = [list];
    const out = [];
    for (let e of list) {
      if (typeof e === "string") e = fromUuidSync(e);
      const actor = e?.documentName === "Actor" ? e : e?.actor ?? e?.document?.actor ?? null;
      if (actor && !out.includes(actor)) out.push(actor);
    }
    return out;
  },

  /** The effects carrying a condition (all of ours without an id). */
  effects(actor, idOrName = null) {
    const c = idOrName ? Registry.get(idOrName) : null;
    if (idOrName && !c) return [];
    return (actor?.effects ?? []).filter((e) => {
      const ec = Registry.ofEffect(e);
      return ec && (!c || ec.id === c.id);
    });
  },

  has(idOrName, entity) {
    const c = Registry.get(idOrName);
    if (!c) return false;
    return this.actorsOf(entity).some((a) => this.effects(a, c.id).length > 0 || a.statuses?.has?.(c.id));
  },

  /** Conditions on an actor (resolved, each once). */
  active(entity) {
    const [actor] = this.actorsOf(entity);
    const out = new Map();
    for (const e of actor?.effects ?? []) {
      const c = Registry.ofEffect(e);
      if (c && !out.has(c.id)) out.set(c.id, c);
    }
    return [...out.values()];
  },

  /* ---------------------------------------- */
  /*  Adding and removing                     */
  /* ---------------------------------------- */

  /**
   * Add conditions.
   * @param {string|string[]} ids - condition ids or names
   * @param {*} entities - see actorsOf
   * @param {object} [options] - changes, duration, name (per-character values, for automation),
   *   managed (who manages it: "env", "wound"...), allowDuplicates, force (ignore immunity)
   * @returns {Promise<ActiveEffect[]>}
   */
  async add(ids, entities = null, options = {}) {
    const made = [];
    for (const actor of this.actorsOf(entities)) {
      for (const id of [ids].flat()) {
        const c = Registry.get(id);
        if (!c) {
          ui.notifications?.warn(L(`${LANG}.Error.NoCondition`, { name: esc(id) }));
          continue;
        }
        const effect = await this._addOne(actor, c, options);
        if (effect) made.push(effect);
      }
    }
    return made;
  },

  async _addOne(actor, c, options) {
    if (!actor.isOwner) return Socket.request("addCondition", { actor: actor.uuid, id: c.id, options });
    if (!options.force && c.immune?.items?.length && CPR.hasGear(actor, c.immune.items)) {
      ui.notifications?.info(L(`${LANG}.Notify.Immune`, { name: actor.name, condition: c.name }));
      return null;
    }
    const existing = this.effects(actor, c.id);
    if (existing.length && !options.allowDuplicates) {
      // Automation refreshing its numbers: update in place.
      if (options.changes || options.name) return this._refresh(existing[0], c, options);
      return existing[0];
    }
    const flags = options.managed ? { [MODULE_ID]: { [FLAGS.managed]: options.managed } } : {};
    const data = Registry.effectData(c, { changes: options.changes, duration: options.duration, name: options.name, flags: { ...flags, ...(options.flags ?? {}) } });
    const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [data], { [MODULE_ID]: { source: options.managed ?? "api" } });
    return effect ?? null;
  },

  /** Update an automated condition's numbers (weather, visibility) when they changed. */
  async _refresh(effect, c, { changes = null, name = null } = {}) {
    const data = Registry.effectData(c, { changes, name });
    const same = effect.name === data.name
      && JSON.stringify(effect.changes.map((x) => [x.key, String(x.value)])) === JSON.stringify(data.changes.map((x) => [x.key, String(x.value)]))
      && JSON.stringify(getProperty(effect, `flags.${SYSTEM_ID}.changes.situational`) ?? {}) === JSON.stringify(data.flags[SYSTEM_ID].changes.situational);
    if (same) return effect;
    await effect.update({ name: data.name, changes: data.changes, [`flags.${SYSTEM_ID}.changes`]: data.flags[SYSTEM_ID].changes }, QUIET);
    return effect;
  },

  /**
   * Remove conditions.
   * @param {object} [options] - managed: only effects that system placed
   */
  async remove(ids, entities = null, options = {}) {
    for (const actor of this.actorsOf(entities)) {
      if (!actor.isOwner) {
        await Socket.request("removeCondition", { actor: actor.uuid, ids: [ids].flat(), options });
        continue;
      }
      const remove = [ids].flat().flatMap((id) => this.effects(actor, id))
        .filter((e) => !options.managed || e.getFlag(MODULE_ID, FLAGS.managed) === options.managed)
        .map((e) => e.id);
      if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", [...new Set(remove)]);
    }
  },

  async toggle(idOrName, entities = null, { active = null, ...options } = {}) {
    for (const actor of this.actorsOf(entities)) {
      const on = this.has(idOrName, actor);
      const want = active ?? !on;
      if (want && !on) await this.add(idOrName, actor, options);
      else if (!want && on) await this.remove(idOrName, actor, options);
    }
  },

  /** Remove every condition (of a category, if given). */
  async removeAll(entities = null, { category = null } = {}) {
    for (const actor of this.actorsOf(entities)) {
      const ids = this.active(actor).filter((c) => !category || c.category === category).map((c) => c.id);
      if (ids.length) await this.remove(ids, actor);
    }
  },

  /* ---------------------------------------- */
  /*  Document hooks                          */
  /* ---------------------------------------- */

  /** One client runs side effects: the active GM, or the acting user when no GM is on. */
  _runs(userId) {
    return Compat.activeGM ? Compat.isActiveGM : userId === game.user.id;
  },

  /**
   * Before an effect is made (on the creating client): give it CPR's bookkeeping, tag it with
   * its condition, start its clock, and refuse it when the bearer is immune.
   */
  onPreCreate(effect, data, options, userId) {
    if (userId !== game.user.id) return true;
    const update = {};
    if (needsRepair(effect)) update[`flags.${SYSTEM_ID}.changes`] = repairFlags(effect.changes, effect.flags?.[SYSTEM_ID]?.changes);
    const c = Registry.ofEffect(effect);
    if (c) {
      if (!effect.flags?.[MODULE_ID]?.[FLAGS.condition]) update[`flags.${MODULE_ID}.${FLAGS.condition}`] = c.id;
      if (effect.duration?.seconds && !Number.isFinite(effect.duration?.startTime)) update["duration.startTime"] = game.time.worldTime;
      const actor = effect.parent;
      if (!options?.[MODULE_ID]?.source && c.immune?.items?.length && actor?.documentName === "Actor" && CPR.hasGear(actor, c.immune.items)) {
        ui.notifications?.info(L(`${LANG}.Notify.Immune`, { name: actor.name, condition: c.name }));
        return false;
      }
    }
    if (Object.keys(update).length) effect.updateSource(update);
    return true;
  },

  onCreate(effect, options, userId) {
    const c = Registry.ofEffect(effect);
    const actor = effect.parent;
    if (!c || actor?.documentName !== "Actor") return;
    Hooks.callAll(HOOKS.conditionAdded, actor, c, effect);
    if (options?.[MODULE_ID]?.quiet || !this._runs(userId)) return;
    this._afterCreate(actor, c, effect, options).catch((err) => console.error(`${MODULE_ID} | after adding ${c.id}`, err));
  },

  async _afterCreate(actor, c, effect, options) {
    // Only one of a group (one Wound State, one fire, one visibility level). Automation only
    // replaces automation's own: a condition the GM placed by hand stays.
    if (c.group) {
      const auto = !!effect.getFlag(MODULE_ID, FLAGS.managed);
      const others = actor.effects.filter((e) => e.id !== effect.id && Registry.ofEffect(e)?.group === c.group && Registry.ofEffect(e)?.id !== c.id
        && (!auto || !!e.getFlag(MODULE_ID, FLAGS.managed)));
      if (others.length) await actor.deleteEmbeddedDocuments("ActiveEffect", others.map((e) => e.id), QUIET);
    }
    if (c.critical && !effect.getFlag(MODULE_ID, FLAGS.item)) await this._linkCritical(actor, c, effect, options);
    for (const id of c.also ?? []) if (!this.has(id, actor)) await this.add(id, actor, { duration: c.duration });
    if (c.purges?.length) {
      const purge = this.active(actor).filter((x) => x.id !== c.id && c.purges.includes(x.category) && !x.addiction).map((x) => x.id);
      if (purge.length) await this.remove(purge, actor);
    }
    if (c.heal && CPR.woundState(actor) !== "mortallyWounded") {
      const healed = await CPR.healHP(actor, this.formula(c.heal, actor).total);
      if (healed) await Cards.note(actor, L(`${LANG}.Card.Healed`, { name: esc(actor.name), amount: healed, condition: esc(c.name) }));
    }
    if (c.stabilize && CPR.woundState(actor) === "mortallyWounded") {
      await actor.update({ "system.derivedStats.hp.value": 1 });
      await CPR.resetDeathPenalty(actor);
      await this.add("unconscious", actor, { duration: 60 });
    }
    if (c.defeated) await this._setDefeated(actor, true);
    await this.syncSuppressed(actor);
    if (!effect.getFlag(MODULE_ID, FLAGS.managed)) await Cards.condition(actor, c, true);
  },

  onDelete(effect, options, userId) {
    const c = Registry.ofEffect(effect);
    const actor = effect.parent;
    if (!c || actor?.documentName !== "Actor") return;
    Hooks.callAll(HOOKS.conditionRemoved, actor, c, effect);
    if (!this._runs(userId)) return;
    this._afterDelete(actor, c, effect, options).catch((err) => console.error(`${MODULE_ID} | after removing ${c.id}`, err));
  },

  async _afterDelete(actor, c, effect, options) {
    const itemId = effect.getFlag(MODULE_ID, FLAGS.item);
    if (itemId && !options?.[MODULE_ID]?.fromItem && actor.items.has(itemId)) {
      await actor.deleteEmbeddedDocuments("Item", [itemId], { [MODULE_ID]: { fromCondition: true } });
    }
    if (c.defeated && !this.has(c.id, actor)) await this._setDefeated(actor, false);
    await this.syncSuppressed(actor);
  },

  /** Effects that change (repair CPR's flags if another module dropped them). */
  onPreUpdate(effect, changes, options, userId) {
    if (userId !== game.user.id || !("changes" in (changes ?? {}))) return;
    const next = changes.changes ?? [];
    const flags = getProperty(changes, `flags.${SYSTEM_ID}.changes`) ?? effect.flags?.[SYSTEM_ID]?.changes;
    if (needsRepair({ changes: next, flags: { [SYSTEM_ID]: { changes: flags } } })) {
      foundry.utils.setProperty(changes, `flags.${SYSTEM_ID}.changes`, repairFlags(next, flags));
    }
  },

  /* ---------------------------------------- */
  /*  Critical Injuries                       */
  /* ---------------------------------------- */

  /**
   * A Critical Injury condition placed on an actor: give them Cyberpunk RED's own Critical
   * Injury item (the system's effect then applies the penalties and the Death Save increase),
   * and turn the condition into a marker that shows it on the token. Without the item (no
   * compendium, setting off) the condition keeps its own changes.
   */
  async _linkCritical(actor, c, effect, options) {
    let item = CPR.critItem(actor, c.critical.name);
    if (!item && Settings.get("critItems") && !options?.[MODULE_ID]?.fromItem) {
      const data = await CPR.critItemData(c.critical.location, c.critical.name);
      if (data) [item] = await actor.createEmbeddedDocuments("Item", [data], { [MODULE_ID]: { fromCondition: true } });
    }
    if (!item) return;
    await effect.update({
      changes: [],
      [`flags.${MODULE_ID}.${FLAGS.item}`]: item.id,
      [`flags.${SYSTEM_ID}.changes`]: { cats: {}, situational: {} }
    }, QUIET);
  },

  /** A Critical Injury item arrived some other way (rolled on CPR's tables, dragged on): show it. */
  async onCreateItem(item, options, userId) {
    if (item.type !== "criticalInjury" || options?.[MODULE_ID]?.fromCondition || !this._runs(userId)) return;
    if (!Settings.get("mirrorCriticals")) return;
    const actor = item.parent;
    const c = Registry.all().find((x) => x.critical && x.critical.name.toLowerCase() === item.name.toLowerCase());
    if (!actor || !c || c.disabled) return;
    if (actor.effects.some((e) => e.getFlag(MODULE_ID, FLAGS.item) === item.id)) return;
    await this.add(c.id, actor, { allowDuplicates: true, changes: [], managed: "critical", flags: { [MODULE_ID]: { [FLAGS.item]: item.id } } });
  },

  async onDeleteItem(item, options, userId) {
    if (item.type !== "criticalInjury" || options?.[MODULE_ID]?.fromCondition || !this._runs(userId)) return;
    const actor = item.parent;
    const markers = actor?.effects.filter((e) => e.getFlag(MODULE_ID, FLAGS.item) === item.id) ?? [];
    if (markers.length) await actor.deleteEmbeddedDocuments("ActiveEffect", markers.map((e) => e.id), { [MODULE_ID]: { fromItem: true } });
  },

  /* ---------------------------------------- */
  /*  Addictions                              */
  /* ---------------------------------------- */

  /**
   * An addiction's penalty is off while its drug's Primary Effect runs (Black Lace, Synthcoke):
   * switch the changes off and keep them in a flag, and back on when the drug is gone.
   */
  async syncSuppressed(actor) {
    const present = new Set(this.active(actor).map((c) => c.id));
    for (const e of this.effects(actor)) {
      const c = Registry.ofEffect(e);
      if (!c?.suppressedBy?.length) continue;
      const off = c.suppressedBy.some((id) => present.has(id));
      const stored = e.getFlag(MODULE_ID, "suppressed");
      if (off && !stored && e.changes.length) {
        await e.update({ changes: [], [`flags.${MODULE_ID}.suppressed`]: e.changes.map((x) => ({ ...x })), [`flags.${SYSTEM_ID}.changes`]: { cats: {}, situational: {} } }, QUIET);
      } else if (!off && stored) {
        const data = Registry.effectData(c);
        await e.update({ changes: stored, [`flags.${MODULE_ID}.-=suppressed`]: null, [`flags.${SYSTEM_ID}.changes`]: data.flags[SYSTEM_ID].changes }, QUIET);
      }
    }
  },

  /* ---------------------------------------- */
  /*  Time                                    */
  /* ---------------------------------------- */

  /** Actors whose timed conditions are checked: world actors and the unlinked tokens in play. */
  _actorsInPlay() {
    const set = new Set(game.actors?.contents ?? []);
    for (const scene of [game.scenes?.active, canvas?.scene].filter(Boolean)) {
      for (const t of scene.tokens ?? []) if (t.actor && !t.actorLink) set.add(t.actor);
    }
    for (const combat of game.combats ?? []) for (const cb of combat.combatants ?? []) if (cb.actor) set.add(cb.actor);
    return [...set];
  },

  /** Active GM, as world time moves: end conditions whose time is up. */
  async expire(worldTime = game.time.worldTime) {
    if (!Compat.isActiveGM) return;
    for (const actor of this._actorsInPlay()) {
      const done = actor.effects.filter((e) => {
        if (!Registry.ofEffect(e)) return false;
        const secs = Number(e.duration?.seconds) || 0;
        const start = Number(e.duration?.startTime);
        return secs > 0 && Number.isFinite(start) && start + secs <= worldTime;
      });
      if (!done.length) continue;
      const ended = done.map((e) => Registry.ofEffect(e));
      await actor.deleteEmbeddedDocuments("ActiveEffect", done.map((e) => e.id));
      for (const c of ended) if (c?.secondary) await Cards.secondary(actor, c);
    }
  },

  /**
   * Evaluate "@body", "@body+@will", "2" or "6d6" against an actor; dice are rolled.
   * @returns {{ total: number, roll: Roll|null }}
   */
  formula(expr, actor) {
    const text = String(expr ?? "0").replace(/@(\w+)/g, (m, stat) => String(CPR.stat(actor, stat)));
    if (/d/i.test(text)) {
      const roll = new Roll(text);
      if (typeof roll.evaluateSync === "function") roll.evaluateSync();
      else roll.evaluate({ async: false });
      return { total: Number(roll.total) || 0, roll };
    }
    // Only digits, + and - remain: add them up.
    return { total: text.split(/(?=[+-])/).reduce((sum, part) => sum + (Number(part) || 0), 0), roll: null };
  },

  /* ---------------------------------------- */
  /*  Combat                                  */
  /* ---------------------------------------- */

  async _setDefeated(actor, defeated) {
    const combatants = [...(game.combats ?? [])].flatMap((cb) => cb.combatants.filter((x) => x.actor === actor || (x.actorId === actor.id && x.token?.actorLink)));
    for (const cb of combatants) if (cb.defeated !== defeated) await cb.update({ defeated });
  },

  /* ---------------------------------------- */
  /*  Socket                                  */
  /* ---------------------------------------- */

  registerSocket() {
    Socket.on("addCondition", async ({ actor, id, options }) => {
      const doc = await fromUuid(actor);
      const [effect] = await this.add(id, doc, options);
      return effect?.id ?? null;
    });
    Socket.on("removeCondition", async ({ actor, ids, options }) => {
      const doc = await fromUuid(actor);
      await this.remove(ids, doc, options);
      return true;
    });
  }
};
