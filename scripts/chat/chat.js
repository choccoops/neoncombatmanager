import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { format, hasFormatting } from "./format.js";
import { Commands, CHAT_COMMANDER_ID } from "./commands.js";
import { CommandMenu } from "./autocomplete.js";
import { Portraits } from "./portraits.js";
import { AdventureLog, parseLog, archiveChat } from "./log.js";
import { Stage, MOODS } from "./stage.js";
import { L, esc } from "../util.js";

/** Messages closer than this (ms) from the same speaker merge. */
const MERGE_GAP = 5 * 60 * 1000;
/** Foundry's commands that send what you typed as a message. */
const TALK = /^\/(ic|ooc|emote|em|me|w|whisper|reply|gm|players)\b/i;
const PRIVACY = [["publicroll", "fa-solid fa-users"], ["gmroll", "fa-solid fa-user-secret"], ["blindroll", "fa-solid fa-eye-slash"], ["selfroll", "fa-solid fa-user"]];

/** A message someone typed (not a roll, not a card): formatted, mergeable, editable. */
export const isTyped = (m) => !!m?.flags?.[MODULE_ID]?.chat && !m.rolls?.length;

/**
 * Should two messages merge (the second shown without its header)? Same author and speaker,
 * both typed, the same audience, a few minutes apart.
 */
export function merges(prev, next, gap = MERGE_GAP) {
  if (!prev || !next || !isTyped(prev) || !isTyped(next)) return false;
  const who = (m) => `${m.author?.id ?? m.user?.id ?? m.author ?? ""}|${m.speaker?.actor ?? ""}|${m.speaker?.alias ?? ""}`;
  const aud = (m) => [...(m.whisper ?? [])].sort().join(",");
  return who(prev) === who(next) && aud(prev) === aud(next) && Math.abs((next.timestamp ?? 0) - (prev.timestamp ?? 0)) <= gap;
}

/**
 * Neon Chat: Discord-style formatting, merged messages, editing what you sent, roll privacy as
 * buttons, portraits, an adventure log and chat archives, one place for chat commands (with a
 * completion menu), and the stage (stage.js).
 */
