/** Neon Arsenal: weapon kinds, the AA profile, areas, DV tables, weapon traits, and the hooks that use them. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeActor, registerSettings, settle, root, asGM, missingKeys, chat, testUsers } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const { classify, flavorOf, areaOf, profileKeys, autofireTable, smartBaked, shellAutofire, LABEL_PREFIX } = await import("../scripts/arsenal/kinds.js");
const { ROWS, rowLabel, buildMenu, entryFor, mergeSection, isOurs, isUuidv4, uuidv4, soundPlan, soundFiles, SOUNDS, AUTOREC_VERSION } = await import("../scripts/arsenal/profile.js");
const { templateData, contains, tokenInside, centerOf, blownBack, blowBackMetres, ammoEffect, scatter, escapeSquare } = await import("../scripts/arsenal/area.js");
const { dvFromResults, dvLines, Dv } = await import("../scripts/arsenal/dv.js");
const { RebuildRegistry, traitsFromDef, traitsOf, attackMods, damageArgs, chargeHolds, Rebuilds } = await import("../scripts/arsenal/rebuilds.js");
const { Blast, damageFromHtml, tokensIn, SHELL_DV } = await import("../scripts/arsenal/blast.js");
const { AA, loadedAmmo } = await import("../scripts/arsenal/aa.js");
const { Arsenal, rollKind, smartRetry, hitLines } = await import("../scripts/arsenal/arsenal.js");
const { Defense, dodgeAbility, defenseOutcome } = await import("../scripts/arsenal/defense.js");
const { CPR } = await import("../scripts/cpr.js");
Defense.init();
const { catalog } = await import("../scripts/hud/catalog.js");
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
Registry.refresh();

/* ---------------------------------------- */
/*  Fixtures                                */
/* ---------------------------------------- */

const weapon = (name, system = {}, flags = {}) => ({ name, type: "weapon", system: { isRanged: true, equipped: "equipped", fireModes: { autoFire: 0, suppressiveFire: false }, ...system }, flags });
const ammo = (name, variety, type = "basic", description = "") => ({ name, type: "ammo", system: { variety, type, amount: 10, description: { value: description } } });

// AA's menus, as AA registers them.
for (const m of ["melee", "range", "ontoken", "templatefx", "aura", "preset", "aefx"]) game.settings.register("autoanimations", `aaAutorec-${m}`, { default: [] });
game.settings.register("autoanimations", "aaAutorec", { default: { version: 5 } });
game.settings.register("autoanimations", "canMissTarget", { default: false });

const emitted = [];
game.socket.emit = (name, msg) => emitted.push(msg);

beforeEach(() => {
  asGM(true);
  emitted.length = 0;
  RebuildRegistry.clear();
  game.user.targets = new Set();
});

const keysOf = (file) => new Map(readFileSync(path.join(root, "tests", "fixtures", file), "utf8").split("\n").filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split(": ")).map(([k, c]) => [k, c.split(",")]));
const FREE = keysOf("aa-jb2a-free.txt");
const PATREON = keysOf("aa-jb2a-patreon.txt");
const has = (db, v) => db.get(`${v.dbSection}.${v.menuType}.${v.animation}.${v.variant}`)?.includes(v.color);

/* ---------------------------------------- */
/*  What a weapon is                        */
/* ---------------------------------------- */

test("a 2070 gun's flavor comes from Neon Hub's flag, its name, its card or a Rebuild", () => {
  assert.equal(flavorOf(weapon("Militech Crusher", { weaponType: "shotgun" }, { "cpr-neon-hub": { weaponType2070: "tech" } })), "tech");
  assert.equal(flavorOf(weapon("Heavy Pistol (Excellent, Power)")), "power");
  assert.equal(flavorOf(weapon("Assault Rifle (Smart)")), "smart");
  assert.equal(flavorOf(weapon("Amnesty", { description: { value: "<p>Class: Iconic • POWER</p>" } })), "power");
  assert.equal(flavorOf(weapon("Old Unity", {}), [{ name: "Smart Rebuild" }]), "smart");
  assert.equal(flavorOf(weapon("Plain gun")), null);
});

test("weapons sort into kinds; shells, launchers and flamethrowers hit an area", () => {
  assert.equal(classify(weapon("Pistol", { weaponType: "medPistol" })).kind, "pistol");
  const shells = classify(weapon("Pump", { weaponType: "shotgun" }), ammo("Basic Shells", "shotgunShell"));
  assert.equal(shells.kind, "shotgunShell");
  assert.deepEqual(shells.area, { shape: "cone", size: 6, angle: 90 });
  assert.equal(classify(weapon("Pump", { weaponType: "shotgun" }), ammo("Slugs", "shotgunSlug")).area, null);
  const gl = classify(weapon("M-9", { weaponType: "grenadeLauncher" }), ammo("Basic Grenade", "grenade"));
  assert.ok(gl.explosive);
  assert.deepEqual(gl.area, { shape: "rect", size: 10 });
  assert.equal(classify(weapon("Tube", { weaponType: "rocketLauncher", dvTable: "DV Missile Launcher" })).kind, "missileLauncher");
  const longTube = weapon("Tube", { weaponType: "rocketLauncher", dvTable: "DV Missile Launcher" }, { "cpr-neon-hub": { dvTableBase: "DV Rocket Launcher" } });
  assert.equal(classify(longTube).kind, "rocketLauncher", "a Long Tube changes the table, not the rockets");
  assert.equal(classify(weapon("Budget Arms Crisp-ER", { weaponType: "heavySmg" })).kind, "flamethrower");
  assert.equal(classify(weapon("Budget Arms Crisp-ER", { weaponType: "heavySmg" })).area.shape, "cone");
  assert.equal(classify(weapon("Frag", { weaponType: "thrownWeapon" }), ammo("Frag", "grenade")).kind, "thrownGrenade");
  // Neon Hub's Thrown Weapon, whatever grenade is loaded: thrown, an explosive, its own area.
  const thrower = weapon("Thrown Weapon", { weaponType: "thrownWeapon", dvTable: "DV Thrown Weapon", ammoVariety: ["grenade"] });
  const flash = classify(thrower, ammo("Grenade (Flashbang)", "grenade", "flashbang"));
  assert.deepEqual([flash.kind, flash.explosive, flash.ammoType, flash.area], ["thrownGrenade", true, "flashbang", { shape: "rect", size: 10 }]);
  assert.deepEqual(classify(thrower, ammo("Grenade (Laser)", "grenade", "basic", "sweeping lasers across a 6×6m area")).area, { shape: "rect", size: 6 });
});

test("an ammo card that names its own area wins", () => {
  assert.deepEqual(areaOf({ kind: "thrownGrenade", explosive: true, ammo: ammo("Laser Grenade", "grenade", "basic", "sweeping lasers across a 6×6m area") }), { shape: "rect", size: 6 });
  assert.deepEqual(areaOf({ kind: "grenadeLauncher", explosive: true, ammo: ammo("Wall-Piercing Grenade", "grenade", "basic", "bursts as a 6d6 explosive in a 6×6m cone beyond") }), { shape: "cone", size: 6, angle: 90 });
  assert.deepEqual(areaOf({ kind: "grenadeLauncher", explosive: true, ammo: ammo("Smoke", "grenade", "smoke", "Fills a 10×10m/yd area with smoke") }), { shape: "rect", size: 10 });
});

test("melee weapons: blades, blunt weapons, monowire, fists", () => {
  const melee = (name, weaponType) => classify({ name, type: "weapon", system: { isRanged: false, weaponType } }).kind;
  assert.equal(melee("Combat Knife", "lightMelee"), "lightBlade");
  assert.equal(melee("Punknife", "medMelee"), "lightBlade", "a Neon Hub mook's stand-in");
  assert.equal(melee("Katana", "heavyMelee"), "heavyBlade");
  assert.equal(melee("Baseball Bat", "medMelee"), "blunt");
  assert.equal(melee("Sledgehammer", "vHeavyMelee"), "heavyBlunt");
  assert.equal(melee("Monowire", "lightMelee"), "monowire");
  assert.equal(melee("Gorilla Arms", "martialArts"), "unarmed");
  assert.equal(classify({ name: "Katana", system: { weaponType: "heavyMelee" } }).flavor, null);
});

