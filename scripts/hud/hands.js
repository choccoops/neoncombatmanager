import { MODULE_ID, LANG, NEON_HOME_ID } from "../constants.js";
import { CPR } from "../cpr.js";
import { Settings } from "../settings.js";
import { L, esc } from "../util.js";

const ITEM_PILES_ID = "item-piles";
/** Item types Cyberpunk RED keeps as Owned, Carried or Equipped. */
const EQUIPPABLE = ["armor", "clothing", "cyberdeck", "drug", "gear", "weapon"];
/** Critical Injuries that take a hand away (Cyberpunk RED p.187). */
const LOST_HAND = ["dismembered arm", "dismembered hand"];

/** A hand's id: R and L, then the lower pair (R2, L2) an Artificial Shoulder Mount adds, and so on. */
const slotId = (i) => `${i % 2 ? "L" : "R"}${i < 2 ? "" : Math.floor(i / 2) + 1}`;

const itemPiles = () => (game.modules?.get?.(ITEM_PILES_ID)?.active ? game.itempiles?.API ?? null : null);
const isPile = (actor) => {
  try {
    return !!itemPiles()?.isValidItemPile?.(actor);
  } catch {
    return false;
  }
};

/**
 * Hands: what a character holds in which hand, equipping a Carried weapon into a free one, freeing
 * a hand (back to Carried) and dropping what it holds. Cyberpunk RED keeps only Owned, Carried or
 * Equipped; which hand is this module's, on the item (flags.<module>.hands).
 */
