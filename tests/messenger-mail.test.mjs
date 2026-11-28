/** Night City Messenger letters: pass shards for security, and gigs on the city map. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, asGM, fakeMessenger, testUsers } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const NCM = "night-city-messenger";
const Settings = await registerSettings();
const D = await import("../scripts/security/security-data.js");
const { Security } = await import("../scripts/security/security.js");
const { Mail, trimMail } = await import("../scripts/comms/mail.js");
const { Gigs } = await import("../scripts/hub/gigs.js");
const G = await import("../scripts/hub/gigs-data.js");
const { Hub } = await import("../scripts/hub/hub.js");
const { Cards } = await import("../scripts/combat/cards.js");
const { Socket } = await import("../scripts/socket.js");
Socket.on("secPass", (d, u) => Security._pass(d, u));
Socket.on("secClaim", (d, u) => Security._claim(d, u));
Gigs.init();
Mail.register("pass", (e, m, c) => Security.passButtons(e, m, c));

/** NCM's api v2 as 2.5.0 gives it: letters, buttons, key tags, shards. */
function messenger({ buttons = true, refuse = () => false } = {}) {
  const ncm = fakeMessenger({ contacts: [{ id: "fix1", actorId: null }] });
  const v2 = game.modules.get(NCM).api.v2;
  const sent = [];
  const tags = new Map();
  const shardEntries = [];
  let provider = null;
  v2.messages = {
    send: async (o) => {
      if (refuse(o)) return { ok: false, code: "FAILED", error: "No signal." };
      sent.push(o);
      return { ok: true, data: { messageId: `m${sent.length}` } };
    },
    refresh: async () => ({ ok: true, data: { redrawn: 0 } })
  };
  if (buttons) v2.messages.addActions = async (fn, { id } = {}) => ((provider = fn), { ok: true, data: { id } });
  v2.directory.list = async () => ({ ok: true, data: [{ id: "c2", name: "Zed", role: "Tech" }, { id: "fix1", name: "Mama Ko", role: "Fixer" }] });
  v2.directory.pushToPlayer = async (contactId, actorId) => ({ ok: true, data: { contactId, actorId } });
  v2.items = { setKeyTag: async (uuid, tag) => (tags.set(uuid, tag), { ok: true, data: { keyTag: tag } }) };
  v2.shards = { addEntry: async (uuid, e) => (shardEntries.push([uuid, e]), { ok: true, data: { messageId: "s1" } }) };
  game.nightcity.messenger.convertToDataShard = async () => ({ success: true });
  return { ...ncm, sent, tags, shardEntries, under: (m, c) => provider?.(m, c) };
}

test("letters (pure): only the newest are remembered", () => {
  const all = { a: { at: 1 }, b: { at: 3 }, c: { at: 2 } };
  assert.deepEqual(Object.keys(trimMail(all, 2)).sort(), ["b", "c"]);
  assert.deepEqual(trimMail(all, 5), all);
});

test("a pass tag (pure): whoever carries it is let be", () => {
  const cam = D.cleanDevice({ kind: "camera", key: "  arasaka:lobby  " });
  assert.equal(cam.key, "arasaka:lobby");
  assert.equal(D.friendly(cam, "a"), false);
  assert.equal(D.friendly(cam, "a", ["arasaka:lobby"]), true);
  assert.equal(D.friendly(cam, "a", ["other"]), false);
  assert.equal(D.friendly(D.cleanDevice({ kind: "camera" }), "a", [""]), false, "no tag: nothing opens it");
});

