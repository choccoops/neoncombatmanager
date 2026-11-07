import { LANG } from "../constants.js";
import { Commands, matching, parse } from "./commands.js";
import { L, esc } from "../util.js";

const MAX = 9;

/**
 * The command menu over the chat box: type "/" for the commands you can use, keep typing to narrow
 * them down; once a command is in, it offers what that command takes. "@name" whispers. Arrow keys
 * move, Tab or Enter picks, Escape closes.
 */
export class CommandMenu {
  constructor(input) {
    this.input = input;
    this.el = null;
    this.index = -1;
    this.command = null;
    this._token = 0;
    input.addEventListener("input", () => this.open(input.value));
    input.addEventListener("keydown", (ev) => this.key(ev), true);
    input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
  }

  /** Attach to the chat box (once per box; the chat log re-renders it). */
  static attach(root = document) {
    for (const input of root.querySelectorAll?.("textarea#chat-message, #chat-message") ?? []) {
      if (input._ncmMenu || input.tagName !== "TEXTAREA") continue;
      input._ncmMenu = new CommandMenu(input);
    }
  }

  /** What to show for the text in the box. */
  async open(text) {
    const t = String(text ?? "");
    if (!/^[/@]/.test(t) || t.includes("\n")) return this.close();
    const token = ++this._token;
    const cmds = Commands.available();
    const hit = /\s/.test(t) || t.startsWith("@") ? parse(t, cmds) : null;
    let entries;
    if (hit && (t.length > hit.alias.length || hit.alias === "@")) {
      this.command = hit.command;
      entries = await this._params(hit);
    } else {
      this.command = null;
      entries = matching(t.split(/\s/)[0], cmds).slice(0, MAX).map((c) => Commands.createCommandElement(`${c.name} `,
        `<span class="ncm-cc-icon">${c.icon ?? ""}</span><b>${esc(c.name)}</b>${c.aliases?.length ? `<em>${c.aliases.map(esc).join(" ")}</em>` : ""}<small>${esc(c.description ?? "")}</small>`));
    }
    if (token !== this._token) return null;
    if (!entries?.length) return this.close();
    return this.show(entries);
  }

  /** The command's own suggestions, or its description. */
  async _params({ command, alias, parameters }) {
    if (command.name === "/whisper" && (alias === "@" || alias === "/w" || alias === "/whisper")) return this._whisper(parameters);
    if (typeof command.autocompleteCallback === "function") {
      try {
        const out = command.autocompleteCallback(this, alias, parameters);
        const list = out?.[Symbol.asyncIterator] ? await Array.fromAsync(out) : await out;
        return (list ?? []).slice(0, MAX + 1);
      } catch (err) {
        console.warn("chat command completion failed", err);
      }
    }
    return command.description ? [Commands.createInfoElement(`<span class="ncm-cc-icon">${command.icon ?? ""}</span>${esc(command.description)}`)] : [];
  }

  /** "@ha" -> the users whose name starts so, completing to /w [Name]. */
  _whisper(parameters) {
    if (/\]\s/.test(parameters)) return [];
    const want = parameters.replace(/^\[/, "").toLowerCase();
    return game.users.filter((u) => u.id !== game.user.id && u.name.toLowerCase().startsWith(want)).slice(0, MAX)
      .map((u) => Commands.createCommandElement(`/w [${u.name}] `, `<span class="ncm-cc-dot" style="background:${esc(u.color?.css ?? u.color ?? "#888")}"></span><b>${esc(u.name)}</b><small>${esc(u.active ? L(`${LANG}.Chat.Online`) : L(`${LANG}.Chat.Offline`))}</small>`));
  }

  show(entries) {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "neon-combat ncm-cc";
      this.el.addEventListener("mousedown", (ev) => {
        const li = ev.target.closest(".ncm-cc-entry.command");
        if (!li) return;
        ev.preventDefault();
        this.select(li.dataset.command);
      });
      document.body.append(this.el);
    }
    const ul = document.createElement("ul");
    ul.append(...entries);
    this.el.replaceChildren(ul);
    this.index = -1;
    const r = this.input.getBoundingClientRect();
    Object.assign(this.el.style, { left: `${r.left}px`, width: `${Math.max(r.width, 260)}px`, bottom: `${window.innerHeight - r.top + 4}px` });
    return this.el;
  }

  close() {
    this.el?.remove();
    this.el = null;
    this.index = -1;
    this.command = null;
  }

  /** Put a completion in the box. */
  select(text) {
    this.input.value = text;
    this.input.focus();
    this.input.setSelectionRange(text.length, text.length);
    if (this.command && this.command.closeOnComplete === false) return this.open(text);
    // A command picked from the list: show what it takes next.
    return this.open(text);
  }

  key(ev) {
    if (!this.el) return;
    const items = [...this.el.querySelectorAll(".ncm-cc-entry.command")];
    const stop = () => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    if (ev.key === "Escape") {
      stop();
      return this.close();
    }
    if (!items.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      stop();
      this.index = (this.index + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("is-active", i === this.index));
      items[this.index].scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Tab" || (ev.key === "Enter" && this.index >= 0)) {
      stop();
      this.select((items[Math.max(0, this.index)]).dataset.command);
    }
  }
}
