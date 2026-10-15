import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A settings submenu: the world settings of one group (combat, conditions, environment) in a
 * Neon-styled form. One class per group, made by SettingsMenu.for().
 */
export class SettingsMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static menuId = "";
  static keys = [];

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neon-combat", "ncm-window", "ncm-settings"],
    window: { icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 600, height: "auto" },
    form: { handler: SettingsMenu.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = { form: { template: `${TEMPLATE_PATH}/settings-menu.hbs`, scrollable: [".ncm-settings-list"] } };

  /** A menu class for one group of settings. */
  static for(menuId, keys) {
    return class extends SettingsMenu {
      static menuId = menuId;
      static keys = keys;
      static DEFAULT_OPTIONS = { id: `${MODULE_ID}-menu-${menuId}` };
    };
  }

  get title() {
    return L(`${LANG}.Settings.Menu.${this.constructor.menuId}.name`);
  }

  async _prepareContext() {
    const fields = this.constructor.keys.map((key) => {
      const def = Settings.def(key);
      const value = Settings.get(key);
      const type = def.type === Boolean ? "boolean" : def.choices ? "select" : def.type === Number ? "number" : "text";
      return {
        key,
        name: L(def.name),
        hint: L(def.hint),
        type,
        value,
        checked: type === "boolean" && !!value,
        range: def.range ?? null,
        choices: def.choices ? Object.entries(def.choices).map(([v, label]) => ({ value: v, label: L(label), selected: v === value })) : null
      };
    });
    return { fields, intro: L(`${LANG}.Settings.Menu.${this.constructor.menuId}.hint`) };
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    for (const key of this.constructor.keys) {
      const def = Settings.def(key);
      let value = data[key];
      if (def.type === Boolean) value = !!value;
      else if (def.type === Number) value = Number(value);
      else value = String(value ?? "");
      if (def.type === Number && !Number.isFinite(value)) continue;
      if (value !== Settings.get(key)) await Settings.set(key, value);
    }
  }
}
