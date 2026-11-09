/** The 2070 roller and table rules: Chain Reactions, Riding the Edge, the Plot Die in the roller, Flash of Luck, Tarot Criticals, the Awareness Ladder, and the conditions the book changed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, makeCombat, registerSettings, settle, chat, dice, asGM, testUsers, missingKeys } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const R = await import("../scripts/roller/rules.js");
const { Bridge } = await import("../scripts/roller/bridge.js");
const { Roller } = await import("../scripts/roller/roller.js");
const { Tarot } = await import("../scripts/roller/tarot.js");
const { Ladder } = await import("../scripts/roller/ladder.js");
const { Stakes } = await import("../scripts/stakes/stakes.js");
const { Compat } = await import("../scripts/compat.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Registry.refresh();
Stakes.registerSocket();

const M = "cpr-neon-combat-manager";
const { player } = testUsers;
const pc = (name, luck = 8) => makeActor({ name, owners: [player.id], hasPlayerOwner: true, system: { stats: { luck: { value: luck, max: luck } } } });
const msgOf = (m) => ({ ...m, isOwner: true, flags: m.flags ?? {}, async setFlag(s, k, v) {
  this.flags[s] ??= {};
  this.flags[s][k] = v;
}, async update() {} });

/* ---------------------------------------- */
/*  Rules                                   */
/* ---------------------------------------- */

test("Chain Reactions: a second 10 (or 1) chains, and each repeat is a link", async () => {
  const seq = (...n) => () => n.shift();
  assert.equal(await R.chainFrom("explode", 7, seq()), null, "no chain without a second 10");
  assert.deepEqual(await R.chainFrom("explode", 10, seq(4)), { kind: "explode", links: 1, dice: [4] });
  assert.deepEqual(await R.chainFrom("explode", 10, seq(10, 10, 3)), { kind: "explode", links: 3, dice: [10, 10, 3] });
  assert.deepEqual(await R.chainFrom("implode", 1, seq(1, 6)), { kind: "implode", links: 2, dice: [1, 6] });
  assert.equal(await R.chainFrom("implode", 10, seq(1)), null, "implosions only chain on 1s");
});

test("Chain payouts follow the table, attack or Check", () => {
  const c = (kind, links) => ({ kind, links });
  assert.deepEqual(R.chainPayout(c("explode", 1), { attack: true }), { opportunities: 0, complications: 0, damageDice: 1, autoCrit: false, malfunction: false, condition: false });
  assert.deepEqual([R.chainPayout(c("explode", 2), { attack: true }).damageDice, R.chainPayout(c("explode", 2), { attack: true }).autoCrit], [1, true]);
  assert.equal(R.chainPayout(c("explode", 4), { attack: true }).damageDice, 3, "+1d6 per link past 2");
  assert.equal(R.chainPayout(c("explode", 3)).opportunities, 3);
  assert.deepEqual(R.chainPayout(c("implode", 2), { attack: true }), { opportunities: 0, complications: 1, damageDice: 0, autoCrit: false, malfunction: true, condition: false });
  assert.equal(R.chainPayout(c("implode", 3), { attack: true }).condition, true);
  assert.deepEqual([R.chainPayout(c("implode", 2)).complications, R.chainPayout(c("implode", 3)).malfunction], [2, true]);
});

test("Riding the Edge: Second Chance (not on a natural 1) and Close Call (a natural 1 that imploded)", () => {
  assert.deepEqual(R.edgeOptions({ initial: 6 }, 3), { secondChance: true, closeCall: false });
  assert.deepEqual(R.edgeOptions({ initial: 1, critFail: true }, 3), { secondChance: false, closeCall: true });
  assert.deepEqual(R.edgeOptions({ initial: 1, critFail: true }, 2), { secondChance: false, closeCall: false }, "Close Call costs 3");
  assert.deepEqual(R.edgeOptions({ initial: 6, used: true }, 5), { secondChance: false, closeCall: false }, "one way per roll");
});

test("Flash of Luck: costs and limits; the Awareness Ladder's DVs and steps", () => {
  assert.equal(R.flashBlocked("simple", 2, {}), null);
  assert.equal(R.flashBlocked("improbable", 7, {}), "luck");
  assert.equal(R.flashBlocked("simple", 9, { beat: 1 }), "beat");
  assert.equal(R.flashBlocked("simple", 9, { mission: 3 }), "mission");
  assert.equal(R.ladderDV("unaware", { awake: 3, asleep: 3 }), 14, "sleepers count half, rounded down");
  assert.equal(R.ladderDV("suspicious", { awake: 3 }), 14);
  assert.equal(R.ladderDV("searching", { awake: 3 }), null, "a Perception roll");
  assert.equal(R.ladderStep("unaware", 1), "suspicious");
  assert.equal(R.ladderStep("spotted", 1), "spotted");
  assert.equal(R.ladderStep("unaware", -1), "unaware");
});

