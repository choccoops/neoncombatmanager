import { MODULE_ID, LANG, FLAGS } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { L, slug, esc } from "../util.js";
import { Chrome, chromeKind, isSwitch, conditionFor, chromeConditions } from "./chrome.js";
import { isTactileBoost, TACTILE_CONDITION } from "./tactile.js";

/**
 * Chrome you switch on and off, in one place: what a character has installed that runs (a
 * Sandevistan, Berserk and their Operating Systems; Tactile Boost; Optical Camo, Microrotors and
 * KERS; and any other piece whose item carries an "(active)" effect), as switches for the Action
 * HUD and the Token HUD. Switching one puts its Active Effect on the character and takes it off:
 * a Chrome running condition where this module has one, the item's own "(active)" effect otherwise.
 * A Kerenzikov has no switch: it runs from the moment it's installed.
 */

/** Chrome that runs as a condition of its own, by a word of its name. */
export const ACTIVATED = [
  { test: isTactileBoost, id: TACTILE_CONDITION },
  { test: (n) => /optical camo/i.test(n), id: "chromeOpticalCamo" },
  { test: (n) => /microrotor/i.test(n), id: "chromeMicrorotors" },
  { test: (n) => /\bkers\b|kaleidoscopic/i.test(n), id: "chromeKers" }
];
export const KERENZIKOV = "chromeKerenzikov";
const MANAGED = "installed";
const QUIET = { [MODULE_ID]: { quiet: true } };

const installed = (i) => i?.type === "cyberware" && i.installed;

/**
 * The switches a character's chrome gives, pure: [{ key, kind, label, img, id }].
 *   kind "chrome"     a Sandevistan or Berserk (id: sandevistan | berserk), named for its Operating System
 *   kind "condition"  a piece that runs as a condition (id: the condition's)
 *   kind "effect"     a piece with an "(active)" effect of its own (id: the item's)
 * @param {object[]} items - [{ id, name, type, installed, img, effects: [{ name, disabled }], in: host item id }]
 * @param {{id, kind, os}[]} conditions - the Chrome running conditions (chromeConditions)
 */
export function switchesOf(items = [], conditions = []) {
  const out = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  // An upgrade counts when the piece it sits in is installed.
  const live = (i) => installed(i) || (i.type === "itemUpgrade" && installed(byId.get(i.in)));
  for (const kind of ["sandevistan", "berserk"]) {
    const base = items.find((i) => installed(i) && chromeKind(i.name)?.kind === kind && !chromeKind(i.name).os);
    const os = items.find((i) => live(i) && chromeKind(i.name)?.kind === kind && chromeKind(i.name).os);
    if (!base && !os) continue;
    const c = conditionFor(items.map((i) => ({ ...i, installed: live(i), type: live(i) ? "cyberware" : i.type })), kind, conditions);
    out.push({ key: `chrome:${kind}`, kind: "chrome", id: kind, label: (os ?? base).name, img: (os ?? base).img ?? null, condition: c?.id ?? null });
  }
  for (const i of items) {
    if (!live(i)) continue;
    const what = chromeKind(i.name);
    if (what && what.kind !== "kerenzikov") continue; // the Sandevistan and Berserk switches above
    const act = ACTIVATED.find((a) => a.test(i.name ?? ""));
    if (act) {
      if (!out.some((s) => s.id === act.id)) out.push({ key: `chrome:${slug(i.name)}`, kind: "condition", id: act.id, label: i.name, img: i.img ?? null });
      continue;
    }
    if (what) continue; // a Kerenzikov is always on
    if ((i.effects ?? []).some(isSwitch)) out.push({ key: `chrome:${slug(i.name)}`, kind: "effect", id: i.id, label: i.name, img: i.img ?? null });
  }
  return out;
}

/** Does a character have a Kerenzikov installed, and its Boost System in it? { installed, boost } */
export function kerenzikovOf(items = []) {
  const kz = items.filter((i) => installed(i) && /kerenzikov/i.test(i.name ?? ""));
  const ids = new Set(kz.map((i) => i.id));
  const boost = items.some((i) => i.type === "itemUpgrade" && ids.has(i.in) && /boost system/i.test(i.name ?? ""));
  return { installed: kz.length > 0, boost };
}

