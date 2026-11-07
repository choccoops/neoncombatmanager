import { MODULE_ID, LANG } from "../constants.js";
import { Hub } from "../hub/hub.js";
import { L } from "../util.js";

export const NCM_ID = "night-city-messenger";

/** Comms Jam (a quickhack): no calls out. */
export const jammed = (actor) => !!actor?.statuses?.has?.("qhCommsJam");

/**
 * Holocalls are Night City Messenger's (christinophrappuccino, MIT, 2.1+): its numbers, call
 * screen, voicemail, call logs and networks. This module only gives it more ways in: the Actors
 * directory, sheet headers, map pins and the Biomon Link. Calls go through NCM's public api v2
 * (calls.place); a number is read through its macro helper, since api v2 has no lookup yet.
 *
 * NCM decides who can be reached (its networks and dead zones). This module adds two reasons a
 * character can't call out: a Comms Jam, and standing on dead ground on the Night City Map.
 */
export const Phone = {
  /** NCM's api v2, or null when it's off or hasn't started. */
  get api() {
    const m = game.modules.get(NCM_ID);
    return m?.active ? m.api?.v2 ?? null : null;
  },

  /** Is calling on: NCM is up with its Calls feature switched on? */
  get on() {
    try {
      return !!this.api?.features?.has?.("calls");
    } catch {
      return false;
    }
  },

  /** The number a character answers on (theirs, or the directory contact played by them), or "". */
  async numberOf(actor) {
    if (!actor) return "";
    const nc = game.nightcity;
    try {
      const own = nc?.messenger?.getNumber?.(actor.id) || nc?.callService?.numberOf?.(actor.id);
      if (own) return own;
      if (!game.user.isGM) return "";
      const res = await this.api?.directory?.list?.();
      const contact = res?.ok ? res.data.find((c) => c.actorId === actor.id) : null;
      return (contact && nc?.callService?.numberOfContact?.(contact.id)) || "";
    } catch (err) {
      console.warn(`${MODULE_ID} | couldn't read ${actor.name}'s number from Night City Messenger`, err);
      return "";
    }
  },

  /**
   * Who this user calls as: `as` when they own it; else the token they have selected, if theirs;
   * else (a player) their own character. The GM with nothing picked calls as NCM's operator.
   */
  caller(as = null, { not = null } = {}) {
    const mine = (a) => a && a.isOwner && a.id !== not?.id && ["character", "mook"].includes(a.type);
    if (mine(as)) return as;
    const token = globalThis.canvas?.tokens?.controlled?.[0]?.actor ?? null;
    if (mine(token)) return token;
    if (game.user.isGM) return null;
    return [game.user.character, ...game.actors.filter((a) => a.type === "character")].find(mine) ?? null;
  },

  /** Why a character can't call out, in words, or "" when they can. */
  blocked(actor) {
    if (!actor) return "";
    if (jammed(actor)) return L(`${LANG}.Holocall.Jammed`, { name: actor.name });
    if (Hub.noSignal(actor)) return L(`${LANG}.Holocall.NoSignalAt`, { name: actor.name, where: Hub.whereIs(actor) });
    return "";
  },

  /**
   * Holocall a character through Night City Messenger. Every refusal is a warning, never a throw.
   * @param {Actor} target
   * @param {object} [options] - { as: the actor to call as }
   * @returns {Promise<{ callId, emergency } | null>}
   */
  async call(target, { as = null } = {}) {
    const warn = (text) => {
      ui.notifications.warn(text);
      return null;
    };
    if (!this.on) return warn(L(`${LANG}.Holocall.NoMessenger`));
    if (!target) return warn(L(`${LANG}.Holocall.NoOne`));
    const from = this.caller(as, { not: target });
    const why = this.blocked(from);
    if (why) return warn(why);
    const number = await this.numberOf(target);
    if (!number) return warn(L(`${LANG}.Holocall.NoNumber`, { name: target.name }));
    const res = await this.api.calls.place(number, from ? { actorId: from.id } : {});
    if (!res?.ok) return warn(res?.error || L(`${LANG}.Holocall.Failed`, { name: target.name }));
    return res.data;
  },

  /** Open a character's phone (their Agent, at its Calls tab); with no one, NCM's own phone button. */
  async open(actor = null) {
    if (!this.on) {
      ui.notifications.warn(L(`${LANG}.Holocall.NoMessenger`));
      return false;
    }
    const nc = game.nightcity;
    if (!actor) {
      if (typeof nc?.openPhone !== "function") return false;
      await nc.openPhone();
      return true;
    }
    if (typeof nc?.openInbox === "function") {
      nc.openInbox(actor.id, null, { filter: "calls" });
      return true;
    }
    const res = await this.api.open.inbox(actor.id);
    if (!res?.ok) ui.notifications.warn(res?.error ?? L(`${LANG}.Holocall.NoMessenger`));
    return !!res?.ok;
  }
};
