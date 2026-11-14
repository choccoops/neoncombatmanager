/** Combat: Round time, Turn automation, the carousel and crew bar contexts, and every template rendering. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, makeCombat, registerSettings, settle, chat, dice, missingKeys, asGM } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { CombatTime } = await import("../scripts/combat/time.js");
const { Turns } = await import("../scripts/combat/turns.js");
const { Carousel } = await import("../scripts/combat/carousel.js");
const { EncounterMode } = await import("../scripts/combat/mode.js");
const { Ladder } = await import("../scripts/roller/ladder.js");
const { Environment } = await import("../scripts/environment/environment.js");
const { Compat } = await import("../scripts/compat.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Registry.refresh();

test("a Round is 3 seconds of world time, set on Foundry's combat clock", async () => {
  CombatTime.apply();
  assert.equal(CONFIG.time.roundTime, 3);
  assert.equal(CONFIG.time.turnTime, 0);
  assert.equal(CombatTime.toRounds(60), 20, "a minute is 20 Rounds");
  assert.equal(CombatTime.toSeconds(20), 60);
  await Settings.set("roundSeconds", 6);
  CombatTime.apply();
  assert.equal(CONFIG.time.roundTime, 6);
  await Settings.set("roundSeconds", 3);
  CombatTime.apply();
});

test("the time of day reads like Neon Hub's calendar: SmallTime's 12/24-hour setting, 12-hour without it", async () => {
  game.time.worldTime = 3600 * 19;
  assert.equal(CombatTime.clock(), "7:00 PM", "no SmallTime: a 12-hour clock, as Neon Hub shows");
  game.settings.register("smalltime", "time-format", { scope: "world", type: Number, default: 12 });
  game.modules.set("smalltime", { id: "smalltime", active: true });
  assert.equal(CombatTime.clock(), "7:00 PM");
  await game.settings.set("smalltime", "time-format", 24);
  assert.equal(CombatTime.clock(), "19:00");
  // Neon Hub's clock gives the minutes when it's running.
  game.modules.set("cpr-neon-hub", { id: "cpr-neon-hub", active: true, api: { time: () => ({ minutes: 7 * 60 + 5, time: "07:05" }) } });
  await game.settings.set("smalltime", "time-format", 12);
  assert.equal(CombatTime.clock(), "7:05 AM");
  game.modules.delete("cpr-neon-hub");
  game.modules.delete("smalltime");
});

test("combat elapsed time runs from the world time it started", async () => {
  const combat = makeCombat([makeActor({ name: "A" })]);
  game.time.worldTime = 500;
  await CombatTime.stampStart(combat);
  game.time.worldTime = 527;
  assert.equal(CombatTime.elapsed(combat), 27);
  assert.equal(Compat.isActiveGM, true);
});

test("Turn start: a Mortally Wounded character gets a Death Save card; Drowning deals BODY", async () => {
  chat.length = 0;
  const dying = makeActor({ name: "Dying", system: { derivedStats: { hp: { value: -2, max: 40 } } } });
  await Conditions.add("drowning", dying);
  const combat = makeCombat([dying]);
  await Turns.turnStart(combat, combat.combatant);
  assert.ok(chat.some((m) => m.content.includes("Roll Death Save")));
  const dmg = chat.find((m) => m.content.includes("6 damage"));
  assert.ok(dmg, "drowning: BODY 6 straight to HP");
  assert.ok(dmg.content.includes('data-ncm-action="applyDamage"'));
  assert.ok(dmg.content.includes('data-amount="6"'));
});

test("Turn end: fire burns; moving over 4 m/yds reopens Broken Ribs and locks a damaged ear's next move", async () => {
  chat.length = 0;
  const actor = makeActor({ name: "Runner" });
  await Conditions.add(["onFireStrong", "brokenRibs", "damagedEar"], actor, { force: true });
  const combat = makeCombat([actor]);
  const cb = combat.combatant;
  Turns.moved.set(cb.id, { metres: 6, at: null });
  await Turns.turnEnd(combat, cb);
  assert.ok(chat.some((m) => m.content.includes("4 damage")), "Strong fire: 4");
  assert.ok(chat.some((m) => m.content.includes("5 damage") && m.content.includes("Broken Ribs")), "ribs reopen: 5");
  assert.ok(Turns.lockNext.has(cb.id));
  chat.length = 0;
  await Turns.turnStart(combat, cb);
  assert.ok(chat.some((m) => m.content.includes("no Move Action")));
  assert.equal(Turns.metres(cb.id), 0, "movement resets each Turn");
});

test("hazard damage can apply itself", async () => {
  await Settings.set("hazardDamage", "auto");
  const actor = makeActor({ name: "Burning" });
  await Conditions.add("onFireDeadly", actor);
  const combat = makeCombat([actor]);
  await Turns.turnEnd(combat, combat.combatant);
  assert.equal(actor.system.derivedStats.hp.value, 34);
  await Settings.set("hazardDamage", "card");
});

test("the Spinal Injury reminder comes once", async () => {
  chat.length = 0;
  const actor = makeActor({ name: "Spine" });
  await Conditions.add("spinalInjury", actor, { changes: [] });
  const combat = makeCombat([actor]);
  await Turns.turnStart(combat, combat.combatant);
  await Turns.turnStart(combat, combat.combatant);
  assert.equal(chat.filter((m) => m.content.includes("no Action this Turn")).length, 1);
});

test("the carousel shows each combatant as much as this user may see", async () => {
  const pc = makeActor({ name: "Vee", hasPlayerOwner: true, system: { derivedStats: { hp: { value: 15, max: 40 } } } });
  const npc = makeActor({ name: "Ganger", type: "mook", hasPlayerOwner: false });
  await Conditions.add("prone", npc);
  const combat = makeCombat([pc, npc], { round: 3 });
  combat.turns[1].isOwner = false;
  game.time.worldTime = 0;
  await combat.setFlag("cpr-neon-combat-manager", "started", 0);
  game.time.worldTime = 6;
  const ctx = Carousel.context(combat);
  assert.equal(ctx.round, 3);
  assert.equal(ctx.elapsed, "00:06");
  const [a, b] = ctx.cards;
  assert.equal(a.active, true);
  assert.equal(a.wound, "seriouslyWounded");
  assert.equal(a.hp.pct, 38);
  assert.deepEqual(b.conditions.map((c) => c.name), ["Prone"]);
  const html = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/carousel.hbs", ctx);
  assert.ok(html.includes("Vee") && html.includes("Ganger") && html.includes('data-ncm="nextTurn"'));
});

/* ---------------------------------------- */
/*  Stealth segments                        */
/* ---------------------------------------- */

