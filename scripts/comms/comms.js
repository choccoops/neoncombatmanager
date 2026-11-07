import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Links } from "./links.js";
import { Phone } from "./phone.js";
import { alarm } from "./vitals.js";
import { L } from "../util.js";

/**
 * Comms: the Biomon Link wired into Foundry, and Holocall buttons that ring through Night City
 * Messenger's phone (see phone.js). A token-control button and a keybinding open the Biomon;
 * actor changes refresh the vitals and sound the link's alarms.
 */
export const Comms = {
  /** Last vitals per linked character, for the alarms. */
  _vitals: new Map(),

  init() {
    game.keybindings.register(MODULE_ID, "openBiomon", {
      name: `${LANG}.Biomon.Title`,
      hint: `${LANG}.Biomon.KeyHint`,
      editable: [],
      onDown: () => {
        this.openBiomon();
        return true;
      }
    });

    // Holocall straight from an actor: the Actors directory's menu and the sheet header.
    for (const hook of ["getActorDirectoryEntryContext", "getActorContextOptions"]) {
      Hooks.on(hook, (html, options) => this.actorMenu(options));
    }
    Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
      const b = this.sheetButton(sheet.actor ?? sheet.object);
      if (b) buttons.unshift({ label: b.label, class: "ncm-holo-sheet", icon: b.icon, onclick: b.onClick });
    });
    Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
      const b = this.sheetButton(sheet.actor ?? sheet.document);
      if (b) controls.unshift({ label: b.label, icon: b.icon, action: "ncmHolocall", onClick: b.onClick });
    });

    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-biomon", title: `${LANG}.Biomon.Title`, icon: "fa-solid fa-heart-pulse", onClick: () => this.openBiomon() }
    ]));

    Hooks.on(`${MODULE_ID}.linksChanged`, () => {
      this.seed();
      this.refreshBiomon();
    });
    for (const h of ["updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "deleteItem"]) {
      Hooks.on(h, (doc) => this.onActor(doc?.documentName === "Actor" ? doc : doc?.parent));
    }
    // Night City Messenger starts after this module: redraw what offers a call once it's up.
    Hooks.once("night-city-messenger.apiReady", () => this.refreshBiomon());
  },

  ready() {
    this.seed();
  },

  async openBiomon() {
    const { BiomonApp } = await import("./biomon-app.js");
    return BiomonApp.open();
  },

  /**
   * Holocall with an actor, through Night City Messenger: your own character (the GM: an NPC)
   * opens its phone; anyone else is called.
   * @returns {{ label, icon, onClick } | null}
   */
  holoFor(actor) {
    if (!actor || !["character", "mook"].includes(actor.type) || !Phone.on) return null;
    if (game.user.isGM && !actor.hasPlayerOwner) {
      return { label: L(`${LANG}.Holocall.CallAsActor`, { name: actor.name }), icon: "fa-solid fa-phone-volume", onClick: () => Phone.open(actor) };
    }
    if (actor.isOwner && !game.user.isGM) return { label: L(`${LANG}.Holocall.Title`), icon: "fa-solid fa-phone-volume", onClick: () => Phone.open(actor) };
    return { label: L(`${LANG}.Holocall.CallActor`, { name: actor.name }), icon: "fa-solid fa-phone", onClick: () => Phone.call(actor) };
  },

  sheetButton(actor) {
    const b = this.holoFor(actor);
    return b ? { ...b, label: L(`${LANG}.Holocall.SheetButton`) } : null;
  },

  /** Actors directory entries: "Holocall as <NPC>" for the GM, "Holocall <name>" for anyone. */
  actorMenu(options) {
    const idOf = (li) => {
      const el = li?.[0] ?? li;
      return el?.dataset?.documentId ?? el?.dataset?.entryId;
    };
    options.push({
      name: `${LANG}.Holocall.MenuEntry`,
      icon: '<i class="fa-solid fa-phone-volume"></i>',
      condition: (li) => !!this.holoFor(game.actors.get(idOf(li))),
      callback: (li) => this.holoFor(game.actors.get(idOf(li)))?.onClick()
    });
  },

  async refreshBiomon() {
    const { BiomonApp } = await import("./biomon-app.js");
    BiomonApp.refresh();
  },

  /* ---------------------------------------- */
  /*  Vitals                                  */
  /* ---------------------------------------- */

  /** Remember the vitals of every character in a link this user watches. */
  seed() {
    this._vitals.clear();
    for (const link of Links.visible()) for (const a of Links.members(link)) this._vitals.set(a.id, Links.vitals(a));
  },

  /** A linked character changed: refresh the readouts, and raise the alarm if they crashed. */
  onActor(actor) {
    if (!actor?.id || !this._vitals.has(actor.id)) return;
    const before = this._vitals.get(actor.id);
    const after = Links.vitals(actor);
    this._vitals.set(actor.id, after);
    this.refreshBiomon();
    const state = alarm(before, after);
    const mode = Settings.get("biomonAlerts");
    if (!state || mode === "off") return;
    const text = L(`${LANG}.Biomon.Alarm`, { name: actor.name, state: L(`${LANG}.Biomon.State.${state}`), penalty: after.deathSave ?? 0 });
    if (state === "flatline") ui.notifications.error(text);
    else ui.notifications.warn(text);
    if (mode === "open") this.openBiomon();
  }
};
