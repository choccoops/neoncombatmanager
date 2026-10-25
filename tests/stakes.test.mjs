/** The Plot Die, Combat Awareness and the 2070 conditions (quickhacks, legs, Prone, Into the Wall). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, makeCombat, registerSettings, settle, chat, dice, asGM, missingKeys } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { plotResult, luckOptions, doubleDownCost, clampLuck } = await import("../scripts/stakes/plot-die.js");
const { Stakes } = await import("../scripts/stakes/stakes.js");
const { ABILITIES, abilityEffect, check, step, assignMode, keyOf } = await import("../scripts/awareness/rules.js");
const { Awareness } = await import("../scripts/awareness/awareness.js");
const { readout } = await import("../scripts/comms/vitals.js");
const { Calls } = await import("../scripts/comms/calls.js");
const { Compat } = await import("../scripts/compat.js");
const { pageLabel } = await import("../scripts/util.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Registry.refresh();
Stakes.registerSocket();

const M = "cpr-neon-combat-manager";
const SYS = "cyberpunk-red-core";
const lastCard = () => chat.at(-1);
const buttons = (msg) => [...String(msg.content).matchAll(/data-ncm-action="([^"]+)"/g)].map((m) => m[1]);
/** A card button as Cards hands it to Stakes.click. */
const btn = (action, data = {}) => ({ disabled: false, dataset: { ncmAction: action, ...data } });
const msgOf = (m) => ({ ...m, isOwner: true, async setFlag(s, k, v) {
  m.flags[s] ??= {};
  m.flags[s][k] = v;
}, async update() {} });

/* ---------------------------------------- */
/*  The Plot Die                            */
/* ---------------------------------------- */

test("the Plot Die: 1 and 2 are Complications with +2/+4, 3-4 nothing, 5-6 Opportunities", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((f) => [plotResult(f).kind, plotResult(f).bonus]), [
    ["complication", 2], ["complication", 4], ["nothing", 0], ["nothing", 0], ["opportunity", 0], ["opportunity", 0]
  ]);
});

test("LUCK decides what a player can do around the Stakes", () => {
  assert.deepEqual(luckOptions({ value: 4, max: 4 }), { ask: false, doubleDown: false, forceFate: false });
  assert.deepEqual(luckOptions({ value: 5, max: 6 }), { ask: true, doubleDown: false, forceFate: false });
  assert.deepEqual(luckOptions({ value: 3, max: 8 }), { ask: true, doubleDown: true, forceFate: true });
  assert.equal(luckOptions({ value: 2, max: 8 }).forceFate, false, "Force Fate costs 3 LUCK");
  assert.equal(luckOptions({ value: 0, max: 8 }).doubleDown, false, "Double Down needs LUCK left");
  assert.deepEqual(luckOptions({ value: 8, max: 8 }, { doubleDown: true, forceFate: true }), { ask: true, doubleDown: false, forceFate: false }, "once a session each");
  assert.deepEqual(doubleDownCost(plotResult(1), 5), { luckLost: 2, complications: 1 });
  assert.deepEqual(doubleDownCost(plotResult(2), 1), { luckLost: 1, complications: 2 }, "not enough LUCK: two Complications");
  assert.deepEqual(doubleDownCost(plotResult(6), 0), { luckLost: 0, complications: 0 });
  assert.equal(clampLuck(7, 2, 8), 8);
  assert.equal(clampLuck(0, -1, 8), 0);
});

test("the GM Raises the Stakes; the card offers the roll (and Force Fate to LUCK 7+)", async () => {
  const low = makeActor({ name: "Low", system: { stats: { luck: { value: 5, max: 5 } } } });
  await Stakes.raise(low, { reason: "Last door before the vault" });
  assert.deepEqual(buttons(lastCard()), ["stakes-roll"]);
  assert.match(lastCard().content, /data-owner="true"/, "the character's player rolls it");
  assert.match(lastCard().content, /Last door before the vault/);
  const high = makeActor({ name: "High", system: { stats: { luck: { value: 8, max: 8 } } } });
  await Stakes.raise(high);
  assert.deepEqual(buttons(lastCard()), ["stakes-roll", "stakes-force"]);
  asGM(false);
  await assert.rejects(Stakes.raise(high), /GM/);
  asGM(true);
});

