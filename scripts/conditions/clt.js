import { MODULE_ID, CLT_ID, SYSTEM_ID, FLAGS } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Registry } from "./registry.js";
import { Conditions } from "./engine.js";
import { repairFlags } from "./cpr-flags.js";
import { slug } from "../util.js";

/** Names Condition Lab & Triggler's Cyberpunk RED map spelled its own way. */
const ALIASES = {
  aspyhixiating: "asphyxiating",
  unconcious: "unconscious",
  blinded: "blind",
  deafened: "deaf",
  emp: "emp",
  quickfix: null,
  speedheal: "speedheal",
  foreignobjectbody: "foreignObject",
  foreignobjecthead: "foreignObjectHead",
  smashaddicition: "smashAddiction",
  onfiremild: "onFireMild",
  onfirestrong: "onFireStrong",
  onfiredeadly: "onFireDeadly",
  radiationlow: "radiationLow",
  radiationhigh: "radiationHigh"
};

/**
 * Match Condition Lab & Triggler conditions to Neon Conditions, and make the rest custom ones.
 * @param {object[]} map - CLT's condition map entries: { id, name, icon|img, activeEffect, options }
 * @returns {{ matches: Object<string,string>, custom: object[] }} matches: CLT id -> our id
 */
export function fromClt(map, find = (name) => Registry.get(name)) {
  const matches = {};
  const custom = [];
  for (const entry of map ?? []) {
    if (!entry?.name) continue;
    const s = slug(entry.name);
    const alias = s in ALIASES ? ALIASES[s] : undefined;
    const ours = alias === null ? null : find(alias ?? entry.name);
    if (ours) {
      matches[entry.id] = ours.id;
      continue;
    }
    const changes = (entry.activeEffect?.changes ?? []).map((c) => ({ key: c.key, value: c.value, mode: c.mode }));
    const id = `clt-${slug(entry.name) || entry.id}`;
    matches[entry.id] = id;
    custom.push({
      id,
      name: entry.name,
      img: entry.img ?? entry.icon ?? "icons/svg/aura.svg",
      category: "custom",
      hint: "",
      changes,
      overlay: !!entry.options?.overlay,
      defeated: !!entry.options?.markDefeated,
      reference: entry.referenceId ?? ""
    });
  }
  return { matches, custom };
}

/**
 * Condition Lab & Triggler (CLT) support.
 *
 * CLT stopped at Foundry v12. Neon Conditions takes over its job, and for modules and macros
 * written against it, provides `game.clt` with the same calls (addCondition, removeCondition,
 * hasCondition, getCondition(s), toggleCondition, removeAllConditions) when CLT isn't running.
 * The GM can import CLT's condition map (its world setting outlives the module) and move the
 * effects CLT placed on actors over to Neon Conditions.
 */
export const CLT = {
  get active() {
    return !!game.modules.get(CLT_ID)?.active;
  },

  /** Provide game.clt when CLT itself isn't running (setting). */
  install() {
    if (this.active || !Settings.get("cltShim") || game.clt) return;
    const shim = {
      supported: true,
      /** Marks this as Neon Combat Manager's stand-in, not CLT itself. */
      neon: MODULE_ID,
      get conditions() {
        return Registry.enabled().map((c) => CLT.shape(c));
      },
      getCondition: (name) => {
        const list = [name].flat().map((n) => Registry.get(n)).filter(Boolean).map((c) => CLT.shape(c));
        return list.length > 1 ? list : list[0];
      },
      getConditions: (entities = null) => {
        const out = Conditions.actorsOf(entities).map((a) => ({ entity: a, conditions: Conditions.active(a).map((c) => CLT.shape(c)) }));
        return out.length > 1 ? out : out[0]?.conditions;
      },
      getConditionEffects: (entities = null) => {
        const out = Conditions.actorsOf(entities).flatMap((a) => Conditions.effects(a));
        return out.length > 1 ? out : out[0];
      },
      hasCondition: (name, entities = null) => [name].flat().some((n) => Conditions.has(n, entities)),
      addCondition: (name, entities = null, { allowDuplicates = false } = {}) => Conditions.add([name].flat(), entities, { allowDuplicates }),
      applyCondition: (...args) => shim.addCondition(...args),
      removeCondition: (name, entities = null) => Conditions.remove([name].flat(), entities),
      removeAllConditions: (entities = null) => Conditions.removeAll(entities),
      toggleCondition: (name, entities = null) => Conditions.toggle(name, entities)
    };
    game.clt = shim;
  },

  /** A condition in CLT's shape. */
  shape(c) {
    return { id: c.id, name: c.name, icon: c.img, img: c.img, referenceId: c.reference ?? "", options: { overlay: !!c.overlay, markDefeated: !!c.defeated } };
  },

  /** CLT's saved condition map, read from the world's settings even with CLT turned off. */
  savedMap() {
    try {
      if (this.active) return game.settings.get(CLT_ID, "activeConditionMap") ?? null;
    } catch {
      /* fall through to storage */
    }
    const store = game.settings.storage?.get("world");
    const doc = store?.find?.((s) => s.key === `${CLT_ID}.activeConditionMap`) ?? store?.getSetting?.(`${CLT_ID}.activeConditionMap`);
    if (!doc) return null;
    try {
      const v = typeof doc.value === "string" ? JSON.parse(doc.value) : doc.value;
      return Array.isArray(v) ? v : v?.map ?? null;
    } catch {
      return null;
    }
  },

  /**
   * GM: import CLT's condition map (unmatched conditions become custom ones) and move CLT's
   * effects on actors over to Neon Conditions.
   * @returns {{ matched: number, added: number, effects: number }}
   */
  async migrate(map = this.savedMap()) {
    if (!game.user.isGM) return null;
    const { matches, custom } = fromClt(map ?? []);
    const existing = Settings.get("customConditions") ?? [];
    const have = new Set(existing.map((c) => c.id));
    const added = custom.filter((c) => !have.has(c.id));
    if (added.length) await Settings.set("customConditions", [...existing, ...added]);
    Registry.refresh();
    let moved = 0;
    for (const actor of Conditions._actorsInPlay()) {
      const updates = [];
      for (const e of actor.effects) {
        const cltId = e.flags?.[CLT_ID]?.conditionId;
        const ours = cltId ? matches[cltId] : null;
        if (!ours || e.flags?.[MODULE_ID]?.[FLAGS.condition]) continue;
        updates.push({
          _id: e._id,
          statuses: [...new Set([...(e.statuses ?? []), ours])],
          [`flags.${MODULE_ID}.${FLAGS.condition}`]: ours,
          [`flags.${SYSTEM_ID}.changes`]: repairFlags(e.changes, e.flags?.[SYSTEM_ID]?.changes)
        });
      }
      if (updates.length) {
        await actor.updateEmbeddedDocuments("ActiveEffect", updates, { [MODULE_ID]: { quiet: true } });
        moved += updates.length;
      }
    }
    await Settings.set("migratedClt", true);
    return { matched: Object.keys(matches).length - added.length, added: added.length, effects: moved };
  },

  /** Is there CLT data in this world that hasn't been brought over? */
  get pending() {
    return Compat.isActiveGM && !Settings.get("migratedClt") && !!this.savedMap()?.length;
  }
};
