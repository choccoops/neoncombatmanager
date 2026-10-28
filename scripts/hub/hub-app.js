import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { CombatTime } from "../combat/time.js";
import { Hub } from "./hub.js";
import { NC2070 } from "./data.js";
import { districtAt, districtByCode, deadAt, nearestStations, plan, rushHour, formatMinutes, km, DANGER } from "./geo.js";
import { Settings } from "../settings.js";
import { L, esc } from "../util.js";

const ASSETS = `modules/${MODULE_ID}/assets/maps`;
const VIEWS = {
  city: { img: `${ASSETS}/nc2070-city.webp`, w: NC2070.world.w, h: NC2070.world.h },
  zones: { img: `${ASSETS}/nc2070-zones.webp`, w: NC2070.world.w, h: NC2070.world.h },
  ncart: { img: `${ASSETS}/nc2070-ncart.webp`, w: NC2070.schematic.w, h: NC2070.schematic.h }
};
const RUNS = ["segs", "uc", "closed", "planned", "suspended"];
const hourNow = () => Math.floor((((game.time?.worldTime ?? 0) % 86400) + 86400) % 86400 / 3600);

/** A point on the map with a name: a place, a station, a character, or a spot clicked. */
const spot = (x, y, name, extra = {}) => ({ x: Math.round(x), y: Math.round(y), name, ...extra });

/**
 * The City & NCART hub: Night City 2070 full screen. Three views (the city, NCZTA-70 threat
 * zones, the NCART poster); the Notable Places, districts and stations to click; the crew and
 * the characters where they are; and a route planner with the 2070 travel times.
 */
export class HubApp {
  static instance = null;

  /** Open (or bring up) the hub. options: view, focus { x, y, key } */
  static open(options = {}) {
    this.instance ??= new this();
    this.instance.show(options);
    return this.instance;
  }

  constructor() {
    this.el = null;
    this.view = "city";
    this.t = { x: 0, y: 0, s: 0.4 };
    this.sel = null;
    this.route = { a: null, b: null };
    this.cats = new Set(Object.keys(NC2070.cats));
    this.layers = { places: true, ncart: true, people: true };
    this.query = "";
    this.storm = false;
    this.mode = "car";
  }

  /* ---------------------------------------- */
  /*  Frame                                   */
  /* ---------------------------------------- */

  async show({ view = null, focus = null } = {}) {
    if (view && VIEWS[view]) this.view = view;
    if (!this.el) await this.build();
    else this.setView(this.view);
    if (focus?.key) this.select(focus.key);
    if (focus && Number.isFinite(focus.x)) this.focus(focus.x, focus.y, focus.s ?? 1.4);
  }

  async build() {
    const html = await Compat.renderTemplate(`${TEMPLATE_PATH}/hub.hbs`, {
      gm: game.user.isGM,
      views: Object.keys(VIEWS).map((v) => ({ id: v, label: L(`${LANG}.Hub.View.${v}`) })),
      cats: Object.entries(NC2070.cats).map(([id, c]) => ({ id, label: c.label, color: c.color }))
    });
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    this.el = wrap.firstElementChild;
    document.body.appendChild(this.el);
    this.stage = this.el.querySelector(".ncm-hub-stage");
    this.world = this.el.querySelector(".ncm-hub-world");
    this.img = this.el.querySelector(".ncm-hub-img");
    this.svg = this.el.querySelector(".ncm-hub-svg");
    this._wire();
    this.setView(this.view);
    this.refreshClock();
    requestAnimationFrame(() => this.el?.classList.add("is-in"));
  }

  close() {
    const el = this.el;
    if (!el) return;
    this.el = null;
    el.classList.remove("is-in");
    window.removeEventListener("keydown", this._onKey, true);
    setTimeout(() => el.remove(), 220);
    if (Hub.app === this) Hub.app = null;
    HubApp.instance = null;
  }

  setView(view) {
    this.view = view;
    const v = VIEWS[view];
    this.el.className = `neon-combat ncm-hub view-${view}${this.el.classList.contains("is-in") ? " is-in" : ""}`;
    for (const b of this.el.querySelectorAll("[data-hub-view]")) b.classList.toggle("on", b.dataset.hubView === view);
    this.world.style.width = `${v.w}px`;
    this.world.style.height = `${v.h}px`;
    this.img.src = v.img;
    this.svg.setAttribute("viewBox", `0 0 ${v.w} ${v.h}`);
    this.fit();
    this.refresh();
  }