test("pass shards: a netrunner on the node cuts one, sends it by letter, and the reader loads it once", async () => {
  asGM(true);
  await Settings.set("security", true);
  await Settings.set("ncmMail", {});
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  const scene = { id: "site1", name: "Biotechnica Lab", grid: { size: 100, units: "m", distance: 2 }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), flags: {} };
  const runner = makeActor({ name: "Sable" });
  const solo = makeActor({ name: "Brick", owners: ["pl1"] });
  const tile = (id, data) => {
    const doc = { id, x: 0, y: 0, width: 100, height: 100, rotation: 0, hidden: false, parent: scene, texture: { src: "" }, flags: { [M]: { security: data } }, async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; } };
    scene.tiles.set(id, doc);
    return doc;
  };
  tile("cam", { kind: "camera", controllers: [runner.id] });
  tile("tur", { kind: "turret" });
  scene.tokens.set("tk", { id: "tk", name: "Sable", parent: scene, actor: runner, isOwner: true, testUserPermission: () => true });
  const prev = { post: Cards.post, scenes: game.scenes };
  const posted = [];
  Cards.post = async (c) => { posted.push(c); };
  game.scenes = { get: () => scene };
  const ncm = messenger();
  try {
    await Mail.ready();
    const cam = () => Security.device(scene, "cam");
    assert.equal(Security.cleared(cam().d, solo), false);
    assert.equal(await Security._pass({ scene: "site1", token: "tk", tile: "tur", self: true, to: [] }, "gm1"), null, "not on that node");

    const res = await Security._pass({ scene: "site1", token: "tk", tile: "cam", self: true, to: [solo.id, "nobody"] }, "gm1");
    assert.deepEqual([res.made, res.sent, res.failed], [true, ["Brick"], []]);
    assert.equal(cam().d.key, "site:site1", "the device takes the scene's tag");
    const shard = runner.items.contents.find((i) => i.flags?.[M]?.securityPass);
    assert.deepEqual([shard.name, shard.type, shard.flags[M].securityPass], ["Security pass: Biotechnica Lab", "gear", "site:site1"]);
    assert.equal(ncm.tags.get(shard.uuid), "site:site1", "one of Night City Messenger's key items too");
    assert.equal(ncm.shardEntries.length, 1, "and written on it as a data shard");
    assert.deepEqual([ncm.sent[0].fromActorId, ncm.sent[0].toActorId, ncm.sent[0].subject], [runner.id, solo.id, "Security pass: Biotechnica Lab"]);
    assert.equal(posted.length, 1);

    // The letter's button, in the reader's inbox only.
    assert.equal(ncm.under({ id: "m1" }, { actorId: runner.id }), null, "someone else's inbox");
    const [load] = ncm.under({ id: "m1" }, { actorId: solo.id });
    assert.equal(load.label, "Load onto a shard");
    assert.deepEqual(await Security._claim({ message: "m1" }, "zz"), { ok: false }, "not theirs");
    await load.run();
    assert.equal(Security.keysOf(solo).includes("site:site1"), true);
    assert.equal(Security.cleared(cam().d, solo), true, "the camera lets them be");
    assert.equal(Security.cleared(Security.device(scene, "tur").d, solo), false, "the turret has no tag");
    assert.deepEqual(ncm.under({ id: "m1" }, { actorId: solo.id }).actions, [], "once");
    assert.deepEqual(await Security._claim({ message: "m1" }, "gm1"), { ok: false });
    assert.equal(solo.items.contents.filter((i) => i.flags?.[M]?.securityPass).length, 1);

    // A key item of Night City Messenger's with the same tag works as a pass.
    const fixer = makeActor({ name: "Vex" });
    await fixer.createEmbeddedDocuments("Item", [{ name: "Staff card", type: "gear", flags: { [NCM]: { keyTag: "site:site1" } } }]);
    assert.equal(Security.cleared(cam().d, fixer), true);
  } finally {
    Cards.post = prev.post;
    game.scenes = prev.scenes;
    Mail.hooked = false;
    ncm.off();
  }
});

test("gigs (pure): who may take one, and who gets what", () => {
  const g = G.cleanGig({ id: "g1", title: " Courier ", reward: "1000.4", state: "nope", crew: ["a", "a", "b", "c"] });
  assert.deepEqual([g.title, g.reward, g.state, g.crew], ["Courier", 1000, "draft", ["a", "b", "c"]]);
  assert.deepEqual(G.shares(g), { a: 334, b: 333, c: 333 }, "split, the odd eddie to the first");
  assert.deepEqual(G.shares({ ...g, perHead: true }), { a: 1000, b: 1000, c: 1000 });
  assert.deepEqual(G.shares({ ...g, crew: [] }), {});
  assert.equal(G.canTake({ ...g, state: "offered" }, "z"), true);
  assert.equal(G.canTake({ ...g, state: "offered" }, "a"), false, "already on it");
  assert.equal(G.canTake(g, "z"), false, "a draft isn't on the board");
  assert.equal(G.seenBy({ ...g, state: "done" }, ["b"]), true);
  assert.equal(G.seenBy({ ...g, state: "done" }, ["z"]), false);
  assert.deepEqual(G.movesFor({ state: "taken" }).slice(0, 2), ["done", "failed"]);
});