test("the Autofire table: the one a 2070 card names, else the type's", () => {
  assert.equal(autofireTable(weapon("Alabai", { weaponType: "shotgun", dvTable: "DV Short Barrel Shotgun", description: { value: "Autofire (Machine Pistol 4)." } })), "DV Pistol (Autofire, Machine Pistol)");
  assert.equal(autofireTable(weapon("Carbine", { weaponType: "assaultRifle", dvTable: "DV Carbine", description: { value: "Autofire (SMG 3)" } })), "DV SMG (Autofire)");
  assert.equal(autofireTable(weapon("AR", { weaponType: "assaultRifle", dvTable: "DV Assault Rifle" })), "DV Assault Rifle (Autofire)");
  assert.equal(autofireTable(weapon("MG", { weaponType: "assaultRifle", dvTable: "DV Machine Gun" })), "DV Machine Gun (Autofire)");
  assert.equal(autofireTable(weapon("SMG", { weaponType: "heavySmg", dvTable: "DV SMG" })), "DV SMG (Autofire)");
  assert.equal(autofireTable(weapon("Odd", { weaponType: "bow", dvTable: "DV Bow" })), "DV Bow (Autofire)");
  // Neon Hub's Range Table Modifications move the single-shot table; Autofire stays the type's.
  const hub = { "cpr-neon-hub": { dvTableBase: "DV SMG" } };
  assert.equal(autofireTable(weapon("Short Barrel SMG", { weaponType: "smg", dvTable: "DV Subcompact SMG" }, hub)), "DV SMG (Autofire)");
  assert.equal(autofireTable(weapon("Marksman AR", { weaponType: "assaultRifle", dvTable: "DV Marksman Rifle" })), "DV Assault Rifle (Autofire)");
  assert.equal(autofireTable(weapon("Long Barrel", { weaponType: "heavyPistol", dvTable: "DV Long Barrel Pistol" })), "DV Pistol (Autofire, Machine Pistol)");
  assert.equal(autofireTable(weapon("Choked", { weaponType: "shotgun", dvTable: "DV Long Barrel Shotgun" })), "DV Long Barrel Shotgun (Autofire)", "no such table: forWeapon falls back to the single-shot one");
  // Neon Hub's Autofire attachments name the new table on the gun, ahead of its card.
  const recoil = weapon("Recoil AR", { weaponType: "assaultRifle", dvTable: "DV Assault Rifle", description: { value: "Autofire (Assault Rifle 4)" } }, { "cpr-neon-hub": { autofireTable: "DV Machine Gun (Autofire)" } });
  assert.equal(autofireTable(recoil), "DV Machine Gun (Autofire)");
  assert.equal(autofireTable(weapon("Autosear", { weaponType: "heavyPistol", dvTable: "DV Snubnose Pistol" }, { "cpr-neon-hub": { autofireTable: "DV Pistol (Autofire, Machine Pistol)" } })), "DV Pistol (Autofire, Machine Pistol)");
});

test("the DV a weapon faces follows its own table, so a Snub Barrel's swap shows everywhere", async () => {
  Dv.clear();
  Dv.cache.set("DV Pistol", [{ range: [0, 6], text: "13" }]);
  Dv.cache.set("DV Snubnose Pistol", [{ range: [0, 6], text: "11" }]);
  Dv.cache.set("DV Pistol (Autofire, Machine Pistol)", [{ range: [0, 6], text: "17" }]);
  const snub = weapon("Snub", { weaponType: "medPistol", dvTable: "DV Snubnose Pistol", fireModes: { autoFire: 3 } }, { "cpr-neon-hub": { dvTableBase: "DV Pistol" } });
  assert.equal(await Dv.forWeapon(snub, 5), 11);
  assert.equal(await Dv.forWeapon(snub, 5, { autofire: true }), 17);
  Dv.cache.set("DV Long Barrel Shotgun", [{ range: [0, 6], text: "15" }]);
  Dv.cache.set("DV Long Barrel Shotgun (Autofire)", null);
  assert.equal(await Dv.forWeapon(weapon("Choked", { weaponType: "shotgun", dvTable: "DV Long Barrel Shotgun" }), 5, { autofire: true }), 15);
  Dv.clear();
});

test("profile keys go from the most specific to the plain kind", () => {
  assert.deepEqual(profileKeys({ kind: "assaultRifle", flavor: "tech", ammoType: "emp" }), [
    `${LABEL_PREFIX}Assault Rifle · Tech · EMP`, `${LABEL_PREFIX}Assault Rifle · EMP`, `${LABEL_PREFIX}Assault Rifle · Tech`, `${LABEL_PREFIX}Assault Rifle`
  ]);
  assert.deepEqual(profileKeys({ kind: "blade", flavor: null, ammoType: "basic" }), [`${LABEL_PREFIX}Blade`]);
});

/* ---------------------------------------- */
/*  The profile                             */
/* ---------------------------------------- */

test("every look in the profile is one JB2A has, in the free pack and in Patreon's", () => {
  for (const row of ROWS) {
    assert.ok(has(FREE, row.free), `${rowLabel(row)}: free ${JSON.stringify(row.free)}`);
    assert.ok(has(PATREON, row.patreon ?? row.free), `${rowLabel(row)}: patreon`);
    if (row.hit) assert.ok(has(FREE, row.hit) && has(PATREON, row.hit), `${rowLabel(row)}: hit`);
  }
  const labels = ROWS.map(rowLabel);
  assert.equal(new Set(labels).size, labels.length, "labels are unique");
  // Every kind a weapon can be has a plain entry.
  for (const k of ["pistol", "heavyPistol", "vHeavyPistol", "smg", "heavySmg", "assaultRifle", "sniperRifle", "shotgun", "shotgunShell", "bow", "grenadeLauncher", "rocketLauncher", "missileLauncher", "thrownGrenade", "thrown", "flamethrower", "blade", "lightBlade", "heavyBlade", "blunt", "heavyBlunt", "monowire", "unarmed"]) {
    assert.ok(labels.includes(profileKeys({ kind: k }).at(-1)), k);
  }
});

test("every sound the profile plays ships in assets/arsenal/sfx", () => {
  for (const key of Object.keys(SOUNDS)) for (const f of soundFiles(key)) assert.ok(existsSync(path.join(root, f.replace(`modules/${M}/`, ""))), f);
  for (const row of ROWS) {
    assert.ok(SOUNDS[row.sound], `${rowLabel(row)} sound`);
    if (row.burst) assert.ok(SOUNDS[row.burst], `${rowLabel(row)} burst`);
  }
});

test("the AA menu: exact-match entries, silent in a world with the module, sounds in the export", () => {
  const menu = buildMenu({ patreon: false, sounds: false, version: "1.17.0" });
  assert.equal(menu.version, AUTOREC_VERSION);
  assert.equal(menu.melee.length + menu.range.length, ROWS.length);
  const ar = menu.range.find((e) => e.label === `${LABEL_PREFIX}Assault Rifle`);
  assert.equal(ar.advanced.exactMatch, true);
  assert.equal(ar.primary.video.animation, "bullet");
  assert.equal(ar.primary.sound.enable, false);
  assert.ok(ar.secondary.enable);
  assert.equal(ar.secondary.options.delay, 370, "the hit waits for the shot to arrive (AA plays both at once otherwise)");
  const exported = buildMenu({ patreon: true, sounds: true });
  const gl = exported.range.find((e) => e.label === `${LABEL_PREFIX}Grenade Launcher`);
  assert.equal(gl.primary.video.animation, "grenadelaunch");
  assert.ok(gl.primary.sound.enable && gl.primary.sound.volume <= 0.3, "low, for a world without the module");
  const mono = menu.melee.find((e) => e.label === `${LABEL_PREFIX}Blade · Monoblade`);
  assert.equal(mono.primary.options.tint, true);
  assert.ok(mono.meleeSwitch);
});

test("the shipped AA JSON files are what the profile builds", async () => {
  for (const patreon of [false, true]) {
    const file = path.join(root, "assets", "arsenal", `neon-arsenal-autorec${patreon ? "-patreon" : ""}.json`);
    const shipped = JSON.parse(readFileSync(file, "utf8"));
    const version = JSON.parse(readFileSync(path.join(root, "module.json"), "utf8")).version;
    const fresh = buildMenu({ patreon, sounds: true, version });
    assert.deepEqual(shipped, JSON.parse(JSON.stringify(fresh)), "run npm run build:aa");
  }
});

