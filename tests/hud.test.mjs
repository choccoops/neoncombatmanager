/** The Action HUD: layouts, the catalog of a character's actions, running them, and the templates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, makeCombat, registerSettings, asGM, testUsers, missingKeys, notes, chat } from "./helpers/foundry.mjs";

await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const Lay = await import("../scripts/hud/layout.js");
const { catalog } = await import("../scripts/hud/catalog.js");
const { Run } = await import("../scripts/hud/run.js");
const { Hud } = await import("../scripts/hud/hud.js");
const { Compat } = await import("../scripts/compat.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Registry.refresh();

const { player } = testUsers;

/** A solo with a Militech Crusher (shotgun, no autofire), an SMG (autofire), a knife, skills and a role. */
function solo() {
  return makeActor({ name: "Velvet", owners: [player.id] }, [
    { _id: "smg", name: "Militech Viper", type: "weapon", system: { equipped: "equipped", isRanged: true, magazine: { value: 0, max: 30 }, fireModes: { autoFire: 3, suppressiveFire: true }, damage: "2d6" } },
    { _id: "knife", name: "Combat Knife", type: "weapon", system: { equipped: "equipped", isRanged: false, damage: "1d6" } },
    { _id: "stash", name: "Spare Pistol", type: "weapon", system: { equipped: "carried", isRanged: true } },
    { _id: "eva", name: "Evasion", type: "skill", system: { stat: "dex", level: 6 } },
    { _id: "per", name: "Perception", type: "skill", system: { stat: "int", level: 4 } },
    { _id: "mel", name: "Melee Weapon", type: "skill", system: { stat: "dex", level: 5 } },
    { _id: "solo", name: "Solo", type: "role", system: { hasRoll: true, mainRoleAbility: "Combat Awareness", abilities: [{ name: "Threat Detection", hasRoll: true }, { name: "Damage Deflection", hasRoll: false }] } },
    { _id: "blue", name: "Blue Glass", type: "drug", system: { amount: 2 } }
  ]);
}

/* ---------------------------------------- */
/*  Layouts                                 */
/* ---------------------------------------- */

test("the template is the combat basics; a layout shows its visible groups, picks in order, empty groups left out", () => {
  const t = Lay.template();
  assert.deepEqual(t.groups.filter((g) => !g.hidden).map((g) => g.id), ["turn", "weapons", "skills", "role", "net", "chrome", "status", "utility", "macros"]);
  // A layout saved before the Chrome group existed gets it shown; other groups it predates stay hidden.
  const old = Lay.normalize({ v: 1, groups: [{ id: "turn", source: "turn", picks: null }] });
  assert.equal(old.groups.find((g) => g.id === "chrome").hidden, false);
  assert.equal(old.groups.find((g) => g.id === "net").hidden, true);
  const cat = {
    turn: [{ key: "turn:initiative" }],
    weapons: [{ key: "weapon:a" }, { key: "weapon:b" }],
    skills: [{ key: "skill:perception" }, { key: "skill:evasion" }, { key: "skill:stealth" }],
    stats: [{ key: "stat:ref" }]
  };
  const shown = Lay.resolve(t, cat);
  assert.deepEqual(shown.map((g) => g.id), ["turn", "weapons", "skills"], "no role, net, status or utility to show; STATs hidden");
  assert.deepEqual(shown[2].entries.map((e) => e.key), ["skill:evasion", "skill:perception", "skill:stealth"], "the template's order, missing skills skipped");
  // A group of your own mixes sources.
  let l = Lay.addGroup(t, "Go-to", "mine");
  l = Lay.addPick(l, "mine", "stat:ref");
  l = Lay.addPick(l, "mine", "weapon:b");
  assert.deepEqual(Lay.resolve(l, cat).at(-1), { id: "mine", source: null, name: "Go-to", icon: "fa-solid fa-star", entries: [{ key: "stat:ref" }, { key: "weapon:b" }] });
});

test("editing a layout: reorder groups and actions, choose instead of Auto, hide built-ins, remove your own", () => {
  let l = Lay.template();
  l = Lay.moveGroup(l, "skills", -1);
  assert.deepEqual(l.groups.slice(0, 3).map((g) => g.id), ["turn", "skills", "weapons"]);
  l = Lay.setAuto(l, "weapons", false, ["weapon:a", "weapon:b"]);
  assert.deepEqual(l.groups.find((g) => g.id === "weapons").picks, ["weapon:a", "weapon:b"], "starts from what it shows");
  l = Lay.movePick(l, "weapons", "weapon:b", -1);
  l = Lay.addPick(l, "weapons", "weapon:a");
  assert.deepEqual(l.groups.find((g) => g.id === "weapons").picks, ["weapon:b", "weapon:a"], "adding again moves it to the end");
  l = Lay.removePick(l, "skills", "skill:stealth");
  assert.ok(!l.groups.find((g) => g.id === "skills").picks.includes("skill:stealth"));
  l = Lay.setGroup(l, "turn", { name: "My Turn" });
  l = Lay.removeGroup(l, "turn");
  assert.equal(l.groups.find((g) => g.id === "turn").hidden, true, "a built-in group hides");
  l = Lay.addGroup(l, "X", "x1");
  l = Lay.removeGroup(l, "x1");
  assert.equal(l.groups.some((g) => g.id === "x1"), false);
  // Junk and older layouts come out usable.
  const fixed = Lay.normalize({ groups: [{ id: "skills", source: "skills", picks: ["skill:a", "skill:a"] }, { id: "bad", source: "spells" }, null] });
  assert.deepEqual(fixed.groups[0].picks, ["skill:a"]);
  assert.equal(fixed.groups.some((g) => g.id === "bad"), false);
  assert.equal(fixed.groups.find((g) => g.id === "weapons").hidden, true, "built-in groups it lacks come back hidden");
});

