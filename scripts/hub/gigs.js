import { MODULE_ID, LANG, NEON_HUB_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { Socket } from "../socket.js";
import { Cards } from "../combat/cards.js";
import { Mail } from "../comms/mail.js";
import { Hub } from "./hub.js";
import { cleanGig, movesFor, open, canTake, seenBy, shares, toJournal, fromJournal } from "./gigs-data.js";
import { L, esc } from "../util.js";

const { randomID } = foundry.utils;

/**
 * Gigs on the City & NCART hub (world setting "hubGigs": { [id]: gig }, written by the GM), and
 * the letters about them through Night City Messenger: the briefing when a gig goes on the board
 * or is handed out, the word back when a character takes it, and how it ended, with the pay to
 * collect. Letters come from the gig's fixer (one of NCM's directory contacts). Under them (NCM
 * 2.5.0+): "Take the gig", "Show on the map", "Collect".
 *
 * Without Night City Messenger, or when a letter doesn't get through (a dead zone), the same
 * words go to the character's players as a chat card, and the pay is put straight in.
 */
export const Gigs = {
  get on() {
    return Settings.get("hubGigs") !== false;
  },

  get all() {
    return Object.values(Settings.get("hubGigData") ?? {}).map(cleanGig).filter((g) => g.id);
  },

  get(id) {
    return this.all.find((g) => g.id === id) ?? null;
  },

  /** My characters. */
  mine(user = game.user) {
    return (game.actors ?? []).filter((a) => a.type === "character" && a.testUserPermission?.(user, "OWNER") && (user.isGM ? a.hasPlayerOwner : true));
  },

  /** The gigs this user sees: the GM all of them; a player what's on the board and what they worked. */
  visible(user = game.user) {
    if (!this.on) return [];
    if (user?.isGM) return this.all;
    const mine = this.mine(user).map((a) => a.id);
    return this.all.filter((g) => seenBy(g, mine) && !Hub.place(g.place)?.hidden);
  },

  at(placeKey, user = game.user) {
    return this.visible(user).filter((g) => g.place === placeKey);
  },

  /** Is there work at a place (for its marker)? */
  openAt(placeKey) {
    return this.visible().some((g) => g.place === placeKey && open(g));
  },

  /** The crew a gig can go to: the player characters. */
  crew() {
    return (game.actors ?? []).filter((a) => a.type === "character" && a.hasPlayerOwner);
  },

  async _write(fn) {
    if (!game.user?.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    const all = foundry.utils.deepClone(Settings.get("hubGigData") ?? {});
    fn(all);
    await Settings.set("hubGigData", all);
  },

  /** GM: add or change a gig (and, unless told not to, its entry in Neon Hub's Journal). */
  async save(data, { journal = true } = {}) {
    const before = data.id ? this.get(data.id) : null;
    let gig = cleanGig({ ...(before ?? {}), ...data, id: data.id || randomID(8) });
    if (journal && GigJournal.on) gig = await GigJournal.push(gig, before);
    await this._write((all) => {
      all[gig.id] = gig;
    });
    return gig;
  },

  async remove(id) {
    await this._write((all) => {
      delete all[id];
    });
  },

  /* ---------------------------------------- */
  /*  Letters                                 */
  /* ---------------------------------------- */

  /** A gig's particulars, for a letter. Never the GM's note. */
  details(gig, { full = true } = {}) {
    const place = Hub.place(gig.place);
    const rows = [
      [L(`${LANG}.Gigs.Field.Client`), gig.client],
      [L(`${LANG}.Gigs.Field.Place`), place?.name ?? ""],
      [L(`${LANG}.Gigs.Field.Reward`), gig.reward ? `${gig.reward.toLocaleString()} eb${gig.perHead ? ` ${L(`${LANG}.Gigs.PerHead`)}` : ""}` : ""]
    ].filter(([, v]) => v);
    return `<p>${rows.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join("<br>")}</p>${full && gig.text ? `<p>${esc(gig.text).replace(/\n/g, "<br>")}</p>` : ""}`;
  },

  sender(gig) {
    return gig.fixerName || L(`${LANG}.Gigs.AFixer`);
  },

  /**
   * GM: tell a character something about a gig. By Night City Messenger from the gig's fixer;
   * failing that, a chat card to the character's players.
   * @returns {Promise<{ mailed: boolean, messageId: string|null }>}
   */
  async tell(gig, actor, what, { action = null, extra = "" } = {}) {
    const subject = L(`${LANG}.Gigs.Mail.${what}.Subject`, { title: gig.title });
    const words = `<p>${L(`${LANG}.Gigs.Mail.${what}.Body`, { name: esc(actor.name), title: esc(gig.title), fixer: esc(this.sender(gig)) })}</p>`;
    const body = `${words}${this.details(gig, { full: what === "Offer" || what === "Assigned" })}${extra}<p>${esc(this.sender(gig))}</p>`;
    if (gig.fixer && Mail.on) {
      await Mail.introduce(gig.fixer, actor.id);
      const res = await Mail.send({ from: { contactId: gig.fixer }, to: actor.id, subject, body, action });
      if (res.ok) return { mailed: true, messageId: res.messageId ?? null };
    }
    await Cards.post({ actor: null, title: subject, kicker: this.sender(gig), tone: what === "Failed" ? "pink" : "cyan", body, whisper: Cards.owners(actor) });
    return { mailed: false, messageId: null };
  },

  /* ---------------------------------------- */
  /*  What happens to a gig                   */
  /* ---------------------------------------- */

  /** Work at a place the players haven't found puts it on their map (no fanfare). */
  async reveal(gig) {
    if (Hub.place(gig.place)?.hidden) await Hub.setSeen(gig.place, true, { quiet: true });
  },

  /** GM: put it on the board. Every player character hears. */
  async offer(id) {
    const gig = this.get(id);
    if (!gig || !movesFor(gig).includes("offer")) return null;
    await this.reveal(gig);
    const next = await this.save({ ...gig, state: "offered" });
    for (const actor of this.crew()) await this.tell(next, actor, "Offer", { action: { kind: "gig", gig: id } });
    return next;
  },

  /** GM: take it back off the board. */
  async withdraw(id) {
    const gig = this.get(id);
    return gig && movesFor(gig).includes("withdraw") ? this.save({ ...gig, state: "draft", crew: [] }) : null;
  },

  /** GM: hand it to these characters (added to whoever is on it). */
  async assign(id, actorIds = []) {
    const gig = this.get(id);
    if (!gig || !movesFor(gig).includes("assign")) return null;
    const fresh = actorIds.filter((a) => !gig.crew.includes(a) && game.actors?.get?.(a));
    if (!fresh.length) return gig;
    await this.reveal(gig);
    const next = await this.save({ ...gig, state: "taken", crew: [...gig.crew, ...fresh] });
    for (const a of fresh) await this.tell(next, game.actors.get(a), "Assigned", { action: { kind: "gig", gig: id } });
    return next;
  },

  /** A player: take it as one of their characters (through the GM). */
  take(id, actorId) {
    return Socket.request("gigTake", { id, actorId });
  },

  async _take({ id, actorId }, userId) {
    const gig = this.get(id);
    const actor = game.actors?.get?.(actorId);
    const user = game.users?.get?.(userId) ?? null;
    if (!this.on || !gig || !actor || !canTake(gig, actorId)) return { ok: false };
    if (!user || !(user.isGM || actor.testUserPermission?.(user, "OWNER"))) return { ok: false };
    const next = await this.save({ ...gig, state: "taken", crew: [...gig.crew, actorId] });
    await this.tell(next, actor, "Taken", { action: { kind: "gig", gig: id } });
    return { ok: true };
  },

  /** GM: it's over. Done: each of the crew hears, with their pay to collect. Failed: they hear that. */
  async finish(id, ok) {
    const gig = this.get(id);
    if (!gig || !movesFor(gig).includes(ok ? "done" : "failed")) return null;
    const next = await this.save({ ...gig, state: ok ? "done" : "failed" });
    const pay = ok ? shares(next) : {};
    for (const a of next.crew) {
      const actor = game.actors?.get?.(a);
      if (!actor) continue;
      const amount = pay[a] ?? 0;
      const extra = amount ? `<p>${L(`${LANG}.Gigs.Mail.Done.Pay`, { amount: amount.toLocaleString() })}</p>` : "";
      const res = await this.tell(next, actor, ok ? "Done" : "Failed", { action: amount ? { kind: "pay", gig: id, amount } : { kind: "gig", gig: id }, extra });
      // Nothing to press (no Messenger, an older one, or the letter didn't land): the pay goes straight in.
      if (amount && !(res.mailed && res.messageId && Mail.buttons)) await this.pay(next, actor, amount);
    }
    return next;
  },

  /** GM: put a share in a character's wealth, once. */
  async pay(gig, actor, amount) {
    const now = this.get(gig.id);
    if (!now || now.paid.includes(actor.id) || !(amount > 0)) return false;
    await this.save({ ...now, paid: [...now.paid, actor.id] });
    const reason = L(`${LANG}.Gigs.Ledger`, { title: gig.title });
    if (typeof actor.deltaLedgerProperty === "function") await actor.deltaLedgerProperty("wealth", amount, reason);
    else await actor.update({ "system.wealth.value": (Number(actor.system?.wealth?.value) || 0) + amount });
    return true;
  },

  async _claim({ message }, userId) {
    const entry = Mail.entry(message);
    const gig = this.get(entry?.gig);
    const actor = game.actors?.get?.(entry?.to);
    const user = game.users?.get?.(userId) ?? null;
    if (!entry || entry.kind !== "pay" || entry.claimed || !gig || !actor) return { ok: false };
    if (!user || !(user.isGM || actor.testUserPermission?.(user, "OWNER"))) return { ok: false };
    await Mail.note(message, { claimed: true });
    return { ok: await this.pay(gig, actor, Number(entry.amount) || 0) };
  },

  /* ---------------------------------------- */
  /*  A place by letter                       */
  /* ---------------------------------------- */

  /** GM: a contact sends the crew a place (and it's revealed to them). */
  async sendPlace(placeKey, { contactId = "", contactName = "", note = "", actorIds = null } = {}) {
    const p = Hub.place(placeKey);
    if (!game.user?.isGM || !p) return 0;
    if (p.hidden) await Hub.setSeen(placeKey, true, { quiet: true });
    const from = contactName || L(`${LANG}.Gigs.AFixer`);
    const subject = L(`${LANG}.Gigs.Mail.Place.Subject`, { place: p.name });
    const body = `<p>${L(`${LANG}.Gigs.Mail.Place.Body`, { place: esc(p.name) })}</p>${note ? `<p>${esc(note).replace(/\n/g, "<br>")}</p>` : ""}<p>${esc(from)}</p>`;
    let n = 0;
    for (const actor of this.crew().filter((a) => !actorIds || actorIds.includes(a.id))) {
      let mailed = false;
      if (contactId && Mail.on) {
        await Mail.introduce(contactId, actor.id);
        mailed = (await Mail.send({ from: { contactId }, to: actor.id, subject, body, action: { kind: "place", place: placeKey } })).ok;
      }
      if (!mailed) await Cards.post({ actor: null, title: subject, kicker: from, tone: "cyan", body, whisper: Cards.owners(actor) });
      n += 1;
    }
    return n;
  },

  /** Open the map at a place, on this client. */
  showPlace(placeKey) {
    const p = Hub.place(placeKey);
    if (!p || (p.hidden && !game.user?.isGM)) return ui.notifications.warn(L(`${LANG}.Gigs.NoPlace`));
    return Hub.open({ view: "city", focus: { key: `p:${placeKey}`, x: p.x, y: p.y } });
  },

  /* ---------------------------------------- */
  /*  Buttons under the letters               */
  /* ---------------------------------------- */

  mapButton(placeKey) {
    return { label: L(`${LANG}.Gigs.Button.Map`), icon: "fa-solid fa-map-location-dot", run: () => this.showPlace(placeKey) };
  },

  gigButtons(entry, message, context) {
    const gig = this.get(entry.gig);
    if (!gig) return null;
    const actorId = context.actorId ?? entry.to;
    const actions = [];
    if (canTake(gig, actorId)) {
      actions.push({
        label: L(`${LANG}.Gigs.Button.${gig.state === "taken" ? "Join" : "Take"}`), icon: "fa-solid fa-handshake", primary: true,
        run: async () => {
          const res = await this.take(gig.id, actorId);
          if (!res?.ok) ui.notifications.warn(L(`${LANG}.Gigs.TakeFailed`));
        }
      });
    }
    if (gig.place) actions.push(this.mapButton(gig.place));
    return { note: L(`${LANG}.Gigs.State.${gig.state}`), actions };
  },

  payButtons(entry, message) {
    const amount = Number(entry.amount) || 0;
    if (entry.claimed) return { note: L(`${LANG}.Gigs.Collected`, { amount: amount.toLocaleString() }), actions: [] };
    return [{
      label: L(`${LANG}.Gigs.Button.Collect`, { amount: amount.toLocaleString() }), icon: "fa-solid fa-coins", primary: true,
      run: async () => {
        const res = await Socket.request("gigClaim", { message: message.id });
        if (!res?.ok) ui.notifications.warn(L(`${LANG}.Gigs.CollectFailed`));
      }
    }];
  },

  init() {
    GigJournal.init();
    Socket.on("gigTake", (data, userId) => this._take(data, userId));
    Socket.on("gigClaim", (data, userId) => this._claim(data, userId));
    Mail.register("gig", (e, m, c) => this.gigButtons(e, m, c));
    Mail.register("pay", (e, m) => this.payButtons(e, m));
    Mail.register("place", (e) => (e.place ? [this.mapButton(e.place)] : null));
    Hooks.on(`${MODULE_ID}.gigsChanged`, () => {
      Hub.app?.refresh?.();
      Mail.refresh();
    });
  }
};

/**
 * A map gig's entry under Gigs in Neon Hub's Journal, kept in step both ways (through Neon Hub's
 * api.journal, 1.27.0+). Ours -> the Journal: made with the gig, and its status, client, place,
 * crew, briefing and pay follow every change; shown to the players once it's off the drawing
 * board. The Journal -> ours: take, complete, fail or reopen it there, change its crew, client,
 * briefing or pay, rename it, and the map follows; completing or failing it there sends the
 * letters and pays as here. The Journal's objectives and other rewards are its own.
 */
export const GigJournal = {
  /** How many of our own writes to the Journal are under way (its hooks are ours then). */
  busy: 0,

  get api() {
    const m = game.modules.get(NEON_HUB_ID);
    return m?.active ? m.api?.journal ?? null : null;
  },

  get on() {
    return Settings.get("hubGigJournal") !== false && typeof this.api?.createGig === "function" && typeof this.api?.saveGig === "function";
  },

  entry(gig) {
    return gig?.journal ? game.journal?.get?.(gig.journal) ?? null : null;
  },

  /** Can this user open a gig's entry? */
  canOpen(gig, user = game.user) {
    const e = this.on ? this.entry(gig) : null;
    return !!e && (user.isGM || !!e.testUserPermission?.(user, "LIMITED"));
  },

  open(gig) {
    const e = this.entry(gig);
    return e ? this.api.open(e) : null;
  },

  /** GM: write a gig into the Journal (making its entry the first time). Returns the gig, with its entry. */
  async push(gig, before = null) {
    if (!game.user?.isGM) return gig;
    this.busy += 1;
    try {
      let entry = this.entry(gig);
      if (!entry) {
        entry = await this.api.createGig(gig.title || L(`${LANG}.Gigs.Untitled`));
        if (!entry) return gig;
        gig = { ...gig, journal: entry.id };
      } else if (gig.title && entry.name !== gig.title) await entry.update({ name: gig.title });
      await this.api.saveGig(entry, toJournal(gig, { place: Hub.place(gig.place)?.name ?? "", hub: this.api.gig(entry), before }));
      const show = gig.state !== "draft";
      if (typeof this.api.showToPlayers === "function" && ((entry.ownership?.default ?? 0) > 0) !== show) await this.api.showToPlayers(entry, show);
    } catch (err) {
      console.warn(`${MODULE_ID} | the gig "${gig.title}" didn't reach Neon Hub's Journal`, err);
    } finally {
      this.busy -= 1;
    }
    return gig;
  },

  /** GM's client: an entry changed in the Journal. Bring its gig on the map in line. */
  async pull(entry) {
    if (this.busy || !Compat.isActiveGM || !this.on || !entry) return null;
    const gig = Gigs.all.find((g) => g.journal === entry.id);
    const hub = gig ? this.api.gig(entry) : null;
    if (!hub) return null;
    const diff = fromJournal(hub, gig, { name: entry.name });
    if (!Object.keys(diff).length) return null;
    const { state, ...rest } = diff;
    let now = Object.keys(rest).length ? await Gigs.save({ ...gig, ...rest }, { journal: false }) : gig;
    if (state === "done" || state === "failed") {
      // Ended in the Journal: the letters go out and the pay with them, as from the map.
      if (open(now)) return Gigs.finish(now.id, state === "done");
      now = await Gigs.save({ ...now, state }, { journal: false });
    } else if (state) now = await Gigs.save({ ...now, state }, { journal: false });
    return now;
  },

  init() {
    const later = (entry) => this.pull(entry).catch((err) => console.warn(`${MODULE_ID} | gigs: the Journal's change didn't reach the map`, err));
    Hooks.on("updateJournalEntryPage", (page) => later(page?.parent));
    Hooks.on("updateJournalEntry", (entry, changed) => {
      if ("name" in (changed ?? {})) later(entry);
    });
  }
};
