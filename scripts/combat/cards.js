import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Conditions } from "../conditions/engine.js";
import { Registry } from "../conditions/registry.js";
import { L, esc, pageLabel } from "../util.js";

/**
 * Chat cards: condition notices, Death Save prompts, hazard damage (fire, drowning, Critical
 * Injuries reopening), drugs wearing off and weather exposure, with buttons that do the work.
 */
export const Cards = {
  /** User ids who own an actor, plus the GMs. */
  owners(actor) {
    return game.users.filter((u) => u.isGM || actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);
  },

  gms() {
    return game.users.filter((u) => u.isGM).map((u) => u.id);
  },

  /**
   * Post a card.
   * @param {object} card - { actor, title, kicker, img, body, tone, buttons: [{ action, label, icon, data }], whisper }
   */
  async post({ actor = null, title, kicker = "", img = null, body = "", tone = "pink", buttons = [], whisper = null, flags = {} }) {
    const content = await Compat.renderTemplate(`${TEMPLATE_PATH}/chat-card.hbs`, {
      title,
      kicker,
      img,
      body,
      tone,
      buttons: buttons.map((b) => ({
        ...b,
        attrs: Object.entries({ actor: actor?.uuid, ...(b.data ?? {}) })
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `data-${k}="${esc(v)}"`)
          .join(" ")
      }))
    });
    const data = { content, speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: L(`${LANG}.Title`) }, flags: { [MODULE_ID]: { card: true, ...flags } } };
    if (whisper?.length) data.whisper = whisper;
    return ChatMessage.create(data);
  },

  /** A condition was added (setting: off, whispered to the GM and owners, or public). */
  async condition(actor, c, added) {
    const mode = Settings.get("conditionChat");
    if (mode === "off") return null;
    return this.post({
      actor,
      kicker: L(`${LANG}.Category.${c.category}`),
      title: L(`${LANG}.Card.${added ? "Gains" : "Loses"}`, { name: esc(actor.name), condition: esc(c.name) }),
      img: c.img,
      body: c.hint ? `<p>${esc(c.hint)}</p>${c.page ? `<p class="ncm-ref">${esc(this.page(c.page))}</p>` : ""}` : "",
      tone: c.category === "critical" || c.category === "wound" ? "red" : "cyan",
      whisper: mode === "gm" ? this.owners(actor) : null
    });
  },

  page(page) {
    return pageLabel(page);
  },

  async note(actor, html, { whisper = null, tone = "cyan", title = null } = {}) {
    return this.post({ actor, title: title ?? actor?.name ?? "", body: html, tone, whisper: whisper ?? this.owners(actor) });
  },

  /** Start of a Mortally Wounded character's Turn: roll the Death Save. */
  async deathSave(actor) {
    const ds = CPR.deathSave(actor);
    return this.post({
      actor,
      kicker: L(`${LANG}.Card.DeathSaveKicker`),
      title: L(`${LANG}.Card.DeathSave`, { name: esc(actor.name) }),
      img: Registry.get("mortallyWounded")?.img,
      body: `<p>${L(`${LANG}.Card.DeathSaveBody`, { body: CPR.stat(actor, "body"), penalty: ds.penalty })}</p>`,
      tone: "red",
      buttons: [{ action: "deathSave", label: L(`${LANG}.Card.RollDeathSave`), icon: "fa-solid fa-heart-crack" }],
      whisper: this.owners(actor)
    });
  },

  /**
   * Damage from a hazard: applied now ("auto") or offered to the GM with an Apply button ("card").
   * @param {object} hit - { amount, roll, armor, reason, condition }
   */
  async damage(actor, { amount, roll = null, armor = false, reason = "", condition = null }) {
    const mode = Settings.get("hazardDamage");
    if (mode === "off" || !amount) return null;
    const c = condition ? Registry.get(condition) : null;
    const rolled = roll ? ` <span class="ncm-roll">(${esc(roll.formula)} = ${roll.total})</span>` : "";
    if (mode === "auto" && !armor) {
      await CPR.damageHP(actor, amount, { reason });
      return this.post({
        actor,
        kicker: esc(reason),
        title: L(`${LANG}.Card.TookDamage`, { name: esc(actor.name), amount }),
        img: c?.img,
        body: `<p>${L(`${LANG}.Card.DirectDamage`)}${rolled}</p>`,
        tone: "red",
        whisper: this.owners(actor)
      });
    }
    return this.post({
      actor,
      kicker: esc(reason),
      title: L(`${LANG}.Card.Damage`, { name: esc(actor.name), amount }),
      img: c?.img,
      body: `<p>${L(armor ? `${LANG}.Card.ArmorDamage` : `${LANG}.Card.DirectDamage`)}${rolled}</p>`,
      tone: "red",
      buttons: armor ? [] : [{ action: "applyDamage", label: L(`${LANG}.Card.Apply`), icon: "fa-solid fa-droplet", data: { amount } }],
      whisper: this.owners(actor)
    });
  },

  /** A reminder at the start or end of a Turn (Spinal Injury, Damaged Ear, Suppressed...). */
  async reminder(actor, c, text) {
    return this.post({ actor, kicker: esc(c?.name ?? ""), title: esc(actor.name), img: c?.img, body: `<p>${text}</p>`, tone: "yellow", whisper: this.owners(actor) });
  },

  /** A drug wore off: Resist Torture/Drugs against its Secondary Effect DV, or addiction. */
  async secondary(actor, c) {
    const adds = Registry.get(c.secondary.adds);
    return this.post({
      actor,
      kicker: L(`${LANG}.Card.WoreOffKicker`),
      title: L(`${LANG}.Card.WoreOff`, { name: esc(actor.name), condition: esc(c.name) }),
      img: c.img,
      body: `<p>${L(`${LANG}.Card.WoreOffBody`, { dv: c.secondary.dv, addiction: esc(adds?.name ?? "") })}</p>`,
      tone: "yellow",
      buttons: [
        { action: "resist", label: L(`${LANG}.Card.Resist`, { dv: c.secondary.dv }), icon: "fa-solid fa-dice-d10", data: { dv: c.secondary.dv, adds: c.secondary.adds } },
        { action: "addCondition", label: L(`${LANG}.Card.AddCondition`, { condition: esc(adds?.name ?? "") }), icon: "fa-solid fa-plus", data: { condition: c.secondary.adds }, gm: true }
      ],
      whisper: this.owners(actor)
    });
  },

  /* ---------------------------------------- */
  /*  Buttons                                 */
  /* ---------------------------------------- */

  /** Wire a rendered card's buttons. */
  activate(message, html) {
    const root = Compat.element(html);
    if (!root || !message.getFlag?.(MODULE_ID, "card")) return;
    for (const btn of root.querySelectorAll("[data-ncm-action]")) {
      if (btn.dataset.gm === "true" && !game.user.isGM) btn.hidden = true;
      // The character's player (and the GM) spend what's theirs.
      if (btn.dataset.owner === "true" && !game.user.isGM && !fromUuidSync(btn.dataset.actor ?? "")?.isOwner) btn.hidden = true;
      if (message.getFlag(MODULE_ID, "done")) btn.disabled = true;
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        this._click(message, btn, event).catch((err) => {
          console.error(`${MODULE_ID} | card action failed`, err);
          ui.notifications?.error(err.message);
        });
      });
    }
  },

  async _click(message, btn, event) {
    const d = btn.dataset;
    const actor = d.actor ? await fromUuid(d.actor) : null;
    if (!actor) return;
    if (String(d.ncmAction).startsWith("stakes-")) {
      const { Stakes } = await import("../stakes/stakes.js");
      return Stakes.click(message, btn, event, actor);
    }
    switch (d.ncmAction) {
      case "deathSave": {
        if (!actor.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
        const result = await CPR.rollDeathSave(actor, event);
        if (result && !result.passed) await Conditions.add("dead", actor);
        return;
      }
      case "applyDamage": {
        if (!game.user.isGM && !actor.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
        btn.disabled = true;
        await CPR.damageHP(actor, Number(d.amount));
        if (message.isOwner) await message.setFlag(MODULE_ID, "done", true);
        return;
      }
      case "resist": {
        if (!actor.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
        const result = await CPR.skillCheck(actor, "Resist Torture/Drugs", { event });
        if (!result) return;
        // Beat the DV to resist.
        if (result.total <= Number(d.dv)) await Conditions.add(d.adds, actor);
        else ui.notifications?.info(L(`${LANG}.Notify.Resisted`, { name: actor.name }));
        return;
      }
      case "exposure": {
        // Weather exposure: Resist Torture/Drugs against the DV, or take the damage (and condition).
        if (!actor.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
        const result = await CPR.skillCheck(actor, "Resist Torture/Drugs", { event });
        if (!result) return;
        if (result.total > Number(d.dv)) return ui.notifications?.info(L(`${LANG}.Notify.Resisted`, { name: actor.name }));
        const { total, roll } = Conditions.formula(d.damage, actor);
        await CPR.damageHP(actor, total);
        if (d.condition) await Conditions.add(d.condition, actor);
        await this.note(actor, `<p>${L(`${LANG}.Card.TookDamage`, { name: esc(actor.name), amount: total })} <span class="ncm-roll">(${esc(roll?.formula ?? d.damage)})</span></p>`, { tone: "red" });
        return;
      }
      case "addCondition":
        if (!game.user.isGM) return;
        await Conditions.add(d.condition, actor);
        return;
      case "ablate": {
        if (!game.user.isGM) return;
        btn.disabled = true;
        await CPR.ablate(actor, "body", Number(d.amount) || 1);
        await CPR.ablate(actor, "head", Number(d.amount) || 1);
        return;
      }
      default:
    }
  }
};
