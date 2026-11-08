/** Biomon Link and Holocalls: vitals, links, calls through Night City Messenger, and the template. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, settle as flush, asGM, testUsers, missingKeys, notes, fakeMessenger } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { readout, alarm, ecgPath } = await import("../scripts/comms/vitals.js");
const { Links } = await import("../scripts/comms/links.js");
const { Phone } = await import("../scripts/comms/phone.js");
const { Comms } = await import("../scripts/comms/comms.js");
const { Compat } = await import("../scripts/compat.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Registry.refresh();
Links.registerSocket();

const { gm, player } = testUsers;
/** A player character; with a CEMK Neuroport installed unless implant is null (or another implant's name). */
const pc = (name, extra = {}, implant = "Neuroport") => makeActor({ name, owners: [player.id], hasPlayerOwner: true, ...extra },
  implant ? [{ name: implant, type: "cyberware", system: { isInstalled: true } }] : []);

test("vitals follow the Wound State, out cold and flatlined", () => {
  assert.equal(readout({ hp: 40, max: 40, wound: "notWounded" }).state, "stable");
  assert.equal(readout({ hp: 30, max: 40, wound: "lightlyWounded" }).state, "light");
  const crit = readout({ hp: -2, max: 40, wound: "mortallyWounded", deathSave: 3 });
  assert.equal(crit.state, "critical");
  assert.equal(crit.deathSave, 3);
  assert.equal(crit.pct, 0);
  assert.equal(readout({ hp: 12, max: 40, wound: "seriouslyWounded", conditions: ["unconscious"] }).state, "down");
  assert.equal(readout({ hp: -2, max: 40, wound: "mortallyWounded", conditions: ["unconscious"] }).state, "critical", "dying beats unconscious");
  assert.deepEqual(readout({ hp: 20, max: 40, wound: "seriouslyWounded", signal: false }).state, "nosignal", "no implant, no readings");
  const dead = readout({ hp: -5, max: 40, wound: "mortallyWounded", conditions: ["dead"] });
  assert.equal(dead.state, "flatline");
  assert.equal(dead.bpm, 0);
  assert.equal(readout({ hp: 40, max: 40, conditions: ["onFireMild", "stabilized"] }).alerts.join(), "onFireMild,stabilized");
});

test("the link's alarm sounds when someone crashes, not when they recover", () => {
  const r = (state) => ({ state, signal: true });
  assert.equal(alarm(r("serious"), r("critical")), "critical");
  assert.equal(alarm(r("critical"), r("flatline")), "flatline");
  assert.equal(alarm(r("stable"), r("down")), "down");
  assert.equal(alarm(r("critical"), r("critical")), null, "no repeat");
  assert.equal(alarm(r("critical"), r("down")), null, "stabilized and out cold is better, not worse");
  assert.equal(alarm(r("stable"), r("light")), null, "a scratch isn't an alarm");
  assert.equal(alarm(null, r("critical")), "critical");
});

test("the ECG trace returns to its baseline after every beat, and lies flat on a flatline", () => {
  for (const state of ["stable", "serious", "critical", "down"]) {
    const ys = [...ecgPath(state).matchAll(/l[\d.]+ (-?[\d.]+)/g)].reduce((y, m) => y + Number(m[1]), 0);
    assert.ok(Math.abs(ys) < 1e-9, state);
  }
  assert.equal(ecgPath("flatline"), "M0 16 H120");
  assert.equal(ecgPath("nosignal"), "M0 16 H120");
});

