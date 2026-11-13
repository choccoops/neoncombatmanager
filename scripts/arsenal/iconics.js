import { MODULE_ID, LANG } from "../constants.js";
import { Cards } from "../combat/cards.js";
import { L, esc } from "../util.js";
import { Rebuilds } from "./rebuilds.js";
import { loadedAmmo } from "./aa.js";
import { specialsOf } from "./specials.js";

/**
 * Weapons with rules nothing else shares (Item Compendium, 2070): the R.N.Geezus! and its Blind
 * Box, Chaos and what a reload does to it, Gris Gris's NET-linked rounds, and magazines that hold
 * several kinds of ammo. The tables are the Compendium's own (the Blind Box odds are the house
 * draft printed there; the Malfunctions are the Core Rules', Chapter 12, weapons).
 */

/** The Blind Box: [low, high, key]. 1d100, 00 is 100. Names and effects are in the language file. */
export const BLIND_BOX = [
  [1, 6, "junk"], [7, 36, "basic"], [37, 38, "armorPiercing"], [39, 40, "biotoxin"], [41, 42, "emp"], [43, 44, "expansive"],
  [45, 46, "flashbang"], [47, 48, "incendiary"], [49, 50, "poison"], [51, 52, "rubber"], [53, 54, "sleep"], [55, 56, "smoke"],
  [57, 58, "teargas"], [59, 60, "burrowing"], [61, 62, "highPrecision"], [63, 64, "explosive"], [65, 66, "highVelocity"],
  [67, 68, "hyperExpansive"], [69, 70, "hollowPoint"], [71, 72, "tracer"], [73, 74, "arrowhypo"], [75, 76, "airburst"],
  [77, 78, "improvedSmart"], [79, 80, "co2"], [81, 82, "hvap"], [83, 84, "overpressure"], [85, 86, "subsonic"], [87, 88, "combo"],
  [89, 90, "dazzle"], [91, 92, "megaOuchie"], [93, 94, "ouchie"], [95, 96, "slippy"], [97, 98, "splashie"], [99, 100, "gacha"]
];
/** Not drawn again by a Combo Casing. */
const NO_COMBO = ["junk", "combo", "gacha"];

/** The round a 1d100 draws. */
export const blindBoxRound = (n) => BLIND_BOX.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? "basic";

/**
 * What one Attack with an R.N.Geezus! fires, pure: { rounds: [keys], malfunctions: n, jam }.
 * A Critical Success fires GACHA! whatever the table says; a Critical Failure fires Junk, jams and
 * rolls two Malfunctions; Junk rolls one; a Combo Casing draws two more that aren't Junk, Combo or GACHA!.
 * @param {Function} d100 - () => 1..100
 */
export function openBlindBox(d100, { critSuccess = false, critFail = false } = {}) {
  if (critFail) return { rounds: ["junk"], malfunctions: 2, jam: true };
  if (critSuccess) return { rounds: ["gacha"], malfunctions: 0, jam: false };
  const first = blindBoxRound(d100());
  if (first === "junk") return { rounds: ["junk"], malfunctions: 1, jam: false };
  if (first !== "combo") return { rounds: [first], malfunctions: 0, jam: false };
  const rounds = [];
  for (let guard = 0; rounds.length < 2 && guard < 200; guard++) {
    const r = blindBoxRound(d100());
    if (!NO_COMBO.includes(r)) rounds.push(r);
  }
  return { rounds, malfunctions: 0, jam: false };
}

/** Chaos after a reload, from its three dice: capacity 1d20 (min 2; a 20 is 26), damage 1d8 d6s, ablation 1d4 SP. */
export function chaosStats(d20, d8, d4) {
  return { capacity: d20 >= 20 ? 26 : Math.max(2, d20), damage: `${Math.max(1, d8)}d6`, ablation: Math.max(1, d4) };
}

/** The highest quickhack DV a NET-linked round can land: 2d6 (3d6 with a Critical Injury) plus Interface. */
export const netRoundFormula = (crit, iface = 0) => `${crit ? 3 : 2}d6${iface > 0 ? ` + ${iface}` : ""}`;

/** The ammo a character carries that a weapon can fire, loaded one first: [item]. */
export function roundsFor(weapon, actor = weapon?.actor) {
  const kinds = weapon?.system?.ammoVariety ?? [];
  const loaded = loadedAmmo(weapon, actor);
  const list = [...(actor?.items ?? [])].filter((i) => i.type === "ammo" && kinds.includes(i.system?.variety) && (Number(i.system?.amount) > 0 || i.id === loaded?.id));
  return list.sort((a, b) => (a.id === loaded?.id ? -1 : b.id === loaded?.id ? 1 : a.name.localeCompare(b.name)));
}

/** The next kind of round to chamber, after the current pick (round and round). */
export function nextRound(list, currentId) {
  if (!list.length) return null;
  const at = list.findIndex((i) => i.id === currentId);
  return list[(at + 1) % list.length];
}

const roll = async (formula) => (await new Roll(formula).evaluate()).total;
const post = (actor, title, body) => Cards.post({ actor, kicker: L(`${LANG}.Arsenal.Kicker`), title, tone: "pink", body });

