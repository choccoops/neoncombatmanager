/**
 * Neon Conditions in words: what a condition's changes do ("-2 All Actions", "MOVE minimum 1")
 * and the description its Active Effect carries (the hint, what's automated, the page).
 */
import { LANG } from "../constants.js";
import { ADD } from "./cpr-flags.js";
import { L, esc, pageLabel } from "../util.js";

/** Foundry's change modes (CONST.ACTIVE_EFFECT_MODES), by number. */
export const MODES = { CUSTOM: 0, MULTIPLY: 1, ADD, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 };

/** A change key in words: "All Actions", "REF", "Perception (sight)". */
export function keyLabel(key) {
  const k = String(key ?? "");
  const stat = k.match(/^system\.stats\.(\w+)\.(value|max)$/);
  if (stat) return stat[1].toUpperCase();
  const bonus = k.replace(/^bonuses\./, "");
  const own = `${LANG}.Key.${bonus}`;
  if (game.i18n.has(own)) return game.i18n.localize(own);
  const skill = `CPR.global.itemType.skill.${bonus}`;
  if (game.i18n.has(skill)) return game.i18n.localize(skill);
  return bonus.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** Foundry's name for a change mode other than ADD ("Custom", "Override"...), or "" for ADD. */
export function modeLabel(mode) {
  const m = mode ?? ADD;
  if (m === ADD) return "";
  const name = Object.entries(CONST.ACTIVE_EFFECT_MODES ?? {}).find(([, v]) => v === m)?.[0] ?? String(m);
  return name.charAt(0) + name.slice(1).toLowerCase();
}

/**
 * One change in words: "-2 All Actions", "+1 REF", "MOVE minimum 1". A situational change is
 * marked "*" (short) or says it's a roll-dialog toggle (long).
 */
export function changeText(ch, { long = false } = {}) {
  const mode = ch.mode ?? ADD;
  const v = Number(ch.value);
  const label = keyLabel(ch.key);
  if (mode === MODES.UPGRADE && Number.isFinite(v)) return L(`${LANG}.Effect.Minimum`, { key: label, value: v });
  if (mode === MODES.DOWNGRADE && Number.isFinite(v)) return L(`${LANG}.Effect.Maximum`, { key: label, value: v });
  if (mode !== ADD || !Number.isFinite(v)) return `${label}: ${ch.value}${mode !== ADD ? ` (${modeLabel(mode)})` : ""}`;
  const text = `${v > 0 ? "+" : ""}${v} ${label}`;
  if (!ch.situational) return text;
  if (!long) return `${text}*`;
  return L(`${LANG}.Effect.${ch.onByDefault === false ? "ToggleOff" : "ToggleOn"}`, { change: text });
}

/** What Neon Conditions does for a condition besides its changes, in words. */
export function behaviour(c) {
  const out = [];
  if (c.mirror === "wound") out.push(L(`${LANG}.Effect.WoundMirror`));
  if (c.category === "weather" || c.category === "visibility") out.push(L(`${LANG}.Effect.Environment`));
  if (c.turnStart?.damage) out.push(L(`${LANG}.Lab.TurnStartDamage`, { damage: c.turnStart.damage }));
  if (c.turnEnd?.damage) out.push(L(`${LANG}.Lab.TurnEndDamage`, { damage: c.turnEnd.damage }));
  if (c.moveDamage) out.push(L(`${LANG}.Lab.MoveDamage`, { damage: c.moveDamage }));
  if (c.moveLock || c.remindOnce) out.push(L(`${LANG}.Effect.Reminder`));
  if (c.wakeOnDamage) out.push(L(`${LANG}.Effect.Wakes`));
  if (c.also?.length) out.push(L(`${LANG}.Effect.Also`, { names: c.also.map((id) => L(`${LANG}.Condition.${id}.name`)).join(", ") }));
  if (c.heal) out.push(L(`${LANG}.Effect.Heal`));
  if (c.stabilize) out.push(L(`${LANG}.Effect.Stabilize`));
  if (c.purges?.length) out.push(L(`${LANG}.Effect.Purges`));
  if (c.secondary) out.push(L(`${LANG}.Effect.Secondary`, { dv: c.secondary.dv }));
  if (c.consume) out.push(L(`${LANG}.Effect.Consume`));
  if (c.defeated) out.push(L(`${LANG}.Effect.Defeated`));
  return out;
}

/** Does the condition do anything by itself (roll changes, damage, an item, a clock...)? */
export function isAutomated(c, changes = c.rawChanges ?? []) {
  return !!(changes.length || c.critical || behaviour(c).length);
}

/**
 * The description a condition's Active Effect carries (HTML): its hint, what Neon Conditions does
 * for it, what's left to the table, and the page.
 * @param {object} c - resolved condition
 * @param {object} [options] - changes: the effect's own (per-character, rolled, or a Critical
 *   Injury marker's extras); item: Cyberpunk RED's Critical Injury item carries the rest
 */
export function describe(c, { changes = null, item = false } = {}) {
  const list = changes ?? c.rawChanges ?? [];
  const parts = [];
  if (c.hint) parts.push(`<p>${esc(c.hint)}</p>`);
  const auto = [...(item ? [L(`${LANG}.Effect.CriticalItem`)] : []), ...list.map((ch) => changeText(ch, { long: true })), ...behaviour(c)];
  if (auto.length) parts.push(`<p><strong>${L(`${LANG}.Effect.Automated`)}</strong> ${auto.map(esc).join(" · ")}</p>`);
  else parts.push(`<p><strong>${L(`${LANG}.Effect.Manual`)}</strong></p>`);
  const page = pageLabel(c.page);
  parts.push(`<p><em>${esc(L(`${LANG}.Effect.Source`))}${page ? ` · ${esc(page)}` : ""}</em></p>`);
  return parts.join("");
}

/** The line shown under the effect on the character sheet: the hint and the page, as text. */
export function sheetNote(c) {
  const page = pageLabel(c.page);
  return [c.hint, page].filter(Boolean).join(" · ");
}
