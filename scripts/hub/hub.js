import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Cards } from "../combat/cards.js";
import { NC2070 } from "./data.js";
import { districtAt, deadAt, plan, formatMinutes, travelMinutes, WINDING, km } from "./geo.js";
import { Doorway } from "./doorway.js";
import { L, esc } from "../util.js";

const { deepClone } = foundry.utils;

/**
 * The City & NCART hub's shared state (world setting "cityHub", written by the GM):
 *   crew   { x, y, label } - where the crew is ("We are here")
 *   pins   { [actorId]: { x, y } } - where each character is (players pin their own)
 *   notes  { [placeKey]: { note, scene, tile, tag, open } } - the GM's notes on places, and
 *          their doorways (a scene to walk into, where to land, and whether players may)
 *   shown  { view, x, y, key, at } - what the GM last showed the players
 *   seen   { [placeKey]: true | false } - places the GM revealed (true) or hid (false)
 *   custom { [id]: { id, name, cat, x, y, text, sc, guard, img } } - the GM's own places
 *   edits  { [placeKey]: { name?, cat?, text?, sc?, guard?, img?, x?, y? } } - changes to built-in places
 * Map positions also decide holocall signal: a character pinned on dead ground can't call or be
 * reached.
 *
 * Discovery (setting "hubDiscovery", on by default): players see a place only once the GM reveals
 * it. With it off, they see every place the GM hasn't hidden.
 */