export const Switches = {
  _pending: new Map(),

  init() {
    const onItem = (item) => {
      const actor = item?.parent;
      if (actor?.documentName === "Actor" && ["cyberware", "itemUpgrade"].includes(item.type)) this.queue(actor);
    };
    Hooks.on("createItem", onItem);
    Hooks.on("updateItem", onItem);
    Hooks.on("deleteItem", onItem);
    Hooks.on("canvasReady", () => this.syncScene());
    Hooks.on("renderTokenHUD", (hud, html) => this.tokenHud(hud, html));
  },

  ready() {
    this.syncScene({ everyone: true });
  },

  get on() {
    return Chrome.on;
  },

  /** An actor's items as the pure functions read them (an upgrade knows the piece it's installed in). */
  items(actor) {
    const list = [...(actor?.items ?? [])];
    const host = new Map();
    for (const i of list) for (const id of i.system?.installedItems?.list ?? []) host.set(id, i.id);
    return list.map((i) => ({
      id: i.id, name: i.name, type: i.type, img: i.img, in: host.get(i.id) ?? null,
      installed: i.type === "cyberware" && !!(i.system?.isInstalled ?? i.system?.isInstalledInActor),
      effects: [...(i.effects ?? [])].map((e) => ({ name: e.name, disabled: !!e.disabled }))
    }));
  },

  /** A character's switches, each with whether it's on now. */
  of(actor) {
    if (!actor || !this.on) return [];
    return switchesOf(this.items(actor), chromeConditions()).map((s) => ({ ...s, on: this.isOn(actor, s) }));
  },

  isOn(actor, s) {
    if (s.kind === "chrome") return !!Chrome.running(actor, s.id);
    if (s.kind === "condition") return Conditions.has(s.id, actor);
    const item = actor.items.get(s.id);
    return [...(item?.effects ?? [])].some((e) => isSwitch(e) && !e.disabled);
  },

  /** Flip one of a character's switches (by its key); `on` forces it. Returns the new state, or null. */
  async toggle(actor, key, { token = null, on = null } = {}) {
    if (!actor?.isOwner) return null;
    const s = this.of(actor).find((x) => x.key === key);
    if (!s) return null;
    const want = on ?? !s.on;
    if (want === s.on) return s.on;
    if (s.kind === "chrome") {
      const tok = token ?? actor.getActiveTokens?.()[0] ?? { actor };
      await Chrome.activate(s.id, [tok], want);
    } else if (s.kind === "condition") {
      if (want) await Conditions.add(s.id, actor);
      else await Conditions.remove(s.id, actor);
    } else {
      const item = actor.items.get(s.id);
      for (const e of [...(item?.effects ?? [])].filter(isSwitch)) if (!!e.disabled === want) await e.update({ disabled: !want });
    }
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return want;
  },

  /* ---------------------------------------- */
  /*  Kerenzikov: on from the day it goes in  */
  /* ---------------------------------------- */

  queue(actor) {
    if (!Compat.isActiveGM || !actor) return;
    const key = actor.uuid ?? actor.id;
    clearTimeout(this._pending.get(key));
    this._pending.set(key, setTimeout(() => {
      this._pending.delete(key);
      this.syncKerenzikov(actor).catch((err) => console.error(`${MODULE_ID} | Kerenzikov for ${actor.name}`, err));
    }, 200));
  },

  syncScene({ everyone = false } = {}) {
    if (!Compat.isActiveGM) return;
    const actors = new Map();
    for (const t of canvas?.tokens?.placeables ?? []) if (t.actor) actors.set(t.actor.uuid ?? t.actor.id, t.actor);
    if (everyone) for (const a of game.actors ?? []) if (a.hasPlayerOwner) actors.set(a.uuid ?? a.id, a);
    for (const a of actors.values()) this.queue(a);
  },

  /**
   * Keep the Kerenzikov condition on whoever has one installed (the active GM does it): the
   * condition holds the token's faint look on, and carries the Boost System's +2 Initiative when
   * that's fitted. One placed by hand stays where it was put.
   */
  async syncKerenzikov(actor) {
    if (!actor || !["character", "mook"].includes(actor.type) || Registry.get(KERENZIKOV)?.disabled) return null;
    const { installed: has, boost } = this.on ? kerenzikovOf(this.items(actor)) : { installed: false, boost: false };
    const mine = Conditions.effects(actor, KERENZIKOV).filter((e) => e.getFlag(MODULE_ID, FLAGS.managed) === MANAGED);
    if (!has) {
      if (mine.length) await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id), QUIET);
      await Chrome._flag(actor, "kerenzikov", null);
      return false;
    }
    const c = Registry.get(KERENZIKOV);
    const base = c?.rawChanges ?? [];
    const want = boost ? base : base.filter((ch) => ch.key !== "bonuses.initiative");
    const boosted = mine.some((e) => (e.changes ?? []).some((ch) => ch.key === "bonuses.initiative"));
    if (mine.length && boosted !== boost) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id), QUIET);
      mine.length = 0;
    }
    if (!mine.length && !Conditions.has(KERENZIKOV, actor)) await Conditions.add(KERENZIKOV, actor, { managed: MANAGED, changes: want });
    await Chrome._flag(actor, "kerenzikov", true);
    return true;
  },

  /* ---------------------------------------- */
  /*  The Token HUD                           */
  /* ---------------------------------------- */

  /** A Chrome button in the Token HUD's right column: the token's switches, lit while they run. */
  tokenHud(hud, html) {
    const root = Compat.element(html);
    const token = hud?.object;
    const actor = token?.actor;
    if (!root || !actor?.isOwner || !Settings.get("chromeTokenHud") || root.querySelector(".ncm-chrome-hud")) return;
    const list = this.of(actor);
    if (!list.length) return;
    const col = root.querySelector(".col.right") ?? root.querySelector(".right") ?? root;
    const wrap = document.createElement("div");
    wrap.className = `control-icon ncm-chrome-hud${list.some((s) => s.on) ? " active" : ""}`;
    wrap.dataset.tooltip = L(`${LANG}.Chrome.HudTitle`);
    wrap.innerHTML = `<i class="fa-solid fa-microchip"></i><div class="ncm-chrome-palette">${list.map((s) => `<button type="button" data-chrome="${esc(s.key)}" class="${s.on ? "active" : ""}">${s.img ? `<img src="${esc(s.img)}" alt="">` : ""}<span>${esc(s.label)}</span></button>`).join("")}</div>`;
    wrap.addEventListener("click", (event) => {
      const b = event.target.closest?.("[data-chrome]");
      if (!b) {
        wrap.classList.toggle("open");
        return;
      }
      event.stopPropagation();
      this.toggle(actor, b.dataset.chrome, { token }).then((on) => {
        if (on === null) return;
        b.classList.toggle("active", on);
        wrap.classList.toggle("active", !!wrap.querySelector("button.active"));
      }).catch((err) => console.error(`${MODULE_ID} | chrome switch`, err));
    });
    col.append(wrap);
  }
};
