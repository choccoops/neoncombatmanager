import { LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Conditions } from "../conditions/engine.js";
import { readout } from "./vitals.js";
import { L } from "../util.js";

const { deepClone } = foundry.utils;

/**
 * Biomon Links: player characters who choose to share their Biomonitor vitals as a group.
 * Stored in a world setting { [linkId]: { id, name, members: [actorId] } }; a character is in one
 * link at a time. Players join and leave with their own characters (it's their vitals), through
 * the GM, who writes the setting.
 */
export const Links = {
  all() {
    return Object.values(Settings.get("vitalLinks") ?? {}).filter((l) => l?.id);
  },

  get(id) {
    return this.all().find((l) => l.id === id) ?? null;
  },

  /** The link a character is in, or null. */
  of(actorOrId) {
    const id = actorOrId?.id ?? actorOrId;
    return this.all().find((l) => l.members.includes(id)) ?? null;
  },

  /** Characters this user plays (owned, player characters). */
  mine(user = game.user) {
    return game.actors.filter((a) => a.type === "character" && (user.isGM ? a.hasPlayerOwner : a.testUserPermission(user, "OWNER")));
  },

  /** Links this user sees: all for the GM, else those with one of their characters. */
  visible(user = game.user) {
    if (user.isGM) return this.all();
    const mine = new Set(this.mine(user).map((a) => a.id));
    return this.all().filter((l) => l.members.some((m) => mine.has(m)));
  },

  /** Members of a link that still exist, as actors. */
  members(link) {
    return (link?.members ?? []).map((id) => game.actors.get(id)).filter(Boolean);
  },

  /** Users who watch a link: owners of its members, and the GMs. */
  watchers(link) {
    const members = this.members(link);
    return game.users.filter((u) => u.isGM || members.some((a) => a.testUserPermission(u, "OWNER")));
  },

  /** Has this character a Biomonitor installed? */
  hasImplant(actor) {
    return CPR.hasGear(actor, ["Biomonitor"]);
  },

  /** The vitals readout for a character. */
  vitals(actor) {
    const conditions = Conditions.active(actor).map((c) => c.id);
    const criticals = [
      ...(actor.items ?? []).filter((i) => i.type === "criticalInjury").map((i) => i.name),
      ...Conditions.active(actor).filter((c) => c.category === "critical" && !(actor.items ?? []).some((i) => i.type === "criticalInjury" && i.name === c.critical?.name)).map((c) => c.name)
    ];
    const { value, max } = CPR.hp(actor);
    return readout({ hp: value, max, wound: CPR.woundState(actor), deathSave: CPR.deathSave(actor).penalty, conditions, criticals: [...new Set(criticals)], implant: this.hasImplant(actor) });
  },

  /** Icons for the conditions on a readout (critical injuries and call-outs). */
  icons(actor) {
    return Conditions.active(actor)
      .filter((c) => ["critical", "hazard"].includes(c.category) || ["unconscious", "sleep", "stabilized", "prone", "grappled"].includes(c.id))
      .map((c) => ({ img: c.img, name: c.name, category: c.category }));
  },

  /* ---------------------------------------- */
  /*  Changes (through the GM)                */
  /* ---------------------------------------- */

  /** Start a link with one of your characters in it. */
  create(name, actor) {
    return Socket.request("linkCreate", { name: String(name ?? "").trim(), actorId: actor?.id ?? null });
  },

  /** Put your character in a link (leaving any other). */
  join(linkId, actor) {
    return Socket.request("linkJoin", { linkId, actorId: actor.id });
  },

  leave(actor) {
    return Socket.request("linkLeave", { actorId: actor.id });
  },

  /** GM: rename or delete a link. */
  rename(linkId, name) {
    return Socket.request("linkRename", { linkId, name });
  },

  remove(linkId) {
    return Socket.request("linkRemove", { linkId });
  },

  /** May this user act for this character? (owner, or the GM) */
  _allowed(actorId, userId) {
    const user = game.users.get(userId);
    const actor = game.actors.get(actorId);
    return !!user && !!actor && (user.isGM || actor.testUserPermission(user, "OWNER"));
  },

  _check(actorId) {
    if (Settings.get("linkNeedsImplant") && !this.hasImplant(game.actors.get(actorId))) {
      throw new Error(L(`${LANG}.Biomon.NeedsImplant`, { name: game.actors.get(actorId)?.name ?? "" }));
    }
  },

  async _write(fn) {
    const links = deepClone(Settings.get("vitalLinks") ?? {});
    fn(links);
    // Empty links go.
    for (const [id, l] of Object.entries(links)) if (!l.members?.length) delete links[id];
    await Settings.set("vitalLinks", links);
  },

  registerSocket() {
    Socket.on("linkCreate", async ({ name, actorId }, userId) => {
      if (actorId && !this._allowed(actorId, userId)) throw new Error(L(`${LANG}.Error.NotOwner`));
      if (!actorId && !game.users.get(userId)?.isGM) throw new Error(L(`${LANG}.Error.NotOwner`));
      if (actorId) this._check(actorId);
      const id = foundry.utils.randomID(12);
      await this._write((links) => {
        for (const l of Object.values(links)) l.members = l.members.filter((m) => m !== actorId);
        links[id] = { id, name: name || L(`${LANG}.Biomon.DefaultName`), members: actorId ? [actorId] : [] };
      });
      return id;
    });
    Socket.on("linkJoin", async ({ linkId, actorId }, userId) => {
      if (!this._allowed(actorId, userId)) throw new Error(L(`${LANG}.Error.NotOwner`));
      this._check(actorId);
      await this._write((links) => {
        if (!links[linkId]) throw new Error(L(`${LANG}.Biomon.NoLink`));
        for (const l of Object.values(links)) l.members = l.members.filter((m) => m !== actorId);
        links[linkId].members.push(actorId);
      });
      return true;
    });
    Socket.on("linkLeave", async ({ actorId }, userId) => {
      if (!this._allowed(actorId, userId)) throw new Error(L(`${LANG}.Error.NotOwner`));
      await this._write((links) => {
        for (const l of Object.values(links)) l.members = l.members.filter((m) => m !== actorId);
      });
      return true;
    });
    Socket.on("linkRename", async ({ linkId, name }, userId) => {
      if (!game.users.get(userId)?.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
      await this._write((links) => {
        if (links[linkId] && String(name).trim()) links[linkId].name = String(name).trim();
      });
      return true;
    });
    Socket.on("linkRemove", async ({ linkId }, userId) => {
      if (!game.users.get(userId)?.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
      await this._write((links) => delete links[linkId]);
      return true;
    });
  }
};
