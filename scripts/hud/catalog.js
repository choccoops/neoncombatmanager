import { LANG } from "../constants.js";
import { CPR } from "../cpr.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { Phone } from "../comms/phone.js";
import { Hub } from "../hub/hub.js";
import { Rebuilds, traitsOf } from "../arsenal/rebuilds.js";
import { flavorOf } from "../arsenal/kinds.js";
import { Hands } from "./hands.js";
import { L, slug } from "../util.js";

const { getProperty } = foundry.utils;

export const STATS = ["ref", "dex", "body", "will", "cool", "int", "tech", "emp", "move", "luck"];
export const INTERFACE = ["scanner", "backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "virus", "zap"];
/** Condition categories a player toggles from the HUD. */
const STATUS_CATS = ["combat", "situation", "hazard", "visibility"];

/** CPR's own word for something, or ours when it has none (or isn't loaded). */
const cpr = (key, fallback) => {
  const s = game.i18n.localize(key);
  return s && s !== key ? s : fallback;
};

/** The combatant for an actor (its token's, when there's one) in the current combat. */
export function combatantOf(actor, token = null, combat = game.combat) {
  if (!combat || !actor) return null;
  const list = [...(combat.combatants ?? [])];
  return (token && list.find((c) => c.tokenId === token.id)) ?? list.find((c) => c.actorId === actor.id || c.actor?.id === actor.id) ?? null;
}

/** Macros the user can run, as HUD entries: keyed by name (layouts carry over), run by id. */
export function macrosFor(user = game.user) {
  const list = [...(game.macros ?? [])].filter((m) => m && (m.canExecute ?? m.testUserPermission?.(user, "LIMITED")));
  return list.sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ key: `macro:${slug(m.name)}`, run: `macro:${m.id}`, label: m.name, img: m.img }));
}

/** Equipped weapons, cyberweapons that are installed, and weapon upgrades, as CPR's Fight tab lists them. */
export function weaponsOf(actor) {
  try {
    const list = actor.system?.weapons?.getWeapons?.("equipped");
    if (Array.isArray(list)) return list;
  } catch {
    /* an older system: read the items */
  }
  return (actor.items ?? []).filter((i) => (i.type === "weapon" && i.system?.equipped === "equipped")
    || (i.type === "cyberware" && i.system?.isWeapon && (i.system?.isInstalled || i.system?.isInstalledInActor)));
}

/**
 * Every action an actor has, by source. An entry is { key, label, img?, icon?, sub?, on?, alert?,
 * off?, buttons? }; a weapon has buttons (Attack, Aimed, Autofire, Suppressive, Damage, Reload),
 * each with its own key, Change Ammo with Reload. The Weapons group ends with Bare Hands (until Unarmed is
 * equipped) and Equip / Change Weapon (scripts/hud/hands.js). Keys that run something carry the item's id ("atk:<id>"); the entry's
 * key, which a layout picks, carries its name ("weapon:<name>").
 * @param {Actor} actor
 * @param {object} [ctx] - { token, combat }
 */
