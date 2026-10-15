/** Neon Conditions: the built-in set, the registry, the engine and its hooks, and CLT support. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, settle, chat, notes, dice, worldSettings, asGM, missingKeys } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { CONDITIONS, BY_ID, CORE_STATUS_IDS } = await import("../scripts/conditions/data.js");
const { Registry, sightChanges } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { Triggers } = await import("../scripts/conditions/triggers.js");
const { CLT, fromClt } = await import("../scripts/conditions/clt.js");
const { needsRepair } = await import("../scripts/conditions/cpr-flags.js");

// Wire the document hooks as main.js does.
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Hooks.on("createItem", (i, o, u) => Conditions.onCreateItem(i, o, u));
Hooks.on("deleteItem", (i, o, u) => Conditions.onDeleteItem(i, o, u));
Registry.refresh();

const SYS = "cyberpunk-red-core";
const M = "cpr-neon-combat-manager";

test("the built-in set: unique ids, valid references, names for all", () => {
  const ids = CONDITIONS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CONDITIONS) {
    for (const id of [...(c.also ?? []), ...(c.suppressedBy ?? [])]) assert.ok(BY_ID[id], `${c.id} names ${id}`);
    if (c.secondary) assert.ok(BY_ID[c.secondary.adds]?.addiction, `${c.id} leads to an addiction`);
    assert.notEqual(Registry.get(c.id).name, `NEONCOMBAT.Condition.${c.id}.name`);
  }
  // Every Critical Injury in Cyberpunk RED's two tables.
  assert.equal(CONDITIONS.filter((c) => c.critical?.location === "body").length, 11);
  assert.equal(CONDITIONS.filter((c) => c.critical?.location === "head").length, 11);
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

test("the token HUD gets the Cyberpunk RED set; Foundry's generic statuses go, other modules' stay", () => {
  const ids = CONFIG.statusEffects.map((s) => s.id);
  assert.ok(ids.includes("brokenLeg") && ids.includes("onFireMild") && ids.includes("dead"));
  assert.ok(!ids.includes("bless"), "Foundry's fantasy statuses are replaced");
  assert.ok(ids.includes("neonhomeEncumbered"), "Neon At Home's statuses stay");
  assert.equal(ids.filter((i) => i === "dead").length, 1);
  // Every status that carries changes carries CPR's flags too, so one placed from the HUD is safe.
  for (const s of CONFIG.statusEffects.filter((x) => x.changes?.length)) assert.equal(needsRepair(s), false, s.id);
  assert.equal(CONFIG.statusEffects.find((s) => s.id === "wxHeavyRain").hud, false, "weather stays out of the HUD");
  assert.ok(CORE_STATUS_IDS.includes("bless"));
});

test("a sight penalty spreads over the configured keys as situational, ticked modifiers", async () => {
  assert.deepEqual(Registry.get("darkness").rawChanges.map((c) => c.key), ["bonuses.perceptionSight", "bonuses.ranged", "bonuses.melee"]);
  await Settings.set("sightKeys", "perceptionSight, ranged");
  Registry.refresh();
  assert.deepEqual(Registry.get("darkness").rawChanges.map((c) => [c.key, c.value, c.situational, c.onByDefault]), [["bonuses.perceptionSight", -4, true, true], ["bonuses.ranged", -4, true, true]]);
  assert.deepEqual(sightChanges(0), []);
});

test("conditions are found by id, shown name, system name or loosely", () => {
  assert.equal(Registry.get("brokenLeg").id, "brokenLeg");
  assert.equal(Registry.get("Broken Leg").id, "brokenLeg");
  assert.equal(Registry.get("foreign object (h)").id, "foreignObjectHead");
  assert.equal(Registry.get("On Fire (Mild)").id, "onFireMild");
  assert.equal(Registry.get("nonsense"), null);
});

test("adding a condition makes a well-formed effect; removing takes it off", async () => {
  const actor = makeActor({ name: "Rogue" });
  const [effect] = await Conditions.add("grappled", actor);
  assert.equal(effect.name, "Grappled");
  assert.deepEqual([...effect.statuses], ["grappled"]);
  assert.equal(effect.getFlag(M, "condition"), "grappled");
  assert.deepEqual(effect.changes, [{ key: "bonuses.allActions", mode: 2, value: "-2", priority: null }]);
  assert.deepEqual(effect.flags[SYS].changes.cats, { 0: "misc" });
  assert.equal(Conditions.has("Grappled", actor), true);
  // a second add doesn't duplicate
  await Conditions.add("grappled", actor);
  assert.equal(Conditions.effects(actor, "grappled").length, 1);
  await Conditions.remove("grappled", actor);
  assert.equal(Conditions.has("grappled", actor), false);
});

test("a group holds one at a time: a stronger fire replaces a milder one", async () => {
  const actor = makeActor({ name: "Torch" });
  await Conditions.add("onFireMild", actor);
  await Conditions.add("onFireDeadly", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["onFireDeadly"]);
});

test("gear makes a character immune (Anti-Dazzle and flashbangs)", async () => {
  const shades = makeActor({ name: "Shades" }, [{ name: "Anti-Dazzle", type: "cyberware", system: { isInstalled: true } }]);
  const [none] = await Conditions.add("flashbanged", shades);
  assert.equal(none, undefined);
  assert.equal(Conditions.has("flashbanged", shades), false);
  assert.ok(notes.some(([, m]) => m.includes("protected")));
  // the same through the token HUD (a raw effect from the status entry)
  const status = CONFIG.statusEffects.find((s) => s.id === "flashbanged");
  const made = await shades.createEmbeddedDocuments("ActiveEffect", [{ ...status, statuses: ["flashbanged"] }]);
  assert.equal(made.length, 0);
});

test("timed conditions start their clock and end when world time passes them", async () => {
  const actor = makeActor({ name: "Teary" });
  game.time.worldTime = 1000;
  const [effect] = await Conditions.add("teargassed", actor);
  assert.deepEqual(effect.duration, { seconds: 60, startTime: 1000 });
  game.time.worldTime = 1057;
  await Conditions.expire();
  assert.equal(Conditions.has("teargassed", actor), true, "19 Rounds in, still crying");
  game.time.worldTime = 1060;
  await Conditions.expire();
  assert.equal(Conditions.has("teargassed", actor), false);
});

test("a drug wearing off asks for the Secondary Effect roll; its addiction is off while it runs", async () => {
  const actor = makeActor({ name: "Lacer" });
  game.time.worldTime = 0;
  chat.length = 0;
  await Conditions.add("blackLaceAddiction", actor);
  assert.equal(Conditions.effects(actor, "blackLaceAddiction")[0].changes.length, 1);
  await Conditions.add("blackLace", actor);
  await settle();
  const addiction = Conditions.effects(actor, "blackLaceAddiction")[0];
  assert.equal(addiction.changes.length, 0, "REF penalty off under the Primary Effect");
  assert.equal(addiction.getFlag(M, "suppressed").length, 1);
  game.time.worldTime = 86400;
  await Conditions.expire();
  await settle();
  assert.equal(Conditions.effects(actor, "blackLaceAddiction")[0].changes[0].key, "system.stats.ref.value", "and back on after");
  assert.ok(chat.some((m) => m.content.includes("DV17")), "Resist Torture/Drugs card");
});

test("Rapidetox purges drugs but not addictions; Speedheal heals BODY + WILL", async () => {
  const actor = makeActor({ name: "Clean", system: { derivedStats: { hp: { value: 20, max: 40 } } } });
  await Conditions.add(["synthcoke", "smash", "smashAddiction"], actor);
  await Conditions.add("rapidetox", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id).sort(), ["rapidetox", "smashAddiction"]);
  await Conditions.add("speedheal", actor);
  await settle();
  assert.equal(actor.system.derivedStats.hp.value, 31, "6 BODY + 5 WILL");
});

test("Stabilizing a Mortally Wounded character: 1 HP, Unconscious for a minute, penalty reset", async () => {
  const actor = makeActor({ name: "Bleeder", system: { derivedStats: { hp: { value: -3, max: 40 }, deathSave: { penalty: 3, basePenalty: 1 } } } });
  await Conditions.add("stabilized", actor);
  await settle();
  assert.equal(actor.system.derivedStats.hp.value, 1);
  assert.equal(actor.system.derivedStats.deathSave.penalty, 1);
  assert.equal(Conditions.effects(actor, "unconscious")[0].duration.seconds, 60);
});

test("Critical Injury conditions add CPR's own item; the item and the marker go together", async () => {
  const brokenLeg = { _id: "yBy9rlhgZeaWGtHh", name: "Broken Leg", type: "criticalInjury", system: { location: "body" } };
  game.packs.set("cyberpunk-red-core.core_critical-injuries-body", {
    getIndex: async () => [{ _id: brokenLeg._id, name: brokenLeg.name }],
    getDocument: async () => ({ toObject: () => structuredClone(brokenLeg) })
  });
  const actor = makeActor({ name: "Limp" });
  await Conditions.add("brokenLeg", actor);
  await settle();
  const item = actor.items.find((i) => i.type === "criticalInjury");
  assert.equal(item?.name, "Broken Leg");
  const marker = Conditions.effects(actor, "brokenLeg")[0];
  assert.deepEqual(marker.changes, [], "CPR's item carries the -4 MOVE; the marker carries nothing");
  assert.equal(marker.getFlag(M, "item"), item.id);
  await Conditions.remove("brokenLeg", actor);
  await settle();
  assert.equal(actor.items.size, 0, "removing the condition removes the item");

  // An item from CPR's own Critical Injury roll shows on the token, and leaves with it.
  const [rolled] = await actor.createEmbeddedDocuments("Item", [structuredClone(brokenLeg)]);
  await settle();
  assert.equal(Conditions.effects(actor, "brokenLeg")[0]?.getFlag(M, "item"), rolled.id);
  await actor.deleteEmbeddedDocuments("Item", [rolled.id]);
  await settle();
  assert.equal(Conditions.has("brokenLeg", actor), false);
});

test("Wound States follow CPR's own as HP changes", async () => {
  const actor = makeActor({ name: "Hurt" });
  await actor.update({ "system.derivedStats.hp.value": 30 });
  await Triggers.syncWound(actor);
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["lightlyWounded"]);
  await actor.update({ "system.derivedStats.hp.value": 0 });
  await Triggers.syncWound(actor);
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["mortallyWounded"]);
  assert.deepEqual(Conditions.effects(actor, "mortallyWounded")[0].changes, [], "CPR applies the -4 itself");
  await actor.update({ "system.derivedStats.hp.value": 40 });
  await Triggers.syncWound(actor);
  assert.deepEqual(Conditions.active(actor), []);
});

test("triggers add a condition when the test passes and undo it when it stops", async () => {
  const actor = makeActor({ name: "Lucky" });
  await Settings.set("triggers", [{ id: "t1", path: "system.stats.luck.value", op: "lte", value: "0", condition: "extremeStress", action: "add", revert: true, types: ["character"] }]);
  await actor.update({ "system.stats.luck.value": 0 });
  await Triggers.evaluate(actor);
  assert.equal(Conditions.has("extremeStress", actor), true);
  await actor.update({ "system.stats.luck.value": 3 });
  await Triggers.evaluate(actor);
  assert.equal(Conditions.has("extremeStress", actor), false);
  await Settings.set("triggers", []);
});

test("an override from the Condition Lab changes the condition everywhere", async () => {
  await Settings.set("conditionOverrides", { tornMuscle: { changes: [{ key: "bonuses.melee", value: -3 }], name: "Shredded" } });
  Registry.refresh();
  assert.equal(Registry.get("tornMuscle").name, "Shredded");
  assert.equal(CONFIG.statusEffects.find((s) => s.id === "tornMuscle").changes[0].value, "-3");
  await Settings.set("conditionOverrides", { tornMuscle: { disabled: true } });
  Registry.refresh();
  assert.equal(CONFIG.statusEffects.some((s) => s.id === "tornMuscle"), false);
  await Settings.set("conditionOverrides", {});
  Registry.refresh();
});

test("game.clt stand-in: CLT-style calls work on Neon Conditions", async () => {
  delete game.clt;
  CLT.install();
  assert.equal(game.clt.neon, M);
  const actor = makeActor({ name: "Macro" });
  await game.clt.addCondition("Prone", actor);
  assert.equal(game.clt.hasCondition("Prone", actor), true);
  assert.equal(game.clt.getCondition("Prone").id, "prone");
  assert.deepEqual(game.clt.getConditions(actor).map((c) => c.name), ["Prone"]);
  await game.clt.toggleCondition("Prone", actor);
  assert.equal(game.clt.hasCondition("Prone", actor), false);
});

test("Condition Lab & Triggler's Cyberpunk RED map imports, typos and all; its effects move over", async () => {
  const map = [
    { id: "rlwo5d6rzwl5rnup", name: "Brain Injury" },
    { id: "bbjmpwk9nkloxo1i", name: "Aspyhixiating" },
    { id: "r4kadyvk4trrgh8p", name: "Unconcious" },
    { id: "ed97q4btoj3ggpip", name: "Smash Addicition" },
    { id: "rd2fh4knrle6g0jb", name: "Foreign Object (Body)" },
    { id: "dx5p60wq8zh7owm1", name: "Quick Fix", icon: "systems/cyberpunk-red-core/icons/compendium/status/quickfix.svg" },
    { id: "zzz", name: "Doused", activeEffect: { changes: [{ key: "bonuses.stealth", value: "-1", mode: 2 }] } }
  ];
  const { matches, custom } = fromClt(map);
  assert.equal(matches.rlwo5d6rzwl5rnup, "brainInjury");
  assert.equal(matches.bbjmpwk9nkloxo1i, "asphyxiating");
  assert.equal(matches.r4kadyvk4trrgh8p, "unconscious");
  assert.equal(matches.ed97q4btoj3ggpip, "smashAddiction");
  assert.equal(matches.rd2fh4knrle6g0jb, "foreignObject");
  assert.deepEqual(custom.map((c) => c.name), ["Quick Fix", "Doused"]);

  // The world still has CLT's saved map though the module is off.
  worldSettings.set("clt", { key: "condition-lab-triggler.activeConditionMap", value: JSON.stringify(map) });
  const actor = makeActor({ name: "Old" });
  actor.effects.set("old1", { _id: "old1", id: "old1", name: "Unconcious", changes: [], statuses: new Set(["r4kadyvk4trrgh8p"]), flags: { "condition-lab-triggler": { conditionId: "r4kadyvk4trrgh8p" } },
    async update(u) {
      for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v);
    },
    getFlag(s, k) {
      return this.flags?.[s]?.[k];
    } });
  asGM(true);
  const result = await CLT.migrate();
  assert.equal(result.added, 2);
  assert.equal(result.effects, 1);
  assert.equal(Conditions.has("unconscious", actor), true, "the old CLT effect now counts as Unconscious");
  assert.ok(Registry.get("Doused"), "a custom condition now");
  assert.equal(Settings.get("migratedClt"), true);
});

test("effects other modules make with changes get CPR's bookkeeping, so the sheet keeps opening", async () => {
  const actor = makeActor({ name: "Modded" });
  const [e] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Someone's buff", changes: [{ key: "bonuses.stealth", value: "1", mode: 2 }] }]);
  assert.deepEqual(e.flags[SYS].changes.cats, { 0: "skill" });
  assert.deepEqual(e.flags[SYS].changes.situational, { 0: { isSituational: false, onByDefault: false } });
});

test("formulas: stats, sums and dice", () => {
  const actor = makeActor({ name: "Calc" });
  assert.equal(Conditions.formula("@body", actor).total, 6);
  assert.equal(Conditions.formula("@body+@will", actor).total, 11);
  assert.equal(Conditions.formula("2", actor).total, 2);
  dice.push(6, 6, 1, 1, 1, 1);
  assert.equal(Conditions.formula("6d6", actor).total, 16);
});
