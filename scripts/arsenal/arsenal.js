import { MODULE_ID, LANG, SYSTEM_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { Core } from "../neonfx/core.js";
import { Bridge } from "../roller/bridge.js";
import { classify, profileKeys, smartBaked } from "./kinds.js";
import { soundPlan } from "./profile.js";
import { Rebuilds, RebuildRegistry, REBUILD_HOOK, traitsOf, attackMods, damageArgs } from "./rebuilds.js";
import { AA, loadedAmmo } from "./aa.js";
import { Blast, damageFromHtml } from "./blast.js";
import { Dv } from "./dv.js";
import { Sound } from "./sound.js";
import { L, esc } from "../util.js";

/** How long a roll waits for its card. */
const PENDING_MS = 30000;
/** An Improved Smart retry: 14 + 1d10 for a miss by 5 or less (2070 Core Rules Ch07). */
export const SMART_RETRY = { base: 14, within: 5 };

/** The kind of a CPR roll, with or without the roller bridge loaded. */
export function rollKind(roll) {
  if (Bridge.rolls) {
    const k = Bridge.kindOf(roll);
    return k === "attack" || k === "damage" ? k : null;
  }
  const name = String(roll?.constructor?.name ?? "");
  if (/DamageRoll/.test(name)) return "damage";
  if (/(Attack|Autofire|SuppressiveFire)Roll/.test(name)) return "attack";
  return null;
}

/**
 * Does a shot hit each target, pure: [{ name, dv, hit, by, dodge, mult }]. A Check must beat the
 * DV (a tie misses). Autofire's damage is 2d6 times what it beat the DV by, up to the weapon's
 * number (Ch07, Firing Modes). Someone with REF 8+ can dodge bullets: their Evasion roll counts too.
 * @param {number} total
 * @param {object[]} targets - { name, dv, ref }
 */
export function hitLines(total, targets, { autofire = false, cap = 0 } = {}) {
  return (targets ?? []).filter((t) => Number.isFinite(Number(t.dv)) && t.dv !== null).map((t) => {
    const by = Number(total) - Number(t.dv);
    const hit = by > 0;
    return { name: t.name, dv: Number(t.dv), hit, by: hit ? by : 1 - by, dodge: Number(t.ref) >= 8, mult: autofire && hit ? Math.min(by, Number(cap) || by) : 0 };
  });
}

/** Can an Improved Smart round try again (a miss by 5 or less)? */
export const smartRetry = (total, dv) => Number.isFinite(Number(dv)) && Number(total) <= Number(dv) && Number(dv) - Number(total) <= SMART_RETRY.within;

/**
 * Neon Arsenal: Cyberpunk RED's weapons in the 2070s, at the table. Automated Animations' looks
 * (with Diwako's muzzle flashes), sounds, area attacks that place their own template, and the
 * weapon traits a 2070 gun or a Rebuild gives (Power ricochets, Tech charges, Smart's +1,
 * Melee Rebuilds). It all starts where Cyberpunk RED confirms a roll (CPRItem#confirmRoll),
 * which the sheet, the roll card's Damage button, CPR's macros and the Action HUD all go through.
 */
export const Arsenal = {
  pending: null,

  init() {
    Sound.init();
    AA.init();
    Blast.init();
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
      this.tag(message, userId);
      return this.diwakoHit(message, userId);
    });
    Hooks.on("createChatMessage", (message, options, userId) => this.onCard(message, userId).catch((err) => console.error(`${MODULE_ID} | arsenal`, err)));
    Hooks.on(Compat.chatRenderHook, (message, html) => this.decorate(message, html));
    Socket.on("arsenalPush", (data) => this.pushAsGM(data));
    Socket.on("arsenalConditions", (data) => this.conditionsAsGM(data));
  },

  /** Modules add their rebuilds now (Neon At Home: the Melee Rebuilds, the Ricochet Compensator). */
  setup(api) {
    Hooks.callAll(REBUILD_HOOK, api);
  },

  async ready() {
    this.patch();
    Dv.installDisplay();
    await AA.ready().catch((err) => console.error(`${MODULE_ID} | Automated Animations profile`, err));
  },

  /** Wrap CPR's confirmRoll (once): it runs right before the dice, for every way a roll is made. */
  patch() {
    const proto = CONFIG.Item?.documentClass?.prototype;
    if (!proto || typeof proto.confirmRoll !== "function" || proto[`${MODULE_ID}Arsenal`]) return false;
    proto[`${MODULE_ID}Arsenal`] = true;
    const confirm = proto.confirmRoll;
    const self = this;
    proto.confirmRoll = async function (cprRoll, ...rest) {
      const out = (await confirm.call(this, cprRoll, ...rest)) ?? cprRoll;
      try {
        await self.preRoll(this, out);
      } catch (err) {
        console.error(`${MODULE_ID} | arsenal (before the dice)`, err);
      }
      return out;
    };
    return true;
  },

  tokenFor(actor) {
    const controlled = (canvas?.tokens?.controlled ?? []).find((t) => t.actor?.id === actor.id);
    return controlled ?? actor.getActiveTokens?.()?.[0] ?? null;
  },

  /** Before the dice: traits on the roll, an area placed, the DV it faces. */
  async preRoll(item, roll) {
    const actor = item?.actor;
    const kind = rollKind(roll);
    if (!actor || !kind || !["weapon", "cyberware"].includes(item.type)) return;
    const ammo = loadedAmmo(item, actor);
    const upgrades = Rebuilds.upgradesOf(item, actor);
    const info = classify(item, ammo, upgrades);
    const traits = traitsOf(info.flavor, upgrades);
    const mode = actor.flags?.[SYSTEM_ID]?.[`firetype-${item.id}`] || "single";
    const state = Rebuilds.state(actor, item);
    const token = this.tokenFor(actor);
    const targets = [...(game.user.targets ?? [])];
    const tag = {
      kind, actorId: actor.id, itemId: item.id, tokenId: token?.id ?? null, mode, weapon: info.kind, flavor: info.flavor,
      ammoType: info.ammoType, ammoVariety: info.ammoVariety, explosive: info.explosive, area: !!info.area, ranged: info.ranged,
      tags: traits.tags, sources: traits.sources, targets: targets.map((t) => t.id), ricochet: false, charged: false, dv: null
    };
    const rebuilds = !!Settings.get("arsenalRebuilds");
    if (kind === "attack") {
      const aimed = mode === "aimed" || (Bridge.rolls?.CPRAimedAttackRoll && roll instanceof Bridge.rolls.CPRAimedAttackRoll);
      if (rebuilds) {
        const ricochet = !!state.ricochet && info.ranged && !info.explosive;
        const mods = attackMods(traits, { ranged: info.ranged, aimed, ricochet, linked: Rebuilds.linked(actor), baked: smartBaked(item, upgrades) });
        if (mods.length && typeof roll.addMod === "function") roll.addMod(mods);
        tag.ricochet = ricochet;
        if (state.ricochet) await Rebuilds.setState(actor, item, { ricochet: false });
        if (traits.active.includes("charge") && Rebuilds.isCharged(actor, item) && !info.explosive) {
          tag.charged = true;
          await Rebuilds.setState(actor, item, { chargedUntil: 0, fired: true });
          this.chargeLook(token, item, false);
        }
      }
      if (info.area && Blast.on && mode !== "suppressive" && mode !== "aimed" && token) {
        await Blast.place({ area: info.area, actor, item, token, info, ammo });
      } else if (targets[0] && token && info.ranged) {
        // The DV each target stands at (a ROF 2 attack can split between two).
        tag.hits = [];
        for (const t of targets) {
          const dv = await Dv.forWeapon(item, Dv.distance(token, t), { autofire: mode === "autofire" });
          tag.hits.push({ name: t.name, dv, ref: CPR.stat(t.actor, "ref") });
        }
        tag.dv = tag.hits[0]?.dv ?? null;
        tag.cap = Number(item.system?.fireModes?.autoFire) || 0;
      }
    }
    if (kind === "damage" && rebuilds) {
      const charged = !!state.fired;
      const extra = (roll.rollCardExtraArgs ??= {});
      const args = damageArgs(traits, { bonusDamage: roll.bonusDamage, ignoreBelowSP: extra.ignoreBelowSP, ignoreArmorPercent: extra.ignoreArmorPercent, charged });
      roll.bonusDamage = args.bonusDamage;
      extra.ignoreBelowSP = args.ignoreBelowSP;
      extra.ignoreArmorPercent = args.ignoreArmorPercent;
      tag.charged = charged;
      tag.push = info.area ? null : traits.push;
      if (charged) await Rebuilds.setState(actor, item, { fired: false });
    }
    this.pending = { tag, roll, at: Date.now() };
  },

  /** The roll's card, about to be posted (the roller's client): it carries what Neon Arsenal saw. */
  tag(message, userId) {
    const p = this.pending;
    if (!p || userId !== game.user.id || Date.now() - p.at > PENDING_MS || !String(message.content ?? "").includes('class="rollcard"')) return;
    this.pending = null;
    message.updateSource({ [`flags.${MODULE_ID}.arsenal`]: { ...p.tag, total: Number(p.roll.resultTotal) || 0, at: Date.now() } });
  },

  /**
   * Diwako's "Does it hit?" message reads "<table> (Autofire)", which the 2070 guns don't have;
   * with Neon Arsenal's own check on the card, it's kept out of the chat (it has no setting).
   */
  diwakoHit(message, userId) {
    if (userId !== game.user.id || !Settings.get("arsenalHitCheck") || !Settings.get("arsenalHideDiwakoHit") || !game.modules.get("diwako-cpred-additions")?.active) return true;
    return !/^<div class="cpr-block" style="padding:10px;background-color:/.test(String(message.content ?? ""));
  },

  /** The card is posted (the roller's client): sounds, the area, pushes. */
  async onCard(message, userId) {
    if (userId !== game.user.id) return;
    const a = message.flags?.[MODULE_ID]?.arsenal;
    if (!a) return;
    if (a.kind === "attack") {
      const keys = profileKeys({ kind: a.weapon, flavor: a.flavor, ammoType: a.ammoType });
      if (a.tags?.[0]) keys.unshift(`${keys.at(-1)} · ${a.tags[0]}`);
      const hit = a.dv !== null && a.dv !== undefined ? a.total > a.dv : false;
      for (const s of soundPlan(keys, { mode: a.mode, ricochet: a.ricochet, hit, ranged: a.ranged, explosive: a.explosive })) {
        Sound.play(s.key, { delay: s.delay });
      }
      if (a.area) {
        const doc = Blast.find(a.actorId, a.itemId, { states: ["placed"] });
        if (doc) await Blast.onAttack({ ...a, messageId: message.id }, doc);
      }
    }
    if (a.kind === "damage") {
      const scene = canvas?.scene?.id;
      if (a.push && a.targets?.length) await Socket.request("arsenalPush", { scene, tokens: a.targets, from: a.tokenId, ...a.push });
      if (a.charged && a.ammoVariety === "shotgunSlug" && a.targets?.length) await Socket.request("arsenalConditions", { scene, tokens: a.targets, ids: ["prone"] });
    }
  },

  /* ---------------------------------------- */
  /*  On the cards                            */
  /* ---------------------------------------- */

  /** Notes and buttons under CPR's attack and damage cards. */
  decorate(message, html) {
    const a = message.flags?.[MODULE_ID]?.arsenal;
    const root = Compat.element(html);
    const card = root?.querySelector?.(".rollcard");
    if (!a || !card || root.querySelector(".ncm-arsenal")) return;
    const notes = [];
    const buttons = [];
    if (a.kind === "attack" && a.mode !== "suppressive" && a.hits?.length && Settings.get("arsenalHitCheck")) {
      for (const h of hitLines(a.total, a.hits, { autofire: a.mode === "autofire", cap: a.cap })) {
        let line = L(`${LANG}.Arsenal.HitCheck.${h.hit ? "hit" : "miss"}`, { name: esc(h.name), dv: h.dv, by: h.by });
        if (h.mult) line += ` ${L(`${LANG}.Arsenal.HitCheck.autofire`, { mult: h.mult })}`;
        if (h.dodge && !a.ricochet) line += ` ${L(`${LANG}.Arsenal.HitCheck.dodge`)}`;
        notes.push(`<span class="ncm-hit ${h.hit ? "is-hit" : "is-miss"}">${line}</span>`);
      }
    }
    if (a.kind === "attack" && a.ricochet) notes.push(L(`${LANG}.Arsenal.Note.ricochet`));
    if (a.kind === "attack" && a.charged) notes.push(L(`${LANG}.Arsenal.Note.chargedAttack`));
    if (a.kind === "damage" && a.charged) notes.push(L(`${LANG}.Arsenal.Note.chargedDamage`));
    if (a.kind === "damage" && a.sources?.length && Settings.get("arsenalRebuilds")) notes.push(L(`${LANG}.Arsenal.Note.traits`, { list: esc(a.sources.map((s) => this.sourceLabel(s)).join(", ")) }));
    if (a.kind === "damage" && a.push) notes.push(L(`${LANG}.Arsenal.Note.push`, { metres: a.push.metres }));
    const actor = game.actors.get(a.actorId);
    if (a.kind === "attack" && a.flavor === "smart" && a.ammoType === "smart" && smartRetry(a.total, a.dv) && actor?.isOwner) {
      buttons.push(`<button type="button" data-arsenal="retry"><i class="fa-solid fa-satellite-dish"></i> ${L(`${LANG}.Arsenal.SmartRetry`, { dv: a.dv })}</button>`);
    }
    if (a.kind === "damage" && a.area && game.user.isGM) {
      const doc = Blast.find(a.actorId, a.itemId);
      if (doc) buttons.push(`<button type="button" data-arsenal="apply" data-template="${esc(doc.uuid)}"><i class="fa-solid fa-burst"></i> ${L(`${LANG}.Arsenal.ApplyArea`)}</button>`);
    }
    if (!notes.length && !buttons.length) return;
    const box = document.createElement("div");
    box.className = "ncm-arsenal neon-combat-chat";
    box.innerHTML = `${notes.map((n) => `<p class="ncm-ref">${n}</p>`).join("")}${buttons.length ? `<footer>${buttons.join("")}</footer>` : ""}`;
    card.after(box);
    box.querySelector("[data-arsenal=apply]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      Blast.askAndApply(ev.currentTarget.dataset.template, damageFromHtml(message.content)).catch((err) => ui.notifications.error(err.message));
    });
    box.querySelector("[data-arsenal=retry]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      this.smartRetry(message).catch((err) => ui.notifications.error(err.message));
    });
  },

  sourceLabel(s) {
    return ["power", "smart", "tech"].includes(s) ? L(`${LANG}.Arsenal.Flavor.${s}`) : s;
  },

  /** Improved Smart Ammunition: a miss by 5 or less tries again at 14 + 1d10 (the first shot's penalties still apply). */
  async smartRetry(message) {
    const a = message.flags[MODULE_ID].arsenal;
    if (a.retried) return null;
    const roll = await new Roll(`${SMART_RETRY.base} + 1d10`).evaluate();
    await message.setFlag(MODULE_ID, "arsenal.retried", true).catch(() => null);
    const actor = game.actors.get(a.actorId);
    const hit = roll.total > a.dv;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${L(`${LANG}.Arsenal.SmartRetryFlavor`)} · ${L(`${LANG}.Arsenal.${hit ? "Hit" : "Miss"}`, { total: roll.total, dv: a.dv })}`
    });
  },

  /** Card buttons (routed here by Cards): apply an area, roll a save against ammo. */
  async click(message, btn, event, actor) {
    const d = btn.dataset;
    switch (d.ncmAction) {
      case "arsenal-apply":
        if (!game.user.isGM) return null;
        return Blast.askAndApply(d.template);
      case "arsenal-save": {
        if (!actor?.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
        const skill = CPR.skill(actor, d.skill);
        const result = await CPR.skillCheck(actor, d.skill, { event, stat: skill?.system?.stat ?? (/cybertech/i.test(d.skill) ? "tech" : "will") });
        if (!result) return null;
        btn.disabled = true;
        // Beat the DV to resist.
        if (result.total > Number(d.dv)) return ui.notifications?.info(L(`${LANG}.Notify.Resisted`, { name: actor.name }));
        const adds = String(d.adds ?? "").split(",").filter(Boolean);
        if (adds.length) await Conditions.add(adds, actor);
        if (d.direct) {
          const r = await new Roll(d.direct).evaluate();
          await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: L(`${LANG}.Arsenal.Direct`, { name: actor.name }) });
          await CPR.damageHP(actor, r.total, { reason: "arsenal" });
        }
        return null;
      }
      default:
        return null;
    }
  },

  /* ---------------------------------------- */
  /*  The switches                            */
  /* ---------------------------------------- */

  traitsFor(item) {
    const actor = item?.actor;
    const upgrades = Rebuilds.upgradesOf(item, actor);
    const info = classify(item, loadedAmmo(item, actor), upgrades);
    return traitsOf(info.flavor, upgrades);
  },

  /** A HUD or macro switch: "ricochet" or "charge". */
  async toggle(actor, item, which, { token = null } = {}) {
    if (!actor?.isOwner || !item) return null;
    const t = token ?? this.tokenFor(actor);
    if (which === "ricochet") {
      const on = await Rebuilds.toggleRicochet(actor, item);
      ui.notifications.info(L(`${LANG}.Arsenal.${on ? "RicochetOn" : "RicochetOff"}`, { weapon: item.name }));
      return on;
    }
    if (which === "charge") {
      const on = await Rebuilds.toggleCharge(actor, item);
      this.chargeLook(t, item, on);
      if (on) {
        Sound.play("techCharge");
        await Cards.post({ actor, kicker: L(`${LANG}.Arsenal.Kicker`), title: L(`${LANG}.Arsenal.ChargeTitle`, { name: esc(actor.name), weapon: esc(item.name) }), tone: "cyan", body: `<p>${L(`${LANG}.Arsenal.ChargeBody`)}</p>` });
      }
      return on;
    }
    return null;
  },

  /** A charged Tech gun crackles on its token until fired. */
  chargeLook(token, item, on) {
    if (!token || !Core.sequencer || !Settings.get("fxEnabled")) return;
    const name = `ncm-arsenal-charge-${token.id}-${item.id}`;
    try {
      if (!on) return Sequencer.EffectManager.endEffects({ name, object: token });
      const file = Core.jb2a(["jb2a.static_electricity.01", "jb2a.static_electricity.02", "jb2a.static_electricity"], ["blue"]);
      if (!file) return null;
      return new Sequence({ moduleName: MODULE_ID, softFail: true }).effect().file(file).attachTo(token).scaleToObject(1.2).opacity(0.55).persist().name(name).fadeIn(400).fadeOut(400).play();
    } catch (err) {
      console.warn(`${MODULE_ID} | charge look`, err);
      return null;
    }
  },

  /** The switches for a character's weapons, as a dialog (the Weapon Rebuilds macro). */
  async menu(actor) {
    actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    if (!actor?.isOwner) return ui.notifications.warn(L(`${LANG}.Arsenal.NoActor`));
    const weapons = [...actor.items].filter((i) => (i.type === "weapon" && i.system?.equipped === "equipped") || (i.type === "cyberware" && i.system?.isWeapon && i.system?.isInstalled));
    const rows = weapons.map((w) => ({ w, buttons: Rebuilds.buttons(actor, w, this.traitsFor(w)) })).filter((r) => r.buttons.length);
    if (!rows.length) return ui.notifications.info(L(`${LANG}.Arsenal.NoSwitches`, { name: actor.name }));
    const content = rows.map((r) => `<p><strong>${esc(r.w.name)}</strong> ${r.buttons.map((b) => `<button type="button" data-key="${b.key}"${b.on ? ' class="active"' : ""}><i class="${b.icon}"></i> ${esc(b.label)}</button>`).join(" ")}</p>`).join("");
    const pick = await Compat.DialogV2.wait({
      window: { title: L(`${LANG}.Arsenal.MenuTitle`, { name: actor.name }) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      buttons: [{ action: "close", label: L(`${LANG}.Common.Close`), default: true }],
      // v12 hands render (event, html), v13 (event, dialog): the app is the event's target in both.
      render: (event, second) => {
        const app = event?.target;
        const el = app?.element ?? Compat.element(second?.element ?? second);
        el?.querySelectorAll?.("[data-key]").forEach((b) => b.addEventListener("click", () => {
          const [k, id] = b.dataset.key.split(":");
          this.toggle(actor, actor.items.get(id), k === "rico" ? "ricochet" : "charge");
          app?.close?.();
        }));
      },
      rejectClose: false
    });
    return pick;
  },

  /* ---------------------------------------- */
  /*  The GM's side                           */
  /* ---------------------------------------- */

  /** Push targets straight away from the attacker (Propulsion Impact), stopping at walls. */
  async pushAsGM({ scene, tokens = [], from, metres = 2, maxBody = null }) {
    const sc = game.scenes.get(scene);
    const src = sc?.tokens.get(from);
    if (!sc || !src) return 0;
    const grid = Blast.grid(sc);
    const center = { x: src.x + ((Number(src.width) || 1) * grid.size) / 2, y: src.y + ((Number(src.height) || 1) * grid.size) / 2 };
    let n = 0;
    for (const id of tokens) {
      const tok = sc.tokens.get(id);
      const actor = tok?.actor;
      if (!actor || (maxBody && CPR.stat(actor, "body") >= maxBody)) continue;
      const to = Blast.blowTo(tok, center, metres, grid);
      if (!to || (to.x === tok.x && to.y === tok.y)) continue;
      await tok.update({ x: to.x, y: to.y });
      if (to.wall) await Conditions.add("intoTheWall", actor);
      n++;
    }
    return n;
  },

  async conditionsAsGM({ scene, tokens = [], ids = [] }) {
    const sc = game.scenes.get(scene);
    for (const id of tokens) {
      const actor = sc?.tokens.get(id)?.actor;
      if (actor) await Conditions.add(ids, actor);
    }
    return true;
  },

  /** For Roller: a damage roll for an area draws no Tarot card (Ch07). */
  isArea(r) {
    const actor = r?.actorId ? game.actors.get(r.actorId) : null;
    const item = actor?.items?.get(r?.itemId);
    if (!item) return false;
    return !!classify(item, loadedAmmo(item, actor)).area;
  },

  registerRebuild: (def) => RebuildRegistry.register(def)
};
