import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Cards } from "../combat/cards.js";
import { Stakes } from "../stakes/stakes.js";
import { plotResult } from "../stakes/plot-die.js";
import { Bridge, CHECKS } from "./bridge.js";
import { chainFrom, chainPayout, edgeOptions, EDGE, drawsTarot } from "./rules.js";
import { L, esc } from "../util.js";

const DIE_IMG = "icons/dice/d10black.svg";

/** Roll one d10 (shown with Dice So Nice). */
async function d10() {
  const r = await new Roll("1d10").evaluate();
  await game.dice3d?.showForRoll?.(r, game.user, true);
  return r.total;
}

/**
 * The 2070 roller, hooked into Cyberpunk RED's own (through the bridge):
 *  - the roll dialog gets a Raise the Stakes bar (roll the Plot Die right there, its +2/+4 lands
 *    on that roll) and Push the Limit (Riding the Edge: 2 LUCK for +LUCK STAT, in place of CPR's
 *    +1 a point);
 *  - an exploding or imploding Check rolls its Chain Reaction, and the payout comes as a card;
 *  - the roll card gets Second Chance and Close Call for its owner, and a crit's Opportunity or
 *    Complication for the GM;
 *  - a damage roll with three 6s or more offers the GM a Tarot Critical.
 */
export const Roller = {
  active: false,
  /** Does a roll hit an area (no Tarot card for it)? Neon Arsenal answers for its weapons. */
  isArea: () => false,
  /** The CPRRoll whose card is being posted (RenderRollCard to preCreateChatMessage). */
  pending: null,

  init() {
    Hooks.on("renderCPRRollDialog", (app, html) => this.decorateDialog(app, html).catch((err) => console.error(`${MODULE_ID} | roll dialog`, err)));
    Hooks.on(Compat.chatRenderHook, (message, html) => this.decorateCard(message, html));
    Hooks.on("createChatMessage", (message, options, userId) => this.onCreate(message, userId).catch((err) => console.error(`${MODULE_ID} | roller`, err)));
  },

  async ready() {
    if (!Settings.get("rollerHooks")) return;
    if (!(await Bridge.load())) return;
    this.patch();
    this.active = true;
  },

  /** Wrap CPRRoll#roll and CPRChat.RenderRollCard (once). */
  patch() {
    const proto = Bridge.rolls.CPRRoll.prototype;
    if (proto[`${MODULE_ID}Patched`]) return;
    proto[`${MODULE_ID}Patched`] = true;
    const roll = proto.roll;
    const self = this;
    proto.roll = async function (...args) {
      self.before(this);
      const out = await roll.apply(this, args);
      await self.after(this);
      return out;
    };
    const render = Bridge.chat.RenderRollCard;
    Bridge.chat.RenderRollCard = function (cprRoll) {
      self.pending = cprRoll;
      return render.call(this, cprRoll);
    };
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => this.onPreCreate(message, userId));
  },

  /* ---------------------------------------- */
  /*  Around the roll                         */
  /* ---------------------------------------- */

  /** Before the dice: the Plot Die's bonus and Push the Limit go on as modifiers. */
  before(roll) {
    const n = roll[MODULE_ID];
    if (!n) return;
    if (n.stakesBonus) roll.addMod([{ id: `${MODULE_ID}-plot`, value: n.stakesBonus, source: L(`${LANG}.Stakes.BonusName`, { bonus: n.stakesBonus }) }]);
    if (n.push) roll.addMod([{ id: `${MODULE_ID}-push`, value: n.push, source: L(`${LANG}.Roller.Push`) }]);
  },

  /** After the dice: Push the Limit is paid for, and an explosion or implosion may chain. */
  async after(roll) {
    const n = (roll[MODULE_ID] ??= {});
    n.kind = Bridge.kindOf(roll);
    const actor = n.actorId ? game.actors.get(n.actorId) : null;
    if (n.push && actor) await Stakes.setLuck(actor, -EDGE.push);
    if (!CHECKS.includes(n.kind) || !Settings.get("chainReactions") || !roll.calculateCritical || !roll.criticalRoll) return;
    const kind = roll.wasCritFail?.() ? "implode" : roll.wasCritSuccess?.() ? "explode" : null;
    if (kind) n.chain = await chainFrom(kind, roll.criticalRoll, d10);
  },

  /** What a roll card needs to remember about its roll (kept in the message's flags). */
  summary(roll) {
    const n = roll[MODULE_ID] ?? {};
    const kind = n.kind ?? Bridge.kindOf(roll);
    const critFail = !!roll.calculateCritical && !!roll.criticalRoll && !!roll.wasCritFail?.();
    const critSuccess = !!roll.calculateCritical && !!roll.criticalRoll && !critFail && !!roll.wasCritSuccess?.();
    const crit = Number(roll.criticalRoll) || 0;
    const total = Number(roll.resultTotal) || 0;
    const initial = Number(roll.initialRoll) || 0;
    const e = roll.entityData ?? {};
    return {
      kind,
      title: String(roll.rollTitle ?? ""),
      die: roll.die ?? null,
      faces: [...(roll.faces ?? [])].map(Number),
      initial,
      crit,
      critFail,
      critSuccess,
      total,
      // Everything but the dice: what a Second Chance adds to its new d10.
      flat: total - initial - (critSuccess ? crit : critFail ? -crit : 0),
      chain: n.chain ?? null,
      stakes: n.stakesBonus ?? 0,
      push: !!n.push,
      actorId: e.actor ?? n.actorId ?? null,
      tokenId: e.token ?? null,
      targets: (e.tokens ?? []).map((t) => t?.document?.uuid ?? t?.uuid).filter(Boolean),
      itemId: e.item ?? null,
      autofire: !!roll.isAutofire,
      location: roll.location ?? null
    };
  },

  /** The roll card's message, about to be created: it carries the roll's summary. */
  onPreCreate(message, userId) {
    const roll = this.pending;
    if (!roll || userId !== game.user.id || !String(message.content ?? "").includes('class="rollcard"')) return;
    this.pending = null;
    message.updateSource({ [`flags.${MODULE_ID}.roll`]: this.summary(roll) });
  },

  /** The roll card is posted (on the roller's client): a chain pays out; three 6s may draw a card. */
  async onCreate(message, userId) {
    if (userId !== game.user.id) return;
    const r = message.flags?.[MODULE_ID]?.roll;
    if (!r) return;
    if (r.chain) await this.chainCard(r);
    if (r.kind === "damage" && Settings.get("tarotCriticals") && drawsTarot(r.faces, { area: r.autofire || this.isArea(r) })) {
      const { Tarot } = await import("./tarot.js");
      await Tarot.offer(r);
    }
  },

  /* ---------------------------------------- */
  /*  Chain Reactions                         */
  /* ---------------------------------------- */

  /** The chain's card: its dice, its links, and its payout, with buttons to collect. */
  chainCard(r, { from = null } = {}) {
    const actor = r.actorId ? game.actors.get(r.actorId) : null;
    const attack = r.kind === "attack";
    const pay = chainPayout(r.chain, { attack });
    const lines = [];
    if (pay.opportunities) lines.push(L(`${LANG}.Roller.Pay.opportunities`, { count: pay.opportunities }));
    if (pay.damageDice) lines.push(L(`${LANG}.Roller.Pay.damage`, { dice: pay.damageDice }));
    if (pay.autoCrit) lines.push(L(`${LANG}.Roller.Pay.autoCrit`));
    if (pay.complications) lines.push(L(`${LANG}.Roller.Pay.complications`, { count: pay.complications }));
    if (pay.malfunction) lines.push(L(`${LANG}.Roller.Pay.${attack ? "malfunction" : "malfunctionOrCondition"}`));
    if (pay.condition && attack) lines.push(L(`${LANG}.Roller.Pay.condition`));
    const buttons = [];
    if (pay.opportunities) buttons.push({ action: "roller-opps", label: L(`${LANG}.Roller.TakeOpps`, { count: pay.opportunities }), icon: "fa-solid fa-star", owner: true, data: { count: pay.opportunities } });
    if (pay.damageDice) buttons.push({ action: "roller-damage", label: L(`${LANG}.Roller.RollDamage`, { dice: pay.damageDice }), icon: "fa-solid fa-burst", owner: true, data: { dice: pay.damageDice } });
    if (pay.autoCrit) buttons.push({ action: "roller-crit", label: L(`${LANG}.Roller.PickCrit`), icon: "fa-solid fa-skull-crossbones", owner: true });
    if (pay.complications) buttons.push({ action: "roller-comps", label: L(`${LANG}.Roller.GiveComps`, { count: pay.complications }), icon: "fa-solid fa-triangle-exclamation", gm: true, data: { count: pay.complications } });
    const explode = r.chain.kind === "explode";
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Roller.ChainKicker`),
      title: L(`${LANG}.Roller.Chain.${explode ? "explode" : "implode"}`, { name: esc(actor?.name ?? ""), links: r.chain.links }),
      img: DIE_IMG,
      tone: explode ? "cyan" : "red",
      body: `<p class="ncm-roll">${esc(from ?? r.title)} · ${L(`${LANG}.Roller.ChainDice`, { dice: [r.crit, ...r.chain.dice].join(" → ") })}</p>`
        + `<ul class="ncm-chain-pay">${lines.map((l) => `<li>${l}</li>`).join("")}</ul><p class="ncm-ref">${L(`${LANG}.Roller.ChainHint`)}</p>`,
      buttons,
      flags: { roller: { type: "chain" } }
    });
  },

  /* ---------------------------------------- */
  /*  The roll card                           */
  /* ---------------------------------------- */

  /** Buttons under a Cyberpunk RED roll card: Riding the Edge for its owner, a crit's twist for the GM. */
  decorateCard(message, html) {
    const r = message.flags?.[MODULE_ID]?.roll;
    if (!r || !CHECKS.includes(r.kind)) return;
    const root = Compat.element(html);
    const card = root?.querySelector?.(".rollcard");
    if (!card || root.querySelector(".ncm-edge")) return;
    const actor = r.actorId ? game.actors.get(r.actorId) : null;
    const f = message.flags[MODULE_ID];
    const out = [];
    if (actor?.isOwner && Settings.get("rideEdge")) {
      const opts = edgeOptions({ initial: r.initial, critFail: r.critFail, used: r.push || !!f.edge }, Stakes.luck(actor).value);
      if (opts.secondChance) out.push(`<button type="button" data-edge="secondChance" data-tooltip="${esc(L(`${LANG}.Roller.SecondChanceHint`))}"><i class="fa-solid fa-rotate-right"></i> ${esc(L(`${LANG}.Roller.SecondChance`))}</button>`);
      if (opts.closeCall) out.push(`<button type="button" data-edge="closeCall" data-tooltip="${esc(L(`${LANG}.Roller.CloseCallHint`))}"><i class="fa-solid fa-shield-heart"></i> ${esc(L(`${LANG}.Roller.CloseCall`))}</button>`);
    }
    // Crits feed the Plot Die: at the GM's call, an explosion brings an Opportunity, an implosion a Complication.
    if (game.user.isGM && actor && !r.chain && !f.twist) {
      if (r.critSuccess) out.push(`<button type="button" data-edge="opportunity"><i class="fa-solid fa-star"></i> ${esc(L(`${LANG}.Stakes.GrantOpp`))}</button>`);
      if (r.critFail) out.push(`<button type="button" data-edge="complication"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(L(`${LANG}.Stakes.GrantComp`))}</button>`);
    }
    if (f.edge) out.push(`<span class="ncm-edge-used">${esc(L(`${LANG}.Roller.Used.${f.edge}`))}</span>`);
    if (!out.length) return;
    const bar = document.createElement("div");
    bar.className = "ncm-edge";
    bar.innerHTML = out.join("");
    card.after(bar);
    bar.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-edge]");
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      btn.disabled = true;
      this.edge(message, btn.dataset.edge).catch((err) => {
        btn.disabled = false;
        ui.notifications.warn(err.message);
      });
    });
  },

  async edge(message, what) {
    const f = message.flags[MODULE_ID];
    const r = f.roll;
    const actor = game.actors.get(r.actorId);
    if (!actor) return null;
    if (what === "opportunity" || what === "complication") {
      if (!game.user.isGM) return null;
      await message.setFlag(MODULE_ID, "twist", what);
      const res = what === "opportunity" ? plotResult(6) : { face: 0, kind: "complication", bonus: 0 };
      return Stakes.result(actor, res, { granted: true });
    }
    if (!actor.isOwner || f.edge) return null;
    if (what === "secondChance") return this.secondChance(message, actor, r);
    if (what === "closeCall") return this.closeCall(message, actor, r);
    return null;
  },

  /** Second Chance (1 LUCK): reroll the d10, with the roll's own modifiers. Not on a natural 1. */
  async secondChance(message, actor, r) {
    if (!edgeOptions({ initial: r.initial, critFail: r.critFail, used: r.push || !!message.flags[MODULE_ID].edge }, Stakes.luck(actor).value).secondChance) {
      throw new Error(L(`${LANG}.Roller.CantEdge`));
    }
    await Stakes.setLuck(actor, -EDGE.secondChance);
    await this._markEdge(message, "secondChance");
    const die = await d10();
    let crit = 0;
    let chain = null;
    if (die === 10 || die === 1) {
      crit = await d10();
      if (Settings.get("chainReactions")) chain = await chainFrom(die === 10 ? "explode" : "implode", crit, d10);
    }
    const total = r.flat + die + (die === 10 ? crit : die === 1 ? -crit : 0);
    const dice = crit ? `${die} ${die === 10 ? "+" : "−"} ${crit}` : String(die);
    await Cards.post({
      actor,
      kicker: L(`${LANG}.Roller.EdgeKicker`),
      title: L(`${LANG}.Roller.SecondChanceTitle`, { name: esc(actor.name), total }),
      img: DIE_IMG,
      tone: "yellow",
      body: `<p class="ncm-roll">${esc(r.title)} · d10: ${dice}</p><p>${L(`${LANG}.Roller.Was`, { total: r.total })}</p>`
    });
    if (chain) await this.chainCard({ ...r, crit, chain }, { from: L(`${LANG}.Roller.SecondChance`) });
    return total;
  },

  /** Close Call (3 LUCK): the natural 1 doesn't implode. The die still reads 1. */
  async closeCall(message, actor, r) {
    if (!edgeOptions({ initial: r.initial, critFail: r.critFail, used: r.push || !!message.flags[MODULE_ID].edge }, Stakes.luck(actor).value).closeCall) {
      throw new Error(L(`${LANG}.Roller.CantEdge`));
    }
    await Stakes.setLuck(actor, -EDGE.closeCall);
    await this._markEdge(message, "closeCall");
    const total = r.total + r.crit;
    await Cards.post({
      actor,
      kicker: L(`${LANG}.Roller.EdgeKicker`),
      title: L(`${LANG}.Roller.CloseCallTitle`, { name: esc(actor.name), total }),
      img: DIE_IMG,
      tone: "yellow",
      body: `<p class="ncm-roll">${esc(r.title)}</p><p>${L(`${LANG}.Roller.CloseCallBody`, { crit: r.crit, was: r.total })}</p>`
    });
    return total;
  },

  async _markEdge(message, what) {
    if (message.isOwner) return message.setFlag(MODULE_ID, "edge", what);
    return null;
  },

  /** Chain card buttons (from Cards). */
  async click(message, btn, event, actor) {
    const d = btn.dataset;
    const done = async () => {
      btn.disabled = true;
      if (message.isOwner) await message.setFlag(MODULE_ID, "done", true);
    };
    switch (d.ncmAction) {
      case "roller-opps":
        if (!actor.isOwner) return null;
        await done();
        return Stakes.result(actor, plotResult(6), { granted: true, count: Number(d.count) || 1, kicker: L(`${LANG}.Roller.ChainKicker`) });
      case "roller-comps":
        if (!game.user.isGM) return null;
        await done();
        return Stakes.result(actor, { face: 0, kind: "complication", bonus: 0 }, { granted: true, count: Number(d.count) || 1, kicker: L(`${LANG}.Roller.ChainKicker`) });
      case "roller-damage": {
        if (!actor.isOwner) return null;
        btn.disabled = true;
        const roll = await new Roll(`${Number(d.dice) || 1}d6`).evaluate();
        return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: L(`${LANG}.Roller.ChainDamage`) });
      }
      case "roller-crit":
        if (!actor.isOwner) return null;
        if (await Stakes.opportunity(actor, "criticallyHit")) btn.disabled = true;
        return null;
      case "roller-tarot": {
        const { Tarot } = await import("./tarot.js");
        return Tarot.click(message, btn, event);
      }
      default:
        return null;
    }
  },

  /* ---------------------------------------- */
  /*  The roll dialog                         */
  /* ---------------------------------------- */

  /**
   * Cyberpunk RED's roll dialog, for a Check: a Raise the Stakes bar (the Plot Die rolled before
   * the d10, its bonus straight onto this roll) and Push the Limit, which replaces CPR's own
   * +1-a-point LUCK box.
   */
  async decorateDialog(app, html) {
    const roll = app.rollData;
    const actor = app.actor;
    if (!this.active || !roll || !actor || roll.die !== "d10" || !CHECKS.includes(Bridge.kindOf(roll))) return;
    const n = (roll[MODULE_ID] ??= {});
    n.actorId = actor.id;
    const root = Compat.element(html);
    const form = root?.querySelector?.("form") ?? root;
    if (!form) return;
    form.querySelector(".ncm-roll-bar")?.remove();
    const bar = document.createElement("div");
    bar.className = "neon-combat ncm-roll-bar";
    bar.innerHTML = this._barHtml(actor, n);
    const grid = form.querySelector(".dialog-grid");
    if (grid) grid.before(bar);
    else form.prepend(bar);
    // Riding the Edge: no +1-a-point LUCK; Push the Limit is the in-dialog way to spend it.
    if (Settings.get("rideEdge")) {
      const luck = form.querySelector("input[name=luck]");
      if (luck) {
        luck.value = 0;
        luck.closest("li.dialog-item")?.classList.add("ncm-hide-luck");
      }
    }
    bar.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-bar]");
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      this._barAction(app, actor, n, btn.dataset.bar).catch((err) => ui.notifications.warn(err.message));
    });
    bar.addEventListener("change", (ev) => {
      if (ev.target.name !== "ncmPush") return;
      n.push = ev.target.checked ? Stakes.luck(actor).max : 0;
    });
    app.setPosition?.({ height: "auto" });
  },

  _barHtml(actor, n) {
    const gm = game.user.isGM;
    const luck = Stakes.luck(actor);
    const opts = Stakes.options(actor);
    const raised = Stakes.pendingRaise(actor);
    const b = (bar, icon, label, extra = "") => `<button type="button" data-bar="${bar}"${extra}><i class="fa-solid ${icon}"></i> ${esc(label)}</button>`;
    let stakes;
    if (n.plot) {
      stakes = `<span class="ncm-roll-plot kind-${n.plot.kind}"><b>${esc(String(n.plot.face || "★"))}</b> ${esc(L(`${LANG}.Stakes.Face.${n.plot.kind}`, { bonus: n.plot.bonus }))}</span>`;
    } else if (gm || raised) {
      stakes = b("plot", "fa-dice-six", L(`${LANG}.Roller.RollPlot`)) + (raised && opts.forceFate ? b("force", "fa-star", L(`${LANG}.Stakes.ForceFate`, { cost: 3 })) : "");
    } else if (opts.ask) {
      stakes = b("ask", "fa-hand", L(`${LANG}.Stakes.AskButton`));
    } else stakes = `<small>${esc(L(`${LANG}.Roller.NoStakes`))}</small>`;
    const edge = Settings.get("rideEdge")
      ? `<label class="ncm-roll-push${luck.value < 2 ? " is-off" : ""}" data-tooltip="${esc(L(`${LANG}.Roller.PushHint`, { stat: luck.max }))}"><input type="checkbox" name="ncmPush" ${n.push ? "checked" : ""} ${luck.value < 2 ? "disabled" : ""}> ${esc(L(`${LANG}.Roller.PushLabel`, { stat: luck.max }))}</label>`
      : "";
    return `<div class="ncm-roll-row"><span class="ncm-kicker">// ${esc(L(`${LANG}.Stakes.Kicker`))}${raised && !n.plot ? ` · ${esc(L(`${LANG}.Roller.Raised`))}` : ""}</span>${stakes}</div>`
      + (edge ? `<div class="ncm-roll-row"><span class="ncm-kicker">// ${esc(L(`${LANG}.Roller.EdgeKicker`))} · LUCK ${luck.value}/${luck.max}</span>${edge}</div>` : "");
  },

  async _barAction(app, actor, n, what) {
    const raised = Stakes.pendingRaise(actor);
    if (what === "ask") {
      await Stakes.ask(actor, app.rollData.rollTitle ?? "");
      ui.notifications.info(L(`${LANG}.Stakes.Asked`));
      return;
    }
    if (n.plot) return;
    if (what === "plot") {
      if (!game.user.isGM && !raised) throw new Error(L(`${LANG}.Roller.NotRaised`));
      const r = await new Roll("1d6").evaluate();
      await game.dice3d?.showForRoll?.(r, game.user, true);
      n.plot = plotResult(r.total);
    } else if (what === "force") {
      await Stakes.forceFate(actor, { inline: true });
      n.plot = { ...plotResult(6), face: 0 };
      if (raised) await Stakes.markDone(raised);
      return this._refreshBar(app, actor, n);
    }
    if (raised) await Stakes.markDone(raised);
    n.stakesBonus = n.plot.bonus;
    if (what === "plot") await Stakes.result(actor, n.plot, { inline: true });
    return this._refreshBar(app, actor, n);
  },

  _refreshBar(app, actor, n) {
    const bar = Compat.element(app.element)?.querySelector?.(".ncm-roll-bar");
    if (bar) bar.innerHTML = this._barHtml(actor, n);
    app.setPosition?.({ height: "auto" });
  }
};
