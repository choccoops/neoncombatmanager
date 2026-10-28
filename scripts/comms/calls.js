import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Messenger } from "./messenger.js";
import { Hub } from "../hub/hub.js";
import { L, esc } from "../util.js";

const { deepClone } = foundry.utils;

/** How long an ended call is kept (for windows to show "call ended"), in ms. */
const KEEP_ENDED = 10 * 60 * 1000;

/** Comms Jam (a quickhack): no calls in or out. */
const jammed = (actor) => !!actor?.statuses?.has?.("qhCommsJam");

/* -------------------------------------------- */
/*  Pure call rules (tested)                    */
/* -------------------------------------------- */

/** Participant states: ringing, joined, declined, missed, busy, nosignal, nodevice, left, cancelled. */
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
    state: "ringing",
    joinedAt: null
  };
}

/** The text of a holocall chat message (the line under the HOLO tag), as plain text. */
export function lineText(content) {
  const html = String(content ?? "");
  const m = html.match(/<p>([\s\S]*?)<\/p>/);
  return (m ? m[1] : html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

/**
 * Who each player character on a call keeps the log with: the caller, or (for the caller) the
 * first other person who picked up. A conversation between two player characters is logged
 * once: the messenger files the sender's copy itself.
 * @param {object} call
 * @param {(p) => boolean} isPC - is this participant a player character?
 * @returns {{ pc: object, other: object }[]}
 */
export function logPairs(call, isPC) {
  const on = call.participants.filter((p) => p.joinedAt);
  const caller = on.find((p) => p.id === call.callerId);
  const out = [];
  const done = new Set();
  for (const pc of on.filter(isPC)) {
    const other = caller && caller.id !== pc.id ? caller : on.find((p) => p.id !== pc.id);
    if (!other) continue;
    const pair = [pc.id, other.id].sort().join("|");
    if (done.has(pair)) continue;
    done.add(pair);
    out.push({ pc, other });
  }
  return out;
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
    if (Hub.noSignal(caller)) throw new Error(L(`${LANG}.Holocall.NoSignalAt`, { name: caller.name, where: Hub.whereIs(caller) }));
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
    const who = p?.actorId ? game.actors.get(p.actorId) : null;
    if (Hub.noSignal(who)) {
      await this.decline(callId, pid, "nosignal");
      throw new Error(L(`${LANG}.Holocall.NoSignalAt`, { name: p.name, where: Hub.whereIs(who) }));
    }
    if (jammed(who)) {
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
    const was = Object.fromEntries(Object.entries(calls).map(([id, c]) => [id, c.status]));
    const result = fn(calls);
    const now = Date.now();
    for (const [id, c] of Object.entries(calls)) {
      if (c.status === "ended" && now - (c.endedAt ?? now) > KEEP_ENDED) delete calls[id];
    }
    await Settings.set("holocalls", calls);
    // Calls that just ended: the logs go to the messenger now, when the GM keeps them automatically.
    const ended = Object.values(calls).filter((c) => c.status === "ended" && was[c.id] !== "ended");
    if (ended.length && Settings.get("callLogs") === "auto") {
      for (const c of ended) await this.saveLog(c.id).catch((err) => console.warn(`${MODULE_ID} | holocall log`, err));
    }
    return result;
  },

  /** Is this character on (or picking up) another live call? */
  _busy(actorId, exceptCallId = null) {
    if (!actorId || !Settings.get("busySignal")) return false;
    return this.live().some((c) => c.id !== exceptCallId && c.participants.some((p) => p.actorId === actorId && p.state === "joined"));
  },

  /** A target's state when the call goes out: busy, no signal, no device, or ringing. */
  _reach(p, callId = null) {
    const actor = p.actorId ? game.actors.get(p.actorId) : null;
    if (!actor) return "ringing";
    if (this._busy(actor.id, callId)) return "busy";
    if (Hub.noSignal(actor) || jammed(actor)) return "nosignal";
    if (Settings.get("callNeedsAgent") && actor.hasPlayerOwner && !Messenger.hasAgent(actor)) return "nodevice";
    return "ringing";
  },

  /* ---------------------------------------- */
  /*  Logs to Night City Messenger            */
  /* ---------------------------------------- */

  /** Is a participant a player character? */
  _isPC(p) {
    const actor = p?.actorId ? game.actors.get(p.actorId) : null;
    return !!actor?.hasPlayerOwner;
  },

  /** Has this call's log been kept for a character? */
  logged(call, actorId) {
    return (call?.logged ?? []).includes(actorId);
  },

  /** The log as messenger mail: a subject, and the conversation as the body. */
  logMessage(call, messages = this.messages(call.id)) {
    const on = call.participants.filter((p) => p.joinedAt);
    const names = on.map((p) => p.name).join(", ");
    const start = call.connectedAt ?? call.createdAt ?? Date.now();
    const length = call.connectedAt ? Math.max(0, Math.round(((call.endedAt ?? Date.now()) - call.connectedAt) / 1000)) : 0;
    const dur = `${String(Math.floor(length / 60)).padStart(2, "0")}:${String(length % 60).padStart(2, "0")}`;
    const lines = messages.map((m) => {
      const f = m.flags?.[MODULE_ID] ?? {};
      return `<p><b>${esc(f.name ?? m.speaker?.alias ?? "")}:</b> ${esc(lineText(m.content)).replace(/\n/g, "<br>")}</p>`;
    });
    return {
      subject: L(`${LANG}.Holocall.LogSubject`, { names, length: dur }),
      body: `<p><i>${esc(L(`${LANG}.Holocall.LogHeader`, { names, length: dur, time: new Date(start).toLocaleString() }))}</i></p>`
        + (lines.length ? lines.join("") : `<p><i>${esc(L(`${LANG}.Holocall.LogSilent`))}</i></p>`)
    };
  },

  /**
   * GM: keep a call's log in the Night City Messenger inbox of each player character who was on
   * it (or only `actorIds`), as mail from the person they spoke with, threaded with every other
   * holocall between the two of them.
   * @returns {Promise<string[]>} the actor ids it was kept for
   */
  async saveLog(callId, actorIds = null) {
    if (!game.user.isGM) return Socket.request("callLog", { callId, actorIds });
    const call = this.get(callId);
    if (!call || !Messenger.ready || Settings.get("callLogs") === "off") return [];
    const mail = this.logMessage(call);
    const saved = [];
    for (const { pc, other } of logPairs(call, (p) => this._isPC(p))) {
      if (actorIds && !actorIds.includes(pc.actorId) && !actorIds.includes(other.actorId)) continue;
      if (this.logged(call, pc.actorId)) continue;
      const actor = game.actors.get(pc.actorId);
      const threadId = `holocall-${[pc.actorId, other.actorId ?? other.contactId ?? other.name].sort().join("-")}`;
      if (await Messenger.callLog(actor, other, { ...mail, threadId })) {
        saved.push(pc.actorId);
        if (this._isPC(other)) saved.push(other.actorId);
      }
    }
    if (saved.length) {
      await this._write((calls) => {
        const c = calls[callId];
        if (c) c.logged = [...new Set([...(c.logged ?? []), ...saved])];
      });
    }
    return saved;
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
      caller.joinedAt = Date.now();
      const seen = new Set([caller.actorId ?? caller.contactId]);
      const list = [caller];
      for (const t of targets) {
        const key = t.actorId ?? t.contactId;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const p = participant(t, `p${list.length}`);
        p.state = this._reach(p);
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
        p.joinedAt = Date.now();
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

    // A player keeps the log of a call they were on (for their own characters).
    Socket.on("callLog", async ({ callId, actorIds }, userId) => {
      const user = game.users.get(userId);
      const call = this.get(callId);
      const mine = (call?.participants ?? []).filter((p) => p.joinedAt && p.actorId && game.actors.get(p.actorId)?.testUserPermission(user, "OWNER")).map((p) => p.actorId);
      if (!user?.isGM && !mine.length) throw new Error(L(`${LANG}.Error.NotOwner`));
      return this.saveLog(callId, user?.isGM ? actorIds : mine.filter((id) => !actorIds || actorIds.includes(id)));
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
          const p = participant(t, `p${call.participants.length}`);
          p.state = this._reach(p, callId);
          call.participants.push(p);
          if (p.state === "ringing") ringing = true;
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
