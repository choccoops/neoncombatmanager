import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { L, esc } from "../util.js";

/**
 * Humanity Loss, called for by the GM: something happened (the first kill, a body horror, chrome
 * pushed too far), and these characters each roll for it. The GM writes what happened, picks how
 * much (1d6, 2d6...) and who; each of them gets a card with a button, their player rolls, and
 * the loss comes off their Humanity with a card that says so.
 *
 * The same roll serves the chrome cards (scripts/neonfx/os.js): one place takes Humanity.
 */

/** What the GM picks from; anything else is typed. */
export const FORMULAS = ["1d6", "2d6", "3d6", "4d6"];

/** A Humanity Loss amount as typed, tidied ("2D6 " -> "2d6", "3" -> "3"), or null when it isn't one. Pure. */
export function cleanFormula(text) {
  const t = String(text ?? "").replace(/\s+/g, "").toLowerCase();
  if (/^\d{1,3}$/.test(t)) return Number(t) > 0 ? String(Number(t)) : null;
  const m = /^(\d{0,2})d(\d{1,3})([+-]\d{1,3})?$/.exec(t);
  if (!m || !(Number(m[2]) > 0)) return null;
  return `${Number(m[1]) || 1}d${Number(m[2])}${m[3] ?? ""}`;
}

/** Humanity after a loss, pure: it can go below nothing (that's where Cyberpsychosis lives). */
export const afterLoss = (have, loss) => Number(have) - Math.max(0, Math.round(Number(loss) || 0));