test("players link their own characters; the GM writes it; a character is in one link at a time", async () => {
  const vee = pc("Velvet");
  const hazel = pc("Hazel");
  asGM(true);
  const crew = await Links.create("Crew", vee);
  await Links.join(crew, hazel);
  assert.deepEqual(Links.get(crew).members, [vee.id, hazel.id]);
  assert.equal(Links.of(hazel).name, "Crew");
  const solo = await Links.create("Solo run", hazel);
  assert.deepEqual(Links.get(crew).members, [vee.id], "moved, not copied");
  assert.deepEqual(Links.get(solo).members, [hazel.id]);
  await Links.leave(hazel);
  assert.equal(Links.get(solo), null, "an empty link goes");

  // A player can't link a character they don't own (the GM's check on their request).
  const npc = makeActor({ name: "Fixer", hasPlayerOwner: false });
  const { Socket } = await import("../scripts/socket.js");
  await assert.rejects(Socket.handlers.get("linkJoin")({ linkId: crew, actorId: npc.id }, player.id), /isn't your character/);
});

test("linking needs a Biomonitor or a Neuroport (CEMK), and a linked character without one shows no signal", async () => {
  asGM(true);
  assert.equal(Settings.get("linkNeedsImplant"), true, "on by default");
  const bare = pc("Bare", {}, null);
  const freeport = pc("Freeport", {}, "Neuroport (Free)");
  const chromed = pc("Chromed", {}, "Biomonitor");
  const optioned = pc("Optioned", {}, "Neuroport Biomonitor");
  await assert.rejects(Links.create("Needs chrome", bare), /no Biomonitor or Neuroport/);
  const id = await Links.create("Chromed", freeport);
  await Links.join(id, chromed);
  await Links.join(id, optioned);
  assert.deepEqual(Links.get(id).members.length, 3);
  assert.equal(Links.vitals(freeport).implant, "Neuroport", "the Free variant is a Neuroport");
  assert.equal(Links.vitals(chromed).implant, "Biomonitor");
  assert.equal(Links.vitals(optioned).implant, "Neuroport", "the Neuroport's Biomonitor option counts (as the Neuroport)");

  // The implant comes out: still linked, but nothing to read.
  freeport.items.clear();
  const v = Links.vitals(freeport);
  assert.equal(v.signal, false);
  assert.equal(v.state, "nosignal");
  assert.equal(v.hp, null);
  assert.equal(alarm({ state: "stable", signal: true }, v), null, "losing the signal isn't a crash");

  // The GM can switch the rule off: then anyone links, and everyone reads.
  await Settings.set("linkNeedsImplant", false);
  await Links.join(id, bare);
  assert.equal(Links.vitals(freeport).signal, true);
  await Settings.set("linkNeedsImplant", true);
  await Links.remove(id);
});

test("vitals read the actor: HP, Wound State, Death Save penalty and Critical Injuries", async () => {
  const hurt = pc("Hurt", { system: { derivedStats: { hp: { value: -1, max: 40 }, deathSave: { penalty: 2 } } } });
  hurt.items.set("cl", { id: "cl", name: "Collapsed Lung", type: "criticalInjury", system: {} });
  await Conditions.add("onFireMild", hurt);
  const v = Links.vitals(hurt);
  assert.equal(v.state, "critical");
  assert.equal(v.deathSave, 2);
  assert.deepEqual(v.criticals, ["Collapsed Lung"]);
  assert.deepEqual(v.alerts, ["onFireMild"]);
});

test("a Holocall rings through Night City Messenger: the target's number, as the caller", async () => {
  const vee = pc("Velvet");
  const hazel = pc("Hazel");
  const ncm = fakeMessenger({ numbers: { [hazel.id]: "555-0142" } });
  asGM(false);
  assert.deepEqual(await Phone.call(hazel, { as: vee }), { callId: "c1", emergency: false });
  assert.deepEqual(ncm.placed, [["555-0142", { actorId: vee.id }]]);
  // Not calling yourself: `as` is the target, so it's no one's in particular (NCM's own default).
  asGM(true);
  await Phone.call(hazel, { as: hazel });
  assert.deepEqual(ncm.placed[1], ["555-0142", {}]);
  ncm.off();
});

test("a Holocall that can't go through says why: no messenger, Calls off, no number, NCM's own refusal", async () => {
  const hazel = pc("Hazel");
  const rogue = makeActor({ name: "Rogue", type: "mook", hasPlayerOwner: false });
  const warned = () => notes.filter(([k]) => k === "warn").at(-1)?.[1];
  assert.equal(await Phone.call(hazel), null);
  assert.match(warned(), /Night City Messenger: turn it on/);
  let ncm = fakeMessenger({ calls: false });
  assert.equal(Phone.on, false);
  assert.equal(Comms.holoFor(hazel), null, "no Holocall buttons with Calls off");
  ncm.off();
  ncm = fakeMessenger({ contacts: [{ id: "k1", actorId: rogue.id, number: "555-0900" }] });
  assert.equal(await Phone.call(hazel), null);
  assert.match(warned(), /Hazel has no number in Night City Messenger/);
  // The GM's NPC answers on its directory contact's number.
  assert.equal(await Phone.numberOf(rogue), "555-0900");
  asGM(false);
  assert.equal(await Phone.numberOf(rogue), "", "the directory is the GM's");
  asGM(true);
  ncm.off();
  ncm = fakeMessenger({ numbers: { [hazel.id]: "555-0142" }, refuse: "Not in service." });
  assert.equal(await Phone.call(hazel), null);
  assert.equal(warned(), "Not in service.");
  ncm.off();
});

test("Holocall buttons: the GM opens an NPC's phone, a player their own, and anyone else is called", async () => {
  const hazel = pc("Hazel");
  const rogue = makeActor({ name: "Rogue", type: "mook", hasPlayerOwner: false });
  const ncm = fakeMessenger({ numbers: { [hazel.id]: "555-0142" } });
  asGM(true);
  const npc = Comms.holoFor(rogue);
  assert.equal(npc.label, "Holocall as Rogue");
  await npc.onClick();
  assert.deepEqual(ncm.opened, [[rogue.id, { filter: "calls" }]]);
  const pcButton = Comms.holoFor(hazel);
  assert.equal(pcButton.label, "Holocall Hazel");
  await pcButton.onClick();
  assert.equal(ncm.placed[0][0], "555-0142");
  asGM(false);
  assert.equal(Comms.holoFor(hazel).label, "Holocall", "a player's own character: their phone");
  assert.equal(Comms.sheetButton(hazel), null, "no sheet-header button unless the GM turns it on");
  await game.settings.set("cpr-neon-combat-manager", "holocallSheetButton", true);
  assert.equal(Comms.sheetButton(hazel).label, "Holocall");
  await game.settings.set("cpr-neon-combat-manager", "holocallSheetButton", false);
  assert.equal(Comms.holoFor(makeActor({ name: "Car", type: "vehicle" })), null);
  const options = [];
  Comms.actorMenu(options);
  assert.equal(options[0].condition({ dataset: { documentId: hazel.id } }), true);
  asGM(true);
  ncm.off();
});

test("the Biomon template renders", async () => {
  const base = "modules/cpr-neon-combat-manager/templates";
  const html = await Compat.renderTemplate(`${base}/biomon.hbs`, {
    gm: true,
    links: [{ id: "l1", name: "Crew", members: [{ id: "a", name: "Velvet", img: "v", ...readout({ hp: 10, max: 40, wound: "seriouslyWounded" }), label: "SERIOUS TRAUMA", ecg: ecgPath("serious"), beat: "1.6s", icons: [], mine: true, fullBiomon: true }] }],
    unlinked: [{ id: "b", name: "Hazel", ok: true }, { id: "c", name: "Bare", ok: false }],
    canLink: true,
    needsImplant: true,
    joinable: [{ id: "l1", name: "Crew" }]
  });
  assert.ok(html.includes("SERIOUS TRAUMA") && html.includes('data-action="joinLink"') && html.includes("st-serious"));
  assert.ok(html.includes('<option value="c" disabled>Bare (no Biomonitor or Neuroport)</option>'), "a character without the implant can't be picked");
  assert.ok(!html.includes('data-action="callMember"'), "no Holocall to yourself");
  const mate = await Compat.renderTemplate(`${base}/biomon.hbs`, { links: [{ id: "l1", name: "Crew", members: [{ id: "b", name: "Hazel", img: "h", ...readout({ hp: 40, max: 40, wound: "notWounded" }), label: "STABLE", ecg: "", beat: "1s", icons: [], canCall: true }] }] });
  assert.ok(mate.includes('data-action="callMember"'), "a linkmate can be called");
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

await flush();
