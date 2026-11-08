/** Neon Conditions as Active Effects: Cyberpunk RED's keys, what each says on the sheet, and clean removal. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, settle } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { CONDITIONS } = await import("../scripts/conditions/data.js");
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions, effectChanges } = await import("../scripts/conditions/engine.js");
const { describe, changeText, behaviour } = await import("../scripts/conditions/describe.js");
const { SheetNotes } = await import("../scripts/conditions/sheet.js");
const { summary } = await import("../scripts/conditions/lab-app.js");
const { SLICK_SKILLS } = await import("../scripts/environment/weather-data.js");

Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Hooks.on("createItem", (i, o, u) => Conditions.onCreateItem(i, o, u));
Hooks.on("deleteItem", (i, o, u) => Conditions.onDeleteItem(i, o, u));
Registry.refresh();

const M = "cpr-neon-combat-manager";

/** Cyberpunk RED 0.92.4's CPR.activeEffectKeys (system/config.js): every key its effects can change. */
const CPR_BONUSES = new Set(`hands initiative maxHumanity maxHp deathSavePenalty universalAttack universalDamage
  universalDamageReduction aimedShot singleShot melee ranged autofire suppressive run walk attack defense brainDamageReduction
  perception_net rez speed backdoor cloak control eyedee pathfinder scanner slide virus zap teamwork operator backup credibility
  medicalTechCryosystemOperation medicalTechPharmaceuticals medicalTechSkill medicine surgery surgerySkill interface moto
  charismaticImpact combatAwareness damageDeflection fumbleRecovery initiativeReaction precisionAttack spotWeakness
  threatDetection fabricationExpertise fieldExpertise inventionExpertise maker upgradeExpertise accounting acting airVehicleTech
  animalHandling archery athletics basicTech brawling bribery bureaucracy business composition concealOrRevealObject
  concentration contortionist conversation criminology cryptography cybertech dance deduction demolitions driveLandVehicle
  education electronicsAndSecurityTech endurance evasion firstAid forgery gamble handgun heavyWeapons humanPerception
  interrogation landVehicleTech language librarySearch lipReading localExpert meleeWeapon paintOrDrawOrSculpt paramedic
  perception perceptionHearing perceptionSight personalGrooming persuasion photographyAndFilm pickLock pickPocket
  pilotAirVehicle pilotSeaVehicle resistTortureOrDrugs riding seaVehicleTech shoulderArms stealth streetWise tactics tracking
  trading wardrobeAndStyle weaponstech wildernessSurvival allActions allActionsHands allActionsSpeech hasPainSuppression`.split(/\s+/));
const CPR_STATS = new Set(["int", "ref", "dex", "tech", "cool", "will", "move", "body"].map((s) => `system.stats.${s}.value`));
const valid = (key) => CPR_STATS.has(key) || (key.startsWith("bonuses.") && CPR_BONUSES.has(key.slice(8)));

/** Foundry's order: every change of every effect by priority (mode × 10 when unset), then applied. */
function applied(actor, key, base) {
  const all = actor.effects.contents.flatMap((e) => e.changes).filter((c) => c.key === key);
  all.sort((a, b) => (a.priority ?? a.mode * 10) - (b.priority ?? b.mode * 10));
  return all.reduce((v, c) => (c.mode === 2 ? v + Number(c.value) : c.mode === 4 ? Math.max(v, Number(c.value)) : v), base);
}

test("every condition changes Cyberpunk RED's own STAT and skill keys", () => {
  for (const c of Registry.all()) {
    for (const ch of [...c.rawChanges, ...c.extraChanges]) assert.ok(valid(ch.key), `${c.id}: ${ch.key}`);
  }
  for (const s of SLICK_SKILLS) assert.ok(valid(`bonuses.${s}`), `weather: ${s}`);
});

test("no double-counting: Cyberpunk RED's own penalties stay out of the effects", () => {
  // CPR takes the Wound State's -2/-4 off rolls itself.
  for (const id of ["lightlyWounded", "seriouslyWounded", "mortallyWounded"]) {
    assert.ok(!Registry.get(id).rawChanges.some((ch) => ch.key.startsWith("bonuses.")), id);
  }
  // The Plot Die's bonus goes on the roll through the roller, not an effect.
  assert.deepEqual(Registry.get("stakesBonus").rawChanges, []);
  // A Critical Injury marker beside CPR's item never repeats the item's Death Save increase.
  for (const c of CONDITIONS.filter((x) => x.critical)) {
    assert.ok(!Registry.get(c.id).extraChanges.some((ch) => ch.key === "bonuses.deathSavePenalty"), c.id);
  }
});

