/** Biomon Link and Holocalls: vitals, links, calls, Night City Messenger, and their templates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, settle as flush, chat, asGM, testUsers, missingKeys } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { readout, alarm, ecgPath } = await import("../scripts/comms/vitals.js");
const { Links } = await import("../scripts/comms/links.js");
const { Calls, settle, participant } = await import("../scripts/comms/calls.js");
const { Messenger } = await import("../scripts/comms/messenger.js");
const { Compat } = await import("../scripts/compat.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Registry.refresh();
Links.registerSocket();
Calls.registerSocket();

const { gm, player } = testUsers;
const pc = (name, extra = {}) => makeActor({ name, owners: [player.id], hasPlayerOwner: true, ...extra });

test("vitals follow the Wound State, out cold and flatlined", () => {
  assert.equal(readout({ hp: 40, max: 40, wound: "notWounded" }).state, "stable");
  assert.equal(readout({ hp: 30, max: 40, wound: "lightlyWounded" }).state, "light");
  const crit = readout({ hp: -2, max: 40, wound: "mortallyWounded", deathSave: 3 });
  assert.equal(crit.state, "critical");
  assert.equal(crit.deathSave, 3);
  assert.equal(crit.pct, 0);
  assert.equal(readout({ hp: 12, max: 40, wound: "seriouslyWounded", conditions: ["unconscious"] }).state, "down");
  assert.equal(readout({ hp: -2, max: 40, wound: "mortallyWounded", conditions: ["unconscious"] }).state, "critical", "dying beats unconscious");
  const dead = readout({ hp: -5, max: 40, wound: "mortallyWounded", conditions: ["dead"] });
  assert.equal(dead.state, "flatline");
  assert.equal(dead.bpm, 0);
  assert.equal(readout({ hp: 40, max: 40, conditions: ["onFireMild", "stabilized"] }).alerts.join(), "onFireMild,stabilized");
});

test("the link's alarm sounds when someone crashes, not when they recover", () => {
  const r = (state) => ({ state });
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

test("a link can require the Biomonitor implant, and vitals say who has one", async () => {
  await Settings.set("linkNeedsImplant", true);
  const bare = pc("Bare");
  const chromed = pc("Chromed", {}, []);
  chromed.items.set("bm", { id: "bm", name: "Biomonitor", type: "cyberware", system: { isInstalled: true } });
  await assert.rejects(Links.create("Needs chrome", bare), /no Biomonitor/);
  const id = await Links.create("Chromed", chromed);
  assert.ok(id);
  assert.equal(Links.vitals(chromed).implant, true);
  await Settings.set("linkNeedsImplant", false);
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

test("call rules: active at two on the line, ended when it's down to one or no one", () => {
  const p = (id, state) => ({ id, state });
  const call = { status: "ringing", participants: [p("p0", "joined"), p("p1", "ringing")] };
  assert.equal(settle(call, 1).status, "ringing");
  call.participants[1].state = "joined";
  assert.equal(settle(call, 2).status, "active");
  assert.equal(call.connectedAt, 2);
  call.participants.push(p("p2", "ringing"));
  call.participants[1].state = "left";
  assert.equal(settle(call, 3).status, "active", "waiting on someone just added");
  call.participants[2].state = "declined";
  assert.equal(settle(call, 4).status, "ended");
  const lonely = { status: "ringing", participants: [p("p0", "left"), p("p1", "ringing")] };
  assert.equal(settle(lonely).status, "ended", "the caller gave up");
  assert.equal(lonely.participants[1].state, "cancelled");
});

test("who picks up: players for their characters, the GM for NPCs and for players who are away", () => {
  const vee = pc("Velvet");
  const fixer = makeActor({ name: "Rogue", hasPlayerOwner: false });
  assert.deepEqual(Calls.answerers(participant({ actorId: vee.id }, "p1")).map((u) => u.id), [player.id]);
  assert.deepEqual(Calls.answerers(participant({ actorId: fixer.id }, "p1")).map((u) => u.id), [gm.id]);
  assert.deepEqual(Calls.answerers(participant({ type: "contact", contactId: "c1", name: "Voice" }, "p1")).map((u) => u.id), [gm.id]);
  player.active = false;
  assert.deepEqual(Calls.answerers(participant({ actorId: vee.id }, "p1")).map((u) => u.id), [gm.id]);
  player.active = true;
});

test("a holocall rings, connects, talks in whispers to everyone on it, and ends", async () => {
  asGM(true);
  chat.length = 0;
  const vee = pc("Velvet");
  const rogue = makeActor({ name: "Rogue", hasPlayerOwner: false });
  const callId = await Calls.place({ actorId: rogue.id }, [{ actorId: vee.id }]);
  let call = Calls.get(callId);
  assert.equal(call.status, "ringing");
  assert.deepEqual(call.participants.map((p) => [p.name, p.state]), [["Rogue", "joined"], ["Velvet", "ringing"]]);

  // Velvet's player picks up.
  asGM(false);
  await Calls.answer(callId, "p1").catch(() => null);
  asGM(true);
  await Calls.answer(callId, "p1");
  call = Calls.get(callId);
  assert.equal(call.status, "active");

  await Calls.say(callId, "p0", "Got a job for you, choom.\nMeet me at the Afterlife.");
  const msg = chat.at(-1);
  assert.equal(msg.flags["cpr-neon-combat-manager"].holocall, callId);
  assert.ok(msg.content.includes("Got a job for you, choom.<br>Meet me"));
  assert.deepEqual(msg.whisper.sort(), [gm.id, player.id].sort(), "only the people on the call");
  assert.equal(msg.speaker.alias, "Rogue");
  assert.deepEqual(Calls.messages(callId).map((m) => m.id), [msg.id]);

  // The GM hangs up Rogue: one left on the line, the call ends.
  await Calls.hangUp(callId);
  assert.equal(Calls.get(callId).status, "ended");
  assert.equal(await Calls.say(callId, "p1", "hello?"), null, "nothing goes out on an ended call");
});

test("no answer: a missed call, and a message in the Night City Messenger inbox", async () => {
  asGM(true);
  const sent = [];
  game.modules.set("night-city-messenger", { id: "night-city-messenger", active: true, api: { messenger: { sendMessage: async (data) => (sent.push(data), { success: true }) } } });
  const vee = pc("Velvet");
  const hazel = pc("Hazel");
  const callId = await Calls.place({ actorId: vee.id }, [{ actorId: hazel.id }]);
  await Calls._timeout(callId);
  const call = Calls.get(callId);
  assert.equal(call.participants[1].state, "missed");
  assert.equal(call.status, "ended");
  assert.deepEqual(sent, [{ toActorId: hazel.id, fromActorId: vee.id, subject: "Missed holocall: Velvet", body: "Velvet tried to holocall you and couldn't get through." }]);
  game.modules.delete("night-city-messenger");
});

test("dead zones and Agents: no signal, no call", async () => {
  asGM(false);
  const vee = pc("Velvet");
  const scene = { id: "s1", flags: { "night-city-messenger": { deadZone: true } } };
  game.scenes.set("s1", scene);
  player.viewedScene = "s1";
  assert.equal(Messenger.deadZone(scene), true);
  await assert.rejects(Calls.place({ actorId: vee.id }, [{ actorId: vee.id }]), /dead zone/);
  player.viewedScene = null;
  await Settings.set("callNeedsAgent", true);
  await assert.rejects(Calls.place({ actorId: vee.id }, [{ actorId: "x" }]), /no Agent/);
  vee.items.set("ag", { id: "ag", name: "Agent", type: "gear", system: { equipped: "carried" } });
  assert.equal(Messenger.hasAgent(vee), true);
  await Settings.set("callNeedsAgent", false);
  asGM(true);
});

test("Night City Messenger contacts become people to call, with portraits; burned and encrypted ones stay out of reach", async () => {
  const rogue = makeActor({ name: "Rogue", hasPlayerOwner: false, img: "rogue.webp" });
  const vee = pc("Velvet");
  game.modules.set("night-city-messenger", {
    id: "night-city-messenger",
    active: true,
    api: {
      contacts: { getContacts: async () => [
        { id: "c1", name: "Rogue", linkedActorId: rogue.id, trust: 4 },
        { id: "c2", name: "Mystery", encrypted: true },
        { id: "c3", name: "Snitch", burned: true, portrait: "snitch.webp" }
      ] },
      portraits: { resolvePortrait: (c) => c.portrait || null },
      masterContacts: { getAll: () => [{ id: "m1", name: "Mr. Blue Eyes" }] }
    }
  });
  const list = await Messenger.contacts(vee);
  assert.deepEqual(list.map((c) => [c.name, c.actorId, c.trust, c.burned]), [["Rogue", rogue.id, 4, false], ["Snitch", null, 0, true]]);
  assert.equal(list[0].img, "rogue.webp", "the linked actor's image when there's no portrait");
  assert.equal(list[1].img, "snitch.webp");
  assert.deepEqual(Messenger.directory().map((c) => [c.key, c.name]), [["directory:m1", "Mr. Blue Eyes"]]);
  game.modules.delete("night-city-messenger");
  assert.deepEqual(await Messenger.contacts(vee), [], "nothing without the module");
});

test("the Biomon, Holocall and incoming-call templates render", async () => {
  const base = "modules/cpr-neon-combat-manager/templates";
  const html = await Compat.renderTemplate(`${base}/biomon.hbs`, {
    gm: true,
    links: [{ id: "l1", name: "Crew", canCall: true, members: [{ id: "a", name: "Velvet", img: "v", ...readout({ hp: 10, max: 40, wound: "seriouslyWounded" }), label: "SERIOUS TRAUMA", ecg: ecgPath("serious"), beat: "1.6s", icons: [], mine: true, fullBiomon: true }] }],
    unlinked: [{ id: "b", name: "Hazel" }],
    joinable: [{ id: "l1", name: "Crew" }]
  });
  assert.ok(html.includes("SERIOUS TRAUMA") && html.includes('data-action="joinLink"') && html.includes("st-serious"));
  const dial = await Compat.renderTemplate(`${base}/holocall.hbs`, { dialer: true, gm: true, callers: [{ value: "actor:a", label: "Rogue", selected: true }], crew: [{ key: "actor:b", name: "Hazel", img: "h", online: true }], links: [{ id: "l1", name: "Crew", count: 2 }], contacts: [{ key: "contacts:c1", name: "Rogue", img: "r", trustPips: [true, false] }], npcs: [], directory: [], live: [], count: 0, messenger: true });
  assert.ok(dial.includes('data-pick="actor:b"') && dial.includes('data-action="placeCall"'));
  const call = await Compat.renderTemplate(`${base}/holocall.hbs`, { dialer: false, gm: true, timer: "00:42", participants: [{ id: "p0", name: "Rogue", img: "r", stateLabel: "On the line", state: "joined", live: true }], messages: [{ name: "Rogue", img: "r", content: "<p>hi</p>", time: "21:04" }], voices: [{ value: "p0", label: "Rogue", selected: true }], canTalk: true });
  assert.ok(call.includes("00:42") && call.includes('data-action="sendHolo"') && call.includes("<p>hi</p>"));
  const ring = await Compat.renderTemplate(`${base}/incoming-call.hbs`, { caller: { name: "Rogue", img: "r" }, forName: "Rogue's mark", others: "Hazel" });
  assert.ok(ring.includes('data-action="acceptCall"') && ring.includes("Also on: Hazel"));
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

await flush();