test("a Complication puts +2/+4 on the next Check, ticked in CPR's roll dialog, and it's gone after that Check", async () => {
  const actor = makeActor({ name: "Rolls", system: { stats: { luck: { value: 5, max: 5 } } } });
  dice.push(2);
  await Stakes.roll(actor);
  await settle();
  const card = lastCard();
  assert.deepEqual(buttons(card), ["stakes-comp", "stakes-comp", "stakes-comp"], "the GM picks a Complication");
  assert.match(card.content, /data-gm="true"/);
  const [effect] = Conditions.effects(actor, "stakesBonus");
  assert.deepEqual(effect.changes.map((c) => [c.key, c.value]), [["bonuses.allActions", "4"]]);
  assert.deepEqual(effect.flags[SYS].changes.situational[0], { isSituational: true, onByDefault: true });
  assert.equal(effect.name, "Plot Die +4");

  // A damage card isn't the Check; a Cyberpunk RED roll card is.
  const speaker = { actor: actor.id };
  await Stakes.onChatMessage({ content: '<div class="rollcard" data-bonus-damage="0">', speaker }, game.user.id);
  assert.equal(Conditions.has("stakesBonus", actor), true);
  await Stakes.onChatMessage({ content: '<div class="rollcard">REF + Handgun</div>', speaker }, game.user.id);
  await settle();
  assert.equal(Conditions.has("stakesBonus", actor), false);
});

test("3-4 changes nothing; an Opportunity goes to the player; a new result replaces the old bonus", async () => {
  const actor = makeActor({ name: "Opp", system: { stats: { luck: { value: 3, max: 8 } } } });
  dice.push(1);
  await Stakes.roll(actor);
  assert.equal(Conditions.has("stakesBonus", actor), true);
  dice.push(4);
  await Stakes.roll(actor);
  await settle();
  assert.equal(Conditions.has("stakesBonus", actor), false, "a reroll's result replaces the bonus");
  assert.deepEqual(buttons(lastCard()), ["stakes-double"], "nothing to spend; LUCK 7+ may Double Down");
  dice.push(6);
  await Stakes.roll(actor);
  assert.deepEqual(buttons(lastCard()), ["stakes-opp", "stakes-opp", "stakes-opp", "stakes-opp", "stakes-double"]);
});

test("Force Fate: 3 LUCK and once a session for an Opportunity; New session brings it back", async () => {
  const actor = makeActor({ name: "Fate", system: { stats: { luck: { value: 8, max: 8 } } } });
  await Stakes.raise(actor);
  const raised = msgOf(lastCard());
  await Stakes.click(raised, btn("stakes-force"), null, actor);
  assert.equal(actor.system.stats.luck.value, 5);
  assert.equal(raised.flags[M].done, true, "the card is spent");
  assert.match(lastCard().content, /kind-opportunity/);
  assert.equal(Stakes.options(actor).forceFate, false);
  await Stakes.newSession();
  assert.equal(Stakes.options(actor).forceFate, true);
});

test("Double Down: a Complication on the reroll costs 2 LUCK, or two Complications without it", async () => {
  const actor = makeActor({ name: "Double", system: { stats: { luck: { value: 7, max: 7 } } } });
  dice.push(3);
  await Stakes.roll(actor);
  dice.push(1);
  await Stakes.click(msgOf(lastCard()), btn("stakes-double"), null, actor);
  assert.equal(actor.system.stats.luck.value, 5);
  assert.equal(lastCard().flags[M].stakes.count, 1);
  assert.equal(Stakes.used(actor).doubleDown, true);

  const broke = makeActor({ name: "Broke", system: { stats: { luck: { value: 1, max: 7 } } } });
  await Stakes.result(broke, plotResult(2), { doubleDown: true });
  assert.equal(broke.system.stats.luck.value, 0);
  assert.equal(lastCard().flags[M].stakes.count, 2);
});

