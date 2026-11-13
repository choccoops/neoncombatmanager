/**
 * Neon Arsenal's reading of a weapon, pure (tests import it): what kind of gun or blade it is,
 * its 2070 flavor (Power, Smart or Tech), the ammo in it, and whether it hits an area.
 *
 * Neon Hub's Item Compendium (2070s) marks a gun's flavor in `flags.cpr-neon-hub.weaponType2070`;
 * the generic guns carry it in their names ("Assault Rifle (Excellent, Tech)"), Iconics on their
 * card ("Built-in: Power Rebuild", "• POWER"), and a converted RED-era gun has a Power, Smart or
 * Tech Rebuild installed (Edgerunners Mission Kit). The first of these that answers wins.
 */
import { parseSpecials } from "./specials.js";

export const NEON_HUB = "cpr-neon-hub";
export const FLAVORS = ["power", "smart", "tech"];

/** Neon Arsenal's labels in Automated Animations' menus all start with this. */
export const LABEL_PREFIX = "Neon Arsenal · ";

/** Kinds, in the words the profile's labels use. */
export const KIND_LABEL = {
  pistol: "Pistol",
  heavyPistol: "Heavy Pistol",
  vHeavyPistol: "Very Heavy Pistol",
  smg: "SMG",
  heavySmg: "Heavy SMG",
  assaultRifle: "Assault Rifle",
  sniperRifle: "Sniper Rifle",
  shotgun: "Shotgun",
  shotgunShell: "Shotgun Shell",
  bow: "Bow",
  grenadeLauncher: "Grenade Launcher",
  rocketLauncher: "Rocket Launcher",
  missileLauncher: "Missile Launcher",
  thrownGrenade: "Thrown Grenade",
  thrown: "Thrown Weapon",
  flamethrower: "Flamethrower",
  blade: "Blade",
  lightBlade: "Knife",
  heavyBlade: "Heavy Blade",
  blunt: "Blunt",
  heavyBlunt: "Heavy Blunt",
  monowire: "Monowire",
  unarmed: "Unarmed"
};

export const FLAVOR_LABEL = { power: "Power", smart: "Smart", tech: "Tech" };

/** Ammo types worth their own look (the rest look like Basic). */
export const AMMO_LABEL = { incendiary: "Incendiary", emp: "EMP", smoke: "Smoke", flashbang: "Flashbang", teargas: "Teargas" };

const BLADE = /\b(knife|knives|punknife|blade|katana|sword|machete|wakizashi|dagger|kukri|tanto|mantis|scalpel|razor|cleaver|axe|hatchet|scythe|spear|bayonet|claw|wolvers|ripper|kris|shiv|nodachi|odachi)\b/i;
const LIGHT_BLADE = /\b(knife|knives|punknife|dagger|scalpel|razor|shiv|tanto|kunai|claws?|wolvers|rippers?)\b/i;
const FLAME = /\b(flamethrower|flame ?thrower|crisp-?er|incinerator)\b/i;
const MONOWIRE = /\bmono-?wire\b/i;

const ammoOf = (ammo) => (ammo && typeof ammo === "object" ? ammo : null);

/** The weapon's 2070 flavor, or null. */
export function flavorOf(weapon, upgrades = []) {
  const flag = weapon?.flags?.[NEON_HUB]?.weaponType2070;
  if (FLAVORS.includes(flag)) return flag;
  const name = String(weapon?.name ?? "");
  const named = /\((?:[^)]*,\s*)?(Power|Smart|Tech)\)\s*$/i.exec(name);
  if (named) return named[1].toLowerCase();
  for (const u of upgrades) {
    const m = /\b(Power|Smart|Tech) Rebuild\b/i.exec(String(u?.name ?? ""));
    if (m) return m[1].toLowerCase();
  }
  const text = String(weapon?.system?.description?.value ?? "").replace(/<[^>]+>/g, " ");
  const card = /Built-in:\s*(Power|Smart|Tech) Rebuild/i.exec(text) ?? /•\s*(POWER|SMART|TECH)\b/.exec(text);
  return card ? card[1].toLowerCase() : null;
}

/**
 * Does the weapon's own attack modifier already hold Smart's +1? Neon Hub's Smart guns have it in
 * their attack modifier (an Excellent one +2), and so may a Smart Rebuild item's modifiers.
 * @param {object[]} upgrades - { name, attack } (attack: the upgrade's attack modifier)
 */
