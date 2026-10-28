/** The City & NCART hub (Night City 2070) and what it does to holocalls; holocall logs to Night City Messenger. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, settle, chat, dice, asGM, testUsers, missingKeys } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { NC2070 } = await import("../scripts/hub/data.js");
const G = await import("../scripts/hub/geo.js");
const { Hub } = await import("../scripts/hub/hub.js");
const { Calls, logPairs, lineText } = await import("../scripts/comms/calls.js");
const { Socket } = await import("../scripts/socket.js");
const { Doorway } = await import("../scripts/hub/doorway.js");
const { Compat } = await import("../scripts/compat.js");
Hub.registerSocket();
Calls.registerSocket();

const { player } = testUsers;
const place = (name) => NC2070.places.find((p) => p.name === name);
const pc = (name) => makeActor({ name, owners: [player.id], hasPlayerOwner: true }, [{ name: "Neuroport", type: "cyberware", system: { isInstalled: true } }]);

/* ---------------------------------------- */
/*  The 2070 data                           */
/* ---------------------------------------- */

test("the 2070 data: 18 districts with NCZTA-70 ratings, 85 places with their write-ups, NCART lines on real stations", () => {
  assert.equal(NC2070.districts.length, 18);
  for (const d of NC2070.districts) {
    assert.ok(NC2070.threat[d.rating], `${d.name} has a rating`);
    assert.ok(d.poly.length >= 3 && d.dossier, d.name);
  }
  assert.equal(NC2070.places.length, 85);
  assert.ok(NC2070.places.every((p) => p.text), "every place has its sourcebook text");
  for (const line of Object.values(NC2070.lines)) {
    for (const run of ["segs", "uc", "closed", "planned", "suspended"]) for (const seg of line[run]) for (const s of seg) assert.ok(NC2070.stations[s], `${line.name}: ${s}`);
  }
  // Where the places are drawn is where the data says they are.
  const off = NC2070.places.filter((p) => p.district && G.districtAt(p.x, p.y).code !== p.district).map((p) => p.name);
  assert.deepEqual(off, [], "places sit inside their district");
});

test("where a point is: districts, Laguna Bend and the Badlands", () => {
  assert.equal(G.districtAt(562, 726).name, "Little China");
  assert.equal(G.districtAt(622, 905).name, "Corporate Plaza");
  assert.equal(G.districtAt(1100, 1340).name, "Laguna Bend");
  assert.equal(G.districtAt(1250, 300).name, "The Badlands");
  assert.equal(G.districtAt(1250, 300).rating, "outskirts");
});

/* ---------------------------------------- */
/*  Travel times                            */
/* ---------------------------------------- */

test("travel times follow the 2070 table, rush hour doubles cars, a storm doubles the ground", () => {
  assert.equal(G.travelMinutes("walk", 4), 60);
  assert.equal(G.travelMinutes("car", 8), 25);
  assert.equal(G.travelMinutes("av", 20), 15);
  assert.equal(G.travelMinutes("bike", 20), 75);
  assert.equal(G.travelMinutes("car", 8, { rush: true }), 50);
  assert.equal(G.travelMinutes("car", 8, { rush: true, moto: true }), 38);
  assert.equal(G.travelMinutes("car", 8, { jam: "gridlock" }), 75);
  assert.equal(G.travelMinutes("walk", 4, { storm: true }), 120);
  assert.equal(G.travelMinutes("av", 8, { storm: true }), 10, "AVs don't care (they're grounded instead)");
  assert.ok(G.travelMinutes("walk", 0.2) >= 6, "a short hop still takes a few minutes");
  assert.equal(G.rushHour(8), true);
  assert.equal(G.rushHour(12), false);
  assert.equal(G.rushHour(14, { arroyo: true }), true, "Arroyo's shift change");
  assert.equal(G.formatMinutes(80), "1 h 20 min");
});

test("NCART: the quickest ride with its changes, and no service on closed track", () => {
  const r = G.ncartRoute("lchina", "ash");
  assert.deepEqual(r.legs.map((l) => l.line), ["1", "3", "2"]);
  assert.equal(r.transfers, 2);
  assert.equal(r.minutes, 5 + 8 * 3 + 2 * 5);
  assert.equal(G.ncartRoute("cplaza", "jtown").legs.length, 1, "one line, no change");
  assert.equal(G.ncartRoute("eis", "ngate"), null, "NorCal Gate is closed");
  assert.equal(G.ncartRoute("glens", "coast"), null, "the Pacifica Line is suspended");
});

