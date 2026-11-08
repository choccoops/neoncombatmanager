/**
 * Neon Arsenal's Automated Animations profile, pure (tests and tools/gen-aa-profile.mjs import
 * it): one Global Automatic Recognition entry per kind of weapon, its 2070 flavor and the ammo
 * worth its own look, drawn with JB2A. Patreon JB2A gets its grenades, launcher rounds and
 * coloured bullets; the free pack the nearest look it has.
 *
 * Entries are labelled "Neon Arsenal · <Kind>[ · <Flavor>][ · <Ammo>]" and marked exact-match, so
 * AA never hands them to some other item by name: Neon Arsenal picks the entry for each attack
 * itself (scripts/arsenal/aa.js), whatever the item is called.
 *
 * Sounds: in a world with Neon Combat Manager the entries are silent and the module plays the
 * sounds on each client at that player's FX volume (they're quiet by default). The exported JSON
 * for a world without it carries them, low.
 */
import { LABEL_PREFIX } from "./kinds.js";

/** The AA Global Automatic Recognition menu version these entries are written for (AA 5.x). */
export const AUTOREC_VERSION = 5;

export const SFX_ROOT = "modules/cpr-neon-combat-manager/assets/arsenal/sfx";

/**
 * Sounds, by key: their takes (files) and the share of the player's FX volume each plays at.
 * Files are levelled to about -22 dBFS RMS with peaks under -4 dBFS.
 */
export const SOUNDS = {
  pistol: { takes: ["pistol-a", "pistol-b"], level: 0.6 },
  heavyPistol: { takes: ["heavy-pistol-a", "heavy-pistol-b"], level: 0.6 },
  smgBurst: { takes: ["smg-burst-a", "smg-burst-b"], level: 0.55 },
  rifle: { takes: ["rifle-a", "rifle-b"], level: 0.6 },
  rifleBurst: { takes: ["rifle-burst-a", "rifle-burst-b"], level: 0.55 },
  shotgun: { takes: ["shotgun-a", "shotgun-b"], level: 0.6 },
  sniper: { takes: ["sniper-a", "sniper-b"], level: 0.6 },
  smart: { takes: ["smart-a", "smart-b"], level: 0.6 },
  tech: { takes: ["tech-a", "tech-b"], level: 0.6 },
  techCharge: { takes: ["tech-charge-a", "tech-charge-b"], level: 0.5, fadeIn: 200 },
  ricochet: { takes: ["ricochet-a", "ricochet-b"], level: 0.55 },
  impactBody: { takes: ["impact-body-a", "impact-body-b"], level: 0.45 },
  impactArmor: { takes: ["impact-armor-a", "impact-armor-b"], level: 0.45 },
  grenadeBlast: { takes: ["grenade-blast-a", "grenade-blast-b"], level: 0.6, fadeIn: 30 },
  rocketBlast: { takes: ["rocket-blast-a", "rocket-blast-b"], level: 0.6, fadeIn: 30 },
  launcher: { takes: ["launcher-a", "launcher-b"], level: 0.55 },
  rocketLaunch: { takes: ["rocket-launch-a", "rocket-launch-b"], level: 0.55 },
  bow: { takes: ["bow-a"], level: 0.55 },
  blade: { takes: ["blade-a", "blade-b"], level: 0.55 },
  blunt: { takes: ["blunt-a", "blunt-b"], level: 0.55 },
  monoblade: { takes: ["monoblade-a", "monoblade-b"], level: 0.5 },
  flamethrower: { takes: ["flamethrower-a", "flamethrower-b"], level: 0.5, fadeIn: 150 },
  smoke: { takes: ["smoke-a", "smoke-b"], level: 0.5, fadeIn: 150 },
  emp: { takes: ["emp-a", "emp-b"], level: 0.5 }
};

export const soundFiles = (key) => (SOUNDS[key]?.takes ?? []).map((t) => `${SFX_ROOT}/${t}.ogg`);

/** A JB2A look in AA's terms: [dbSection, menuType, animation, variant, color]. */
const v = (dbSection, menuType, animation, variant, color) => ({ dbSection, menuType, animation, variant, color });
const R = (animation, variant, color) => v("range", "weapon", animation, variant, color);
const M = (animation, variant, color) => v("melee", "weapon", animation, variant, color);
const impact = (color) => v("static", "generic", "impact", "01", color);
const explosion = (color) => v("static", "generic", "explosion", "01", color);

