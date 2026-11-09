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
  assert.deepEqual(t.groups.filter((g) => !g.hidden).map((g) => g.id), ["turn", "weapons", "skills", "role", "net", "status", "utility", "macros"]);
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
  assert.deepEqual(c.turn.map((t) => t.key), ["turn:initiative", "turn:endTurn", "turn:deathSave", "turn:facedown"]);
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
  assert.equal(t[1].alert, true);
  assert.deepEqual([t[2].alert, t[2].sub], [true, "+2"]);
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
  assert.deepEqual([s.run, s.alert, t.indexOf(s)], ["sk:sth", true, 2]);
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