test("Opportunities and Complications that touch LUCK and Prone", async () => {
  const actor = makeActor({ name: "Spend", system: { stats: { luck: { value: 5, max: 6 } } } });
  await Stakes.opportunity(actor, "feelingLucky");
  assert.equal(actor.system.stats.luck.value, 6, "+2, never past the LUCK STAT");
  await Stakes.complication(actor, "feelingUnlucky");
  assert.equal(actor.system.stats.luck.value, 5);
  // Out of LUCK: the GM picks what goes wrong.
  await actor.update({ "system.stats.luck.value": 0 });
  const wait = Compat.DialogV2.wait;
  Compat.DialogV2.wait = async () => "prone";
  try {
    await Stakes.complication(actor, "feelingUnlucky");
  } finally {
    Compat.DialogV2.wait = wait;
  }
  await settle();
  assert.equal(Conditions.has("prone", actor), true);
});

test("Aid an Ally and Hinder an Ally ride the next Check", async () => {
  const ally = makeActor({ name: "Ally" });
  await Conditions.add("stakesAided", ally);
  await Conditions.add("stakesHindered", ally, { changes: [{ key: "bonuses.allActions", value: -3, situational: true, onByDefault: true }], name: "Hindered (-3)" });
  assert.deepEqual(Conditions.effects(ally, "stakesAided")[0].changes.map((c) => c.value), ["2"]);
  assert.equal(Conditions.effects(ally, "stakesHindered")[0].name, "Hindered (-3)");
  await Stakes.onChatMessage({ content: '<div class="rollcard">', speaker: { actor: ally.id } }, game.user.id);
  await settle();
  assert.deepEqual(Conditions.active(ally).map((c) => c.id), []);
});

test("a player asks for the Stakes (LUCK 5+): whispered to the GM with Raise / Not this time", async () => {
  const poor = makeActor({ name: "Poor", system: { stats: { luck: { value: 4, max: 4 } } } });
  await assert.rejects(Stakes.ask(poor, "please"), /5\+/);
  const actor = makeActor({ name: "Asker", system: { stats: { luck: { value: 5, max: 5 } } } });
  await Stakes.ask(actor, "It's my sister in there");
  const card = lastCard();
  assert.deepEqual(buttons(card), ["stakes-approve", "stakes-deny"]);
  assert.ok(card.whisper.includes("gm1"));
  await Stakes.click(msgOf(card), btn("stakes-approve", { reason: "It's my sister in there" }), null, actor);
  assert.deepEqual(buttons(lastCard()), ["stakes-roll"], "approving raises the Stakes");
});

test("/stakes opens the window; with words the GM raises for the current combatant", async () => {
  const actor = makeActor({ name: "Cmd", system: { stats: { luck: { value: 5, max: 5 } } } });
  const combat = makeCombat([actor]);
  game.combat = combat;
  assert.equal(Stakes.onChatCommand("hello"), true);
  const before = chat.length;
  assert.equal(Stakes.onChatCommand("/stakes Jump the gap"), false);
  await settle();
  assert.equal(chat.length, before + 1);
  assert.match(lastCard().content, /Jump the gap/);
  game.combat = null;
});

/* ---------------------------------------- */
/*  Combat Awareness                        */
/* ---------------------------------------- */

test("Combat Awareness: what points buy, steps and waste", () => {
  assert.equal(keyOf("Precision Attack"), "precisionAttack");
  assert.equal(abilityEffect("precisionAttack", 5), 1);
  assert.equal(abilityEffect("precisionAttack", 10), 3, "+3 at most");
  assert.equal(abilityEffect("damageDeflection", 7), 3);
  assert.equal(abilityEffect("fumbleRecovery", 3), false);
  assert.equal(abilityEffect("fumbleRecovery", 4), true);
  assert.equal(abilityEffect("initiativeReaction", 4), 4);
  const c = check({ precisionAttack: 4, initiativeReaction: 3 }, 6);
  assert.deepEqual([c.total, c.left, c.over, c.ok], [7, -1, true, false]);
  assert.deepEqual(c.wasted, [{ key: "precisionAttack", points: 1 }]);
  // Steppers move a step at a time and never past the Rank.
  let a = step({}, "precisionAttack", 1, 4);
  assert.equal(a.precisionAttack, 3);
  assert.equal(step(a, "precisionAttack", 1, 4).precisionAttack, 3, "a second step needs 3 more points");
  assert.equal(step({ precisionAttack: 5 }, "precisionAttack", -1, 6).precisionAttack, 3, "down to the step below");
  a = step(a, "initiativeReaction", 1, 4);
  assert.equal(step(a, "spotWeakness", 1, 4).spotWeakness, 0, "no points left");
  assert.equal(ABILITIES.length, 6);
});

