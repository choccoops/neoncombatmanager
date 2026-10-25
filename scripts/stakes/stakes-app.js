import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Stakes } from "./stakes.js";
import { plotResult, OPPORTUNITIES, COMPLICATIONS, LUCK_NEEDS, FORCE_FATE_COST } from "./plot-die.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Plot Die window. The GM picks whose Check it is and Raises the Stakes (or grants the
 * Opportunity or Complication a crit brings); a player whose LUCK is 5+ asks the GM for it. The
 * tables are there for everyone.
 */
export class StakesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-stakes`,
    classes: ["neon-combat", "ncm-window", "ncm-stakes"],
    window: { icon: "fa-solid fa-dice-six", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      raiseStakes: StakesApp.#onRaise,
      grantOpp: StakesApp.#onGrantOpp,
      grantComp: StakesApp.#onGrantComp,
      askStakes: StakesApp.#onAsk,
      newSession: StakesApp.#onNewSession
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/stakes.hbs` } };

  static open(actor = null) {
    this.instance ??= new this();
    if (actor) this.instance._actorId = actor.id ?? actor;
    this.instance.render(true);
    return this.instance;
  }

  /** The character picked. Not `state`: AppV2 owns that name. */
  _actorId = null;

  get title() {
    return L(`${LANG}.Stakes.Title`);
  }

  _onClose(options) {
    super._onClose?.(options);
    StakesApp.instance = null;
  }

  /** Whose Check: the GM's pick from the combat and the crew; a player's own characters. */
  _choices() {
    if (!game.user.isGM) return game.actors.filter((a) => a.type === "character" && a.testUserPermission(game.user, "OWNER"));
    const combat = (game.combat?.turns ?? []).map((c) => c.actor).filter(Boolean);
    const crew = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    return [...new Set([...combat, ...crew])];
  }

  _actor() {
    const list = this._choices();
    const controlled = canvas?.tokens?.controlled?.[0]?.actor;
    const current = game.combat?.started ? game.combat.combatant?.actor : null;
    return list.find((a) => a.id === this._actorId) ?? (controlled && list.includes(controlled) ? controlled : null) ?? (current && list.includes(current) ? current : null) ?? list[0] ?? null;
  }

  async _prepareContext() {
    const actor = this._actor();
    this._actorId = actor?.id ?? null;
    const luck = actor ? Stakes.luck(actor) : { value: 0, max: 0 };
    const opts = actor ? Stakes.options(actor) : {};
    const used = actor ? Stakes.used(actor) : {};
    return {
      gm: game.user.isGM,
      actors: this._choices().map((a) => ({ id: a.id, name: a.name, selected: a.id === actor?.id })),
      actor: actor ? { name: actor.name, img: actor.img } : null,
      luck,
      opts,
      used,
      needs: LUCK_NEEDS,
      forceCost: FORCE_FATE_COST,
      faces: [1, 2, 3, 4, 5, 6].map((f) => {
        const r = plotResult(f);
        return { face: f, kind: r.kind, label: L(`${LANG}.Stakes.Face.${r.kind}`, { bonus: r.bonus }) };
      }),
      opportunities: OPPORTUNITIES.map((o) => ({ name: L(`${LANG}.Stakes.Opp.${o}`), text: L(`${LANG}.Stakes.OppText.${o}`) })),
      complications: COMPLICATIONS.map((c) => ({ name: L(`${LANG}.Stakes.Comp.${c}`), text: L(`${LANG}.Stakes.CompText.${c}`) }))
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("select[name=actor]")?.addEventListener("change", (ev) => {
      this._actorId = ev.target.value;
      this.render();
    });
  }

  _reason() {
    return this.element.querySelector("[name=reason]")?.value?.trim() ?? "";
  }

  static async #onRaise() {
    const actor = this._actor();
    if (actor) await Stakes.raise(actor, { reason: this._reason() }).catch((err) => ui.notifications.warn(err.message));
  }

  /** A crit (an exploding 10 or imploding 1) brings one without the Plot Die, at the GM's call. */
  static async #onGrantOpp() {
    const actor = this._actor();
    if (actor) await Stakes.result(actor, plotResult(6), { granted: true });
  }

  static async #onGrantComp() {
    const actor = this._actor();
    if (actor) await Stakes.result(actor, { face: 0, kind: "complication", bonus: 0 }, { granted: true });
  }

  static async #onAsk() {
    const actor = this._actor();
    if (!actor) return;
    try {
      await Stakes.ask(actor, this._reason());
      ui.notifications.info(L(`${LANG}.Stakes.Asked`));
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }

  static async #onNewSession() {
    await Stakes.newSession();
    this.render();
  }
}
