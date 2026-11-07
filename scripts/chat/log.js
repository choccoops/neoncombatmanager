import { LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { L, esc } from "../util.js";

/** "[2026-11-07 21:04]" (the real date and time, like a log should). */
export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * "/log q "Bobby McFerrin" Don't worry" -> { quote: true, source: "Bobby McFerrin", text: "Don't worry" }.
 * "/log e text", "/log event text" and "/log text" are events.
 */
export function parseLog(parameters) {
  const p = String(parameters ?? "").trim();
  const q = p.match(/^(?:q|quote)\s+(?:"([^"]+)"|(\S+))\s+([\s\S]+)$/i);
  if (q) return { quote: true, source: q[1] ?? q[2], text: q[3].trim() };
  const e = p.match(/^(?:e|event)\s+([\s\S]+)$/i);
  return { quote: false, source: "", text: (e ? e[1] : p).trim() };
}

/** One line of the log, as HTML. */
export function entryHtml({ quote, source, text }, who, when = stamp()) {
  const body = quote ? L(`${LANG}.Chat.Log.Said`, { source: esc(source), text: esc(text) }) : esc(text);
  return `<p class="ncm-log-entry"><span class="ncm-log-time">[${esc(when)}]</span> <span class="ncm-log-who">(${esc(who)})</span> ${body}</p>`;
}

/**
 * The Adventure Log: "/log something happened" keeps a dated line in a journal the players can
 * read; "/log q Source what they said" keeps a quote; "/gmlog" writes to the GM's own log. The GM
 * writes the journal (players' entries go through the socket).
 */
export const AdventureLog = {
  registerSocket() {
    Socket.on("chatLog", (data, userId) => this._write(data, game.users.get(userId)));
  },

  journalName(gm = false) {
    const base = Settings.get("adventureLogName") || L(`${LANG}.Chat.Log.Default`);
    return gm ? `${base} (GM)` : base;
  },

  /** Log an entry: { quote, source, text }; gm: to the GM's log (GM only). */
  async add(entry, { gm = false } = {}) {
    if (!entry?.text) throw new Error(L(`${LANG}.Chat.Log.Empty`));
    if (gm && !game.user.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    await Socket.request("chatLog", { ...entry, gm });
    ui.notifications.info(L(`${LANG}.Chat.Log.Added`, { name: this.journalName(gm) }));
    return true;
  },

  event(text, options) {
    return this.add({ quote: false, source: "", text }, options);
  },

  quote(source, text, options) {
    return this.add({ quote: true, source, text }, options);
  },

  /** GM: the log's journal and page, made the first time (players may read the shared one). */
  async _journal(gm) {
    const name = this.journalName(gm);
    let journal = game.journal.getName(name);
    if (!journal) {
      const level = gm ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE : CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
      journal = await JournalEntry.create({ name, ownership: { default: level } });
    }
    let page = journal.pages.find((p) => p.type === "text");
    if (!page) [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{ name, type: "text", text: { content: "" } }]);
    return page;
  },

  async _write({ quote, source, text, gm }, user) {
    if (gm && !user?.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    const page = await this._journal(!!gm);
    const line = entryHtml({ quote: !!quote, source: String(source ?? ""), text: String(text ?? "") }, user?.name ?? "?");
    await page.update({ "text.content": `${page.text?.content ?? ""}${line}` });
    return true;
  }
};

/** GM: keep the chat log in a journal ("Chat Archive · name"), then offer to clear it. */
export async function archiveChat(name = "") {
  if (!game.user.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
  const messages = game.messages.contents.filter((m) => m.visible !== false);
  if (!messages.length) return ui.notifications.info(L(`${LANG}.Chat.Archive.Empty`));
  const rows = messages.map((m) => {
    const when = new Date(m.timestamp ?? Date.now());
    const who = m.speaker?.alias || m.author?.name || m.user?.name || "";
    return `<div class="ncm-arch"><p class="ncm-arch-head"><b>${esc(who)}</b> <small>${esc(stamp(when))}</small></p>${m.flavor ? `<p class="ncm-arch-flavor">${m.flavor}</p>` : ""}<div class="ncm-arch-body">${m.content ?? ""}</div></div>`;
  });
  const title = L(`${LANG}.Chat.Archive.Title`, { name: name || stamp() });
  const journal = await JournalEntry.create({ name: title, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
  await journal.createEmbeddedDocuments("JournalEntryPage", [{ name: title, type: "text", text: { content: rows.join("") } }]);
  ui.notifications.info(L(`${LANG}.Chat.Archive.Saved`, { name: title, count: messages.length }));
  const clear = await Compat.DialogV2.confirm({
    window: { title: L(`${LANG}.Chat.Archive.ClearTitle`) },
    content: `<p>${esc(L(`${LANG}.Chat.Archive.Clear`, { count: messages.length }))}</p>`,
    rejectClose: false
  });
  if (clear) await ChatMessage.implementation.deleteDocuments([], { deleteAll: true });
  return journal;
}