test("a trip: distance, every mode, NCART door to door, and the dangerous ground on the way", () => {
  const trip = G.plan(place("The Afterlife"), place("Red Dirt"), { hour: 8 });
  assert.ok(trip.km > 8 && trip.km < 13);
  assert.equal(trip.rush, true);
  assert.ok(trip.times.av < trip.times.car && trip.times.car < trip.times.walk);
  assert.equal(trip.ncart.board, "lchina");
  assert.ok(trip.danger.some((d) => d.name === "Vista del Rey"), "through Valentino ground");
  const hop = G.plan(place("The Afterlife"), place("Tom's Diner"));
  assert.equal(hop.ncart, null, "next door: walk");
});

test("signal: Utility Code 9 and worse is a dead zone, and so is what the GM lists", () => {
  assert.equal(G.deadAt(390, 1386), true, "West Wind (UC 9)");
  assert.equal(G.deadAt(1100, 1340), true, "Laguna Bend (UC 10)");
  assert.equal(G.deadAt(562, 726), false, "Little China");
  assert.equal(G.deadAt(562, 726, { extra: ["C"] }), true);
  assert.equal(G.deadAt(1250, 300, { extra: ["The Badlands"] }), true);
});

/* ---------------------------------------- */
/*  The hub's state                         */
/* ---------------------------------------- */

test("the crew marker, pins (players pin their own, no GM needed) and place notes", async () => {
  asGM(true);
  await Hub.setCrew(place("The Afterlife"), "The Afterlife");
  assert.deepEqual(Hub.state.crew, { x: 562, y: 726, label: "The Afterlife" });
  const vee = pc("Velvet");
  const npc = makeActor({ name: "Goon", hasPlayerOwner: false });
  // A player pins their own character with no GM online: it's kept on the character.
  asGM(false);
  testUsers.gm.active = false;
  try {
    await Hub.setPin(vee, { x: 390.4, y: 1386 });
    assert.deepEqual(vee.flags["cpr-neon-combat-manager"].hubPin, { x: 390, y: 1386 });
    assert.deepEqual(Hub.pinOf(vee), { x: 390, y: 1386 });
    assert.deepEqual(Hub.state.pins[vee.id], { x: 390, y: 1386 });
    assert.equal(Hub.whereIs(vee), "West Wind Estate");
    await assert.rejects(Hub.setPin(npc, { x: 1, y: 1 }), /character/i, "never someone else's");
    await Hub.setPin(vee, null);
    assert.equal(Hub.pinOf(vee), null);
    await Hub.setPin(vee, { x: 390, y: 1386 });
  } finally {
    testUsers.gm.active = true;
    asGM(true);
  }
  await Hub.setNote("p1", { note: "Rogue's in tonight." });
  await Hub.setNote("p1", { scene: "sc1" });
  assert.deepEqual(Hub.state.notes.p1, { note: "Rogue's in tonight.", scene: "sc1", tile: "", tag: "", open: false });
  await Hub.setNote("p1", { note: "", scene: "" });
  assert.equal(Hub.state.notes.p1, undefined);
  asGM(false);
  await assert.rejects(Hub.setCrew(null), /GM/);
  asGM(true);
});

test("pins kept in the world setting (1.4.0-1.5.0) move onto their characters", async () => {
  asGM(true);
  const vee = pc("Velvet");
  const hazel = pc("Hazel");
  await pinOnActor(hazel);
  await Settings.set("cityHub", { pins: { [vee.id]: { x: 562, y: 726 }, [hazel.id]: { x: 1, y: 1 } } });
  assert.deepEqual(Hub.pinOf(vee), { x: 562, y: 726 }, "read before it moves");
  await Hub.migratePins();
  assert.deepEqual(vee.flags["cpr-neon-combat-manager"].hubPin, { x: 562, y: 726 });
  assert.deepEqual(Hub.pinOf(hazel), { x: 772, y: 948 }, "a newer pin on the character wins");
  assert.deepEqual(Settings.get("cityHub").pins, {});
});

async function pinOnActor(a) {
  await a.setFlag("cpr-neon-combat-manager", "hubPin", { x: 772, y: 948 });
}