test("merging keeps the world's own entries and replaces ours", () => {
  const mine = { label: "Militech Crusher", menu: "range" };
  const old = { label: `${LABEL_PREFIX}Pistol`, menu: "range", metaData: { moduleVersion: "0.1" } };
  const fresh = entryFor(ROWS[0], { version: "2" });
  const out = mergeSection([mine, old], [fresh]);
  assert.deepEqual(out.map((e) => e.label), ["Militech Crusher", `${LABEL_PREFIX}Pistol`]);
  assert.equal(out[1].metaData.moduleVersion, "2");
  assert.ok(isOurs(old) && !isOurs(mine));
});

test("an attack's sounds: the shot or the burst, a ricochet, an impact on a hit", () => {
  const keys = profileKeys({ kind: "assaultRifle" });
  assert.deepEqual(soundPlan(keys).map((s) => s.key), ["rifle"]);
  assert.deepEqual(soundPlan(keys, { mode: "autofire", hit: true }).map((s) => s.key), ["rifleBurst", "impactBody"]);
  assert.deepEqual(soundPlan(profileKeys({ kind: "pistol", flavor: "power" }), { ricochet: true, hit: true }).map((s) => s.key), ["pistol", "ricochet", "impactBody"]);
  assert.deepEqual(soundPlan(profileKeys({ kind: "grenadeLauncher" }), { hit: true, explosive: true }).map((s) => s.key), ["launcher"]);
  assert.deepEqual(soundPlan(profileKeys({ kind: "assaultRifle", flavor: "tech" })).map((s) => s.key), ["tech"]);
});

/* ---------------------------------------- */
/*  Areas                                   */
/* ---------------------------------------- */

const GRID = { size: 100, distance: 2 };

test("an explosive's 10×10m square is centred on the square picked", () => {
  const t = templateData({ shape: "rect", size: 10 }, { center: { x: 550, y: 550 } }, GRID);
  assert.equal(t.t, "rect");
  assert.deepEqual([t.x, t.y, t.direction], [300, 300, 45]);
  assert.ok(Math.abs(t.distance - 10 * Math.SQRT2) < 1e-9);
  assert.deepEqual(centerOf(t, GRID), { x: 550, y: 550 });
  assert.ok(contains(t, { x: 350, y: 750 }, GRID));
  assert.ok(!contains(t, { x: 850, y: 550 }, GRID));
  // A 2×2 token half in the blast is caught.
  assert.ok(tokenInside(t, { x: 700, y: 700, width: 2, height: 2 }, GRID));
  assert.ok(!tokenInside(t, { x: 800, y: 800, width: 1, height: 1 }, GRID));
});

test("a Shotgun Shell's cone reaches 6m in front of the shooter, not behind", () => {
  const t = templateData({ shape: "cone", size: 6, angle: 90 }, { origin: { x: 0, y: 0 }, toward: { x: 100, y: 0 } }, GRID);
  assert.equal(t.direction, 0);
  assert.ok(contains(t, { x: 250, y: 50 }, GRID));
  assert.ok(contains(t, { x: 200, y: 180 }, GRID), "45° off the line is the edge");
  assert.ok(!contains(t, { x: 350, y: 0 }, GRID), "past 6m");
  assert.ok(!contains(t, { x: -150, y: 0 }, GRID), "behind");
});

test("blown back: straight away from the centre, 2m from a grenade and 4m from a rocket", () => {
  assert.equal(blowBackMetres("grenadeLauncher"), 2);
  assert.equal(blowBackMetres("rocketLauncher"), 4);
  assert.deepEqual(blownBack({ x: 600, y: 500, width: 1, height: 1 }, { x: 550, y: 550 }, 2, GRID), { x: 700, y: 500 });
  assert.deepEqual(blownBack({ x: 500, y: 500, width: 1, height: 1 }, { x: 550, y: 550 }, 4, GRID, 90), { x: 500, y: 700 }, "the centre square goes the GM's way");
});

test("a scattered miss lands on a random square in the area, never the aimed one", () => {
  const aim = { x: 550, y: 550 };
  const seen = new Set();
  for (let n = 0; n < 24; n++) {
    const p = scatter(aim, 10, GRID, () => n / 24);
    assert.ok(Math.abs(p.x - aim.x) <= 200 && Math.abs(p.y - aim.y) <= 200, "within the 5×5 squares");
    assert.ok(p.x !== aim.x || p.y !== aim.y, "not the aimed square");
    seen.add(`${p.x},${p.y}`);
  }
  assert.equal(seen.size, 24, "every other square can come up");
  assert.deepEqual(scatter(aim, 10, GRID, () => 0), { x: 350, y: 350, metres: 4 });
  assert.equal(scatter(aim, 10, GRID, () => 0.5).metres, 2);
});

test("a dodger leaves the area by the nearest open square, straight away from the centre", () => {
  const t = templateData({ shape: "rect", size: 10 }, { center: { x: 550, y: 550 } }, GRID);
  const out = escapeSquare(t, { x: 600, y: 400, width: 1, height: 1 }, GRID);
  assert.ok(!tokenInside(t, { x: out.x, y: out.y, width: 1, height: 1 }, GRID));
  assert.deepEqual(out, { x: 800, y: 200 }, "up and right, the way they were from the centre");
  assert.deepEqual(escapeSquare(t, { x: 300, y: 500, width: 1, height: 1 }, GRID), { x: 200, y: 500 }, "one square from the edge");
  // A wall to the west: the next closest way out.
  const walled = escapeSquare(t, { x: 300, y: 500, width: 1, height: 1 }, GRID, (a, b) => b.x < a.x && Math.abs(b.y - a.y) < 1);
  assert.ok(walled && !tokenInside(t, { ...walled, width: 1, height: 1 }, GRID) && !(walled.x < 300 && walled.y === 500));
  assert.equal(escapeSquare(t, { x: 500, y: 500, width: 1, height: 1 }, GRID, () => true), null, "walled in");
});

test("ammo effects follow the 2070 Item Compendium", () => {
  assert.deepEqual(ammoEffect({ ammoType: "incendiary" }), { onDamage: ["onFireMild"] });
  assert.deepEqual(ammoEffect({ ammoType: "teargas" }).save, { skill: "Resist Torture/Drugs", dv: 13 });
  assert.equal(ammoEffect({ ammoType: "emp" }).save.skill, "Cybertech");
  assert.equal(ammoEffect({ ammoType: "poison" }).direct, "2d6");
  assert.ok(ammoEffect({ ammoType: "smoke" }).persist);
  assert.deepEqual(ammoEffect({ ammoType: "basic", ammoName: "Arachnid Grenade" }).conditions, ["grappled"]);
  assert.ok(ammoEffect({ ammoType: "basic", ammoName: "CO2 Grenade" }).douse);
  // Neon Hub names grenades the system's way, loaded into a Thrown Weapon.
  assert.deepEqual(ammoEffect({ kind: "thrownGrenade", ammoType: "basic", ammoName: "Grenade (Arachnid)" }).conditions, ["grappled"]);
  assert.ok(ammoEffect({ kind: "thrownGrenade", ammoType: "basic", ammoName: "Grenade (CO2)" }).douse);
  assert.equal(ammoEffect({ kind: "thrownGrenade", ammoType: "basic", ammoName: "Grenade (Sonic)" }).save.dv, 17);
  assert.deepEqual(ammoEffect({ kind: "thrownGrenade", ammoType: "basic", ammoName: "Grenade (Shuriken Tornado)" }), {});
  assert.deepEqual(ammoEffect({ kind: "flamethrower" }).onDamage, ["onFireStrong"]);
  assert.deepEqual(ammoEffect({ ammoType: "basic" }), {});
});

/* ---------------------------------------- */
/*  DV tables                               */
/* ---------------------------------------- */

const TABLE = [{ range: [0, 6], text: "13" }, { range: [7, 12], text: "15" }, { range: [13, 25], description: "<p>20</p>" }];

test("a range table's DV at a distance", () => {
  assert.equal(dvFromResults(TABLE, 4), 13);
  assert.equal(dvFromResults(TABLE, 12.4), 15);
  assert.equal(dvFromResults(TABLE, 20), 20, "v13 keeps it in description");
  assert.equal(dvFromResults(TABLE, 60), null, "out of range");
});