EncounterMode.init();

/** A combat not begun yet, with Foundry's startCombat/nextRound as far as the hooks see them. */
function encounter(actors) {
  const combat = makeCombat(actors, { round: 0 });
  const round = async (n) => {
    combat.round = n;
    combat.turn = 0;
    Hooks.callAll("updateCombat", combat, { round: n, turn: 0 }, {});
    await settle();
  };
  combat.startCombat = () => round(1);
  combat.nextRound = () => round(combat.round + 1);
  return combat;
}

const tpl = "modules/cpr-neon-combat-manager/templates/carousel.hbs";

test("a stealth segment: Begin leaves the Ladder alone; Turns, Rounds and Death Saves run as in a fight", async () => {
  asGM(true);
  chat.length = 0;
  const vee = makeActor({ name: "Vee", hasPlayerOwner: true, system: { derivedStats: { hp: { value: -2, max: 40 } } } });
  const guard = makeActor({ name: "Guard", hasPlayerOwner: false });
  const combat = encounter([vee, guard]);
  const before = Carousel.context(combat);
  assert.equal(before.sneakFirst, false, "full combat is the default");
  const pre = await Compat.renderTemplate(tpl, before);
  assert.ok(pre.includes('data-ncm="sneak"') && pre.includes('data-ncm="start"'), "the GM picks Sneak or Start");

  await EncounterMode.begin(combat, "stealth");
  assert.equal(combat.round, 1);
  assert.equal(EncounterMode.get(combat), "stealth");
  assert.equal(Ladder.level(combat), "unaware", "nobody's spotted yet");
  await combat.nextRound();
  assert.equal(Ladder.level(combat), "unaware", "nor when the Round turns");
  await Ladder.step(combat, 1);
  await combat.nextRound();
  assert.equal(Ladder.level(combat), "suspicious", "the GM's steps stay");

  await Turns.turnStart(combat, combat.combatant);
  assert.ok(chat.some((m) => m.content.includes("Roll Death Save")), "Turn automation runs in stealth too");

  const ctx = Carousel.context(combat);
  assert.deepEqual([ctx.mode.mode, ctx.mode.stealth], ["stealth", true]);
  const html = await Compat.renderTemplate(tpl, ctx);
  assert.ok(html.includes("ncm-car-mode is-stealth") && html.includes('data-ncm="mode"'));
  assert.ok(html.includes("Spotted: switch to full combat"));
  asGM(false);
  const theirs = await Compat.renderTemplate(tpl, Carousel.context(combat));
  assert.ok(theirs.includes('<div class="ncm-car-mode is-stealth"'), "players see the mode");
  assert.ok(!theirs.includes('data-ncm="mode"') && !theirs.includes("ncm-car-ladder"), "but can't switch it, nor see the Ladder");
  asGM(true);
});

