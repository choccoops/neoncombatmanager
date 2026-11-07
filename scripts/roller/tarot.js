import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { Registry } from "../conditions/registry.js";
import { ARCANA, draw } from "./rules.js";
import { L, esc } from "../util.js";

const IMG = `modules/${MODULE_ID}/assets/icons/tarot.svg`;

/**
 * Tarot Criticals (2070 Core Rules, from the Night City Tarot DLC): a damage roll with three 6s
 * or more on one target draws a Major Arcana card instead of the normal Critical Injury. One card
 * a session; the deck isn't shuffled until the campaign has seen every card. The deck lives in
 * the world setting "tarotDeck"; a session is the Plot Die's (New session in its window).
 */
export const Tarot = {
  /** The GM is offered a draw (whispered), for the damage roll's target. */
  async offer(r) {
    const actor = r.actorId ? game.actors.get(r.actorId) : null;
    const sixes = r.faces.filter((f) => f === 6).length;
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Tarot.Kicker`),
      title: L(`${LANG}.Tarot.Offer`, { sixes }),
      img: IMG,
      tone: "yellow",
      body: `<p>${L(`${LANG}.Tarot.OfferBody`)}</p>`,
      buttons: [{ action: "roller-tarot", label: L(`${LANG}.Tarot.Draw`), icon: "fa-solid fa-clone", gm: true, data: { target: r.targets?.[0] ?? "" } }],
      whisper: Cards.gms(),
      flags: { roller: { type: "tarotOffer" } }
    });
  },

  /**
   * GM: draw a card and post it (public). Asks before a second card in one session.
   * @param {string} [target] - the victim's token uuid
   */
  async draw(target = "") {
    if (!game.user.isGM) throw new Error(L(`${LANG}.Error.GMOnly`));
    const session = Settings.get("stakesSession");
    let res = draw(Settings.get("tarotDeck") ?? {}, session);
    if (res.blocked) {
      const again = await Compat.DialogV2.confirm({
        window: { title: L(`${LANG}.Tarot.Kicker`) },
        content: `<p>${esc(L(`${LANG}.Tarot.AlreadyDrawn`))}</p>`,
        rejectClose: false
      });
      if (!again) return null;
      res = draw(Settings.get("tarotDeck") ?? {}, session, { force: true });
    }
    await Settings.set("tarotDeck", res.deck);
    return this.post(res.card, target);
  },

  /** A card on the table: its effect, and what can be put on the victim in one click. */
  async post(card, target = "") {
    const victim = target ? fromUuidSync(target) : null;
    const name = victim?.name ?? victim?.actor?.name ?? "";
    const apply = card.apply.filter((id) => Registry.get(id));
    const buttons = apply.length
      ? [{ action: "roller-tarot", label: name ? L(`${LANG}.Tarot.ApplyTo`, { name: esc(name) }) : L(`${LANG}.Tarot.Apply`), icon: "fa-solid fa-hand-sparkles", gm: true, data: { apply: apply.join(","), target } }]
      : [];
    const list = apply.map((id) => esc(Registry.get(id).name)).join(", ");
    return Cards.post({
      kicker: L(`${LANG}.Tarot.Kicker`),
      title: `${esc(card.n)} · ${esc(card.name)}`,
      img: IMG,
      tone: "red",
      body: `<div class="ncm-tarot-card"><b>${esc(card.n)}</b><span>${esc(card.name)}</span></div><p>${L(`${LANG}.Tarot.Card.${card.id}`)}</p>`
        + (list ? `<p class="ncm-ref">${L(`${LANG}.Tarot.Applies`, { list })}</p>` : "")
        + `<p class="ncm-ref">${L(`${LANG}.Tarot.Rules`)}</p>`,
      buttons,
      flags: { roller: { type: "tarot", card: card.id } }
    });
  },

  /** Put a card's conditions on the victim (their Critical Injuries come as CPR's own items). */
  async apply(target, ids) {
    const victim = target ? await fromUuid(target) : null;
    const actor = victim?.actor ?? (victim?.documentName === "Actor" ? victim : null) ?? Conditions.actorsOf(null)[0] ?? null;
    if (!actor) throw new Error(L(`${LANG}.Tarot.NoTarget`));
    for (const id of ids) await Conditions.add(id, actor, { allowDuplicates: id === "foreignObject" || id === "lostEye" });
    return actor;
  },

  /** Card buttons (from the roller). */
  async click(message, btn) {
    if (!game.user.isGM) return null;
    const d = btn.dataset;
    btn.disabled = true;
    if (message.isOwner) await message.setFlag(MODULE_ID, "done", true);
    if (d.apply) return this.apply(d.target, d.apply.split(","));
    return this.draw(d.target);
  },

  /** For the Plot Die window: how many cards the campaign has seen of 22, and whether this session's is drawn. */
  status() {
    const deck = Settings.get("tarotDeck") ?? {};
    return { seen: Number(deck.seen) || 0, total: ARCANA.length, drawn: deck.session !== undefined && deck.session === Settings.get("stakesSession") };
  }
};