export const Chat = {
  /** The last thing typed in the chat box (for the next message this client creates). */
  _typed: null,

  init() {
    Stage.init();
    Hooks.on("chatMessage", (log, text, data) => this.onChatMessage(log, text, data));
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => this.onPreCreate(message, data, options, userId));
    Hooks.on(Compat.chatRenderHook, (message, html) => this.onRender(message, html));
    Hooks.on("renderChatLog", (app, html) => this.onRenderLog(html));
    Hooks.on("clientSettingChanged", (key) => key === "core.rollMode" && this.markPrivacy());
    for (const hook of ["getChatLogEntryContext", "getChatMessageContextOptions"]) Hooks.on(hook, (html, options) => this.contextMenu(options));
    for (const hook of ["getActorDirectoryEntryContext", "getActorContextOptions"]) Hooks.on(hook, (html, options) => this.actorMenu(options));
    game.keybindings.register(MODULE_ID, "editLastMessage", {
      name: `${LANG}.Chat.EditLast`,
      hint: `${LANG}.Chat.EditLastHint`,
      editable: [],
      onDown: () => {
        this.editLast();
        return true;
      }
    });
  },

  ready() {
    // Chat Commander's game.chatCommands, unless that module is here to give it.
    if (!game.modules.get(CHAT_COMMANDER_ID)?.active) {
      if (!game.chatCommands) game.chatCommands = Commands.api;
      Commands.registerCore();
    }
    this.registerCommands();
    if (!Commands.external) Hooks.callAll("chatCommandsReady", game.chatCommands);
    if (typeof document !== "undefined") this.onRenderLog(document);
    Stage.render();
  },

  registerSocket() {
    AdventureLog.registerSocket();
    Stage.registerSocket();
  },

  /* ---------------------------------------- */
  /*  Sending                                 */
  /* ---------------------------------------- */

  /** The chatMessage hook: commands, narration, speaking as someone on stage. */
  onChatMessage(log, text, data) {
    const t = String(text ?? "");
    if (t.trim().startsWith("/") || t.trim().startsWith("@")) {
      this._typed = null;
      const go = Commands.handle(log, t, data);
      // Foundry's own talking commands (/ooc, /em, /w...) still make typed messages.
      if (go !== false && TALK.test(t.trim())) this._typed = { at: Date.now() };
      return go;
    }
    if (Stage.narrating && game.user.isGM && Stage.enabled) {
      this.narrate(t);
      return false;
    }
    const as = Stage.speakerFor(data);
    if (as) Object.assign(data, as);
    this._typed = { at: Date.now() };
    return true;
  },

  /** On the sender's client, as a typed message is made: mark it, format it. */
  onPreCreate(message, data, options, userId) {
    if (userId !== game.user.id) return;
    const typed = this._typed && Date.now() - this._typed.at < 3000;
    if (!typed) return;
    if (message.rolls?.length || message.flags?.[MODULE_ID]?.card) return;
    this._typed = null;
    const raw = String(message.content ?? "");
    const changes = { [`flags.${MODULE_ID}.chat`]: true, [`flags.${MODULE_ID}.raw`]: raw };
    if (Settings.get("chatFormatting") && hasFormatting(raw)) changes.content = format(raw);
    message.updateSource(changes);
  },

  /** GM: a line of narration (in chat, and across the stage). */
  narrate(text) {
    if (!game.user.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    const content = Settings.get("chatFormatting") ? format(text) : text;
    return ChatMessage.create({ content, speaker: { alias: L(`${LANG}.Stage.Narrator`) }, flags: { [MODULE_ID]: { narration: true } } });
  },

  /* ---------------------------------------- */
  /*  The log                                 */
  /* ---------------------------------------- */

  onRender(message, html) {
    const el = Compat.element(html);
    if (!el) return;
    const flags = message.flags?.[MODULE_ID] ?? {};
    if (flags.narration) el.classList.add("ncm-narration-msg");
    if (flags.edited) el.querySelector(".message-header .message-metadata")?.insertAdjacentHTML("afterbegin", `<span class="ncm-edited">${esc(L(`${LANG}.Chat.Edited`))}</span>`);
    Portraits.decorate(message, el);
    if (Settings.get("chatMerge")) {
      const list = game.messages?.contents ?? [];
      const i = list.findIndex((m) => m.id === message.id);
      if (i > 0 && merges(list[i - 1], message)) el.classList.add("ncm-merged");
    }
    // Spoilers: click to show.
    for (const s of el.querySelectorAll(".ncm-spoiler")) s.addEventListener("click", () => s.classList.add("is-shown"));
  },

  onRenderLog(html) {
    const root = Compat.element(html) ?? document;
    if (!Commands.external && Settings.get("chatCommandMenu")) CommandMenu.attach(root);
    this.privacyButtons(root);
    for (const input of root.querySelectorAll?.("textarea#chat-message") ?? []) {
      if (input._ncmEdit) continue;
      input._ncmEdit = true;
      // Up in an empty chat box: edit your last message.
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowUp" && !input.value && Settings.get("chatEditing") && !input._ncmMenu?.el) {
          ev.preventDefault();
          this.editLast();
        }
      });
    }
    Stage.renderDock();
  },

  /** Roll privacy as four buttons instead of the dropdown (v12; v13 has its own). */
  privacyButtons(root) {
    if (Compat.isV13 || !Settings.get("rollPrivacyButtons")) return;
    const select = root.querySelector?.("select[name=rollMode], select.roll-type-select");
    if (!select || select.parentElement.querySelector(".ncm-privacy")) return;
    const bar = document.createElement("div");
    bar.className = "neon-combat ncm-privacy";
    bar.innerHTML = PRIVACY.map(([mode, icon]) => `<button type="button" data-mode="${mode}" data-tooltip="${esc(L(`CHAT.Roll${{ publicroll: "Public", gmroll: "Private", blindroll: "Blind", selfroll: "Self" }[mode]}`))}"><i class="${icon}"></i></button>`).join("");
    bar.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-mode]");
      if (!b) return;
      select.value = b.dataset.mode;
      game.settings.set("core", "rollMode", b.dataset.mode);
      this.markPrivacy();
    });
    select.hidden = true;
    select.after(bar);
    this.markPrivacy();
  },

  markPrivacy() {
    const mode = game.settings.get("core", "rollMode");
    document.querySelectorAll(".ncm-privacy [data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  },

  /* ---------------------------------------- */
  /*  Editing and the context menu            */
  /* ---------------------------------------- */

  canEdit(message) {
    return !!message && isTyped(message) && Settings.get("chatEditing") && (message.isAuthor || game.user.isGM);
  },

  async edit(message) {
    if (!this.canEdit(message)) return null;
    const raw = message.flags[MODULE_ID].raw ?? message.content;
    const text = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Chat.Edit`) },
      content: `<textarea name="text" rows="6" style="width:100%" autofocus>${esc(raw)}</textarea><p class="ncm-hint">${esc(L(`${LANG}.Chat.EditHint`))}</p>`,
      ok: { label: L(`${LANG}.Chat.Save`), callback: (event, button) => button.form.elements.text.value },
      rejectClose: false
    });
    if (text === null || text === undefined || text === raw) return null;
    const content = Settings.get("chatFormatting") && hasFormatting(text) ? format(text) : text;
    return message.update({ content, [`flags.${MODULE_ID}.raw`]: text, [`flags.${MODULE_ID}.edited`]: true });
  },

  /** Your last typed message (the newest one you may edit). */
  editLast() {
    const mine = (game.messages?.contents ?? []).filter((m) => m.isAuthor && this.canEdit(m));
    return mine.length ? this.edit(mine.at(-1)) : null;
  },

  contextMenu(options) {
    const msgOf = (li) => {
      const el = li?.[0] ?? li;
      return game.messages.get(el?.dataset?.messageId);
    };
    options.push(
      {
        name: `${LANG}.Chat.Edit`,
        icon: '<i class="fa-solid fa-pen"></i>',
        condition: (li) => this.canEdit(msgOf(li)),
        callback: (li) => this.edit(msgOf(li))
      },
      {
        name: `${LANG}.Chat.Log.AddEvent`,
        icon: '<i class="fa-solid fa-book"></i>',
        condition: (li) => Settings.get("adventureLog") && !!msgOf(li),
        callback: (li) => AdventureLog.event(plain(msgOf(li))).catch((e) => ui.notifications.warn(e.message))
      },
      {
        name: `${LANG}.Chat.Log.AddQuote`,
        icon: '<i class="fa-solid fa-quote-left"></i>',
        condition: (li) => Settings.get("adventureLog") && isTyped(msgOf(li)),
        callback: (li) => {
          const m = msgOf(li);
          return AdventureLog.quote(m.speaker?.alias || m.author?.name || "?", plain(m)).catch((e) => ui.notifications.warn(e.message));
        }
      }
    );
  },

  /** Actors directory: on stage, and the expression pictures. */
  actorMenu(options) {
    const actorOf = (li) => {
      const el = li?.[0] ?? li;
      return game.actors.get(el?.dataset?.documentId ?? el?.dataset?.entryId);
    };
    const ok = (a) => Stage.enabled && a?.isOwner && ["character", "mook"].includes(a.type);
    options.push(
      {
        name: `${LANG}.Stage.PutOn`,
        icon: '<i class="fa-solid fa-masks-theater"></i>',
        condition: (li) => ok(actorOf(li)) && !Stage.cast.some((c) => c.id === actorOf(li)?.id),
        callback: (li) => Stage.add(actorOf(li)).catch((e) => ui.notifications.warn(e.message))
      },
      {
        name: `${LANG}.Stage.Expressions`,
        icon: '<i class="fa-solid fa-face-smile"></i>',
        condition: (li) => ok(actorOf(li)),
        callback: (li) => Stage.editMoods(actorOf(li))
      }
    );
  },

  /* ---------------------------------------- */
  /*  Commands                                */
  /* ---------------------------------------- */

  registerCommands() {
    const reg = (data) => Commands.register({ module: MODULE_ID, ...data }, true);
    const info = (key) => [Commands.createInfoElement(esc(L(key)))];
    const entries = (prefix, names) => names.map((n) => Commands.createCommandElement(`${prefix} ${n}`, `<b>${esc(n)}</b>`));
    const run = (fn) => (chat, parameters) => {
      Promise.resolve(fn(parameters)).catch((err) => ui.notifications.warn(err.message));
      return {};
    };

    if (Settings.get("adventureLog")) {
      reg({ name: "/log", description: L(`${LANG}.Chat.Cmd.Log`), icon: '<i class="fa-solid fa-book"></i>',
        callback: run((p) => (p.trim() ? AdventureLog.add(parseLog(p)) : ui.notifications.info(L(`${LANG}.Chat.Cmd.LogHelp`)))),
        autocompleteCallback: () => info(`${LANG}.Chat.Cmd.LogHelp`) });
      reg({ name: "/gmlog", requiredRole: "GAMEMASTER", description: L(`${LANG}.Chat.Cmd.GmLog`), icon: '<i class="fa-solid fa-book-skull"></i>',
        callback: run((p) => AdventureLog.add(parseLog(p), { gm: true })) });
    }
    reg({ name: "/archive", requiredRole: "GAMEMASTER", description: L(`${LANG}.Chat.Cmd.Archive`), icon: '<i class="fa-solid fa-box-archive"></i>',
      callback: run((p) => archiveChat(p.trim())) });

    // This module's windows.
    reg({ name: "/plot", aliases: ["/stakes"], description: L(`${LANG}.Chat.Cmd.Plot`), icon: '<i class="fa-solid fa-dice-six"></i>',
      callback: run(async () => (await import("../stakes/stakes.js")).Stakes.open(Stage.defaultActors()[0] ?? null)) });
    reg({ name: "/map", description: L(`${LANG}.Chat.Cmd.Map`), icon: '<i class="fa-solid fa-map-location-dot"></i>',
      callback: run(async () => (await import("../hub/hub.js")).Hub.open()) });
    reg({ name: "/biomon", description: L(`${LANG}.Chat.Cmd.Biomon`), icon: '<i class="fa-solid fa-heart-pulse"></i>',
      callback: run(async () => (await import("../comms/biomon-app.js")).BiomonApp.open()) });
    reg({ name: "/hud", description: L(`${LANG}.Chat.Cmd.Hud`), icon: '<i class="fa-solid fa-sliders"></i>',
      callback: run(async () => (await import("../hud/hud-editor.js")).HudEditor.open(Stage.defaultActors()[0] ?? null)) });
    reg({ name: "/cond", aliases: ["/condition"], description: L(`${LANG}.Chat.Cmd.Cond`), icon: '<i class="fa-solid fa-person-falling"></i>',
      callback: run((p) => {
        const c = Registry.all().find((x) => x.name.toLowerCase() === p.trim().toLowerCase() || x.id.toLowerCase() === p.trim().toLowerCase());
        if (!c) throw new Error(L(`${LANG}.Chat.Cmd.NoCondition`, { name: p }));
        const actors = Stage.defaultActors().filter((a) => a.isOwner);
        if (!actors.length) throw new Error(L(`${LANG}.Stage.NoOne`));
        return Conditions.toggle(c.id, actors);
      }),
      autocompleteCallback: (menu, alias, p) => {
        const want = p.toLowerCase();
        return entries("/cond", Registry.all().filter((c) => c.name.toLowerCase().includes(want)).map((c) => c.name)).slice(0, 10);
      } });

    // Who you speak as: yourself, or a character of yours in this scene or on stage.
    reg({ name: "/as", description: L(`${LANG}.Chat.Cmd.As`), icon: '<i class="fa-solid fa-comment"></i>',
      callback: run((p) => {
        const want = p.trim().toLowerCase();
        if (!want) return Stage.speakAs(null);
        if (want === "me" || want === game.user.name.toLowerCase()) return Stage.speakAs("me");
        const options = Stage.speakOptions();
        const c = options.find((o) => o.name.toLowerCase() === want) ?? options.find((o) => o.name.toLowerCase().startsWith(want));
        if (!c) throw new Error(L(`${LANG}.Stage.NoActor`, { name: p }));
        return Stage.speakAs(c.id);
      }),
      autocompleteCallback: (menu, alias, p) => entries("/as", ["me", ...Stage.speakOptions().map((o) => o.name)].filter((n) => n.toLowerCase().startsWith(p.toLowerCase()))) });

    // The stage.
    if (!Settings.get("stageEnabled")) return;
    const names = (list) => list.map((a) => a.name);
    reg({ name: "/stage", description: L(`${LANG}.Chat.Cmd.Stage`), icon: '<i class="fa-solid fa-masks-theater"></i>',
      callback: run((p) => {
        if (!p.trim()) return Stage.add(Stage.defaultActors());
        const a = Stage.findActor(p);
        if (!a) throw new Error(L(`${LANG}.Stage.NoActor`, { name: p }));
        return Stage.add(a);
      }),
      autocompleteCallback: (menu, alias, p) => entries("/stage", names(game.actors.filter((a) => (game.user.isGM || a.isOwner) && ["character", "mook"].includes(a.type) && a.name.toLowerCase().startsWith(p.toLowerCase())))).slice(0, 10) });
    reg({ name: "/unstage", description: L(`${LANG}.Chat.Cmd.Unstage`), icon: '<i class="fa-solid fa-user-minus"></i>',
      callback: run((p) => {
        if (p.trim().toLowerCase() === "all") return Stage.clear();
        const c = p.trim() ? Stage.findCast(p) : Stage.cast.find((x) => x.id === Stage.speaker);
        if (!c) throw new Error(L(`${LANG}.Stage.NoActor`, { name: p }));
        return Stage.remove(c.id);
      }),
      autocompleteCallback: (menu, alias, p) => entries("/unstage", [...Stage.cast.map((c) => c.name), ...(game.user.isGM ? ["all"] : [])].filter((n) => n.toLowerCase().startsWith(p.toLowerCase()))) });
    reg({ name: "/mood", aliases: ["/emotion"], description: L(`${LANG}.Chat.Cmd.Mood`), icon: '<i class="fa-solid fa-face-smile"></i>',
      callback: run((p) => Stage.mood(p.trim().toLowerCase())),
      autocompleteCallback: (menu, alias, p) => Object.keys(MOODS).filter((m) => m.startsWith(p.toLowerCase())).map((m) => Commands.createCommandElement(`/mood ${m}`, `<i class="${MOODS[m]}"></i> <b>${esc(L(`${LANG}.Stage.Mood.${m}`))}</b>`)) });
    reg({ name: "/narrate", aliases: ["/n"], requiredRole: "GAMEMASTER", description: L(`${LANG}.Chat.Cmd.Narrate`), icon: '<i class="fa-solid fa-bullhorn"></i>',
      callback: run((p) => {
        if (!p.trim()) {
          Stage.narrating = !Stage.narrating;
          ui.notifications.info(L(`${LANG}.Stage.${Stage.narrating ? "NarratorOn" : "NarratorOff"}`));
          return Stage.renderDock();
        }
        return this.narrate(p);
      }) });
    reg({ name: "/director", requiredRole: "GAMEMASTER", description: L(`${LANG}.Chat.Cmd.Director`), icon: '<i class="fa-solid fa-masks-theater"></i>',
      callback: run(() => Stage.openDirector()) });
    reg({ name: "/curtain", requiredRole: "GAMEMASTER", description: L(`${LANG}.Chat.Cmd.Curtain`), icon: '<i class="fa-solid fa-person-booth"></i>',
      callback: run(() => Stage.clear()) });
  }
};

/** A message's words, for the log. */
function plain(message) {
  const raw = message?.flags?.[MODULE_ID]?.raw;
  if (raw) return raw;
  const d = typeof document !== "undefined" ? document.createElement("div") : null;
  if (!d) return String(message?.content ?? "").replace(/<[^>]+>/g, "");
  d.innerHTML = message?.content ?? "";
  return d.textContent.trim();
}
