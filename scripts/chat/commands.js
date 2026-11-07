import { MODULE_ID, LANG } from "../constants.js";
import { L, esc } from "../util.js";

export const CHAT_COMMANDER_ID = "_chatcommands";

/** Foundry's own commands: listed for completion, handled by Foundry. */
export const CORE = [
  { name: "/roll", aliases: ["/r"], icon: "fa-solid fa-dice", key: "Roll" },
  { name: "/gmroll", aliases: ["/gmr"], icon: "fa-solid fa-user-secret", key: "GmRoll" },
  { name: "/blindroll", aliases: ["/broll", "/br"], icon: "fa-solid fa-eye-slash", key: "BlindRoll" },
  { name: "/selfroll", aliases: ["/sr"], icon: "fa-solid fa-user", key: "SelfRoll" },
  { name: "/publicroll", aliases: ["/proll", "/pr"], icon: "fa-solid fa-users", key: "PublicRoll" },
  { name: "/whisper", aliases: ["/w", "@"], icon: "fa-solid fa-comment-dots", key: "Whisper" },
  { name: "/reply", aliases: [], icon: "fa-solid fa-reply", key: "Reply" },
  { name: "/ic", aliases: [], icon: "fa-solid fa-masks-theater", key: "IC" },
  { name: "/ooc", aliases: [], icon: "fa-solid fa-comments", key: "OOC" },
  { name: "/emote", aliases: ["/em", "/me"], icon: "fa-solid fa-person-rays", key: "Emote" }
];

const ROLES = ["NONE", "PLAYER", "TRUSTED", "ASSISTANT", "GAMEMASTER"];

/**
 * Split what was typed into the command and its parameters ("/log q Bob hi" -> "/log", "q Bob hi").
 * A one-character alias ("@") needs no space.
 */
export function parse(text, commands) {
  const t = String(text ?? "").trimStart();
  const m = t.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const word = m[1].toLowerCase();
  for (const c of commands) {
    const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
    if (names.includes(word)) return { command: c, alias: word, parameters: (m[2] ?? "").trim() };
    const single = names.find((n) => n.length === 1 && t.startsWith(n));
    if (single) return { command: c, alias: single, parameters: t.slice(1).trim() };
  }
  return null;
}

/** Commands whose name or alias starts with what's typed, best match first. */
export function matching(text, commands) {
  const want = String(text ?? "").toLowerCase();
  return commands
    .map((c) => {
      const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
      return { c, hit: names.some((n) => n.startsWith(want)), exact: names.includes(want) };
    })
    .filter((x) => x.hit)
    .sort((a, b) => (b.exact - a.exact) || a.c.name.localeCompare(b.c.name))
    .map((x) => x.c);
}

/**
 * Chat commands, one place for every module: register a command with a name, aliases, a
 * description, an icon and the lowest role that may use it; what it does when sent; and what the
 * completion menu offers while its parameters are typed. The same shape as Chat Commander's
 * (`game.chatCommands.register(data)`), which this stands in for when that module isn't running;
 * with it running, this module's commands are registered there instead.
 */