/* ---------------------------------------- */
/*  The catalog                             */
/* ---------------------------------------- */

test("a character's actions: equipped weapons with their fire modes, skills with their base, roles, conditions, STATs, drugs", async () => {
  const vee = solo();
  await vee.setFlag("cyberpunk-red-core", "firetype-smg", "autofire");
  await Conditions.add("prone", vee);
  const c = catalog(vee);
  assert.deepEqual(c.weapons.map((w) => w.key), ["weapon:militechviper", "weapon:combatknife", "hands:bare", "hands:equip"], "equipped only, then Bare Hands and Equip / Change Weapon");
  const smg = c.weapons[0];
  assert.deepEqual(smg.buttons.map((b) => b.key), ["atk:smg", "aim:smg", "auto:smg", "supp:smg", "dmg:smg", "rld:smg", "ammo:smg"]);
  assert.equal(smg.buttons.find((b) => b.on).key, "auto:smg", "the weapon's fire mode shows");
  assert.equal(smg.sub, "0/30");
  assert.equal(smg.alert, true, "empty magazine");
  assert.deepEqual(c.weapons[1].buttons.map((b) => b.key), ["atk:knife", "aim:knife", "dmg:knife"], "melee: no reload");
  assert.deepEqual(c.skills.map((s) => [s.key, s.run, s.sub]), [["skill:evasion", "sk:eva", "+12"], ["skill:meleeweapon", "sk:mel", "+11"], ["skill:perception", "sk:per", "+9"]]);
  assert.deepEqual(c.role.map((r) => r.run), ["ra:solo:main:Combat Awareness", "ra:solo:sub:Threat Detection"]);
  assert.equal(c.net.length, 0, "no cyberdeck, no Netrunning");
  assert.equal(c.status.find((s) => s.key === "cond:prone").on, true);
  assert.ok(!c.status.some((s) => /tarot|stakes|lightlyWounded/.test(s.key)));
  assert.equal(c.stats.find((s) => s.key === "stat:ref").sub, "7");
  assert.deepEqual(c.gear.map((g) => [g.key, g.sub]), [["drug:blueglass", "×2"]]);
  assert.deepEqual(c.turn.map((t) => t.key), ["turn:initiative", "turn:run", "turn:endTurn", "turn:deathSave", "turn:facedown"]);
  assert.equal(c.turn[0].off, true, "no encounter");
});

test("in a fight: Initiative shows, End Turn lights up on your turn, Death Save when Mortally Wounded", async () => {
  const vee = solo();
  const combat = makeCombat([vee]);
  combat.combatants.contents[0].initiative = 17;
  game.combat = combat;
  await vee.update({ "system.derivedStats.hp.value": 0, "system.derivedStats.deathSave.penalty": 2 });
  const t = catalog(vee).turn;
  assert.equal(t[0].sub, "17");
  assert.equal(t[2].alert, true);
  assert.deepEqual([t[3].alert, t[3].sub], [true, "+2"]);
  assert.deepEqual([t[1].key, t[1].on, t[1].off], ["turn:run", false, false], "a Run to take, on their Turn");
  game.combat = null;
});

test("in a stealth segment, the Stealth roll joins the Turn group", async () => {
  const { EncounterMode } = await import("../scripts/combat/mode.js");
  const vee = makeActor({ name: "Vee" }, [{ _id: "sth", name: "Stealth", type: "skill", system: { stat: "dex", level: 6 } }]);
  const combat = makeCombat([vee]);
  game.combat = combat;
  assert.ok(!catalog(vee).turn.some((t) => t.key === "turn:stealth"), "not in full combat");
  await combat.setFlag("cpr-neon-combat-manager", "mode", "stealth");
  assert.equal(EncounterMode.isStealth(combat), true);
  const t = catalog(vee).turn;
  const s = t.find((x) => x.key === "turn:stealth");
  assert.deepEqual([s.run, s.alert, t.indexOf(s)], ["sk:sth", true, 3]);
  game.combat = null;
});