test("the DV display lines: each weapon, its underbarrel, its Autofire; one per name or type", () => {
  const dvAt = (t) => ({ "DV Assault Rifle": 16, "DV Assault Rifle (Autofire)": 20, "DV Grenade Launcher": 15, "DV Pistol": 15 })[t] ?? null;
  const rows = [
    { name: "Unity", weaponType: "assaultRifle", table: "DV Assault Rifle", autofire: "DV Assault Rifle (Autofire)", upgrades: [{ name: "Underbarrel GL", weaponType: "grenadeLauncher", table: "DV Grenade Launcher" }] },
    { name: "Lexington", weaponType: "medPistol", table: "DV Pistol", autofire: "", upgrades: [] },
    { name: "Other AR", weaponType: "assaultRifle", table: "DV Assault Rifle", autofire: "", upgrades: [] }
  ];
  assert.deepEqual(dvLines(rows, dvAt).map((l) => `${l.label}=${l.dv}`), ["Unity=16", "Underbarrel GL=15", "Unity (Autofire)=20", "Lexington=15", "Other AR=16"]);
  assert.deepEqual(dvLines(rows, dvAt, { names: false }).map((l) => l.label), ["assaultRifle", "grenadeLauncher", "assaultRifle (Autofire)", "medPistol"]);
});

test("Diwako's DV display is handed our numbers when Diwako is active", async () => {
  game.modules.set("diwako-cpred-additions", { id: "diwako-cpred-additions", active: true });
  let calls = 0;
  class FakeToken {
    showDVDisplay() {
      calls++;
    }
  }
  globalThis.CONFIG.Token = { objectClass: FakeToken };
  assert.ok(Dv.installDisplay());
  assert.ok(!Dv.installDisplay(), "once");
  game.settings.register("diwako-cpred-additions", "showDVDisplay", { default: false });
  await new FakeToken().showDVDisplay();
  assert.equal(calls, 0, "Diwako's own setting still switches it off");
  game.modules.delete("diwako-cpred-additions");
  delete globalThis.CONFIG.Token;
});

/* ---------------------------------------- */
/*  Weapon traits                           */
/* ---------------------------------------- */

const MONO = { id: "monoEdge", label: "Mono-edge Blading", match: /^Mono-edge Blading\b/i, tiers: { Basic: { ignoreBelowSP: 7, tag: "Monoblade" }, Upgraded: { ignoreBelowSP: 11, tag: "Monoblade" }, Excellent: { ignoreBelowSP: 13, tag: "Monoblade" } } };
const MONOBLADE = { id: "monoblade", label: "Monoblade Rebuild", match: /^Monoblade Rebuild\b/i, tiers: { Basic: { ignoreBelowSP: 7 }, Tuned: { ignoreBelowSP: 11 }, Perfected: { ignoreBelowSP: 13 } } };
const PROPULSION = { id: "propulsion", label: "Propulsion Impact", match: /^Propulsion Impact\b/i, tiers: { Basic: { push: { metres: 2, maxBody: 13 }, tag: "Propulsion" }, Upgraded: { push: { metres: 4 }, tag: "Propulsion" } } };
const COMPENSATOR = { id: "ricochetCompensator", label: "Ricochet Compensator", match: "^Ricochet Compensator\\b", traits: { ricochetBonus: 1 } };

test("a tiered rebuild takes the tier in its name, else the one picked on the bench, else its first", () => {
  RebuildRegistry.register(MONO);
  const def = RebuildRegistry.all()[0];
  assert.equal(traitsFromDef(def, "Mono-edge Blading (Upgraded)").ignoreBelowSP, 11);
  assert.equal(traitsFromDef(MONOBLADE, "Monoblade Rebuild (Basic / Perfected / Tuned)", "Tuned").ignoreBelowSP, 11);
  assert.equal(traitsFromDef(MONOBLADE, "Monoblade Rebuild (Basic / Perfected / Tuned)").ignoreBelowSP, 7);
  assert.equal(traitsFromDef(def, "Katana"), null);
  assert.throws(() => RebuildRegistry.register({ id: "x" }));
});

test("traits merge a gun's flavor and its rebuilds", () => {
  const power = traitsOf("power", [{ name: "Ricochet Compensator" }], [RebuildRegistry.register(COMPENSATOR)]);
  assert.equal(power.critBonus, 5);
  assert.equal(power.ricochetBonus, 1);
  assert.deepEqual(power.active, ["ricochet"]);
  const blade = traitsOf(null, [{ name: "Mono-edge Blading (Excellent)" }, { name: "Propulsion Impact (Upgraded)" }], [RebuildRegistry.register(MONO), RebuildRegistry.register(PROPULSION)]);
  assert.equal(blade.ignoreBelowSP, 13);
  assert.deepEqual(blade.push, { metres: 4 });
  assert.deepEqual(blade.tags, ["Monoblade", "Propulsion"]);
  assert.deepEqual(traitsOf("tech").active, ["charge"]);
});

test("attack modifiers: Smart +1 with a link, a ricochet -4 (-3 compensated, none on an Aimed Shot)", () => {
  const smart = traitsOf("smart");
  assert.deepEqual(attackMods(smart, { linked: true }).map((m) => m.value), [1]);
  assert.deepEqual(attackMods(smart, { linked: false }), [], "no Neuroport, no +1");
  // Neon Hub's Smart guns have the +1 in their attack modifier: without a link it comes off.
  assert.deepEqual(attackMods(smart, { linked: true, baked: true }), []);
  assert.deepEqual(attackMods(smart, { linked: false, baked: true }).map((m) => m.value), [-1]);
  assert.ok(smartBaked(weapon("SMG (Smart)", {}, { "cpr-neon-hub": { weaponType2070: "smart" } })));
  assert.ok(smartBaked(weapon("Old gun"), [{ name: "Smart Rebuild", attack: 1 }]));
  assert.ok(!smartBaked(weapon("Old gun"), [{ name: "Smart Rebuild", attack: 0 }]));
  const power = traitsOf("power", [{ name: "Ricochet Compensator" }], [RebuildRegistry.register(COMPENSATOR)]);
  assert.deepEqual(attackMods(power, { ricochet: true }).map((m) => m.value), [-3]);
  assert.deepEqual(attackMods(traitsOf("power"), { ricochet: true }).map((m) => m.value), [-4]);
  assert.deepEqual(attackMods(power, { ricochet: true, aimed: true }), []);
});

test("damage: Power crits +5, Mono-edge ignores armor below its SP, a charged Tech shot halves SP", () => {
  assert.equal(damageArgs(traitsOf("power")).bonusDamage, 10);
  const mono = traitsOf(null, [{ name: "Mono-edge Blading (Basic)" }], [RebuildRegistry.register(MONO)]);
  assert.deepEqual(damageArgs(mono, { ignoreBelowSP: 0 }), { bonusDamage: 5, ignoreBelowSP: 7, ignoreArmorPercent: 0 });
  assert.equal(damageArgs(traitsOf("tech"), { charged: true }).ignoreArmorPercent, 50);
  assert.equal(damageArgs(traitsOf("tech"), { ignoreArmorPercent: 75, charged: true }).ignoreArmorPercent, 75, "never less than the weapon's own");
  assert.ok(chargeHolds(60, 30) && !chargeHolds(60, 60) && !chargeHolds(0, 0));
});

/* ---------------------------------------- */
/*  Before the dice                         */
/* ---------------------------------------- */

class CPRAttackRoll {
  constructor() {
    this.mods = [];
    this.rollCardExtraArgs = {};
    this.resultTotal = 17;
  }
  addMod(list) {
    this.mods.push(...list);
  }
}
class CPRDamageRoll {
  constructor() {
    this.bonusDamage = 5;
    this.rollCardExtraArgs = { ignoreBelowSP: 0, ignoreArmorPercent: 0 };
    this.resultTotal = 14;
  }
}

/** A character with a weapon whose items know their actor (as CPR's do). */
function armed(weaponData, extra = []) {
  const actor = makeActor({ name: "Fury" }, [{ _id: "w1", ...weaponData }, ...extra]);
  for (const i of actor.items) i.actor = actor;
  return { actor, item: actor.items.get("w1") };
}

test("roll kinds without the roller bridge", () => {
  assert.equal(rollKind(new CPRAttackRoll()), "attack");
  assert.equal(rollKind(new CPRDamageRoll()), "damage");
  assert.equal(rollKind({}), null);
  assert.ok(smartRetry(14, 17) && smartRetry(12, 17) && !smartRetry(11, 17) && !smartRetry(18, 17));
});