test("MOVE penalties stop at 1, after every other change", async () => {
  const actor = makeActor({ name: "Crawler" });
  await Conditions.add("mortallyWounded", actor);
  await settle();
  assert.equal(applied(actor, "system.stats.move.value", 4), 1, "4 - 6 stops at 1");
  assert.equal(applied(actor, "system.stats.move.value", 8), 2, "8 - 6 is 2");
  assert.equal(changeText({ key: "system.stats.move.value", value: 1, mode: 4 }), "MOVE minimum 1");
  assert.match(summary(Registry.get("mortallyWounded")), /-6 MOVE · MOVE minimum 1/);
  // A quickhack has no floor: at MOVE 0 there's no Move Action.
  assert.ok(!Registry.get("qhImpairMovement").rawChanges.some((ch) => ch.mode === 4));
  await Conditions.remove("mortallyWounded", actor);
  assert.equal(applied(actor, "system.stats.move.value", 4), 4, "removing it gives the MOVE back");
});

test("each effect describes itself: what it does, what's automated, the page", async () => {
  for (const c of Registry.all()) {
    const d = Registry.effectData(c).description;
    assert.match(d, /Neon Conditions/, c.id);
    assert.equal(/Automated:/.test(d), c.rawChanges.length > 0 || behaviour(c).length > 0, `${c.id} says whether it's automated`);
    assert.equal(/Not automated/.test(d), !/Automated:/.test(d), c.id);
    if (c.hint) assert.ok(d.includes(c.hint.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;")), `${c.id} carries its hint`);
  }
  const grappled = Registry.effectData(Registry.get("grappled")).description;
  assert.match(grappled, /Automated:<\/strong> -2 All Actions/);
  assert.match(grappled, /Core rulebook p\.177/);
  const emp = Registry.effectData(Registry.get("emp")).description;
  assert.match(emp, /Not automated/);
  assert.match(summary(Registry.get("emp")), /^not automated/);
  assert.match(Registry.effectData(Registry.get("seriouslyWounded")).description, /Cyberpunk RED applies/);
  assert.match(Registry.effectData(Registry.get("prone")).description, /-4 Evasion \(a roll dialog toggle, ticked\)/);
  assert.match(Registry.effectData(Registry.get("tarotChromeShutdown")).description, /-4 All Actions \(a roll dialog toggle, off until ticked\)/);
  assert.match(Registry.effectData(Registry.get("qhPopupGeddon")).description, /2070 Core Rules/);
  // What the module runs besides the changes.
  assert.match(Registry.effectData(Registry.get("wxAcidRain")).description, /worked out per character/);
  assert.match(Registry.effectData(Registry.get("onFireMild")).description, /2 at Turn end/);
  assert.match(Registry.effectData(Registry.get("flashbanged")).description, /brings Damaged Eye, Damaged Ear/);
  assert.match(Registry.effectData(Registry.get("unconscious")).description, /ends when they take damage/);
  // A rolled one describes what it rolled.
  const actor = makeActor({ name: "Slowpoke" });
  const [slow] = await Conditions.add("qhSlow", actor);
  assert.match(slow.description, new RegExp(`${slow.changes[0].value} MOVE`));
  // A hint with markup in it is shown as text.
  assert.equal(describe({ hint: "<b>x</b>", page: 1, rawChanges: [] }).includes("<b>"), false);
});

test("weather and visibility describe the numbers each character actually gets", async () => {
  const actor = makeActor({ name: "Wet" });
  const changes = [{ key: "bonuses.perceptionSight", value: -2, situational: true, onByDefault: true }];
  const [e] = await Conditions.add("wxHeavyRain", actor, { changes, managed: "env" });
  assert.match(e.description, /-2 Perception \(sight\)/);
  await Conditions.add("wxHeavyRain", actor, { changes: [{ ...changes[0], value: -4 }], managed: "env" });
  assert.match(Conditions.effects(actor, "wxHeavyRain")[0].description, /-4 Perception \(sight\)/, "a refresh rewrites it");
});

test("removing a condition takes off what it brought along, unless another condition still brings it", async () => {
  const actor = makeActor({ name: "Dazed" });
  await Conditions.add("flashbanged", actor, { force: true });
  await settle();
  assert.ok(Conditions.has("damagedEye", actor) && Conditions.has("damagedEar", actor));
  assert.equal(Conditions.effects(actor, "damagedEye")[0].getFlag(M, "alsoOf"), Conditions.effects(actor, "flashbanged")[0].id);
  await Conditions.remove("flashbanged", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), [], "Damaged Eye and Ear go with the flashbang");

  // A Damaged Ear two conditions bring stays with the one that's left.
  await Conditions.add("flashbanged", actor, { force: true });
  await settle();
  await Conditions.add("qhSonicShock", actor);
  await settle();
  await Conditions.remove("flashbanged", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id).sort(), ["damagedEar", "qhSonicShock"]);
  await Conditions.remove("qhSonicShock", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor), []);

  // One already there by itself isn't taken off with the other.
  await Conditions.add("prone", actor);
  await Conditions.add("sleep", actor);
  await settle();
  await Conditions.remove("sleep", actor);
  await settle();
  assert.deepEqual(Conditions.active(actor).map((c) => c.id), ["prone"]);
  await Conditions.remove("prone", actor);
  assert.equal(actor.effects.size, 0, "nothing left behind");
});

