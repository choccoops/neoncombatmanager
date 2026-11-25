import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { STAIRS_FLAG, KINDS, KIND_ICON, kindOf, wayAt, wayTaken, landing, onTile } from "./stairs-data.js";
import { Levels } from "./levels.js";
import { L, esc, debounce } from "../util.js";

/**
 * Ways at the table (see stairs-data.js): stairs, ladders and doors.
 *
 * - **Linking**: the GM selects two Tiles and presses the stairs, ladder or door button in the
 *   tile controls. Pressing one again with the same two selected (or one linked tile) unlinks.
 *   Any tile will do: the art of a staircase or a door, or a blank one laid over the map's own.
 * - **Taking one**: whoever controls a token standing on an end gets a prompt at the foot of
 *   the screen ("Stairs · to Upper floor · Take them") and the same entry on the Action HUD.
 *   Choosing it asks the GM's client to put the token on the other end. Nobody is taken anywhere
 *   without choosing to be. (The setting can make it automatic on stepping on, as it was.)
 * - The trip costs no movement, whoever the token holds in a Grab comes along, and the view of
 *   whoever controls it follows.
 *
 * "Standing on" is worked out on each player's own client from where their token is now, so it
 * doesn't depend on anyone having seen where the token came from.
 */
const PROMPT_ID = "ncm-way";