/**
 * The profile. Each row: { kind, flavor?, ammo?, menu, free, patreon?, sound, burst?, hit?,
 * hitPatreon?, tint?, size?, repeatDelay? }. `hit` is the secondary on the target.
 */
export const ROWS = [
  // Pistols and SMGs
  { kind: "Pistol", menu: "range", free: R("bullet", "1", "orange"), sound: "pistol", burst: "smgBurst", hit: impact("orange") },
  { kind: "Heavy Pistol", menu: "range", free: R("bullet", "2", "orange"), sound: "heavyPistol", burst: "smgBurst", hit: impact("orange") },
  { kind: "Very Heavy Pistol", menu: "range", free: R("bullet", "2", "orange"), sound: "heavyPistol", hit: impact("orange") },
  { kind: "SMG", menu: "range", free: R("bullet", "1", "orange"), sound: "pistol", burst: "smgBurst", hit: impact("orange"), repeatDelay: 90 },
  { kind: "Heavy SMG", menu: "range", free: R("bullet", "2", "orange"), sound: "heavyPistol", burst: "smgBurst", hit: impact("orange"), repeatDelay: 90 },
  // Rifles and shotguns
  { kind: "Assault Rifle", menu: "range", free: R("bullet", "2", "orange"), sound: "rifle", burst: "rifleBurst", hit: impact("orange"), repeatDelay: 110 },
  { kind: "Sniper Rifle", menu: "range", free: R("snipe", "01", "blue"), patreon: R("snipe", "01", "orange"), sound: "sniper", hit: impact("orange") },
  { kind: "Shotgun", menu: "range", free: R("bullet", "2", "orange"), sound: "shotgun", hit: impact("orange") },
  { kind: "Shotgun Shell", menu: "range", free: R("bullet", "3", "blue"), patreon: R("bullet", "3", "orange"), sound: "shotgun", hit: impact("orange") },
  { kind: "Bow", menu: "range", free: R("arrow", "regular", "regular"), patreon: R("arrow", "physical", "white"), sound: "bow", hit: null },
  // Launchers (Neon Arsenal draws the blast itself when it places the area; these are the shot)
  { kind: "Grenade Launcher", menu: "range", free: R("bomb", "01", "black"), patreon: R("grenadelaunch", "01", "green"), sound: "launcher", hit: explosion("orange") },
  { kind: "Rocket Launcher", menu: "range", free: R("bomb", "01", "black"), patreon: R("grenadelaunch", "02", "blackyellow"), sound: "rocketLaunch", hit: explosion("orange"), size: 2 },
  { kind: "Missile Launcher", menu: "range", free: R("bomb", "01", "black"), patreon: R("grenadelaunch", "03", "blackblue"), sound: "rocketLaunch", hit: explosion("orange"), size: 2 },
  { kind: "Thrown Grenade", menu: "range", free: R("flask", "01", "orange"), patreon: R("grenade", "01", "green"), sound: "launcher", hit: explosion("orange") },
  { kind: "Thrown Weapon", menu: "range", free: R("dagger", "01", "white"), sound: "blade", hit: null },
  { kind: "Flamethrower", menu: "range", free: R("lasershot", "01", "orange"), sound: "flamethrower", hit: null },
  // 2070 flavors: Tech fires a charged magnetic round, Smart a guided one.
  ...["Pistol", "Heavy Pistol", "Very Heavy Pistol", "SMG", "Heavy SMG", "Assault Rifle", "Shotgun", "Bow"].flatMap((kind) => [
    { kind, flavor: "Tech", menu: "range", free: R("lasershot", "01", "blue"), sound: "tech", burst: kind.includes("SMG") || kind === "Assault Rifle" ? "rifleBurst" : null, hit: impact("blue"), repeatDelay: 110 },
    { kind, flavor: "Smart", menu: "range", free: R("bullet", "3", "blue"), patreon: R("bullet", "1", "green"), sound: "smart", burst: kind.includes("SMG") || kind === "Assault Rifle" ? "rifleBurst" : null, hit: impact("yellow"), repeatDelay: 110 }
  ]),
  { kind: "Sniper Rifle", flavor: "Tech", menu: "range", free: R("snipe", "01", "blue"), sound: "tech", hit: impact("blue") },
  { kind: "Sniper Rifle", flavor: "Smart", menu: "range", free: R("snipe", "01", "blue"), patreon: R("snipe", "01", "green"), sound: "smart", hit: impact("yellow") },
  // Ammo with its own look
  ...["Pistol", "Heavy Pistol", "Very Heavy Pistol", "SMG", "Heavy SMG", "Assault Rifle", "Sniper Rifle", "Shotgun", "Bow"].flatMap((kind) => [
    { kind, ammo: "Incendiary", menu: "range", free: R("bullet", "2", "orange"), patreon: R("bullet", "2", "red"), sound: kind === "Bow" ? "bow" : "rifle", hit: v("static", "spell", "fireball", "nodebris", "orange"), hitSize: 0.6 },
    { kind, ammo: "EMP", menu: "range", free: R("lasershot", "01", "blue"), sound: "emp", hit: impact("blue") }
  ]),
  // Melee
  { kind: "Knife", menu: "melee", free: M("dagger", "01", "white"), sound: "blade" },
  { kind: "Blade", menu: "melee", free: M("sword", "01", "white"), sound: "blade" },
  { kind: "Heavy Blade", menu: "melee", free: M("greatsword", "01", "white"), sound: "blade" },
  { kind: "Blunt", menu: "melee", free: M("club", "01", "white"), sound: "blunt" },
  { kind: "Heavy Blunt", menu: "melee", free: M("warhammer", "01", "white"), sound: "blunt" },
  { kind: "Monowire", menu: "melee", free: M("lasersword", "01", "blue"), sound: "monoblade" },
  { kind: "Unarmed", menu: "melee", free: M("unarmedstrike", "physical", "blue"), sound: "blunt" },
  // Melee Rebuilds: a mono-edged blade glows; a Propulsion Impact hits harder.
  ...["Knife", "Blade", "Heavy Blade"].map((kind) => ({ kind, ammo: "Monoblade", menu: "melee", free: M(kind === "Knife" ? "dagger" : kind === "Blade" ? "sword" : "greatsword", "01", "white"), sound: "monoblade", tint: "#3ff5ff" })),
  ...["Blunt", "Heavy Blunt"].map((kind) => ({ kind, ammo: "Propulsion", menu: "melee", free: M(kind === "Blunt" ? "club" : "warhammer", "01", "white"), sound: "blunt", hit: impact("orange") }))
];