test("a Smart gun's attack gets +1 with a Neuroport; Neon Hub's, which has it built in, loses it without one", async () => {
  const { actor, item } = armed(weapon("Assault Rifle (Smart)", { weaponType: "assaultRifle" }), [{ name: "Neuroport", type: "cyberware", system: { isInstalled: true } }]);
  const roll = new CPRAttackRoll();
  await Arsenal.preRoll(item, roll);
  assert.deepEqual(roll.mods.map((m) => m.value), [1]);
  assert.equal(Arsenal.pending.tag.flavor, "smart");
  assert.equal(Arsenal.pending.tag.actorId, actor.id);
  const hub = armed(weapon("Assault Rifle (Smart)", { weaponType: "assaultRifle", attackmod: 1 }, { "cpr-neon-hub": { weaponType2070: "smart" } }));
  const r2 = new CPRAttackRoll();
  await Arsenal.preRoll(hub.item, r2);
  assert.deepEqual(r2.mods.map((m) => m.value), [-1], "no link: the built-in +1 comes off");
});

test("Neon Hub's control group with shells: Autofire is the shell attack, shell damage, dodged at -3", async () => {
  const group = { _id: "acg", name: "Shotgun Automatic Control Group", type: "itemUpgrade", system: {}, flags: { "cpr-neon-hub": { burstMod: { slugs: 4, shells: 4, shellDodge: -3 } } } };
  assert.deepEqual(shellAutofire([group], "shotgunShell"), { shells: 4, dodge: -3 });
  assert.equal(shellAutofire([group], "shotgunSlug"), null, "slugs: a real burst");
  assert.deepEqual(shellAutofire([{ name: "Shotgun Automatic Control Group", type: "itemUpgrade", flags: {} }], "shotgunShell"), { shells: 4, dodge: -3 }, "an older copy, by name");
  const shells = { _id: "sh", name: "Basic Shells", type: "ammo", system: { variety: "shotgunShell", type: "basic" } };
  const { actor, item } = armed(weapon("HomeSafe", { weaponType: "shotgun", fireModes: { autoFire: 3, suppressiveFire: false }, installedItems: { list: ["acg", "sh"] } }), [group, shells]);
  item.getWeaponDamage = () => "3d6";
  actor.flags["cyberpunk-red-core"] = { "firetype-w1": "autofire" };
  await Arsenal.preRoll(item, new CPRAttackRoll());
  assert.deepEqual(Arsenal.pending.tag.shell, { shells: 4, dodge: -3 });
  const dmg = Object.assign(new CPRDamageRoll(), { isAutofire: true, formula: "2d6" });
  await Arsenal.preRoll(item, dmg);
  assert.equal(dmg.isAutofire, false, "no Autofire multiplier");
  assert.equal(dmg.formula, "3d6", "the shells' damage");
  actor.flags["cyberpunk-red-core"] = { "firetype-w1": "single" };
  const single = Object.assign(new CPRDamageRoll(), { isAutofire: false, formula: "3d6" });
  await Arsenal.preRoll(item, single);
  assert.equal(Arsenal.pending.tag.shell, undefined, "a plain shell shot");
  const card = await Defense.prompt(actor, { name: "Rico" }, { attack: 17, attacker: "Fury", weapon: "HomeSafe", target: "Scene.s.Token.r", template: "t", penalty: -3, penaltyKey: "ShellDodge" });
  assert.match(String(card?.content ?? chat.at(-1).content), /shell attack: Evade takes -3/);
});

test("a ricochet is armed for one shot: -4, then off", async () => {
  const { actor, item } = armed(weapon("Heavy Pistol (Power)", { weaponType: "heavyPistol" }));
  assert.equal(await Rebuilds.toggleRicochet(actor, item), true);
  const roll = new CPRAttackRoll();
  await Arsenal.preRoll(item, roll);
  assert.deepEqual(roll.mods.map((m) => m.value), [-4]);
  assert.ok(Arsenal.pending.tag.ricochet);
  assert.equal(Rebuilds.state(actor, item).ricochet, false);
  const dmg = new CPRDamageRoll();
  await Arsenal.preRoll(item, dmg);
  assert.equal(dmg.bonusDamage, 10, "Power: a crit's Bonus Damage +5");
});

test("a Tech charge holds 20 Rounds, fires once and halves SP on that shot's damage", async () => {
  const { actor, item } = armed(weapon("Sniper Rifle (Tech)", { weaponType: "sniperRifle" }));
  game.time.worldTime = 100;
  assert.equal(await Rebuilds.toggleCharge(actor, item), true);
  assert.equal(Rebuilds.state(actor, item).chargedUntil, 160);
  assert.ok(Rebuilds.isCharged(actor, item));
  await Arsenal.preRoll(item, new CPRAttackRoll());
  assert.ok(Arsenal.pending.tag.charged);
  assert.ok(!Rebuilds.isCharged(actor, item), "spent");
  const dmg = new CPRDamageRoll();
  await Arsenal.preRoll(item, dmg);
  assert.equal(dmg.rollCardExtraArgs.ignoreArmorPercent, 50);
  const again = new CPRDamageRoll();
  await Arsenal.preRoll(item, again);
  assert.equal(again.rollCardExtraArgs.ignoreArmorPercent, 0, "only the charged shot");
  game.time.worldTime = 0;
});

test("a Melee Rebuild works on every swing: Mono-edge Blading on the damage card", async () => {
  RebuildRegistry.register(MONO);
  const { item } = armed({ name: "Katana", type: "weapon", system: { isRanged: false, weaponType: "heavyMelee", equipped: "equipped", installedItems: { list: ["u1"] } } },
    [{ _id: "u1", name: "Mono-edge Blading (Upgraded)", type: "itemUpgrade", system: {} }]);
  const dmg = new CPRDamageRoll();
  await Arsenal.preRoll(item, dmg);
  assert.equal(dmg.rollCardExtraArgs.ignoreBelowSP, 11);
  assert.deepEqual(Arsenal.pending.tag.tags, ["Monoblade"]);
});

test("the roll's card carries what Neon Arsenal saw (the roller's client only)", async () => {
  const { item } = armed(weapon("Assault Rifle", { weaponType: "assaultRifle" }));
  await Arsenal.preRoll(item, new CPRAttackRoll());
  const message = { content: '<div class="rollcard">…</div>', updateSource(u) {
    this.u = u;
  } };
  Arsenal.tag(message, "someone-else");
  assert.equal(message.u, undefined);
  Arsenal.tag(message, game.user.id);
  assert.equal(message.u[`flags.${M}.arsenal`].weapon, "assaultRifle");
  assert.equal(message.u[`flags.${M}.arsenal`].total, 17);
});

test("does it hit: beat the DV (a tie misses), Autofire's multiplier up to the gun's, REF 8+ can dodge", () => {
  assert.deepEqual(hitLines(17, [{ name: "A", dv: 15, ref: 6 }, { name: "B", dv: 17, ref: 8 }]), [
    { name: "A", dv: 15, hit: true, by: 2, dodge: false, mult: 0 },
    { name: "B", dv: 17, hit: false, by: 1, dodge: true, mult: 0 }
  ]);
  assert.equal(hitLines(26, [{ name: "A", dv: 20 }], { autofire: true, cap: 4 })[0].mult, 4);
  assert.equal(hitLines(22, [{ name: "A", dv: 20 }], { autofire: true, cap: 4 })[0].mult, 2);
  assert.deepEqual(hitLines(10, [{ name: "A", dv: null }]), [], "no table at that range");
});

test("before the dice, each target's DV at its range goes on the card", async () => {
  const table = [{ range: [0, 6], text: "13" }, { range: [7, 12], text: "15" }];
  game.tables = { getName: (n) => (n === "DV Pistol" ? { results: table } : null) };
  Dv.clear();
  const { actor, item } = armed(weapon("Pistol", { weaponType: "medPistol", dvTable: "DV Pistol" }));
  actor.getActiveTokens = () => [{ id: "t0", actor, center: { x: 0, y: 0 } }];
  const near = makeActor({ name: "Near", system: { stats: { ref: { value: 8 } } } });
  const far = makeActor({ name: "Far" });
  game.user.targets = new Set([{ name: "Near", actor: near, center: { x: 200, y: 0 } }, { name: "Far", actor: far, center: { x: 500, y: 0 } }]);
  await Arsenal.preRoll(item, new CPRAttackRoll());
  assert.deepEqual(Arsenal.pending.tag.hits, [{ name: "Near", dv: 13, ref: 8, dodge: true }, { name: "Far", dv: 15, ref: 7, dodge: false }]);
  assert.equal(Arsenal.pending.tag.dv, 13);
  delete game.tables;
  Dv.clear();
});