export function smartBaked(weapon, upgrades = []) {
  if (weapon?.flags?.[NEON_HUB]?.weaponType2070 === "smart") return true;
  return upgrades.some((u) => /\bSmart Rebuild\b/i.test(String(u?.name ?? "")) && Number(u?.attack) >= 1);
}

/** A melee weapon's kind from its type and name. */
function meleeKind(type, name) {
  if (MONOWIRE.test(name)) return "monowire";
  const blade = BLADE.test(name);
  if (type === "lightMelee") return blade || !name ? (LIGHT_BLADE.test(name) ? "lightBlade" : "blade") : "blunt";
  if (type === "medMelee") return blade ? (LIGHT_BLADE.test(name) ? "lightBlade" : "blade") : "blunt";
  return blade ? "heavyBlade" : "heavyBlunt";
}

/**
 * What a weapon is, for its animation, sound and area:
 * { kind, flavor, ammoVariety, ammoType, ranged, explosive, area }
 * @param {object} weapon - a CPR weapon (or weapon cyberware)
 * @param {object} [ammo] - the ammo loaded in it
 * @param {object[]} [upgrades] - its installed upgrades
 */
export function classify(weapon, ammo = null, upgrades = []) {
  const s = weapon?.system ?? {};
  const name = String(weapon?.name ?? "");
  const type = String(s.weaponType ?? "");
  const a = ammoOf(ammo);
  const ammoVariety = String(a?.system?.variety ?? "");
  const ammoType = String(a?.system?.type ?? "");
  let kind;
  switch (type) {
    case "medPistol":
      kind = "pistol";
      break;
    case "heavyPistol":
    case "vHeavyPistol":
    case "smg":
    case "heavySmg":
    case "assaultRifle":
    case "sniperRifle":
    case "bow":
    case "grenadeLauncher":
      kind = type;
      break;
    case "shotgun":
      kind = ammoVariety === "shotgunShell" ? "shotgunShell" : "shotgun";
      break;
    case "rocketLauncher":
      // The table it was made with: a Long Tube (Neon Hub's Range Table Modification) moves it to DV Missile Launcher, but it still fires rockets.
      kind = /missile/i.test(`${name} ${weapon?.flags?.[NEON_HUB]?.dvTableBase ?? s.dvTable ?? ""}`) ? "missileLauncher" : "rocketLauncher";
      break;
    case "thrownWeapon":
      kind = ammoVariety === "grenade" || /grenade/i.test(name) ? "thrownGrenade" : "thrown";
      break;
    case "unarmed":
    case "martialArts":
      kind = "unarmed";
      break;
    case "lightMelee":
    case "medMelee":
    case "heavyMelee":
    case "vHeavyMelee":
      kind = meleeKind(type, name);
      break;
    default:
      kind = s.isRanged ? "pistol" : "blunt";
  }
  if (FLAME.test(name)) kind = "flamethrower";
  const ranged = !!s.isRanged || ["grenadeLauncher", "rocketLauncher", "missileLauncher", "thrownGrenade", "flamethrower"].includes(kind);
  const explosive = ["grenadeLauncher", "rocketLauncher", "missileLauncher", "thrownGrenade"].includes(kind) || ammoVariety === "grenade" || ammoVariety === "rocket";
  return {
    kind,
    flavor: ranged ? flavorOf(weapon, upgrades) : null,
    ammoVariety,
    ammoType,
    ranged,
    explosive,
    area: areaOf({ kind, explosive, ammo: a, own: parseSpecials(s.description?.value)?.area })
  };
}

/**
 * The area an attack covers, or null for one that hits a single target:
 *   { shape: "rect", size }           - a square size × size m/yds, centred on the square picked
 *   { shape: "cone", size, angle }    - from the attacker, size m/yds long
 * 2070 Core Rules Ch07 (Firing Modes): explosives cover 10×10m and Shotgun Shells everything in
 * front of you within 6m; an ammo card that names its own area ("a 6×6m area", "14×14m") wins.
 */