test("travel moves the clock and the crew, and a car rolls for a jam", async () => {
  asGM(true);
  game.time.worldTime = 12 * 3600;
  const a = { ...place("Totentanz"), name: "Totentanz" };
  const b = { ...place("NCPD Precinct 2"), name: "NCPD Precinct 2" };
  dice.push(1);
  const { minutes, jam } = await Hub.travel(a, b, "car");
  assert.equal(jam, "jam");
  assert.equal(minutes, G.travelMinutes("car", G.plan(a, b).km, { jam: "jam" }));
  assert.equal(game.time.worldTime, 12 * 3600 + minutes * 60);
  assert.deepEqual(Hub.state.crew, { x: b.x, y: b.y, label: "NCPD Precinct 2" });
  assert.match(chat.at(-1).content, /Traffic jam/);
  const before = game.time.worldTime;
  await Hub.travel(b, a, "ncart");
  assert.ok(game.time.worldTime > before);
  assert.match(chat.at(-1).content, /Crosstown: Ash St → Industrial North/);
});

/* ---------------------------------------- */
/*  Holocalls                               */
/* ---------------------------------------- */

test("no signal where a character is pinned: they can't call, and they don't ring", async () => {
  asGM(true);
  Settings.set("hubSignal", true);
  const vee = pc("Velvet");
  const hazel = pc("Hazel");
  await Hub.setPin(vee, { x: 390, y: 1386 });
  await assert.rejects(Calls.place({ actorId: vee.id }, [{ actorId: hazel.id }]), /no signal in West Wind Estate/);
  const id = await Calls.place({ actorId: hazel.id }, [{ actorId: vee.id }]);
  assert.equal(Calls.get(id).participants[1].state, "nosignal");
  Settings.set("hubSignal", false);
  assert.equal(Hub.noSignal(vee), false, "the rule off");
  Settings.set("hubSignal", true);
  await Hub.setPin(vee, null);
});

test("busy: someone already on a call shows Busy instead of ringing", async () => {
  asGM(true);
  const vee = pc("Velvet");
  const hazel = pc("Hazel");
  const rogue = makeActor({ name: "Rogue", hasPlayerOwner: false });
  const first = await Calls.place({ actorId: rogue.id }, [{ actorId: vee.id }]);
  await Calls.answer(first, "p1");
  const second = await Calls.place({ actorId: hazel.id }, [{ actorId: vee.id }]);
  assert.equal(Calls.get(second).participants[1].state, "busy");
  assert.equal(Calls.get(second).status, "ended", "nobody to ring");
  await Calls.end(first);
});

test("a log line reads back as text; each character keeps the log with the person they spoke to", () => {
  assert.equal(lineText('<div class="ncm-holo-line"><span class="ncm-holo-tag">◈ HOLO</span><p>Meet me &amp; bring the van.<br>Now.</p></div>'), "Meet me & bring the van.\nNow.");
  const call = { callerId: "p0", participants: [
    { id: "p0", name: "Rogue", joinedAt: 1 }, { id: "p1", name: "Vee", pc: true, joinedAt: 2 },
    { id: "p2", name: "Hazel", pc: true, joinedAt: 3 }, { id: "p3", name: "Sage", pc: true, joinedAt: null }
  ] };
  assert.deepEqual(logPairs(call, (p) => p.pc).map(({ pc, other }) => [pc.name, other.name]), [["Vee", "Rogue"], ["Hazel", "Rogue"]]);
  const pcCall = { callerId: "p0", participants: [{ id: "p0", name: "Vee", pc: true, joinedAt: 1 }, { id: "p1", name: "Hazel", pc: true, joinedAt: 2 }] };
  assert.deepEqual(logPairs(pcCall, (p) => p.pc).map(({ pc, other }) => [pc.name, other.name]), [["Vee", "Hazel"]], "two characters: once (the messenger files the sender's copy)");
});