/** A row's label: "Neon Arsenal · Assault Rifle · Tech". */
export const rowLabel = (row) => [`${LABEL_PREFIX}${row.kind}`, row.flavor, row.ammo].filter(Boolean).join(" · ");

const sound = (key, on) => {
  const files = soundFiles(key);
  return { enable: !!on && files.length > 0, delay: 0, file: files[0], repeat: 1, repeatDelay: 250, startTime: 0, volume: 0.25 };
};
const silent = () => ({ enable: false, delay: 0, file: undefined, repeat: 1, repeatDelay: 250, startTime: 0, volume: 0.75 });
const video = (x) => ({ ...x, enableCustom: false, customPath: "" });

const secondaryOf = (hit, size = 1) => ({
  enable: !!hit,
  video: video(hit ?? impact("orange")),
  sound: silent(),
  options: { addTokenWidth: false, anchor: "0.5", contrast: 0, delay: 0, elevation: 1000, fadeIn: 0, fadeOut: 300, isMasked: false, isRadius: false, isWait: false, opacity: 0.9, repeat: 1, repeatDelay: 250, saturate: 0, size, tint: false, tintColor: "#FFFFFF", zIndex: 1 }
});

const sideOf = () => ({
  enable: false,
  video: video(v("static", "spell", "curewounds", "01", "blue")),
  sound: silent(),
  options: { addTokenWidth: false, anchor: "0.5", contrast: 0, delay: 0, elevation: 1000, fadeIn: 250, fadeOut: 500, isMasked: false, isRadius: false, isWait: true, opacity: 1, repeat: 1, repeatDelay: 250, saturate: 0, size: 1, tint: false, tintColor: "#FFFFFF", zIndex: 1 }
});

/**
 * One AA entry from a row.
 * @param {object} row
 * @param {object} opts - { patreon: boolean, sounds: boolean, id: () => string, version: string }
 */