test("full combat mid-segment: Alert once, the Initiative order and Round kept, a card for everyone; and back", async () => {
  asGM(true);
  chat.length = 0;
  const vee = makeActor({ name: "Vee", hasPlayerOwner: true });
  const g1 = makeActor({ name: "Guard 1", hasPlayerOwner: false });
  const g2 = makeActor({ name: "Guard 2", hasPlayerOwner: false });
  const combat = encounter([vee, g1, g2]);
  await EncounterMode.begin(combat, "stealth");
  await combat.nextRound();
  combat.turn = 2;
  const order = combat.turns.map((t) => t.id);

  await EncounterMode.set(combat, "combat");
  assert.equal(EncounterMode.get(combat), "combat");
  assert.equal(Ladder.level(combat), "alert");
  assert.deepEqual([combat.round, combat.turn, combat.turns.map((t) => t.id)], [2, 2, order], "nothing about the queue changes");
  const card = chat.at(-1);
  assert.match(card.content, /Full combat/);
  assert.match(card.content, /Round 2/);
  assert.equal(card.whisper, undefined, "everyone sees it");

  await Ladder.step(combat, -1);
  await combat.nextRound();
  assert.equal(Ladder.level(combat), "searching", "raised once: the GM can lower it again");

  await EncounterMode.set(combat, "stealth");
  assert.match(chat.at(-1).content, /Back to stealth/);
  await EncounterMode.set(combat, "combat");
  assert.equal(Ladder.level(combat), "alert", "a new stretch of full combat raises it again");
  const n = chat.length;
  await EncounterMode.set(combat, "combat");
  assert.equal(chat.length, n, "no card when nothing changed");

  await EncounterMode.toggle(combat);
  await Settings.set("combatSummary", true);
  await CombatTime.summary(combat);
  assert.match(chat.at(-1).content, /Stealth segment over/);
});

test("a combat begun from the tracker takes the default mode; Start can leave the Ladder alone too", async () => {
  asGM(true);
  const guard = makeActor({ name: "Guard", hasPlayerOwner: false });
  await Settings.set("encounterMode", "stealth");
  const sneaky = encounter([guard]);
  assert.equal(Carousel.context(sneaky).sneakFirst, true, "Sneak is the carousel's main button");
  await sneaky.startCombat();
  assert.equal(sneaky.flags["cpr-neon-combat-manager"].mode, "stealth", "stamped on the combat");
  assert.equal(Ladder.level(sneaky), "unaware");
  await Settings.set("encounterMode", "combat");
  assert.equal(EncounterMode.get(sneaky), "stealth", "a combat under way keeps its mode");

  const fight = encounter([guard]);
  await fight.startCombat();
  assert.equal(Ladder.level(fight), "alert", "a fight puts them at Alert");

  await Settings.set("combatRaisesAlert", false);
  const quiet = encounter([guard]);
  await EncounterMode.begin(quiet, "combat");
  assert.deepEqual([EncounterMode.get(quiet), Ladder.level(quiet)], ["combat", "unaware"]);
  await Settings.set("combatRaisesAlert", true);

  asGM(false);
  await EncounterMode.set(quiet, "stealth");
  assert.equal(EncounterMode.get(quiet), "combat", "only the GM switches");
  asGM(true);
});

test("the environment per character: weather, gear and the sight condition", async () => {
  await Settings.set("weatherSource", "manual");
  await Settings.set("manualWeather", { cond: "heavyRain", band: "hot", strange: "radioactiveWindstorm" });
  const doc = { name: "Out", parent: null, x: 0, y: 0, width: 1, height: 1, actor: makeActor({ name: "Out" }, [{ name: "Heavy Armorjack", type: "armor", system: { equipped: "equipped" } }]) };
  doc.actor.getArmorPenaltyMods = () => -2;
  const { desired, row, hazards } = Environment.evaluate(doc, { keys: ["heavyRain", "hot", "radioactiveWindstorm"] });
  assert.deepEqual([...desired.keys()], ["wxHeavyRain", "wxHot", "wxRadioactiveWind", "radiationHigh", "obscured"]);
  assert.deepEqual(desired.get("wxHot").changes.map((c) => c.value), [-1, -1, -1]);
  assert.equal(desired.get("obscured").name, "Obscured (-2)");
  assert.equal(row.outdoors, true);
  assert.deepEqual(hazards, []);
  await Environment.apply(doc.actor, desired);
  await settle();
  assert.deepEqual(Conditions.active(doc.actor).map((c) => c.id).sort(), ["obscured", "radiationHigh", "wxHeavyRain", "wxHot", "wxRadioactiveWind"]);
  // The weather clears: the environment takes its conditions back, and only those.
  await Conditions.add("prone", doc.actor);
  await Environment.apply(doc.actor, new Map());
  assert.deepEqual(Conditions.active(doc.actor).map((c) => c.id), ["prone"]);
});

