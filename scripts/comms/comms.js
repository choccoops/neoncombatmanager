import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Links } from "./links.js";
import { Calls } from "./calls.js";
import { Messenger } from "./messenger.js";
import { Sounds } from "./sounds.js";
import { Hub } from "../hub/hub.js";
import { alarm } from "./vitals.js";
import { L, esc } from "../util.js";

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
  /** Last status of each call this client is part of, for the connect and drop blips. */
  _status: new Map(),
  /** Last vitals per linked character, for the alarms. */
  _vitals: new Map(),
  /** The call this user's regular chat goes to while "talk from chat" is on, or null. */
  routing: null,

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

    // Holocall straight from an actor: the Actors directory's menu and the sheet header.
    for (const hook of ["getActorDirectoryEntryContext", "getActorContextOptions"]) {
      Hooks.on(hook, (html, options) => this.actorMenu(options));
    }
    Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
      const b = this.sheetButton(sheet.actor ?? sheet.object);
      if (b) buttons.unshift({ label: b.label, class: "ncm-holo-sheet", icon: b.icon, onclick: b.onClick });
    });
    Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
      const b = this.sheetButton(sheet.actor ?? sheet.document);
      if (b) controls.unshift({ label: b.label, icon: b.icon, action: "ncmHolocall", onClick: b.onClick });
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
    // /holo, and plain chat while talking from chat, go to the call.
    Hooks.on("chatMessage", (log, message) => this.onChatMessage(message));
    Hooks.on("renderChatLog", () => this.showRouting());
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

  async openHolocall(options = {}) {
    const { HolocallApp } = await import("./holocall-app.js");
    return HolocallApp.dial(options);
  },

  /**
   * Holocall with an actor: the GM calls as an NPC; anyone calls a character (not their own).
   * @returns {{ label, icon, onClick } | null}
   */
  holoFor(actor) {
    if (!actor || !["character", "mook"].includes(actor.type)) return null;
    if (game.user.isGM && !actor.hasPlayerOwner) {
      return { label: L(`${LANG}.Holocall.CallAsActor`, { name: actor.name }), icon: "fa-solid fa-phone-volume", onClick: () => this.openHolocall({ from: `actor:${actor.id}` }) };
    }
    if (actor.isOwner && !game.user.isGM) return { label: L(`${LANG}.Holocall.Title`), icon: "fa-solid fa-phone-volume", onClick: () => this.openHolocall({ from: `actor:${actor.id}` }) };
    return { label: L(`${LANG}.Holocall.CallActor`, { name: actor.name }), icon: "fa-solid fa-phone", onClick: () => this.openHolocall({ targets: [`actor:${actor.id}`] }) };
  },

  sheetButton(actor) {
    const b = this.holoFor(actor);
    return b ? { ...b, label: L(`${LANG}.Holocall.SheetButton`) } : null;
  },

  /** Actors directory entries: "Holocall as <NPC>" for the GM, "Holocall <name>" for anyone. */
  actorMenu(options) {
    const idOf = (li) => {
      const el = li?.[0] ?? li;
      return el?.dataset?.documentId ?? el?.dataset?.entryId;
    };
    options.push({
      name: `${LANG}.Holocall.MenuEntry`,
      icon: '<i class="fa-solid fa-phone-volume"></i>',
      condition: (li) => !!this.holoFor(game.actors.get(idOf(li))),
      callback: (li) => this.holoFor(game.actors.get(idOf(li)))?.onClick()
    });
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
          const who = p.actorId ? game.actors.get(p.actorId) : null;
          if (!game.user.isGM && Messenger.deadZone(Calls.here)) await Calls.decline(call.id, p.id, "nosignal").catch(() => null);
          else if (Hub.noSignal(who)) await Calls.decline(call.id, p.id, "nosignal").catch(() => null);
          else IncomingCallApp.show(call.id, p.id);
        } else if (p.state !== "ringing") {
          IncomingCallApp.dismiss(call.id, p.id);
        }
      }
      // Talking from chat stops with the call (or when this user is no longer on it).
      if (this.routing === call.id && !Calls.mine().some((c) => c.id === call.id)) this.setRouting(null);
      // A call this player is on (after a reload, say) opens its window once.
      const onIt = call.status !== "ended" && call.participants.some((p) => p.state === "joined" && (game.user.isGM ? call.startedBy === game.user.id : Calls.speaksFor(p)));
      if (onIt && !this._opened.has(call.id)) {
        this._opened.add(call.id);
        if (!HolocallApp.windows.has(call.id)) HolocallApp.show(call.id);
      }
    }
    HolocallApp.refresh();
    this.sounds();
  },

  /** Ring while a call is coming in; ringback while this user's own call rings; blips on connect and drop. */
  async sounds() {
    const { IncomingCallApp } = await import("./incoming-app.js");
    const ringing = IncomingCallApp.windows.size > 0;
    const mine = Calls.live().filter((c) => c.startedBy === game.user.id);
    const back = mine.some((c) => c.status === "ringing");
    if (ringing) Sounds.ring();
    else if (back) Sounds.back();
    else if (Sounds.playing) Sounds.stop();
    for (const call of Calls.all()) {
      const was = this._status.get(call.id);
      const involved = call.startedBy === game.user.id || call.participants.some((p) => p.joinedAt && Calls.speaksFor(p) && !(game.user.isGM && !Calls._gmOnly(p)));
      if (!involved) continue;
      if (was && was !== "active" && call.status === "active") Sounds.blip(true);
      if (was === "active" && call.status === "ended") Sounds.blip(false);
      this._status.set(call.id, call.status);
    }
  },

  /* ---------------------------------------- */
  /*  Talking from the chat box               */
  /* ---------------------------------------- */

  /**
   * The chat box: "/holo text" says it on your call; "/holo" alone turns talking from chat on or
   * off; while it's on, plain chat goes to the call (other /commands, like rolls, still work).
   * @returns {boolean} false when the message was taken for a call (Foundry then posts nothing)
   */
  onChatMessage(message) {
    const text = String(message ?? "");
    const holo = text.match(/^\/holo(?:\s+([\s\S]*))?$/i);
    if (holo) {
      const body = (holo[1] ?? "").trim();
      if (body) this.sayFromChat(body);
      else this.setRouting(this.routing ? null : Calls.mine()[0]?.id ?? null, { announce: true });
      return false;
    }
    if (this.routing && text.trim() && !text.trim().startsWith("/")) {
      this.sayFromChat(text.trim(), this.routing);
      return false;
    }
    return true;
  },

  /** Say something on a call (the one being talked on from chat, else the latest) from the chat box. */
  sayFromChat(text, callId = null) {
    const call = (callId ? Calls.get(callId) : null) ?? Calls.mine()[0] ?? null;
    if (!call || call.status === "ended") {
      ui.notifications.warn(L(`${LANG}.Holocall.NotOnCall`));
      return null;
    }
    const voice = Calls.voice(call);
    if (!voice) {
      ui.notifications.warn(L(`${LANG}.Holocall.NotOnCall`));
      return null;
    }
    return Calls.say(call.id, voice.id, text).catch((err) => ui.notifications.warn(err.message));
  },

  /** Turn talking from chat on (for a call) or off (null). */
  setRouting(callId, { announce = false } = {}) {
    if (callId && !Calls.mine().some((c) => c.id === callId)) callId = null;
    if (announce && !callId && !this.routing) ui.notifications.warn(L(`${LANG}.Holocall.NotOnCall`));
    const was = this.routing;
    this.routing = callId;
    if (announce && was !== callId) ui.notifications.info(L(`${LANG}.Holocall.${callId ? "RoutingOn" : "RoutingOff"}`));
    this.showRouting();
    this.refreshCall(callId ?? was);
  },

  /** The holo banner over the chat box (and the box tinted blue) while talking from chat. */
  showRouting() {
    if (typeof document === "undefined") return;
    const call = this.routing ? Calls.get(this.routing) : null;
    for (const box of document.querySelectorAll("textarea#chat-message")) {
      box.classList.toggle("ncm-holo-route", !!call);
      let banner = box.parentElement?.querySelector(":scope > .ncm-holo-banner");
      if (!call) {
        banner?.remove();
        continue;
      }
      if (!banner) {
        banner = document.createElement("button");
        banner.type = "button";
        banner.className = "ncm-holo-banner";
        banner.addEventListener("click", () => this.setRouting(null, { announce: true }));
        box.before(banner);
      }
      const names = call.participants.filter((p) => p.state === "joined" && !Calls.speaksFor(p)).map((p) => p.name).join(", ");
      banner.dataset.tooltip = L(`${LANG}.Holocall.RoutingStop`);
      banner.innerHTML = `<i class="fa-solid fa-phone-volume"></i> ${esc(L(`${LANG}.Holocall.Routing`, { names: names || "…" }))}`;
    }
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