export const Stairs = {
  /** Where each token's middle was, for the automatic mode (GM's client). */
  was: new Map(),
  /** Others with something to offer a token where it stands (climbing): (token) => { key, icon, name, text, buttons } | null. */
  providers: [],
  /** The prompt this client waved away, until its token moves: "token:tile:x:y". */
  dismissed: null,

  get on() {
    return !!Settings.get("stairs");
  },

  /** Ask before taking a way (the default), or take it on stepping on. */
  get asks() {
    return Settings.get("stairsAsk") !== false;
  },

  init() {
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, KINDS.map((kind, i) => (
      { name: `ncm-way-${kind}`, title: `${LANG}.Stairs.Tool.${kind}`, icon: KIND_ICON[kind], order: 116 + i, visible: !!game.user?.isGM, onClick: () => this.toggle(kind) }
    )), "tiles"));
    Socket.on("wayTake", (data, userId) => this._take(data, userId));
    const soon = debounce(() => this.offer(), 150);
    for (const h of ["canvasReady", "controlToken", "updateTile", "deleteTile", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    Hooks.on("canvasReady", () => this.seeAll());
    Hooks.on("canvasTearDown", () => this.hide());
    Hooks.on("createToken", (doc) => this.see(doc));
    Hooks.on("deleteToken", (doc) => {
      this.was.delete(doc.uuid ?? doc.id);
      soon();
    });
    Hooks.on("updateToken", (doc, changed, options) => {
      if ("x" in (changed ?? {}) || "y" in (changed ?? {})) {
        // Ask once the walk has played, so the prompt comes up as the token arrives.
        this.walked(doc).then(() => soon());
      }
      this.onMove(doc, changed, options).catch((err) => console.error(`${MODULE_ID} | stairs`, err));
    });
    Hooks.on("deleteTile", (doc) => {
      this.onTileGone(doc).catch((err) => console.error(`${MODULE_ID} | stairs`, err));
    });
  },

  grid: (doc) => doc?.parent?.grid?.size ?? canvas?.dimensions?.size ?? 100,

  sizeOf(doc) {
    const s = this.grid(doc);
    return { w: (Number(doc.width) || 1) * s, h: (Number(doc.height) || 1) * s };
  },

  centre(doc) {
    const { w, h } = this.sizeOf(doc);
    return { x: doc.x + w / 2, y: doc.y + h / 2 };
  },

  see(doc) {
    this.was.set(doc.uuid ?? doc.id, this.centre(doc));
  },

  seeAll(scene = canvas?.scene) {
    this.was.clear();
    for (const t of scene?.tokens ?? []) this.see(t);
  },

  /** The scene's linked tiles, plain: [{ id, x, y, width, height (px), to, kind, rise (a ladder's height in m/yds), end }]. */
  tiles(scene = canvas?.scene) {
    return [...(scene?.tiles ?? [])]
      .filter((t) => t.flags?.[MODULE_ID]?.[STAIRS_FLAG]?.to)
      .map((t) => ({ id: t.id, x: t.x, y: t.y, width: t.width, height: t.height, to: t.flags[MODULE_ID][STAIRS_FLAG].to, kind: kindOf(t.flags[MODULE_ID][STAIRS_FLAG].kind), rise: Number(t.flags[MODULE_ID][STAIRS_FLAG].height) || 0, end: t.flags[MODULE_ID][STAIRS_FLAG].end ?? null }));
  },

  linkOf: (tile) => (tile?.document ?? tile)?.flags?.[MODULE_ID]?.[STAIRS_FLAG]?.to ?? null,

  /** The way a token can take from where it stands: { from, to } (plain tiles) or null. */
  wayFor(token) {
    const doc = token?.document ?? token;
    if (!this.on || !doc?.parent) return null;
    return wayAt(this.tiles(doc.parent), this.centre(doc), this.sizeOf(doc));
  },

  /** Where a way comes out, in words: the name of the floor its far end is on, if it's on one. */
  toward(way, scene = canvas?.scene) {
    const mid = { x: way.to.x + way.to.width / 2, y: way.to.y + way.to.height / 2 };
    const floor = Levels.place(mid, scene)?.floor ?? null;
    const region = floor ? [...(scene?.regions ?? [])].find((r) => r.id === floor.region) : null;
    return region?.name ?? "";
  },

  label(way, scene = canvas?.scene) {
    const to = this.toward(way, scene);
    const kind = L(`${LANG}.Stairs.Kind.${way.from.kind}`);
    return to ? L(`${LANG}.Stairs.To`, { kind, to }) : kind;
  },

  /* ---------------------------------------- */
  /*  The GM's links                          */
  /* ---------------------------------------- */

  /** GM: link two tiles as the two ends of a way (both directions). kind: stairs, ladder or door. */
  async link(a, b, kind = "stairs", { height = 0 } = {}) {
    const da = a?.document ?? a;
    const db = b?.document ?? b;
    if (!game.user?.isGM || !da?.id || !db?.id || da.id === db.id) return false;
    // Each end belongs to one way: what either was linked to is let go first.
    for (const d of [da, db]) await this.unlink(d);
    // A ladder with a height is climbed, not just taken: the first tile is its foot, the second its head.
    const high = kindOf(kind) === "ladder" && Number(height) > 0 ? { height: Math.round(Number(height) * 10) / 10 } : {};
    await da.setFlag(MODULE_ID, STAIRS_FLAG, { to: db.id, kind: kindOf(kind), ...high, ...(high.height ? { end: "foot" } : {}) });
    await db.setFlag(MODULE_ID, STAIRS_FLAG, { to: da.id, kind: kindOf(kind), ...high, ...(high.height ? { end: "head" } : {}) });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
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
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return true;
  },

  /** A tile tool: two tiles selected are linked as that kind of way, or unlinked when they already are each other's ends. */
  async toggle(kind = "stairs") {
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
    const same = kindOf((a.document ?? a).flags?.[MODULE_ID]?.[STAIRS_FLAG]?.kind) === kind;
    if (this.linkOf(a) === b.id && this.linkOf(b) === a.id && same) {
      await this.unlink(a);
      ui.notifications?.info(L(`${LANG}.Stairs.Unlinked`));
      return false;
    }
    const height = kind === "ladder" ? await this.askHeight() : 0;
    if (height === null) return null;
    await this.link(a, b, kind, { height });
    ui.notifications?.info(L(`${LANG}.Stairs.Linked`, { kind: L(`${LANG}.Stairs.Kind.${kind}`) }));
    return true;
  },

  /** How high a ladder is (0: it's taken in one go, like stairs). Null when the window is closed. */
  async askHeight() {
    const unit = esc(canvas?.scene?.grid?.units || "m");
    const content = `<div class="ncm-levels"><p class="ncm-hint">${L(`${LANG}.Stairs.LadderHint`)}</p><div class="ncm-grid">`
      + `<label>${L(`${LANG}.Stairs.LadderHeight`, { unit })}<input type="number" name="height" min="0" step="0.5" placeholder="0"></label></div></div>`;
    const got = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Stairs.Tool.ladder`) }, classes: ["neon-combat", "ncm-dialog"], content,
      ok: { label: L(`${LANG}.Levels.Save`), callback: (event, button) => Number(button.form.elements.height.value) || 0 },
      rejectClose: false
    }).catch(() => null);
    return got === null || got === undefined ? null : got;
  },

  /** Is a way climbed a stretch at a time (a ladder with a height) and so not simply taken? */
  climbed: (way) => way?.from?.kind === "ladder" && way.from.rise > 0 && Settings.get("climbing") !== false,

  async onTileGone(doc) {
    if (!Compat.isActiveGM) return;
    const to = this.linkOf(doc);
    const far = to ? doc.parent?.tiles?.get(to) : null;
    if (far && this.linkOf(far) === doc.id) await far.unsetFlag(MODULE_ID, STAIRS_FLAG);
  },

  /* ---------------------------------------- */
  /*  Asking, and taking                      */
  /* ---------------------------------------- */

  /** The tokens this client speaks for right now: the ones it has selected and owns. */
  mine() {
    return (canvas?.tokens?.controlled ?? []).filter((t) => t.isOwner || game.user?.isGM);
  },

  /** What this client could be asked: { token, way } for the first of its tokens standing on a way that's simply taken. */
  asking() {
    if (!this.on || !canvas?.ready) return null;
    for (const token of this.mine()) {
      const way = this.wayFor(token);
      if (way && !this.climbed(way)) return { token, way };
    }
    return null;
  },

  /** The prompt to show: { key, icon, name, text, buttons: [{ label, run, quiet }] } or null. Climbing first, then a way to take. */
  prompt() {
    if (!this.on || !canvas?.ready) return null;
    for (const token of this.mine()) {
      for (const provide of this.providers) {
        const p = provide(token);
        if (p) return p;
      }
    }
    const ask = this.asks ? this.asking() : null;
    if (!ask) return null;
    const kind = ask.way.from.kind;
    return {
      key: `${ask.token.id}:${ask.way.from.id}:${ask.token.document.x}:${ask.token.document.y}`,
      icon: KIND_ICON[kind], name: ask.token.name ?? "", text: this.label(ask.way, ask.token.document.parent),
      buttons: [{ label: L(`${LANG}.Stairs.Take.${kind}`), run: () => this.takeAll(ask.way.from.id) }]
    };
  },

  hide() {
    document.getElementById(PROMPT_ID)?.remove();
  },

  /** Put up (or take down) the prompt for the token this client has on a way or a climb. */
  offer() {
    const p = this.prompt();
    if (!p || p.key === this.dismissed) {
      if (!p) this.dismissed = null;
      this.hide();
      return null;
    }
    this.dismissed = null;
    this.hide();
    const el = document.createElement("div");
    el.id = PROMPT_ID;
    el.className = "neon-combat ncm-way";
    el.innerHTML = `<i class="${p.icon}"></i>`
      + `<span class="ncm-way-text"><b>${esc(p.name)}</b> · ${esc(p.text)}</span>`
      + p.buttons.map((b, n) => `<button type="button" data-way="go" data-n="${n}"${b.quiet ? ' class="is-quiet"' : ""}>${esc(b.label)}</button>`).join("")
      + `<button type="button" data-way="stay" aria-label="${L(`${LANG}.Stairs.Stay`)}" data-tooltip="${L(`${LANG}.Stairs.Stay`)}"><i class="fa-solid fa-xmark"></i></button>`;
    for (const btn of el.querySelectorAll("[data-way=go]")) {
      btn.addEventListener("click", () => {
        this.hide();
        Promise.resolve(p.buttons[Number(btn.dataset.n)].run()).then(() => this.offer()).catch((err) => ui.notifications?.error(err.message));
      });
    }
    el.querySelector("[data-way=stay]").addEventListener("click", () => {
      this.dismissed = p.key;
      this.hide();
    });
    document.body.appendChild(el);
    return p;
  },

  /** Everyone this client has selected who stands on that tile takes the way. */
  async takeAll(tileId) {
    let taken = 0;
    for (const token of this.mine()) {
      if (this.wayFor(token)?.from.id !== tileId) continue;
      if (await this.take(token)) taken += 1;
    }
    return taken;
  },

  /** Take the way a token stands on (through the GM's client). */
  async take(token) {
    const doc = token?.document ?? token;
    const way = this.wayFor(doc);
    if (!way) return false;
    return Socket.request("wayTake", { scene: doc.parent?.id, token: doc.id, tile: way.from.id });
  },

  /** GM's client: put a token on the far end of the way it stands on, for whoever may move it. */
  async _take({ scene, token, tile }, userId) {
    const sc = game.scenes?.get?.(scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(token);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!this.on || !doc || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return false;
    const way = wayAt(this.tiles(sc), this.centre(doc), this.sizeOf(doc));
    // A ladder with a height is climbed (scripts/senses/climb.js), not taken in one go.
    if (!way || (tile && way.from.id !== tile) || this.climbed(way)) return false;
    return this._move(doc, way);
  },

  async _move(doc, way) {
    const { w, h } = this.sizeOf(doc);
    await doc.update(landing(way.to, w, h), { animate: false, [MODULE_ID]: { free: true, stairs: true } });
    return true;
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

  /** A token moved: the view follows one that took a way; in the automatic mode, stepping on takes it. */
  async onMove(doc, changed, options = {}) {
    if (!("x" in (changed ?? {}) || "y" in (changed ?? {}))) return;
    const mine = options?.[MODULE_ID] ?? {};
    // Whoever controls a token that took a way is shown where it came out.
    if (mine.stairs && doc.object && (doc.object.controlled || (!game.user?.isGM && game.user?.character?.id === doc.actorId))) {
      const c = this.centre(doc);
      canvas.animatePan?.({ x: c.x, y: c.y, duration: 350 });
    }
    if (!Compat.isActiveGM) return;
    const key = doc.uuid ?? doc.id;
    const from = this.was.get(key) ?? null;
    const to = this.centre(doc);
    this.was.set(key, to);
    // Asked for, not automatic; or put there by a way, carried by whoever holds it, or taken back with Ctrl+Z.
    if (!this.on || this.asks || mine.stairs || mine.carried || options?.isUndo) return;
    const way = wayTaken(this.tiles(doc.parent), from, to, this.sizeOf(doc));
    if (!way || this.climbed(way)) return;
    await this.walked(doc);
    await this._move(doc, way);
  },

  /* ---------------------------------------- */
  /*  The Action HUD, and the console         */
  /* ---------------------------------------- */

  entries(actor, token) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    const way = tok ? this.wayFor(tok) : null;
    if (!way || this.climbed(way)) return [];
    return [{ key: `way:${way.from.id}`, label: L(`${LANG}.Stairs.Take.${way.from.kind}`), sub: this.toward(way, tok.document?.parent), icon: KIND_ICON[way.from.kind], alert: true }];
  },

  /**
   * What the ways see for a token, for the console:
   * `game.modules.get("cpr-neon-combat-manager").api.stairs.why(token)`.
   */
  why(token) {
    const doc = token?.document ?? token ?? canvas?.tokens?.controlled?.[0]?.document ?? null;
    if (!doc) return { token: false };
    const size = this.sizeOf(doc);
    const tiles = this.tiles(doc.parent);
    const at = this.centre(doc);
    return {
      setting: this.on, asks: this.asks, activeGM: Compat.activeGM?.name ?? null, thisIsTheActiveGM: Compat.isActiveGM,
      linkedTiles: tiles.length, tokenMiddle: at, tokenSize: size,
      standingOn: tiles.filter((t) => onTile(t, at, size)).map((t) => `${t.id} (${t.kind})`),
      way: wayAt(tiles, at, size)
    };
  }
};