  /** Everything that follows the data: markers, panel, route. */
  refresh() {
    if (!this.el) return;
    this.svg.innerHTML = this.svgMarkup();
    this.renderPanel();
    this.renderRoute();
  }

  refreshClock() {
    const el = this.el?.querySelector(".ncm-hub-clock");
    if (!el) return;
    const rush = rushHour(hourNow());
    el.innerHTML = `<i class="fa-regular fa-clock"></i> ${esc(CombatTime.clock())}${rush ? ` <span class="ncm-hub-rush">${esc(L(`${LANG}.Hub.RushHour`))}</span>` : ""}`;
  }

  /* ---------------------------------------- */
  /*  Pan and zoom                            */
  /* ---------------------------------------- */

  fit() {
    const v = VIEWS[this.view];
    const r = this.stage.getBoundingClientRect();
    const s = Math.min(r.width / v.w, r.height / v.h) || 0.4;
    this.min = s * 0.8;
    this.t = { s, x: (r.width - v.w * s) / 2, y: (r.height - v.h * s) / 2 };
    this.apply();
  }

  apply() {
    const { x, y, s } = this.t;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    this.world.style.setProperty("--inv", String(1 / s));
    this.el.classList.toggle("is-close", s > 1.1);
  }

  zoomAt(px, py, factor) {
    const s = Math.min(6, Math.max(this.min ?? 0.2, this.t.s * factor));
    const k = s / this.t.s;
    this.t = { s, x: px - (px - this.t.x) * k, y: py - (py - this.t.y) * k };
    this.apply();
  }

  /** Centre a world point at a zoom. */
  focus(x, y, s = 1.4) {
    const r = this.stage.getBoundingClientRect();
    const p = this.view === "ncart" ? this._toSchematic(x, y) : { x, y };
    this.t = { s, x: r.width / 2 - p.x * s, y: r.height / 2 - p.y * s };
    this.apply();
  }

  /** Screen point to world (or schematic) coordinates. */
  toWorld(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    return { x: (clientX - r.left - this.t.x) / this.t.s, y: (clientY - r.top - this.t.y) / this.t.s };
  }

  /** The NCART poster has its own layout: the nearest station's spot stands in for a city point. */
  _toSchematic(x, y) {
    const [near] = nearestStations({ x, y }, { count: 1, open: false });
    return near ? { x: near.station.sx, y: near.station.sy } : { x: 0, y: 0 };
  }

