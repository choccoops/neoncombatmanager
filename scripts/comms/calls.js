import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Messenger } from "./messenger.js";
import { L, esc } from "../util.js";

const { deepClone } = foundry.utils;

/** How long an ended call is kept (for windows to show "call ended"), in ms. */
const KEEP_ENDED = 10 * 60 * 1000;

/** Comms Jam (a quickhack): no calls in or out. */
const jammed = (actor) => !!actor?.statuses?.has?.("qhCommsJam");

/* -------------------------------------------- */
/*  Pure call rules (tested)                    */
/* -------------------------------------------- */

/** Participant states: ringing, joined, declined, missed, nosignal, nodevice, left, cancelled. */
export const LIVE = ["ringing", "joined"];

/**
 * What a call is after a change: active once two people are on it; ended when fewer than two
 * are on and no one is still ringing, or no one is left on it (an active call waiting on someone
 * just added stays up).
 * @returns {object} the call with status (and connectedAt / endedAt) set
 */
export function settle(call, now = Date.now()) {
  const joined = call.participants.filter((p) => p.state === "joined").length;
  const ringing = call.participants.filter((p) => p.state === "ringing").length;
  if (call.status === "ended") return call;
  if (joined >= 2) {
    call.status = "active";
    call.connectedAt ??= now;
  } else if (!ringing || joined === 0) {
    call.status = "ended";
    call.endedAt = now;
    // Nobody left to talk to: stop ringing the rest.
    for (const p of call.participants) if (p.state === "ringing") p.state = "cancelled";
  }
  return call;
}

/** A participant entry from a call target: an actor or a messenger contact. */
export function participant(target, id) {
  const actor = target.actorId ? game.actors.get(target.actorId) : null;
  return {
    id,
    type: target.type ?? (target.contactId ? "contact" : "actor"),
    actorId: actor?.id ?? null,
    contactId: target.contactId ?? null,
    source: target.source ?? null,
    name: target.name || actor?.name || "Unknown",
    img: target.img || actor?.img || "icons/svg/mystery-man.svg",
    state: "ringing"
  };
}

/**
 * Holocalls: characters (and the GM's NPCs, anywhere in Night City) on a call together, talking
 * in blue. Calls live in a world setting the GM writes { [callId]: call }; every client reacts to
 * it: callees get the incoming-call prompt, people on the call get the call window, and messages
 * are chat messages whispered to everyone on the call.
 */
