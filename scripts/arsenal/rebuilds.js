import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { CombatTime } from "../combat/time.js";
import { L } from "../util.js";

/**
 * Weapon traits: what a gun's 2070 flavor and its Rebuilds do in a fight. Pure where it can be
 * (tests import it); the switches a player flips live on the actor (flags.<module>.arsenal).
 *
 * The flavors are Neon Combat Manager's own (2070 Core Rules Ch07, The Three Flavors of 2070
 * Firearms). Rebuilds that are items, such as the Melee Rebuilds, come from the modules that know
 * them: Neon At Home registers its list in the `cpr-neon-combat-manager.registerRebuilds` hook
 * (or with api.arsenal.registerRebuild).
 *
 * A rebuild definition: { id, label, match (RegExp or source string, against the upgrade's name),
 *   tiers?: { Basic: traits, ... }, traits?, page? }
 * Traits:
 *   attackMod      - added to ranged attack rolls (Smart: +1, with a link to fire it; a gun whose
 *                    attack modifier already holds it loses it without the link)
 *   needsLink      - the attackMod needs a Neuroport, Personal Link or Subdermal Grip
 *   critBonus      - added to a Critical Injury's Bonus Damage (Power: +5)
 *   ignoreBelowSP  - the damage ignores armor below this SP (Mono-edge Blading)
 *   push           - { metres, maxBody? }: a target hit is pushed straight away (Propulsion Impact)
 *   ricochetBonus  - added to ricochet attacks, Aimed ones excepted (Ricochet Compensator)
 *   active         - switches a player flips: "ricochet" (Power), "charge" (Tech)
 *   tag            - the look it gets in Automated Animations ("Monoblade", "Propulsion")
 */
export const REBUILD_HOOK = `${MODULE_ID}.registerRebuilds`;

export const FLAVOR_TRAITS = {
  power: { critBonus: 5, active: ["ricochet"] },
  smart: { attackMod: 1, needsLink: true },
  tech: { active: ["charge"] }
};

/** The penalty for a ricochet (Ch07): -4, and an Aimed Shot ricochet takes only the Aimed -8. */
export const RICOCHET_PENALTY = -4;
/** A Tech charge lasts 20 Rounds or until fired. */
export const CHARGE_ROUNDS = 20;
/** A charged Tech shot ignores half the target's SP. */
export const CHARGE_IGNORE_PERCENT = 50;
/** What a Smart gun needs to fire smart (and what Neon Hub calls it). */
export const LINK = /\b(neuroport|personal link|subdermal grip|smart ?gun link|interface plugs)\b/i;

const defs = new Map();

const toRegExp = (m) => (m instanceof RegExp ? m : new RegExp(String(m), "i"));

export const RebuildRegistry = {
  register(def) {
    if (!def?.id || !def.match) throw new Error(`${MODULE_ID} | a rebuild needs an id and a match`);
    defs.set(def.id, { ...def, match: toRegExp(def.match) });
    return defs.get(def.id);
  },
  all() {
    return [...defs.values()];
  },
  clear() {
    defs.clear();
  }
};

/**
 * The traits a definition gives an upgrade, or null when it isn't this rebuild. A rebuild with
 * tiers takes the tier named in the upgrade's name ("Mono-edge Blading (Upgraded)"), else the one
 * chosen on it (`tier`, Neon At Home's Weaponbench), else its first.
 */
export function traitsFromDef(def, name, tier = null) {
  if (!def.match.test(String(name ?? ""))) return null;
  if (!def.tiers) return { ...(def.traits ?? {}) };
  const names = Object.keys(def.tiers);
  const inName = names.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(String(name)));
  const pick = (inName.length === 1 && inName[0]) || (tier && names.find((t) => t.toLowerCase() === String(tier).toLowerCase())) || names[0];
  return { ...(def.traits ?? {}), ...def.tiers[pick], tier: pick };
}

/**
 * Everything a weapon's flavor and installed rebuilds give it, merged:
 * { critBonus, attackMod, needsLink, ignoreBelowSP, push, ricochetBonus, active: [], tags: [], sources: [] }
 * @param {string|null} flavor
 * @param {object[]} upgrades - its installed upgrades ({ name, tier })
 * @param {object[]} [list] - rebuild definitions (default: the registered ones)
 */
export function traitsOf(flavor, upgrades = [], list = RebuildRegistry.all()) {
  const out = { critBonus: 0, attackMod: 0, needsLink: false, ignoreBelowSP: 0, push: null, ricochetBonus: 0, active: [], tags: [], sources: [] };
  const add = (t, source) => {
    if (!t) return;
    out.critBonus += Number(t.critBonus) || 0;
    out.attackMod += Number(t.attackMod) || 0;
    out.needsLink ||= !!t.needsLink;
    out.ignoreBelowSP = Math.max(out.ignoreBelowSP, Number(t.ignoreBelowSP) || 0);
    out.ricochetBonus += Number(t.ricochetBonus) || 0;
    if (t.push && (!out.push || t.push.metres > out.push.metres || (t.push.metres === out.push.metres && !t.push.maxBody))) out.push = { ...t.push };
    for (const a of t.active ?? []) if (!out.active.includes(a)) out.active.push(a);
    if (t.tag && !out.tags.includes(t.tag)) out.tags.push(t.tag);
    out.sources.push(source);
  };
  if (flavor && FLAVOR_TRAITS[flavor]) add(FLAVOR_TRAITS[flavor], flavor);
  for (const u of upgrades) {
    for (const def of list) {
      const t = traitsFromDef(def, u?.name, u?.tier);
      if (t) {
        add(t, t.tier ? `${def.label} (${t.tier})` : def.label);
        break;
      }
    }
  }
  return out;
}