test("Diwako's own hit message is kept out of the chat while ours is on", async () => {
  const diwako = { content: '<div class="cpr-block" style="padding:10px;background-color:var(--cpr-text-chat-success, #2d9f36)"><b>A hits B</b></div>' };
  assert.equal(Arsenal.diwakoHit(diwako, game.user.id), true, "only with Diwako's module active");
  game.modules.set("diwako-cpred-additions", { id: "diwako-cpred-additions", active: true });
  assert.equal(Arsenal.diwakoHit(diwako, game.user.id), false);
  assert.equal(Arsenal.diwakoHit({ content: '<div class="rollcard">…</div>' }, game.user.id), true);
  await Settings.set("arsenalHideDiwakoHit", false);
  assert.equal(Arsenal.diwakoHit(diwako, game.user.id), true);
  await Settings.set("arsenalHideDiwakoHit", true);
  game.modules.delete("diwako-cpred-additions");
});

/* ---------------------------------------- */
/*  Automated Animations                    */
/* ---------------------------------------- */

test("AA gets our entry for what the weapon is, the ammo the CPR fork's way, and the fire mode", async () => {
  game.modules.set("autoanimations", { id: "autoanimations", active: true });
  await AA.install({ quiet: true });
  assert.ok(AA.installed().count >= ROWS.length);
  const { actor, item } = armed(weapon("Kang Tao G-58 Dian", { weaponType: "assaultRifle", installedItems: { list: ["a1"] } }, { "cpr-neon-hub": { weaponType2070: "tech" } }),
    [{ _id: "a1", ...ammo("EMP Rifle Rounds", "rifle", "emp") }]);
  assert.equal(loadedAmmo(item, actor).id, "a1");
  await actor.setFlag("cyberpunk-red-core", "firetype-w1", "autofire");
  const data = { item, token: { actor } };
  const animation = { label: "Assault Rifle (someone's)", menu: "range" };
  AA.onWorkflowStart(data, animation);
  assert.equal(animation.label, `${LABEL_PREFIX}Assault Rifle · EMP`, "the ammo's look beats the flavor's");
  assert.equal(data.ammoItem.id, "a1", "Diwako's flash reads it");
  assert.equal(data.overrideRepeat, 5);
  // With nothing matched by AA, it looks ours up by name.
  const data2 = { item, token: { actor } };
  AA.onWorkflowStart(data2, false);
  assert.deepEqual(data2.overrideNames, [`${LABEL_PREFIX}Assault Rifle · EMP`]);
  assert.ok(data2.recheckAnimation);
});

test("the GM is offered the animations when they're missing or old, and can say no for good", async () => {
  game.modules.set("autoanimations", { id: "autoanimations", active: true });
  await AA.uninstall();
  const asked = [];
  let answer = "install";
  foundry.applications.api.DialogV2.wait = async (opts) => {
    asked.push(opts.content);
    return answer;
  };
  assert.equal(await AA.offer(), "install");
  assert.match(asked[0], /aren't in Automated Animations yet/);
  assert.ok(AA.current(), "installed for this version");
  assert.equal(await AA.offer(), null, "nothing to ask once it's current");
  assert.equal(asked.length, 1);
  // An older version's entries: the offer says so.
  for (const m of ["melee", "range"]) {
    const aged = game.settings.get("autoanimations", `aaAutorec-${m}`).map((e) => ({ ...e, metaData: { ...e.metaData, moduleVersion: "1.0.0" } }));
    await game.settings.set("autoanimations", `aaAutorec-${m}`, aged);
  }
  answer = "later";
  assert.equal(await AA.offer(), "later");
  assert.match(asked[1], /older version/);
  assert.ok(!AA.current());
  answer = "never";
  await AA.offer();
  assert.equal(Settings.get("arsenalAutoInstall"), false, "don't ask again");
  assert.equal(AA.ready(0), null, "and it doesn't");
  await Settings.set("arsenalAutoInstall", true);
  await AA.install({ quiet: true });
  foundry.applications.api.DialogV2.wait = async () => null;
});

test("every entry has a UUIDv4 id, and a menu AA gutted is put back", async () => {
  game.modules.set("autoanimations", { id: "autoanimations", active: true });
  for (const patreon of [false, true]) {
    const all = Object.values(buildMenu({ patreon })).filter(Array.isArray).flat();
    assert.ok(all.every((e) => isUuidv4(e.id)), "the exported JSON's ids");
    assert.equal(new Set(all.map((e) => e.id)).size, all.length);
  }
  assert.ok(isUuidv4(uuidv4()) && uuidv4() !== uuidv4());
  await AA.install({ quiet: true });
  const ids = Object.values(AA.menus()).flat().filter(isOurs).map((e) => e.id);
  assert.equal(ids.length, ROWS.length);
  assert.ok(ids.every(isUuidv4), "installed ids AA's store keeps");
  // An older install (16-character ids): AA's store threw on the first, kept only its own range
  // entries and saved them back. The melee entries are still there, with the old ids.
  const theirs = { id: uuidv4(), label: "Militech Crusher", menu: "range" };
  const melee = game.settings.get("autoanimations", "aaAutorec-melee").map((e) => (isOurs(e) ? { ...e, id: "aB3dE5gH7jK9mN1p" } : e));
  await game.settings.set("autoanimations", "aaAutorec-melee", melee);
  await game.settings.set("autoanimations", "aaAutorec-range", [theirs]);
  assert.ok(!AA.current(), "half a profile isn't current, whatever its version");
  const asked = [];
  const reloads = [];
  const emits = [];
  const realReload = AA.reload;
  const realEmit = game.socket.emit;
  AA.reload = () => reloads.push("me");
  game.socket.emit = (name, msg) => emits.push(msg);
  foundry.applications.api.DialogV2.wait = async (opts) => {
    asked.push(opts.content);
    return asked.length === 1 ? "install" : "all";
  };
  assert.equal(await AA.offer(), "install");
  assert.match(asked[0], /dropped out/);
  assert.ok(AA.current());
  // AA stopped loading on every client that read the old ids: the GM reloads everyone.
  assert.match(asked[1], /won't show until each one reloads/);
  assert.deepEqual(reloads, ["me"]);
  assert.deepEqual(emits.map((m) => [m.type, m.action]), [["event", "arsenalReload"]]);
  // A player is asked, and only when a GM sent it.
  foundry.applications.api.DialogV2.wait = async (opts) => {
    asked.push(opts.content);
    return "reload";
  };
  assert.equal(await AA.reloadAsked(testUsers.player.id), null, "not from a player");
  assert.equal(await AA.reloadAsked(testUsers.gm.id), "reload");
  assert.match(asked.at(-1), /The GM has repaired/);
  assert.deepEqual(reloads, ["me", "me"]);
  // A repair of entries that were already fine asks nothing more.
  asked.length = 0;
  await AA.install();
  assert.equal(asked.length, 0);
  AA.reload = realReload;
  game.socket.emit = realEmit;
  const range = game.settings.get("autoanimations", "aaAutorec-range");
  assert.equal(range[0].label, "Militech Crusher", "the world's own entries stay");
  assert.ok(Object.values(AA.menus()).flat().filter(isOurs).every((e) => isUuidv4(e.id)));
  foundry.applications.api.DialogV2.wait = async () => null;
});

test("arrows throw no muzzle flash; AA's misses follow the 2070 tables", async () => {
  game.modules.set("autoanimations", { id: "autoanimations", active: true });
  await AA.install({ quiet: true });
  const arrow = ammo("Basic Arrows", "arrow");
  const { actor, item } = armed(weapon("Bow (Smart)", { weaponType: "bow", installedItems: { list: ["a2"] } }), [{ _id: "a2", ...arrow }]);
  const data = { item, token: { actor }, ammoItem: actor.items.get("a2") };
  AA.onWorkflowStart(data, {});
  assert.equal(data.ammoItem, null);
  await game.settings.set("autoanimations", "canMissTarget", true);
  const miss = { item, token: { actor }, workflow: { flags: { [M]: { arsenal: { total: 12, dv: 15 } } } } };
  AA.onWorkflowStart(miss, {});
  assert.equal(miss.forceMiss, true);
  const hit = { item, token: { actor }, workflow: { flags: { [M]: { arsenal: { total: 16, dv: 15 } } } } };
  AA.onWorkflowStart(hit, {});
  assert.equal(hit.forceMiss, false);
  await game.settings.set("autoanimations", "canMissTarget", false);
});

test("a player's shot goes to the GM, where Diwako's own handler makes the flash", async () => {
  for (const id of ["diwako-cpred-additions", "df-active-lights", "autoanimations"]) game.modules.set(id, { id, active: true });
  game.settings.register("diwako-cpred-additions", "dfAmbientLights-enable", { default: true });
  await AA.install({ quiet: true });
  const { actor, item } = armed(weapon("Pistol", { weaponType: "medPistol", installedItems: { list: ["a3"] } }), [{ _id: "a3", ...ammo("Basic Pistol", "medPistol") }]);
  const registry = (await import("./helpers/foundry.mjs")).registry;
  item.uuid = "Actor.x.Item.w1";
  actor.items.get("a3").uuid = "Actor.x.Item.a3";
  registry.set(item.uuid, item);
  registry.set("Actor.x.Item.a3", actor.items.get("a3"));
  const tokenDoc = { uuid: "Scene.s.Token.t1", parent: null, x: 0, y: 0, actor };
  registry.set(tokenDoc.uuid, tokenDoc);
  asGM(false);
  AA.onWorkflowStart({ item, token: { actor, document: tokenDoc } }, { primary: { options: { delay: 0, repeat: 1, repeatDelay: 200 } } });
  const sent = emitted.find((m) => m.action === "arsenalFlash");
  assert.ok(sent, "sent to the GM");
  asGM(true);
  let relayed = null;
  const id = Hooks.on("AutomatedAnimations-WorkflowStart", (data) => {
    if (data[`${M}Relay`]) relayed = data;
  });
  await AA.flashAsGM(sent.data);
  Hooks.off("AutomatedAnimations-WorkflowStart", id);
  assert.equal(relayed?.item, item);
  assert.equal(relayed?.ammoItem?.id, "a3");
  for (const m of ["diwako-cpred-additions", "df-active-lights"]) game.modules.delete(m);
});

/* ---------------------------------------- */
/*  Applying an area                        */
/* ---------------------------------------- */

test("the damage card's numbers are read off CPR's Apply Damage button", () => {
  const html = `<div class="rollcard"><a data-action="applyDamage" data-scope="global" data-total-damage="21" data-bonus-damage="0" data-damage-location="body" data-damage-lethal="true" data-ablation="2" data-ammo-variety="grenade" data-ignore-armor-percent="0" data-ignore-below-sp="0"></a></div>`;
  assert.deepEqual(damageFromHtml(html), { total: 21, bonus: 0, location: "body", ablation: 2, ammoVariety: "grenade", ignoreArmorPercent: 0, ignoreBelowSP: 0, lethal: true });
  assert.equal(damageFromHtml("<p>no button</p>"), null);
});

/** A scene's embedded collection: iterates its documents, as Foundry's does. */
class Docs extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}

/** A scene with tokens (documents only) and a blast template on it. */
async function sceneWith(tokens, blast) {
  const toks = new Docs(tokens.map((t) => [t.id, { width: 1, height: 1, hidden: false, ...t, async update(u) {
    Object.assign(this, u);
  } }]));
  const scene = { id: "s1", grid: { size: 100, distance: 2 }, tokens: toks, templates: new Docs() };
  game.scenes.set(scene.id, scene);
  const t = templateData(blast.area, { center: { x: 550, y: 550 } }, GRID);
  const doc = { ...t, uuid: "Scene.s1.MeasuredTemplate.m1", parent: scene, flags: { [M]: { blast } }, deleted: false,
    async update(u) {
      for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v);
    },
    async delete() {
      this.deleted = true;
    } };
  (await import("./helpers/foundry.mjs")).registry.set(doc.uuid, doc);
  return { scene, doc };
}

