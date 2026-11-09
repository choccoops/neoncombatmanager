import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { L, esc, debounce } from "../util.js";
import {
  MATERIALS, THICKNESS, LEAN_METRES, VAS, coverHp, readWallCover, readPieceCover, readGlassCover, seatOf, coverFor, hitCover, splitAt, coverLabel, areaPlan
} from "./data.js";

/** The senses a destroyed section stops blocking (Foundry's NONE), so tokens walk and see through it. */
const OPEN = { move: 0, sight: 0, light: 0, sound: 0 };
const LABELS = "ncm-cover-labels";

const T = (k, d) => L(`${LANG}.Cover.${k}`, d);
const label = (cover) => coverLabel(cover, (k) => T(k));

/**
 * Cover at the table (2070 Core Rules Ch07): walls tagged with a material and a thickness, and cover
 * pieces (tokens of the Neon Cover actors, and rides). Each 2×2m section of a wall, and each piece,
 * has the book's HP. Shots and areas say what cover is in the way; the GM's buttons put the damage
 * on it. A destroyed wall section stops blocking movement and sight until the GM repairs it.
 */
export const Cover = {
  init() {
    Hooks.on("renderWallConfig", (app, html) => this.wallConfig(app, html));
    Hooks.on("getSceneControlButtons", (controls) => {
      if (!game.user?.isGM) return;
      Compat.addSceneTools(controls, [{ name: "ncm-cover", title: T("Tool.Tag"), icon: "fa-solid fa-shield-halved", onClick: () => this.tagDialog() }], "walls");
      Compat.addSceneTools(controls, [{ name: "ncm-cover-repair", title: T("Tool.Repair"), icon: "fa-solid fa-trowel-bricks", onClick: () => this.repair() }]);
    });
    const soon = debounce(() => this.drawLabels(), 150);
    for (const h of ["canvasReady", "createWall", "updateWall", "deleteWall", `${MODULE_ID}.coverChanged`]) Hooks.on(h, () => soon());
    Hooks.on("canvasTearDown", () => this.clearLabels());
    Hooks.on("preUpdateToken", (doc, changes, options, userId) => this.moveWarning(doc, changes, userId));
    Socket.on("coverDamage", (data) => this.damageAsGM(data));
    Socket.on("coverRepair", (data) => this.repairAsGM(data));
    Socket.on("coverTag", (data) => this.tagAsGM(data));
  },

  get on() {
    return !!Settings.get("coverOn");
  },

  grid(scene = canvas?.scene) {
    return { size: Number(scene?.grid?.size ?? canvas?.grid?.size) || 100, distance: Number(scene?.grid?.distance ?? canvas?.dimensions?.distance) || 2 };
  },

  /** Everything on a scene that's cover: { walls, pieces }. */
  scan(scene = canvas?.scene) {
    const grid = this.grid(scene);
    const doorsWood = !!Settings.get("coverDoors");
    const walls = [...(scene?.walls ?? [])].map((w) => readWallCover(w, { doorsWood, ...grid })).filter(Boolean);
    const pieces = [...(scene?.tokens ?? [])].map((t) => readPieceCover(t, { ...grid, sp: CPR.armor(t.actor).body })).filter(Boolean);
    return { walls, pieces };
  },

  /**
   * The ride someone sits in on this scene (MMuton's vehicle sheet seats them by actor UUID):
   * { ride: its token id, glass: their seat's bulletproof glass as cover, or null } or {}.
   */
  riding(tok, scene = canvas?.scene) {
    const doc = tok?.document ?? tok;
    const uuid = doc?.actor?.uuid;
    if (!uuid) return {};
    for (const t of scene?.tokens ?? []) {
      if (t.id === doc.id || !t.actor) continue;
      const seat = seatOf(t.actor.flags?.[VAS]?.positions, uuid);
      if (seat) return { ride: t.id, glass: readGlassCover(t, seat) };
    }
    return {};
  },

  /** Is this token a cover piece (not a person)? */
  isPiece(tok) {
    return !!(tok?.actor ?? tok)?.flags?.[MODULE_ID]?.cover;
  },

  /** Is this token cover at all: a cover piece, or a ride (its SP and SDP, the HOUSE RULE)? */
  isCover(tok) {
    const doc = tok?.document ?? tok;
    return !!readPieceCover(doc, this.grid(doc?.parent));
  },

  /**
   * The cover a shot at this target meets: the target itself when it's a cover piece (shooting the
   * table), else the first intact cover in the way. A ref, or null.
   */
  forShot(from, to, opts = {}) {
    if (!this.on || !to) return null;
    const doc = to.document ?? to;
    if (this.isPiece(doc)) {
      const piece = readPieceCover(doc, this.grid(doc.parent));
      return piece && piece.hp[0] > 0 ? { ...this.ref(piece, 0, doc.parent), self: true } : null;
    }
    return this.between(from, to, opts);
  },

  center(tok, { size } = this.grid(tok?.parent)) {
    const t = tok?.document ?? tok;
    return { x: (Number(t?.x) || 0) + ((Number(t?.width) || 1) * size) / 2, y: (Number(t?.y) || 0) + ((Number(t?.height) || 1) * size) / 2 };
  },

  /**
   * The first intact cover between a shooter's token and a target's, as a plain ref for a card
   * ({ kind, id, section, label, hp, max, thickness, scene }), or null. Cover the shooter leans out
   * from doesn't count; a charged Tech shot goes through Thin cover.
   */
  between(from, to, { throughThin = false } = {}) {
    if (!this.on || !from || !to) return null;
    const scene = (to.document ?? to).parent ?? canvas?.scene;
    const grid = this.grid(scene);
    const { walls, pieces } = this.scan(scene);
    const a = this.center(from, grid);
    const b = this.center(to, grid);
    // A shooter firing out of a ride isn't behind it; a target riding in one has its seat's glass, if any.
    const shooterRide = this.riding(from, scene).ride;
    const ids = [(from.document ?? from).id, (to.document ?? to).id, ...(shooterRide ? [shooterRide] : [])];
    const { ride, glass } = this.riding(to, scene);
    const hit = coverFor(a, b, { walls, pieces, lean: (LEAN_METRES / grid.distance) * grid.size, exclude: ids, throughThin, ride, glass });
    return hit ? this.ref(hit.cover, hit.section, scene) : null;
  },

  label(cover) {
    return label(cover);
  },

  ref(cover, section, scene = canvas?.scene) {
    return {
      kind: cover.kind, id: cover.id, section: cover.kind === "glass" ? cover.seat : section, label: label(cover), hp: cover.hp[cover.kind === "wall" ? section : 0],
      max: cover.max, thickness: cover.thickness, scene: scene?.id ?? null, ...(cover.kind === "vehicle" ? { sp: cover.sp } : {})
    };
  },

  /** An area attack's cover, for the GM's apply window (see areaPlan). */
  areaPlan({ scene, origin, people, inside = [], damage, explosive, bunkerBuster, exclude = [] }) {
    if (!this.on) return { cover: [], hit: Object.fromEntries(people.map((p) => [p.id, { hit: true, behind: null }])) };
    const { walls, pieces } = this.scan(scene);
    const piecesInside = pieces.filter((p) => inside.includes(p.id));
    return areaPlan({ origin, people, walls, pieces, piecesInside, damage, explosive, bunkerBuster, exclude });
  },

  /* ---------------------------------------- */
  /*  Damage (the GM)                         */
  /* ---------------------------------------- */

  /** Put damage on a piece of cover (asks the active GM): { before, after, destroyed, label }. */
  damage(ref, amount, opts = {}) {
    return Socket.request("coverDamage", { ...ref, amount, ...opts });
  },

  async damageAsGM({ scene: sceneId, kind, id, section = 0, amount = 0, explosive = false, bunkerBuster = false, quiet = false }) {
    const scene = game.scenes?.get(sceneId) ?? canvas?.scene;
    if (!scene) return null;
    let out = null;
    if (kind === "wall") out = await this.damageWall(scene, id, section, amount, { explosive, bunkerBuster });
    else if (kind === "piece") out = await this.damagePiece(scene, id, amount, { explosive, bunkerBuster });
    else if (kind === "vehicle") out = await this.damageVehicle(scene, id, amount, { explosive, bunkerBuster });
    else if (kind === "glass") out = await this.damageGlass(scene, id, section, amount, { explosive, bunkerBuster });
    if (out && !quiet) await this.card([out]);
    Hooks.callAll(`${MODULE_ID}.coverChanged`, scene);
    return out;
  },

  async damageWall(scene, id, section, amount, opts) {
    const doc = scene.walls.get(id);
    const cover = readWallCover(doc, { doorsWood: !!Settings.get("coverDoors"), ...this.grid(scene) });
    if (!cover) return null;
    const i = Math.max(0, Math.min(cover.n - 1, Number(section) || 0));
    const r = hitCover(cover.hp[i], amount, opts);
    const base = { material: cover.material, thickness: cover.thickness };
    if (!r.destroyed) {
      const hp = [...cover.hp];
      hp[i] = r.after;
      await doc.update({ [`flags.${MODULE_ID}.cover`]: { ...base, hp } });
      return { ...r, label: label(cover) };
    }
    await this.breakSection(scene, doc, cover, i);
    return { ...r, label: label(cover) };
  },

  /**
   * A destroyed section opens: a wall of one section stops blocking; a longer wall is split into the
   * part before, the open section and the part after, each keeping its own sections' HP.
   */
  async breakSection(scene, doc, cover, i) {
    const restore = { move: doc.move, sight: doc.sight, light: doc.light, sound: doc.sound, door: doc.door, ds: doc.ds };
    const kept = { material: cover.material, thickness: cover.thickness };
    const open = { ...OPEN, door: 0, [`flags.${MODULE_ID}.cover`]: { ...kept, broken: true, restore } };
    if (cover.n === 1) return doc.update({ ...open, [`flags.${MODULE_ID}.cover.-=hp`]: null });
    const parts = splitAt(cover.c, i, cover.n, cover.hp);
    // The new walls copy this one (its senses, door, direction), each with a cover flag of its own.
    const data = doc.toObject();
    delete data._id;
    if (data.flags?.[MODULE_ID]) delete data.flags[MODULE_ID].cover;
    const wall = (c, flag, extra = {}) => foundry.utils.mergeObject(foundry.utils.deepClone(data), { ...extra, c, flags: { [MODULE_ID]: { cover: flag } } });
    const create = [wall(parts.section.c, { ...kept, broken: true, restore }, { ...OPEN, door: 0 })];
    if (parts.after) create.push(wall(parts.after.c, { ...kept, hp: parts.after.hp }));
    await scene.createEmbeddedDocuments("Wall", create);
    if (parts.before) return doc.update({ c: parts.before.c, [`flags.${MODULE_ID}.cover.hp`]: parts.before.hp });
    return doc.delete();
  },

  async damagePiece(scene, id, amount, opts) {
    const tok = scene.tokens.get(id);
    const actor = tok?.actor;
    const cover = readPieceCover(tok, this.grid(scene));
    if (!cover) return null;
    const r = hitCover(cover.hp[0], amount, opts);
    await actor.update({ "system.derivedStats.hp.value": r.after });
    if (r.destroyed) await tok.update({ alpha: 0.35, [`flags.${MODULE_ID}.coverDestroyed`]: true });
    return { ...r, label: cover.name };
  },

  /**
   * A ride as cover (HOUSE RULE): its SP and SDP, through Cyberpunk RED's own damage (SP stops its
   * share and ablates, SDP takes the rest). A rocket's double counts once the damage gets through the
   * SP (Bunker Buster), so CPR is handed the SP plus twice what gets past it.
   */
  async damageVehicle(scene, id, amount, { explosive = false, bunkerBuster = false } = {}) {
    const tok = scene.tokens.get(id);
    const actor = tok?.actor;
    if (!actor) return null;
    const before = CPR.hp(actor).value;
    const sp = CPR.armor(actor).body;
    const dmg = Number(amount) || 0;
    const hand = bunkerBuster && dmg > sp ? sp + 2 * (dmg - sp) : dmg;
    if (typeof actor._applyDamage === "function") {
      await actor._applyDamage(hand, 0, "body", 1, "", 0, 0, true, { damageReductionRole: false, damageReductionAE: false, useShield: false, brainDamageReduction: false });
    }
    const after = CPR.hp(actor).value;
    const destroyed = after === 0 && before > 0;
    return { before, after, taken: before - after, destroyed, soaks: !(destroyed && explosive), label: `${tok.name} (SP ${sp})` };
  },

  /** A seat's bulletproof glass (MMuton's vehicle sheet keeps its HP on the seat). */
  async damageGlass(scene, id, seatId, amount, opts) {
    const tok = scene.tokens.get(id);
    const actor = tok?.actor;
    const positions = foundry.utils.deepClone(actor?.flags?.[VAS]?.positions ?? []);
    const seat = positions.find((p) => p.id === seatId);
    const cover = readGlassCover(tok, seat ? { position: seat } : null);
    if (!cover) return null;
    const r = hitCover(cover.hp[0], amount, opts);
    seat.glassHp = r.after;
    await actor.update({ [`flags.${VAS}.positions`]: positions });
    return { ...r, label: cover.name };
  },

  /** What the cover took, for everyone. */
  card(results) {
    const lines = results.filter(Boolean).map((r) => `<li><strong>${esc(r.label)}</strong> · ${T("HpLine", { before: r.before, after: r.after })}${r.destroyed ? ` · ${T("Destroyed")}` : ""}</li>`);
    if (!lines.length) return null;
    return Cards.post({ kicker: T("Kicker"), title: T("Took", { count: lines.length }), tone: "cyan", body: `<ul class="ncm-chain-pay">${lines.join("")}</ul>` });
  },

  /* ---------------------------------------- */
  /*  Repair and tagging (the GM)             */
  /* ---------------------------------------- */

  /** GM: every wall section and cover piece on the scene back to full, destroyed sections closed again. */
  async repair(scene = canvas?.scene) {
    if (!game.user.isGM) return null;
    const n = await Socket.request("coverRepair", { scene: scene?.id });
    ui.notifications.info(T("Repaired", { count: n ?? 0 }));
    return n;
  },

  async repairAsGM({ scene: sceneId }) {
    const scene = game.scenes?.get(sceneId) ?? canvas?.scene;
    if (!scene) return 0;
    const walls = [];
    let fixed = 0;
    for (const w of scene.walls ?? []) {
      const f = w.flags?.[MODULE_ID]?.cover;
      if (!f?.material || (!f.broken && !f.hp)) continue;
      const max = coverHp(f.material, f.thickness ?? "thick");
      if (f.broken || (f.hp ?? []).some((v) => Number(v) < max)) fixed++;
      const restore = f.broken ? { ...OPEN, ...(f.restore ?? { move: 20, sight: 20, light: 20, sound: 20 }) } : {};
      const key = `flags.${MODULE_ID}.cover`;
      walls.push({ _id: w.id, ...restore, [`${key}.-=hp`]: null, [`${key}.-=broken`]: null, [`${key}.-=restore`]: null });
    }
    if (walls.length) await scene.updateEmbeddedDocuments("Wall", walls);
    let pieces = 0;
    for (const tok of scene.tokens ?? []) {
      if (!this.isPiece(tok)) continue;
      const hp = CPR.hp(tok.actor);
      if (hp.value >= hp.max && !tok.flags?.[MODULE_ID]?.coverDestroyed) continue;
      await tok.actor.update({ "system.derivedStats.hp.value": hp.max });
      await tok.update({ alpha: 1, [`flags.${MODULE_ID}.-=coverDestroyed`]: null });
      pieces++;
    }
    Hooks.callAll(`${MODULE_ID}.coverChanged`, scene);
    return fixed + pieces;
  },

  /** GM: tag walls as cover (material "" untags them). `scope`: selected | untagged | all. */
  async tagAsGM({ scene: sceneId, ids = [], scope = "selected", material = "", thickness = "thick" }) {
    const scene = game.scenes?.get(sceneId) ?? canvas?.scene;
    if (!scene) return 0;
    const picked = [...(scene.walls ?? [])].filter((w) => {
      if (scope === "selected") return ids.includes(w.id);
      if (scope === "untagged") return !w.flags?.[MODULE_ID]?.cover?.material;
      return true;
    });
    const updates = picked.map((w) => (material
      ? { _id: w.id, [`flags.${MODULE_ID}.cover`]: { material, thickness } }
      : { _id: w.id, [`flags.${MODULE_ID}.-=cover`]: null }));
    if (updates.length) await scene.updateEmbeddedDocuments("Wall", updates);
    Hooks.callAll(`${MODULE_ID}.coverChanged`, scene);
    return updates.length;
  },

  /** The walls tool: tag the selected walls, or every untagged (or every) wall in the scene. */
  async tagDialog() {
    if (!game.user.isGM || !canvas?.scene) return null;
    const selected = (canvas.walls?.controlled ?? []).map((w) => w.id);
    const options = (list, key) => list.map((v) => `<option value="${v}">${T(`${key}.${v}`)}</option>`).join("");
    const content = `<div class="ncm-grid">
      <div class="form-group"><label>${T("Material.label")}</label><select name="material"><option value="">${T("Material.none")}</option>${options(MATERIALS, "Material")}</select></div>
      <div class="form-group"><label>${T("Thickness.label")}</label><select name="thickness">${options(THICKNESS, "Thickness")}</select></div>
      <div class="form-group"><label>${T("Scope.label")}</label><select name="scope">
        <option value="selected"${selected.length ? " selected" : ""}>${T("Scope.selected", { count: selected.length })}</option>
        <option value="untagged"${selected.length ? "" : " selected"}>${T("Scope.untagged")}</option>
        <option value="all">${T("Scope.all")}</option></select></div>
      <p class="ncm-ref">${T("TagHint")}</p></div>`;
    const picked = await Compat.DialogV2.prompt({
      window: { title: T("Tool.Tag") },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      ok: {
        label: T("Tag"),
        callback: (event, button) => {
          const f = button.form.elements;
          return { material: f.material.value, thickness: f.thickness.value, scope: f.scope.value };
        }
      },
      rejectClose: false
    });
    if (!picked) return null;
    const n = await Socket.request("coverTag", { scene: canvas.scene.id, ids: selected, ...picked });
    ui.notifications.info(T("Tagged", { count: n ?? 0 }));
    return n;
  },

  /* ---------------------------------------- */
  /*  On the map                              */
  /* ---------------------------------------- */

  /** A Cover block in the wall's settings: material, thickness, and its sections' HP. */
  wallConfig(app, html) {
    const root = Compat.element(html);
    const wall = app.document ?? app.object;
    if (!root || !wall || root.querySelector(".ncm-wall-cover")) return;
    const form = root.querySelector("form") ?? root;
    const f = wall.flags?.[MODULE_ID]?.cover ?? {};
    const name = `flags.${MODULE_ID}.cover`;
    const read = readWallCover(wall, { doorsWood: !!Settings.get("coverDoors"), ...this.grid(wall.parent) });
    const hp = read && !read.implicit ? T("Sections", { hp: read.hp.join(" · "), max: read.max, count: read.n }) : T("SectionsHint");
    const opt = (list, key, now) => list.map((v) => `<option value="${v}"${v === now ? " selected" : ""}>${T(`${key}.${v}`)}${key === "Material" ? ` (${coverHp(v, "thin")} / ${coverHp(v, "thick")})` : ""}</option>`).join("");
    const group = document.createElement("fieldset");
    group.className = "ncm-wall-cover";
    group.innerHTML = `<legend>${T("Legend")}</legend>
      <div class="form-group"><label>${T("Material.label")}</label><div class="form-fields"><select name="${name}.material"><option value="">${T("Material.none")}</option>${opt(MATERIALS, "Material", f.material)}</select></div></div>
      <div class="form-group"><label>${T("Thickness.label")}</label><div class="form-fields"><select name="${name}.thickness">${opt(THICKNESS, "Thickness", f.thickness ?? "thick")}</select></div></div>
      <p class="hint">${f.broken ? T("BrokenHint") : hp}</p>`;
    const thin = root.querySelector(".ncm-wall-thin");
    const anchor = form.querySelector("footer, .form-footer, button[type=submit]");
    const before = anchor?.closest("footer, .form-footer") ?? anchor;
    if (thin) thin.after(group);
    else if (before) before.before(group);
    else form.append(group);
    app.setPosition?.({ height: "auto" });
  },

  clearLabels() {
    const old = canvas?.interface?.getChildByName?.(LABELS);
    if (old) old.destroy({ children: true });
  },

  /** For the GM: each damaged section's HP on the map, and an ✕ on a destroyed one. */
  drawLabels() {
    this.clearLabels();
    if (!game.user?.isGM || !this.on || !Settings.get("coverLabels") || !canvas?.ready || !canvas.interface || typeof PIXI === "undefined") return;
    const box = new PIXI.Container();
    box.name = LABELS;
    const grid = this.grid();
    const size = Math.max(14, Math.round(grid.size * 0.22));
    const style = (color) => new PIXI.TextStyle({ fontFamily: "Signika", fontSize: size, fontWeight: "bold", fill: color, stroke: "#000000", strokeThickness: 4 });
    for (const w of canvas.scene.walls ?? []) {
      // Doors that are Wood (Thin) only by the setting have never been hit: nothing to show.
      const cover = readWallCover(w, { doorsWood: false, ...grid });
      if (!cover) continue;
      const put = (text, color, i) => {
        const t = cover.n > 1 ? (i + 0.5) / cover.n : 0.5;
        const label = new PIXI.Text(text, style(color));
        label.anchor.set(0.5);
        label.position.set(cover.c[0] + (cover.c[2] - cover.c[0]) * t, cover.c[1] + (cover.c[3] - cover.c[1]) * t);
        box.addChild(label);
      };
      if (cover.broken) put("✕", "#ff2a6d", 0);
      else cover.hp.forEach((hp, i) => hp < cover.max && put(hp > 0 ? `${hp}/${cover.max}` : "✕", hp > 0 ? "#05d9e8" : "#ff2a6d", i));
    }
    if (box.children.length) canvas.interface.addChild(box);
    else box.destroy();
  },

  /** A player dragging Thick cover without BODY 10+ gets a reminder (Ch07); the move still happens. */
  moveWarning(doc, changes, userId) {
    if (userId !== game.user.id || game.user.isGM || !("x" in changes || "y" in changes)) return;
    const f = doc.actor?.flags?.[MODULE_ID]?.cover;
    if (!f || f.thickness !== "thick") return;
    const mover = game.user.character;
    if (mover && CPR.stat(mover, "body") >= 10) return;
    ui.notifications.warn(T("ThickMove", { name: esc(doc.name) }));
  }
};