test("the Tarot deck: one card a session, to the bottom once drawn, no reshuffle until all 22 are seen", () => {
  assert.equal(R.ARCANA.length, 22);
  assert.equal(R.drawsTarot([6, 6, 6, 2]), true);
  assert.equal(R.drawsTarot([6, 6, 2]), false);
  assert.equal(R.drawsTarot([6, 6, 6], { area: true }), false);
  let rand = 0;
  const first = R.draw({}, 1, { rand: () => (rand = (rand + 0.37) % 1) });
  assert.ok(first.card);
  assert.equal(first.deck.seen, 1);
  assert.equal(first.deck.order.at(-1), first.card.id, "to the bottom");
  assert.deepEqual(R.draw(first.deck, 1), { blocked: "session" });
  const second = R.draw(first.deck, 2);
  assert.notEqual(second.card.id, first.card.id);
  const full = R.draw({ order: first.deck.order, seen: 22, session: 3 }, 4, { rand: () => 0.5 });
  assert.equal(full.deck.seen, 1, "everything seen: a fresh shuffle");
});

/* ---------------------------------------- */
/*  The roller, on a stand-in of CPR's      */
/* ---------------------------------------- */

class FakeRoll {
  constructor(title = "Handgun") {
    this.rollTitle = title;
    this.die = "d10";
    this.mods = [];
    this.additionalMods = [];
    this.luck = 0;
    this.calculateCritical = true;
    this.criticalRoll = 0;
    this.base = 12;
  }
  addMod(list) {
    for (const m of list) if (!this.mods.some((x) => x.id && x.id === m.id)) this.mods.push(m);
  }
  totalMods() {
    return this.mods.reduce((s, m) => s + m.value, 0);
  }
  wasCritFail() {
    return this.initialRoll === 1;
  }
  wasCritSuccess() {
    return this.initialRoll === 10;
  }
  async roll() {
    this.initialRoll = dice.shift();
    this.faces = [this.initialRoll];
    if (this.wasCritFail() || this.wasCritSuccess()) this.criticalRoll = dice.shift();
    this.resultTotal = this.initialRoll + this.base + this.totalMods() + (this.wasCritFail() ? -this.criticalRoll : this.criticalRoll);
  }
}
class FakeSkillRoll extends FakeRoll {}
class FakeDamageRoll extends FakeRoll {}
Bridge.rolls = { CPRRoll: FakeRoll, CPRSkillRoll: FakeSkillRoll, CPRDamageRoll: FakeDamageRoll };
Bridge.chat = { RenderRollCard: async () => null };
Roller.patch();
Roller.active = true;

test("the Plot Die and Push the Limit go onto the roll; Push costs 2 LUCK", async () => {
  const vee = pc("Velvet", 6);
  const roll = new FakeSkillRoll("Persuasion");
  roll[M] = { actorId: vee.id, stakesBonus: 4, push: 6 };
  dice.push(5);
  await roll.roll();
  assert.deepEqual(roll.mods.map((m) => m.value), [4, 6]);
  assert.equal(roll.resultTotal, 5 + 12 + 10);
  assert.equal(vee.system.stats.luck.value, 4);
  const s = Roller.summary(roll);
  assert.equal(s.kind, "skill");
  assert.equal(s.flat, 22, "everything but the dice");
  assert.equal(s.push, true);
});

