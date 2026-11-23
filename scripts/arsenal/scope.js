import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { scopeOf, better, scopedRange, scopeLabel, SCOPE_RANGES } from "./scope-data.js";
import { lightRange } from "../senses/sight-data.js";
import { L } from "../util.js";

/**
 * Looking through a scope. A character with a scope on the gun in their hands, TeleOptics in
 * their eyes (or in the glasses or helmet they wear), or binoculars, gets a Scope action on the
 * Action HUD: switched on, their token sees as far as the scope does, in the cone the token
 * already looks through (or a narrower one, by setting); switched off, it sees as it did.
 *
 * What the token saw before is kept on the token (flag `scope`), so it always comes back the
 * same, whoever switches it off and after a reload.
 */
export const SCOPE_FLAG = "scope";

export const Scope = {
  get on() {
    return !!Settings.get("scopeVision");
  },

  init() {
    // The gun stowed, dropped or gone: the scope comes down with it.
    const check = (item, userId) => {
      if (userId !== game.user.id || !this.on) return;
      const actor = item?.parent;
      if (actor?.documentName !== "Actor") return;
      for (const t of actor.getActiveTokens?.() ?? []) {
        const f = t.document?.flags?.[MODULE_ID]?.[SCOPE_FLAG];
        if (f && !this.sources(actor).some((s) => s.key === f.key)) this.lower(t.document).catch((err) => console.error(`${MODULE_ID} | scope`, err));
      }
    };
    Hooks.on("updateItem", (item, changes, options, userId) => check(item, userId));
    Hooks.on("deleteItem", (item, options, userId) => check(item, userId));
  },

  /** An item with what's fitted in it (and in those), as scopeOf reads them. */
  _fitted(item, actor, seen = new Set()) {
    const out = [];
    for (const id of item?.system?.installedItems?.list ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const u = actor?.items?.get(id);
      if (!u) continue;
      out.push(u, ...this._fitted(u, actor, seen));
    }
    return out;
  },

  _read(item) {
    return scopeOf({ name: item.name, description: item.system?.description?.value });
  },

  /**
   * What a character can look through right now: [{ key, name, scope, weapon? }].
   *   a ranged weapon in hand, by its best scope attachment (a Sniper Rifle with none counts as
   *   carrying a Sniping Scope, by setting);
   *   their eyes: TeleOptics installed, or in the glasses or helmet they wear;
   *   binoculars they carry.
   */
  sources(actor) {
    if (!actor) return [];
    const items = [...(actor.items ?? [])];
    const out = [];
    for (const w of items.filter((i) => i.type === "weapon" && i.system?.isRanged && i.system?.equipped === "equipped")) {
      let best = null;
      let by = null;
      for (const u of this._fitted(w, actor)) {
        const s = this._read(u);
        if (better(best, s) !== best) {
          best = better(best, s);
          by = u.name;
        }
      }
      if (!best && Settings.get("scopeSniper") && w.system?.weaponType === "sniperRifle") {
        best = { range: SCOPE_RANGES.sniping };
        by = w.name;
      }
      if (best) out.push({ key: `zoom:${w.id}`, name: by, scope: best, weapon: w.id });
    }
    let eyes = null;
    let eyesBy = null;
    for (const i of items) {
      const worn = i.type === "cyberware" ? !!i.system?.isInstalled : ["armor", "gear", "clothing"].includes(i.type) && i.system?.equipped === "equipped";
      if (!worn) continue;
      const s = this._read(i);
      if (!s?.range) continue;
      if (better(eyes, s) !== eyes) {
        eyes = better(eyes, s);
        eyesBy = i.name;
      }
    }
    if (eyes) out.push({ key: "zoom:eyes", name: eyesBy, scope: eyes });
    for (const g of items.filter((i) => i.type === "gear" && i.system?.equipped !== "owned")) {
      const s = this._read(g);
      if (s?.factor) out.push({ key: `zoom:${g.id}`, name: g.name, scope: s });
    }
    return out;
  },

  /** The scope a token is looking through, or null. */
  active(token) {
    const doc = token?.document ?? token;
    return doc?.flags?.[MODULE_ID]?.[SCOPE_FLAG] ?? null;
  },

  /** The furthest anything on this scene can be, in its units. */
  _max(doc) {
    const d = doc?.parent?.dimensions ?? canvas?.dimensions;
    if (!d?.size) return Infinity;
    return (Math.hypot(d.sceneWidth ?? d.width ?? 0, d.sceneHeight ?? d.height ?? 0) / d.size) * (d.distance || 1);
  },

  /**
   * Switch a scope on or off for a character's token (the Action HUD).
   * @returns {Promise<boolean|null>} whether it's up now; null when it can't be
   */
  async toggle(actor, key, { token = null } = {}) {
    if (!this.on || !actor?.isOwner) return null;
    const tok = token ?? actor.getActiveTokens?.()[0] ?? null;
    const doc = tok?.document ?? tok;
    if (!doc?.update) {
      ui.notifications?.warn(L(`${LANG}.Scope.NoToken`, { name: actor.name }));
      return null;
    }
    const now = this.active(doc);
    if (now?.key === key) {
      await this.lower(doc);
      return false;
    }
    const src = this.sources(actor).find((s) => s.key === key);
    if (!src) return null;
    await this.raise(doc, src);
    return true;
  },

  /** Up: the token sees as far as the scope does. What it saw before is kept. */
  async raise(doc, src) {
    const held = this.active(doc);
    const modes = Array.isArray(doc.detectionModes) ? doc.detectionModes.map((m) => ({ id: m.id, enabled: m.enabled, range: m.range })) : null;
    const was = held?.was ?? { range: Number(doc.sight?.range) || 0, angle: Number(doc.sight?.angle) || 360, modes };
    // Unaided, they see as far as their eyes do in the dark or, with Sight range on, as far as they make people out.
    const eye = lightRange(was.modes ?? []);
    const range = scopedRange({ base: Number.isFinite(eye) ? Math.max(was.range, eye) : was.range, scope: src.scope, max: this._max(doc) });
    const angle = Number(Settings.get("scopeAngle")) || 0;
    const update = { "sight.range": range, [`flags.${MODULE_ID}.${SCOPE_FLAG}`]: { key: src.key, name: src.name, scope: src.scope, range, was } };
    if (angle > 0 && angle < was.angle) update["sight.angle"] = angle;
    // Senses with a reach of their own (a limited basic sight, a limited light perception) reach as far too.
    if (was.modes) update.detectionModes = was.modes.map((m) => (m.enabled !== false && Number.isFinite(Number(m.range)) && m.range !== null && Number(m.range) > 0 && Number(m.range) < range && ["basicSight", "lightPerception"].includes(m.id) ? { ...m, range } : m));
    await doc.update(update);
    const unit = doc.parent?.grid?.units || canvas?.scene?.grid?.units || "m";
    ui.notifications?.info(L(`${LANG}.Scope.Up`, { name: doc.name, scope: src.name, range, unit }));
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return range;
  },

  /** Down: the token sees as it did. */
  async lower(doc) {
    const f = this.active(doc);
    if (!f) return false;
    const update = { "sight.range": f.was?.range ?? 0, "sight.angle": f.was?.angle ?? 360, [`flags.${MODULE_ID}.-=${SCOPE_FLAG}`]: null };
    if (Array.isArray(f.was?.modes)) update.detectionModes = f.was.modes;
    await doc.update(update);
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return true;
  },

  /** HUD entries: a button for a weapon's row, and rows for eyes and binoculars. */
  buttonFor(actor, weapon, token, list = this.sources(actor)) {
    const s = list.find((x) => x.weapon === weapon.id);
    if (!s) return null;
    return { key: s.key, label: L(`${LANG}.Scope.Button`, { scope: s.name, range: scopeLabel(s.scope) }), icon: "fa-solid fa-magnifying-glass-plus", on: this.active(token)?.key === s.key };
  },

  entries(actor, token, list = this.sources(actor)) {
    return list.filter((s) => !s.weapon).map((s) => ({ key: s.key, label: L(`${LANG}.Scope.Entry`, { scope: s.name }), sub: scopeLabel(s.scope), icon: "fa-solid fa-magnifying-glass-plus", on: this.active(token)?.key === s.key, alert: this.active(token)?.key === s.key }));
  },

  isMeat: (actor) => CPR.isMeat(actor)
};
