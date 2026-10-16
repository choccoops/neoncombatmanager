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
  // A Biomonitor but nothing to call with.
  const vee = pc("Velvet", {}, "Biomonitor");
  const scene = { id: "s1", flags: { "night-city-messenger": { deadZone: true } } };
  game.scenes.set("s1", scene);
  player.viewedScene = "s1";
  assert.equal(Messenger.deadZone(scene), true);
  await assert.rejects(Calls.place({ actorId: vee.id }, [{ actorId: vee.id }]), /dead zone/);
  player.viewedScene = null;
  await Settings.set("callNeedsAgent", true);
  await assert.rejects(Calls.place({ actorId: vee.id }, [{ actorId: "x" }]), /nothing to call with/);
  vee.items.set("ag", { id: "ag", name: "Agent", type: "gear", system: { equipped: "carried" } });
  assert.equal(Messenger.hasAgent(vee), true);
  const ported = pc("Ported");
  assert.equal(Messenger.hasAgent(ported), true, "a Neuroport's Holophone calls");
  assert.equal(Messenger.hasAgent(pc("Unplugged", {}, "Biomonitor")), false);
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

test("/holo talks on your call from the chat box; /holo alone turns talking from chat on and off", async () => {
  const { Comms } = await import("../scripts/comms/comms.js");
  asGM(true);
  chat.length = 0;
  const vee = pc("Velvet");
  const rogue = makeActor({ name: "Rogue", hasPlayerOwner: false });
  const callId = await Calls.place({ actorId: rogue.id }, [{ actorId: vee.id }]);
  await Calls.answer(callId, "p1");

  // Velvet's player, in the regular chat box.
  asGM(false);
  assert.equal(Calls.mine()[0]?.id, callId);
  assert.equal(Comms.onChatMessage("/holo On my way."), false, "taken for the call; Foundry posts nothing");
  let msg = chat.at(-1);
  assert.equal(msg.flags["cpr-neon-combat-manager"].holocall, callId);
  assert.equal(msg.speaker.alias, "Velvet");
  assert.ok(msg.content.includes("On my way."));
  assert.deepEqual(msg.whisper.sort(), [gm.id, player.id].sort(), "whispered, as from the call window");

  // Talking from chat: plain text goes to the call; commands and rolls don't.
  assert.equal(Comms.onChatMessage("/holo"), false);
  assert.equal(Comms.routing, callId);
  const before = chat.length;
  assert.equal(Comms.onChatMessage("Bring the van."), false);
  assert.equal(chat.length, before + 1);
  assert.ok(chat.at(-1).content.includes("Bring the van."));
  assert.equal(Comms.onChatMessage("/r 1d10"), true, "a roll still rolls");
  assert.equal(Comms.onChatMessage("/holo"), false);
  assert.equal(Comms.routing, null);
  assert.equal(Comms.onChatMessage("Just chatting."), true, "back to regular chat");

  // The GM's /holo speaks as the NPC.
  asGM(true);
  Comms.onChatMessage("/holo Midnight. Don't be late.");
  msg = chat.at(-1);
  assert.equal(msg.speaker.alias, "Rogue");

  // The call ends: talking from chat stops with it.
  asGM(false);
  Comms.onChatMessage("/holo");
  assert.equal(Comms.routing, callId);
  asGM(true);
  await Calls.end(callId);
  asGM(false);
  await Comms.onCalls();
  assert.equal(Comms.routing, null);

  // Not on a call: /holo says so and posts nothing.
  const count = chat.length;
  assert.equal(Comms.onChatMessage("/holo anyone?"), false);
  assert.equal(chat.length, count);
  asGM(true);
});

test("the Biomon, Holocall and incoming-call templates render", async () => {
  const base = "modules/cpr-neon-combat-manager/templates";
  const html = await Compat.renderTemplate(`${base}/biomon.hbs`, {
    gm: true,
    links: [{ id: "l1", name: "Crew", canCall: true, members: [{ id: "a", name: "Velvet", img: "v", ...readout({ hp: 10, max: 40, wound: "seriouslyWounded" }), label: "SERIOUS TRAUMA", ecg: ecgPath("serious"), beat: "1.6s", icons: [], mine: true, fullBiomon: true }] }],
    unlinked: [{ id: "b", name: "Hazel", ok: true }, { id: "c", name: "Bare", ok: false }],
    canLink: true,
    needsImplant: true,
    joinable: [{ id: "l1", name: "Crew" }]
  });
  assert.ok(html.includes("SERIOUS TRAUMA") && html.includes('data-action="joinLink"') && html.includes("st-serious"));
  assert.ok(html.includes('<option value="c" disabled>Bare (no Biomonitor or Neuroport)</option>'), "a character without the implant can't be picked");
  const dial = await Compat.renderTemplate(`${base}/holocall.hbs`, { dialer: true, gm: true, callers: [{ value: "actor:a", label: "Rogue", selected: true }], crew: [{ key: "actor:b", name: "Hazel", img: "h", online: true }], links: [{ id: "l1", name: "Crew", count: 2 }], contacts: [{ key: "contacts:c1", name: "Rogue", img: "r", trustPips: [true, false] }], npcs: [], directory: [], live: [], count: 0, messenger: true });
  assert.ok(dial.includes('data-pick="actor:b"') && dial.includes('data-action="placeCall"'));
  const call = await Compat.renderTemplate(`${base}/holocall.hbs`, { dialer: false, gm: true, timer: "00:42", participants: [{ id: "p0", name: "Rogue", img: "r", stateLabel: "On the line", state: "joined", live: true }], messages: [{ name: "Rogue", img: "r", content: "<p>hi</p>", time: "21:04" }], voices: [{ value: "p0", label: "Rogue", selected: true }], canTalk: true });
  assert.ok(call.includes("00:42") && call.includes('data-action="sendHolo"') && call.includes("<p>hi</p>"));
  const ring = await Compat.renderTemplate(`${base}/incoming-call.hbs`, { caller: { name: "Rogue", img: "r" }, forName: "Rogue's mark", others: "Hazel" });
  assert.ok(ring.includes('data-action="acceptCall"') && ring.includes("Also on: Hazel"));
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

await flush();
