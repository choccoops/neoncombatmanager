import { MODULE_ID } from "./constants.js";
import { Compat } from "./compat.js";

/**
 * Requests a player's client can't carry out itself (changing an actor it doesn't own, marking a
 * combatant defeated) go to the active GM, who runs them and answers.
 */
export const Socket = {
  handlers: new Map(),
  pending: new Map(),

  get name() {
    return `module.${MODULE_ID}`;
  },

  init() {
    game.socket.on(this.name, (msg) => this._receive(msg));
  },

  /** Register what the GM does for an action: async (data, userId) => result. */
  on(action, fn) {
    this.handlers.set(action, fn);
  },

  /** Run an action as the GM: here when this is the active GM, else over the socket. */
  async request(action, data) {
    if (Compat.isActiveGM || (game.user.isGM && !Compat.activeGM)) return this.handlers.get(action)?.(data, game.user.id);
    if (!Compat.activeGM) throw new Error(game.i18n.localize("NEONCOMBAT.Error.NoGM"));
    const id = foundry.utils.randomID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      game.socket.emit(this.name, { type: "request", id, action, data, from: game.user.id });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(game.i18n.localize("NEONCOMBAT.Error.Timeout")));
      }, 15000);
    });
  },

  /** Tell other clients something (no answer). */
  broadcast(action, data) {
    game.socket.emit(this.name, { type: "event", action, data, from: game.user.id });
  },

  async _receive(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "response" && msg.to === game.user.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
      return;
    }
    if (msg.type === "event") {
      this.handlers.get(`event:${msg.action}`)?.(msg.data, msg.from);
      return;
    }
    if (msg.type !== "request" || !Compat.isActiveGM) return;
    const fn = this.handlers.get(msg.action);
    let result = null;
    let error = null;
    try {
      result = fn ? await fn(msg.data, msg.from) : null;
    } catch (err) {
      console.error(`${MODULE_ID} | socket ${msg.action} failed`, err);
      error = err.message;
    }
    game.socket.emit(this.name, { type: "response", id: msg.id, to: msg.from, result, error });
  }
};
