import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Calls } from "./calls.js";
import { Links } from "./links.js";
import { Messenger } from "./messenger.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const isPC = (a) => a?.type === "character" && a.hasPlayerOwner;
const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The Holocall window. Without a call it's the dialer: who you're calling as, and who to ring
 * (the crew, a whole Biomon Link, your Night City Messenger contacts, and for the GM every NPC
 * and the messenger's directory). With a call it's the call: holo tiles for everyone on it, the
 * conversation in blue, and a line to talk on.
 */
export class HolocallApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Open windows by call id ("dialer" for the dialer). */
  static windows = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["neon-combat", "ncm-window", "ncm-holocall"],
    window: { icon: "fa-solid fa-phone-volume", resizable: true },
    position: { width: 460, height: 560 },
    actions: {
      placeCall: HolocallApp.#onPlace,
      pickLink: HolocallApp.#onPickLink,
      openCall: HolocallApp.#onOpenCall,
      sendHolo: HolocallApp.#onSend,
      hangUp: HolocallApp.#onHangUp,
      endCall: HolocallApp.#onEnd,
      inviteMore: HolocallApp.#onInvite
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/holocall.hbs`, scrollable: [".ncm-holo-feed", ".ncm-dial-lists"] } };

  /**
   * Open the dialer.
   * @param {object} [options] - link: tick a Biomon Link's other members; inviteTo: add to this call
   */
  static dial({ link = null, inviteTo = null } = {}) {
    const key = inviteTo ? `invite-${inviteTo}` : "dialer";
    let app = this.windows.get(key);
    if (!app) {
      app = new this({ id: `${MODULE_ID}-holocall-${key}`, inviteTo });
      this.windows.set(key, app);
    }
    if (link) {
      const mine = new Set(Links.mine().map((a) => a.id));
      for (const a of Links.members(link)) if (!mine.has(a.id)) app._picked.add(`actor:${a.id}`);
      const own = Links.members(link).find((a) => mine.has(a.id));
      if (own) app._from = `actor:${own.id}`;
    }
    app.render(true);
    return app;
  }

  /** Open (or bring up) a call's window. */
  static show(callId) {
    let app = this.windows.get(callId);
    if (!app) {
      app = new this({ id: `${MODULE_ID}-holocall-${callId}`, callId });
      this.windows.set(callId, app);
    }
    app.render(true);
    return app;
  }

  /** Re-render the windows showing a call (and the dialer's list of calls). */
  static refresh(callId = null) {
    for (const [key, app] of this.windows) if (app.rendered && (!callId || key === callId || key === "dialer")) app.render();
  }

  constructor(options = {}) {
    super(options);
    this.callId = options.callId ?? null;
    this.inviteTo = options.inviteTo ?? null;
    /** The dialer's state. Not `state`: AppV2 owns that name. */
    this._picked = new Set();
    this._from = null;
    this._contacts = [];
    this._search = "";
  }

  get title() {
    if (this.callId) return L(`${LANG}.Holocall.CallTitle`);
    return this.inviteTo ? L(`${LANG}.Holocall.InviteTitle`) : L(`${LANG}.Holocall.Title`);
  }

  _onClose(options) {
    super._onClose?.(options);
    clearInterval(this._tick);
    for (const [key, app] of HolocallApp.windows) if (app === this) HolocallApp.windows.delete(key);
  }

  async _prepareContext() {
    return this.callId ? this._callContext() : this._dialContext();
  }

  /* ---------------------------------------- */
  /*  Dialer                                  */
  /* ---------------------------------------- */

  /** Who this user can call as. */
  _callers() {
    const mine = Links.mine().map((a) => ({ value: `actor:${a.id}`, label: a.name }));
    if (!game.user.isGM) return mine;
    const npcs = game.actors.filter((a) => !a.hasPlayerOwner && ["character", "mook"].includes(a.type)).sort((a, b) => a.name.localeCompare(b.name));
    return [
      ...npcs.map((a) => ({ value: `actor:${a.id}`, label: a.name })),
      ...Messenger.directory().filter((c) => !c.actorId).map((c) => ({ value: `directory:${c.contactId}`, label: `${c.name} ◈` })),
      ...mine.map((m) => ({ ...m, label: `${m.label} (PC)` }))
    ];
  }

  /** The caller as a call target-shaped object. */
  _fromTarget() {
    const [kind, id] = String(this._from ?? "").split(":");
    if (kind === "actor") return { actorId: id };
    if (kind === "directory") {
      const c = Messenger.directory().find((x) => x.contactId === id);
      return c ? { contactId: c.contactId, source: "directory", name: c.name, img: c.img, actorId: c.actorId } : null;
    }
    return null;
  }

  async _dialContext() {
    const callers = this._callers();
    if (!this._from || !callers.some((c) => c.value === this._from)) this._from = callers[0]?.value ?? null;
    const call = this.inviteTo ? Calls.get(this.inviteTo) : null;
    const from = this._fromTarget();
    const fromActor = from?.actorId ? game.actors.get(from.actorId) : null;
    const onCall = new Set((call?.participants ?? []).filter((p) => ["joined", "ringing"].includes(p.state)).map((p) => p.actorId ?? p.contactId));

    // The crew: every player character but the caller.
    const crew = game.actors.filter((a) => isPC(a) && a.id !== fromActor?.id && !onCall.has(a.id)).sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({
      key: `actor:${a.id}`,
      name: a.name,
      img: a.img,
      online: game.users.some((u) => !u.isGM && u.active && a.testUserPermission(u, "OWNER")),
      picked: this._picked.has(`actor:${a.id}`)
    }));

    // The caller's own Night City Messenger contacts.
    this._contacts = fromActor ? await Messenger.contacts(fromActor) : [];
    const q = this._search.toLowerCase();
    const matches = (name) => !q || String(name).toLowerCase().includes(q);
    const contacts = this._contacts.filter((c) => !onCall.has(c.actorId ?? c.contactId) && matches(c.name)).map((c) => ({ ...c, picked: this._picked.has(c.key), trustPips: Array.from({ length: 5 }, (_, i) => i < c.trust) }));

    // GM: NPCs anywhere, and the messenger's directory.
    let npcs = [];
    let directory = [];
    if (game.user.isGM) {
      npcs = game.actors.filter((a) => !a.hasPlayerOwner && ["character", "mook"].includes(a.type) && a.id !== fromActor?.id && !onCall.has(a.id) && matches(a.name))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80)
        .map((a) => ({ key: `actor:${a.id}`, name: a.name, img: a.img, picked: this._picked.has(`actor:${a.id}`) }));
      directory = Messenger.directory().filter((c) => !onCall.has(c.actorId ?? c.contactId) && matches(c.name)).map((c) => ({ ...c, picked: this._picked.has(c.key) }));
    }

    const live = Calls.live().filter((c) => Calls.involved(c)).map((c) => ({
      id: c.id,
      names: c.participants.filter((p) => ["joined", "ringing"].includes(p.state)).map((p) => p.name).join(", "),
      status: L(`${LANG}.Holocall.Status.${c.status}`)
    }));

    return {
      dialer: true,
      invite: !!call,
      gm: game.user.isGM,
      callers: callers.map((c) => ({ ...c, selected: c.value === this._from })),
      crew,
      links: Links.visible().map((l) => ({ id: l.id, name: l.name, count: l.members.length })),
      contacts,
      npcs,
      directory,
      search: this._search,
      messenger: Messenger.ready,
      live,
      count: this._picked.size,
      deadZone: !game.user.isGM && Messenger.deadZone(Calls.here)
    };
  }

  /** Every target that can be picked, by key. */
  _targets() {
    const out = new Map();
    for (const a of game.actors) out.set(`actor:${a.id}`, { type: "actor", actorId: a.id, name: a.name, img: a.img });
    for (const c of [...this._contacts, ...(game.user.isGM ? Messenger.directory() : [])]) out.set(c.key, c);
    return out;
  }

  /** Keep what's being typed (and the focus) when a new message re-renders the call. */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const text = this.rendered ? this.element?.querySelector?.("textarea[name=text]") : null;
    if (text) {
      this._draft = text.value;
      this._focus = document.activeElement === text;
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (!this.callId) {
      el.querySelector("[name=from]")?.addEventListener("change", (ev) => {
        this._from = ev.target.value;
        this._picked.clear();
        this.render();
      });
      for (const box of el.querySelectorAll("input[data-pick]")) {
        box.addEventListener("change", () => {
          if (box.checked) this._picked.add(box.dataset.pick);
          else this._picked.delete(box.dataset.pick);
          const n = el.querySelector(".ncm-dial-count");
          if (n) n.textContent = String(this._picked.size);
        });
      }
      const search = el.querySelector("input[name=search]");
      search?.addEventListener("input", () => {
        this._search = search.value;
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(async () => {
          await this.render();
          const box = this.element.querySelector("input[name=search]");
          box?.focus();
          box?.setSelectionRange(box.value.length, box.value.length);
        }, 250);
      });
      return;
    }
    // The call: Enter sends, Shift+Enter is a new line; the feed sits at the bottom; the timer runs.
    const text = el.querySelector("textarea[name=text]");
    text?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        HolocallApp.#onSend.call(this);
      }
    });
    const feed = el.querySelector(".ncm-holo-feed");
    if (feed) feed.scrollTop = feed.scrollHeight;
    clearInterval(this._tick);
    const timer = el.querySelector(".ncm-holo-timer");
    const call = Calls.get(this.callId);
    if (timer && call?.connectedAt && call.status === "active") {
      this._tick = setInterval(() => (timer.textContent = fmt(Date.now() - call.connectedAt)), 1000);
    }
    if (text && this._draft) text.value = this._draft;
    if (text && this._focus) text.focus();
    this._draft = "";
    this._focus = false;
  }

  static async #onPlace() {
    const all = this._targets();
    const targets = [...this._picked].map((k) => all.get(k)).filter(Boolean);
    try {
      if (this.inviteTo) {
        await Calls.invite(this.inviteTo, targets);
        this.close();
        return;
      }
      const from = this._fromTarget();
      if (!from) throw new Error(L(`${LANG}.Holocall.NoCaller`));
      const callId = await Calls.place(from, targets);
      this._picked.clear();
      this.close();
      if (callId) HolocallApp.show(callId);
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }

  static #onPickLink(event, target) {
    const link = Links.get(target.dataset.linkId);
    const from = this._fromTarget();
    for (const a of Links.members(link)) if (a.id !== from?.actorId) this._picked.add(`actor:${a.id}`);
    this.render();
  }

  static #onOpenCall(event, target) {
    HolocallApp.show(target.dataset.callId);
  }

  /* ---------------------------------------- */
  /*  The call                                */
  /* ---------------------------------------- */

  _callContext() {
    const call = Calls.get(this.callId);
    if (!call) return { dialer: false, gone: true };
    const voices = call.participants.filter((p) => p.state === "joined" && Calls.speaksFor(p));
    // The GM speaks for NPCs first.
    voices.sort((a, b) => Number(Calls._gmOnly(b)) - Number(Calls._gmOnly(a)));
    if (!this._as || !voices.some((p) => p.id === this._as)) this._as = voices[0]?.id ?? null;
    return {
      dialer: false,
      gm: game.user.isGM,
      ended: call.status === "ended",
      ringing: call.status === "ringing",
      timer: call.connectedAt ? fmt((call.endedAt ?? Date.now()) - call.connectedAt) : "--:--",
      participants: call.participants.filter((p) => !["cancelled"].includes(p.state)).map((p) => ({
        ...p,
        stateLabel: L(`${LANG}.Holocall.State.${p.state}`),
        live: p.state === "joined"
      })),
      messages: Calls.messages(call.id).slice(-80).map((m) => ({
        name: m.flags[MODULE_ID].name ?? m.speaker?.alias ?? "",
        img: m.flags[MODULE_ID].img,
        content: m.content,
        mine: Calls.speaksFor(call.participants.find((p) => p.id === m.flags[MODULE_ID].participant) ?? {}),
        time: new Date(m.timestamp ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      })),
      voices: voices.map((p) => ({ value: p.id, label: p.name, selected: p.id === this._as })),
      canTalk: voices.length > 0 && call.status !== "ended"
    };
  }

  static async #onSend() {
    const text = this.element.querySelector("textarea[name=text]");
    const as = this.element.querySelector("[name=as]")?.value ?? this._as;
    if (!text?.value.trim()) return;
    this._as = as;
    const value = text.value;
    text.value = "";
    try {
      await Calls.say(this.callId, as, value);
    } catch (err) {
      this._draft = value;
      ui.notifications.warn(err.message);
    }
  }

  static async #onHangUp() {
    await Calls.hangUp(this.callId).catch((err) => ui.notifications.warn(err.message));
  }

  static async #onEnd() {
    await Calls.end(this.callId).catch((err) => ui.notifications.warn(err.message));
  }

  static #onInvite() {
    HolocallApp.dial({ inviteTo: this.callId });
  }
}