/* ---------------------------------------- */
/*  Running actions                         */
/* ---------------------------------------- */

/** A CPR roll stand-in that records what happened to it. */
function fakeRoll(log, name) {
  return {
    name,
    luck: 0,
    async handleRollDialog(ev) {
      log.push(["dialog", name, !!ev?.ctrlKey]);
      return true;
    },
    async roll() {
      log.push(["roll", name]);
    }
  };
}

test("weapon buttons roll through CPR's own rolls; the fire mode sticks for Damage; Reload uses the sheet's", async () => {
  const vee = solo();
  const smg = vee.items.get("smg");
  const log = [];
  smg.createRoll = (type, actor, extra) => (log.push(["create", type, extra?.damageType ?? null]), fakeRoll(log, type));
  smg.confirmRoll = async (r) => (log.push(["confirm", r.name]), r);
  smg.doAction = async (actor, attrs) => log.push(["action", attrs["data-action"].nodeValue]);
  await Run.action(vee, "auto:smg", { event: { type: "click", ctrlKey: true } });
  assert.equal(vee.flags["cyberpunk-red-core"]["firetype-smg"], "autofire");
  assert.deepEqual(log.splice(0), [["create", "autofire", null], ["dialog", "autofire", true], ["confirm", "autofire"], ["roll", "autofire"]]);
  await Run.action(vee, "dmg:smg");
  assert.deepEqual(log[0], ["create", "damage", "autofire"], "Autofire damage");
  log.length = 0;
  await Run.action(vee, "atk:smg");
  assert.equal(vee.flags["cyberpunk-red-core"]["firetype-smg"], undefined, "a plain Attack clears the mode");
  log.length = 0;
  await Run.action(vee, "rld:smg");
  assert.deepEqual(log, [["action", "reload-ammo"]]);
});

test("skills, STATs and LUCK; conditions toggle; a roll card is posted", async () => {
  const vee = solo();
  const log = [];
  vee.items.get("eva").createRoll = (type) => Object.assign(fakeRoll(log, type), { luck: 2, rollCard: "modules/cpr-neon-combat-manager/templates/chat-card.hbs" });
  const before = chat.length;
  await Run.action(vee, "sk:eva");
  assert.deepEqual(log.map((x) => x[0]), ["dialog", "roll"]);
  assert.equal(vee.system.stats.luck.value, 3, "LUCK spent");
  assert.equal(chat.length, before + 1, "its card");
  vee.createRoll = (type, name) => (log.push(["actor", type, name]), fakeRoll(log, type));
  await Run.action(vee, "stat:ref");
  assert.deepEqual(log.find((x) => x[0] === "actor"), ["actor", "stat", "ref"]);
  await Run.action(vee, "cond:prone");
  assert.equal(Conditions.has("prone", vee), true);
  await Run.action(vee, "cond:prone");
  assert.equal(Conditions.has("prone", vee), false);
});

test("turn actions: Initiative needs an encounter; End Turn only on your turn", async () => {
  const vee = solo();
  game.combat = null;
  await Run.action(vee, "turn:initiative");
  assert.match(notes.at(-1)[1], /no encounter/);
  const combat = makeCombat([makeActor({ name: "Other" }), vee]);
  const rolled = [];
  combat.rollInitiative = async (ids) => rolled.push(...ids);
  let next = 0;
  combat.nextTurn = async () => next++;
  game.combat = combat;
  await Run.action(vee, "turn:initiative");
  assert.deepEqual(rolled, [combat.combatants.contents[1].id]);
  await Run.action(vee, "turn:endTurn");
  assert.equal(next, 0);
  assert.match(notes.at(-1)[1], /isn't this character's turn/);
  combat.turn = 1;
  await Run.action(vee, "turn:endTurn");
  assert.equal(next, 1);
  game.combat = null;
});

/* ---------------------------------------- */
/*  Per-player layouts                      */
/* ---------------------------------------- */

test("each player keeps their own layout, and can give one character a layout of its own", async () => {
  asGM(false);
  const vee = solo();
  const hazel = makeActor({ name: "Hazel", owners: [player.id] });
  assert.deepEqual(Hud.layoutFor(vee), Lay.template(), "the template to start");
  const mine = Lay.setGroup(Lay.template(), "net", { hidden: true });
  await Hud.saveLayout(mine);
  assert.equal(Hud.layoutFor(hazel).groups.find((g) => g.id === "net").hidden, true, "for all my characters");
  const veeOnly = Lay.moveGroup(mine, "weapons", -1);
  await Hud.saveLayout(veeOnly, vee);
  assert.equal(Hud.hasOwn(vee), true);
  assert.equal(Hud.layoutFor(vee).groups[0].id, "weapons");
  assert.equal(Hud.layoutFor(hazel).groups[0].id, "turn");
  await Hud.clearLayout(vee);
  assert.equal(Hud.hasOwn(vee), false);
  assert.equal(Hud.layoutFor(vee).groups[0].id, "turn");
  assert.equal(testUsers.gm.flags["cpr-neon-combat-manager"], undefined, "the GM's layout is untouched");
  asGM(true);
});