test("a condition the GM placed by hand outranks the environment's", async () => {
  const actor = makeActor({ name: "Dark" });
  await Conditions.add("darkness", actor);
  await Environment.apply(actor, new Map([["lowLight", { changes: null }]]));
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["darkness"]);
  await Environment.apply(actor, new Map());
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["darkness"], "and isn't cleaned up as the environment's");
});

test("every template renders and every key it uses exists", async () => {
  const base = "modules/cpr-neon-combat-manager/templates";
  const html = await Compat.renderTemplate(`${base}/chat-card.hbs`, { title: "T", kicker: "K", body: "<p>b</p>", tone: "red", buttons: [{ action: "deathSave", label: "Roll", icon: "fa-solid fa-x", attrs: 'data-actor="Actor.x"', gm: true }] });
  assert.ok(html.includes('data-ncm-action="deathSave"') && html.includes('data-gm="true"'));
  const { summary, keyLabel } = await import("../scripts/conditions/lab-app.js");
  assert.equal(keyLabel("bonuses.allActions"), "All Actions");
  assert.equal(keyLabel("system.stats.move.value"), "MOVE");
  assert.equal(summary(Registry.get("lostEye")), "-4 Ranged Attacks · -4 Perception (sight) · +1 Death Save penalty · adds CPR's Critical Injury");
  await Compat.renderTemplate(`${base}/lab.hbs`, { gm: true, views: [{ id: "all", label: "All", count: 1, active: true }], list: [{ id: "prone", name: "Prone", img: "x", category: "Combat", summary: "", override: true, custom: true }], cltPending: true, shim: true, cltActive: true });
  await Compat.renderTemplate(`${base}/lab-edit.hbs`, { name: "X", img: "x", changes: [{ key: "bonuses.melee", value: -2, index: 0 }], categories: [], keys: ["bonuses.melee"] });
  await Compat.renderTemplate(`${base}/triggers.hbs`, { rows: [{ index: 0, id: "a", ops: [], conditions: [], actions: [], types: "" }] });
  await Compat.renderTemplate(`${base}/environment.hbs`, { gm: true, manual: true, sources: [], calendars: [], sky: [], strange: [], bands: [], now: [], rows: [{ name: "A", conditions: [] }], scene: { name: "S", darkness: 40 }, sceneModes: [] });
  await Compat.renderTemplate(`${base}/settings-menu.hbs`, { fields: [{ key: "a", type: "boolean" }, { key: "b", type: "select", choices: [] }, { key: "c", type: "number", range: { min: 0, max: 1, step: 1 } }, { key: "d", type: "text" }] });
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

test("movement in a fight is held to what the character can cover this Turn: a player's move past it doesn't happen, a GM's goes with a warning", async () => {
  const { moveCheck, reach: reachOf } = await import("../scripts/ruler/ruler-core.js");
  const r = reachOf(6); // Move 12 m, with a Run 24 m
  assert.deepEqual(moveCheck({ walked: 0, step: 24, r, ownTurn: true }), { ok: true, warn: false, left: 24, over: 0, why: null });
  assert.deepEqual(moveCheck({ walked: 10, step: 16, r, ownTurn: true }), { ok: false, warn: true, left: 14, over: 2, why: null });
  assert.equal(moveCheck({ walked: 10, step: 16, r, ownTurn: true, mode: "warn" }).ok, true, "warned, not held");
  assert.equal(moveCheck({ walked: 10, step: 16, r, ownTurn: true, mode: "warn" }).warn, true);
  assert.equal(moveCheck({ walked: 10, step: 16, r, ownTurn: true, gm: true }).ok, true, "a GM's move always goes");
  assert.equal(moveCheck({ walked: 10, step: 16, r, ownTurn: true, gm: true }).warn, true);
  assert.equal(moveCheck({ walked: 10, step: 16, r, ownTurn: true, mode: "off" }).warn, false);
  assert.equal(moveCheck({ walked: 10, step: 16, r, ownTurn: false }).warn, false, "out of their Turn, nothing is held");
  const prone = reachOf(6, { prone: true });
  assert.deepEqual(moveCheck({ step: 2, r: prone, ownTurn: true }), { ok: false, warn: true, left: 0, over: 2, why: "prone" });
  assert.equal(moveCheck({ step: 500, ownTurn: true }).warn, false, "no reach known: nothing to hold to");
});