test("everyone in the area takes one damage roll through CPR's own damage application", async () => {
  const hit = [];
  const mk = (name) => {
    const a = makeActor({ name });
    a._applyDamage = async (total, bonus, location, ablation, variety) => {
      hit.push({ name, total, location, ablation, variety });
      await a.update({ "system.derivedStats.hp.value": a.system.derivedStats.hp.value - Math.max(0, total - 11) });
    };
    return a;
  };
  const a = mk("Ganger A");
  const b = mk("Ganger B");
  const c = mk("Bystander");
  const { scene, doc } = await sceneWith([{ id: "ta", name: "A", x: 500, y: 500, actor: a }, { id: "tb", name: "B", x: 400, y: 300, actor: b }, { id: "tc", name: "C", x: 1500, y: 1500, actor: c }],
    { actorId: "x", itemId: "y", tokenId: "tz", kind: "grenadeLauncher", area: { shape: "rect", size: 10 }, ammoType: "incendiary", ammoVariety: "grenade", ammoName: "Incendiary Grenade", explosive: true, at: Date.now(), state: "landed" });
  assert.deepEqual(tokensIn(doc, scene).map((t) => t.id), ["ta", "tb"]);
  const before = chat.length;
  const n = await Blast.applyAsGM({ template: doc.uuid, damage: { total: 21, bonus: 0, ablation: 1, ammoVariety: "grenade", ignoreArmorPercent: 0, ignoreBelowSP: 0, lethal: true }, tokens: ["ta", "tb"], blow: true });
  await settle();
  assert.equal(n, 2);
  assert.deepEqual(hit.map((h) => [h.name, h.total, h.location, h.ablation]), [["Ganger A", 21, "body", 1], ["Ganger B", 21, "body", 1]]);
  assert.ok(Conditions.has("onFireMild", a), "Incendiary: damage through armor sets them On Fire");
  assert.deepEqual([scene.tokens.get("tb").x, scene.tokens.get("tb").y], [400, 200], "blown back 2m (one square), straight away from the centre");
  assert.ok(doc.deleted);
  assert.equal(doc.flags[M].blast.state, "resolved");
  assert.ok(chat.length > before);
  assert.equal(await Blast.applyAsGM({ template: doc.uuid, tokens: ["ta"] }), null, "once");
});

test("gas asks each target for a save instead of dealing damage", async () => {
  const a = makeActor({ name: "Target", owners: [testUsers.player.id] });
  a._applyDamage = async () => assert.fail("teargas deals no damage");
  const { doc } = await sceneWith([{ id: "ta", name: "Target", x: 500, y: 500, actor: a }],
    { actorId: "x", itemId: "y", tokenId: "tz", kind: "grenadeLauncher", area: { shape: "rect", size: 10 }, ammoType: "teargas", ammoVariety: "grenade", ammoName: "Teargas Ammunition", explosive: true, at: Date.now(), state: "landed" });
  const before = chat.length;
  await Blast.applyAsGM({ template: doc.uuid, damage: null, tokens: ["ta"] });
  const card = chat.slice(before).find((m) => m.content.includes("arsenal-save"));
  assert.ok(card, "a save card for the target's player");
  assert.match(card.content, /data-dv="13"/);
  assert.match(card.content, /data-adds="teargassed"/);
});

test("the GM's Scatter moves a missed blast to a random square around the aimed one", async () => {
  const { doc } = await sceneWith([], { actorId: "x", itemId: "y", tokenId: "tz", kind: "grenadeLauncher", area: { shape: "rect", size: 10 }, ammoType: "basic", ammoVariety: "grenade", ammoName: "Grenade", explosive: true, at: Date.now(), state: "miss", aim: { x: 550, y: 550 } });
  const before = chat.length;
  const to = await Blast.scatter(doc.uuid, () => 0.99);
  assert.deepEqual([to.x, to.y], [750, 750]);
  assert.deepEqual(centerOf(doc, GRID), { x: 750, y: 750 }, "the template went with it");
  assert.ok(chat.slice(before).some((m) => /scatters 4 m/.test(m.content)));
  doc.flags[M].blast.state = "landed";
  assert.equal(await Blast.scatter(doc.uuid), null, "only a miss scatters");
});

/* ---------------------------------------- */
/*  Defense: Evade or Tank                  */
/* ---------------------------------------- */

