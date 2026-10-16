import { MODULE_ID, TEMPLATE_PATH, LANG, NEON_HOME_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Links } from "./links.js";
import { ecgPath } from "./vitals.js";
import { Settings } from "../settings.js";
import { debounce, L, esc } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Biomon Link popout: a small, always-on-top readout of every linked character's vitals
 * (ECG trace, HP, status, Death Save penalty, injuries), and where a player links their
 * character to a group or starts one.
 */
export class BiomonApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-biomon`,
    classes: ["neon-combat", "ncm-window", "ncm-biomon"],
    window: { icon: "fa-solid fa-heart-pulse", resizable: true },
    position: { width: 340, height: "auto", top: 80, left: 120 },
    actions: {
      joinLink: BiomonApp.#onJoin,
      createLink: BiomonApp.#onCreate,
      leaveLink: BiomonApp.#onLeave,
      callLink: BiomonApp.#onCall,
      renameLink: BiomonApp.#onRename,
      removeLink: BiomonApp.#onRemove,
      focusMember: BiomonApp.#onFocus,
      fullBiomon: BiomonApp.#onFull
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/biomon.hbs` } };

  static open() {
    this.instance ??= new this();
    this.instance.render(true);
    return this.instance;
  }

  /** Re-render the open window (debounced: actors update in bursts). */
  static refresh = debounce(() => BiomonApp.instance?.rendered && BiomonApp.instance.render(), 120);

  get title() {
    return L(`${LANG}.Biomon.Title`);
  }

  _onClose(options) {
    super._onClose?.(options);
    BiomonApp.instance = null;
  }

  async _prepareContext() {
    const mine = Links.mine();
    const myIds = new Set(mine.map((a) => a.id));
    const hub = game.modules.get(NEON_HOME_ID);
    const links = Links.visible().map((link) => ({
      id: link.id,
      name: link.name,
      members: Links.members(link).map((actor) => {
        const v = Links.vitals(actor);
        return {
          id: actor.id,
          name: actor.name,
          img: actor.img,
          mine: myIds.has(actor.id),
          ...v,
          label: L(`${LANG}.Biomon.State.${v.state}`),
          ecg: ecgPath(v.state),
          beat: v.bpm ? `${(60 / v.bpm) * (v.state === "critical" ? 4 : v.state === "serious" ? 3 : 2)}s` : "0s",
          icons: Links.icons(actor),
          fullBiomon: !!hub?.active && typeof hub.api?.biomonitor === "function" && actor.testUserPermission(game.user, "OBSERVER")
        };
      }),
      canCall: Links.members(link).some((a) => myIds.has(a.id)) || game.user.isGM
    }));
    // Characters of this user not in any link, to join one or start one.
    const unlinked = mine.filter((a) => !Links.of(a));
    return {
      gm: game.user.isGM,
      links,
      unlinked: unlinked.map((a) => ({ id: a.id, name: a.name })),
      joinable: Links.all().map((l) => ({ id: l.id, name: l.name })),
      needsImplant: !!Settings.get("linkNeedsImplant")
    };
  }

  static async #onJoin(event, target) {
    const form = target.closest("[data-join]");
    const actor = game.actors.get(form.querySelector("[name=actor]")?.value);
    const linkId = form.querySelector("[name=link]")?.value;
    if (!actor || !linkId) return;
    await run(() => Links.join(linkId, actor));
  }

  static async #onCreate(event, target) {
    const form = target.closest("[data-join]");
    const actor = game.actors.get(form.querySelector("[name=actor]")?.value) ?? null;
    const name = form.querySelector("[name=name]")?.value;
    await run(() => Links.create(name, actor));
  }

  static async #onLeave(event, target) {
    const actor = game.actors.get(target.closest("[data-actor-id]").dataset.actorId);
    if (actor) await run(() => Links.leave(actor));
  }

  /** Holocall everyone else on the link. */
  static async #onCall(event, target) {
    const link = Links.get(target.closest("[data-link-id]").dataset.linkId);
    const { HolocallApp } = await import("./holocall-app.js");
    HolocallApp.dial({ link });
  }

  static async #onRename(event, target) {
    const link = Links.get(target.closest("[data-link-id]").dataset.linkId);
    const name = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Biomon.Rename`) },
      content: `<input type="text" name="name" value="${esc(link.name)}" autofocus>`,
      ok: { callback: (event, button) => button.form.elements.name.value },
      rejectClose: false
    });
    if (name) await run(() => Links.rename(link.id, name));
  }

  static async #onRemove(event, target) {
    const link = Links.get(target.closest("[data-link-id]").dataset.linkId);
    const ok = await Compat.DialogV2.confirm({ window: { title: L(`${LANG}.Biomon.Remove`) }, content: `<p>${L(`${LANG}.Biomon.RemoveConfirm`, { name: link.name })}</p>` });
    if (ok) await run(() => Links.remove(link.id));
  }

  /** Click a readout: look at that character's token, or open their sheet if you may. */
  static #onFocus(event, target) {
    const actor = game.actors.get(target.closest("[data-actor-id]").dataset.actorId);
    const token = actor?.getActiveTokens?.(true, false)?.[0];
    if (token?.visible) canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
    else if (actor?.testUserPermission(game.user, "OBSERVER")) Compat.openSheet(actor);
  }

  /** Neon At Home's full Biomonitor for that character. */
  static #onFull(event, target) {
    const actor = game.actors.get(target.closest("[data-actor-id]").dataset.actorId);
    game.modules.get(NEON_HOME_ID)?.api?.biomonitor?.(actor);
  }
}

async function run(fn) {
  try {
    await fn();
  } catch (err) {
    ui.notifications.warn(err.message);
  }
}
