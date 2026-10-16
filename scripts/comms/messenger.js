import { MODULE_ID } from "../constants.js";
import { CPR } from "../cpr.js";

export const NCM_ID = "night-city-messenger";
const FALLBACK_IMG = "icons/svg/mystery-man.svg";

/**
 * Night City Messenger (christinophrappuccino, MIT) integration, through its public api only
 * (game.modules.get("night-city-messenger").api, apiVersion 1.x: contacts, masterContacts,
 * portraits, messenger) and the scene flag it sets for dead zones. Everything degrades to
 * "not installed" when it's off or its api isn't up yet.
 */
export const Messenger = {
  get api() {
    const m = game.modules.get(NCM_ID);
    return m?.active ? m.api ?? null : null;
  },

  get ready() {
    return !!this.api;
  },

  /** A contact's portrait, the way the messenger's own UI resolves it. */
  portrait(contact) {
    try {
      const p = this.api?.portraits?.resolvePortrait?.(contact);
      if (p) return p;
    } catch {
      /* fall through */
    }
    const actor = contact?.linkedActorId || contact?.actorId ? game.actors.get(contact.linkedActorId || contact.actorId) : null;
    return contact?.portrait || contact?.customImg || contact?.img || actor?.img || FALLBACK_IMG;
  },

  /** A contact as something to call: { key, type, contactId, actorId, name, img, trust, burned }. */
  callable(contact, source) {
    const actorId = contact.linkedActorId || contact.actorId || null;
    return {
      key: `${source}:${contact.id}`,
      type: "contact",
      source,
      contactId: contact.id,
      actorId: actorId && game.actors.get(actorId) ? actorId : null,
      name: contact.alias || contact.name || "Unknown",
      img: this.portrait(contact),
      trust: Number(contact.trust) || 0,
      burned: !!contact.burned,
      encrypted: !!contact.encrypted
    };
  },

  /** A character's address book (their own NCM contacts), callable. */
  async contacts(actor) {
    const repo = this.api?.contacts;
    if (!repo || !actor) return [];
    try {
      const list = await repo.getContacts(actor.id);
      return (list ?? []).filter((c) => c && !c.encrypted).map((c) => this.callable(c, "contacts"));
    } catch (err) {
      console.warn(`${MODULE_ID} | couldn't read ${actor.name}'s Night City Messenger contacts`, err);
      return [];
    }
  },

  /** GM: the messenger's master directory, callable. */
  directory() {
    try {
      return (this.api?.masterContacts?.getAll?.() ?? []).map((c) => this.callable(c, "directory"));
    } catch {
      return [];
    }
  },

  /** Is a scene one of the messenger's dead zones (no signal)? Read raw: getFlag throws when the module is off. */
  deadZone(scene) {
    return !!scene?.flags?.[NCM_ID]?.deadZone;
  },

  /**
   * Has this character something to call with? An Agent (carried), or installed cyberware that
   * is one: an Internal Agent, or a CEMK Neuroport (its built-in Holophone).
   */
  hasAgent(actor) {
    return (actor?.items ?? []).some((i) => {
      if (i.type === "cyberware") return /\bagent\b|neuroport|holophone/i.test(i.name) && CPR.inUse(i);
      return i.type === "gear" && /\bagent\b/i.test(i.name) && i.system?.equipped !== "owned";
    });
  },

  /**
   * Leave a "missed holocall" in a character's messenger inbox (GM side, where the messenger
   * delivers). Best effort: a failure is logged, never thrown.
   * @param {Actor} to - the character who missed it
   * @param {object} from - the caller participant: { actorId?, contactId?, source?, name }
   */
  async missedCall(to, from, { subject, body }) {
    const send = this.api?.messenger?.sendMessage;
    if (!send || !to) return false;
    const data = { toActorId: to.id, subject, body };
    if (from.actorId) data.fromActorId = from.actorId;
    else if (from.contactId && from.source === "directory") data.fromContactId = from.contactId;
    else return false;
    try {
      const result = await send(data);
      return !!result?.success;
    } catch (err) {
      console.warn(`${MODULE_ID} | couldn't leave a missed-call message for ${to.name}`, err);
      return false;
    }
  }
};
