/** Neon Chat: formatting, commands, merging, the Adventure Log's parsing, portraits and the stage. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, asGM, testUsers, chat, notes, missingKeys } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { format, hasFormatting } = await import("../scripts/chat/format.js");
const { Commands, parse, matching } = await import("../scripts/chat/commands.js");
const { Chat, merges } = await import("../scripts/chat/chat.js");
const { parseLog, entryHtml } = await import("../scripts/chat/log.js");
const { portraitOf } = await import("../scripts/chat/portraits.js");
const { Stage, castChange, readTime, MOODS } = await import("../scripts/chat/stage.js");
const { Socket } = await import("../scripts/socket.js");
Chat.registerSocket();

const { player } = testUsers;

/* ---------------------------------------- */
/*  Formatting                              */
/* ---------------------------------------- */

test("Discord formatting: bold, italic, underline, strike, spoilers, code, quotes, headings, lists, links", () => {
  assert.equal(format("**bold** *it* _it_ ***both***"), "<strong>bold</strong> <em>it</em> <em>it</em> <strong><em>both</em></strong>");
  assert.equal(format("__u__ ~~s~~ ||secret||"), '<u>u</u> <s>s</s> <span class="ncm-spoiler" tabindex="0">secret</span>');
  assert.equal(format("`**raw**`"), "<code>**raw**</code>", "nothing formats inside code");
  assert.equal(format("```js\nif (a < b) {}\n```"), '<pre class="ncm-code"><code data-lang="js">if (a &lt; b) {}</code></pre>');
  assert.equal(format("> one\n> two\nthree"), '<blockquote class="ncm-quote">one<br>two</blockquote>three');
  assert.equal(format(">>> all\nof it"), '<blockquote class="ncm-quote">all<br>of it</blockquote>');
  assert.equal(format("# Big\n-# small"), '<h3 class="ncm-h">Big</h3><small class="ncm-sub">small</small>');
  assert.equal(format("- a\n- b\n1. c"), "<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>");
  assert.equal(format("[The Afterlife](https://example.com/x_y)"), '<a href="https://example.com/x_y" target="_blank" rel="noopener nofollow">The Afterlife</a>');
  assert.equal(format("line one\nline two"), "line one<br>line two");
});

test("formatting leaves alone what isn't formatting: words with underscores, maths, HTML, enrichers, inline rolls, escapes", () => {
  assert.equal(format("snake_case_name 2*3*4"), "snake_case_name 2*3*4");
  assert.equal(format('<span class="x_y">*hi*</span>'), '<span class="x_y"><em>hi</em></span>');
  assert.equal(format("@UUID[Actor.a_b]{Rogue_x} [[/r 2d6*2]]"), "@UUID[Actor.a_b]{Rogue_x} [[/r 2d6*2]]");
  assert.equal(format('<a class="inline-roll roll" data-tooltip="2d6*2">*7*</a>'), '<a class="inline-roll roll" data-tooltip="2d6*2">*7*</a>');
  assert.equal(format("\\*not italic\\*"), "*not italic*");
  assert.equal(hasFormatting("just talking"), false);
  assert.equal(hasFormatting("so **loud**"), true);
});

/* ---------------------------------------- */
/*  Commands                                */
/* ---------------------------------------- */

