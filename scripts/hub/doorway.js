import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Cards } from "../combat/cards.js";
import { L, esc } from "../util.js";

export const MATT_ID = "monks-active-tiles";
export const TAGGER_ID = "tagger";

/**
 * Doorways: a place on the Night City Map that leads into a scene, so players can walk in on their
 * own between sessions (the noodle bar, the fixer's booth, a shop). A doorway is a scene, and
 * where to land in it: a tile (one of Monk's Active Tiles', whose actions then fire: teleport,
 * open a shop, start a conversation) or a Tagger tag. Kept with the place's GM notes:
 * notes[placeKey] = { ..., scene, tile, tag, open }.
 *
 * With a GM online the GM's client moves the character's token onto the landing spot, pulls the
 * player there, and triggers the tile. With no GM (downtime) a player views the scene and moves
 * their own token there if Foundry lets them; tile actions need a GM and wait.
 */
export const Doorway = {
  get matt() {
    return !!game.modules.get(MATT_ID)?.active;
  },

  get tagger() {
    return !!game.modules.get(TAGGER_ID)?.active && typeof globalThis.Tagger?.getByTag === "function";
  },

  /** Is a tile one of Monk's Active Tiles' (has trigger actions)? */
  isActiveTile(tile) {
    const f = tile?.flags?.[MATT_ID];
    return !!f && (f.active !== false) && (f.actions?.length ?? 0) > 0;
  },

  /** A tile's label for the GM's picker: Monk's name for it, else where it is. */
  tileLabel(tile) {
    const f = tile.flags?.[MATT_ID] ?? {};
    const name = f.name || L(`${LANG}.Hub.Door.TileAt`, { x: Math.round(tile.x), y: Math.round(tile.y) });
    return this.isActiveTile(tile) ? `${name} · ${L(`${LANG}.Hub.Door.Actions`, { count: f.actions.length })}` : name;
  },

  /** The tiles of a scene to land on: Monk's first. */
  tilesOf(scene) {
    const tiles = [...(scene?.tiles ?? [])];
    return tiles.sort((a, b) => Number(this.isActiveTile(b)) - Number(this.isActiveTile(a)))
      .map((t) => ({ id: t.id, label: this.tileLabel(t), active: this.isActiveTile(t) }));
  },

  /** Where a doorway lands: { scene, tile (or null), point: { x, y } } in the scene's pixels. */
  resolve(door) {
    const scene = door?.scene ? game.scenes?.get(door.scene) : null;
    if (!scene) return null;
    let tile = door.tile ? scene.tiles?.get?.(door.tile) ?? null : null;
    if (!tile && door.tag && this.tagger) {
      try {
        const found = [globalThis.Tagger.getByTag(door.tag, { sceneId: scene.id })].flat().map((d) => d?.document ?? d).filter(Boolean);
        tile = found.find((d) => d.documentName === "Tile") ?? found[0] ?? null;
      } catch (err) {
        console.warn(`${MODULE_ID} | Tagger lookup for "${door.tag}"`, err);
      }
    }
    const point = tile
      ? { x: tile.x + Math.abs(tile.width) / 2, y: tile.y + Math.abs(tile.height) / 2 }
      : (scene.initial && Number.isFinite(scene.initial.x) ? { x: scene.initial.x, y: scene.initial.y } : { x: (scene.width ?? 0) / 2, y: (scene.height ?? 0) / 2 });
    return { scene, tile, point };
  },

  /* ---------------------------------------- */
  /*  Who can go                              */
  /* ---------------------------------------- */

  /**
   * Can this user walk through a place's doorway now? The place has a doorway open to players,
   * the setting allows travel, and (unless it's "any time") a GM is online.
   * @returns {string|null} null when they can, else why not (a lang key's last part)
   */
  blocked(door, user = game.user) {
    const mode = Settings.get("hubTravel");
    if (!door?.scene || !game.scenes?.get(door.scene)) return "noScene";
    if (user.isGM) return null;
    if (mode === "off" || !door.open) return "closed";
    if (mode === "session" && !Compat.activeGM) return "noGM";
    return null;
  },

  /** The character a user travels as: the one asked for if theirs, else their assigned character. */
  traveler(user, actorId = null) {
    const owns = (a) => a && (user.isGM || a.testUserPermission(user, "OWNER"));
    const asked = actorId ? game.actors.get(actorId) : null;
    if (owns(asked)) return asked;
    if (owns(user.character)) return user.character;
    return game.actors.find((a) => a.type === "character" && !user.isGM && a.testUserPermission(user, "OWNER")) ?? null;
  },

  /* ---------------------------------------- */
  /*  Going                                   */
  /* ---------------------------------------- */

  /**
   * Go through a place's doorway (as a character you own).
   * @param {string} key - the place
   * @param {object} door - its doorway
   * @param {string} [actorId]
   */
  async go(key, door, actorId = null) {
    const why = this.blocked(door);
    if (why) throw new Error(L(`${LANG}.Hub.Door.Blocked.${why}`));
    if (Compat.activeGM) return Socket.request("hubGo", { key, actorId });
    return this._goAlone(door, actorId);
  },

  /** GM side: the token lands, the player is pulled there, the tile's actions run. */
  async _goAsGM({ key, door, actorId }, userId) {
    const user = game.users.get(userId);
    if (!user) throw new Error(L(`${LANG}.Error.NotOwner`));
    const why = this.blocked(door, user);
    if (why) throw new Error(L(`${LANG}.Hub.Door.Blocked.${why}`));
    const actor = this.traveler(user, actorId);
    if (!actor) throw new Error(L(`${LANG}.Hub.Door.NoCharacter`));
    const at = this.resolve(door);
    if (!at) throw new Error(L(`${LANG}.Hub.Door.Blocked.noScene`));
    const token = await this._land(actor, at);
    // Pull them there (the GM going themselves just looks).
    if (user.id === game.user.id) await at.scene.view();
    else game.socket?.emit?.("pullToScene", at.scene.id, user.id);
    // Monk's tile does the rest: its actions run as if the character stepped on it.
    let fired = false;
    if (at.tile && this.matt && this.isActiveTile(at.tile) && typeof at.tile.trigger === "function") {
      try {
        await at.tile.trigger({ tokens: token ? [token] : [], userId: user.id, method: "trigger", pt: at.point });
        fired = true;
      } catch (err) {
        console.warn(`${MODULE_ID} | Monk's Active Tiles trigger at ${at.scene.name}`, err);
      }
    }
    await Cards.post({
      kicker: L(`${LANG}.Hub.Door.Kicker`),
      title: L(`${LANG}.Hub.Door.Went`, { name: esc(actor.name), place: esc(door.name ?? at.scene.name) }),
      img: actor.img,
      tone: "cyan",
      body: `<p>${esc(at.scene.name)}${fired ? ` · ${L(`${LANG}.Hub.Door.Fired`)}` : ""}</p>`,
      whisper: Cards.gms()
    });
    Hooks.callAll(`${MODULE_ID}.hubDoorway`, { key, actor, scene: at.scene, tile: at.tile, token, userId });
    return { scene: at.scene.id, token: token?.id ?? null, fired };
  },

  /**
   * Put a character's token on the landing spot: moved if it's already in that scene, else made
   * from the actor's prototype token. Other scenes' tokens stay where they are.
   */
  async _land(actor, { scene, point }) {
    const tokens = [...(scene.tokens ?? [])];
    const grid = scene.grid?.size ?? scene.dimensions?.size ?? 100;
    const existing = tokens.find((t) => t.actorId === actor.id || t.actor?.id === actor.id);
    const half = (n) => ((Number(n) || 1) * grid) / 2;
    if (existing) {
      const x = Math.round(point.x - half(existing.width));
      const y = Math.round(point.y - half(existing.height));
      await existing.update({ x, y }, { animate: false, teleport: true });
      return existing;
    }
    const proto = typeof actor.getTokenDocument === "function" ? await actor.getTokenDocument() : null;
    const data = proto?.toObject?.() ?? { name: actor.name, actorId: actor.id, actorLink: true, width: 1, height: 1, texture: { src: actor.img } };
    data.x = Math.round(point.x - half(data.width));
    data.y = Math.round(point.y - half(data.height));
    const [made] = await scene.createEmbeddedDocuments("Token", [data]);
    return made ?? null;
  },

  /** No GM online: view the scene, and move or place your own token there if Foundry allows it. */
  async _goAlone(door, actorId) {
    const at = this.resolve(door);
    if (!at) throw new Error(L(`${LANG}.Hub.Door.Blocked.noScene`));
    const actor = this.traveler(game.user, actorId);
    await at.scene.view();
    if (!actor) return { scene: at.scene.id, token: null, fired: false };
    const mine = [...(at.scene.tokens ?? [])].find((t) => t.actorId === actor.id && t.isOwner);
    let token = null;
    try {
      if (mine || game.user.can?.("TOKEN_CREATE")) token = await this._land(actor, at);
    } catch (err) {
      console.warn(`${MODULE_ID} | couldn't place ${actor.name} at ${at.scene.name}`, err);
    }
    if (!token) ui.notifications?.info(L(`${LANG}.Hub.Door.LookOnly`));
    else if (at.tile && this.isActiveTile(at.tile)) ui.notifications?.info(L(`${LANG}.Hub.Door.NoActions`));
    return { scene: at.scene.id, token: token?.id ?? null, fired: false };
  }
};