test("an explosion that rolls another 10 chains: the summary carries it and its card pays out", async () => {
  const vee = pc("Velvet");
  const roll = new FakeSkillRoll("Library Search");
  roll[M] = { actorId: vee.id };
  dice.push(10, 10, 10, 4);
  await roll.roll();
  assert.equal(roll.resultTotal, 10 + 12 + 10, "chain dice don't count");
  const s = Roller.summary(roll);
  assert.deepEqual(s.chain, { kind: "explode", links: 2, dice: [10, 4] });
  assert.equal(s.critSuccess, true);
  roll.entityData = { actor: vee.id, tokens: [] };
  // The card's message gets the summary; its creation posts the chain card.
  const msg = { content: '<div class="rollcard">', flags: {}, updateSource(u) { msg.flags = { [M]: { roll: u[`flags.${M}.roll`] } }; } };
  Roller.pending = roll;
  Roller.onPreCreate(msg, game.user.id);
  assert.equal(msg.flags[M].roll.chain.links, 2);
  const before = chat.length;
  await Roller.onCreate(msg, game.user.id);
  assert.equal(chat.length, before + 1);
  assert.match(chat.at(-1).content, /explosion chain, 2 link/);
  assert.match(chat.at(-1).content, /2 Opportunity/);
  assert.match(chat.at(-1).content, /data-ncm-action="roller-opps"/);
});

test("Second Chance rerolls with the same modifiers for 1 LUCK; Close Call undoes an implosion for 3", async () => {
  const vee = pc("Velvet", 5);
  const msg = msgOf({ flags: { [M]: { roll: { kind: "skill", title: "Stealth", initial: 3, crit: 0, critFail: false, critSuccess: false, total: 15, flat: 12, actorId: vee.id, push: false } } } });
  dice.push(7);
  const total = await Roller.secondChance(msg, vee, msg.flags[M].roll);
  assert.equal(total, 19);
  assert.equal(vee.system.stats.luck.value, 4);
  assert.equal(msg.flags[M].edge, "secondChance");
  await assert.rejects(Roller.secondChance(msg, vee, msg.flags[M].roll), /not on/i, "once a roll");
  const one = msgOf({ flags: { [M]: { roll: { kind: "skill", title: "Stealth", initial: 1, crit: 6, critFail: true, total: 7, flat: 12, actorId: vee.id } } } });
  await assert.rejects(Roller.secondChance(one, vee, one.flags[M].roll), /not on/i, "no Second Chance on a natural 1");
  assert.equal(await Roller.closeCall(one, vee, one.flags[M].roll), 13);
  assert.equal(vee.system.stats.luck.value, 1);
  assert.match(chat.at(-1).content, /Close Call → 13/);
});

test("the roll dialog's Plot Die: the bonus lands on the roll, no one-Check condition; a waiting Raise is used up", async () => {
  asGM(true);
  const vee = pc("Velvet", 8);
  await Stakes.raise(vee);
  const raised = chat.at(-1);
  const m = msgOf(raised);
  game.messages.contents.push?.(m);
  assert.ok(Stakes.pendingRaise(vee), "the Raise waits on Velvet's roll");
  const n = { actorId: vee.id };
  const app = { rollData: { rollTitle: "Shoulder Arms" }, element: null };
  dice.push(2);
  asGM(false);
  await Roller._barAction(app, vee, n, "plot");
  asGM(true);
  assert.deepEqual([n.plot.kind, n.stakesBonus], ["complication", 4]);
  assert.equal(Conditions.has("stakesBonus", vee), false, "on the roll itself");
  assert.match(chat.at(-1).content, /on the roll being made now/);
});

/* ---------------------------------------- */
/*  Flash of Luck, Tarot, the Ladder        */
/* ---------------------------------------- */

test("Flash of Luck: the GM approves (LUCK spent, counted) or vetoes; New beat and New mission reset", async () => {
  asGM(true);
  const vee = pc("Velvet", 8);
  await Stakes.flash(vee, "unlikely", "The guard's in my poker game.");
  const card = msgOf(chat.at(-1));
  assert.match(card.content, /poker game/);
  await Stakes.click(card, { dataset: { ncmAction: "stakes-flash-ok", type: "unlikely" } }, null, vee);
  assert.equal(vee.system.stats.luck.value, 4);
  assert.deepEqual(Stakes.flashUsed(vee), { beat: 1, mission: 1 });
  await assert.rejects(Stakes.flash(vee, "simple"), /a Beat/);
  await Stakes.newBeat();
  assert.deepEqual(Stakes.flashUsed(vee), { beat: 0, mission: 1 });
  await Stakes.newBeat({ mission: true });
  assert.deepEqual(Stakes.flashUsed(vee), { beat: 0, mission: 0 });
});