export const Commands = {
  /** name -> command */
  list: new Map(),

  /** Chat Commander is running: it handles commands and completion. */
  get external() {
    return !!game.modules.get(CHAT_COMMANDER_ID)?.active && !!game.chatCommands && game.chatCommands !== this.api;
  },

  /**
   * Add a command. data: { name, module, aliases, description, icon, requiredRole, callback,
   * autocompleteCallback, closeOnComplete }.
   * callback(chat, parameters, messageData) returns message data to post (merged over messageData),
   * {} for nothing, or null/undefined to let Foundry handle it. It may be async.
   * autocompleteCallback(menu, alias, parameters) returns menu entries (HTMLElements).
   */
  register(data, override = false) {
    if (!data?.name) throw new Error("A chat command needs a name.");
    if (this.external) return game.chatCommands.register(data, override);
    const name = data.name.toLowerCase();
    if (this.list.has(name) && !override && !this.list.get(name).core) {
      console.warn(`${MODULE_ID} | chat command ${data.name} is already registered (by ${this.list.get(name).module})`);
      return null;
    }
    const cmd = {
      module: MODULE_ID, aliases: [], description: "", icon: "", requiredRole: "NONE", closeOnComplete: true,
      ...data,
      name,
      aliases: (data.aliases ?? []).map((a) => a.toLowerCase())
    };
    this.list.set(name, cmd);
    return cmd;
  },

  unregister(name) {
    if (this.external) return game.chatCommands.unregister(name);
    return this.list.delete(String(name).toLowerCase());
  },

  /** Can this user use it? */
  allowed(cmd, user = game.user) {
    const need = ROLES.indexOf(String(cmd.requiredRole ?? "NONE").toUpperCase());
    return need <= 0 || (user?.role ?? 0) >= need;
  },

  /** The commands this user may use (Foundry's included), for the menu. */
  available(user = game.user) {
    return [...this.list.values()].filter((c) => this.allowed(c, user));
  },

  /** Foundry's commands, listed (not handled) so the menu offers them. */
  registerCore() {
    for (const c of CORE) {
      this.list.set(c.name, {
        ...c, core: true, module: "core", requiredRole: "NONE", closeOnComplete: true,
        icon: `<i class="${c.icon}"></i>`,
        description: L(`${LANG}.Chat.Core.${c.key}`)
      });
    }
  },

  /**
   * The chatMessage hook: run a command that was typed.
   * @returns {boolean} false when the command took the message (Foundry then does nothing)
   */
  handle(chat, text, messageData) {
    if (this.external) return true;
    const hit = parse(text, [...this.list.values()].filter((c) => !c.core));
    if (!hit) return true;
    const { command, parameters } = hit;
    if (!this.allowed(command)) {
      ui.notifications.warn(L(`${LANG}.Chat.NotAllowed`, { name: command.name }));
      return false;
    }
    if (typeof command.callback !== "function") return true;
    const done = (result) => {
      const options = { handleCore: false };
      const out = result ?? {};
      Hooks.callAll("invokeChatCommand", chat, command, parameters, out, options);
      if (out.content) return ChatMessage.create({ ...messageData, ...out });
      return null;
    };
    let result;
    try {
      result = command.callback(chat, parameters, messageData);
    } catch (err) {
      ui.notifications.error(err.message);
      return false;
    }
    if (result instanceof Promise) {
      result.then(done).catch((err) => ui.notifications.error(err.message));
      return false;
    }
    if (result === null || result === undefined) return true;
    done(result);
    return false;
  },

  /* ---------------------------------------- */
  /*  Menu entries (Chat Commander's helpers) */
  /* ---------------------------------------- */

  /** An entry that completes to a command. */
  createCommandElement(command, content) {
    const li = document.createElement("li");
    li.className = "ncm-cc-entry command";
    li.dataset.command = command;
    li.innerHTML = content;
    return li;
  },

  createInfoElement(content) {
    const li = document.createElement("li");
    li.className = "ncm-cc-entry info";
    li.innerHTML = content;
    return li;
  },

  createSeparatorElement() {
    const li = document.createElement("li");
    li.className = "ncm-cc-entry separator";
    return li;
  },

  createLoadingElement() {
    return this.createInfoElement(`<i class="fa-solid fa-spinner fa-spin"></i> ${esc(L(`${LANG}.Chat.Loading`))}`);
  },

  /** game.chatCommands, when Chat Commander isn't running. */
  get api() {
    this._api ??= {
      register: (data, override) => this.register(data, override),
      unregister: (name) => this.unregister(name),
      get commands() {
        return Commands.list;
      },
      createCommandElement: (c, h) => this.createCommandElement(c, h),
      createInfoElement: (h) => this.createInfoElement(h),
      createSeparatorElement: () => this.createSeparatorElement(),
      createLoadingElement: () => this.createLoadingElement()
    };
    return this._api;
  }
};