test("a Condition Lab edit reaches the effects already placed; automation keeps its numbers", async () => {
  const actor = makeActor({ name: "Tired" });
  await Conditions.add("exhausted", actor);
  await Conditions.add("wxLightRain", actor, { managed: "env", changes: [{ key: "bonuses.athletics", value: -1, situational: true, onByDefault: false }] });
  await Settings.set("conditionOverrides", {
    exhausted: { changes: [{ key: "bonuses.allActions", value: -3 }], hint: "Running on fumes." },
    wxLightRain: { hint: "Wet streets." }
  });
  Registry.refresh();
  assert.equal(await Conditions.resync("exhausted"), 1);
  await Conditions.resync("wxLightRain");
  const tired = Conditions.effects(actor, "exhausted")[0];
  assert.deepEqual(tired.changes.map((c) => c.value), ["-3"]);
  assert.match(tired.description, /Running on fumes\..*-3 All Actions/);
  const rain = Conditions.effects(actor, "wxLightRain")[0];
  assert.deepEqual(rain.changes.map((c) => c.value), ["-1"], "the weather's per-character numbers stay");
  assert.match(rain.description, /Wet streets\..*-1 Athletics \(a roll dialog toggle, off until ticked\)/);
  assert.deepEqual(effectChanges(rain), [{ key: "bonuses.athletics", value: -1, mode: 2, situational: true, onByDefault: false }]);
  await Settings.set("conditionOverrides", {});
  Registry.refresh();
});

/** Just enough of Cyberpunk RED's Effects tab: one row per effect, as its template draws them. */
function fakeSheet(actor, none = `(${game.i18n.localize("CPR.characterSheet.rightPane.effects.noBonusesConfigured")})`) {
  globalThis.document ??= { createElement: () => ({ className: "", textContent: "" }) };
  const rows = actor.effects.contents.map((e) => {
    const nodes = [{ nodeType: 3, textContent: `\n  ${e.changes.length ? "" : none}\n` }];
    const box = { childNodes: nodes, querySelector: (s) => (s === ".ncm-effect-note" ? nodes.find((n) => n.className === "ncm-effect-note") ?? null : null), append: (n) => nodes.push(n) };
    nodes.forEach((n) => (n.remove = () => nodes.splice(nodes.indexOf(n), 1)));
    return { dataset: { effectId: e.uuid }, querySelector: (s) => (s === ".effect-item" ? box : null), box };
  });
  const root = { querySelectorAll: (s) => (s === "li.effect[data-effect-id]" ? rows : []) };
  return { sheet: { actor }, root, rows };
}

test("the character sheet's Effects tab says what each condition does", async () => {
  const actor = makeActor({ name: "Sheet" });
  await Conditions.add(["emp", "grappled"], actor);
  actor.effects.set("other", { id: "other", uuid: "x", changes: [], flags: {}, statuses: new Set(), getFlag: () => undefined });
  const { sheet, root, rows } = fakeSheet(actor);
  assert.equal(SheetNotes.annotate(sheet, root), 2, "two conditions, one plain effect");
  const [emp, grappled, other] = rows;
  const note = (r) => r.box.childNodes.find((n) => n.className === "ncm-effect-note")?.textContent;
  assert.equal(note(emp), `${Registry.get("emp").hint} · Core rulebook p.345`);
  assert.ok(!emp.box.childNodes.some((n) => n.nodeType === 3 && n.textContent.includes("noBonusesConfigured")), "the empty-changes line goes");
  assert.match(note(grappled), /^Held:/);
  assert.equal(note(other), undefined);
  assert.equal(SheetNotes.annotate(sheet, root), 0, "a re-render doesn't add it twice");
  await Settings.set("conditionSheetNotes", false);
  assert.equal(SheetNotes.annotate(sheet, fakeSheet(actor).root), 0, "off in the settings");
  await Settings.set("conditionSheetNotes", true);
});
