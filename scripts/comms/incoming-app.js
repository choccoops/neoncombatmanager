import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Calls } from "./calls.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The incoming holocall: who's calling, who for, Accept or Decline. One per ringing participant. */
export class IncomingCallApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static windows = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["neon-combat", "ncm-window", "ncm-incoming"],
    window: { icon: "fa-solid fa-phone-volume", minimizable: false },
    position: { width: 300, height: "auto" },
    actions: { acceptCall: IncomingCallApp.#onAccept, declineCall: IncomingCallApp.#onDecline }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/incoming-call.hbs` } };

  static key(callId, pid) {
    return `${callId}-${pid}`;
  }

  static show(callId, pid) {
    const key = this.key(callId, pid);
    if (this.windows.has(key)) return this.windows.get(key);
    const app = new this({ id: `${MODULE_ID}-ring-${key}`, callId, pid });
    this.windows.set(key, app);
    // Stack them a little if several ring at once.
    const n = this.windows.size - 1;
    app.render(true, { position: { top: 120 + n * 30, left: Math.max(20, window.innerWidth / 2 - 150 + n * 30) } });
    return app;
  }

  static dismiss(callId, pid) {
    this.windows.get(this.key(callId, pid))?.close();
  }

  constructor(options = {}) {
    super(options);
    this.callId = options.callId;
    this.pid = options.pid;
  }

  get title() {
    return L(`${LANG}.Holocall.Incoming`);
  }

  _onClose(options) {
    super._onClose?.(options);
    IncomingCallApp.windows.delete(IncomingCallApp.key(this.callId, this.pid));
  }

  async _prepareContext() {
    const call = Calls.get(this.callId);
    const me = call?.participants.find((p) => p.id === this.pid);
    const caller = call?.participants.find((p) => p.id === call.callerId);
    const others = (call?.participants ?? []).filter((p) => p.id !== this.pid && p.id !== call?.callerId && ["joined", "ringing"].includes(p.state));
    return {
      caller,
      // The GM sees which NPC (or absent player's character) is being rung.
      forName: game.user.isGM || Calls.answerers(me).length > 1 ? me?.name : null,
      others: others.map((p) => p.name).join(", ")
    };
  }

  static async #onAccept() {
    const { callId } = this;
    try {
      await Calls.answer(callId, this.pid);
      this.close();
      const { HolocallApp } = await import("./holocall-app.js");
      HolocallApp.show(callId);
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }

  static async #onDecline() {
    await Calls.decline(this.callId, this.pid).catch((err) => ui.notifications.warn(err.message));
    this.close();
  }
}