export const Humanity = {
  init() {
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-humanity", title: `${LANG}.Humanity.Title`, icon: "fa-solid fa-brain", order: 112, visible: !!game.user?.isGM, onClick: () => this.open() }
    ]));
    // "/humanity" (or "/hl") opens it for a GM.
    Hooks.on("chatMessage", (log, message) => {
      if (!/^\/(humanity|hl)\s*$/i.test(String(message ?? ""))) return true;
      this.open();
      return false;
    });
  },

  /** Who the GM can pick: the tokens they have selected, then the players' characters. */
  candidates() {
    const out = new Map();
    const fits = (a) => a && ["character", "mook"].includes(a.type) && CPR.isMeat(a);
    for (const t of canvas?.tokens?.controlled ?? []) if (fits(t.actor)) out.set(t.actor.uuid ?? t.actor.id, { actor: t.actor, picked: true });
    for (const a of game.actors ?? []) if (fits(a) && a.hasPlayerOwner && !out.has(a.uuid ?? a.id)) out.set(a.uuid ?? a.id, { actor: a, picked: false });
    return [...out.values()];
  },

  /** The GM's window: what happened, how much, who. */
  async open() {
    if (!game.user?.isGM) {
      ui.notifications?.warn(L(`${LANG}.Humanity.GmOnly`));
      return null;
    }
    const list = this.candidates();
    if (!list.length) {
      ui.notifications?.warn(L(`${LANG}.Humanity.Nobody`));
      return null;
    }
    // With nothing selected, everyone starts ticked; with a selection, the selection does.
    const any = list.some((c) => c.picked);
    const rows = list.map((c, i) => `<label class="ncm-check"><input type="checkbox" name="who-${i}"${!any || c.picked ? " checked" : ""}> ${esc(c.actor.name)} <em>(${L(`${LANG}.Humanity.Has`, { n: Number(c.actor.system?.derivedStats?.humanity?.value) || 0 })})</em></label>`).join("");
    const content = `<div class="ncm-grid ncm-humanity">`
      + `<label>${L(`${LANG}.Humanity.What`)}<textarea name="text" rows="3" placeholder="${esc(L(`${LANG}.Humanity.WhatHint`))}"></textarea></label>`
      + `<label>${L(`${LANG}.Humanity.Amount`)}<select name="formula">${FORMULAS.map((f) => `<option value="${f}">${f}</option>`).join("")}<option value="">${L(`${LANG}.Humanity.Other`)}</option></select></label>`
      + `<label>${L(`${LANG}.Humanity.OtherAmount`)}<input type="text" name="custom" placeholder="5d6, 1d10, 3"></label>`
      + `<p class="ncm-ref">${L(`${LANG}.Humanity.Who`)}</p>${rows}</div>`;
    const picked = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Humanity.Title`) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      ok: {
        label: L(`${LANG}.Humanity.Call`),
        callback: (event, button) => {
          const f = button.form.elements;
          return { text: f.text?.value ?? "", formula: f.custom?.value?.trim() ? f.custom.value : f.formula?.value, who: list.filter((c, i) => f[`who-${i}`]?.checked).map((c) => c.actor) };
        }
      },
      rejectClose: false
    }).catch(() => null);
    if (!picked) return null;
    return this.call(picked.who, picked.formula, picked.text);
  },

  /**
   * Call for Humanity Loss (the GM): a card for each character, with the button their player rolls from.
   * @param {Actor[]} actors
   * @param {string} formula - "1d6", "2d6", "3"...
   * @param {string} [text] - what happened, in the GM's words
   */
  async call(actors, formula, text = "") {
    if (!game.user?.isGM) return [];
    const f = cleanFormula(formula);
    if (!f) {
      ui.notifications?.warn(L(`${LANG}.Humanity.BadAmount`, { formula: esc(String(formula ?? "")) }));
      return [];
    }
    const what = String(text ?? "").trim();
    const out = [];
    for (const actor of [...new Set(actors ?? [])].filter(Boolean)) {
      out.push(await Cards.post({
        actor,
        kicker: L(`${LANG}.Humanity.Kicker`),
        title: L(`${LANG}.Humanity.CardTitle`, { name: esc(actor.name), formula: f }),
        body: what ? `<p>${esc(what).replace(/\n/g, "<br>")}</p>` : "",
        tone: "red",
        buttons: [{ action: "humanity-roll", label: L(`${LANG}.Humanity.Roll`, { formula: f }), icon: "fa-solid fa-brain", owner: true, data: { formula: f, key: "event" } }],
        flags: { humanity: { formula: f, text: what } }
      }));
    }
    return out;
  },

  /**
   * Take Humanity Loss: roll it, take it off, say so. Once for a card's `key`.
   * @returns {Promise<{ loss: number, now: number }|null>}
   */
  async take(actor, formula, { message = null, key = "event", reason = "" } = {}) {
    if (!actor?.isOwner) {
      ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
      return null;
    }
    const done = message?.getFlag?.(MODULE_ID, "humanityDone") ?? message?.getFlag?.(MODULE_ID, "chromeDone") ?? {};
    if (done[key]) {
      ui.notifications?.info(L(`${LANG}.Humanity.AlreadyTaken`));
      return null;
    }
    const f = cleanFormula(formula);
    const have = Number(actor.system?.derivedStats?.humanity?.value);
    if (!f || !Number.isFinite(have)) return null;
    const { total, roll } = await Conditions.roll(f, actor);
    if (!(total > 0)) return null;
    const now = afterLoss(have, total);
    await actor.update({ "system.derivedStats.humanity.value": now });
    if (message?.isOwner) await message.setFlag(MODULE_ID, "humanityDone", { ...done, [key]: true });
    const why = reason || message?.getFlag?.(MODULE_ID, "humanity")?.text || "";
    const dice = roll ? ` <span class="ncm-roll">(${esc(f)})</span>` : "";
    await Cards.note(actor, `<p>${L(`${LANG}.Humanity.Lost`, { name: esc(actor.name), n: total, now })}${dice}</p>${why ? `<p class="ncm-ref">${esc(why).replace(/\n/g, "<br>")}</p>` : ""}`, { tone: "red", whisper: [], title: L(`${LANG}.Humanity.Kicker`) });
    return { loss: total, now };
  },

  /** A card's button. */
  async click(message, btn, event, actor) {
    if (btn.dataset.ncmAction !== "humanity-roll" || !actor) return null;
    btn.disabled = true;
    const out = await this.take(actor, btn.dataset.formula, { message, key: btn.dataset.key || "event" });
    if (!out) btn.disabled = false;
    return out;
  }
};