export function entryFor(row, { patreon = false, sounds = false, id = () => "", version = "" } = {}) {
  const look = (patreon && row.patreon) || row.free;
  const isMelee = row.menu === "melee";
  const tint = !!row.tint;
  const options = isMelee
    ? { contrast: 0, delay: 0, elevation: 1000, isWait: false, opacity: 1, playbackRate: 1, repeat: 1, repeatDelay: 250, saturate: 0, size: 1, tint, tintColor: row.tint ?? "#FFFFFF", zIndex: 1 }
    : { contrast: 0, delay: 0, elevation: 1000, isReturning: false, isWait: false, onlyX: false, opacity: 1, playbackRate: 1, repeat: 1, repeatDelay: row.repeatDelay ?? 250, saturate: 0, tint, tintColor: row.tint ?? "#FFFFFF", zIndex: 1 };
  const entry = {
    id: id(),
    label: rowLabel(row),
    menu: row.menu,
    advanced: { exactMatch: true, excludedTerms: [] },
    metaData: { name: "Neon Arsenal", moduleVersion: version, version: AUTOREC_VERSION, ncmSound: row.sound, ncmBurst: row.burst ?? null },
    primary: { video: video(look), sound: sound(row.sound, sounds), options },
    secondary: secondaryOf((patreon && row.hitPatreon) || row.hit, row.hitSize ?? row.size ?? 1),
    soundOnly: { sound: silent() },
    macro: { enable: false, name: undefined, args: undefined, playWhen: undefined },
    source: sideOf(),
    target: { ...sideOf(), options: { ...sideOf().options, isWait: undefined, persistent: false, unbindAlpha: false, unbindVisibility: false } },
    levels3d: { type: "sprite", data: { color01: "#FFFFFF", color02: "#FFFFFF", spritePath: "", speed: 10, scale: 0.5 }, sound: { enable: false }, secondary: { enable: false, data: { color01: "#FFFFFF", color02: "#FFFFFF" } }, tokens: { enable: false }, enable: false }
  };
  if (isMelee) {
    entry.meleeSwitch = { video: video(R("dagger", "01", "white")), sound: silent(), options: { detect: "automatic", range: 2, returning: false, switchType: "on" } };
  }
  return entry;
}

/**
 * The whole menu, in AA's export shape: { melee, range, ontoken, templatefx, aura, preset, aefx,
 * version }. Only melee and range have entries.
 */
export function buildMenu(opts = {}) {
  let n = 0;
  const id = opts.id ?? (() => `neon-arsenal-${String(++n).padStart(3, "0")}`);
  const entries = ROWS.map((row) => entryFor(row, { ...opts, id }));
  return {
    melee: entries.filter((e) => e.menu === "melee"),
    range: entries.filter((e) => e.menu === "range"),
    ontoken: [],
    templatefx: [],
    aura: [],
    preset: [],
    aefx: [],
    version: AUTOREC_VERSION
  };
}

/** The profile row for the most specific of these labels (see kinds.js profileKeys), or null. */
export function rowFor(keys) {
  for (const k of keys) {
    const row = ROWS.find((r) => rowLabel(r) === k);
    if (row) return row;
  }
  return null;
}

/**
 * What an attack sounds like, in order: [{ key, delay }]. The shot (a burst for Autofire and
 * Suppressive Fire), a ricochet's whine, then an impact on a hit. Explosions sound when the
 * blast lands (scripts/arsenal/blast.js), not here.
 * @param {string[]} keys - profile labels, most specific first
 * @param {object} ctx - { mode: "single"|"autofire"|"suppressive", ricochet, hit, ranged, explosive }
 */
export function soundPlan(keys, { mode = "single", ricochet = false, hit = false, ranged = true, explosive = false } = {}) {
  const row = rowFor(keys);
  if (!row) return [];
  const burst = mode === "autofire" || mode === "suppressive";
  const out = [{ key: (burst && row.burst) || row.sound, delay: 0 }];
  if (ricochet) out.push({ key: "ricochet", delay: 260 });
  if (hit && ranged && !explosive && row.sound !== "flamethrower") out.push({ key: "impactBody", delay: ricochet ? 520 : 380 });
  return out;
}

/** Is an AA entry one of ours? */
export const isOurs = (entry) => typeof entry?.label === "string" && entry.label.startsWith(LABEL_PREFIX);

/**
 * Put our entries in a menu section: the player's own entries stay as they are, ours are replaced
 * by the current ones (so an update reaches worlds that installed an older profile).
 */
export function mergeSection(existing = [], ours = []) {
  return [...existing.filter((e) => !isOurs(e)), ...ours];
}