export function areaOf({ kind, explosive, ammo, own = null }) {
  const text = String(ammo?.system?.description?.value ?? "").replace(/<[^>]+>/g, " ");
  const cone = /(\d+)\s*[×x]\s*\1\s*m(?:\/yds?)?\s+cone/i.exec(text);
  if (cone) return { shape: "cone", size: Number(cone[1]), angle: 90 };
  // A flamethrower fires Incendiary Shotgun Shells (Ch07, Weapons table).
  if (kind === "shotgunShell" || kind === "flamethrower") return { shape: "cone", size: 6, angle: 90 };
  if (!explosive) return null;
  const sq = /(\d+)\s*[×x]\s*(\d+)\s*m(?:\/yds?)?(?:\s+(?:area|square|blast))?/i.exec(text);
  if (sq && sq[1] === sq[2]) return { shape: "rect", size: Number(sq[1]) };
  // The weapon's own card ("Its grenades burst in a 6×6m area"), then the book's 10×10m.
  return { shape: "rect", size: own || 10 };
}

/**
 * The names to look the weapon up by in Automated Animations, most specific first: flavor and
 * ammo, then the ammo (fire or an EMP burst says more than the gun's colour), then the flavor:
 * "Neon Arsenal · Assault Rifle · Tech · EMP", "Neon Arsenal · Assault Rifle · EMP", ...
 */
export function profileKeys({ kind, flavor, ammoType }) {
  const base = `${LABEL_PREFIX}${KIND_LABEL[kind] ?? KIND_LABEL.pistol}`;
  const f = flavor ? FLAVOR_LABEL[flavor] : null;
  const a = AMMO_LABEL[ammoType] ?? null;
  const out = [];
  if (f && a) out.push(`${base} · ${f} · ${a}`);
  if (a) out.push(`${base} · ${a}`);
  if (f) out.push(`${base} · ${f}`);
  out.push(base);
  return out;
}

/** CPR's autofire DV tables named on a 2070 card, by the word in "Autofire (Machine Pistol 4)". */
const AUTOFIRE_TABLES = {
  "machine pistol": "DV Pistol (Autofire, Machine Pistol)",
  smg: "DV SMG (Autofire)",
  "assault rifle": "DV Assault Rifle (Autofire)",
  "machine gun": "DV Machine Gun (Autofire)"
};

/**
 * The DV table a weapon's Autofire rolls against. Neon Hub's flag when an attachment set it; else
 * the one a 2070 card names ("Autofire (Machine Gun 6)"); otherwise the table that goes with its type, the way CPR pairs them; else
 * "<table> (Autofire)" (what Diwako's DV display and the AA fork look for).
 */
export function autofireTable(weapon) {
  const s = weapon?.system ?? {};
  // Set by Neon Hub when an Autofire attachment changes it (a Constant Recoil System's Machine Gun table).
  const hub = weapon?.flags?.[NEON_HUB]?.autofireTable;
  if (hub) return hub;
  const text = String(s.description?.value ?? "").replace(/<[^>]+>/g, " ");
  const m = /Autofire\s*\(\s*([A-Za-z ]+?)\s*\d/i.exec(text);
  if (m) {
    const t = AUTOFIRE_TABLES[m[1].toLowerCase().trim()];
    if (t) return t;
  }
  const table = String(s.dvTable ?? "");
  switch (s.weaponType) {
    case "smg":
    case "heavySmg":
      return AUTOFIRE_TABLES.smg;
    case "assaultRifle":
      return /machine gun/i.test(table) ? AUTOFIRE_TABLES["machine gun"] : AUTOFIRE_TABLES["assault rifle"];
    case "medPistol":
    case "heavyPistol":
    case "vHeavyPistol":
      return AUTOFIRE_TABLES["machine pistol"];
    default:
      return table ? `${table} (Autofire)` : "";
  }
}

/** Ammo varieties that throw no muzzle flash (Diwako's rule: arrows, paintballs, grenades), plus rockets. */
export const NO_FLASH = ["arrow", "paintball", "grenade", "rocket"];

/**
 * Neon Hub's Shotgun Automatic Control Group with shells loaded: Autofire is the Shotgun Shell attack
 * made with the Autofire Skill, for 4 shells, and dodging it is at -3 (Item Compendium). Its flag, or its
 * name on an older copy: { shells, dodge } or null.
 */
export function shellAutofire(upgrades = [], ammoVariety = "") {
  if (ammoVariety !== "shotgunShell") return null;
  const group = upgrades
    .map((u) => u?.flags?.[NEON_HUB]?.burstMod ?? (/^Shotgun Automatic Control Group$/i.test(String(u?.name ?? "").trim()) ? { shells: 4, shellDodge: -3 } : null))
    .find((m) => m?.shells);
  return group ? { shells: Number(group.shells) || 4, dodge: Number(group.shellDodge) || 0 } : null;
}