test("macros: the ones the player can run, run for the character; one dropped on the HUD joins its Macros group", async () => {
  asGM(false);
  const vee = solo();
  const ran = [];
  const mk = (id, name, canExecute = true, pack = null) => ({
    id, name, img: "icons/svg/dice-target.svg", canExecute, pack, uuid: pack ? `Compendium.${pack}.Macro.${id}` : `Macro.${id}`,
    execute: async (scope) => ran.push([name, scope.actor?.name, scope.token ?? null]),
    toObject: () => ({ _id: id, name, type: "script", command: "" })
  });
  const world = [mk("m1", "Neon At Home: Spend IP"), mk("m2", "GM Only", false)];
  const fromPack = mk("p1", "Neon At Home: Biomonitor", true, "cpr-neon-at-home.macros");
  const prior = { macros: game.macros, fromUuid: globalThis.fromUuid, gdc: globalThis.getDocumentClass };
  game.macros = Object.assign(world, { get: (id) => world.find((m) => m.id === id) });
  globalThis.fromUuid = async (uuid) => [...world, fromPack].find((m) => m.uuid === uuid) ?? null;
  globalThis.getDocumentClass = () => ({ create: async (data) => {
    const m = mk(`w${world.length}`, data.name);
    m.author = { id: game.user.id };
    world.push(m);
    return m;
  } });
  try {
    const cat = catalog(vee);
    assert.deepEqual(cat.macros.map((e) => e.label), ["Neon At Home: Spend IP"], "only what the player can run");
    assert.equal(cat.macros[0].key, "macro:neonathomespendip");
    assert.equal(Lay.resolve(Hud.layoutFor(vee), cat).some((g) => g.id === "macros"), false, "nothing picked: no group");
    await Run.action(vee, "macro:m1", { token: "tok" });
    assert.deepEqual(ran.at(-1), ["Neon At Home: Spend IP", "Velvet", "tok"]);
    assert.equal(await Run.action(vee, "macro:m2"), null, "one they can't run doesn't");
    Hud.current = { actor: vee, token: null };
    await Hud.dropMacro({ type: "Macro", uuid: "Macro.m1" });
    await Hud.dropMacro({ type: "Macro", uuid: "Compendium.cpr-neon-at-home.macros.Macro.p1" });
    assert.ok(world.some((m) => m.name === "Neon At Home: Biomonitor"), "imported from the compendium");
    const shown = Lay.resolve(Hud.layoutFor(vee), catalog(vee)).find((g) => g.id === "macros");
    assert.deepEqual(shown.entries.map((e) => e.label), ["Neon At Home: Spend IP", "Neon At Home: Biomonitor"]);
  } finally {
    Hud.current = null;
    await Hud.saveLayout(Lay.template());
    game.macros = prior.macros;
    globalThis.fromUuid = prior.fromUuid;
    globalThis.getDocumentClass = prior.gdc;
    asGM(true);
  }
});

test("the Action HUD and its editor render with every string", async () => {
  const vee = solo();
  const base = "modules/cpr-neon-combat-manager/templates";
  const html = await Compat.renderTemplate(`${base}/action-hud.hbs`, Hud.context(vee));
  assert.ok(html.includes('data-run="auto:smg"') && html.includes('data-run="sk:eva"') && html.includes("Militech Viper"));
  assert.ok(html.includes('data-ah="edit"') && html.includes("HP 40/40"));
  const { HudEditor } = await import("../scripts/hud/hud-editor.js");
  const app = HudEditor.open(vee);
  const ctx = await app._prepareContext();
  const skills = ctx.groups.find((g) => g.id === "skills");
  assert.deepEqual(skills.chips.filter((c) => !c.missing).map((c) => c.label), ["Evasion", "Perception", "Melee Weapon"]);
  assert.ok(skills.chips.find((c) => c.key === "skill:stealth").missing, "the template's Stealth: this character hasn't got it");
  const editor = await Compat.renderTemplate(`${base}/action-hud-editor.hbs`, ctx);
  assert.ok(editor.includes('name="addPick"') && editor.includes('data-action="saveLayout"'));
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

test("a button's small label never reads NaN: a number that didn't work out shows nothing", async () => {
  const { cleanSub } = await import("../scripts/hud/hud.js");
  assert.equal(cleanSub({ key: "skill:evasion", sub: "+12" }), "+12");
  assert.equal(cleanSub({ key: "weapon:smg", sub: "0/30" }), "0/30");
  assert.equal(cleanSub({ key: "role:x", sub: "Solo" }), "Solo");
  assert.equal(cleanSub({ key: "util:sheet" }), "");
  const warn = console.warn;
  const said = [];
  console.warn = (m) => said.push(m);
  assert.equal(cleanSub({ key: "skill:athletics", sub: "+NaN" }), "");
  assert.equal(cleanSub({ key: "skill:athletics", sub: "+NaN" }), "");
  assert.equal(cleanSub({ key: "turn:initiative", sub: "NaN" }), "");
  assert.equal(cleanSub({ key: "weapon:x", sub: "undefined/8" }), "");
  console.warn = warn;
  assert.equal(said.filter((m) => /skill:athletics/.test(m)).length, 1, "named in the console once");
});

test("templates read their own values: a helper another module registers under the same name (sub, max, round...) can't take their place", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../templates/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hbs"))) {
    const bare = [...readFileSync(new URL(f, dir), "utf8").matchAll(/\{\{\{?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}?\}\}/g)].map((m) => m[1]).filter((n) => !["else", "this"].includes(n));
    assert.deepEqual(bare, [], `${f}: every value is looked up as this.<name>`);
  }
  // The case that showed: a "sub" helper (a - b) turned every small label into NaN.
  if (typeof Handlebars !== "undefined" && typeof Handlebars.registerHelper === "function") {
    Handlebars.registerHelper("sub", (a, b) => a - b);
    const html = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/action-hud.hbs", { name: "V", hp: { value: 1, max: 1 }, groups: [{ id: "skills", label: "Skills", icon: "x", entries: [{ key: "skill:evasion", run: "sk:1", label: "Evasion", sub: "+12", icon: "x" }] }] });
    assert.match(html, /<small>\+12<\/small>/);
    assert.doesNotMatch(html, /NaN/);
    Handlebars.unregisterHelper("sub");
  }
});

