import { MODULE_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Registry } from "./registry.js";
import { sheetNote } from "./describe.js";

/**
 * The character sheet's Effects tab lists an effect's name, icon and changes, nothing else. A
 * condition's row also gets a line saying what it does and where it's from, so one that
 * Cyberpunk RED can't automate (EMP, Human Shield) still explains itself there. The rows are
 * CPR's own (li.effect[data-effect-id] holding the effect's uuid); a sheet without them is left as
 * it is.
 */
export const SheetNotes = {
  init() {
    for (const hook of ["renderActorSheet", "renderActorSheetV2"]) {
      Hooks.on(hook, (sheet, html) => {
        try {
          this.annotate(sheet, html);
        } catch (err) {
          console.error(`${MODULE_ID} | condition notes on the sheet`, err);
        }
      });
    }
  },

  annotate(sheet, html) {
    if (!Settings.get("conditionSheetNotes")) return 0;
    const root = typeof html?.querySelectorAll === "function" ? html : Compat.element(html) ?? Compat.element(sheet?.element);
    const actor = sheet?.actor ?? sheet?.document;
    if (!root?.querySelectorAll || !actor?.effects) return 0;
    const none = `(${game.i18n.localize("CPR.characterSheet.rightPane.effects.noBonusesConfigured")})`;
    let n = 0;
    for (const row of root.querySelectorAll("li.effect[data-effect-id]")) {
      const uuid = row.dataset.effectId;
      const effect = actor.effects.find((e) => e.uuid === uuid);
      const c = Registry.ofEffect(effect);
      const box = row.querySelector(".effect-item");
      if (!c || !box || box.querySelector(".ncm-effect-note")) continue;
      const text = sheetNote(c);
      if (!text) continue;
      // "(No bonuses configured)" says nothing useful once the note is there.
      for (const node of [...box.childNodes]) if (node.nodeType === 3 && node.textContent.trim() === none) node.remove();
      const note = document.createElement("div");
      note.className = "ncm-effect-note";
      note.textContent = text;
      box.append(note);
      n++;
    }
    return n;
  }
};
