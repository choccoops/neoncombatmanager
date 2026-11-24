import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { inShapes, boundsOf } from "./far-data.js";
import { cleanFloor, floorIn, stacked, onto, through, apart, openBetween } from "./levels-data.js";
import { L, esc } from "../util.js";

/**
 * Levels at the table (see levels-data.js for the idea): the GM marks Regions as floors, each
 * with a height and the building (stack) it belongs to, from the layers button in the token
 * controls. Distance for a DV then counts the height between two people, and between two floors
 * of one building it's measured across the plan, not across the map.
 *
 * Multilevel Tokens: a clone it puts on another floor stands in for the real token. A shot at a
 * clone is measured to the real one (its flag names it).
 */
export const FLOORS_FLAG = "floors";
export const OPENINGS_FLAG = "openings";
const MLT = "multilevel-tokens";

export const Levels = {
  get on() {
    return !!Settings.get("levels");
  },

  init() {
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-levels", title: `${LANG}.Levels.Tool`, icon: "fa-solid fa-layer-group", order: 115, visible: !!game.user?.isGM, onClick: () => this.open() }
    ]));
  },

  floors(scene = canvas?.scene) {
    const list = scene?.flags?.[MODULE_ID]?.[FLOORS_FLAG];
    return (Array.isArray(list) ? list : []).map(cleanFloor).filter(Boolean);
  },

  /** The real token behind a Multilevel Tokens clone (or the token itself). */
  real(token) {
    const doc = token?.document ?? token;
    const src = doc?.flags?.[MLT]?.stoken;
    if (!src) return token;
    const scene = doc.parent ?? canvas?.scene;
    const real = scene?.tokens?.get?.(src) ?? null;
    return real ? (real.object ?? real) : token;
  },

  centre(thing, scene = canvas?.scene) {
    if (thing?.center) return thing.center;
    const doc = thing?.document ?? thing;
    if (doc && "width" in doc && "x" in doc && doc.parent) {
      const size = scene?.grid?.size ?? canvas?.dimensions?.size ?? 100;
      return { x: doc.x + ((Number(doc.width) || 1) * size) / 2, y: doc.y + ((Number(doc.height) || 1) * size) / 2 };
    }
    return thing && Number.isFinite(thing.x) && Number.isFinite(thing.y) ? { x: thing.x, y: thing.y } : null;
  },

  /** Where something stands: { point, floor, corner (its floor Region's top left), height (floor + its own elevation) }. */
  place(thing, scene = canvas?.scene) {
    const point = this.centre(thing, scene);
    if (!point) return null;
    const regions = [...(scene?.regions ?? [])];
    const here = regions.filter((r) => inShapes(r.shapes ?? [], point)).map((r) => r.id);
    const floor = floorIn(this.floors(scene), here);
    const box = floor ? boundsOf(regions.find((r) => r.id === floor.region)?.shapes ?? []) : null;
    const elevation = Number((thing?.document ?? thing)?.elevation) || 0;
    return { point, floor, corner: box ? { x: box.x, y: box.y } : null, height: (floor?.height ?? 0) + elevation };
  },

  /**
   * The real distance between two tokens (or a token and a point), in m/yds, or null when the map's
   * own distance is already right (same height, same plan).
   */
  distance(a, b) {
    if (!this.on) return null;
    const scene = (a?.document ?? a)?.parent ?? (b?.document ?? b)?.parent ?? canvas?.scene;
    const pa = this.place(this.real(a), scene);
    const pb = this.place(this.real(b), scene);
    if (!pa || !pb) return null;
    const up = pa.height - pb.height;
    const plans = stacked(pa.floor, pb.floor) && pa.corner && pb.corner;
    if (!up && !plans) return null;
    const there = plans ? onto(pb.point, pb.corner, pa.corner) : pb.point;
    return through(Compat.measure(pa.point, there), up);
  },

  /** Are two tokens on different floors of one building, or in two linked areas far apart? What's drawn between them on the map isn't between them. */
  apart(a, b) {
    if (!this.on) return false;
    const scene = (a?.document ?? a)?.parent ?? canvas?.scene;
    return apart(this.place(this.real(a), scene), this.place(this.real(b), scene));
  },

  /** Are floors solid: seen and shot through only at an opening? (The GM can make them glass with the setting.) */
  get solid() {
    return this.on && String(Settings.get("levelsView") || "open") === "open";
  },

  /** The ids of the Regions marked as openings. */
  openingIds(scene = canvas?.scene) {
    const list = scene?.flags?.[MODULE_ID]?.[OPENINGS_FLAG];
    return Array.isArray(list) ? list.map(String) : [];
  },

  /** The scene's openings, each with the building it's in: [{ id, stack, shapes, corner }]. */
  openings(scene = canvas?.scene) {
    const regions = [...(scene?.regions ?? [])];
    const floors = this.floors(scene);
    const out = [];
    for (const id of this.openingIds(scene)) {
      const r = regions.find((x) => x.id === id);
      const box = r ? boundsOf(r.shapes ?? []) : null;
      if (!box) continue;
      // The floor it's drawn on: the one its middle lies in.
      const mid = { x: box.cx, y: box.cy };
      const floor = floorIn(floors, regions.filter((x) => x.id !== id && inShapes(x.shapes ?? [], mid)).map((x) => x.id));
      const fbox = floor ? boundsOf(regions.find((x) => x.id === floor.region)?.shapes ?? []) : null;
      if (floor?.stack && fbox) out.push({ id, stack: floor.stack, shapes: r.shapes ?? [], corner: { x: fbox.x, y: fbox.y } });
    }
    return out;
  },

  /** Do two places on different floors of a building have a line between them (both in one opening)? */
  openFor(pa, pb, scene = canvas?.scene) {
    return openBetween(this.openings(scene), pa, pb, inShapes);
  },

  /** Is there a solid floor between two tokens (different floors of one building, no opening both stand in)? */
  floorBetween(a, b) {
    if (!this.solid) return false;
    const scene = (a?.document ?? a)?.parent ?? canvas?.scene;
    const pa = this.place(this.real(a), scene);
    const pb = this.place(this.real(b), scene);
    return apart(pa, pb) && !this.openFor(pa, pb, scene);
  },

  async saveOpenings(ids, scene = canvas?.scene) {
    if (!game.user?.isGM || !scene) return [];
    const clean = [...new Set(ids.map(String))].filter((id) => [...(scene.regions ?? [])].some((r) => r.id === id));
    await scene.setFlag(MODULE_ID, OPENINGS_FLAG, clean);
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return clean;
  },

  /** GM: mark a Region as an opening between floors, or (on: false) take the mark off. */
  async opening(region, on = true, scene = canvas?.scene) {
    const id = String(region?.id ?? region);
    const rest = this.openingIds(scene).filter((x) => x !== id);
    return this.saveOpenings(on ? [...rest, id] : rest, scene);
  },

  /** The floor a token is on, for a label: { stack, height } or null. */
  floorOf(token) {
    return this.place(this.real(token), (token?.document ?? token)?.parent ?? canvas?.scene)?.floor ?? null;
  },

  async save(floors, scene = canvas?.scene) {
    if (!game.user?.isGM || !scene) return [];
    const clean = floors.map(cleanFloor).filter(Boolean);
    await scene.setFlag(MODULE_ID, FLOORS_FLAG, clean);
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return clean;
  },

  /** GM: make a Region a floor ({ region, stack, height }); it replaces what that Region was. */
  async add(floor, scene = canvas?.scene) {
    const f = cleanFloor(floor);
    if (!f) return null;
    await this.save([...this.floors(scene).filter((x) => x.region !== f.region), f], scene);
    return f;
  },

  async remove(region, scene = canvas?.scene) {
    return this.save(this.floors(scene).filter((x) => x.region !== region), scene);
  },

  /** The GM's window: the scene's floors, and a new one. */
  async open() {
    if (!game.user?.isGM || !canvas?.scene) return null;
    const regions = [...(canvas.scene.regions ?? [])];
    if (!regions.length) {
      ui.notifications?.warn(L(`${LANG}.Levels.NeedRegions`));
      return null;
    }
    const unit = esc(canvas.scene.grid?.units || "m");
    const name = (id) => esc(regions.find((r) => r.id === id)?.name || id);
    const floors = this.floors().sort((x, y) => x.stack.localeCompare(y.stack) || x.height - y.height);
    const T = (k, d) => L(`${LANG}.Levels.${k}`, d);
    const remove = (field) => `<label class="ncm-check ncm-levels-remove"><input type="checkbox" name="${field}"> ${T("Remove")}</label>`;
    const rows = floors.map((f) => `<li><span><b>${name(f.region)}</b> · ${f.stack ? esc(f.stack) : T("NoBuilding")} · ${f.height} ${unit}</span>${remove(`del-${esc(f.region)}`)}</li>`).join("");
    const open = this.openingIds();
    const openRows = open.map((id) => `<li><span><b>${name(id)}</b></span>${remove(`shut-${esc(id)}`)}</li>`).join("");
    const options = (list) => list.map((r) => `<option value="${esc(r.id)}">${esc(r.name || r.id)}</option>`).join("");
    const content = `<div class="ncm-levels">`
      + `<p class="ncm-hint">${T("Intro")}</p>`
      + `<fieldset><legend>${T("FloorsTitle")}</legend>`
      + `<p class="ncm-hint">${T("FloorsHint")}</p>`
      + (rows ? `<ul class="ncm-levels-list">${rows}</ul>` : `<p class="ncm-ref">${T("NoFloors")}</p>`)
      + `<p class="ncm-kicker">${T("New")}</p>`
      + `<div class="ncm-grid">`
      + `<label>${T("Region")}<select name="region"><option value="">${T("PickRegion")}</option>${options(regions)}</select></label>`
      + `<label>${T("Stack")}<input type="text" name="stack" value="${esc(floors[0]?.stack ?? "")}" placeholder="${T("StackHint")}"></label>`
      + `<label>${T("Height", { unit })}<input type="number" name="height" step="0.5" placeholder="0"></label>`
      + `</div></fieldset>`
      + `<fieldset><legend>${T("OpeningsTitle")}</legend>`
      + `<p class="ncm-hint">${T("OpeningsHint")}</p>`
      + (openRows ? `<ul class="ncm-levels-list">${openRows}</ul>` : `<p class="ncm-ref">${T("NoOpenings")}</p>`)
      + `<p class="ncm-kicker">${T("NewOpening")}</p>`
      + `<div class="ncm-grid"><label>${T("Opening")}<select name="opening"><option value="">${T("NoOpening")}</option>${options(regions.filter((r) => !open.includes(r.id)))}</select></label></div>`
      + `</fieldset></div>`;
    const picked = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Levels.Tool`) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      ok: {
        label: L(`${LANG}.Levels.Save`),
        callback: (event, button) => {
          const f = button.form.elements;
          return {
            del: floors.filter((x) => f[`del-${x.region}`]?.checked).map((x) => x.region), region: f.region.value, stack: f.stack.value, height: f.height.value,
            shut: open.filter((id) => f[`shut-${id}`]?.checked), opening: f.opening.value
          };
        }
      },
      rejectClose: false
    }).catch(() => null);
    if (!picked) return null;
    let next = this.floors().filter((x) => !picked.del.includes(x.region));
    // A floor needs its Region and its height; say so when only half was filled in.
    const half = (picked.region && picked.height === "") || (!picked.region && picked.height !== "");
    if (half) ui.notifications?.warn(L(`${LANG}.Levels.Half`));
    const f = !picked.region || picked.height === "" ? null : cleanFloor(picked);
    if (f) next = [...next.filter((x) => x.region !== f.region), f];
    const nextOpen = [...open.filter((id) => !picked.shut.includes(id)), ...(picked.opening ? [picked.opening] : [])];
    if (nextOpen.length !== open.length || picked.opening) await this.saveOpenings(nextOpen);
    return this.save(next);
  }
};