export function catalog(actor, { token = null, combat = game.combat } = {}) {
  const out = Object.fromEntries(["turn", "weapons", "skills", "role", "net", "status", "utility", "macros", "stats", "gear"].map((s) => [s, []]));
  if (!actor) return out;
  const items = [...(actor.items ?? [])];

  // Turn: Initiative, End Turn, Death Save, Facedown.
  const cb = combatantOf(actor, token, combat);
  const myTurn = !!combat?.started && !!cb && combat.combatant?.id === cb.id;
  const mortal = CPR.woundState(actor) === "mortallyWounded";
  out.turn.push(
    { key: "turn:initiative", label: L(`${LANG}.Hud.Initiative`), icon: "fa-solid fa-bolt", sub: Number.isFinite(cb?.initiative) ? String(cb.initiative) : "", off: !combat },
    { key: "turn:endTurn", label: L(`${LANG}.Hud.EndTurn`), icon: "fa-solid fa-forward-step", off: !myTurn, alert: myTurn },
    { key: "turn:deathSave", label: L(`${LANG}.Hud.DeathSave`), icon: "fa-solid fa-skull", sub: mortal ? `+${CPR.deathSave(actor).penalty}` : "", alert: mortal },
    { key: "turn:facedown", label: L(`${LANG}.Hud.Facedown`), icon: "fa-solid fa-face-angry" }
  );

  // Weapons.
  for (const w of weaponsOf(actor)) {
    const s = w.system ?? {};
    const ranged = !!s.isRanged;
    const mode = getProperty(actor, `flags.cyberpunk-red-core.firetype-${w.id}`) ?? "";
    const buttons = [{ key: `atk:${w.id}`, label: L(`${LANG}.Hud.Attack`), icon: "fa-solid fa-crosshairs", on: !mode }];
    buttons.push({ key: `aim:${w.id}`, label: L(`${LANG}.Hud.Aimed`), icon: "fa-solid fa-bullseye", on: mode === "aimed" });
    if (Number(s.fireModes?.autoFire) > 0) buttons.push({ key: `auto:${w.id}`, label: L(`${LANG}.Hud.Autofire`), icon: "fa-solid fa-burst", on: mode === "autofire" });
    if (s.fireModes?.suppressiveFire) buttons.push({ key: `supp:${w.id}`, label: L(`${LANG}.Hud.Suppressive`), icon: "fa-solid fa-wind", on: mode === "suppressive" });
    if (mode !== "suppressive") buttons.push({ key: `dmg:${w.id}`, label: L(`${LANG}.Hud.Damage`), icon: "fa-solid fa-droplet" });
    if (ranged) {
      buttons.push({ key: `rld:${w.id}`, label: L(`${LANG}.Hud.Reload`), icon: "fa-solid fa-rotate" });
      // the sheet's Change Ammo: unload, or load another kind
      buttons.push({ key: `ammo:${w.id}`, label: L(`${LANG}.Hud.ChangeAmmo`), icon: "fa-solid fa-arrow-right-arrow-left" });
    }
    // Neon Arsenal's switches: a Power gun's ricochet, a Tech gun's charge.
    const upgrades = Rebuilds.upgradesOf(w, actor);
    buttons.push(...Rebuilds.buttons(actor, w, traitsOf(ranged ? flavorOf(w, upgrades) : null, upgrades)));
    const mag = s.magazine;
    out.weapons.push({
      key: `weapon:${slug(w.name)}`, label: w.name, img: w.img,
      sub: ranged && mag ? `${Number(mag.value) || 0}/${Number(mag.max) || 0}` : (s.damage ? String(s.damage) : ""),
      alert: ranged && mag && Number(mag.max) > 0 && !Number(mag.value), buttons
    });
  }

  // Bare Hands: a Brawling attack with Cyberpunk RED's Unarmed weapon, equipped (and made) on use.
  if (Hands.unarmedOf(actor)?.system?.equipped !== "equipped") {
    const brawl = items.find((i) => i.type === "skill" && slug(i.name) === "brawling");
    const base = brawl ? CPR.stat(actor, brawl.system?.stat || "dex") + (Number(brawl.system?.level) || 0) : null;
    out.weapons.push({ key: "hands:bare", run: "brawl:attack", label: L(`${LANG}.Hud.BareHands`), icon: "fa-solid fa-hand-back-fist", sub: base === null ? "" : `+${base}` });
  }

  // Equip / Change Weapon: the hands, what's in them, and the Carried weapons to put in them.
  const hands = Hands.state(actor);
  out.weapons.push({ key: "hands:equip", run: "hands:open", label: L(`${LANG}.Hud.Equip`), icon: "fa-solid fa-hand-fist", sub: L(`${LANG}.Hud.HandsFree`, { free: hands.free, total: hands.total }), alert: !hands.held.length && !!hands.carried.length });

  // Skills: STAT + level, as the sheet shows them.
  for (const sk of items.filter((i) => i.type === "skill").sort((a, b) => a.name.localeCompare(b.name))) {
    const base = CPR.stat(actor, sk.system?.stat) + (Number(sk.system?.level) || 0);
    out.skills.push({ key: `skill:${slug(sk.name)}`, run: `sk:${sk.id}`, label: sk.name, sub: `+${base}`, icon: "fa-solid fa-dice" });
  }

  // Role abilities that roll.
  for (const role of items.filter((i) => i.type === "role")) {
    const s = role.system ?? {};
    if (s.hasRoll && s.mainRoleAbility) {
      out.role.push({ key: `role:${slug(s.mainRoleAbility)}`, run: `ra:${role.id}:main:${s.mainRoleAbility}`, label: s.mainRoleAbility, sub: role.name, icon: "fa-solid fa-diamond" });
    }
    for (const a of s.abilities ?? []) {
      if (a?.hasRoll && a.name) out.role.push({ key: `role:${slug(a.name)}`, run: `ra:${role.id}:sub:${a.name}`, label: a.name, sub: role.name, icon: "fa-regular fa-gem" });
    }
  }

  // Netrunning: the Interface abilities, with a cyberdeck to run them on.
  const deck = items.find((i) => i.type === "cyberdeck" && (i.system?.equipped === "equipped" || i.system?.isInstalled));
  if (deck) {
    for (const ab of INTERFACE) {
      out.net.push({ key: `net:${ab}`, run: `net:${deck.id}:${ab}`, label: cpr(`CPR.global.role.netrunner.interfaceAbility.${ab}`, ab[0].toUpperCase() + ab.slice(1)), icon: "fa-solid fa-network-wired" });
    }
  }

  // Status: this module's conditions, on or off.
  for (const c of Registry.all().filter((x) => STATUS_CATS.includes(x.category) && !/^(tarot|stakes)/.test(x.id))) {
    out.status.push({ key: `cond:${c.id}`, label: c.name, img: c.img, on: Conditions.has(c.id, actor) });
  }

  // Utility: this module's windows for this character.
  out.utility.push({ key: "util:stakes", label: L(`${LANG}.Stakes.Title`), icon: "fa-solid fa-dice-six" });
  if (Phone.on) out.utility.push({ key: "util:phone", label: L(`${LANG}.Holocall.Title`), icon: "fa-solid fa-phone-volume" });
  out.utility.push({ key: "util:biomon", label: L(`${LANG}.Biomon.Title`), icon: "fa-solid fa-heart-pulse" });
  if (Hub.playersMayOpen()) out.utility.push({ key: "util:map", label: L(`${LANG}.Hub.Title`), icon: "fa-solid fa-map-location-dot" });
  out.utility.push({ key: "util:sheet", label: L(`${LANG}.Hud.Sheet`), icon: "fa-solid fa-id-card" });

  // Macros: every macro the user can run (Neon At Home's windows, a GM's handouts...), by name.
  out.macros.push(...macrosFor());

  // STATs.
  for (const s of STATS) {
    if (getProperty(actor, `system.stats.${s}`) === undefined) continue;
    out.stats.push({ key: `stat:${s}`, label: cpr(`CPR.global.stats.${s}`, s.toUpperCase()), sub: String(CPR.stat(actor, s)), icon: "fa-solid fa-dice" });
  }

  // Gear: drugs to take.
  for (const d of items.filter((i) => i.type === "drug")) {
    out.gear.push({ key: `drug:${slug(d.name)}`, run: `drug:${d.id}`, label: d.name, img: d.img, sub: `×${Number(d.system?.amount) || 0}`, off: !Number(d.system?.amount) });
  }
  return out;
}
