import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Links } from "./links.js";
import { Calls } from "./calls.js";
import { Messenger } from "./messenger.js";
import { alarm } from "./vitals.js";
import { L } from "../util.js";

/**
 * Comms: the Biomon Link and Holocalls wired into Foundry. Token-control buttons and
 * keybindings open them; setting changes ring phones and open call windows; actor changes
 * refresh the vitals and sound the link's alarms; holocall messages are dressed in blue in chat.
 */
export const Comms = {
  /** Ringing participants already shown to this user ("callId-pid"). */
  _rung: new Set(),
  /** Calls whose window this user already had opened for them. */
  _opened: new Set(),
  /** Last vitals per linked character, for the alarms. */
  _vitals: new Map(),

  init() {
    game.keybindings.register(MODULE_ID, "openBiomon", {
      name: `${LANG}.Biomon.Title`,
      hint: `${LANG}.Biomon.KeyHint`,
      editable: [],
      onDown: () => {
        this.openBiomon();
        return true;
      }
    });
    game.keybindings.register(MODULE_ID, "openHolocall", {
      name: `${LANG}.Holocall.Title`,
      hint: `${LANG}.Holocall.KeyHint`,
      editable: [],
      onDown: () => {
        this.openHolocall();
        return true;
      }
    });

    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-biomon", title: `${LANG}.Biomon.Title`, icon: "fa-solid fa-heart-pulse", onClick: () => this.openBiomon() },
      { name: "ncm-holocall", title: `${LANG}.Holocall.Title`, icon: "fa-solid fa-phone-volume", onClick: () => this.openHolocall() }
    ]));

    Hooks.on(`${MODULE_ID}.callsChanged`, () => this.onCalls());
    Hooks.on(`${MODULE_ID}.linksChanged`, () => {
      this.seed();
      this.refreshBiomon();
    });
    for (const h of ["updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "deleteItem"]) {
      Hooks.on(h, (doc) => this.onActor(doc?.documentName === "Actor" ? doc : doc?.parent));
    }
    Hooks.on("createChatMessage", (message) => {
      const callId = message.flags?.[MODULE_ID]?.holocall;
      if (callId) this.refreshCall(callId);
    });
    Hooks.on(Compat.chatRenderHook, (message, html) => this.dressMessage(message, html));
  },

  async ready() {
    this.seed();
    await Calls.tidy();
    this.onCalls();
  },

  async openBiomon() {
    const { BiomonApp } = await import("./biomon-app.js");
    return BiomonApp.open();
  },

  async openHolocall() {
    const { HolocallApp } = await import("./holocall-app.js");
    return HolocallApp.dial();
  },

  async refreshBiomon() {
    const { BiomonApp } = await import("./biomon-app.js");
    BiomonApp.refresh();
  },

  async refreshCall(callId) {
    const { HolocallApp } = await import("./holocall-app.js");
    HolocallApp.refresh(callId);
  },

  /* ---------------------------------------- */
  /*  Calls                                   */
  /* ---------------------------------------- */

  /** The calls setting changed: ring, stop ringing, open and refresh call windows. */
  async onCalls() {
    const { IncomingCallApp } = await import("./incoming-app.js");
    const { HolocallApp } = await import("./holocall-app.js");
    for (const call of Calls.all()) {
      for (const p of call.participants) {
        const key = `${call.id}-${p.id}`;
        const mine = Calls.answerers(p).some((u) => u.id === game.user.id);
        if (p.state === "ringing" && mine && !this._rung.has(key)) {
          this._rung.add(key);
          // No signal here: the call can't reach this phone.
          if (!game.user.isGM && Messenger.deadZone(Calls.here)) await Calls.decline(call.id, p.id, "nosignal").catch(() => null);
          else IncomingCallApp.show(call.id, p.id);
        } else if (p.state !== "ringing") {
          IncomingCallApp.dismiss(call.id, p.id);
        }
      }
      // A call this player is on (after a reload, say) opens its window once.
      const onIt = call.status !== "ended" && call.participants.some((p) => p.state === "joined" && (game.user.isGM ? call.startedBy === game.user.id : Calls.speaksFor(p)));
      if (onIt && !this._opened.has(call.id)) {
        this._opened.add(call.id);
        if (!HolocallApp.windows.has(call.id)) HolocallApp.show(call.id);
      }
    }
    HolocallApp.refresh();
  },

  /** Holocall messages look like holocalls in the chat log too. */
  dressMessage(message, html) {
    if (!message?.flags?.[MODULE_ID]?.holocall) return;
    const el = Compat.element(html);
    el?.classList.add("ncm-holo");
    el?.closest?.(".chat-message")?.classList.add("ncm-holo");
  },

  /* ---------------------------------------- */
  /*  Vitals                                  */
  /* ---------------------------------------- */

  /** Remember the vitals of every character in a link this user watches. */
  seed() {
    this._vitals.clear();
    for (const link of Links.visible()) for (const a of Links.members(link)) this._vitals.set(a.id, Links.vitals(a));
  },

  /** A linked character changed: refresh the readouts, and raise the alarm if they crashed. */
  onActor(actor) {
    if (!actor?.id || !this._vitals.has(actor.id)) return;
    const before = this._vitals.get(actor.id);
    const after = Links.vitals(actor);
    this._vitals.set(actor.id, after);
    this.refreshBiomon();
    const state = alarm(before, after);
    const mode = Settings.get("biomonAlerts");
    if (!state || mode === "off") return;
    const text = L(`${LANG}.Biomon.Alarm`, { name: actor.name, state: L(`${LANG}.Biomon.State.${state}`), penalty: after.deathSave ?? 0 });
    if (state === "flatline") ui.notifications.error(text);
    else ui.notifications.warn(text);
    if (mode === "open") this.openBiomon();
  }
};