test("scopes: how far each sees, read from its card; the Scope action raises a token's vision to it and puts it back", async () => {
  const { scopeOf, better, scopedRange, scopeLabel } = await import("../scripts/arsenal/scope-data.js");
  assert.deepEqual(scopeOf({ name: "Long Scope", description: "<p>See detail out to 100m. Two-handed Single Shots at 13–50m get +1.</p>" }), { range: 100 });
  assert.deepEqual(scopeOf({ name: "Sniping Scope", description: "See detail out to 800m/yds." }), { range: 800 });
  assert.deepEqual(scopeOf({ name: "Gaki Sniping Scope", description: "A Sniping Scope that sees detail out to 1,000m." }), { range: 1000 });
  assert.deepEqual(scopeOf({ name: "Jue Long Scope", description: "A Long Scope with a built-in Targeting Scope." }), { range: 100 }, "says what it is: that kind's distance");
  assert.deepEqual(scopeOf({ name: "TeleOptics", description: "See detail to 800m/yds." }), { range: 800 });
  assert.deepEqual(scopeOf({ name: "Aviation Tactical Optics Platform", description: "Smart Glasses with Anti-Dazzle, Image Enhance and TeleOptics." }), { range: 800 }, "TeleOptics built into what's worn");
  assert.deepEqual(scopeOf({ name: "Binoculars", description: "2–3× magnification." }), { factor: 3 });
  assert.equal(scopeOf({ name: "Short Scope", description: "Two-handed Single Shots at 0–12m get +1." }), null);
  assert.equal(scopeOf({ name: "Targeting Scope", description: "+1 to Aimed Shots." }), null);
  assert.deepEqual(better({ range: 100 }, { range: 800 }), { range: 800 });
  assert.deepEqual(better({ factor: 3 }, { range: 100 }), { range: 100 });
  assert.deepEqual(better(null, { factor: 3 }), { factor: 3 });
  assert.equal(scopedRange({ base: 30, scope: { range: 800 }, max: 240 }), 240, "no further than the scene");
  assert.equal(scopedRange({ base: 30, scope: { range: 100 } }), 100);
  assert.equal(scopedRange({ base: 30, scope: { factor: 3 } }), 90);
  assert.equal(scopedRange({ base: 200, scope: { range: 100 } }), 200, "never less than unaided");
  assert.equal(scopedRange({ base: 30 }), 30);
  assert.deepEqual([scopeLabel({ range: 800 }), scopeLabel({ factor: 3 })], ["800 m", "×3"]);

  const { Scope } = await import("../scripts/arsenal/scope.js");
  const { Settings } = await import("../scripts/settings.js");
  await Settings.set("scopeVision", true);
  await Settings.set("scopeSniper", true);
  await Settings.set("scopeAngle", 0);
  const M5 = "cpr-neon-combat-manager";
  const actor = makeActor({ name: "Shooter" }, [
    { _id: "rifle", name: "Assault Rifle", type: "weapon", system: { isRanged: true, equipped: "equipped", weaponType: "assaultRifle", installedItems: { list: ["mount"] } } },
    { _id: "mount", name: "Variable Scope Mount", type: "itemUpgrade", system: { description: { value: "Adds 3 slots for scopes only." }, installedItems: { list: ["long", "snipe"] } } },
    { _id: "long", name: "Long Scope", type: "itemUpgrade", system: { description: { value: "See detail out to 100m." } } },
    { _id: "snipe", name: "Sniping Scope", type: "itemUpgrade", system: { description: { value: "See detail out to 800m/yds." } } },
    { _id: "sr", name: "Sniper Rifle", type: "weapon", system: { isRanged: true, equipped: "equipped", weaponType: "sniperRifle" } },
    { _id: "pistol", name: "Heavy Pistol", type: "weapon", system: { isRanged: true, equipped: "equipped", weaponType: "heavyPistol" } },
    { _id: "stowed", name: "Spare Rifle", type: "weapon", system: { isRanged: true, equipped: "carried", weaponType: "sniperRifle" } },
    { _id: "eyes", name: "TeleOptics", type: "cyberware", system: { isInstalled: true, description: { value: "See detail to 800m/yds." } } },
    { _id: "binos", name: "Binoculars", type: "gear", system: { equipped: "carried", description: { value: "2–3× magnification." } } }
  ]);
  const src = Scope.sources(actor);
  assert.deepEqual(src.map((s) => [s.key, s.name, s.scope.range ?? `x${s.scope.factor}`]), [
    ["zoom:rifle", "Sniping Scope", 800],
    ["zoom:sr", "Sniper Rifle", 800],
    ["zoom:eyes", "TeleOptics", 800],
    ["zoom:binos", "Binoculars", "x3"]
  ], "the best scope fitted (through the mount); a bare Sniper Rifle; eyes; binoculars. A pistol and a stowed rifle have none");
  await Settings.set("scopeSniper", false);
  assert.ok(!Scope.sources(actor).some((s) => s.key === "zoom:sr"), "a bare Sniper Rifle, by setting");
  await Settings.set("scopeSniper", true);

  // The token: 30 m of sight in a 160° cone, a limited basic sight; a 400 m scene.
  const doc = {
    id: "tok", name: "Shooter", sight: { range: 30, angle: 160 }, flags: {}, parent: { dimensions: { size: 100, distance: 2, sceneWidth: 12000, sceneHeight: 16000 }, grid: { units: "m" } },
    detectionModes: [{ id: "basicSight", enabled: true, range: 30 }, { id: "lightPerception", enabled: true, range: null }],
    async update(u) {
      for (const [k, v] of Object.entries(u)) {
        if (k === "sight.range") this.sight.range = v;
        else if (k === "sight.angle") this.sight.angle = v;
        else if (k === "detectionModes") this.detectionModes = v;
        else if (k === `flags.${M5}.scope`) (this.flags[M5] ??= {}).scope = v;
        else if (k === `flags.${M5}.-=scope`) delete this.flags[M5]?.scope;
      }
    }
  };
  const info = ui.notifications.info;
  ui.notifications.info = () => {};
  assert.equal(await Scope.toggle(actor, "zoom:rifle", { token: doc }), true);
  assert.deepEqual([doc.sight.range, doc.sight.angle], [400, 160], "to the edge of the scene (800 m is past it), in the token's own cone");
  assert.equal(doc.detectionModes[0].range, 400, "a limited basic sight reaches as far");
  assert.equal(doc.detectionModes[1].range, null, "an unlimited sense is left alone");
  assert.equal(Scope.active(doc).key, "zoom:rifle");
  // The HUD: the rifle's button is lit; eyes and binoculars are entries of their own.
  const c = catalog(actor, { token: doc });
  const row = c.weapons.find((w) => w.label === "Assault Rifle");
  assert.equal(row.buttons.find((b) => b.key === "zoom:rifle").on, true);
  assert.ok(!c.weapons.find((w) => w.label === "Heavy Pistol").buttons.some((b) => b.key.startsWith("zoom:")));
  assert.deepEqual(c.weapons.filter((w) => String(w.key).startsWith("zoom:")).map((w) => [w.key, w.sub]), [["zoom:eyes", "800 m"], ["zoom:binos", "×3"]]);
  // Switching to the binoculars: three times what the token sees unaided, not three times the scope.
  await Scope.toggle(actor, "zoom:binos", { token: doc });
  assert.equal(doc.sight.range, 90);
  // Off: as it was.
  assert.equal(await Scope.toggle(actor, "zoom:binos", { token: doc }), false);
  assert.deepEqual([doc.sight.range, doc.sight.angle, doc.detectionModes[0].range, Scope.active(doc)], [30, 160, 30, null]);
  // A narrower field of view, by setting; never a wider one.
  await Settings.set("scopeAngle", 40);
  await Scope.toggle(actor, "zoom:eyes", { token: doc });
  assert.equal(doc.sight.angle, 40);
  await Scope.toggle(actor, "zoom:eyes", { token: doc });
  assert.equal(doc.sight.angle, 160);
  await Settings.set("scopeAngle", 200);
  await Scope.toggle(actor, "zoom:eyes", { token: doc });
  assert.equal(doc.sight.angle, 160, "not widened");
  await Scope.toggle(actor, "zoom:eyes", { token: doc });
  await Settings.set("scopeAngle", 0);
  // Switched off in the settings: no action, no entries.
  await Settings.set("scopeVision", false);
  assert.equal(await Scope.toggle(actor, "zoom:rifle", { token: doc }), null);
  assert.ok(!catalog(actor, { token: doc }).weapons.some((w) => String(w.key).startsWith("zoom:") || (w.buttons ?? []).some((b) => b.key.startsWith("zoom:"))));
  await Settings.set("scopeVision", true);
  ui.notifications.info = info;
});

