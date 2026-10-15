import { MODULE_ID, SYSTEM_ID, LANG, FLAGS } from "../constants.js";
import { Settings } from "../settings.js";
import { CONDITIONS, CORE_STATUS_IDS } from "./data.js";
import { cprChanges } from "./cpr-flags.js";
import { slug } from "../util.js";

const { deepClone } = foundry.utils;

/** Sight keys a "sight" penalty spreads over, from the settings ("perceptionSight, ranged, melee"). */
export function sightKeys(list = Settings.list("sightKeys")) {
  return list.map((k) => (k.startsWith("bonuses.") ? k : `bonuses.${k}`));
}

/** A sight penalty as changes: situational, on by default, so the roll dialog shows each one. */
export function sightChanges(value, keys = sightKeys()) {
  const n = Number(value) || 0;
  if (!n) return [];
  return keys.map((key) => ({ key, value: n, situational: true, onByDefault: true }));
}

/**
 * Every condition the world knows: the built-in set, conditions other modules register, and the
 * GM's custom ones, each with the GM's overrides from the Condition Lab applied.
 */
export const Registry = {
  /** Conditions registered by other modules (api.conditions.register), by id. */
  extra: new Map(),
  /** Resolved conditions by id; rebuilt by refresh(). */
  _all: new Map(),

  register(def, source = "module") {
    if (!def?.id) throw new Error(`${MODULE_ID} | a condition needs an id`);
    this.extra.set(def.id, { category: "custom", ...deepClone(def), source });
    if (this._ready) this.refresh();
  },

  /** Rebuild the resolved list and CONFIG.statusEffects. */
  refresh() {
    const overrides = Settings.get("conditionOverrides") ?? {};
    const custom = (Settings.get("customConditions") ?? []).map((c) => ({ category: "custom", ...c, source: "custom" }));
    const base = [...CONDITIONS.map((c) => ({ ...c, source: "core" })), ...this.extra.values(), ...custom];
    this._all = new Map();
    for (const def of base) this._all.set(def.id, this.resolve(def, overrides[def.id]));
    this._ready = true;
    this.applyStatusEffects();
  },

  /** A definition with an override applied and its name, hint and changes ready to use. */
  resolve(def, override = null) {
    const o = override ?? {};
    const c = { ...deepClone(def), ...deepClone(o) };
    c.override = !!override;
    c.name = o.name || (def.name ? game.i18n.localize(def.name) : game.i18n.localize(`${LANG}.Condition.${def.id}.name`));
    c.hint = o.hint ?? (def.hint ? game.i18n.localize(def.hint) : game.i18n.localize(`${LANG}.Condition.${def.id}.hint`));
    if (c.hint === `${LANG}.Condition.${def.id}.hint`) c.hint = "";
    // A sight penalty becomes changes on the configured sight keys.
    const sight = Number(o.sight ?? def.sight) || 0;
    const own = o.changes ?? def.changes ?? [];
    c.rawChanges = [...own.map((ch) => ({ ...ch })), ...sightChanges(sight)];
    c.disabled = !!o.disabled;
    c.hud = o.hud ?? def.hud ?? true;
    return c;
  },

  all() {
    return [...this._all.values()];
  },

  enabled() {
    return this.all().filter((c) => !c.disabled);
  },

  /** A condition by id, or by name (as shown, or its English/system name), loosely. */
  get(idOrName) {
    if (!idOrName) return null;
    if (typeof idOrName === "object" && idOrName.id) return this._all.get(idOrName.id) ?? null;
    const key = String(idOrName);
    if (this._all.has(key)) return this._all.get(key);
    const s = slug(key);
    return this.all().find((c) => slug(c.name) === s || slug(c.id) === s || slug(c.critical?.name) === s) ?? null;
  },

  /** The condition an effect carries (ours, or a status id that maps to one). */
  ofEffect(effect) {
    const id = effect?.getFlag?.(MODULE_ID, FLAGS.condition) ?? effect?.flags?.[MODULE_ID]?.[FLAGS.condition];
    if (id && this._all.has(id)) return this._all.get(id);
    for (const s of effect?.statuses ?? []) if (this._all.has(s)) return this._all.get(s);
    return null;
  },

  /* ---------------------------------------- */
  /*  Effects                                 */
  /* ---------------------------------------- */

  /**
   * ActiveEffect data for a condition: its statuses, changes in CPR's shape and CPR's flags.
   * @param {object} c - resolved condition
   * @param {object} [options] - changes: replace the condition's own changes (weather and
   *   visibility work theirs out per character); duration: seconds; name: shown name; flags: merged in
   */
  effectData(c, { changes = null, duration = null, name = null, flags = {}, origin = null } = {}) {
    const raw = changes ?? c.rawChanges ?? [];
    const { changes: list, flags: cprFlags } = cprChanges(raw);
    const seconds = duration ?? c.duration ?? null;
    const data = {
      name: name ?? c.name,
      img: c.img,
      description: c.hint ?? "",
      statuses: [c.id],
      changes: list,
      disabled: false,
      flags: foundry.utils.mergeObject(
        {
          [MODULE_ID]: { [FLAGS.condition]: c.id },
          [SYSTEM_ID]: { changes: cprFlags },
          core: { overlay: !!c.overlay }
        },
        flags,
        { inplace: false }
      )
    };
    if (seconds) data.duration = { seconds: Number(seconds), startTime: game.time?.worldTime ?? 0 };
    if (origin) data.origin = origin;
    return data;
  },

  /* ---------------------------------------- */
  /*  Token HUD                               */
  /* ---------------------------------------- */

  /** CONFIG.statusEffects entry for a condition. */
  statusEffect(c) {
    const data = this.effectData(c);
    delete data.statuses;
    delete data.disabled;
    if (data.duration) delete data.duration.startTime;
    return { id: c.id, ...data, hud: c.hud !== false };
  },

  /**
   * Put the enabled conditions into CONFIG.statusEffects. With "replace Foundry's statuses" on
   * (the default), Foundry's generic list goes; statuses other modules added (Neon At Home's
   * encumbrance, for one) stay.
   */
  applyStatusEffects() {
    if (!this._original) this._original = [...CONFIG.statusEffects];
    const ours = new Set(this.all().map((c) => c.id));
    const replace = Settings.get("replaceStatuses");
    // Others' statuses: those there at first (Foundry's and other modules') and any added since.
    const seen = new Set();
    const kept = [...this._original, ...CONFIG.statusEffects].filter((s) => {
      if (!s?.id || seen.has(s.id)) return false;
      seen.add(s.id);
      if (ours.has(s.id) || s.flags?.[MODULE_ID]?.[FLAGS.condition]) return false;
      return !(replace && CORE_STATUS_IDS.includes(s.id));
    });
    CONFIG.statusEffects = [...this.enabled().map((c) => this.statusEffect(c)), ...kept];
    // Foundry's "defeated" status is ours.
    if (CONFIG.specialStatusEffects) {
      CONFIG.specialStatusEffects.DEFEATED = "dead";
      CONFIG.specialStatusEffects.BLIND = "blind";
    }
    Hooks.callAll(`${MODULE_ID}.statusEffectsChanged`, CONFIG.statusEffects);
  }
};