export const Hands = {
  /** Hands an item takes when held: a weapon's Hands Required, one for a shield. */
  need(item) {
    if (item?.type === "armor") return 1;
    const n = Number(item?.system?.handsReq);
    return Number.isFinite(n) ? Math.max(0, n) : 1;
  },

  /** Is this held in the hands when Equipped? Weapons and shields; not cyberweapons or installed upgrades. */
  isHeld(item) {
    if (item?.type !== "weapon" && !(item?.type === "armor" && item.system?.isShield)) return false;
    try {
      return !item.system?.isInstalled;
    } catch {
      return true;
    }
  },

  /**
   * The character's hands: Cyberpunk RED's own count (2, plus "Number of Hands" effects such as an
   * Artificial Shoulder Mount's), and the 2070 Shoulder Mount, which carries no effect, counted as +2.
   * Less the sides a Dismembered Arm or Hand took (the side Neon At Home asked for, else right first).
   * @returns {{ id, lost }[]}
   */
  slots(actor) {
    let total = 2;
    try {
      total = typeof actor?._getHands === "function" ? Number(actor._getHands()) : 2 + (Number(actor?.bonuses?.hands) || 0);
    } catch {
      total = 2;
    }
    if (!Number.isFinite(total) || total < 2) total = 2;
    const items = [...(actor?.items ?? [])];
    const mount = items.find((i) => i.type === "cyberware" && /artificial shoulder mount/i.test(i.name) && CPR.inUse(i));
    const mountHands = mount && !(mount.effects ?? []).some?.((e) => (e.changes ?? []).some((c) => c.key === "bonuses.hands"));
    if (mountHands && total < 4) total += 2;
    const slots = Array.from({ length: total }, (_, i) => ({ id: slotId(i), lost: false }));
    let n = 0;
    for (const inj of items.filter((i) => i.type === "criticalInjury" && LOST_HAND.includes(String(i.name).toLowerCase()))) {
      const flagged = inj.flags?.[NEON_HOME_ID]?.side;
      const side = flagged === "L" || flagged === "R" ? flagged : (n++ % 2 ? "L" : "R");
      const s = slots.find((x) => x.id === side);
      if (s) s.lost = true;
    }
    return slots;
  },

  /**
   * Who holds what: each hand with the item in it, what's held, and what's Carried to equip.
   * Items equipped elsewhere (the sheet) take the first free hands, in the sheet's order.
   */
  state(actor) {
    const slots = this.slots(actor).map((s) => ({ ...s, item: null }));
    const usable = () => slots.filter((s) => !s.lost && !s.item);
    const items = [...(actor?.items ?? [])];
    const equipped = items.filter((i) => this.isHeld(i) && i.system?.equipped === "equipped");
    const held = [];
    // Those placed by this module first, where they were put.
    const placed = equipped.map((item) => ({ item, want: item.flags?.[MODULE_ID]?.hands })).sort((a, b) => (Array.isArray(b.want) ? 1 : 0) - (Array.isArray(a.want) ? 1 : 0));
    for (const { item, want } of placed) {
      const need = this.need(item);
      const free = usable();
      const pick = [];
      for (const id of Array.isArray(want) ? want : []) {
        const s = free.find((x) => x.id === id);
        if (s && pick.length < need) pick.push(s);
      }
      for (const s of free) if (pick.length < need && !pick.includes(s)) pick.push(s);
      for (const s of pick) s.item = item;
      held.push({ item, need, hands: pick.map((s) => s.id), over: pick.length < need });
    }
    const carried = items.filter((i) => this.isHeld(i) && i.type === "weapon" && i.system?.equipped === "carried")
      .sort((a, b) => a.name.localeCompare(b.name)).map((item) => ({ item, need: this.need(item) }));
    const free = slots.filter((s) => !s.lost && !s.item).length;
    return { slots, held, carried, free, total: slots.filter((s) => !s.lost).length };
  },

  /** A hand's name: "Right hand", "Lower left hand"... */
  label(id) {
    const key = { R: "R", L: "L", R2: "R2", L2: "L2" }[id];
    return key ? L(`${LANG}.Hands.Side.${key}`) : L(`${LANG}.Hands.Side.Extra`, { n: id });
  },

  /** A hand's short name, for buttons: "R", "L", "R2"... */
  short(id) {
    const key = `${LANG}.Hands.Short.${id}`;
    const s = game.i18n.localize(key);
    return s && s !== key ? s : id;
  },

  /**
   * Equip a Carried weapon into a hand (and the next free ones, for a two-handed one). With no hand
   * free, nothing changes and the player is told.
   * @param {string} [hand] - the hand to put it in (the first free one if not given)
   * @returns {Promise<boolean>}
   */
  async equip(actor, item, hand = null) {
    if (!actor?.isOwner || !item) return false;
    const st = this.state(actor);
    const need = this.need(item);
    const free = st.slots.filter((s) => !s.lost && !s.item);
    if (free.length < need) {
      ui.notifications.warn(L(`${LANG}.Hands.${need > 1 ? "NeedMore" : "NoneFree"}`, { name: actor.name, item: item.name, need, free: free.length }));
      return false;
    }
    const first = free.find((s) => s.id === hand) ?? free[0];
    const pick = need ? [first, ...free.filter((s) => s !== first)].slice(0, need).map((s) => s.id) : [];
    const updates = [{ _id: item.id, "system.equipped": "equipped", [`flags.${MODULE_ID}.hands`]: pick }];
    for (const inner of this._installed(item)) updates.push({ _id: inner.id, "system.equipped": "equipped" });
    if (item.type === "armor" && typeof actor.updateTrackedArmor === "function") await actor.updateTrackedArmor("shield", item.id);
    await actor.updateEmbeddedDocuments("Item", updates);
    return true;
  },

  /** Free the hands an item is in: it goes back to Carried. */
  async free(actor, item) {
    if (!actor?.isOwner || !item || item.system?.equipped !== "equipped") return false;
    if (item.type === "armor" && item.system?.isTracked && typeof actor.updateTrackedArmor === "function") await actor.updateTrackedArmor("shield");
    const updates = [{ _id: item.id, "system.equipped": "carried", [`flags.${MODULE_ID}.-=hands`]: null }];
    for (const inner of this._installed(item)) updates.push({ _id: inner.id, "system.equipped": "carried" });
    await actor.updateEmbeddedDocuments("Item", updates);
    return true;
  },

  /**
   * Drop it on the ground. Neon At Home does it when it's on (an Item Piles pile with the item's
   * attachments, cleared once it's picked up; otherwise no longer carried). Without it, an Item Piles
   * pile beside the token; without Item Piles, the item stays on the sheet as Owned (not on the
   * character). A chat line says so.
   */
  async drop(actor, item) {
    if (!actor?.isOwner || !item) return false;
    const home = game.modules?.get?.(NEON_HOME_ID);
    if (home?.active && typeof home.api?.drop === "function") {
      await home.api.drop(actor, item.id);
      return true;
    }
    const api = itemPiles();
    const token = actor.isToken ? actor.token?.object : actor.getActiveTokens?.()?.[0] ?? null;
    const scene = token?.document?.parent;
    let piled = false;
    if (api?.createItemPile && scene) {
      const grid = Number(scene.grid?.size ?? globalThis.canvas?.grid?.size) || 100;
      const data = item.toObject();
      delete data._id;
      if (data.system?.equipped) data.system.equipped = "owned";
      data.flags ??= {};
      data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), dropped: true };
      delete data.flags[MODULE_ID].hands;
      try {
        const made = await api.createItemPile({
          position: { x: token.document.x + grid, y: token.document.y },
          sceneId: scene.id,
          items: [data],
          itemPileFlags: { deleteWhenEmpty: true, displayOne: true, showItemName: true }
        });
        if (!made) throw new Error("Item Piles made no pile");
        await actor.deleteEmbeddedDocuments("Item", [item.id]);
        piled = true;
      } catch (err) {
        console.warn(`${MODULE_ID} | Item Piles couldn't take ${item.name}`, err);
      }
    }
    if (!piled) {
      const updates = [{ _id: item.id, "system.equipped": "owned", [`flags.${MODULE_ID}.-=hands`]: null }];
      for (const inner of this._installed(item)) updates.push({ _id: inner.id, "system.equipped": "owned" });
      await actor.updateEmbeddedDocuments("Item", updates);
    }
    const { Cards } = await import("../combat/cards.js");
    await Cards.post({
      actor,
      kicker: L(`${LANG}.Hands.Title`),
      title: esc(item.name),
      img: item.img,
      body: `<p>${L(`${LANG}.Hands.${piled ? "Piled" : "Owned"}`, { name: esc(actor.name), item: esc(item.name) })}</p>`,
      tone: "yellow"
    });
    return true;
  },

  _installed(item) {
    if (typeof item?.recursiveGetAllInstalledItems !== "function" || !item.system?.installedItems?.list?.length) return [];
    return item.recursiveGetAllInstalledItems().filter((i) => EQUIPPABLE.includes(i.type));
  },

  /* ---------------------------------------- */
  /*  Picking things up                       */
  /* ---------------------------------------- */

  /**
   * Item data going onto a character, as Carried: what's equippable lands in hand's reach, not in
   * the stash. Returns whether it changed anything.
   */
  carry(data) {
    if (!data || !EQUIPPABLE.includes(data.type)) return false;
    data.system ??= {};
    if (data.system.equipped === "equipped") return false;
    data.system.equipped = "carried";
    if (data.flags?.[MODULE_ID]) {
      delete data.flags[MODULE_ID].hands;
      delete data.flags[MODULE_ID].dropped;
    }
    return true;
  },

  /** A character (or mook) picking up, not a pile or a container. */
  _picker(actor) {
    return CPR.isMeat(actor) && !isPile(actor);
  },

  /** Items taken out of an Item Piles pile go onto the character as Carried. */
  onPileTransfer(source, target, targetUpdates) {
    if (!Settings.get("pickupCarried") || !isPile(source) || !this._picker(target)) return;
    for (const data of targetUpdates?.itemsToCreate ?? []) this.carry(data);
  },

  /** Without Item Piles, the next item dropped on this character's sheet or token is a pickup. */
  _expect: null,
  expect(actor) {
    this._expect = actor ? { id: actor.id, until: Date.now() + 3000 } : null;
  },

  /**
   * An item being made on a character: Carried if it was dropped before (by this module or Neon At
   * Home), or (without Item Piles) dropped on the sheet or the token just now.
   */
  onPreCreate(item, data, options, userId) {
    if (userId !== game.user?.id || !Settings.get("pickupCarried")) return;
    const actor = item?.parent;
    if (!actor || !this._picker(actor)) return;
    const dropped = !!(data?.flags?.[MODULE_ID]?.dropped || data?.flags?.[NEON_HOME_ID]?.dropped);
    const ex = this._expect;
    const expected = !!ex && ex.id === actor.id && Date.now() < ex.until && !itemPiles();
    if (!dropped && !expected) return;
    const next = foundry.utils.deepClone({ type: item.type ?? data.type, system: { equipped: item.system?.equipped ?? data.system?.equipped }, flags: data.flags ?? {} });
    if (!this.carry(next)) return;
    const upd = { "system.equipped": "carried" };
    if (data?.flags?.[MODULE_ID]?.dropped) upd[`flags.${MODULE_ID}.-=dropped`] = null;
    item.updateSource?.(upd);
  },

  /** An Item dropped on a character token on the canvas (no Item Piles): it goes to them, Carried. */
  async onCanvasDrop(canvas, data) {
    if (data?.type !== "Item" || itemPiles() || !Settings.get("pickupCarried")) return true;
    const token = (canvas?.tokens?.placeables ?? []).find((t) => t.actor?.isOwner && this._picker(t.actor) && t.bounds?.contains?.(data.x, data.y));
    if (!token) return true;
    (async () => {
      const src = await fromUuid(data.uuid);
      if (!src || src.parent === token.actor) return;
      const obj = src.toObject();
      delete obj._id;
      this.carry(obj);
      await token.actor.createEmbeddedDocuments("Item", [obj]);
      ui.notifications.info(L(`${LANG}.Hands.PickedUp`, { name: token.actor.name, item: src.name }));
    })().catch((err) => console.error(`${MODULE_ID} | pickup`, err));
    return false;
  },

  init() {
    Hooks.on("item-piles-preTransferItems", (source, sourceUpdates, target, targetUpdates) => this.onPileTransfer(source, target, targetUpdates));
    Hooks.on("item-piles-preTransferAllItems", (source, sourceUpdates, target, targetUpdates) => this.onPileTransfer(source, target, targetUpdates));
    Hooks.on("preCreateItem", (item, data, options, userId) => this.onPreCreate(item, data, options, userId));
    Hooks.on("dropActorSheetData", (actor, sheet, data) => {
      if (data?.type === "Item" && this._picker(actor)) this.expect(actor);
    });
    Hooks.on("dropCanvasData", (canvas, data) => this.onCanvasDrop(canvas, data));
  }
};