test("reassigning is free before Initiative, an Action on the Solo's Turn, and waits otherwise", () => {
  assert.equal(assignMode({}), "free");
  assert.equal(assignMode({ inCombat: true, rolled: false }), "free", "before Initiative");
  assert.equal(assignMode({ inCombat: true, rolled: true, myTurn: true }), "action");
  assert.equal(assignMode({ inCombat: true, rolled: true, myTurn: false }), "wait");
  assert.equal(assignMode({ inCombat: true, rolled: true, myTurn: false, gm: true }), "gm");
});

const soloRole = (rank) => ({
  name: "Solo", type: "role",
  system: {
    mainRoleAbility: "Combat Awareness", rank,
    abilities: ABILITIES.map((ab, i) => ({ name: ab.name, rank: 0, bonusRatio: ab.ratio, index: i, universalBonuses: [] }))
  }
});

test("a Solo's points go on CPR's role item; in combat it's their Action, with a card", async () => {
  const solo = makeActor({ name: "Fury" }, [soloRole(6)]);
  const other = makeActor({ name: "Goon" });
  assert.equal(Awareness.isSolo(solo), true);
  assert.equal(Awareness.isSolo(other), false);
  assert.equal(Awareness.rank(solo), 6);

  // Outside combat: free.
  assert.equal(await Awareness.assign(solo, { initiativeReaction: 3, threatDetection: 3 }), "free");
  assert.deepEqual(Awareness.current(solo).initiativeReaction, 3);
  assert.equal(Awareness.role(solo).system.abilities.find((a) => a.name === "Threat Detection").rank, 3);
  assert.equal(Awareness.role(solo).system.abilities.find((a) => a.name === "Threat Detection").bonusRatio, 1, "the rest of the ability stays");
  await assert.rejects(Awareness.assign(solo, { spotWeakness: 7 }), /Rank is 6/);
  assert.equal(await Awareness.assign(solo, Awareness.current(solo)), null, "nothing changed, nothing posted");

  // In combat, not their Turn: a player waits; on their Turn it's the Action.
  const combat = makeCombat([other, solo]);
  game.combat = combat;
  asGM(false);
  await assert.rejects(Awareness.assign(solo, { precisionAttack: 6 }), /wait for their Turn/);
  combat.turn = 1;
  assert.equal(await Awareness.assign(solo, { precisionAttack: 6 }), "action");
  asGM(true);
  assert.equal(Awareness.spent(solo), true);
  assert.match(lastCard().content, /Precision Attack/);
  assert.match(lastCard().content, /\+2 to attacks/);
  assert.match(lastCard().content, /Action/);
  combat.round = 2;
  assert.equal(Awareness.spent(solo), false, "a new Round, a new Action");
  // The GM can adjust off-Turn.
  combat.turn = 0;
  assert.equal(await Awareness.assign(solo, { spotWeakness: 6 }), "gm");
  game.combat = null;
});

/* ---------------------------------------- */
/*  2070 conditions                         */
/* ---------------------------------------- */

test("Broken Leg costs Evasion too; Prone's Evasion and Grapple penalties are roll-dialog toggles", async () => {
  Settings.set("critItems", false);
  const actor = makeActor({ name: "Legs" });
  await Conditions.add("brokenLeg", actor);
  await settle();
  assert.deepEqual(Conditions.effects(actor, "brokenLeg")[0].changes.map((c) => [c.key, c.value]), [["system.stats.move.value", "-4"], ["bonuses.evasion", "-2"]], "without CPR's item it carries both");
  await Conditions.add("prone", actor);
  const prone = Conditions.effects(actor, "prone")[0];
  assert.deepEqual(prone.changes.map((c) => [c.key, c.value]), [["bonuses.evasion", "-4"], ["bonuses.brawling", "-4"]]);
  assert.deepEqual(prone.flags[SYS].changes.situational, { 0: { isSituational: true, onByDefault: true }, 1: { isSituational: true, onByDefault: false } });
  Settings.set("critItems", true);
});

