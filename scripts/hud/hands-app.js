import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Hands } from "./hands.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Equip / Change Weapon, from the Action HUD: a character's hands and what's in them (free a hand,
 * or drop what it holds), and the weapons they carry, to put into a free hand.
 */
export class HandsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-hands`,
    classes: ["neon-combat", "ncm-window", "ncm-hands"],
    window: { icon: "fa-solid fa-hand-fist" },
    position: { width: 380, height: "auto" },
    actions: {
      equipHand: HandsApp.#onEquip,
      freeHand: HandsApp.#onFree,
      dropItem: HandsApp.#onDrop
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/hud-hands.hbs` } };

  /** Open for a character (the HUD's). */
  static open(actor) {
    if (!actor?.isOwner) return null;
    this.instance ??= new this();
    const app = this.instance;
    app._actor = actor;
    app.render(true);
    return app;
  }

  /** Redraw when the character's items change while it's open. */
  static refresh(actor) {
    const app = this.instance;
    if (app?.rendered && (!actor || actor === app._actor)) app.render();
  }

  get title() {
    return L(`${LANG}.Hands.Title`);
  }

  get actor() {
    return this._actor ?? null;
  }

  async _prepareContext() {
    return context(this.actor);
  }

  static async #onEquip(event, target) {
    const item = this.actor?.items.get(target.dataset.item);
    if (await Hands.equip(this.actor, item, target.dataset.hand)) this.render();
  }

  static async #onFree(event, target) {
    const item = this.actor?.items.get(target.dataset.item);
    if (await Hands.free(this.actor, item)) this.render();
  }

  static async #onDrop(event, target) {
    const item = this.actor?.items.get(target.dataset.item);
    if (await Hands.drop(this.actor, item)) this.render();
  }
}

/** What the window shows for a character (the preview and the tests use it too). */
export function context(actor) {
  if (!actor) return { none: true };
  const st = Hands.state(actor);
  const usable = st.slots.filter((s) => !s.lost);
  return {
    name: actor.name,
    img: actor.img,
    free: st.free,
    total: st.total,
    hands: st.slots.map((s) => ({ id: s.id, label: Hands.label(s.id), lost: s.lost, item: s.item ? { id: s.item.id, name: s.item.name, img: s.item.img } : null })),
    held: st.held.map((h) => ({
      id: h.item.id, name: h.item.name, img: h.item.img, over: h.over,
      where: h.hands.map((id) => Hands.label(id)).join(" + ") || L(`${LANG}.Hands.NoHand`)
    })),
    carried: st.carried.map((c) => ({
      id: c.item.id, name: c.item.name, img: c.item.img, need: c.need,
      fits: c.need <= st.free,
      // a button per hand that's free; none free, the first hand still shows, to say why it can't
      hands: (st.free ? usable.filter((s) => !s.item) : usable.slice(0, 1)).map((s) => ({ id: s.id, label: Hands.label(s.id), short: Hands.short(s.id) }))
    }))
  };
}