/**
 * Modifiers for an attack roll: [{ id, value, source }].
 * @param {object} t - traitsOf
 * @param {object} ctx - { ranged, aimed, ricochet, linked, baked }; baked: the weapon's own
 *   attack modifier already holds the bonus (Neon Hub's Smart guns), so without a link it comes off
 */
export function attackMods(t, { ranged = true, aimed = false, ricochet = false, linked = true, baked = false } = {}, localize = L) {
  const out = [];
  if (ranged && t.attackMod) {
    if (baked && t.needsLink && !linked) out.push({ id: `${MODULE_ID}-smart`, value: -t.attackMod, source: localize(`${LANG}.Arsenal.Mod.noLink`) });
    else if (!baked && (!t.needsLink || linked)) out.push({ id: `${MODULE_ID}-smart`, value: t.attackMod, source: localize(`${LANG}.Arsenal.Mod.smart`) });
  }
  if (ricochet && !aimed) out.push({ id: `${MODULE_ID}-ricochet`, value: RICOCHET_PENALTY + (t.ricochetBonus || 0), source: localize(`${LANG}.Arsenal.Mod.ricochet`) });
  return out;
}

/**
 * What a damage roll's card carries: { bonusDamage, ignoreBelowSP, ignoreArmorPercent }, from the
 * values it had (CPR's) and the weapon's traits; `charged` for a charged Tech shot.
 */
export function damageArgs(t, { bonusDamage = 5, ignoreBelowSP = 0, ignoreArmorPercent = 0, charged = false } = {}) {
  return {
    bonusDamage: (Number(bonusDamage) || 0) + (t.critBonus || 0),
    ignoreBelowSP: Math.max(Number(ignoreBelowSP) || 0, t.ignoreBelowSP || 0),
    ignoreArmorPercent: charged ? Math.max(Number(ignoreArmorPercent) || 0, CHARGE_IGNORE_PERCENT) : Number(ignoreArmorPercent) || 0
  };
}

/** Is a Tech charge (worldTime it ends at) still holding at `now`? */
export const chargeHolds = (until, now) => Number.isFinite(Number(until)) && Number(until) > 0 && Number(now) < Number(until);

/* ---------------------------------------- */
/*  A character's switches                  */
/* ---------------------------------------- */

export const Rebuilds = {
  /** The upgrades installed in a weapon, with the tier Neon At Home's bench chose for each. */
  upgradesOf(weapon, actor = weapon?.actor) {
    let list = [];
    try {
      if (typeof weapon?.getInstalledItems === "function") list = weapon.getInstalledItems("itemUpgrade") ?? [];
    } catch {
      list = [];
    }
    if (!list.length) {
      const ids = weapon?.system?.installedItems?.list ?? [];
      list = ids.map((id) => actor?.items?.get(id)).filter((i) => i?.type === "itemUpgrade");
    }
    return list.map((u) => ({ name: u.name, tier: u.flags?.["cpr-neon-at-home"]?.rebuildTier ?? null, attack: Number(u.system?.modifiers?.attackmod?.value) || 0 }));
  },

  /** Does the character have what a Smart gun needs (2070: a Neuroport/Personal Link or Subdermal Grip)? */
  linked(actor) {
    return [...(actor?.items ?? [])].some((i) => LINK.test(i.name ?? "") && (i.type !== "cyberware" || i.system?.isInstalled !== false));
  },

  state(actor, weapon) {
    return actor?.flags?.[MODULE_ID]?.arsenal?.[weapon?.id] ?? {};
  },

  async setState(actor, weapon, data) {
    return actor.update({ [`flags.${MODULE_ID}.arsenal.${weapon.id}`]: { ...this.state(actor, weapon), ...data } });
  },

  isCharged(actor, weapon) {
    return chargeHolds(this.state(actor, weapon).chargedUntil, game.time?.worldTime ?? 0);
  },

  /** Flip a Power gun's ricochet on for its next attack (or off). */
  async toggleRicochet(actor, weapon) {
    const on = !this.state(actor, weapon).ricochet;
    await this.setState(actor, weapon, { ricochet: on });
    return on;
  },

  /** Charge a Tech gun (gives up the Move Action; holds 20 Rounds or until fired). Again: let it go. */
  async toggleCharge(actor, weapon) {
    if (this.isCharged(actor, weapon)) {
      await this.setState(actor, weapon, { chargedUntil: 0, fired: false });
      return false;
    }
    const seconds = CHARGE_ROUNDS * (CombatTime.roundSeconds || 3);
    await this.setState(actor, weapon, { chargedUntil: (game.time?.worldTime ?? 0) + seconds, fired: false });
    return true;
  },

  /** The switches as HUD buttons for a weapon: [{ key, label, icon, on }]. */
  buttons(actor, weapon, traits) {
    const out = [];
    if (!Settings.get("arsenalRebuilds")) return out;
    if (traits.active.includes("ricochet")) {
      out.push({ key: `rico:${weapon.id}`, label: L(`${LANG}.Arsenal.Ricochet`), icon: "fa-solid fa-arrows-turn-to-dots", on: !!this.state(actor, weapon).ricochet });
    }
    if (traits.active.includes("charge")) {
      const on = this.isCharged(actor, weapon);
      out.push({ key: `chg:${weapon.id}`, label: L(`${LANG}.Arsenal.${on ? "Charged" : "Charge"}`), icon: "fa-solid fa-bolt-lightning", on });
    }
    return out;
  }
};
