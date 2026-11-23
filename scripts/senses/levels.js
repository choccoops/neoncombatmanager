import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { inShapes, boundsOf } from "./far-data.js";
import { cleanFloor, floorIn, stacked, onto, through, apart } from "./levels-data.js";
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
    const rows = floors.map((f) => `<label class="ncm-check"><input type="checkbox" name="del-${esc(f.region)}"> ${f.stack ? `${esc(f.stack)} · ` : ""}${name(f.region)} · ${f.height} ${unit}</label>`).join("");
    const content = `<div class="ncm-grid">${rows ? `<p class="ncm-ref">${L(`${LANG}.Levels.Existing`)}</p>${rows}` : ""}`
      + `<p class="ncm-ref">${L(`${LANG}.Levels.New`)}</p>`
      + `<label>${L(`${LANG}.Levels.Region`)}<select name="region">${regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name || r.id)}</option>`).join("")}</select></label>`
      + `<label>${L(`${LANG}.Levels.Stack`)}<input type="text" name="stack" value="${esc(floors[0]?.stack ?? "")}" placeholder="${L(`${LANG}.Levels.StackHint`)}"></label>`
      + `<label>${L(`${LANG}.Levels.Height`, { unit })}<input type="number" name="height" step="0.5" placeholder="4"></label></div>`;
    const picked = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Levels.Tool`) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      ok: {
        label: L(`${LANG}.Levels.Save`),
        callback: (event, button) => {
          const f = button.form.elements;
          return { del: floors.filter((x) => f[`del-${x.region}`]?.checked).map((x) => x.region), region: f.region.value, stack: f.stack.value, height: f.height.value };
        }
      },
      rejectClose: false
    }).catch(() => null);
    if (!picked) return null;
    let next = this.floors().filter((x) => !picked.del.includes(x.region));
    const f = picked.height === "" ? null : cleanFloor(picked);
    if (f) next = [...next.filter((x) => x.region !== f.region), f];
    return this.save(next);
  }
};