test("holocall logs go to Night City Messenger, threaded per contact, once", async () => {
  asGM(true);
  const sent = [];
  game.modules.set("night-city-messenger", { id: "night-city-messenger", active: true, api: { messenger: { sendMessage: async (data) => (sent.push(data), { success: true }) } } });
  const vee = pc("Velvet");
  const rogue = makeActor({ name: "Rogue", hasPlayerOwner: false });
  const id = await Calls.place({ actorId: rogue.id }, [{ actorId: vee.id }]);
  await Calls.answer(id, "p1");
  await Calls.say(id, "p0", "Got a job, choom.");
  await Calls.say(id, "p1", "How much?");
  await Calls.end(id);
  assert.equal(sent.length, 0, "the button by default");
  assert.deepEqual(await Calls.saveLog(id), [vee.id]);
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.toActorId, vee.id);
  assert.equal(mail.fromActorId, rogue.id);
  assert.equal(mail.threadId, `holocall-${[vee.id, rogue.id].sort().join("-")}`);
  assert.match(mail.subject, /Holocall log · Rogue, Velvet/);
  assert.match(mail.body, /<b>Rogue:<\/b> Got a job, choom\./);
  assert.match(mail.body, /<b>Velvet:<\/b> How much\?/);
  assert.equal(Calls.logged(Calls.get(id), vee.id), true);
  assert.deepEqual(await Calls.saveLog(id), [], "kept once");

  // Automatic: when the call ends.
  Settings.set("callLogs", "auto");
  const id2 = await Calls.place({ actorId: rogue.id }, [{ actorId: vee.id }]);
  await Calls.answer(id2, "p1");
  await Calls.end(id2);
  await settle();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].threadId, mail.threadId, "the same conversation as the last call");
  Settings.set("callLogs", "button");

  // A player keeps the log for their own character only.
  const hazel = pc("Hazel");
  const id3 = await Calls.place({ actorId: rogue.id }, [{ actorId: hazel.id }]);
  await Calls.answer(id3, "p1");
  await Calls.end(id3);
  assert.deepEqual(await Socket.handlers.get("callLog")({ callId: id3 }, player.id), [hazel.id]);
  game.modules.delete("night-city-messenger");
});

/* ---------------------------------------- */
/*  Discovery and the GM's own places       */
/* ---------------------------------------- */

test("discovery: players see a place once the GM reveals it, with a card (or quietly)", async () => {
  asGM(true);
  await Settings.set("cityHub", {});
  assert.equal(Hub.places().length, 85);
  assert.equal(Hub.visiblePlaces().length, 85, "the GM sees everything");
  assert.equal(Hub.visiblePlaces(player).length, 0, "the players start with nothing");
  const before = chat.length;
  await Hub.setSeen("p1", true);
  assert.deepEqual(Hub.visiblePlaces(player).map((p) => p.name), ["The Afterlife"]);
  assert.equal(chat.length, before + 1);
  assert.match(chat.at(-1).content, /Location discovered/);
  assert.match(chat.at(-1).content, /The Afterlife/);
  await Hub.setSeen(["p2", "p3"], true, { quiet: true });
  assert.equal(chat.length, before + 1, "quietly: no card");
  await Hub.setSeen("p1", true);
  assert.equal(chat.length, before + 1, "already known: no second card");
  await Hub.setSeen("p2", false);
  assert.deepEqual(Hub.visiblePlaces(player).map((p) => p.key), ["p1", "p3"]);
  // Discovery off: every place the GM hasn't hidden.
  await Settings.set("hubDiscovery", false);
  assert.equal(Hub.visiblePlaces(player).length, 84, "all but the one hidden");
  await Settings.set("hubDiscovery", true);
});

test("the GM's own places: added hidden (or visible), edited, moved, deleted", async () => {
  asGM(true);
  await Settings.set("cityHub", {});
  await assert.rejects(Hub.addPlace({ name: "  ", x: 1, y: 1 }), /name/);
  const key = await Hub.addPlace({ name: "Mama Chen's Noodles", text: "The crew's safehouse is upstairs.", sc: 3, x: 570, y: 690 });
  let p = Hub.place(key);
  assert.equal(p.custom, true);
  assert.equal(p.cat, "campaign");
  assert.equal(p.hidden, true, "hidden until revealed");
  assert.equal(G.districtAt(p.x, p.y).name, "Little China");
  const shown = await Hub.addPlace({ name: "Drop point", x: 600, y: 700 }, { visible: true });
  assert.equal(Hub.place(shown).hidden, false);
  await Hub.updatePlace(key, { name: "Mama Chen's", x: 575, y: 695, sc: "" });
  p = Hub.place(key);
  assert.deepEqual([p.name, p.x, p.y, p.sc], ["Mama Chen's", 575, 695, null]);
  await Hub.setNote(key, { note: "Owes Rogue a favor." });
  await Hub.removePlace(key);
  assert.equal(Hub.place(key), null);
  assert.equal(Hub.state.notes[key], undefined, "its notes go with it");
  await assert.rejects(Hub.removePlace("p1"), /hidden, not deleted/);
});