test("gigs: the fixer writes to the crew, a character takes it from the letter, and collects the pay once", async () => {
  asGM(true);
  await Settings.set("hubGigs", true);
  await Settings.set("hubGigData", {});
  await Settings.set("ncmMail", {});
  for (const a of [...game.actors]) game.actors.delete(a.id);
  const a = makeActor({ name: "Brick", owners: ["pl1"], system: { wealth: { value: 100 } } });
  const b = makeActor({ name: "Sable", owners: ["pl1"], system: { wealth: { value: 0 } } });
  const prev = { post: Cards.post, place: Hub.place, open: Hub.open };
  const posted = [];
  Cards.post = async (c) => { posted.push(c); };
  Hub.place = (key) => (key === "p1" ? { key: "p1", name: "The Afterlife", x: 10, y: 20, hidden: false } : null);
  const opened = [];
  Hub.open = async (o) => opened.push(o);
  const ncm = messenger({ refuse: (o) => o.toActorId === b.id && /Paid out/.test(o.subject) });
  try {
    await Mail.ready();
    assert.deepEqual((await Mail.contacts()).map((c) => c.name), ["Mama Ko", "Zed"], "fixers first");
    const gig = await Gigs.save({ title: "Courier", place: "p1", client: "Petrochem", fixer: "fix1", fixerName: "Mama Ko", reward: 501, text: "Carry the case.", note: "It's a bomb." });
    assert.equal(Gigs.visible(testUsers.player).length, 0, "a draft is the GM's");
    await Gigs.offer(gig.id);
    assert.deepEqual(ncm.sent.map((m) => [m.fromContactId, m.toActorId, m.subject]), [["fix1", a.id, "Work: Courier"], ["fix1", b.id, "Work: Courier"]]);
    assert.match(ncm.sent[0].body, /Petrochem[\s\S]*The Afterlife[\s\S]*501 eb[\s\S]*Carry the case\./);
    assert.doesNotMatch(ncm.sent[0].body, /bomb/, "the GM's note is never sent");
    assert.equal(Gigs.visible(testUsers.player).length, 1);

    const under = ncm.under({ id: "m1" }, { actorId: a.id });
    assert.deepEqual(under.actions.map((x) => x.label), ["Take the gig", "Show on the map"]);
    await under.actions[1].run();
    assert.deepEqual(opened[0].focus, { key: "p:p1", x: 10, y: 20 });
    await under.actions[0].run();
    assert.deepEqual([Gigs.get(gig.id).state, Gigs.get(gig.id).crew], ["taken", [a.id]]);
    assert.equal(ncm.sent.at(-1).subject, "Confirmed: Courier");
    assert.deepEqual(ncm.under({ id: "m1" }, { actorId: a.id }).actions.map((x) => x.label), ["Show on the map"], "they're on it");
    assert.deepEqual(ncm.under({ id: "m2" }, { actorId: b.id }).actions.map((x) => x.label), ["Join the crew on it", "Show on the map"]);
    await Gigs.assign(gig.id, [b.id, a.id]);
    assert.deepEqual(Gigs.get(gig.id).crew, [a.id, b.id]);

    await Gigs.finish(gig.id, true);
    assert.equal(Gigs.get(gig.id).state, "done");
    // Brick's letter landed: the pay waits for the button. Sable's didn't: a chat card, and the pay goes straight in.
    assert.equal(a.system.wealth.value, 100);
    assert.equal(b.system.wealth.value, 250);
    assert.equal(posted.at(-1).title, "Paid out: Courier");
    const payMail = ncm.sent.findLast((m) => m.toActorId === a.id);
    assert.match(payMail.body, /251 eb/);
    const id = `m${ncm.sent.indexOf(payMail) + 1}`;
    const [collect] = ncm.under({ id }, { actorId: a.id });
    assert.equal(collect.label, "Collect 251 eb");
    await collect.run();
    assert.equal(a.system.wealth.value, 351);
    assert.deepEqual(await Gigs._claim({ message: id }, "gm1"), { ok: false }, "once");
    assert.equal(a.system.wealth.value, 351);
    assert.equal(await Gigs.finish(gig.id, false), null, "it's over");

    // A place by letter.
    const n = await Gigs.sendPlace("p1", { contactId: "fix1", contactName: "Mama Ko", note: "Back door." });
    assert.equal(n, 2);
    assert.equal(ncm.sent.at(-1).subject, "Location: The Afterlife");
    assert.deepEqual(ncm.under({ id: `m${ncm.sent.length}` }, { actorId: b.id }).map((x) => x.label), ["Show on the map"]);
  } finally {
    Cards.post = prev.post;
    Hub.place = prev.place;
    Hub.open = prev.open;
    Mail.hooked = false;
    ncm.off();
  }
});

test("gigs without Night City Messenger: chat cards, and the pay goes straight in", async () => {
  asGM(true);
  await Settings.set("hubGigData", {});
  for (const a of [...game.actors]) game.actors.delete(a.id);
  const a = makeActor({ name: "Brick", owners: ["pl1"], system: { wealth: { value: 0 } } });
  const prev = { post: Cards.post, place: Hub.place };
  const posted = [];
  Cards.post = async (c) => { posted.push(c); };
  Hub.place = () => ({ key: "p1", name: "The Afterlife", x: 0, y: 0 });
  try {
    assert.equal(Mail.on, false);
    const gig = await Gigs.save({ title: "Escort", place: "p1", reward: 300, perHead: true });
    await Gigs.offer(gig.id);
    assert.deepEqual((await Gigs._take({ id: gig.id, actorId: a.id }, "zz")), { ok: false }, "not their character");
    assert.deepEqual((await Gigs._take({ id: gig.id, actorId: a.id }, "pl1")), { ok: true });
    await Gigs.finish(gig.id, true);
    assert.deepEqual(posted.map((c) => c.title), ["Work: Escort", "Confirmed: Escort", "Paid out: Escort"]);
    assert.equal(a.system.wealth.value, 300);
    assert.deepEqual(Gigs.get(gig.id).paid, [a.id]);
  } finally {
    Cards.post = prev.post;
    Hub.place = prev.place;
  }
});