export const Calls = {
  /** Ring timers (GM). */
  _timers: new Map(),

  all() {
    return Object.values(Settings.get("holocalls") ?? {}).filter((c) => c?.id);
  },

  get(id) {
    return this.all().find((c) => c.id === id) ?? null;
  },

  live() {
    return this.all().filter((c) => c.status !== "ended");
  },

  /**
   * Users who answer for a participant: the active players who own its character; the GM for
   * NPCs, messenger contacts, and characters whose players are away.
   */
  answerers(p) {
    const actor = p?.actorId ? game.actors.get(p.actorId) : null;
    if (actor) {
      const owners = game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
      if (owners.length) return owners;
    }
    return game.users.filter((u) => u.isGM && u.active);
  },

  /** Can this user speak (and hang up) for a participant? */
  speaksFor(p, user = game.user) {
    if (user.isGM) return true;
    const actor = p?.actorId ? game.actors.get(p.actorId) : null;
    return !!actor?.testUserPermission(user, "OWNER");
  },

  /** Is this user part of a call (on it, ringing on it, or the GM)? */
  involved(call, user = game.user) {
    if (!call) return false;
    if (user.isGM) return true;
    return call.participants.some((p) => ["joined", "ringing"].includes(p.state) && this.speaksFor(p, user));
  },

  /** Users who receive a call's messages: everyone answering for a joined participant, and the GMs. */
  audience(call) {
    const ids = new Set(game.users.filter((u) => u.isGM).map((u) => u.id));
    for (const p of call.participants.filter((x) => x.state === "joined")) {
      for (const u of game.users.filter((x) => !x.isGM && this.speaksFor(p, x))) ids.add(u.id);
    }
    return [...ids];
  },

  /** The scene this client is in, for the dead-zone check. */
  get here() {
    return game.user.viewedScene ? game.scenes.get(game.user.viewedScene) : canvas?.scene ?? null;
  },

  /* ---------------------------------------- */
  /*  Client actions                          */
  /* ---------------------------------------- */

  /**
   * Place a call.
   * @param {object} from - who's calling: { actorId } or (GM) { contactId, source, name, img }
   * @param {object[]} targets - { actorId } or messenger contacts ({ contactId, source, name, img, actorId? })
   * @returns {Promise<string>} the call id
   */
  async place(from, targets) {
    if (!game.user.isGM && Messenger.deadZone(this.here)) throw new Error(L(`${LANG}.Holocall.NoSignalHere`));
    const caller = from?.actorId ? game.actors.get(from.actorId) : null;
    if (Settings.get("callNeedsAgent") && caller && !Messenger.hasAgent(caller)) throw new Error(L(`${LANG}.Holocall.NoAgent`, { name: caller.name }));
    if (jammed(caller)) throw new Error(L(`${LANG}.Holocall.Jammed`, { name: caller.name }));
    if (!targets?.length) throw new Error(L(`${LANG}.Holocall.NoOne`));
    return Socket.request("callPlace", { from, targets });
  },

  async answer(callId, pid) {
    // A callee in a dead zone gets no signal.
    if (!game.user.isGM && Messenger.deadZone(this.here)) {
      await this.decline(callId, pid, "nosignal");
      throw new Error(L(`${LANG}.Holocall.NoSignalHere`));
    }
    const p = this.get(callId)?.participants.find((x) => x.id === pid);
    if (jammed(p?.actorId ? game.actors.get(p.actorId) : null)) {
      await this.decline(callId, pid, "nosignal");
      throw new Error(L(`${LANG}.Holocall.Jammed`, { name: p.name }));
    }
    return Socket.request("callAnswer", { callId, pid });
  },

  decline(callId, pid, reason = "declined") {
    return Socket.request("callDecline", { callId, pid, reason });
  },

  /** Leave a call (everyone this user speaks for on it). */
  hangUp(callId) {
    const call = this.get(callId);
    // Players hang up their own characters; the GM hangs up the NPCs and contacts they voice.
    const mine = (p) => (game.user.isGM ? this._gmOnly(p) : this.speaksFor(p));
    const pids = (call?.participants ?? []).filter((p) => LIVE.includes(p.state) && mine(p)).map((p) => p.id);
    return Socket.request("callLeave", { callId, pids });
  },

  /** GM: end a call for everyone. */
  end(callId) {
    return Socket.request("callEnd", { callId });
  },

  /** Add people to a call. */
  invite(callId, targets) {
    return Socket.request("callInvite", { callId, targets });
  },

  /** Say something on a call as one of its participants. */
  async say(callId, pid, text) {
    const call = this.get(callId);
    const p = call?.participants.find((x) => x.id === pid);
    const body = String(text ?? "").trim();
    if (!call || call.status === "ended" || !p || p.state !== "joined" || !body || !this.speaksFor(p)) return null;
    const actor = p.actorId ? game.actors.get(p.actorId) : null;
    if (jammed(actor)) {
      ui.notifications?.warn(L(`${LANG}.Holocall.Jammed`, { name: actor.name }));
      return null;
    }
    const content = `<div class="ncm-holo-line"><span class="ncm-holo-tag">${esc(L(`${LANG}.Holocall.Tag`))}</span><p>${esc(body).replace(/\n/g, "<br>")}</p></div>`;
    return ChatMessage.create({
      content,
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: p.name },
      whisper: this.audience(call),
      flags: { [MODULE_ID]: { holocall: call.id, participant: p.id, img: p.img, name: p.name } }
    });
  },

  /** Who each call was last spoken as on this client: callId -> participant id. */
  _voice: new Map(),

  /**
   * Live calls this user talks on, most recent first: for a player, calls with one of their
   * characters on the line; for the GM, calls with an NPC or contact they voice on the line, or
   * that they placed.
   */
  mine(user = game.user) {
    const voices = (call) => call.participants.some((p) => p.state === "joined" && (user.isGM ? this._gmOnly(p) : this.speaksFor(p, user)));
    return this.live()
      .filter((c) => voices(c) || (user.isGM && c.startedBy === user.id))
      .sort((a, b) => (b.connectedAt ?? b.createdAt ?? 0) - (a.connectedAt ?? a.createdAt ?? 0));
  },

  /** Who this user speaks as on a call: who they last spoke as there, else their character (the GM: the NPC). */
  voice(call, user = game.user) {
    const joined = (call?.participants ?? []).filter((p) => p.state === "joined" && this.speaksFor(p, user));
    const last = joined.find((p) => p.id === this._voice.get(call?.id));
    if (last) return last;
    if (user.isGM) return joined.find((p) => this._gmOnly(p)) ?? joined[0] ?? null;
    return joined[0] ?? null;
  },

  remember(callId, pid) {
    if (callId && pid) this._voice.set(callId, pid);
  },

  /** Messages on a call this user can see, oldest first. */
  messages(callId) {
    return (game.messages?.contents ?? [])
      .filter((m) => m.flags?.[MODULE_ID]?.holocall === callId && m.visible !== false)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  },

  /** For the GM's hang-up: participants only the GM voices (NPCs, contacts). */
  _gmOnly(p) {
    const actor = p.actorId ? game.actors.get(p.actorId) : null;
    return !actor?.hasPlayerOwner;
  },

  /* ---------------------------------------- */
  /*  GM side                                 */
  /* ---------------------------------------- */

  async _write(fn) {
    const calls = deepClone(Settings.get("holocalls") ?? {});
    const result = fn(calls);
    const now = Date.now();
    for (const [id, c] of Object.entries(calls)) {
      if (c.status === "ended" && now - (c.endedAt ?? now) > KEEP_ENDED) delete calls[id];
    }
    await Settings.set("holocalls", calls);
    return result;
  },

  _ring(callId) {
    clearTimeout(this._timers.get(callId));
    const seconds = Math.max(5, Number(Settings.get("ringSeconds")) || 30);
    this._timers.set(callId, setTimeout(() => this._timeout(callId).catch((err) => console.error(`${MODULE_ID} | ring timeout`, err)), seconds * 1000));
  },

  /** No answer: the still-ringing are missed; characters get a missed call in their messenger inbox. */
  async _timeout(callId) {
    this._timers.delete(callId);
    let missed = [];
    let caller = null;
    await this._write((calls) => {
      const call = calls[callId];
      if (!call) return;
      missed = call.participants.filter((p) => p.state === "ringing");
      for (const p of missed) p.state = "missed";
      caller = call.participants.find((p) => p.id === call.callerId) ?? null;
      settle(call);
    });
    if (!Settings.get("missedCallMessages") || !caller) return;
    for (const p of missed) {
      const actor = p.actorId ? game.actors.get(p.actorId) : null;
      if (!actor?.hasPlayerOwner) continue;
      await Messenger.missedCall(actor, caller, {
        subject: L(`${LANG}.Holocall.MissedSubject`, { name: caller.name }),
        body: L(`${LANG}.Holocall.MissedBody`, { name: caller.name })
      });
    }
  },

  registerSocket() {
    const gmOnly = (userId) => {
      if (!game.users.get(userId)?.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    };
    const mayCallAs = (from, userId) => {
      const user = game.users.get(userId);
      if (user?.isGM) return;
      const actor = from?.actorId ? game.actors.get(from.actorId) : null;
      if (!actor?.testUserPermission(user, "OWNER")) throw new Error(L(`${LANG}.Error.NotOwner`));
    };

    Socket.on("callPlace", async ({ from, targets }, userId) => {
      mayCallAs(from, userId);
      const id = foundry.utils.randomID(12);
      const caller = participant({ ...from, type: from.actorId ? "actor" : "contact" }, "p0");
      caller.state = "joined";
      const seen = new Set([caller.actorId ?? caller.contactId]);
      const list = [caller];
      for (const t of targets) {
        const key = t.actorId ?? t.contactId;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const p = participant(t, `p${list.length}`);
        const actor = p.actorId ? game.actors.get(p.actorId) : null;
        if (Settings.get("callNeedsAgent") && actor?.hasPlayerOwner && !Messenger.hasAgent(actor)) p.state = "nodevice";
        list.push(p);
      }
      await this._write((calls) => {
        calls[id] = settle({ id, callerId: "p0", startedBy: userId, createdAt: Date.now(), connectedAt: null, endedAt: null, status: "ringing", participants: list });
      });
      this._ring(id);
      return id;
    });

    Socket.on("callAnswer", async ({ callId, pid }, userId) => {
      await this._write((calls) => {
        const call = calls[callId];
        const p = call?.participants.find((x) => x.id === pid);
        if (!p || p.state !== "ringing" || call.status === "ended") return;
        if (!this.answerers(p).some((u) => u.id === userId) && !game.users.get(userId)?.isGM) throw new Error(L(`${LANG}.Error.NotOwner`));
        p.state = "joined";
        settle(call);
      });
      return true;
    });

    Socket.on("callDecline", async ({ callId, pid, reason }) => {
      await this._write((calls) => {
        const call = calls[callId];
        const p = call?.participants.find((x) => x.id === pid);
        if (!p || p.state !== "ringing") return;
        p.state = ["declined", "nosignal"].includes(reason) ? reason : "declined";
        settle(call);
      });
      return true;
    });

    Socket.on("callLeave", async ({ callId, pids }, userId) => {
      const user = game.users.get(userId);
      await this._write((calls) => {
        const call = calls[callId];
        if (!call) return;
        for (const p of call.participants) {
          if (pids.includes(p.id) && LIVE.includes(p.state) && this.speaksFor(p, user)) p.state = "left";
        }
        settle(call);
      });
      return true;
    });

    Socket.on("callEnd", async ({ callId }, userId) => {
      gmOnly(userId);
      await this._write((calls) => {
        const call = calls[callId];
        if (!call || call.status === "ended") return;
        for (const p of call.participants) if (LIVE.includes(p.state)) p.state = "left";
        call.status = "ended";
        call.endedAt = Date.now();
      });
      clearTimeout(this._timers.get(callId));
      return true;
    });

    Socket.on("callInvite", async ({ callId, targets }, userId) => {
      const user = game.users.get(userId);
      let ringing = false;
      await this._write((calls) => {
        const call = calls[callId];
        if (!call || call.status === "ended") return;
        if (!user?.isGM && !call.participants.some((p) => p.state === "joined" && this.speaksFor(p, user))) throw new Error(L(`${LANG}.Error.NotOwner`));
        const seen = new Set(call.participants.filter((p) => LIVE.includes(p.state)).map((p) => p.actorId ?? p.contactId));
        for (const t of targets) {
          const key = t.actorId ?? t.contactId;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          call.participants.push(participant(t, `p${call.participants.length}`));
          ringing = true;
        }
      });
      if (ringing) this._ring(callId);
      return true;
    });
  },

  /** GM, on load: calls left ringing by a reload are missed now. */
  async tidy() {
    if (!Compat.isActiveGM) return;
    const stale = this.all().filter((c) => c.status !== "ended" && c.participants.some((p) => p.state === "ringing"));
    for (const c of stale) await this._timeout(c.id);
  }
};