test("built-in places can be edited and moved, and put back as the map has them", async () => {
  asGM(true);
  await Settings.set("cityHub", {});
  await Hub.updatePlace("p2", { text: "Closed since the shootout. Boarded up.", x: 561, y: 656 });
  let p = Hub.place("p2");
  assert.equal(p.edited, true);
  assert.equal(p.text, "Closed since the shootout. Boarded up.");
  assert.deepEqual(Hub.state.edits.p2, { text: "Closed since the shootout. Boarded up.", x: 561, y: 656 }, "only what changed");
  await Hub.updatePlace("p2", { name: "Tom's Diner" });
  assert.equal(Hub.state.edits.p2.name, undefined, "the same name isn't an edit");
  await Hub.resetPlace("p2");
  p = Hub.place("p2");
  assert.equal(p.edited, false);
  assert.equal(p.x, 560);
});

test("players' map: only what they've discovered, in every list", async () => {
  asGM(true);
  await Settings.set("cityHub", {});
  await Hub.setSeen("p1", true, { quiet: true });
  const { HubApp } = await import("../scripts/hub/hub-app.js");
  asGM(false);
  const app = new HubApp();
  app.sel = "d:C";
  const district = app.panelContext();
  assert.deepEqual(district.places.map((p) => p.name), ["The Afterlife"]);
  app.query = "diner";
  assert.equal(app.panelContext().places.length, 0, "a hidden place doesn't come up in search");
  app.query = "";
  app.sel = "p:p2";
  assert.equal(app.panelContext().name, undefined, "a hidden place has nothing to show");
  assert.ok(!app.svgMarkup().includes('data-sel="p:p2"'), "and no marker");
  assert.ok(app.svgMarkup().includes('data-sel="p:p1"'));
  asGM(true);
  const gmApp = new HubApp();
  assert.ok(gmApp.svgMarkup().includes('ncm-hub-place is-hidden'), "the GM sees hidden places, faded");
  gmApp.sel = "d:C";
  assert.equal(gmApp.panelContext().hiddenCount, 4, "Tom's Diner, Riot, Precinct 3, Trauma Team Tower");
});

/* ---------------------------------------- */
/*  Doorways                                */
/* ---------------------------------------- */

/** A scene with tiles and tokens, enough for a doorway. */
function makeScene(id, name, tiles = []) {
  const tokens = new Map();
  const scene = {
    id, name, width: 4000, height: 3000, grid: { size: 100 }, initial: { x: 2000, y: 1500 },
    tiles: Object.assign(new Map(tiles.map((t) => [t.id, t])), { get(k) { return Map.prototype.get.call(this, k); } }),
    tokens,
    viewed: 0,
    async view() { scene.viewed++; },
    async createEmbeddedDocuments(type, list) {
      return list.map((d) => {
        const t = { ...d, id: `tok${tokens.size + 1}`, parent: scene, isOwner: true, async update(u) { Object.assign(t, u); return t; } };
        tokens.set(t.id, t);
        return t;
      });
    }
  };
  // Foundry's collections iterate their documents, not [id, document] pairs.
  for (const c of [scene.tokens, scene.tiles]) c[Symbol.iterator] = function* () { yield* Map.prototype.values.call(this); };
  return scene;
}

test("doorways: GM settings, who may go, and where they land", async () => {
  asGM(true);
  await Settings.set("cityHub", {});
  const triggered = [];
  const counter = { id: "t1", x: 800, y: 400, width: 200, height: 100, flags: { "monks-active-tiles": { name: "Noodle counter", active: true, actions: [{}, {}] } },
    trigger: async (args) => triggered.push(args) };
  const plain = { id: "t2", x: 0, y: 0, width: 100, height: 100, flags: {} };
  const noodles = makeScene("sc-noodles", "Mama Chen's", [plain, counter]);
  game.scenes.set(noodles.id, noodles);
  assert.deepEqual(Doorway.tilesOf(noodles).map((t) => [t.id, t.active]), [["t1", true], ["t2", false]], "Monk's tiles first");
  assert.match(Doorway.tileLabel(counter), /Noodle counter · 2 action/);

  await Hub.setNote("p2", { scene: noodles.id, tile: "t1" });
  assert.equal(Hub.doorOf("p2").open, false);
  assert.equal(Doorway.blocked(Hub.doorOf("p2"), player), "closed", "players need it opened");
  await Hub.setNote("p2", { open: true });
  assert.equal(Doorway.blocked(Hub.doorOf("p2"), player), null);
  await Settings.set("hubTravel", "off");
  assert.equal(Doorway.blocked(Hub.doorOf("p2"), player), "closed");
  await Settings.set("hubTravel", "always");
  const at = Doorway.resolve(Hub.doorOf("p2"));
  assert.deepEqual(at.point, { x: 900, y: 450 }, "the tile's middle");
  await Hub.setNote("p2", { tile: "" });
  assert.deepEqual(Doorway.resolve(Hub.doorOf("p2")).point, { x: 2000, y: 1500 }, "no tile: the scene's starting view");
  await Hub.setNote("p2", { scene: "" });
  assert.deepEqual(Hub.state.notes.p2, undefined, "no scene, no doorway (and no note): gone");
  game.scenes.delete(noodles.id);
});

