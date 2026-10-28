import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Cards } from "../combat/cards.js";
import { NC2070 } from "./data.js";
import { districtAt, deadAt, plan, formatMinutes, travelMinutes, WINDING, km } from "./geo.js";
import { L, esc } from "../util.js";

const { deepClone } = foundry.utils;

/**
 * The City & NCART hub's shared state (world setting "cityHub", written by the GM):
 *   crew   { x, y, label } - where the crew is ("We are here")
 *   pins   { [actorId]: { x, y } } - where each character is (players pin their own)
 *   notes  { [placeKey]: { note, scene } } - the GM's notes and battle-map scenes on places
 *   shown  { view, x, y, key, at } - what the GM last showed the players
 * Map positions also decide holocall signal: a character pinned on dead ground can't call or be
 * reached.
 */
export const Hub = {
  /** The open hub, if any (hub-app.js sets it). */
  app: null,

  get state() {
    const s = Settings.get("cityHub") ?? {};
    return { crew: s.crew ?? null, pins: s.pins ?? {}, notes: s.notes ?? {}, shown: s.shown ?? null };
  },

  /** A place's key: its map number, or its badge id (NCU, Trauma Team). */
  placeKey(p) {
    return p?.n ? `p${p.n}` : p?.id ?? null;
  },

  place(key) {
    return NC2070.places.find((p) => this.placeKey(p) === key) ?? null;
  },

  /** Where a character is pinned (or null). */
  pinOf(actor) {
    const id = actor?.id ?? actor;
    return this.state.pins[id] ?? null;
  },

  /* ---------------------------------------- */
  /*  Changes (through the GM)                */
  /* ---------------------------------------- */

  async _write(fn) {
    if (!game.user.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    const s = deepClone(Settings.get("cityHub") ?? {});
    s.pins ??= {};
    s.notes ??= {};
    fn(s);
    await Settings.set("cityHub", s);
  },

  /** GM: put the crew marker somewhere (null clears it). */
  async setCrew(point, label = "") {
    await this._write((s) => {
      s.crew = point ? { x: Math.round(point.x), y: Math.round(point.y), label: String(label ?? "") } : null;
    });
  },

  /** Pin a character on the map (null unpins). Players pin their own characters through the GM. */
  async setPin(actor, point) {
    const actorId = actor?.id ?? actor;
    const data = { actorId, point: point ? { x: Math.round(point.x), y: Math.round(point.y) } : null };
    if (game.user.isGM) return this._pin(data);
    return Socket.request("hubPin", data);
  },

  async _pin({ actorId, point }) {
    await this._write((s) => {
      if (point) s.pins[actorId] = point;
      else delete s.pins[actorId];
    });
  },

  /** GM: a note and a battle-map scene for a place. */
  async setNote(key, { note, scene } = {}) {
    await this._write((s) => {
      const cur = s.notes[key] ?? {};
      const next = { note: note ?? cur.note ?? "", scene: scene ?? cur.scene ?? "" };
      if (!next.note && !next.scene) delete s.notes[key];
      else s.notes[key] = next;
    });
  },

  /** GM: open the hub on everyone's screen at a view and spot. */
  async show(view) {
    await this._write((s) => {
      s.shown = { ...view, at: Date.now() };
    });
  },

  /* ---------------------------------------- */
  /*  Travel                                  */
  /* ---------------------------------------- */

  /**
   * GM: the crew travels. World time moves by the trip's minutes (a car or cab trip longer than
   * one district rolls for a jam), the crew marker moves, and a card tells the table.
   * @param {object} a - { x, y, name }
   * @param {object} b - { x, y, name }
   * @param {string} mode - walk, skates, bike, ncart, car, moto, av
   */
  async travel(a, b, mode, { storm = false } = {}) {
    if (!game.user.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    const hour = Math.floor(((game.time.worldTime % 86400) + 86400) % 86400 / 3600);
    const trip = plan(a, b, { hour, storm });
    let minutes = trip.times[mode];
    if (!minutes) throw new Error(L(`${LANG}.Hub.NoWay`));
    let jam = null;
    let roll = null;
    if (["car", "moto"].includes(mode) && trip.km > 4) {
      roll = await new Roll("1d10").evaluate();
      if (roll.total <= (trip.rush ? 2 : 1)) jam = trip.rush ? "gridlock" : "jam";
      if (jam) minutes = travelMinutes("car", trip.km, { rush: trip.rush, moto: mode === "moto", jam, storm });
    }
    await game.time.advance(minutes * 60);
    await this.setCrew(b, b.name ?? "");
    const ncart = mode === "ncart" && trip.ncart ? this.ncartText(trip.ncart) : "";
    const notes = [
      trip.rush && ["car", "moto"].includes(mode) ? L(`${LANG}.Hub.RushHour`) : "",
      jam ? L(`${LANG}.Hub.Jam.${jam}`, { roll: roll.total }) : roll ? L(`${LANG}.Hub.Jam.clear`, { roll: roll.total }) : "",
      trip.danger.length ? L(`${LANG}.Hub.Through`, { names: trip.danger.map((d) => esc(d.name)).join(", ") }) : ""
    ].filter(Boolean);
    await Cards.post({
      kicker: L(`${LANG}.Hub.TravelKicker`),
      title: L(`${LANG}.Hub.Traveled`, { from: esc(a.name ?? "?"), to: esc(b.name ?? "?") }),
      img: `modules/${MODULE_ID}/assets/icons/hub.svg`,
      tone: trip.danger.length ? "red" : "cyan",
      body: `<p>${L(`${LANG}.Hub.TravelBody`, { mode: L(`${LANG}.Hub.Mode.${mode}`), time: formatMinutes(minutes), km: trip.km })}</p>`
        + (ncart ? `<p class="ncm-ref">${ncart}</p>` : "")
        + notes.map((n) => `<p class="ncm-ref">${n}</p>`).join("")
    });
    Hooks.callAll(`${MODULE_ID}.hubTravel`, { from: a, to: b, mode, minutes, jam });
    return { minutes, jam, trip };
  },

  /** "Northern Line: Little China → Little Europe, then Central Loop: … → Silk Road". */
  ncartText(trip) {
    const st = (id) => esc(NC2070.stations[id]?.name ?? id);
    return trip.ride.legs.map((l) => `${esc(NC2070.lines[l.line]?.name ?? l.line)}: ${st(l.from)} → ${st(l.to)}`).join(" · ");
  },

  /* ---------------------------------------- */
  /*  Signal                                  */
  /* ---------------------------------------- */

  /** Dead-zone names from the setting ("Q, Laguna Bend"). */
  _extraDead() {
    return Settings.list("hubDeadZones");
  },

  /**
   * No signal where this character is pinned: ground with Utility Code 9+ (nothing works), or a
   * district the GM listed. Characters who aren't pinned, or with the rule off, have signal.
   */
  noSignal(actor) {
    if (!actor || !Settings.get("hubSignal")) return false;
    const pin = this.pinOf(actor);
    return !!pin && deadAt(pin.x, pin.y, { extra: this._extraDead() });
  },

  /** Where a character is, in words ("Little China"), or "". */
  whereIs(actor) {
    const pin = this.pinOf(actor);
    return pin ? districtAt(pin.x, pin.y).name : "";
  },

  /* ---------------------------------------- */
  /*  Wiring                                  */
  /* ---------------------------------------- */

  init() {
    game.keybindings.register(MODULE_ID, "openHub", {
      name: `${LANG}.Hub.Title`,
      hint: `${LANG}.Hub.KeyHint`,
      editable: [{ key: "KeyM", modifiers: ["Shift"] }],
      onDown: () => {
        this.toggle();
        return true;
      }
    });
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-hub", title: `${LANG}.Hub.Title`, icon: "fa-solid fa-map-location-dot", order: 105, onClick: () => this.open() }
    ]));
    Hooks.on("chatMessage", (log, message) => {
      if (!/^\/(map|hub|ncart)\s*$/i.test(String(message ?? ""))) return true;
      this.open({ view: /ncart/i.test(message) ? "ncart" : null });
      return false;
    });
    Hooks.on(`${MODULE_ID}.hubChanged`, (state, before) => this.onChange(state, before));
    Hooks.on("updateWorldTime", () => this.app?.refreshClock?.());
  },

  registerSocket() {
    Socket.on("hubPin", async ({ actorId, point }, userId) => {
      const user = game.users.get(userId);
      const actor = game.actors.get(actorId);
      if (!actor || (!user?.isGM && !actor.testUserPermission(user, "OWNER"))) throw new Error(L(`${LANG}.Error.NotOwner`));
      await this._pin({ actorId, point });
      return true;
    });
  },

  /** The setting changed: refresh the hub, and follow the GM when they show the players something. */
  onChange(state) {
    this.app?.refresh?.();
    const shown = state?.shown;
    if (!shown?.at || game.user.isGM || shown.at === this._lastShown) return;
    this._lastShown = shown.at;
    if (Date.now() - shown.at > 60_000 || !this.playersMayOpen()) return;
    this.open({ view: shown.view, focus: shown });
  },

  playersMayOpen() {
    return game.user.isGM || Settings.get("hubPlayers");
  },

  async open(options = {}) {
    if (!this.playersMayOpen()) return ui.notifications.warn(L(`${LANG}.Hub.GMOnly`));
    const { HubApp } = await import("./hub-app.js");
    this.app = HubApp.open(options);
    return this.app;
  },

  async toggle() {
    if (this.app?.el) return this.app.close();
    return this.open();
  },

  /** For tests and the API: a trip between two places by key. */
  planBetween(aKey, bKey, options = {}) {
    const a = this.place(aKey);
    const b = this.place(bKey);
    return a && b ? plan(a, b, options) : null;
  },

  /** A short walk: under a kilometre and a bit, door to door. */
  walkMinutes(a, b) {
    return travelMinutes("walk", km(a, b) * WINDING);
  }
};
