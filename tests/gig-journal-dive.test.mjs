/** Map gigs in Neon Hub's Journal, and security run from a NET Architecture (a Deep Dive). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, asGM } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const HOME = "cpr-neon-at-home";
const Settings = await registerSettings();
const D = await import("../scripts/security/security-data.js");
const { Security } = await import("../scripts/security/security.js");
const { Gigs, GigJournal } = await import("../scripts/hub/gigs.js");
const G = await import("../scripts/hub/gigs-data.js");
const { Hub } = await import("../scripts/hub/hub.js");
const { Cards } = await import("../scripts/combat/cards.js");

test("a device on a NET Architecture (pure): which Control Nodes run it", () => {
  const d = D.cleanDevice({ kind: "turret", arch: "Item.arch1", archFloor: " A5 ", controllers: ["n"], divers: ["n", "ghost"] });
  assert.deepEqual([d.arch, d.archFloor, d.divers], ["Item.arch1", "a5", ["n"]], "a diver who isn't on the node any more is dropped");
  assert.equal(D.runBy(d, "Item.arch1", "a5"), true);
  assert.equal(D.runBy(d, "Item.arch1", "a3"), false);
  assert.equal(D.runBy(d, "Item.other", "a5"), false);
  assert.equal(D.runBy({ ...d, archFloor: "" }, "Item.arch1", "b7"), true, "no floor named: any Control Node");
  assert.equal(D.runBy(D.cleanDevice({ kind: "turret" }), "", ""), false);
  assert.deepEqual(D.heldFloors({ floors: { a3: { eyed: true }, A5: { controlled: true } } }), ["a5"]);
});

test("a Deep Dive: taking a Control Node hands over its devices, a pass can be cut from the chair, and Jacking Out lets go", async () => {
  asGM(true);
  await Settings.set("security", true);
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  const scene = { id: "lab", name: "Biotechnica Lab", grid: { size: 100, units: "m", distance: 2 }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), flags: {} };
  const tile = (id, data) => {
    const doc = { id, x: 0, y: 0, width: 100, height: 100, rotation: 0, hidden: false, parent: scene, texture: { src: "" }, flags: { [M]: { security: data } }, async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; } };
    scene.tiles.set(id, doc);
    return doc;
  };
  tile("cam", { kind: "camera", arch: "Item.arch1" });
  tile("tur", { kind: "turret", arch: "Item.arch1", archFloor: "a5", key: "lab:guns" });
  tile("other", { kind: "camera", arch: "Item.arch2" });
  const runner = makeActor({ name: "Sable" });
  const prev = { post: Cards.post, scenes: game.scenes };
  const posted = [];
  Cards.post = async (c) => { posted.push(c); };
  game.scenes = Object.assign([scene], { get: (id) => (id === "lab" ? scene : null) });
  const dev = (id) => Security.device(scene, id).d;
  try {
    runner.flags[HOME] = { dive: { arch: "Item.arch1", name: "Lab subnet", floors: { a3: { controlled: true } } } };
    let taken = await Security.dived(runner);
    assert.deepEqual(taken.map((t) => t.id), ["cam"], "the turret answers to floor a5 only");
    assert.deepEqual([dev("cam").controllers, dev("cam").divers, dev("cam").key], [[runner.id], [runner.id], "arch:arch1"]);
    assert.equal(posted.length, 1);
    assert.deepEqual([posted[0].buttons[0].action, posted[0].buttons[0].data.tile], ["sec-pass", "cam"]);
    assert.deepEqual(await Security.dived(runner), [], "nothing new: no second card");

    // From the chair, with no token on the scene.
    assert.equal(await Security._pass({ scene: "lab", actor: runner.id, tile: "cam", self: true, to: [] }, "zz"), null, "not their character");
    const res = await Security._pass({ scene: "lab", actor: runner.id, tile: "cam", self: true, to: [] }, "gm1");
    assert.equal(res.made, true);
    assert.equal(Security.keysOf(runner).includes("arch:arch1"), true);

    runner.flags[HOME].dive.floors.a5 = { controlled: true };
    taken = await Security.dived(runner);
    assert.deepEqual(taken.map((t) => t.id), ["tur"]);
    assert.equal(dev("tur").key, "lab:guns", "its own tag is kept");
    assert.deepEqual(dev("other").controllers, [], "another architecture's");

    // Jacked Out: the nodes are let go; the shard still opens the camera.
    delete runner.flags[HOME].dive;
    await Security.dived(runner);
    assert.deepEqual([dev("cam").controllers, dev("cam").divers, dev("tur").controllers], [[], [], []]);
    assert.equal(Security.cleared(dev("cam"), runner), true, "by the pass they cut");
    assert.equal(Security.cleared(dev("tur"), runner), false);
  } finally {
    Cards.post = prev.post;
    game.scenes = prev.scenes;
  }
});

test("gigs and the Journal (pure): what's written, and what's read back", () => {
  const gig = G.cleanGig({ id: "g", title: "Courier", client: "Petrochem", reward: 900, text: "Carry <the> case.\nQuietly.", state: "taken", crew: ["a", "b"] });
  const out = G.toJournal(gig, { place: "The Afterlife", hub: { rewards: [{ id: "x1", kind: "ip", amount: 50 }, { id: G.PAY_ROW, kind: "eddies", amount: 1 }] } });
  assert.deepEqual([out.status, out.client, out.location, out.crew], ["active", "Petrochem", "The Afterlife", ["Actor.a", "Actor.b"]]);
  assert.deepEqual(out.rewards, [{ id: G.PAY_ROW, kind: "eddies", amount: 900, split: "split", paid: false }, { id: "x1", kind: "ip", amount: 50 }], "the Journal's own rewards are kept");
  assert.equal(out.briefing, "<p>Carry &lt;the&gt; case.<br>Quietly.</p>");
  assert.equal("briefing" in G.toJournal(gig, { hub: { rewards: [] }, before: gig }), false, "an unchanged briefing isn't written over the Journal's");
  assert.equal(G.toJournal({ ...gig, state: "done" }, {}).rewards[0].paid, true, "paid from the map: not the Journal's to pay again");

  const hub = { ...out, status: "active" };
  assert.deepEqual(G.fromJournal(hub, gig, { name: "Courier" }), {}, "in step");
  assert.deepEqual(G.fromJournal({ ...hub, status: "completed" }, gig), { state: "done" });
  assert.deepEqual(G.fromJournal({ ...hub, status: "found" }, { ...gig, state: "draft" }), {}, "a draft stays a draft");
  assert.deepEqual(G.fromJournal({ ...hub, crew: ["Actor.a"], client: "Zetatech" }, gig, { name: "Courier 2" }), { crew: ["a"], client: "Zetatech", title: "Courier 2" });
  const paid = G.fromJournal({ ...hub, rewards: [{ ...out.rewards[0], amount: 1200, split: "each", paid: true }] }, gig);
  assert.deepEqual(paid, { reward: 1200, perHead: true, paid: ["a", "b"] }, "paid in the Journal: not paid again from the map");
});

test("gigs and the Journal: an entry is made, follows the map, and the map follows it", async () => {
  asGM(true);
  await Settings.set("hubGigs", true);
  await Settings.set("hubGigJournal", true);
  await Settings.set("hubGigData", {});
  for (const a of [...game.actors]) game.actors.delete(a.id);
  const a = makeActor({ name: "Brick", owners: ["pl1"], system: { wealth: { value: 0 } } });
  // Neon Hub's api.journal, as 1.27.0 gives it.
  const entries = new Map();
  const journal = {
    createGig: async (name) => {
      const e = { id: `j${entries.size + 1}`, name, ownership: { default: 0 }, gig: { status: "found", client: "", location: "", briefing: "", crew: [], rewards: [] }, async update(u) { if (u.name) this.name = u.name; } };
      entries.set(e.id, e);
      return e;
    },
    gig: (e) => e.gig,
    saveGig: async (e, data) => (e.gig = { ...e.gig, ...data }),
    showToPlayers: async (e, on) => (e.ownership.default = on ? 2 : 0),
    open: (e) => e.id
  };
  game.modules.set("cpr-neon-hub", { id: "cpr-neon-hub", active: true, api: { journal } });
  const prev = { post: Cards.post, place: Hub.place, journal: game.journal };
  const posted = [];
  Cards.post = async (c) => { posted.push(c); };
  Hub.place = () => ({ key: "p1", name: "The Afterlife", x: 0, y: 0 });
  game.journal = { get: (id) => entries.get(id) ?? null };
  try {
    let gig = await Gigs.save({ title: "Courier", place: "p1", client: "Petrochem", reward: 400, text: "Carry the case." });
    const e = entries.get(gig.journal);
    assert.deepEqual([e.name, e.gig.status, e.gig.client, e.gig.location, e.ownership.default], ["Courier", "found", "Petrochem", "The Afterlife", 0], "a draft is the GM's");
    await Gigs.offer(gig.id);
    assert.equal(e.ownership.default, 2, "on the board: the players can read it");
    await Gigs.assign(gig.id, [a.id]);
    assert.deepEqual([e.gig.status, e.gig.crew], ["active", [`Actor.${a.id}`]]);
    assert.equal(entries.size, 1, "one entry, kept");

    // Renamed and re-priced in the Journal.
    e.name = "Courier run";
    e.gig.rewards = [{ ...e.gig.rewards[0], amount: 600 }];
    await GigJournal.pull(e);
    gig = Gigs.get(gig.id);
    assert.deepEqual([gig.title, gig.reward, gig.state], ["Courier run", 600, "taken"]);

    // Completed in the Journal: the word goes out and the pay with it, as from the map.
    e.gig.status = "completed";
    await GigJournal.pull(e);
    gig = Gigs.get(gig.id);
    assert.equal(gig.state, "done");
    assert.equal(a.system.wealth.value, 600);
    assert.equal(posted.at(-1).title, "Paid out: Courier run");
    assert.equal(e.gig.rewards[0].paid, true, "marked paid in the Journal");
    assert.equal(await GigJournal.pull(e), null, "in step: nothing more to do");

    // Reopened there: back in hand here, and nobody is paid twice.
    e.gig.status = "active";
    await GigJournal.pull(e);
    assert.equal(Gigs.get(gig.id).state, "taken");
    await Gigs.finish(gig.id, true);
    assert.equal(a.system.wealth.value, 600);

    await Settings.set("hubGigJournal", false);
    const plain = await Gigs.save({ title: "Off the books", place: "p1" });
    assert.equal(plain.journal, "");
    assert.equal(entries.size, 1);
  } finally {
    Cards.post = prev.post;
    Hub.place = prev.place;
    game.journal = prev.journal;
    game.modules.delete("cpr-neon-hub");
    await Settings.set("hubGigJournal", true);
  }
});

test("camera feeds from anywhere: which a character may watch, and who the GM brings to a scene", async () => {
  asGM(true);
  await Settings.set("security", true);
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  const mk = (id, name, active = false) => ({ id, name, active, grid: { size: 100, units: "m", distance: 2 }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), flags: {} });
  const lab = mk("lab", "Biotechnica Lab");
  const street = mk("street", "Street", true);
  const tile = (scene, id, data) => scene.tiles.set(id, { id, x: 0, y: 0, width: 100, height: 100, rotation: 0, hidden: false, parent: scene, texture: { src: "" }, flags: { [M]: { security: data } }, async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; } });
  for (const a of [...game.actors]) game.actors.delete(a.id);
  const runner = makeActor({ name: "Sable", owners: ["pl1"] });
  tile(lab, "cam1", { kind: "camera", controllers: [runner.id] });
  tile(lab, "cam2", { kind: "camera", controllers: [runner.id], on: false });
  tile(lab, "cam3", { kind: "camera" });
  tile(lab, "tur", { kind: "turret", controllers: [runner.id] });
  const prev = { scenes: game.scenes, socket: game.socket, canvas: globalThis.canvas };
  const pulls = [];
  game.scenes = Object.assign([lab, street], { get: (id) => [lab, street].find((s) => s.id === id) ?? null });
  game.socket = { ...(prev.socket ?? {}), emit: (...args) => pulls.push(args), on() {} };
  try {
    assert.deepEqual(Security.feeds(runner), [{ scene: "lab", sceneName: "Biotechnica Lab", tile: "cam1", name: "CAM 01" }], "theirs, working, and a camera");
    assert.deepEqual(await Security._feed({ scene: "lab", tile: "cam1" }, "pl1"), { ok: true });
    assert.deepEqual(pulls.at(-1), ["pullToScene", "lab", "pl1"]);
    assert.deepEqual(await Security._feed({ scene: "lab", tile: "cam3" }, "pl1"), { ok: false }, "not theirs to watch");
    assert.deepEqual(await Security._feed({ scene: "lab", tile: "tur" }, "pl1"), { ok: false }, "not a camera");
    assert.deepEqual(await Security._feed({ scene: "lab" }, "pl1"), { ok: false }, "no camera named: only home");
    assert.deepEqual(await Security._feed({ scene: "street" }, "pl1"), { ok: true }, "back to the active scene");
    assert.deepEqual(await Security._feed({ scene: "lab", tile: "cam1" }, "zz"), { ok: false }, "nobody we know");
    assert.equal(pulls.length, 2);

    // On this client: a feed on another scene waits for the scene, opens, and remembers the way back.
    const seen = [];
    const view = Security.view;
    Security.view = (id) => (seen.push(id), true);
    globalThis.canvas = { scene: street };
    lab.view = async () => ((globalThis.canvas = { scene: lab }), true);
    try {
      assert.equal(await Security.watch("lab", "cam1"), true);
      assert.deepEqual(seen, [], "not until the scene is up");
      assert.equal(Security.arrived(), true);
      assert.deepEqual([seen, Security.home, Security.pending], [["cam1"], "street", null]);
      assert.equal(await Security.watch("lab", "cam1"), true, "already there: straight to the feed");
      assert.equal(seen.length, 2);
    } finally {
      Security.view = view;
      Security.home = null;
    }
  } finally {
    game.scenes = prev.scenes;
    game.socket = prev.socket;
    globalThis.canvas = prev.canvas;
  }
});
