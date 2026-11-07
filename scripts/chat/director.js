import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Stage, MOODS } from "./stage.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The stage director (GM): who's on stage and on which side, their expressions, who you speak as,
 * narration, stage mode and the curtain, in one window instead of over the chat. Drop actors (or
 * tokens' actors) on it to bring them on.
 */
export class StageDirector extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-stage-director`,
    classes: ["neon-combat", "ncm-window", "ncm-st-director"],
    window: { icon: "fa-solid fa-masks-theater", resizable: true },
    position: { width: 420, height: "auto" },
    actions: {
      addSelected: StageDirector.#onAddSelected,
      narrator: StageDirector.#onNarrator,
      focus: StageDirector.#onFocus,
      curtain: StageDirector.#onCurtain,
      speak: StageDirector.#onCast,
      side: StageDirector.#onCast,
      flip: StageDirector.#onCast,
      mood: StageDirector.#onCast,
      moods: StageDirector.#onCast,
      remove: StageDirector.#onCast
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/stage-director.hbs`, scrollable: [".ncm-sd-cast"] } };

  static open() {
    this.instance ??= new this();
    Stage.director = this.instance;
    this.instance.render(true);
    return this.instance;
  }

  get title() {
    return L(`${LANG}.Stage.Director`);
  }

  _onClose(options) {
    super._onClose?.(options);
    if (Stage.director === this) Stage.director = null;
    StageDirector.instance = null;
  }

  async _prepareContext() {
    const cast = Stage.cast.map((c) => ({
      ...c,
      name: game.actors.get(c.id)?.name ?? c.name,
      img: Stage.imgOf(c),
      speaking: Stage.speaker === c.id,
      left: c.side === "left",
      moods: Object.entries(MOODS).map(([key, icon]) => ({ key, icon, on: c.mood === key, label: L(`${LANG}.Stage.Mood.${key}`) }))
    }));
    return {
      cast,
      enabled: Stage.enabled,
      narrating: Stage.narrating,
      focus: Stage.focus,
      selected: (globalThis.canvas?.tokens?.controlled ?? []).length
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (el._ncmDrop) return;
    el._ncmDrop = true;
    el.addEventListener("dragover", (ev) => ev.preventDefault());
    el.addEventListener("drop", (ev) => this.#onDrop(ev));
  }

  async #onDrop(ev) {
    ev.preventDefault();
    let data;
    try {
      data = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!["Actor", "Token"].includes(data?.type) || !data.uuid) return;
    const doc = await fromUuid(data.uuid);
    const actor = data.type === "Token" ? doc?.actor : doc;
    if (!actor) return;
    try {
      await Stage.add(actor, { speak: false });
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }

  static async #onAddSelected() {
    try {
      await Stage.add(Stage.defaultActors(), { speak: false });
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }

  static #onNarrator() {
    Stage.narrating = !Stage.narrating;
    Stage.renderDock();
    this.render();
  }

  static #onFocus() {
    return Stage.setFocus(!Stage.focus);
  }

  static #onCurtain() {
    return Stage.clear();
  }

  static async #onCast(event, target) {
    const id = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!id) return null;
    const act = target.dataset.action;
    try {
      switch (act) {
        case "speak":
          return Stage.speakAs(Stage.speaker === id ? null : id);
        case "side":
        case "flip":
          return await Stage.set({ op: act, actorId: id });
        case "mood":
          return await Stage.mood(target.dataset.mood, id);
        case "moods":
          return await Stage.editMoods(game.actors.get(id));
        case "remove":
          return await Stage.remove(id);
      }
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    return null;
  }
}