export const Iconics = {
  init() {
    // A reload is a magazine that goes up: Chaos rerolls itself on each one.
    Hooks.on("preUpdateItem", (item, changes, options) => {
      const to = changes?.system?.magazine?.value ?? changes?.["system.magazine.value"];
      if (item?.type === "weapon" && Number.isFinite(Number(to)) && Number(to) > (Number(item.system?.magazine?.value) || 0)) options[`${MODULE_ID}Reload`] = true;
    });
    Hooks.on("updateItem", (item, changes, options, userId) => {
      if (userId !== game.user.id || !options?.[`${MODULE_ID}Reload`] || !item.actor || !specialsOf(item)?.chaos) return;
      this.chaosReload(item.actor, item).catch((err) => console.error(`${MODULE_ID} | Chaos`, err));
    });
  },

  /** An Attack with an R.N.Geezus!: what came out of the Blind Box, for everyone. */
  async blindBox(a) {
    const actor = game.actors.get(a.actorId);
    const weapon = actor?.items?.get(a.itemId);
    // One d100, and more only for a Combo Casing (which redraws Junk, Combo and GACHA!).
    const rolls = a.critSuccess || a.critFail ? [] : [await roll("1d100")];
    if (rolls.length && blindBoxRound(rolls[0]) === "combo") {
      for (let kept = 0; kept < 2 && rolls.length < 40;) {
        const n = await roll("1d100");
        rolls.push(n);
        if (!NO_COMBO.includes(blindBoxRound(n))) kept++;
      }
    }
    let at = 0;
    const out = openBlindBox(() => rolls[at++] ?? 50, { critSuccess: !!a.critSuccess, critFail: !!a.critFail });
    const lines = out.rounds.map((k) => `<p><strong>${L(`${LANG}.Arsenal.BlindBox.Round.${k}.name`)}</strong>: ${L(`${LANG}.Arsenal.BlindBox.Round.${k}.effect`)}</p>`);
    if (out.rounds.length > 1) lines.unshift(`<p>${L(`${LANG}.Arsenal.BlindBox.Combo`)}</p>`);
    if (a.critSuccess) lines.unshift(`<p>${L(`${LANG}.Arsenal.BlindBox.CritSuccess`)}</p>`);
    if (out.jam) lines.push(`<p>${L(`${LANG}.Arsenal.BlindBox.Jam`)}</p>`);
    const faults = [];
    for (let i = 0; i < out.malfunctions; i++) {
      const n = await roll("1d6");
      faults.push(n);
      lines.push(`<p><strong>${L(`${LANG}.Arsenal.BlindBox.Malfunction`, { n })}</strong>: ${L(`${LANG}.Arsenal.Malfunction.${n}`)}</p>`);
    }
    await post(actor, L(`${LANG}.Arsenal.BlindBox.Title`, { weapon: esc(weapon?.name ?? "") }), lines.join(""));
    return { ...out, faults };
  },

  /** Chaos, reloaded: new capacity, damage and ablation, on the item and on a card. */
  async chaosReload(actor, item) {
    const s = chaosStats(await roll("1d20"), await roll("1d8"), await roll("1d4"));
    await item.update({ "system.magazine.max": s.capacity, "system.magazine.value": Math.min(Number(item.system?.magazine?.value) || 0, s.capacity), "system.damage": s.damage });
    await Rebuilds.setState(actor, item, { chaosAblation: s.ablation });
    await post(actor, L(`${LANG}.Arsenal.Chaos.Title`, { weapon: esc(item.name) }), `<p>${L(`${LANG}.Arsenal.Chaos.Body`, s)}</p>`);
    return s;
  },

  /** A NET-linked round got through: the highest quickhack DV that lands with it. */
  async netRound(a) {
    const actor = game.actors.get(a.actorId);
    const weapon = actor?.items?.get(a.itemId);
    const role = [...(actor?.items ?? [])].find((i) => i.type === "role" && /netrunner/i.test(i.name ?? ""));
    const iface = Number(role?.system?.rank) || 0;
    const crit = !!(a.crit || a.ruleCrit);
    const total = await roll(netRoundFormula(crit, iface));
    await post(actor, L(`${LANG}.Arsenal.NetRound.Title`, { weapon: esc(weapon?.name ?? ""), total }), `<p>${L(`${LANG}.Arsenal.NetRound.Body`, { total, formula: netRoundFormula(crit, iface) })}</p>`);
    return total;
  },

  /** The kind of round a mixed magazine fires next: the pick the shooter made, or what's loaded. */
  chambered(actor, weapon) {
    const id = Rebuilds.state(actor, weapon).round;
    const pick = id ? actor.items.get(id) : null;
    return pick && Number(pick.system?.amount) > 0 ? pick : loadedAmmo(weapon, actor);
  },

  /** From the Action HUD: chamber the next kind of round the character carries for this weapon. */
  async cycleRound(actor, weapon) {
    const list = roundsFor(weapon, actor);
    const next = nextRound(list, this.chambered(actor, weapon)?.id);
    if (!next) return null;
    await Rebuilds.setState(actor, weapon, { round: next.id === loadedAmmo(weapon, actor)?.id ? null : next.id });
    ui.notifications?.info(L(`${LANG}.Arsenal.Mixed.Chambered`, { weapon: weapon.name, ammo: next.name }));
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return next;
  },

  /**
   * A shot of a kind other than the one loaded: Cyberpunk RED took the round from the magazine, which
   * it filled from the loaded stack, so that stack gets its round back and the picked one gives one up.
   */
  async spendPicked(actor, weapon) {
    const pick = this.chambered(actor, weapon);
    const loaded = loadedAmmo(weapon, actor);
    if (!pick || !loaded || pick.id === loaded.id) return null;
    await actor.updateEmbeddedDocuments("Item", [
      { _id: loaded.id, "system.amount": (Number(loaded.system?.amount) || 0) + 1 },
      { _id: pick.id, "system.amount": Math.max(0, (Number(pick.system?.amount) || 0) - 1) }
    ]);
    return pick;
  }
};
