import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { inShapes, boundsOf, linksFrom, linkBetween, seesAcross, cleanLink } from "./far-data.js";
import { Cloak } from "./cloak.js";
import { debounce, L, esc } from "../util.js";

/**
 * Linked areas at the table (see far-data.js for the idea).
 *
 * - The links live on the scene (flag `farLinks`); the GM makes them from the binoculars button
 *   in the token controls, between Regions drawn on the scene.
 * - Seeing across: this client, for the token it looks through. If that token stands in a
 *   linked area and sees far enough (a scope up that reaches the linked distance, or eyes that
 *   do), the far area is shown: a point of view is put in its middle for as long as that holds,
 *   and everyone in it shows as an outline that can be targeted, the way a Tech scope's do.
 * - Distance: an attack between linked areas is at the linked distance (scripts/arsenal/dv.js).
 * - The Action HUD gets a "Look across" entry for each link out of where the character stands,
 *   which moves the view to the far area and back.
 */
export const LINKS_FLAG = "farLinks";
const SOURCE_ID = `${MODULE_ID}.far`;

export const Far = {
  _source: null,
  _showing: null,
  _back: null,

  get on() {
    return !!Settings.get("farLinks");
  },

  init() {
    const soon = debounce(() => this.refresh(), 120);
    for (const h of ["canvasReady", "controlToken", "updateToken", "updateScene", "updateRegion", "deleteRegion", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    Hooks.on("canvasTearDown", () => this.drop());
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-far", title: `${LANG}.Far.Tool`, icon: "fa-solid fa-binoculars", order: 114, visible: !!game.user?.isGM, onClick: () => this.open() }
    ]));
  },

  links(scene = canvas?.scene) {
    const list = scene?.flags?.[MODULE_ID]?.[LINKS_FLAG];
    return (Array.isArray(list) ? list : []).map(cleanLink).filter(Boolean);
  },

  regions(scene = canvas?.scene) {
    return [...(scene?.regions ?? [])];
  },

  region(id, scene = canvas?.scene) {
    return this.regions(scene).find((r) => r.id === id) ?? null;
  },

  /** The ids of the Regions a point is in. */
  at(point, scene = canvas?.scene) {
    if (!point) return [];
    return this.regions(scene).filter((r) => inShapes(r.shapes ?? [], point)).map((r) => r.id);
  },

  where(token) {
    return this.at(token?.center ?? null, token?.document?.parent ?? canvas?.scene);
  },

  /** How far a token sees unaided, and through the scope it has up (what the scope sees, not what the scene allowed). */
  reachOf(token) {
    const doc = token?.document ?? token;
    const s = doc?.flags?.[MODULE_ID]?.scope;
    return { eye: Number(Settings.get("sightBase")) || 50, scope: s ? Number(s.scope?.range) || Number(s.range) || 0 : 0 };
  },

  /** The links out of where a token stands: [{ link, to (Region), name, distance, sees }]. */
  reach(token) {
    if (!this.on || !token) return [];
    const scene = token.document?.parent ?? canvas?.scene;
    const r = this.reachOf(token);
    return linksFrom(this.links(scene), this.where(token)).map((x) => {
      const to = this.region(x.to, scene);
      return to ? { link: x.link, to, name: to.name || L(`${LANG}.Far.Area`), distance: x.link.distance, sees: seesAcross({ distance: x.link.distance, ...r }) } : null;
    }).filter(Boolean);
  },

  /** The linked distance between two tokens (or points), in m/yds, or null when no link joins where they stand. */
  distance(a, b) {
    if (!this.on) return null;
    const pa = a?.center ?? a;
    const pb = b?.center ?? b;
    if (!pa || !pb) return null;
    const scene = a?.document?.parent ?? canvas?.scene;
    const links = this.links(scene);
    if (!links.length) return null;
    return linkBetween(links, this.at(pa, scene), this.at(pb, scene))?.link.distance ?? null;
  },

  /** The token this client looks through. */
  viewer() {
    if (!this.on || !canvas?.ready) return null;
    const controlled = canvas.tokens?.controlled ?? [];
    let token = controlled.length === 1 ? controlled[0] : null;
    if (!token && !controlled.length && !game.user?.isGM) token = game.user?.character?.getActiveTokens?.()[0] ?? null;
    return token && (token.isOwner || game.user?.isGM) ? token : null;
  },

  /** Everyone in a far area the viewer sees into, for outlines: [{ token, color, look: "far" }]. */
  sensed() {
    const v = this.viewer();
    if (!v) return [];
    const far = this.reach(v).filter((x) => x.sees);
    if (!far.length) return [];
    const out = [];
    for (const t of canvas.tokens?.placeables ?? []) {
      if (t === v || !t.actor || t.document?.hidden || t.visible) continue;
      if (Cloak.hides(t, v) || Cloak.unseen(t)) continue;
      if (far.some((x) => inShapes(x.to.shapes ?? [], t.center))) out.push({ token: t, color: 0xffffff, look: "far" });
    }
    return out;
  },

  /* ---------------------------------------- */
  /*  A point of view in the far area         */
  /* ---------------------------------------- */

  drop() {
    const s = this._source;
    this._source = null;
    this._showing = null;
    if (!s) return;
    try {
      (s.remove ?? s.destroy)?.call(s);
      canvas?.effects?.visionSources?.delete?.(SOURCE_ID);
      canvas?.perception?.update?.({ refreshVision: true, refreshLighting: true });
    } catch {
      /* gone with the canvas */
    }
  },

  /** Keep the far area shown while the viewer sees into it, and take it away when they don't. */
  refresh() {
    const v = this.viewer();
    const far = v ? this.reach(v).filter((x) => x.sees) : [];
    const key = far.map((x) => x.link.id).join("|") + (v ? `@${v.id}` : "");
    if (key === this._showing) return far.length;
    this.drop();
    if (!far.length) return 0;
    this._showing = key;
    // One point of view, in the middle of the (first) far area, wide enough to take it all in.
    const box = boundsOf(far[0].to.shapes ?? []);
    const Cls = foundry?.canvas?.sources?.PointVisionSource ?? CONFIG?.Canvas?.visionSourceClass;
    if (!box || !Cls) return far.length;
    try {
      const src = new Cls({ sourceId: SOURCE_ID, object: v });
      src.initialize({ x: box.cx, y: box.cy, elevation: v.document?.elevation ?? 0, radius: box.r, externalRadius: 0, angle: 360, rotation: 0, visionMode: "basic", blinded: false, disabled: false });
      if (typeof src.add === "function") src.add();
      else canvas.effects?.visionSources?.set?.(SOURCE_ID, src);
      this._source = src;
      canvas.perception?.update?.({ refreshVision: true, refreshLighting: true });
    } catch (err) {
      // The outlines still show who's there; the map of the far area stays as the scene has it.
      console.warn(`${MODULE_ID} | linked areas: no point of view in the far area`, err);
      this._source = null;
    }
    return far.length;
  },

  /* ---------------------------------------- */
  /*  The Action HUD                          */
  /* ---------------------------------------- */

  entries(actor, token) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    if (!this.on || !tok?.center) return [];
    const unit = canvas?.scene?.grid?.units || "m";
    return this.reach(tok).map((x) => ({
      key: `far:${x.link.id}`,
      label: L(`${LANG}.Far.Look`, { area: x.name }),
      sub: x.sees ? `${x.distance} ${unit}` : L(`${LANG}.Far.Needs`, { distance: x.distance, unit }),
      icon: "fa-solid fa-binoculars",
      off: !x.sees,
      on: this._back?.link === x.link.id
    }));
  },

  /** Move this client's view to the far area of a link, or back to where it was. */
  async look(actor, linkId, { token = null } = {}) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    if (this._back?.link === linkId) {
      const b = this._back;
      this._back = null;
      await canvas.animatePan?.({ x: b.x, y: b.y, scale: b.scale, duration: 400 });
      Hooks.callAll(`${MODULE_ID}.refreshUI`);
      return false;
    }
    const x = this.reach(tok).find((r) => r.link.id === linkId);
    if (!x) return null;
    if (!x.sees) {
      ui.notifications?.info(L(`${LANG}.Far.TooFar`, { area: x.name, distance: x.distance, unit: canvas?.scene?.grid?.units || "m" }));
      return null;
    }
    const box = boundsOf(x.to.shapes ?? []);
    if (!box) return null;
    const piv = canvas.stage?.pivot ?? { x: 0, y: 0 };
    this._back = { link: linkId, x: piv.x, y: piv.y, scale: canvas.stage?.scale?.x ?? 1 };
    await canvas.animatePan?.({ x: box.cx, y: box.cy, duration: 400 });
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return true;
  },

  /* ---------------------------------------- */
  /*  The GM's links                          */
  /* ---------------------------------------- */

  async save(links, scene = canvas?.scene) {
    if (!game.user?.isGM || !scene) return [];
    const clean = links.map(cleanLink).filter(Boolean);
    await scene.setFlag(MODULE_ID, LINKS_FLAG, clean);
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return clean;
  },

  /** Link two Regions with the distance between them. */
  async add({ a, b, distance, both = true } = {}, scene = canvas?.scene) {
    const link = cleanLink({ id: foundry?.utils?.randomID?.() ?? `${Date.now()}`, a, b, distance, both });
    if (!link) return null;
    await this.save([...this.links(scene).filter((l) => !(l.a === link.a && l.b === link.b)), link], scene);
    return link;
  },

  async remove(id, scene = canvas?.scene) {
    return this.save(this.links(scene).filter((l) => l.id !== id), scene);
  },

  /** The GM's window: the scene's links, and a new one. */
  async open() {
    if (!game.user?.isGM || !canvas?.scene) return null;
    const regions = this.regions();
    if (regions.length < 2) {
      ui.notifications?.warn(L(`${LANG}.Far.NeedRegions`));
      return null;
    }
    const name = (id) => esc(this.region(id)?.name || L(`${LANG}.Far.Area`));
    const unit = canvas.scene.grid?.units || "m";
    const rows = this.links().map((l) => `<label class="ncm-check"><input type="checkbox" name="del-${esc(l.id)}"> ${name(l.a)} ${l.both ? "⇄" : "→"} ${name(l.b)} · ${l.distance} ${esc(unit)}</label>`).join("");
    const pick = (field) => `<select name="${field}">${regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name || r.id)}</option>`).join("")}</select>`;
    const content = `<div class="ncm-grid">${rows ? `<p class="ncm-ref">${L(`${LANG}.Far.Existing`)}</p>${rows}` : ""}`
      + `<p class="ncm-ref">${L(`${LANG}.Far.New`)}</p>`
      + `<label>${L(`${LANG}.Far.From`)}${pick("a")}</label><label>${L(`${LANG}.Far.To`)}${pick("b")}</label>`
      + `<label>${L(`${LANG}.Far.Distance`, { unit: esc(unit) })}<input type="number" name="distance" min="1" step="1" placeholder="300"></label>`
      + `<label class="ncm-check"><input type="checkbox" name="both" checked> ${L(`${LANG}.Far.Both`)}</label></div>`;
    const picked = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Far.Tool`) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      ok: {
        label: L(`${LANG}.Far.Save`),
        callback: (event, button) => {
          const f = button.form.elements;
          return { del: this.links().filter((l) => f[`del-${l.id}`]?.checked).map((l) => l.id), a: f.a.value, b: f.b.value, distance: f.distance.value, both: f.both.checked };
        }
      },
      rejectClose: false
    }).catch(() => null);
    if (!picked) return null;
    let links = this.links().filter((l) => !picked.del.includes(l.id));
    const link = cleanLink({ id: foundry?.utils?.randomID?.() ?? `${Date.now()}`, a: picked.a, b: picked.b, distance: picked.distance, both: picked.both });
    if (link) links = [...links.filter((l) => !(l.a === link.a && l.b === link.b)), link];
    else if (picked.distance) ui.notifications?.warn(L(`${LANG}.Far.Bad`));
    return this.save(links);
  }
};
