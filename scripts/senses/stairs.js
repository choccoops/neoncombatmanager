import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { STAIRS_FLAG, wayTaken, landing, onTile } from "./stairs-data.js";
import { L } from "../util.js";

/**
 * Stairs and ladders at the table (see stairs-data.js).
 *
 * - **Linking**: the GM selects two Tiles and presses the stairs button in the tile controls.
 *   Pressing it again with the same two selected unlinks them. Any tile will do: the art of a
 *   staircase, or a blank one laid over stairs already painted on the map.
 * - **Taking them**: when a token's move ends on a linked tile, having started off it, the
 *   active GM's client puts it in the middle of the other tile once its walk has played. That
 *   costs no movement, whoever it holds comes along, and the view of whoever controls it follows.
 */
export const Stairs = {
  /** Where each token's middle was, to tell stepping onto a tile from standing on it (GM's client). */
  was: new Map(),

  get on() {
    return !!Settings.get("stairs");
  },

  init() {
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-stairs", title: `${LANG}.Stairs.Tool`, icon: "fa-solid fa-stairs", order: 116, visible: !!game.user?.isGM, onClick: () => this.toggle() }
    ], "tiles"));
    Hooks.on("canvasReady", () => this.seeAll());
    Hooks.on("createToken", (doc) => this.see(doc));
    Hooks.on("deleteToken", (doc) => {
      this.was.delete(doc.uuid ?? doc.id);
    });
    Hooks.on("updateToken", (doc, changed, options) => {
      this.onMove(doc, changed, options).catch((err) => console.error(`${MODULE_ID} | stairs`, err));
    });
    Hooks.on("deleteTile", (doc) => {
      this.onTileGone(doc).catch((err) => console.error(`${MODULE_ID} | stairs`, err));
    });
  },

  size: (doc) => doc?.parent?.grid?.size ?? canvas?.dimensions?.size ?? 100,

  centre(doc) {
    const s = this.size(doc);
    return { x: doc.x + ((Number(doc.width) || 1) * s) / 2, y: doc.y + ((Number(doc.height) || 1) * s) / 2 };
  },

  see(doc) {
    this.was.set(doc.uuid ?? doc.id, this.centre(doc));
  },

  seeAll(scene = canvas?.scene) {
    this.was.clear();
    for (const t of scene?.tokens ?? []) this.see(t);
  },

  /** The scene's linked tiles, plain: [{ id, x, y, width, height, to }]. */
  tiles(scene = canvas?.scene) {
    return [...(scene?.tiles ?? [])]
      .filter((t) => t.flags?.[MODULE_ID]?.[STAIRS_FLAG]?.to)
      .map((t) => ({ id: t.id, x: t.x, y: t.y, width: t.width, height: t.height, to: t.flags[MODULE_ID][STAIRS_FLAG].to }));
  },

  linkOf: (tile) => (tile?.document ?? tile)?.flags?.[MODULE_ID]?.[STAIRS_FLAG]?.to ?? null,

  /** GM: link two tiles as the two ends of a way (both directions). */
  async link(a, b) {
    const da = a?.document ?? a;
    const db = b?.document ?? b;
    if (!game.user?.isGM || !da?.id || !db?.id || da.id === db.id) return false;
    // Each end belongs to one way: what either was linked to is let go first.
    for (const d of [da, db]) await this.unlink(d);
    await da.setFlag(MODULE_ID, STAIRS_FLAG, { to: db.id });
    await db.setFlag(MODULE_ID, STAIRS_FLAG, { to: da.id });
    return true;
  },

  /** GM: take a tile, and the other end of its way, out of it. */
  async unlink(tile) {
    const doc = tile?.document ?? tile;
    const to = this.linkOf(doc);
    if (!game.user?.isGM || !to) return false;
    const far = doc.parent?.tiles?.get(to);
    await doc.unsetFlag(MODULE_ID, STAIRS_FLAG);
    if (far && this.linkOf(far) === doc.id) await far.unsetFlag(MODULE_ID, STAIRS_FLAG);
    return true;
  },

  /** The tile tool: two tiles selected are linked, or unlinked when they already are each other's ends. */
  async toggle() {
    if (!game.user?.isGM) return null;
    const picked = canvas?.tiles?.controlled ?? [];
    if (picked.length === 1 && this.linkOf(picked[0])) {
      await this.unlink(picked[0]);
      ui.notifications?.info(L(`${LANG}.Stairs.Unlinked`));
      return false;
    }
    if (picked.length !== 2) {
      ui.notifications?.info(L(`${LANG}.Stairs.Pick`));
      return null;
    }
    const [a, b] = picked;
    if (this.linkOf(a) === b.id && this.linkOf(b) === a.id) {
      await this.unlink(a);
      ui.notifications?.info(L(`${LANG}.Stairs.Unlinked`));
      return false;
    }
    await this.link(a, b);
    ui.notifications?.info(L(`${LANG}.Stairs.Linked`));
    return true;
  },

  async onTileGone(doc) {
    if (!Compat.isActiveGM) return;
    const to = this.linkOf(doc);
    const far = to ? doc.parent?.tiles?.get(to) : null;
    if (far && this.linkOf(far) === doc.id) await far.unsetFlag(MODULE_ID, STAIRS_FLAG);
  },

  /** The token's walk has played (or two seconds have passed, whichever is first). */
  async walked(doc) {
    try {
      const name = doc.object?.animationName;
      const Anim = globalThis.foundry?.canvas?.animation?.CanvasAnimation ?? globalThis.CanvasAnimation;
      const playing = name ? Anim?.getAnimation?.(name)?.promise : null;
      if (playing) await Promise.race([playing, new Promise((r) => setTimeout(r, 2000))]);
    } catch {
      /* no animation to wait for */
    }
  },

  /**
   * Why a token standing where it is would or wouldn't be taken by the stairs, for the console:
   * `game.modules.get("cpr-neon-combat-manager").api.stairs.why(token)`.
   */
  why(token) {
    const doc = token?.document ?? token ?? canvas?.tokens?.controlled?.[0]?.document ?? null;
    if (!doc) return { token: false };
    const s = this.size(doc);
    const size = { w: (Number(doc.width) || 1) * s, h: (Number(doc.height) || 1) * s };
    const tiles = this.tiles(doc.parent);
    const at = this.centre(doc);
    return {
      setting: this.on, activeGM: Compat.activeGM?.name ?? null, thisIsTheActiveGM: Compat.isActiveGM,
      linkedTiles: tiles.length, tokenMiddle: at, tokenSize: size,
      standingOn: tiles.filter((t) => onTile(t, at, size)).map((t) => t.id),
      lastSeenAt: this.was.get(doc.uuid ?? doc.id) ?? null
    };
  },

  /** A token moved: onto the foot of a way, it's put at the other end. */
  async onMove(doc, changed, options = {}) {
    if (!("x" in (changed ?? {}) || "y" in (changed ?? {}))) return;
    const mine = options?.[MODULE_ID] ?? {};
    // Whoever controls a token that took the stairs is shown where it came out.
    if (mine.stairs && doc.object && (doc.object.controlled || (!game.user?.isGM && game.user?.character?.id === doc.actorId))) {
      const c = this.centre(doc);
      canvas.animatePan?.({ x: c.x, y: c.y, duration: 350 });
    }
    if (!Compat.isActiveGM) return;
    const key = doc.uuid ?? doc.id;
    const from = this.was.get(key) ?? null;
    const to = this.centre(doc);
    this.was.set(key, to);
    // Put there by the stairs, carried by whoever holds it, or taken back with Ctrl+Z: it stays where it is.
    if (!this.on || mine.stairs || mine.carried || options?.isUndo) return;
    const s = this.size(doc);
    const size = { w: (Number(doc.width) || 1) * s, h: (Number(doc.height) || 1) * s };
    const way = wayTaken(this.tiles(doc.parent), from, to, size);
    if (!way) return;
    // Let the walk onto the stairs play out first, but never wait on it for long.
    await this.walked(doc);
    const at = landing(way.to, size.w, size.h);
    await doc.update(at, { animate: false, [MODULE_ID]: { free: true, stairs: true } });
  }
};