test("Into the Wall is a Spinal Injury for one Round; System Reset is Unconscious and Prone for 20", async () => {
  Settings.set("critItems", false);
  const actor = makeActor({ name: "Wall" });
  await Conditions.add("intoTheWall", actor);
  await settle();
  assert.equal(Conditions.effects(actor, "spinalInjury")[0]?.duration.seconds, 3);
  const hacked = makeActor({ name: "Reset" });
  await Conditions.add("qhSystemReset", hacked);
  await settle();
  assert.equal(Conditions.effects(hacked, "unconscious")[0]?.duration.seconds, 60);
  assert.equal(Conditions.effects(hacked, "prone")[0]?.duration.seconds, 60);
  // Sleep's Prone still lasts as long as the sleep.
  const asleep = makeActor({ name: "Asleep" });
  await Conditions.add("sleep", asleep);
  await settle();
  assert.equal(Conditions.effects(asleep, "prone")[0]?.duration.seconds, 60);
  Settings.set("critItems", true);
});

test("Slow rolls its MOVE penalty when it lands", async () => {
  const actor = makeActor({ name: "Slowed" });
  dice.push(4);
  await Conditions.add("qhSlow", actor);
  const [effect] = Conditions.effects(actor, "qhSlow");
  assert.deepEqual(effect.changes.map((c) => [c.key, c.value]), [["system.stats.move.value", "-4"]]);
  assert.equal(effect.name, "Slow (-4)");
  assert.equal(effect.duration.seconds, 60);
});

test("quickhacks: PopUp-geddon is a sight penalty for 3 Rounds; Weapon Glitch -2 ranged", async () => {
  const actor = makeActor({ name: "Glitched" });
  await Conditions.add(["qhPopupGeddon", "qhWeaponGlitch"], actor);
  const pop = Conditions.effects(actor, "qhPopupGeddon")[0];
  assert.equal(pop.duration.seconds, 9);
  assert.ok(pop.changes.length > 0 && pop.changes.every((c) => c.value === "-2"));
  assert.deepEqual(Conditions.effects(actor, "qhWeaponGlitch")[0].changes.map((c) => [c.key, c.value]), [["bonuses.ranged", "-2"]]);
  assert.equal(Registry.all().filter((c) => c.category === "quickhack").length, 18);
});

test("Vitals Spoof shows calm vitals; Comms Jam blocks holocalls", async () => {
  const spoof = readout({ hp: -3, max: 40, wound: "mortallyWounded", deathSave: 2, conditions: ["qhVitalsSpoof", "unconscious"], implant: "Biomonitor" });
  assert.deepEqual([spoof.state, spoof.pct, spoof.deathSave, spoof.alerts.length, spoof.spoofed], ["stable", 100, null, 0, true]);
  const jammed = makeActor({ name: "Jammed", owners: ["pl1"] });
  await Conditions.add("qhCommsJam", jammed);
  await assert.rejects(Calls.place({ actorId: jammed.id }, [{ actorId: "x" }]), /jammed/);
});

test("book references: core pages, the 2070 rules, and both", () => {
  const L = (k, d) => (d ? `${k}:${d.page}` : k);
  assert.equal(pageLabel(187, L), "NEONCOMBAT.Card.Page:187");
  assert.equal(pageLabel("2070", L), "NEONCOMBAT.Card.Page2070");
  assert.equal(pageLabel("187 · 2070", L), "NEONCOMBAT.Card.Page:187 · NEONCOMBAT.Card.Page2070");
  assert.equal(pageLabel("NCW 5", L), "NCW 5");
});

test("the Plot Die and Combat Awareness windows render with every string", async () => {
  const actor = makeActor({ name: "Window", system: { stats: { luck: { value: 8, max: 8 } } } }, [soloRole(4)]);
  const { StakesApp } = await import("../scripts/stakes/stakes-app.js");
  const stakes = new StakesApp();
  stakes._actorId = actor.id;
  const sctx = await stakes._prepareContext();
  const shtml = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/stakes.hbs", sctx);
  assert.match(shtml, /Raise the Stakes/);
  assert.match(shtml, /Force Fate/);
  const { AwarenessApp } = await import("../scripts/awareness/awareness-app.js");
  const app = new AwarenessApp();
  app._actorId = actor.id;
  const actx = await app._prepareContext();
  assert.equal(actx.rank, 4);
  assert.equal(actx.rows.length, 6);
  const ahtml = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/awareness.hbs", actx);
  assert.match(ahtml, /Precision Attack/);
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});