test("going through a doorway: the token lands on the tile, the player is pulled there, the tile fires", async () => {
  asGM(true);
  await Settings.set("cityHub", {});
  const triggered = [];
  const counter = { id: "t1", x: 800, y: 400, width: 200, height: 100, flags: { "monks-active-tiles": { active: true, actions: [{}] } },
    trigger: async (args) => triggered.push(args) };
  const noodles = makeScene("sc-noodles", "Mama Chen's", [counter]);
  game.scenes.set(noodles.id, noodles);
  game.modules.set("monks-active-tiles", { id: "monks-active-tiles", active: true });
  const pulls = [];
  const emit = game.socket.emit;
  game.socket.emit = (...args) => pulls.push(args);
  const vee = pc("Velvet");
  vee.getTokenDocument = async () => ({ toObject: () => ({ name: "Velvet", actorId: vee.id, actorLink: true, width: 1, height: 1 }) });
  await Hub.setNote("p2", { scene: noodles.id, tile: "t1", open: true });
  await Hub.setSeen("p2", true, { quiet: true });
  try {
    // Not revealed or not open: no.
    await assert.rejects(Socket.handlers.get("hubGo")({ key: "p3", actorId: vee.id }, player.id), /hasn't opened/);
    const before = chat.length;
    const r = await Socket.handlers.get("hubGo")({ key: "p2", actorId: vee.id }, player.id);
    assert.equal(r.fired, true);
    const tok = noodles.tokens.get(r.token);
    assert.deepEqual([tok.x, tok.y], [850, 400], "centred on the tile");
    assert.deepEqual(pulls, [["pullToScene", noodles.id, player.id]]);
    assert.equal(triggered.length, 1);
    assert.equal(triggered[0].tokens[0], tok);
    assert.equal(triggered[0].userId, player.id);
    assert.ok(chat.length > before, "the GM hears about it");
    assert.deepEqual(chat.at(-1).whisper, ["gm1"]);
    // Again: the same token moves, no second one.
    tok.x = 0;
    await Socket.handlers.get("hubGo")({ key: "p2", actorId: vee.id }, player.id);
    assert.equal(noodles.tokens.size, 1);
    assert.equal(tok.x, 850);
    // Going through moves the character's pin to the place (the GM's own Go there, through Hub.go).
    await Hub.go("p2", vee.id);
    assert.deepEqual(Hub.pinOf(vee), { x: 560, y: 655 }, "pinned at Tom's Diner");
    // Someone else's character: theirs is used instead (they don't own Velvet).
    const npc = makeActor({ name: "Goon", hasPlayerOwner: false });
    await Socket.handlers.get("hubGo")({ key: "p2", actorId: npc.id }, player.id);
    assert.ok(![...noodles.tokens.values()].some((t) => t.actorId === npc.id), "never another's");
  } finally {
    game.socket.emit = emit;
    game.modules.delete("monks-active-tiles");
    game.scenes.delete(noodles.id);
  }
});

test("the hub's templates render with every string", async () => {
  const html = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/hub.hbs", { gm: true, views: [{ id: "city", label: "City" }], cats: [] });
  assert.match(html, /ncm-hub-stage/);
  const panel = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/hub-panel.hbs", {
    kind: "district", gm: true, name: "Little China", code: "C", chips: [{ label: "Moderate", color: "#f00" }], sc: 6, provider: "NCPD", uc: 4, places: [], signal: false, actions: ""
  });
  assert.match(panel, /Little China/);
  assert.match(panel, /No signal/);
  const route = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/hub-route.hbs", {
    gm: true, a: "A place", b: "B place", ready: true, km: 4, rush: true, modes: [{ id: "car", label: "Car", time: "15 min", on: true }],
    ncart: { legs: [{ name: "Northern Line", color: "#f0f", from: "Little China", to: "Little Europe", stops: 1 }], walkIn: 5, walkOut: 6 }, danger: [{ name: "Kabuki", label: "Combat", color: "#f00" }]
  });
  assert.match(route, /Rush hour/);
  assert.match(route, /Northern Line/);
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});