/** The category for the GM's own places, beside the map's seven. */
export const CAMPAIGN_CAT = { campaign: { label: "Campaign", color: "#f3e600" } };
export const Hub = {
  /** The open hub, if any (hub-app.js sets it). */
  app: null,

  get state() {
    const s = Settings.get("cityHub") ?? {};
    return {
      crew: s.crew ?? null, pins: s.pins ?? {}, notes: s.notes ?? {}, shown: s.shown ?? null,
      seen: s.seen ?? {}, custom: s.custom ?? {}, edits: s.edits ?? {}
    };
  },

  /** Place categories: the map's seven and the GM's "Campaign". */
  get cats() {
    return { ...NC2070.cats, campaign: { ...CAMPAIGN_CAT.campaign, label: L(`${LANG}.Hub.CampaignCat`) } };
  },

  /** A place's key: its map number, its badge id (NCU, Trauma Team), or "c-<id>" for the GM's own. */
  placeKey(p) {
    if (p?.custom) return `c-${p.id}`;
    return p?.n ? `p${p.n}` : p?.id ?? null;
  },

  /**
   * Every place, as it stands: the built-in 85 with the GM's edits, then the GM's own. Each has
   * key, custom, edited, and hidden (from the players, whoever's looking).
   */
  places() {
    const { seen, custom, edits } = this.state;
    const discovery = Settings.get("hubDiscovery") !== false;
    const out = NC2070.places.map((p) => {
      const key = this.placeKey(p);
      const e = edits[key];
      // Discovery: hidden until revealed. Without it: shown unless hidden.
      const hidden = discovery ? seen[key] !== true : seen[key] === false;
      return { ...p, ...(e ?? {}), key, custom: false, edited: !!e, hidden };
    });
    for (const c of Object.values(custom)) {
      const key = `c-${c.id}`;
      out.push({ n: null, cat: "campaign", sc: null, guard: "", text: "", ...c, key, custom: true, edited: false, hidden: seen[key] !== true });
    }
    return out;
  },

  /** The places this user may see: everything for the GM, the discovered for players. */
  visiblePlaces(user = game.user) {
    const all = this.places();
    return user.isGM ? all : all.filter((p) => !p.hidden);
  },

  place(key) {
    return this.places().find((p) => p.key === key) ?? null;
  },

  /* ---------------------------------------- */
  /*  Places (GM)                             */
  /* ---------------------------------------- */

  /**
   * GM: reveal places to the players (or hide them). A reveal posts a "Location discovered" card
   * unless `quiet`.
   * @param {string|string[]} keys
   */
  async setSeen(keys, seen, { quiet = false } = {}) {
    const list = [keys].flat().filter(Boolean);
    const before = new Map(this.places().map((p) => [p.key, p.hidden]));
    const newly = seen && !quiet ? list.filter((k) => before.get(k)) : [];
    await this._write((s) => {
      s.seen ??= {};
      for (const k of list) s.seen[k] = !!seen;
      // One place found: its dossier opens on the players' screens (setting).
      const one = newly.length === 1 ? NC2070.places.find((p) => this.placeKey(p) === newly[0]) ?? s.custom?.[newly[0].slice(2)] : null;
      if (one && Settings.get("hubRevealDossier")) {
        const p = { ...one, ...(s.edits?.[newly[0]] ?? {}) };
        s.shown = { view: "city", key: `p:${newly[0]}`, x: p.x, y: p.y, s: 1.6, dossier: newly[0], at: Date.now() };
      }
    });
    if (!newly.length) return;
    const found = newly.map((k) => this.place(k)).filter(Boolean);
    if (!found.length) return;
    const where = (p) => districtAt(p.x, p.y).name;
    await Cards.post({
      kicker: L(`${LANG}.Hub.DiscoveredKicker`),
      title: found.length === 1 ? L(`${LANG}.Hub.Discovered`, { name: esc(found[0].name) }) : L(`${LANG}.Hub.DiscoveredMany`, { count: found.length }),
      img: found.length === 1 && found[0].img ? found[0].img : `modules/${MODULE_ID}/assets/icons/hub.svg`,
      tone: "yellow",
      body: found.map((p) => `<p><b>${esc(p.name)}</b> · ${esc(where(p))}${found.length === 1 && p.text ? `<br>${esc(p.text)}` : ""}</p>`).join("")
        + `<p class="ncm-ref">${L(`${LANG}.Hub.DiscoveredHint`)}</p>`
    });
  },

  /** The fields a place can carry, cleaned up. */
  _fields(data) {
    const out = {};
    if ("name" in data) out.name = String(data.name ?? "").trim().slice(0, 80);
    if ("cat" in data) out.cat = this.cats[data.cat] ? data.cat : "campaign";
    if ("text" in data) out.text = String(data.text ?? "").trim().slice(0, 2000);
    if ("guard" in data) out.guard = String(data.guard ?? "").trim().slice(0, 120);
    if ("img" in data) out.img = String(data.img ?? "").trim();
    if ("sc" in data) out.sc = Number.isFinite(Number(data.sc)) && data.sc !== "" && data.sc !== null ? Math.max(0, Math.min(10, Math.round(Number(data.sc)))) : null;
    if ("x" in data) out.x = Math.round(Number(data.x));
    if ("y" in data) out.y = Math.round(Number(data.y));
    return out;
  },

  /**
   * GM: a new place of your own at a point. Hidden from the players until revealed (or pass
   * `visible`).
   * @returns {Promise<string>} its key
   */
  async addPlace(data, { visible = false } = {}) {
    const f = this._fields({ cat: "campaign", ...data });
    if (!f.name) throw new Error(L(`${LANG}.Hub.NeedName`));
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) throw new Error(L(`${LANG}.Hub.NeedSpot`));
    const id = foundry.utils.randomID(10);
    await this._write((s) => {
      s.custom ??= {};
      s.custom[id] = { id, name: f.name, cat: f.cat, x: f.x, y: f.y, text: f.text ?? "", sc: f.sc ?? null, guard: f.guard ?? "", img: f.img ?? "" };
      if (visible) (s.seen ??= {})[`c-${id}`] = true;
    });
    return `c-${id}`;
  },

  /** GM: change a place (yours, or a built-in one: those changes can be undone with resetPlace). */
  async updatePlace(key, data) {
    const f = this._fields(data);
    if ("name" in f && !f.name) throw new Error(L(`${LANG}.Hub.NeedName`));
    await this._write((s) => {
      if (key.startsWith("c-")) {
        const c = s.custom?.[key.slice(2)];
        if (c) Object.assign(c, f);
        return;
      }
      const base = NC2070.places.find((p) => this.placeKey(p) === key);
      if (!base) return;
      // Keep only what differs from the map's own.
      const next = { ...(s.edits?.[key] ?? {}), ...f };
      for (const [k, v] of Object.entries(next)) if (v === (base[k] ?? (k === "img" ? "" : base[k]))) delete next[k];
      s.edits ??= {};
      if (Object.keys(next).length) s.edits[key] = next;
      else delete s.edits[key];
    });
  },

  /** GM: a built-in place back to how the map has it. */
  async resetPlace(key) {
    await this._write((s) => {
      delete s.edits?.[key];
    });
  },

  /** GM: delete one of your own places (built-in ones can only be hidden). */
  async removePlace(key) {
    if (!key.startsWith("c-")) throw new Error(L(`${LANG}.Hub.CantDelete`));
    await this._write((s) => {
      delete s.custom?.[key.slice(2)];
      delete s.seen?.[key];
      delete s.notes?.[key];
    });
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

  /**
   * GM: a place's note and doorway: the scene it leads into, the tile (or Tagger tag) to land on,
   * and whether players may walk in from the map. Picking another scene clears the tile.
   */
  async setNote(key, { note, scene, tile, tag, open } = {}) {
    await this._write((s) => {
      const cur = s.notes[key] ?? {};
      const sceneChanged = scene !== undefined && scene !== (cur.scene ?? "");
      const next = {
        note: note ?? cur.note ?? "",
        scene: scene ?? cur.scene ?? "",
        tile: tile ?? (sceneChanged ? "" : cur.tile ?? ""),
        tag: tag ?? cur.tag ?? "",
        open: open ?? cur.open ?? false
      };
      if (!next.scene) Object.assign(next, { tile: "", tag: "", open: false });
      if (!next.note && !next.scene) delete s.notes[key];
      else s.notes[key] = next;
    });
  },

  /** A place's doorway: { scene, tile, tag, open, name } (scene "" when it has none). */
  doorOf(key) {
    const n = this.state.notes[key] ?? {};
    return { scene: n.scene ?? "", tile: n.tile ?? "", tag: n.tag ?? "", open: !!n.open, name: this.place(key)?.name ?? "" };
  },

  /** Walk into a place's scene (as a character you own). Players need it revealed and open. */
  async go(key, actorId = null) {
    const p = this.place(key);
    if (!p || (p.hidden && !game.user.isGM)) throw new Error(L(`${LANG}.Hub.Door.Blocked.closed`));
    return Doorway.go(key, this.doorOf(key), actorId);
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
    Socket.on("hubGo", async ({ key, actorId }, userId) => {
      const user = game.users.get(userId);
      const p = this.place(key);
      if (!p || (p.hidden && !user?.isGM)) throw new Error(L(`${LANG}.Hub.Door.Blocked.closed`));
      return Doorway._goAsGM({ key, door: this.doorOf(key), actorId }, userId);
    });
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
    this.open({ view: shown.view, focus: shown, dossier: shown.dossier ?? null });
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