  _wire() {
    const stage = this.stage;
    let drag = null;
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 && ev.button !== 2) return;
      // What was pressed is what a click hits: once the pointer is captured for a drag, events
      // land on the stage instead.
      drag = { x: ev.clientX, y: ev.clientY, tx: this.t.x, ty: this.t.y, moved: false, target: ev.target, id: ev.pointerId };
    });
    stage.addEventListener("pointermove", (ev) => {
      if (!drag) return this._hover(ev);
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) {
        try {
          stage.setPointerCapture(drag.id);
        } catch {
          /* the pointer is gone */
        }
      }
      drag.moved = true;
      this.el.classList.add("is-dragging");
      this.t.x = drag.tx + dx;
      this.t.y = drag.ty + dy;
      this.apply();
    });
    stage.addEventListener("pointerup", (ev) => {
      const was = drag;
      drag = null;
      this.el?.classList.remove("is-dragging");
      if (was && !was.moved && ev.button === 0) this._click(ev, was.target);
    });
    stage.addEventListener("contextmenu", (ev) => ev.preventDefault());
    stage.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = stage.getBoundingClientRect();
      this.zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });
    stage.addEventListener("dblclick", (ev) => {
      const r = stage.getBoundingClientRect();
      this.zoomAt(ev.clientX - r.left, ev.clientY - r.top, 1.8);
    });

    this.el.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-hub]");
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      this._action(btn.dataset.hub, btn, ev).catch((err) => ui.notifications.warn(err.message));
    });
    this.el.addEventListener("change", (ev) => this._change(ev));
    this.el.addEventListener("input", (ev) => {
      if (ev.target.name !== "hubSearch") return;
      this.query = ev.target.value;
      this.renderPanel();
    });
    this._onKey = (ev) => {
      if (ev.key === "Escape" && this.el && !ev.target.closest?.("input, textarea, select")) {
        ev.stopPropagation();
        if (this.sel) this.select(null);
        else this.close();
      }
    };
    window.addEventListener("keydown", this._onKey, true);
  }

  _hover(ev) {
    if (this.view === "ncart") return;
    const hit = ev.target.closest?.("[data-sel]");
    const tip = this.el.querySelector(".ncm-hub-tip");
    if (!hit) {
      const w = this.toWorld(ev.clientX, ev.clientY);
      const d = districtAt(w.x, w.y);
      tip.textContent = d.code ? `${d.code} · ${d.name}` : d.name;
    } else tip.textContent = hit.dataset.tip ?? "";
  }

  _click(ev, target = ev.target) {
    const hit = target.closest?.("[data-sel]");
    if (hit) return this.select(hit.dataset.sel);
    if (this.view === "ncart") {
      // The poster: the nearest station within reach of the click.
      const w = this.toWorld(ev.clientX, ev.clientY);
      const near = Object.entries(NC2070.stations).map(([id, s]) => ({ id, d: Math.hypot(s.sx - w.x, s.sy - w.y) })).sort((a, b) => a.d - b.d)[0];
      return this.select(near && near.d < 40 ? `s:${near.id}` : null);
    }
    const w = this.toWorld(ev.clientX, ev.clientY);
    if (w.x < 0 || w.y < 0 || w.x > VIEWS[this.view].w || w.y > VIEWS[this.view].h) return this.select(null);
    const d = districtAt(w.x, w.y);
    this._clicked = spot(w.x, w.y, d.name);
    return this.select(d.code ? `d:${d.code}` : `o:${d.name}`);
  }

  /* ---------------------------------------- */
  /*  Selection                               */
  /* ---------------------------------------- */

  /** Select "p:<placeKey>", "d:<code>", "o:<outside name>", "s:<station>", "pin:<actorId>", "crew". */
  select(key) {
    this.sel = key;
    for (const n of this.svg.querySelectorAll(".is-sel")) n.classList.remove("is-sel");
    if (key) for (const n of this.svg.querySelectorAll(`[data-sel="${CSS.escape(key)}"]`)) n.classList.add("is-sel");
    this.renderPanel();
  }

  /** The selected thing as a map spot, for routes and pins. */
  selSpot() {
    const k = this.sel ?? "";
    if (k.startsWith("p:")) {
      const p = Hub.place(k.slice(2));
      return p && spot(p.x, p.y, p.name, { key: k });
    }
    if (k.startsWith("s:")) {
      const s = NC2070.stations[k.slice(2)];
      return s && spot(s.x, s.y, L(`${LANG}.Hub.StationName`, { name: s.name }), { key: k });
    }
    if (k.startsWith("pin:")) {
      const pin = Hub.state.pins[k.slice(4)];
      const actor = game.actors.get(k.slice(4));
      return pin && spot(pin.x, pin.y, actor?.name ?? "?", { key: k });
    }
    if (k === "crew") {
      const c = Hub.state.crew;
      return c && spot(c.x, c.y, c.label || L(`${LANG}.Hub.Crew`), { key: k });
    }
    if ((k.startsWith("d:") || k.startsWith("o:")) && this._clicked) return { ...this._clicked, key: k };
    if (k.startsWith("d:")) {
      const d = districtByCode(k.slice(2));
      return d && spot(d.label[0], d.label[1], d.name, { key: k });
    }
    return null;
  }

  /* ---------------------------------------- */
  /*  SVG                                     */
  /* ---------------------------------------- */

  svgMarkup() {
    return this.view === "ncart" ? this._svgNcart() : this._svgCity();
  }

  _svgCity() {
    const out = [];
    const sel = this.sel;
    // Districts: invisible hit areas that light up on hover, and outline the selected one.
    out.push(`<g class="ncm-hub-districts">${NC2070.districts.map((d) => {
      const t = NC2070.threat[d.rating]?.color ?? "#fff";
      return `<polygon class="ncm-hub-district${sel === `d:${d.code}` ? " is-sel" : ""}" data-sel="d:${d.code}" data-tip="${esc(`${d.code} · ${d.name} · ${NC2070.threat[d.rating]?.label ?? ""}`)}" style="--t:${t}" points="${d.poly.map((p) => p.join(",")).join(" ")}"/>`;
    }).join("")}</g>`);
    // NCART over the city.
    if (this.layers.ncart) {
      const lines = [];
      for (const [lid, line] of Object.entries(NC2070.lines)) {
        for (const run of RUNS) {
          for (const seg of line[run] ?? []) {
            const pts = seg.map((sid) => NC2070.stations[sid]).filter(Boolean).map((s) => `${s.x},${s.y}`).join(" ");
            lines.push(`<polyline class="ncm-hub-line run-${run}" data-line="${lid}" style="--c:${line.color}" points="${pts}"/>`);
          }
        }
      }
      const dots = Object.entries(NC2070.stations).map(([id, s]) => `<g class="ncm-m ncm-hub-st${s.status ? ` is-${s.status}` : ""}${sel === `s:${id}` ? " is-sel" : ""}" transform="translate(${s.x} ${s.y})" data-sel="s:${id}" data-tip="${esc(L(`${LANG}.Hub.StationName`, { name: s.name }))}"><g class="ncm-mi"><circle r="4.2"/></g></g>`).join("");
      out.push(`<g class="ncm-hub-ncart">${lines.join("")}${dots}</g>`);
    }
    // Notable Places.
    if (this.layers.places) {
      out.push(`<g class="ncm-hub-places">${NC2070.places.filter((p) => this.cats.has(p.cat)).map((p) => {
        const key = `p:${Hub.placeKey(p)}`;
        const c = NC2070.cats[p.cat]?.color ?? "#fff";
        const mark = p.badge
          ? `<path d="M0 -9 L8 0 L0 9 L-8 0 Z"/><text y="3.2">${p.badge === "ncu" ? "U" : "+"}</text>`
          : `<circle r="7.5"/><text y="3">${p.n}</text>`;
        return `<g class="ncm-m ncm-hub-place${sel === key ? " is-sel" : ""}${Hub.state.notes[Hub.placeKey(p)] && game.user.isGM ? " has-note" : ""}" transform="translate(${p.x} ${p.y})" style="--c:${c}" data-sel="${key}" data-tip="${esc(p.name)}"><g class="ncm-mi">${mark}<text class="ncm-hub-label" x="11" y="3.5">${esc(p.name)}</text></g></g>`;
      }).join("")}</g>`);
    }
    out.push(this._svgRoute());
    if (this.layers.people) out.push(this._svgPeople());
    return out.join("");
  }

  _svgPeople() {
    const { crew, pins } = Hub.state;
    const out = [];
    for (const [actorId, pin] of Object.entries(pins)) {
      const actor = game.actors.get(actorId);
      if (!actor || (!game.user.isGM && !actor.hasPlayerOwner && !actor.isOwner)) continue;
      const dead = Hub.noSignal(actor);
      out.push(`<g class="ncm-m ncm-hub-pin${dead ? " no-signal" : ""}${this.sel === `pin:${actorId}` ? " is-sel" : ""}" transform="translate(${pin.x} ${pin.y})" data-sel="pin:${actorId}" data-tip="${esc(actor.name)}"><g class="ncm-mi">
        <clipPath id="ncm-pin-${actorId}"><circle r="11" cy="-20"/></clipPath>
        <path class="ncm-hub-pin-stem" d="M0 0 L-6 -10 A12 12 0 1 1 6 -10 Z"/>
        <image href="${esc(actor.img)}" x="-11" y="-31" width="22" height="22" clip-path="url(#ncm-pin-${actorId})" preserveAspectRatio="xMidYMin slice"/>
        <text class="ncm-hub-label" x="15" y="-16">${esc(actor.name)}</text></g></g>`);
    }
    if (crew) {
      out.push(`<g class="ncm-m ncm-hub-crew${this.sel === "crew" ? " is-sel" : ""}" transform="translate(${crew.x} ${crew.y})" data-sel="crew" data-tip="${esc(crew.label || L(`${LANG}.Hub.Crew`))}"><g class="ncm-mi">
        <circle class="ncm-hub-crew-pulse" r="16"/><path d="M0 -13 L11.3 -6.5 L11.3 6.5 L0 13 L-11.3 6.5 L-11.3 -6.5 Z"/><text y="4">◆</text>
        <text class="ncm-hub-label" x="17" y="4">${esc(L(`${LANG}.Hub.WeAreHere`))}</text></g></g>`);
    }
    return `<g class="ncm-hub-people">${out.join("")}</g>`;
  }

  _svgRoute() {
    const { a, b } = this.route;
    const out = [];
    const end = (p, tag) => p && `<g class="ncm-m ncm-hub-end" transform="translate(${p.x} ${p.y})"><g class="ncm-mi"><circle r="9"/><text y="3.5">${tag}</text></g></g>`;
    if (a && b) {
      const trip = this._trip();
      out.push(`<line class="ncm-hub-route-line${trip?.danger.length ? " is-danger" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
      if (trip?.ncart) {
        for (const leg of trip.ncart.ride.legs) {
          const pts = leg.stations.map((sid) => NC2070.stations[sid]).map((s) => `${s.x},${s.y}`).join(" ");
          out.push(`<polyline class="ncm-hub-ride" style="--c:${NC2070.lines[leg.line]?.color}" points="${pts}"/>`);
        }
      }
    }
    out.push(end(a, "A") ?? "", end(b, "B") ?? "");
    return `<g class="ncm-hub-route">${out.join("")}</g>`;
  }

  _svgNcart() {
    const out = [];
    const trip = this.route.a && this.route.b ? this._trip() : null;
    if (trip?.ncart) {
      for (const leg of trip.ncart.ride.legs) {
        const pts = leg.stations.map((sid) => NC2070.stations[sid]).map((s) => `${s.sx},${s.sy}`).join(" ");
        out.push(`<polyline class="ncm-hub-ride" style="--c:${NC2070.lines[leg.line]?.color}" points="${pts}"/>`);
      }
    }
    for (const [id, s] of Object.entries(NC2070.stations)) {
      if (s.sx === null) continue;
      const tag = trip?.ncart?.board === id ? "A" : trip?.ncart?.alight === id ? "B" : "";
      out.push(`<g class="ncm-m ncm-hub-st-hit${this.sel === `s:${id}` ? " is-sel" : ""}${tag ? " is-end" : ""}" transform="translate(${s.sx} ${s.sy})" data-sel="s:${id}" data-tip="${esc(s.name)}"><g class="ncm-mi"><circle r="14"/>${tag ? `<text y="4">${tag}</text>` : ""}</g></g>`);
    }
    return out.join("");
  }

  /* ---------------------------------------- */
  /*  Panel                                   */
  /* ---------------------------------------- */

  async renderPanel() {
    const box = this.el?.querySelector(".ncm-hub-panel");
    if (!box) return;
    const ctx = this.panelContext();
    box.innerHTML = await Compat.renderTemplate(`${TEMPLATE_PATH}/hub-panel.hbs`, ctx);
  }

  /** Threat rating chips for a district or area. */
  _chips(d) {
    return [d.rating, d.second].filter(Boolean).map((r) => ({ label: NC2070.threat[r]?.label ?? r, color: NC2070.threat[r]?.color ?? "#999", danger: DANGER.includes(r) }));
  }

  _stationsNear(p) {
    return nearestStations(p, { count: 2 }).map((n) => ({
      id: n.id, name: n.station.name, walk: formatMinutes(Hub.walkMinutes(p, n.station)),
      lines: this._linesAt(n.id)
    }));
  }

  _linesAt(sid) {
    return Object.entries(NC2070.lines).filter(([, l]) => RUNS.some((r) => (l[r] ?? []).some((seg) => seg.includes(sid))))
      .map(([id, l]) => ({ id, name: l.name, color: l.color }));
  }

  _placeRow(p) {
    return { key: `p:${Hub.placeKey(p)}`, n: p.n ?? "◆", name: p.name, color: NC2070.cats[p.cat]?.color, cat: NC2070.cats[p.cat]?.label };
  }

  /** The buttons every selection shares: route from / to, put the crew or a character here, show the players. */
  _actionsHtml() {
    const s = this.selSpot();
    if (!s) return "";
    const b = (hub, icon, label, extra = "") => `<button type="button" data-hub="${hub}"${extra}><i class="fa-solid ${icon}"></i> ${esc(label)}</button>`;
    const out = [
      b("routeFrom", "fa-a", L(`${LANG}.Hub.RouteFrom`)),
      b("routeTo", "fa-b", L(`${LANG}.Hub.RouteTo`))
    ];
    const pinnable = this.view !== "ncart" || this.sel?.startsWith("s:");
    const actors = this._myActors();
    if (pinnable && actors.length && !this.sel?.startsWith("pin:")) {
      const select = actors.length > 1
        ? `<select name="pinActor">${actors.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>`
        : "";
      out.push(`<span class="ncm-hub-pinrow">${select}${b("pinHere", "fa-location-dot", L(`${LANG}.Hub.PinHere`), actors.length === 1 ? ` data-actor="${actors[0].id}"` : "")}</span>`);
    }
    if (game.user.isGM) {
      if (pinnable && this.sel !== "crew") out.push(b("crewHere", "fa-diamond", L(`${LANG}.Hub.CrewHere`)));
      out.push(b("showPlayers", "fa-display", L(`${LANG}.Hub.ShowPlayers`)));
    }
    return `<div class="ncm-hub-btns">${out.join("")}</div>`;
  }

  panelContext() {
    const gm = game.user.isGM;
    const base = { gm, sel: this.sel, actions: this._actionsHtml() };
    const k = this.sel ?? "";
    const q = this.query.trim().toLowerCase();
    if (q) {
      const places = NC2070.places.filter((p) => p.name.toLowerCase().includes(q)).map((p) => this._placeRow(p));
      const districts = NC2070.districts.filter((d) => d.name.toLowerCase().includes(q)).map((d) => ({ key: `d:${d.code}`, code: d.code, name: d.name }));
      const stations = Object.entries(NC2070.stations).filter(([, s]) => s.name.toLowerCase().includes(q)).map(([id, s]) => ({ key: `s:${id}`, name: s.name }));
      return { ...base, kind: "search", places, districts, stations, empty: !places.length && !districts.length && !stations.length };
    }
    if (k.startsWith("p:")) return { ...base, kind: "place", ...this._placeContext(k.slice(2)) };
    if (k.startsWith("d:") || k.startsWith("o:")) return { ...base, kind: "district", ...this._districtContext(k) };
    if (k.startsWith("s:")) return { ...base, kind: "station", ...this._stationContext(k.slice(2)) };
    if (k.startsWith("pin:")) return { ...base, kind: "pin", ...this._pinContext(k.slice(4)) };
    if (k === "crew") {
      const c = Hub.state.crew;
      const d = c ? districtAt(c.x, c.y) : null;
      return { ...base, kind: "crew", label: c?.label, district: d?.name, chips: d ? this._chips(d) : [] };
    }
    return { ...base, kind: "home", ...this._homeContext() };
  }

  _placeContext(key) {
    const p = Hub.place(key);
    if (!p) return {};
    const d = p.district ? districtByCode(p.district) : districtAt(p.x, p.y);
    const note = Hub.state.notes[key] ?? {};
    return {
      key, n: p.n, name: p.name, badge: !!p.badge, cat: NC2070.cats[p.cat]?.label, color: NC2070.cats[p.cat]?.color,
      text: p.text, sc: p.sc, guard: p.guard, district: d?.name, districtKey: d?.code ? `d:${d.code}` : null, chips: d ? this._chips(d) : [],
      stations: this._stationsNear(p),
      note: note.note ?? "", scene: note.scene ?? "", sceneName: game.scenes?.get(note.scene)?.name ?? "",
      scenes: gm() ? [{ id: "", name: "—" }, ...(game.scenes?.contents ?? []).map((s) => ({ id: s.id, name: s.name, selected: s.id === note.scene }))] : [],
      pinActors: this._myActors().map((a) => ({ id: a.id, name: a.name })),
      signal: !deadAt(p.x, p.y, { extra: Settings.list("hubDeadZones") })
    };
  }

  _districtContext(k) {
    const d = k.startsWith("d:") ? districtByCode(k.slice(2)) : NC2070.outside.find((o) => o.name === k.slice(2));
    if (!d) return {};
    const places = d.code ? NC2070.places.filter((p) => p.district === d.code).map((p) => this._placeRow(p)) : [];
    const at = this._clicked ?? (d.label ? { x: d.label[0], y: d.label[1] } : null);
    return {
      code: d.code, name: d.name, boro: d.boro, zone: d.zone, chips: this._chips(d), ratingText: NC2070.threat[d.rating]?.text,
      sc: d.sc, provider: d.provider, intensity: d.intensity, uc: d.uc ?? "—", was: d.was, dossier: d.dossier, note: d.note,
      ncart: d.ncart, turf: d.turf, places,
      signal: at ? !deadAt(at.x, at.y, { extra: Settings.list("hubDeadZones") }) : true
    };
  }

  _stationContext(id) {
    const s = NC2070.stations[id];
    if (!s) return {};
    const d = districtAt(s.x, s.y);
    const places = NC2070.places.filter((p) => km(p, s) < 0.9).map((p) => this._placeRow(p));
    return { id, name: s.name, status: s.status, statusText: s.status ? L(`${LANG}.Hub.Status.${s.status}`) : "", lines: this._linesAt(id), district: d.name, districtKey: d.code ? `d:${d.code}` : null, chips: this._chips(d), places };
  }

  _pinContext(actorId) {
    const actor = game.actors.get(actorId);
    const pin = Hub.state.pins[actorId];
    if (!actor || !pin) return {};
    const d = districtAt(pin.x, pin.y);
    return {
      actorId, name: actor.name, img: actor.img, district: d.name, districtKey: d.code ? `d:${d.code}` : null, chips: this._chips(d),
      // Ring them, unless they're yours (you'd be calling yourself) or out of signal.
      noSignal: Hub.noSignal(actor), mine: actor.isOwner, canCall: !Hub.noSignal(actor) && (game.user.isGM || !actor.isOwner)
    };
  }

  _homeContext() {
    const order = NC2070.threatOrder;
    const groups = order.map((r) => ({
      label: NC2070.threat[r].label, color: NC2070.threat[r].color, text: NC2070.threat[r].text,
      districts: NC2070.districts.filter((d) => d.rating === r).map((d) => ({ key: `d:${d.code}`, code: d.code, name: d.name }))
    })).filter((g) => g.districts.length);
    const crew = Hub.state.crew;
    return {
      groups,
      crew: crew ? { label: crew.label, district: districtAt(crew.x, crew.y).name } : null,
      mine: this._myActors().map((a) => ({ id: a.id, name: a.name, img: a.img, where: Hub.whereIs(a) || L(`${LANG}.Hub.Unpinned`), pinned: !!Hub.pinOf(a) })),
      lines: Object.entries(NC2070.lines).map(([id, l]) => ({ id, name: l.name, color: l.color, summary: l.summary, state: l.segs.length ? "" : l.planned.length ? L(`${LANG}.Hub.Status.planned`) : L(`${LANG}.Hub.Status.suspended`) }))
    };
  }

  /** Characters this user can pin: their own (the GM: the crew). */
  _myActors() {
    if (game.user.isGM) return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    return game.actors.filter((a) => a.type === "character" && a.isOwner);
  }

  /* ---------------------------------------- */
  /*  Route                                   */
  /* ---------------------------------------- */

  _trip() {
    const { a, b } = this.route;
    if (!a || !b) return null;
    return plan(a, b, { hour: hourNow(), storm: this.storm });
  }

  async renderRoute() {
    const box = this.el?.querySelector(".ncm-hub-routebar");
    if (!box) return;
    const trip = this._trip();
    if (!this.route.a && !this.route.b) {
      box.innerHTML = "";
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const modes = ["walk", "skates", "bike", "ncart", "moto", "car", "av"];
    const ctx = {
      gm: game.user.isGM,
      a: this.route.a?.name, b: this.route.b?.name, ready: !!trip,
      km: trip?.km, rush: trip?.rush, storm: this.storm,
      modes: trip ? modes.map((m) => ({ id: m, label: L(`${LANG}.Hub.Mode.${m}`), time: trip.times[m] ? formatMinutes(trip.times[m]) : "—", none: !trip.times[m], on: m === this.mode })) : [],
      ncart: trip?.ncart ? {
        legs: trip.ncart.ride.legs.map((l) => ({ name: NC2070.lines[l.line]?.name, color: NC2070.lines[l.line]?.color, from: NC2070.stations[l.from]?.name, to: NC2070.stations[l.to]?.name, stops: l.stations.length - 1 })),
        walkIn: trip.ncart.walkIn, walkOut: trip.ncart.walkOut
      } : null,
      danger: trip?.danger.map((d) => ({ name: d.name, color: NC2070.threat[d.rating]?.color, label: NC2070.threat[DANGER.includes(d.rating) ? d.rating : d.second]?.label })) ?? [],
      through: trip?.along.filter((d) => d.code).map((d) => d.name).join(" · ")
    };
    box.innerHTML = await Compat.renderTemplate(`${TEMPLATE_PATH}/hub-route.hbs`, ctx);
  }

  /* ---------------------------------------- */
  /*  Actions                                 */
  /* ---------------------------------------- */

  async _action(action, btn, ev) {
    const d = btn.dataset;
    switch (action) {
      case "close": return this.close();
      case "view": return this.setView(d.hubView);
      case "fit": return this.fit();
      case "zoomIn":
      case "zoomOut": {
        const r = this.stage.getBoundingClientRect();
        return this.zoomAt(r.width / 2, r.height / 2, action === "zoomIn" ? 1.4 : 1 / 1.4);
      }
      case "layer":
        this.layers[d.layer] = !this.layers[d.layer];
        btn.classList.toggle("on", this.layers[d.layer]);
        return this.refresh();
      case "cat":
        if (this.cats.has(d.cat)) this.cats.delete(d.cat);
        else this.cats.add(d.cat);
        btn.classList.toggle("on", this.cats.has(d.cat));
        return this.refresh();
      case "select": {
        this.query = "";
        const search = this.el.querySelector("[name=hubSearch]");
        if (search) search.value = "";
        this._clicked = null;
        this.select(d.key);
        const s = this.selSpot();
        if (s && this.view !== "ncart") this.focus(s.x, s.y, Math.max(this.t.s, 1.2));
        return null;
      }
      case "home":
        return this.select(null);
      case "routeFrom":
      case "routeTo": {
        const s = this.selSpot();
        if (!s) return null;
        this.route[action === "routeFrom" ? "a" : "b"] = s;
        return this.refresh();
      }
      case "routeSwap":
        this.route = { a: this.route.b, b: this.route.a };
        return this.refresh();
      case "routeClear":
        this.route = { a: null, b: null };
        return this.refresh();
      case "mode":
        this.mode = d.mode;
        return this.renderRoute();
      case "storm":
        this.storm = !this.storm;
        return this.refresh();
      case "travel": {
        const { a, b } = this.route;
        const { minutes } = await Hub.travel(a, b, this.mode, { storm: this.storm });
        ui.notifications.info(L(`${LANG}.Hub.TravelDone`, { time: formatMinutes(minutes) }));
        this.route = { a: b, b: null };
        return this.refresh();
      }
      case "crewHere": {
        const s = this.selSpot();
        if (s) await Hub.setCrew(s, s.name);
        return null;
      }
      case "crewClear":
        return Hub.setCrew(null);
      case "pinHere": {
        const s = this.selSpot();
        const id = d.actor ?? this.el.querySelector("[name=pinActor]")?.value;
        if (s && id) await Hub.setPin(id, s);
        return null;
      }
      case "unpin":
        await Hub.setPin(d.actor, null);
        return this.select(null);
      case "call": {
        const { HolocallApp } = await import("../comms/holocall-app.js");
        return HolocallApp.dial({ targets: [`actor:${d.actor}`] });
      }
      case "showPlayers": {
        const s = this.selSpot();
        return Hub.show({ view: this.view, key: this.sel, x: s?.x, y: s?.y, s: this.t.s });
      }
      case "viewScene":
        return game.scenes.get(d.scene)?.view();
      case "activateScene":
        return game.scenes.get(d.scene)?.activate();
      default:
        return null;
    }
  }

  async _change(ev) {
    const t = ev.target;
    if (t.name === "placeNote" && game.user.isGM) return Hub.setNote(t.dataset.key, { note: t.value });
    if (t.name === "placeScene" && game.user.isGM) return Hub.setNote(t.dataset.key, { scene: t.value });
    return null;
  }
}

const gm = () => game.user.isGM;
