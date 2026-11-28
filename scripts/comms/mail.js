import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Phone, NCM_ID } from "./phone.js";

/** How many letters with something to press are remembered (the oldest go first). */
export const MAIL_KEPT = 400;

/**
 * Drop the oldest entries past the limit. Pure (tests use it).
 * @param {Record<string, { at?: number }>} entries
 */
export function trimMail(entries, keep = MAIL_KEPT) {
  const all = Object.entries(entries ?? {});
  if (all.length <= keep) return Object.fromEntries(all);
  return Object.fromEntries(all.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, keep));
}

/**
 * Mail through Night City Messenger (christinophrappuccino, MIT), by its public api v2 only:
 * messages.send, directory.list / pushToPlayer, and (api 2.3.0, NCM 2.5.0) messages.addActions
 * for buttons under a message. What a letter's buttons do is kept in the world setting
 * "ncmMail": { [messageId]: { kind, to, at, ...whatever the kind needs } }. Each feature
 * registers its kind once (register) and sends with an `action` to get buttons.
 *
 * On an older NCM the letters still go out, with no buttons under them.
 */
export const Mail = {
  PROVIDER: MODULE_ID,
  /** kind -> (entry, message, context) => [{ label, icon?, primary?, disabled?, run }] | { actions, note } | null */
  kinds: new Map(),
  hooked: false,

  get api() {
    return Phone.api;
  },

  /** Can letters be sent? */
  get on() {
    return typeof this.api?.messages?.send === "function";
  },

  /** Can letters carry buttons (NCM 2.5.0+)? */
  get buttons() {
    return typeof this.api?.messages?.addActions === "function";
  },

  get entries() {
    return Settings.get("ncmMail") ?? {};
  },

  entry(messageId) {
    return messageId ? this.entries[messageId] ?? null : null;
  },

  register(kind, fn) {
    this.kinds.set(kind, fn);
  },

  /**
   * GM: send a letter.
   * @param {object} o
   * @param {{ contactId?: string, actorId?: string }} o.from - a directory contact, or a character
   * @param {string} o.to - the character it goes to
   * @param {object} [o.action] - { kind, ... }: what the buttons under it do
   * @returns {Promise<{ ok: boolean, messageId?: string|null, error?: string }>}
   */
  async send({ from = {}, to, subject, body, priority = "normal", action = null } = {}) {
    if (!game.user?.isGM) return { ok: false, error: "GM only" };
    if (!this.on) return { ok: false, error: "Night City Messenger is off" };
    let res;
    try {
      res = await this.api.messages.send({
        ...(from.contactId ? { fromContactId: from.contactId } : { fromActorId: from.actorId }),
        toActorId: to, subject, body, priority
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Night City Messenger didn't take the letter`, err);
      return { ok: false, error: err?.message ?? String(err) };
    }
    if (!res?.ok) return { ok: false, error: res?.error ?? "" };
    const messageId = res.data?.messageId ?? null;
    if (messageId && action?.kind) await this.note(messageId, { ...action, to, at: Date.now() });
    return { ok: true, messageId };
  },

  /** GM: write (or change) what a letter's buttons do. */
  async note(messageId, patch) {
    if (!game.user?.isGM || !messageId) return null;
    const all = { ...this.entries };
    all[messageId] = { ...(all[messageId] ?? {}), ...patch };
    await Settings.set("ncmMail", trimMail(all));
    return all[messageId];
  },

  /** GM: the directory's contacts, fixers first: [{ id, name, role, actorId }]. */
  async contacts() {
    if (!game.user?.isGM || typeof this.api?.directory?.list !== "function") return [];
    try {
      const res = await this.api.directory.list();
      const list = res?.ok ? res.data ?? [] : [];
      const fixer = (c) => (/fixer/i.test(`${c.role ?? ""}`) ? 0 : 1);
      return [...list].sort((a, b) => fixer(a) - fixer(b) || String(a.name).localeCompare(String(b.name)));
    } catch (err) {
      console.warn(`${MODULE_ID} | couldn't read Night City Messenger's directory`, err);
      return [];
    }
  },

  /** GM: put a directory contact in a character's own contacts, so the letter comes from someone they know. */
  async introduce(contactId, actorId) {
    if (!contactId || typeof this.api?.directory?.pushToPlayer !== "function") return false;
    try {
      return !!(await this.api.directory.pushToPlayer(contactId, actorId))?.ok;
    } catch {
      return false;
    }
  },

  /** What goes under a message: the registered kind's buttons, when this inbox is the one it was sent to. */
  actionsFor(message, context) {
    const e = this.entry(message?.id);
    if (!e || (e.to && context?.actorId && e.to !== context.actorId)) return null;
    return this.kinds.get(e.kind)?.(e, message, context ?? {}) ?? null;
  },

  /** Give NCM our provider (every client, once its api is up). */
  async hook() {
    if (this.hooked || !this.buttons) return false;
    this.hooked = true;
    const res = await this.api.messages.addActions((m, c) => this.actionsFor(m, c), { id: this.PROVIDER });
    if (!res?.ok) this.hooked = false;
    return this.hooked;
  },

  /** A letter's buttons changed: redraw the open inboxes. */
  refresh() {
    try {
      this.api?.messages?.refresh?.();
    } catch {
      /* nothing open */
    }
  },

  init() {
    Hooks.on(`${NCM_ID}.apiReady`, () => this.hook());
    Hooks.on(`${MODULE_ID}.mailChanged`, () => this.refresh());
  },

  ready() {
    return this.hook();
  }
};
