import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Awareness } from "./awareness.js";
import { ABILITIES, check, step, same, normalize } from "./rules.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Combat Awareness window: a Solo's Rank in points, a stepper per ability, and one button
 * that assigns them (free before Initiative, the Solo's Action once the fight is on).
 */
export class AwarenessApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-awareness`,
    classes: ["neon-combat", "ncm-window", "ncm-awareness"],
    window: { icon: "fa-solid fa-crosshairs", resizable: false },
    position: { width: 440, height: "auto" },
    actions: {
      stepUp: AwarenessApp.#onStep,
      stepDown: AwarenessApp.#onStep,
      clearAll: AwarenessApp.#onClear,
      revert: AwarenessApp.#onRevert,
      assign: AwarenessApp.#onAssign
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/awareness.hbs` } };

  static open(actor = null) {
    this.instance ??= new this();
    if (actor) this.instance._pick(actor.id ?? actor);
    this.instance.render(true);
    return this.instance;
  }

  /** The Solo picked, and the split being worked on (null: as it stands). */
  _actorId = null;
  _draft = null;

  get title() {
    return L(`${LANG}.Awareness.Title`);
  }

  _onClose(options) {
    super._onClose?.(options);
    AwarenessApp.instance = null;
  }

  _pick(id) {
    if (id !== this._actorId) this._draft = null;
    this._actorId = id;
  }

  /** Solos to pick from: the GM's in the combat and the crew; a player's own. */
  _choices() {
    const solo = (a) => a && Awareness.isSolo(a);
    if (!game.user.isGM) return game.actors.filter((a) => a.testUserPermission(game.user, "OWNER") && solo(a));
    const combat = (game.combat?.turns ?? []).map((c) => c.actor).filter(solo);
    const crew = game.actors.filter((a) => a.hasPlayerOwner && solo(a));
    return [...new Set([...combat, ...crew])];
  }

  _actor() {
    const list = this._choices();
    const controlled = canvas?.tokens?.controlled?.[0]?.actor;
    const current = game.combat?.started ? game.combat.combatant?.actor : null;
    return list.find((a) => a.id === this._actorId)
      ?? (current && list.includes(current) ? current : null)
      ?? (controlled && list.includes(controlled) ? controlled : null)
      ?? (game.user.character && list.includes(game.user.character) ? game.user.character : null)
      ?? list[0] ?? null;
  }

  async _prepareContext() {
    const actor = this._actor();
    if (actor?.id !== this._actorId) this._pick(actor?.id ?? null);
    const choices = this._choices().map((a) => ({ id: a.id, name: a.name, selected: a.id === actor?.id }));
    if (!actor) return { actor: null, choices };
    const rank = Awareness.rank(actor);
    const now = Awareness.current(actor);
    const draft = normalize(this._draft ?? now);
    const c = check(draft, rank);
    const wasted = new Set(c.wasted.map((w) => w.key));
    const mode = Awareness.mode(actor);
    const changed = !same(draft, now);
    return {
      actor: { name: actor.name, img: actor.img },
      choices,
      rank,
      left: c.left,
      over: c.over,
      pips: Array.from({ length: rank }, (_, i) => ({ on: i < c.total })),
      rows: ABILITIES.map((ab) => {
        const points = draft[ab.key];
        return {
          key: ab.key,
          name: ab.name,
          icon: ab.icon,
          points,
          was: now[ab.key],
          changed: points !== now[ab.key],
          step: ab.ratio,
          effect: Awareness.effectText(ab.key, points),
          hint: L(`${LANG}.Awareness.Hint.${ab.key}`),
          wasted: wasted.has(ab.key),
          canUp: !same(step(draft, ab.key, 1, rank), draft),
          canDown: points > 0
        };
      }),
      mode,
      modeText: L(`${LANG}.Awareness.ModeHint.${mode}`),
      spent: Awareness.spent(actor),
      changed,
      canAssign: changed && c.ok && mode !== "wait",
      assignLabel: L(`${LANG}.Awareness.AssignAs.${mode}`)
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("select[name=actor]")?.addEventListener("change", (ev) => {
      this._pick(ev.target.value);
      this.render();
    });
  }

  _working() {
    const actor = this._actor();
    return { actor, draft: normalize(this._draft ?? (actor ? Awareness.current(actor) : {})) };
  }

  static #onStep(event, target) {
    const { actor, draft } = this._working();
    if (!actor) return;
    const dir = target.dataset.action === "stepUp" ? 1 : -1;
    this._draft = step(draft, target.closest("[data-key]").dataset.key, dir, Awareness.rank(actor));
    this.render();
  }

  static #onClear() {
    this._draft = normalize({});
    this.render();
  }

  static #onRevert() {
    this._draft = null;
    this.render();
  }

  static async #onAssign() {
    const { actor, draft } = this._working();
    if (!actor) return;
    try {
      const mode = await Awareness.assign(actor, draft);
      if (mode) ui.notifications.info(L(`${LANG}.Awareness.Done.${mode}`, { name: actor.name }));
      this._draft = null;
      this.render();
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }
}
