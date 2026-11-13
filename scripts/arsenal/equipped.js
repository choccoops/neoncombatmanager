import { MODULE_ID, FLAGS } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { classify } from "./kinds.js";
import { Rebuilds, traitsOf } from "./rebuilds.js";
import { loadedAmmo } from "./aa.js";
import { specialsOf, strainOf } from "./specials.js";
import { CPR } from "../cpr.js";

/**
 * The condition each 2070 flavor (and the Mono-edge Melee Rebuilds, tagged "Monoblade") puts on
 * whoever has a weapon of it in hand; "improved" is a Smart gun in hand with Improved Smart
 * Ammunition loaded.
 */
export const REBUILD_CONDITION = { power: "powerRebuild", smart: "smartRebuild", tech: "techRebuild", mono: "monoRebuild", improved: "improvedSmart" };
/** The managed flag those conditions carry, so only Neon Arsenal's own come off again. */
const MANAGED = "rebuild";
const QUIET = { [MODULE_ID]: { quiet: true } };

/** Is an item a weapon in hand: an equipped weapon, or installed cyberware that is one? */
export function inHand(item) {
  if (item?.type === "weapon") return item.system?.equipped === "equipped";
  if (item?.type === "cyberware") return !!item.system?.isWeapon && item.system?.isInstalled !== false;
  return false;
}

/** Improved Smart Ammunition counts only in a Smart weapon (a Smartgun Link isn't enough; 2070 Ch07). */
export const improvedSmart = (info) => !!info && info.ranged && info.flavor === "smart" && info.ammoType === "smart";

/** What a weapon brings to the hand: its flavor, and "mono" for a Mono-edge Melee Rebuild. */
export function rebuildKeys(item, actor = item?.actor) {
  const upgrades = Rebuilds.upgradesOf(item, actor);
  const info = classify(item, loadedAmmo(item, actor), upgrades);
  const flavor = info.flavor;
  const keys = flavor ? [flavor] : [];
  if (improvedSmart(info)) keys.push("improved");
  if (traitsOf(flavor, upgrades).tags.includes("Monoblade")) keys.push("mono");
  return keys;
}

/**
 * The keys (power, smart, tech, mono) of the weapons a character has in hand.
 * @param {object} actor
 * @param {Function} [keysOfItem] - item -> keys (default: rebuildKeys)
 */
export function flavorsInHand(actor, keysOfItem = null) {
  const read = keysOfItem ?? ((item) => rebuildKeys(item, actor));
  const out = new Set();
  for (const item of actor?.items ?? []) {
    if (!inHand(item)) continue;
    for (const k of [read(item)].flat()) if (REBUILD_CONDITION[k]) out.add(k);
  }
  return out;
}

/**
 * Power Weapon, Smart Weapon and Tech Weapon follow the guns in hand. The active GM keeps them in
 * step as weapons are equipped, stowed, installed, upgraded or dropped. They carry no numbers (the
 * roll gets those from the weapon itself); they show on the token and switch on Neon FX's looks
 * and the Tech scope's outlines.
 */
/** The condition for holding a weapon without the BODY for it; its numbers come from the weapon's card. */
export const STRAIN = "weaponStrain";

export const Equipped = {
  _pending: new Map(),

  init() {
    const onItem = (item) => {
      const actor = item?.parent;
      if (actor?.documentName === "Actor" && ["weapon", "cyberware", "itemUpgrade", "ammo"].includes(item.type)) this.queue(actor);
    };
    Hooks.on("createItem", onItem);
    Hooks.on("updateItem", onItem);
    Hooks.on("deleteItem", onItem);
    Hooks.on("canvasReady", () => this.syncScene());
    Hooks.on(`${MODULE_ID}.rebuildConditionsChanged`, () => this.syncScene({ everyone: true }));
  },

  ready() {
    this.syncScene({ everyone: true });
  },

  /** Bring one character up to date shortly (several item changes in a row count once). */
  queue(actor) {
    if (!Compat.isActiveGM || !actor) return;
    const key = actor.uuid ?? actor.id;
    clearTimeout(this._pending.get(key));
    this._pending.set(key, setTimeout(() => {
      this._pending.delete(key);
      this.sync(actor).catch((err) => console.error(`${MODULE_ID} | weapon conditions for ${actor.name}`, err));
    }, 150));
  },

  /** The characters on the scene (and, with everyone, every player character). Active GM. */
  syncScene({ everyone = false } = {}) {
    if (!Compat.isActiveGM) return;
    const actors = new Map();
    for (const t of canvas?.tokens?.placeables ?? []) if (t.actor) actors.set(t.actor.uuid ?? t.actor.id, t.actor);
    if (everyone) for (const a of game.actors ?? []) if (a.hasPlayerOwner) actors.set(a.uuid ?? a.id, a);
    for (const a of actors.values()) this.queue(a);
  },

  /** Put on the conditions for the flavors in hand, and take off Neon Arsenal's own for the rest. */
  async sync(actor, flavorOfItem = null) {
    if (!actor || !["character", "mook"].includes(actor.type)) return;
    const on = !!Settings.get("arsenalRebuildConditions");
    const want = on ? flavorsInHand(actor, flavorOfItem) : new Set();
    const stale = [];
    for (const [flavor, id] of Object.entries(REBUILD_CONDITION)) {
      if (Registry.get(id)?.disabled) continue;
      const mine = Conditions.effects(actor, id).filter((e) => e.getFlag(MODULE_ID, FLAGS.managed) === MANAGED);
      if (want.has(flavor) && !Conditions.has(id, actor)) await Conditions.add(id, actor, { managed: MANAGED });
      else if (!want.has(flavor)) stale.push(...mine.map((e) => e.id));
    }
    if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale, QUIET);
    await this.syncStrain(actor);
  }

  /**
   * Weapon Strain follows the weapons in hand too: someone holding one whose card asks for more
   * BODY than they have (or paired cyberarms) carries its stat penalties as an Active Effect, and
   * loses it when the weapon is stowed or the BODY is there.
   */
  ,async syncStrain(actor) {
    if (Registry.get(STRAIN)?.disabled) return null;
    const rules = Settings.get("arsenalRebuildConditions") ? [...(actor.items ?? [])].filter(inHand).map((i) => specialsOf(i)?.heldPenalty) : [];
    const arms = [...(actor.items ?? [])].filter((i) => i.type === "cyberware" && i.system?.type === "cyberArm" && i.system?.isInstalled).length;
    const mine = Conditions.effects(actor, STRAIN).filter((e) => e.getFlag(MODULE_ID, FLAGS.managed) === MANAGED);
    // The stats as they'd be without the strain already on them (for a card's "(min 4)").
    const now = (st) => Number((mine[0]?.changes ?? []).find((c) => c.key === `system.stats.${st}.value`)?.value) || 0;
    const stats = Object.fromEntries(["ref", "dex", "move"].map((st) => [st, CPR.stat(actor, st) - now(st)]));
    const strain = strainOf(rules, { body: CPR.stat(actor, "body"), cyberarms: arms, stats });
    const want = strain ? Object.entries(strain).map(([st, value]) => ({ key: `system.stats.${st}.value`, value })) : [];
    const same = mine.length === 1 && want.length === (mine[0].changes ?? []).length && want.every((w) => (mine[0].changes ?? []).some((c) => c.key === w.key && Number(c.value) === w.value));
    if (same) return strain;
    if (mine.length) await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id), QUIET);
    if (want.length) await Conditions.add(STRAIN, actor, { managed: MANAGED, changes: want });
    return strain;
  }
};