test("ways of seeing and a torch: what gives them, switching one on, what heat shows, and the light a torch throws", async () => {
  const D = await import("../scripts/senses/senses-data.js");
  assert.deepEqual(D.modesOf({ name: "Low Light / Infrared / UV", description: "Paired. Darkness, smoke and fog penalties drop to 0." }), ["lowlight", "infrared", "uv"]);
  assert.deepEqual(D.modesOf({ name: "Infrared Nightvision Scope", description: "Cuts penalties for darkness, smoke and fog to 0. Shows warm bodies against cold metal." }), ["infrared"]);
  assert.deepEqual(D.modesOf({ name: "M-98A3 Enhanced Combat Helmet", description: "Smart Glasses with Anti-Dazzle, Low Light/Infrared/UV and Targeting Scope" }), ["lowlight", "infrared", "uv"], "built into what's worn");
  assert.deepEqual(D.modesOf({ name: "IR/UV Laser Sight", description: "A Laser Sight that only works if you see in infrared or nightvision." }), [], "a sight that needs such eyes isn't such eyes");
  assert.deepEqual(D.modesOf({ name: "TeleOptics", description: "See detail to 800m/yds." }), []);
  // Heat.
  assert.equal(D.heatOf({ meat: true }), "warm");
  assert.equal(D.heatOf({ meat: true, borg: true }), "cold", "a Full Body Conversion reads cold");
  assert.equal(D.heatOf({ meat: true, borg: true, skinned: true }), "warm", "unless Realskinn covers it");
  assert.equal(D.heatOf({ meat: true, damped: true }), null, "Thermal Damping with the camo running: nothing");
  assert.equal(D.heatOf({ meat: false }), null, "a vehicle, a crate");
  assert.equal(D.heatOf({ meat: true, dead: true }), "cold");
  assert.equal(D.isBorgPart("FBC EMP Coating"), true);
  assert.equal(D.isBorgPart("Sycust Cyberspine"), false, "a Cyberspine alone isn't a Full Body Conversion");
  // Torches.
  assert.deepEqual(D.torchOf({ name: "Flashlight", description: "100m/yd beam, 10 hours a charge." }), { range: 100 });
  assert.deepEqual(D.torchOf({ name: "Flashlight Cyberfinger", description: "A flashlight in the fingertip." }), { range: 20 });
  assert.equal(D.torchOf({ name: "Centurion Essentials Thermo-Dirk", description: "A heated blade." }), null);
  assert.equal(D.torchOf({ name: "Binoculars", description: "2–3× magnification." }), null);
  assert.deepEqual(D.torchLight({ range: 100, angle: 60, max: 80 }), { dim: 80, bright: 20, angle: 60, color: "#fff1c9", alpha: 0.35, luminosity: 0.5, attenuation: 0.6 });

  const { Senses } = await import("../scripts/senses/senses.js");
  const { Settings } = await import("../scripts/settings.js");
  const { withVision } = await import("../scripts/neonfx/screen.js");
  const { Conditions } = await import("../scripts/conditions/engine.js");
  for (const k of ["visionModes", "visionHeat", "torchAction"]) await Settings.set(k, true);
  await Settings.set("torchAngle", 60);
  const M6 = "cpr-neon-combat-manager";
  const eyes = { _id: "eyes", name: "Low Light / Infrared / UV", type: "cyberware", system: { isInstalled: true, description: { value: "Darkness, smoke and fog penalties drop to 0." } } };
  const actor = makeActor({ name: "Scout" }, [eyes, { _id: "torch", name: "Flashlight", type: "gear", system: { equipped: "carried", description: { value: "100m/yd beam." } } }]);
  const plain = makeActor({ name: "Plain" }, [
    { _id: "rifle", name: "Rifle", type: "weapon", system: { isRanged: true, equipped: "equipped", installedItems: { list: ["ir"] } } },
    { _id: "ir", name: "Infrared Nightvision Scope", type: "itemUpgrade", system: { description: { value: "Shows warm bodies against cold metal." } } }
  ]);
  assert.deepEqual(Senses.modes(actor).map((m) => m.mode), ["lowlight", "infrared", "uv"]);
  assert.deepEqual(Senses.modes(plain).map((m) => [m.mode, m.by]), [["infrared", "Infrared Nightvision Scope"]], "through the scope on the gun in hand");
  assert.deepEqual(Senses.modes(makeActor({ name: "Nobody" })), []);
  assert.deepEqual(Senses.torch(actor), { range: 100, by: "Flashlight" });
  assert.equal(Senses.torch(plain), null);

  const mkDoc = (name) => ({
    id: name, name, flags: {}, light: { dim: 0, bright: 0, angle: 360, color: null, alpha: 0.5 }, parent: { dimensions: { size: 100, distance: 2, sceneWidth: 3000, sceneHeight: 4000 } },
    async update(u) {
      for (const [k, v] of Object.entries(u)) {
        if (k === "light") this.light = { ...this.light, ...v };
        else if (k.startsWith(`flags.${M6}.-=`)) delete this.flags[M6]?.[k.split("-=")[1]];
        else if (k.startsWith(`flags.${M6}.`)) (this.flags[M6] ??= {})[k.split(".").pop()] = v;
      }
    }
  });
  const doc = mkDoc("Scout");
  // One way of seeing at a time; the same again switches it off.
  assert.equal(await Senses.toggleVision(actor, "infrared", { token: doc }), "infrared");
  assert.equal(Senses.vision(doc), "infrared");
  assert.equal(await Senses.toggleVision(actor, "lowlight", { token: doc }), "lowlight");
  assert.equal(Senses.vision(doc), "lowlight");
  assert.equal(await Senses.toggleVision(plain, "uv", { token: mkDoc("Plain") }), null, "not theirs to switch on");
  // The HUD.
  const c = catalog(actor, { token: doc });
  assert.deepEqual(c.weapons.filter((w) => String(w.key).startsWith("sense:")).map((w) => [w.key, w.on]), [["sense:lowlight", true], ["sense:infrared", false], ["sense:uv", false], ["sense:torch", false]]);
  assert.equal(await Senses.toggleVision(actor, "lowlight", { token: doc }), null);
  assert.equal(Senses.vision(doc), null);

  // The torch: a cone as far as the beam, no further than the scene (100 m here); off, the light it had.
  doc.light = { dim: 4, bright: 2, angle: 360, color: "#00ff00", alpha: 0.5 };
  assert.equal(await Senses.toggleTorch(actor, { token: doc }), true);
  assert.deepEqual([doc.light.dim, doc.light.bright, doc.light.angle], [100, 25, 60]);
  assert.equal(Senses.torchOn(doc), true);
  assert.equal(await Senses.toggleTorch(actor, { token: doc }), false);
  assert.deepEqual([doc.light.dim, doc.light.bright, doc.light.angle, doc.light.color], [4, 2, 360, "#00ff00"]);
  assert.equal(await Senses.toggleTorch(plain, { token: mkDoc("Plain") }), null, "no flashlight");

  // What heat sight makes of people.
  const person = { actor: makeActor({ name: "Ganger" }) };
  const borg = { actor: makeActor({ name: "Borg" }, [{ _id: "fbc", name: "FBC Gemini Sculpt", type: "cyberware", system: { isInstalled: true } }]) };
  const skinned = { actor: makeActor({ name: "Skinned" }, [{ _id: "fbc", name: "FBC EMP Coating", type: "cyberware", system: { isInstalled: true } }, { _id: "rs", name: "Realskinn Plating", type: "cyberware", system: { isInstalled: true } }]) };
  const ghost = { actor: makeActor({ name: "Ghost" }, [{ _id: "td", name: "Thermal Damping", type: "itemUpgrade", system: {} }]) };
  assert.deepEqual([Senses.heat(person), Senses.heat(borg), Senses.heat(skinned)], ["warm", "cold", "warm"]);
  assert.equal(Senses.heat(ghost), "warm", "the damping does nothing until the camo runs");
  await Conditions.add("chromeOpticalCamo", ghost.actor);
  assert.equal(Senses.heat(ghost), null);
  assert.equal(Senses.heat({ actor: makeActor({ name: "Truck", type: "vehicle" }) }), null);

  // The screen: the mode's look under running chrome, over a Kerenzikov.
  const v = { mode: "infrared", tint: "#ff7a1a" };
  assert.deepEqual(withVision(null, v), { kind: "infrared", tint: "#ff7a1a" });
  assert.deepEqual(withVision({ kind: "kerenzikov", tint: "#3d8bff" }, v), { kind: "infrared", tint: "#ff7a1a" });
  assert.deepEqual(withVision({ kind: "sandevistan", tint: "#39ff14" }, v), { kind: "sandevistan", tint: "#39ff14" });
  assert.equal(withVision(null, v, { enabled: false }), null);
  assert.equal(withVision(null, null), null);

  // Switched off in the settings: no actions.
  await Settings.set("visionModes", false);
  await Settings.set("torchAction", false);
  assert.ok(!catalog(actor, { token: doc }).weapons.some((w) => String(w.key).startsWith("sense:")));
  await Settings.set("visionModes", true);
  await Settings.set("torchAction", true);
});