test("Tarot Criticals: the GM draws once a session (or confirms another), and applies the card to the victim", async () => {
  asGM(true);
  await Settings.set("tarotDeck", {});
  const victim = makeActor({ name: "Ganger", hasPlayerOwner: false });
  const before = chat.length;
  await Tarot.draw(victim.uuid);
  assert.equal(chat.length, before + 1);
  assert.match(chat.at(-1).content, /Tarot Critical/);
  assert.equal(Settings.get("tarotDeck").seen, 1);
  assert.equal(Tarot.status().drawn, true);
  await Tarot.draw(victim.uuid);
  assert.equal(Settings.get("tarotDeck").seen, 2, "confirmed: another this session");
  Settings.set("critItems", false);
  await Tarot.apply(victim.uuid, ["prone", "spinalInjury", "whiplash"]);
  assert.deepEqual(Conditions.active(victim).map((c) => c.id).sort(), ["prone", "spinalInjury", "whiplash"]);
  Settings.set("critItems", true);
});

test("the Awareness Ladder: DV from the encounter's enemies, steps, and Alert for something obvious", async () => {
  asGM(true);
  const vee = pc("Velvet");
  const g1 = makeActor({ name: "Guard 1", hasPlayerOwner: false });
  const g2 = makeActor({ name: "Guard 2", hasPlayerOwner: false });
  const g3 = makeActor({ name: "Guard 3", hasPlayerOwner: false });
  await Conditions.add("sleep", g3);
  const combat = makeCombat([vee, g1, g2, g3], { round: 0 });
  assert.deepEqual(Ladder.counts(combat), { awake: 2, asleep: 1 });
  let ctx = Ladder.context(combat);
  assert.deepEqual([ctx.level, ctx.dv], ["unaware", 12]);
  await Ladder.step(combat, 1);
  assert.equal(Ladder.context(combat).dv, 13);
  await Ladder.step(combat, 1);
  ctx = Ladder.context(combat);
  assert.deepEqual([ctx.level, ctx.dv], ["searching", null]);
  await Ladder.step(combat, -1);
  await Ladder.obvious(combat);
  assert.equal(Ladder.level(combat), "alert");
});

/* ---------------------------------------- */
/*  Conditions the 2070 book changed        */
/* ---------------------------------------- */

test("Already On Fire: a fire that wouldn't raise the stage pushes it up one; Deadly stays Deadly", async () => {
  asGM(true);
  const actor = makeActor({ name: "Torch" });
  await Conditions.add("onFireMild", actor);
  await settle();
  await Conditions.add("onFireMild", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["onFireStrong"]);
  await Conditions.add("onFireDeadly", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["onFireDeadly"], "a stronger fire takes over");
  await Conditions.add("onFireStrong", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["onFireDeadly"]);
  Settings.set("fireEscalates", false);
  const cold = makeActor({ name: "Cold" });
  await Conditions.add("onFireMild", cold);
  await Conditions.add("onFireMild", cold);
  assert.deepEqual(Conditions.active(cold).map((c) => c.id), ["onFireMild"]);
  Settings.set("fireEscalates", true);
});

test("damage wakes the unconscious, not the drugged; a flashbang is a Damaged Eye and Ear for a minute", async () => {
  asGM(true);
  Settings.set("critItems", false);
  const out = makeActor({ name: "Out" });
  await Conditions.add("qhSystemReset", out);
  await settle();
  assert.ok(Conditions.has("unconscious", out));
  await Conditions.onDamaged(out);
  await settle();
  assert.equal(Conditions.has("unconscious", out), false);
  assert.equal(Conditions.has("qhSystemReset", out), false, "System Reset ends on a hit too");
  const drugged = makeActor({ name: "Drugged" });
  await Conditions.add("sleep", drugged);
  await Conditions.add("unconscious", drugged);
  await Conditions.onDamaged(drugged);
  assert.equal(Conditions.has("unconscious", drugged), true);
  const flashed = makeActor({ name: "Flashed" });
  await Conditions.add("flashbanged", flashed);
  await settle();
  assert.equal(Conditions.effects(flashed, "damagedEye")[0]?.duration.seconds, 60);
  assert.equal(Conditions.effects(flashed, "damagedEar")[0]?.duration.seconds, 60);
  Settings.set("critItems", true);
});

test("the new strings are all there", async () => {
  await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/stakes.hbs", { gm: true, actor: { name: "V" }, actors: [], luck: { value: 3, max: 8 }, opts: {}, used: {}, needs: {}, faces: [], opportunities: [], complications: [],
    flash: { used: { beat: 0, mission: 1 }, limits: { beat: 1, mission: 3 }, types: [{ id: "simple", luck: 2, spend: 100, label: "Simple", ok: true }] }, tarot: { seen: 3, total: 22, drawn: true } });
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});