test("commands: parsing, matching, roles, and what a callback sends", async () => {
  Commands.list.clear();
  Commands.registerCore();
  const seen = [];
  Commands.register({ name: "/Shout", aliases: ["/sh", "!"], description: "Shout it", callback: (c, p) => (seen.push(p), { content: p.toUpperCase() }) });
  Commands.register({ name: "/boss", requiredRole: "GAMEMASTER", callback: () => ({}) });
  Commands.register({ name: "/pass", callback: () => null });
  const cmds = [...Commands.list.values()];
  assert.equal(parse("/sh  hello there", cmds).parameters, "hello there");
  assert.equal(parse("!now", cmds).command.name, "/shout", "a one-character alias needs no space");
  assert.deepEqual(matching("/r", cmds).map((c) => c.name).slice(0, 2), ["/roll", "/reply"]);
  const before = chat.length;
  assert.equal(Commands.handle(null, "/shout run", { speaker: { alias: "Vee" } }), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(chat.at(-1).content, "RUN");
  assert.equal(chat.at(-1).speaker.alias, "Vee", "merged over the message data");
  assert.equal(chat.length, before + 1);
  assert.equal(Commands.handle(null, "/pass x", {}), true, "null: Foundry handles it");
  assert.equal(Commands.handle(null, "/roll 1d10", {}), true, "Foundry's own commands are Foundry's");
  asGM(false);
  assert.equal(Commands.handle(null, "/boss", {}), false);
  assert.match(notes.at(-1)[1], /can't use \/boss/);
  assert.equal(Commands.available().some((c) => c.name === "/boss"), false, "not in a player's menu");
  asGM(true);
});

test("Chat Commander's game.chatCommands is there without it; this module's commands are registered", async () => {
  delete game.chatCommands;
  Commands.list.clear();
  await Chat.ready();
  assert.equal(typeof game.chatCommands.register, "function");
  for (const n of ["/log", "/archive", "/plot", "/cond", "/stage", "/as", "/mood", "/narrate", "/curtain"]) assert.ok(Commands.list.has(n), n);
  assert.ok(Commands.list.get("/roll").core);
});

/* ---------------------------------------- */
/*  Sending and the log                     */
/* ---------------------------------------- */

test("a typed message is marked and formatted on its way out; rolls and cards aren't", () => {
  const make = (data) => ({ ...data, flags: data.flags ?? {}, rolls: data.rolls ?? [], updateSource(u) {
    for (const [k, v] of Object.entries(u)) {
      if (k.startsWith("flags.")) {
        const [, scope, key] = k.split(".");
        (this.flags[scope] ??= {})[key] = v;
      } else this[k] = v;
    }
  } });
  Chat.onChatMessage(null, "**on my way**", {});
  const m = make({ content: "**on my way**" });
  Chat.onPreCreate(m, {}, {}, game.user.id);
  assert.equal(m.content, "<strong>on my way</strong>");
  assert.deepEqual(m.flags["cpr-neon-combat-manager"], { chat: true, raw: "**on my way**" });
  // Foundry's /ooc still counts as typed.
  Chat.onChatMessage(null, "/ooc *brb*", {});
  const ooc = make({ content: "*brb*" });
  Chat.onPreCreate(ooc, {}, {}, game.user.id);
  assert.equal(ooc.content, "<em>brb</em>");
  // Not typed here: left alone.
  const card = make({ content: "**x**" });
  Chat.onPreCreate(card, {}, {}, game.user.id);
  assert.equal(card.content, "**x**");
});

test("merging: the same speaker, typed, the same audience, a few minutes apart", () => {
  const msg = (o) => ({ flags: { "cpr-neon-combat-manager": { chat: true } }, rolls: [], author: { id: "u1" }, speaker: { alias: "Vee" }, whisper: [], timestamp: 0, ...o });
  assert.equal(merges(msg({}), msg({ timestamp: 60000 })), true);
  assert.equal(merges(msg({}), msg({ timestamp: 600000 })), false, "too far apart");
  assert.equal(merges(msg({}), msg({ speaker: { alias: "Hazel" } })), false);
  assert.equal(merges(msg({}), msg({ whisper: ["gm1"] })), false);
  assert.equal(merges(msg({ flags: {} }), msg({})), false, "a card or roll doesn't merge");
});

test("the Adventure Log reads events and quotes", () => {
  assert.deepEqual(parseLog("The van blew up"), { quote: false, source: "", text: "The van blew up" });
  assert.deepEqual(parseLog("e Rogue paid up"), { quote: false, source: "", text: "Rogue paid up" });
  assert.deepEqual(parseLog('q "Johnny Silverhand" Wake up, Samurai'), { quote: true, source: "Johnny Silverhand", text: "Wake up, Samurai" });
  assert.deepEqual(parseLog("quote Rogue Pay me"), { quote: true, source: "Rogue", text: "Pay me" });
  assert.equal(entryHtml(parseLog("q Rogue <b>Pay</b>"), "Vee", "2070-01-01 21:00"),
    '<p class="ncm-log-entry"><span class="ncm-log-time">[2070-01-01 21:00]</span> <span class="ncm-log-who">(Vee)</span> Rogue said: “&lt;b&gt;Pay&lt;/b&gt;”</p>');
});

test("portraits: the token's art or the actor's; a player out of character gets their avatar", () => {
  const vee = makeActor({ name: "Vee", img: "vee.png" });
  vee.prototypeToken = { texture: { src: "vee-token.png" } };
  assert.equal(portraitOf({ speaker: { actor: vee.id } }, "token"), "vee-token.png");
  assert.equal(portraitOf({ speaker: { actor: vee.id } }, "actor"), "vee.png");
  assert.equal(portraitOf({ speaker: {}, author: { avatar: "me.png" } }), "me.png");
});

/* ---------------------------------------- */
/*  The stage                               */
/* ---------------------------------------- */

test("the cast: characters alternate sides, change expression, turn, and leave", () => {
  let cast = castChange([], { op: "add", actorId: "a", name: "Vee" });
  cast = castChange(cast, { op: "add", actorId: "b", name: "Rogue" });
  cast = castChange(cast, { op: "add", actorId: "c", name: "Hazel" });
  assert.deepEqual(cast.map((c) => c.side), ["left", "right", "left"]);
  assert.equal(castChange(cast, { op: "add", actorId: "a" }).length, 3, "once");
  cast = castChange(cast, { op: "mood", actorId: "b", mood: "angry" });
  assert.equal(cast[1].mood, "angry");
  assert.equal(castChange(cast, { op: "mood", actorId: "b", mood: "bored" })[1].mood, "angry", "only known expressions");
  assert.equal(castChange(cast, { op: "flip", actorId: "a" })[0].flip, true);
  assert.equal(castChange(cast, { op: "side", actorId: "a" })[0].side, "right");
  assert.deepEqual(castChange(cast, { op: "remove", actorId: "b" }).map((c) => c.id), ["a", "c"]);
  assert.deepEqual(castChange(cast, { op: "clear" }), []);
  assert.ok(readTime("hi") >= 5000 && readTime("x".repeat(1000)) <= 20000);
  assert.ok("thinking" in MOODS);
});

test("staging: players put their own characters on; speaking as one makes what you type theirs", async () => {
  const vee = makeActor({ name: "Vee", owners: [player.id] });
  const rogue = makeActor({ name: "Rogue", hasPlayerOwner: false });
  await Settings.set("stageCast", { cast: [] });
  await Socket.handlers.get("stageSet")({ op: "add", actorId: vee.id }, player.id);
  await assert.rejects(Socket.handlers.get("stageSet")({ op: "add", actorId: rogue.id }, player.id), /isn't yours/);
  await assert.rejects(Socket.handlers.get("stageSet")({ op: "clear" }, player.id), /isn't yours/, "only the GM clears the stage");
  assert.deepEqual(Stage.cast.map((c) => [c.name, c.side]), [["Vee", "left"]]);
  Stage.speakAs(vee.id);
  assert.deepEqual(Stage.speakerFor({}), { speaker: { scene: null, token: null, actor: vee.id, alias: "Vee" } });
  const data = { speaker: { alias: "Player" } };
  Chat.onChatMessage(null, "Let's go", data);
  assert.equal(data.speaker.actor, vee.id, "the chat box speaks as Vee");
  // Their line goes up on stage; out of character doesn't.
  Stage.onMessage({ visible: true, speaker: { actor: vee.id }, content: "<em>Let's go</em>", style: 2, flags: {} });
  assert.equal(Stage.lines.get(vee.id).text, "Let's go");
  Stage.lines.clear();
  Stage.onMessage({ visible: true, speaker: { actor: vee.id }, content: "brb", style: 1, flags: {} });
  assert.equal(Stage.lines.size, 0);
  Stage.speakAs(null);
  for (const l of Stage.lines.values()) clearTimeout(l.timer);
  await Settings.set("stageCast", { cast: [] });
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});