const chrome = (name, description, effects = []) => ({ name, installed: true, description, effects });

test("who can dodge bullets: REF 8+, or chrome that says so (a Sandevistan OS only while it runs)", () => {
  assert.deepEqual(dodgeAbility({ ref: 8 }), { can: true, why: "ref", blocked: null });
  assert.equal(dodgeAbility({ ref: 6 }).can, false);
  assert.equal(dodgeAbility({ ref: 5, items: [chrome("Reflex Co-Processor", "Neuralware option: dodge bullets regardless of REF.")] }).why, "Reflex Co-Processor");
  assert.equal(dodgeAbility({ ref: 5, items: [chrome("Kerenzikov", "You can dodge ranged attacks whatever your REF, and get +2")] }).why, "Kerenzikov");
  const falcon = (disabled) => chrome("Militech ‘Falcon’ OS", "+4 Initiative for 3 Rounds, and you can dodge bullets whatever your REF.", [{ name: "Militech ‘Falcon’ OS (active)", disabled }]);
  assert.equal(dodgeAbility({ ref: 5, items: [falcon(true)] }).can, false, "switched off");
  assert.equal(dodgeAbility({ ref: 5, items: [falcon(false)] }).why, "Militech ‘Falcon’ OS");
  assert.equal(dodgeAbility({ ref: 5, items: [{ ...chrome("Reflex Co-Processor", "dodge bullets regardless of REF"), installed: false }] }).can, false, "not installed");
  assert.deepEqual(dodgeAbility({ ref: 9, ricochet: true }), { can: false, why: "ref", blocked: "ricochet" });
  assert.equal(dodgeAbility({ ref: 9, attackerHidden: true }).blocked, "hidden");
  assert.equal(dodgeAbility({ ref: 9, blind: true }).blocked, "blind");
});

test("an Evasion roll against the attack: the attacker must beat it", () => {
  assert.equal(defenseOutcome(16, 17), "dodged");
  assert.equal(defenseOutcome(16, 16), "dodged");
  assert.equal(defenseOutcome(16, 16, { tiesToDefender: false }), "hit");
  assert.equal(defenseOutcome(16, 12), "hit");
});

test("after a ranged attack, a target who can dodge gets Evade or Tank; one who can't gets nothing", async () => {
  const attacker = makeActor({ name: "Fury" }, [{ _id: "g1", ...weapon("Pistol", { weaponType: "medPistol" }) }]);
  const quick = makeActor({ name: "Quick", owners: [testUsers.player.id] }, [{ name: "Reflex Co-Processor", type: "cyberware", system: { isInstalled: true, description: { value: "dodge bullets regardless of REF" } } }]);
  quick.system.stats.ref.value = 5;
  const slow = makeActor({ name: "Slow" });
  slow.system.stats.ref.value = 5;
  const toks = new Docs([["q", { id: "q", name: "Quick", uuid: "Scene.s.Token.q", actor: quick }], ["s", { id: "s", name: "Slow", uuid: "Scene.s.Token.s", actor: slow }]]);
  globalThis.canvas = { scene: { tokens: toks } };
  const before = chat.length;
  await Defense.afterAttack({ kind: "attack", actorId: attacker.id, itemId: "g1", ranged: true, mode: "single", total: 17, dv: 15, targets: ["q", "s"], hits: [{ name: "Quick", dv: 15 }, { name: "Slow", dv: 15 }] }, { id: "m1" });
  const cards = chat.slice(before);
  assert.equal(cards.length, 1, "only the one who can dodge");
  assert.match(cards[0].content, /arsenal-evade/);
  assert.match(cards[0].content, /arsenal-tank/);
  assert.match(cards[0].content, /Reflex Co-Processor lets you dodge bullets/);
  assert.deepEqual(cards[0].whisper.sort(), ["gm1", "pl1"]);
  // A ricochet: no choice.
  const n = chat.length;
  await Defense.afterAttack({ kind: "attack", actorId: attacker.id, itemId: "g1", ranged: true, mode: "single", total: 17, targets: ["q"], ricochet: true }, { id: "m2" });
  assert.equal(chat.length, n);
  globalThis.canvas = null;
});

test("Evade, Tank and a melee defense resolve against the attack", async () => {
  const target = makeActor({ name: "Rico" });
  const tok = { id: "r", name: "Rico", uuid: "Scene.s.Token.r", actor: target };
  (await import("./helpers/foundry.mjs")).registry.set(tok.uuid, tok);
  assert.equal(await Defense.resolve(null, { target: tok.uuid, attack: 16, evasion: 18 }), "dodged");
  assert.equal(await Defense.resolve(null, { target: tok.uuid, attack: 16, evasion: 11 }), "hit");
  assert.equal(await Defense.resolve(null, { target: tok.uuid, attack: 16, dv: 15, tank: true }), "hit");
  assert.equal(await Defense.resolve(null, { target: tok.uuid, attack: 14, dv: 15, tank: true }), "missed");
  const real = CPR.skillCheck;
  CPR.skillCheck = async (actor, skill, opts) => {
    assert.equal(skill, "Evasion");
    assert.ok(opts.event.ctrlKey, "no dialog when rolled for them");
    return { total: 20 };
  };
  assert.equal(await Defense.defendAsGM({ target: tok.uuid, attack: 15, melee: true }), "dodged");
  CPR.skillCheck = real;
});

test("whoever dodges out of an area leaves it: moved out, and not in the GM's apply window", async () => {
  const quick = makeActor({ name: "Quick" });
  const { doc } = await sceneWith([{ id: "q", name: "Quick", x: 500, y: 500, actor: quick, uuid: "Scene.s1.Token.q" }],
    { actorId: "x", itemId: "y", tokenId: "tz", kind: "grenadeLauncher", area: { shape: "rect", size: 10 }, ammoType: "basic", ammoVariety: "grenade", ammoName: "Grenade", explosive: true, at: Date.now(), state: "landed", total: 16 });
  (await import("./helpers/foundry.mjs")).registry.set("Scene.s1.Token.q", doc.parent.tokens.get("q"));
  assert.equal(await Defense.resolve(null, { target: "Scene.s1.Token.q", attack: 16, evasion: 16, template: doc.uuid }), "dodged", "a tie goes to the dodger");
  assert.deepEqual(doc.flags[M].blast.dodged, ["q"]);
  const q = doc.parent.tokens.get("q");
  assert.ok(!tokenInside(doc, q, GRID), "and their token is out of the blast");
  let content = "";
  foundry.applications.api.DialogV2.prompt = async (opts) => {
    content = opts.content;
    return null;
  };
  await Blast.askAndApply(doc.uuid, { total: 20, bonus: 0, ablation: 1, ammoVariety: "grenade", ignoreArmorPercent: 0, ignoreBelowSP: 0, lethal: true });
  assert.doesNotMatch(content, /name="t-q"/, "out of the area, so not in the apply window");
});

test("a shell's spread is one attack against DV13", () => {
  assert.equal(SHELL_DV, 13);
});

/* ---------------------------------------- */
/*  The Action HUD                          */
/* ---------------------------------------- */

test("the HUD shows a Power gun's Ricochet and a Tech gun's Charge", async () => {
  const actor = makeActor({ name: "Lattice" }, [
    { _id: "p1", ...weapon("Heavy Pistol (Power)", { weaponType: "heavyPistol", magazine: { value: 8, max: 8 } }) },
    { _id: "t1", ...weapon("SMG (Tech)", { weaponType: "smg", magazine: { value: 30, max: 30 } }) },
    { _id: "k1", name: "Katana", type: "weapon", system: { isRanged: false, weaponType: "heavyMelee", equipped: "equipped" } }
  ]);
  const w = catalog(actor).weapons;
  const keys = (name) => w.find((e) => e.label === name).buttons.map((b) => b.key.split(":")[0]);
  assert.ok(keys("Heavy Pistol (Power)").includes("rico"));
  assert.ok(keys("SMG (Tech)").includes("chg"));
  assert.ok(!keys("Katana").includes("rico") && !keys("Katana").includes("chg"));
  await Settings.set("arsenalRebuilds", false);
  assert.ok(!catalog(actor).weapons[0].buttons.some((b) => b.key.startsWith("rico")));
  await Settings.set("arsenalRebuilds", true);
});

test("Neon Arsenal's text is all in the language file", () => {
  assert.deepEqual([...missingKeys].filter((k) => k.includes("Arsenal")), []);
});
