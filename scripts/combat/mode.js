import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Ladder } from "../roller/ladder.js";
import { LADDER } from "../roller/rules.js";
import { L } from "../util.js";

export const MODES = ["combat", "stealth"];

/**
 * Stealth segments: a combat run Turn by Turn while nobody has been spotted. The Initiative
 * Queue, Turns, Rounds and their seconds of world time, Turn automation and Death Saves all work
 * as in a fight. What a fight sets off (the Awareness Ladder going to Alert) waits until the GM
 * calls full combat, mid-segment if need be, with the Initiative order kept.
 *
 * Kept on the combat (flags[MODULE].mode); the world setting picks it for a combat begun from
 * Foundry's tracker or a macro. flags[MODULE].engaged notes that this stretch of full combat has
 * already raised the Ladder, so the GM can lower it again without the next Round undoing it.
 * Hook cpr-neon-combat-manager.encounterMode (combat, mode) fires when a combat under way changes.
 */
export const EncounterMode = {
  init() {
    Hooks.on("updateCombat", (combat, changed) => {
      if (!Compat.isActiveGM || !("round" in (changed ?? {})) || !combat.started) return;
      this.onRound(combat).catch((err) => console.error(`${MODULE_ID} | encounter mode`, err));
    });
  },

  /** The mode a combat begins in when the GM doesn't pick one. */
  get default() {
    const d = Settings.get("encounterMode");
    return MODES.includes(d) ? d : "combat";
  },

  get(combat) {
    const m = combat?.flags?.[MODULE_ID]?.mode;
    return MODES.includes(m) ? m : this.default;
  },

  isStealth(combat) {
    return !!combat && this.get(combat) === "stealth";
  },

  /** A new Round (the first one too): stamp the mode on a combat begun elsewhere; full combat engages. */
  async onRound(combat) {
    if (!MODES.includes(combat.getFlag(MODULE_ID, "mode"))) await combat.setFlag(MODULE_ID, "mode", this.default);
    if (!this.isStealth(combat)) await this.engage(combat);
  },

  /** Begin the combat in this mode (the carousel's Sneak and Start). */
  async begin(combat, mode = this.default) {
    if (!combat) return null;
    await combat.setFlag(MODULE_ID, "mode", MODES.includes(mode) ? mode : this.default);
    return combat.startCombat();
  },

  /**
   * Switch a combat between stealth and full combat. Before it begins, that's the mode it will
   * begin in; under way, everyone gets a card, nothing about the queue changes, and full combat
   * raises the Ladder.
   */
  async set(combat, mode) {
    if (!combat || !MODES.includes(mode) || !game.user.isGM) return;
    const was = this.get(combat);
    await combat.setFlag(MODULE_ID, "mode", mode);
    if (mode === "stealth") await combat.setFlag(MODULE_ID, "engaged", false);
    if (!combat.started || was === mode) return;
    if (mode === "combat") await this.engage(combat);
    await this.card(combat, mode);
    Hooks.callAll(`${MODULE_ID}.encounterMode`, combat, mode);
  },

  toggle(combat) {
    return this.set(combat, this.isStealth(combat) ? "combat" : "stealth");
  },

  /** Full combat: the enemies are at Alert at least, once for this stretch (settings). */
  async engage(combat) {
    if (combat.getFlag(MODULE_ID, "engaged")) return;
    await combat.setFlag(MODULE_ID, "engaged", true);
    if (!Settings.get("awarenessLadder") || !Settings.get("combatRaisesAlert")) return;
    if (LADDER.indexOf(Ladder.level(combat)) < LADDER.indexOf("alert")) await Ladder.set(combat, "alert");
  },

  /** For the carousel: { mode, stealth, label, hint, switchHint }. */
  context(combat) {
    const mode = this.get(combat);
    const other = mode === "stealth" ? "combat" : "stealth";
    return {
      mode,
      stealth: mode === "stealth",
      label: L(`${LANG}.Mode.${mode}`),
      hint: L(`${LANG}.Mode.Hint.${mode}`),
      switchHint: L(`${LANG}.Mode.Switch.${other}`)
    };
  },

  card(combat, mode) {
    return import("./cards.js").then(({ Cards }) => Cards.post({
      kicker: L(`${LANG}.Mode.Card.${mode}Kicker`),
      title: L(`${LANG}.Mode.Card.${mode}`),
      body: `<p>${L(`${LANG}.Mode.Card.Body`, { round: combat.round })}</p>`,
      tone: mode === "combat" ? "red" : "cyan",
      whisper: null
    }));
  }
};
