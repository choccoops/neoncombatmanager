import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { Cards } from "../combat/cards.js";
import { plotResult, luckOptions, doubleDownCost, clampLuck, FORCE_FATE_COST, LUCKY_GAIN, UNLUCKY_LOSS } from "./plot-die.js";
import { L, esc } from "../util.js";

const { getProperty } = foundry.utils;
const DIE_IMG = "icons/dice/d6black.svg";

/**
 * Raising the Stakes, at the table: the GM raises the stakes on a character's Check; the player
 * rolls the Plot Die (or Forces Fate); the result card lets the player spend an Opportunity and
 * the GM pick a Complication. A Complication's +2/+4 rides the character's next Check as a
 * situational modifier in CPR's roll dialog, and clears itself once that Check is rolled.
 */
export const Stakes = {
  init() {
    game.keybindings.register(MODULE_ID, "openStakes", {
      name: `${LANG}.Stakes.Title`,
      hint: `${LANG}.Stakes.KeyHint`,
      editable: [],
      onDown: () => {
        this.open();
        return true;
      }
    });
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-stakes", title: `${LANG}.Stakes.Title`, icon: "fa-solid fa-dice-six", order: 110, onClick: () => this.open() }
    ]));
    // "/stakes" opens the window ("/stakes why" with a reason: the GM raises, a player asks).
    Hooks.on("chatMessage", (log, message) => this.onChatCommand(message));
    Hooks.on("createChatMessage", (message, options, userId) => {
      this.onChatMessage(message, userId).catch((err) => console.error(`${MODULE_ID} | plot die bonus`, err));
    });
    const refresh = () => this.app?.rendered && this.app.render();
    for (const h of ["updateActor", `${MODULE_ID}.stakesChanged`, "updateCombat"]) Hooks.on(h, refresh);
  },

  /** The open Plot Die window, if any. */
  app: null,

  async open(actor = null) {
    const { StakesApp } = await import("./stakes-app.js");
    this.app = StakesApp.open(actor);
    return this.app;
  },

  /** @returns {boolean} false when the message was a /stakes command */
  onChatCommand(message) {
    const m = String(message ?? "").match(/^\/stakes(?:\s+([\s\S]*))?$/i);
    if (!m) return true;
    const reason = (m[1] ?? "").trim();
    if (!reason) {
      this.open();
      return false;
    }
    const actor = this._speaker();
    if (!actor) {
      ui.notifications.warn(L(`${LANG}.Stakes.NoOne`));
      return false;
    }
    const run = game.user.isGM ? this.raise(actor, { reason }) : this.ask(actor, reason);
    run.catch((err) => ui.notifications.warn(err.message));
    return false;
  },

  /** Whose Check a chat command means: the controlled token's, the current combatant (GM) or your character. */
  _speaker() {
    const controlled = canvas?.tokens?.controlled?.[0]?.actor;
    if (controlled?.isOwner) return controlled;
    if (game.user.isGM && game.combat?.started) return game.combat.combatant?.actor ?? null;
    return game.user.character ?? null;
  },

  /** LUCK: { value (pool), max (STAT) }. */
  luck(actor) {
    return { value: Number(getProperty(actor, "system.stats.luck.value")) || 0, max: Number(getProperty(actor, "system.stats.luck.max")) || 0 };
  },

  async setLuck(actor, delta) {
    const { value, max } = this.luck(actor);
    const next = clampLuck(value, delta, max);
    if (next !== value) await this._asGM(actor, { "system.stats.luck.value": next });
    return next - value;
  },

  /** Once-a-session uses (Double Down, Force Fate) this session. */
  used(actor) {
    const s = actor?.flags?.[MODULE_ID]?.stakes ?? {};
    return s.session === Settings.get("stakesSession") ? s : {};
  },

  async markUsed(actor, key) {
    const session = Settings.get("stakesSession");
    const s = { ...this.used(actor), session, [key]: true };
    await this._asGM(actor, { [`flags.${MODULE_ID}.stakes`]: s });
  },

  options(actor) {
    return luckOptions(this.luck(actor), this.used(actor));
  },

  /** Update an actor here when we own it, else through the GM. */
  async _asGM(actor, update) {
    if (actor.isOwner) return actor.update(update);
    return Socket.request("stakesUpdate", { actor: actor.uuid, update });
  },

  /* ---------------------------------------- */
  /*  The cards                               */
  /* ---------------------------------------- */

  /** GM: Raise the Stakes on a character's Check. */
  async raise(actor, { reason = "" } = {}) {
    if (!game.user.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    const opts = this.options(actor);
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Stakes.Kicker`),
      title: L(`${LANG}.Stakes.Raised`, { name: esc(actor.name) }),
      img: DIE_IMG,
      body: `<p>${L(`${LANG}.Stakes.RaisedBody`)}</p>${reason ? `<p class="ncm-ref">${esc(reason)}</p>` : ""}`,
      tone: "yellow",
      buttons: [
        { action: "stakes-roll", label: L(`${LANG}.Stakes.Roll`), icon: "fa-solid fa-dice-six", owner: true },
        ...(opts.forceFate ? [{ action: "stakes-force", label: L(`${LANG}.Stakes.ForceFate`, { cost: FORCE_FATE_COST }), icon: "fa-solid fa-star", owner: true }] : [])
      ],
      flags: { stakes: { type: "raised" } }
    });
  },

  /** A player asks the GM to Raise the Stakes (LUCK STAT 5+). */
  async ask(actor, reason = "") {
    if (!this.options(actor).ask) throw new Error(L(`${LANG}.Stakes.NeedLuck`, { luck: 5 }));
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Stakes.Kicker`),
      title: L(`${LANG}.Stakes.Asks`, { name: esc(actor.name) }),
      img: DIE_IMG,
      body: reason ? `<p>${esc(reason)}</p>` : "",
      tone: "yellow",
      buttons: [
        { action: "stakes-approve", label: L(`${LANG}.Stakes.Approve`), icon: "fa-solid fa-check", gm: true, data: { reason } },
        { action: "stakes-deny", label: L(`${LANG}.Stakes.Deny`), icon: "fa-solid fa-xmark", gm: true }
      ],
      whisper: [...new Set([...Cards.gms(), game.user.id])],
      flags: { stakes: { type: "ask" } }
    });
  },

  /** Roll the Plot Die for a character and post what it means. */
  async roll(actor, { doubleDown = false } = {}) {
    const roll = await new Roll("1d6").evaluate();
    await game.dice3d?.showForRoll?.(roll, game.user, true);
    return this.result(actor, plotResult(roll.total), { doubleDown });
  },

  /**
   * Post a result: what the Plot Die (or a crit, or Force Fate) brought. A Complication's bonus
   * goes on the character's next Check right away.
   * @param {object} r - plotResult()
   * @param {object} [o] - doubleDown: it was a reroll; forced: Force Fate; granted: by the GM (a crit)
   */
  async result(actor, r, { doubleDown = false, forced = false, granted = false, count = 1 } = {}) {
    await this.clearBonus(actor);
    let costNote = "";
    if (doubleDown) {
      const { luckLost, complications } = doubleDownCost(r, this.luck(actor).value);
      if (luckLost) await this.setLuck(actor, -luckLost);
      if (complications) count = complications;
      if (r.kind === "complication") costNote = L(`${LANG}.Stakes.DoubleDownCost`, { luck: luckLost, count: complications });
    }
    if (r.bonus) {
      await Conditions.add("stakesBonus", actor, { changes: [{ key: "bonuses.allActions", value: r.bonus, situational: true, onByDefault: true }], name: L(`${LANG}.Stakes.BonusName`, { bonus: r.bonus }) });
    }
    const opts = this.options(actor);
    const how = forced ? "forced" : granted ? "granted" : doubleDown ? "doubleDown" : "rolled";
    const buttons = [];
    if (r.kind === "opportunity") {
      for (const o of ["aidAlly", "feelingLucky", "criticallyHit", "narrative"]) {
        buttons.push({ action: "stakes-opp", label: L(`${LANG}.Stakes.Opp.${o}`), owner: true, data: { option: o } });
      }
    }
    if (r.kind === "complication") {
      for (const c of ["hinderAlly", "feelingUnlucky", "narrative"]) {
        buttons.push({ action: "stakes-comp", label: L(`${LANG}.Stakes.Comp.${c}`), gm: true, data: { option: c, count } });
      }
    }
    if (how === "rolled" && opts.doubleDown) buttons.push({ action: "stakes-double", label: L(`${LANG}.Stakes.DoubleDown`), icon: "fa-solid fa-rotate", owner: true });
    const face = forced ? "★" : granted ? "✦" : String(r.face);
    // A crit's Complication (or a chain's) carries no bonus: say so, not "+0".
    const key = r.kind === "complication" && !r.bonus ? "complicationNoBonus" : r.kind;
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Stakes.How.${how}`, { face }),
      title: L(`${LANG}.Stakes.Result.${key}`, { name: esc(actor.name), bonus: r.bonus }),
      img: DIE_IMG,
      body: `<div class="ncm-plot-face kind-${r.kind}">${face}</div><p>${L(`${LANG}.Stakes.ResultBody.${key}`, { bonus: r.bonus, count })}</p>${costNote ? `<p class="ncm-ref">${costNote}</p>` : ""}`,
      tone: r.kind === "opportunity" ? "cyan" : r.kind === "complication" ? "red" : "yellow",
      buttons,
      flags: { stakes: { type: "result", kind: r.kind, count, picks: 0 } }
    });
  },

  /** Take the Plot Die bonus off a character (a new result replaces it). */
  async clearBonus(actor) {
    if (Conditions.has("stakesBonus", actor)) await Conditions.remove("stakesBonus", actor);
  },

  /* ---------------------------------------- */
  /*  Spending a result                       */
  /* ---------------------------------------- */

  /** A player spends an Opportunity. */
  async opportunity(actor, option, event = null) {
    switch (option) {
      case "aidAlly": {
        const ally = await this.pickActor(L(`${LANG}.Stakes.Opp.aidAlly`), actor);
        if (!ally) return false;
        await Conditions.add("stakesAided", ally, { changes: [{ key: "bonuses.allActions", value: 2, situational: true, onByDefault: true }] });
        return this.note(actor, L(`${LANG}.Stakes.Done.aidAlly`, { name: esc(actor.name), ally: esc(ally.name) }), "cyan");
      }
      case "feelingLucky": {
        const got = await this.setLuck(actor, LUCKY_GAIN);
        return this.note(actor, L(`${LANG}.Stakes.Done.feelingLucky`, { name: esc(actor.name), luck: got }), "cyan");
      }
      case "criticallyHit": {
        const pick = await this.pickInjury(actor);
        if (!pick) return false;
        await Conditions.add(pick.condition, pick.target);
        return this.note(actor, L(`${LANG}.Stakes.Done.criticallyHit`, { name: esc(actor.name), target: esc(pick.target.name), injury: esc(Registry.get(pick.condition)?.name) }), "cyan");
      }
      case "narrative": {
        const text = await this.prompt(L(`${LANG}.Stakes.Opp.narrative`), L(`${LANG}.Stakes.NarrativeOpp`));
        if (!text) return false;
        return this.note(actor, `<b>${L(`${LANG}.Stakes.Opp.narrative`)}:</b> ${esc(text)}`, "cyan");
      }
      default:
        return false;
    }
  },

  /** The GM picks a Complication. */
  async complication(actor, option) {
    switch (option) {
      case "hinderAlly": {
        const ally = await this.pickActor(L(`${LANG}.Stakes.Comp.hinderAlly`), null, { penalty: true });
        if (!ally) return false;
        await Conditions.add("stakesHindered", ally.actor, { changes: [{ key: "bonuses.allActions", value: -Math.abs(ally.penalty), situational: true, onByDefault: true }], name: L(`${LANG}.Stakes.HinderedName`, { penalty: Math.abs(ally.penalty) }) });
        return this.note(actor, L(`${LANG}.Stakes.Done.hinderAlly`, { ally: esc(ally.actor.name), penalty: Math.abs(ally.penalty) }), "red");
      }
      case "feelingUnlucky": {
        if (this.luck(actor).value > 0) {
          await this.setLuck(actor, -UNLUCKY_LOSS);
          return this.note(actor, L(`${LANG}.Stakes.Done.feelingUnlucky`, { name: esc(actor.name) }), "red");
        }
        // Out of LUCK: they slip, their weapon jams, or something breaks.
        const out = await this.choose(L(`${LANG}.Stakes.Comp.feelingUnlucky`), L(`${LANG}.Stakes.OutOfLuck`, { name: esc(actor.name) }), ["prone", "jam", "malfunction"]);
        if (!out) return false;
        if (out === "prone") await Conditions.add("prone", actor);
        return this.note(actor, L(`${LANG}.Stakes.Unlucky.${out}`, { name: esc(actor.name) }), "red");
      }
      case "narrative": {
        const text = await this.prompt(L(`${LANG}.Stakes.Comp.narrative`), L(`${LANG}.Stakes.NarrativeComp`));
        if (!text) return false;
        return this.note(actor, `<b>${L(`${LANG}.Stakes.Comp.narrative`)}:</b> ${esc(text)}`, "red");
      }
      default:
        return false;
    }
  },

  note(actor, html, tone) {
    return Cards.post({ actor, kicker: L(`${LANG}.Stakes.Kicker`), title: esc(actor.name), img: DIE_IMG, body: `<p>${html}</p>`, tone, whisper: null });
  },

  /* ---------------------------------------- */
  /*  Little dialogs                          */
  /* ---------------------------------------- */

  /** Characters to pick from: the combat's, else the player characters. */
  candidates(exclude = null) {
    const fromCombat = (game.combat?.combatants ?? []).map((c) => c.actor).filter(Boolean);
    const list = fromCombat.length ? fromCombat : game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    return [...new Set(list)].filter((a) => a !== exclude);
  },

  async pickActor(title, exclude, { penalty = false } = {}) {
    const list = this.candidates(exclude);
    if (!list.length) return null;
    const options = list.map((a) => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("");
    const extra = penalty ? `<label>${L(`${LANG}.Stakes.Penalty`)} <input type="number" name="penalty" value="2" min="1" max="8"></label>` : "";
    const result = await Compat.DialogV2.prompt({
      window: { title },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<div class="ncm-grid"><label>${L(`${LANG}.Stakes.Who`)} <select name="who">${options}</select></label>${extra}</div>`,
      ok: { callback: (event, button) => ({ who: button.form.elements.who.value, penalty: Number(button.form.elements.penalty?.value) || 2 }) },
      rejectClose: false
    });
    if (!result) return null;
    const actor = await fromUuid(result.who);
    return penalty ? { actor, penalty: result.penalty } : actor;
  },

  /** Critically Hit: the target (your first target, or one picked) and an injury that fits. */
  async pickInjury(actor) {
    const targets = [...(game.user.targets ?? [])].map((t) => t.actor).filter(Boolean);
    const list = targets.length ? targets : this.candidates(actor);
    const crits = Registry.all().filter((c) => c.category === "critical" && c.critical && !c.disabled);
    const body = crits.filter((c) => c.critical.location === "body").map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const head = crits.filter((c) => c.critical.location === "head").map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const result = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Stakes.Opp.criticallyHit`) },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<p class="ncm-hint">${L(`${LANG}.Stakes.CritHint`)}</p><div class="ncm-grid"><label>${L(`${LANG}.Stakes.Target`)} <select name="target">${list.map((a) => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("")}</select></label><label>${L(`${LANG}.Stakes.Injury`)} <select name="injury"><optgroup label="${L(`${LANG}.Stakes.Body`)}">${body}</optgroup><optgroup label="${L(`${LANG}.Stakes.Head`)}">${head}</optgroup></select></label></div>`,
      ok: { callback: (event, button) => ({ target: button.form.elements.target.value, injury: button.form.elements.injury.value }) },
      rejectClose: false
    });
    if (!result?.target) return null;
    return { target: await fromUuid(result.target), condition: result.injury };
  },

  async prompt(title, hint) {
    return Compat.DialogV2.prompt({
      window: { title },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<p class="ncm-hint">${hint}</p><textarea name="text" rows="3" style="width:100%"></textarea>`,
      ok: { callback: (event, button) => button.form.elements.text.value.trim() },
      rejectClose: false
    });
  },

  async choose(title, text, keys) {
    return Compat.DialogV2.wait({
      window: { title },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<p>${text}</p>`,
      buttons: keys.map((k, i) => ({ action: k, label: L(`${LANG}.Stakes.Unlucky.${k}Label`), default: i === 0 })),
      rejectClose: false
    });
  },

  /* ---------------------------------------- */
  /*  Buttons                                 */
  /* ---------------------------------------- */

  /** A Plot Die card button (from Cards). */
  async click(message, btn, event, actor) {
    const d = btn.dataset;
    const flags = message.flags?.[MODULE_ID]?.stakes ?? {};
    const owner = actor.isOwner;
    const done = async () => {
      btn.disabled = true;
      await this.markDone(message);
    };
    switch (d.ncmAction) {
      case "stakes-roll":
        if (!owner) return;
        await done();
        return this.roll(actor);
      case "stakes-force": {
        if (!owner || !this.options(actor).forceFate) return ui.notifications.warn(L(`${LANG}.Stakes.CantForce`));
        await done();
        await this.setLuck(actor, -FORCE_FATE_COST);
        await this.markUsed(actor, "forceFate");
        return this.result(actor, plotResult(6), { forced: true });
      }
      case "stakes-double": {
        if (!owner || !this.options(actor).doubleDown) return ui.notifications.warn(L(`${LANG}.Stakes.CantDouble`));
        await done();
        await this.markUsed(actor, "doubleDown");
        return this.roll(actor, { doubleDown: true });
      }
      case "stakes-approve":
        if (!game.user.isGM) return;
        await done();
        return this.raise(actor, { reason: d.reason ?? "" });
      case "stakes-deny":
        if (!game.user.isGM) return;
        await done();
        return this.note(actor, L(`${LANG}.Stakes.Denied`, { name: esc(actor.name) }), "yellow");
      case "stakes-opp":
        if (!owner) return;
        if (await this.opportunity(actor, d.option, event)) await done();
        return;
      case "stakes-comp": {
        if (!game.user.isGM) return;
        if (await this.complication(actor, d.option)) {
          // Two Complications (a Double Down without the LUCK to pay) leave the card open for one more.
          const picks = (Number(flags.picks) || 0) + 1;
          if (picks >= (Number(flags.count) || 1)) await done();
          else await message.update({ [`flags.${MODULE_ID}.stakes.picks`]: picks });
        }
        return;
      }
      default:
    }
  },

  /** A card is spent: its buttons go grey for everyone. */
  async markDone(message) {
    if (message.isOwner) return message.setFlag(MODULE_ID, "done", true);
    return Socket.request("stakesDone", { message: message.id });
  },

  /* ---------------------------------------- */
  /*  The bonus rides one Check               */
  /* ---------------------------------------- */

  /**
   * A Cyberpunk RED roll card posted for a character: their one-Check modifiers (the Plot Die's
   * +2/+4, Aid an Ally, Hinder an Ally) are used up. Damage cards don't count.
   */
  async onChatMessage(message, userId) {
    if (userId !== game.user.id) return;
    const content = String(message.content ?? "");
    if (!content.includes('class="rollcard"') || content.includes("data-bonus-damage")) return;
    const speaker = message.speaker ?? {};
    const actor = (typeof ChatMessage.getSpeakerActor === "function" ? ChatMessage.getSpeakerActor(speaker) : null) ?? game.actors?.get(speaker.actor);
    if (!actor) return;
    const spent = Conditions.active(actor).filter((c) => c.consume === "check").map((c) => c.id);
    if (spent.length) await Conditions.remove(spent, actor);
  },

  registerSocket() {
    Socket.on("stakesUpdate", async ({ actor, update }) => {
      const doc = await fromUuid(actor);
      // Only LUCK and this module's stakes flag go through the GM.
      const keys = Object.keys(update);
      if (!doc || keys.some((k) => k !== "system.stats.luck.value" && k !== `flags.${MODULE_ID}.stakes`)) throw new Error(L(`${LANG}.Error.NotOwner`));
      await doc.update(update);
      return true;
    });
    Socket.on("stakesDone", async ({ message }) => {
      await game.messages.get(message)?.setFlag(MODULE_ID, "done", true);
      return true;
    });
  },

  /** GM: a new session: Double Down and Force Fate are available again. */
  async newSession() {
    if (!game.user.isGM) return;
    await Settings.set("stakesSession", (Number(Settings.get("stakesSession")) || 0) + 1);
    ui.notifications.info(L(`${LANG}.Stakes.NewSessionDone`));
  }
};
