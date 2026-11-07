/**
 * The 2070 Core Rules for the roller and the encounter tracker, pure (tests import them):
 * Chain Reactions (Ch.02), Riding the Edge (LUCK, Ch.02), Flash of Luck (Ch.02), Tarot Criticals
 * (Ch.07, from the Night City Tarot DLC) and the Awareness Ladder (Ch.06).
 */

/* -------------------------------------------- */
/*  Chain Reactions                             */
/* -------------------------------------------- */

/**
 * Does an exploding or imploding Check chain? The critical die (the one that's added or taken
 * off) starts a chain when it repeats the crit: a 10 after an explosion, a 1 after an implosion.
 * Each chain die that repeats it again adds a link; any other number ends the chain. Chain dice
 * never change the total.
 * @param {"explode"|"implode"} kind
 * @param {number} critDie - the first explosion or implosion die
 * @param {() => number|Promise<number>} next - rolls one more d10
 * @returns {Promise<{ kind, links: number, dice: number[] } | null>} null when it doesn't chain
 */
export async function chainFrom(kind, critDie, next) {
  const hit = kind === "explode" ? 10 : 1;
  if (critDie !== hit) return null;
  const dice = [];
  let links = 1;
  for (let guard = 0; guard < 50; guard++) {
    const d = await next();
    dice.push(d);
    if (d !== hit) break;
    links++;
  }
  return { kind, links, dice };
}

/**
 * What a chain pays out (the Chain Payouts table). Attacks and other Checks differ.
 * @returns {{ opportunities: number, complications: number, damageDice: number, autoCrit: boolean,
 *   malfunction: boolean, condition: boolean }}
 */
export function chainPayout(chain, { attack = false } = {}) {
  const out = { opportunities: 0, complications: 0, damageDice: 0, autoCrit: false, malfunction: false, condition: false };
  if (!chain) return out;
  const n = chain.links;
  if (chain.kind === "explode") {
    if (attack) {
      out.damageDice = n >= 2 ? 1 + Math.max(0, n - 2) : 1;
      out.autoCrit = n >= 2;
    } else out.opportunities = n;
  } else if (attack) {
    out.complications = 1;
    out.malfunction = n >= 2;
    out.condition = n >= 3;
  } else {
    out.complications = Math.min(n, 2);
    out.malfunction = n >= 3;
    out.condition = n >= 3;
  }
  return out;
}

/* -------------------------------------------- */
/*  Riding the Edge (LUCK)                      */
/* -------------------------------------------- */

/** LUCK each way to Ride the Edge costs. Only one per roll. */
export const EDGE = { push: 2, secondChance: 1, blitz: 1, closeCall: 3 };

/**
 * Which edges a character can take on a roll card now.
 * @param {object} r - the roll: { initial, critFail, used }
 * @param {number} luck - LUCK left
 */
export function edgeOptions(r, luck) {
  const used = !!r?.used;
  return {
    // Reroll a Check that failed (not on a natural 1).
    secondChance: !used && luck >= EDGE.secondChance && r?.initial !== 1,
    // A natural 1 that imploded doesn't.
    closeCall: !used && luck >= EDGE.closeCall && !!r?.critFail
  };
}

/* -------------------------------------------- */
/*  Flash of Luck                               */
/* -------------------------------------------- */

/** Flash of Luck: LUCK and the most it can have cost. One a Beat, three a Mission. */
export const FLASH = {
  simple: { luck: 2, spend: 100 },
  unlikely: { luck: 4, spend: 500 },
  improbable: { luck: 8, spend: 1000 }
};
export const FLASH_LIMITS = { beat: 1, mission: 3 };

/**
 * Can a character take this Flash of Luck?
 * @param {object} used - { beat, mission }: how many this Beat and this Mission
 * @returns {string|null} why not ("luck", "beat", "mission"), or null
 */
export function flashBlocked(type, luck, used = {}) {
  if (!FLASH[type]) return "type";
  if ((used.mission ?? 0) >= FLASH_LIMITS.mission) return "mission";
  if ((used.beat ?? 0) >= FLASH_LIMITS.beat) return "beat";
  if (luck < FLASH[type].luck) return "luck";
  return null;
}

/* -------------------------------------------- */
/*  The Awareness Ladder                        */
/* -------------------------------------------- */

export const LADDER = ["unaware", "suspicious", "searching", "alert", "spotted"];

/**
 * The Stealth DV at a step of the ladder. Unaware and Suspicious are fixed (10/11 + enemies,
 * sleepers count half, rounded down); Searching and Alert are an enemy's Perception roll (null).
 */
export function ladderDV(level, { awake = 0, asleep = 0 } = {}) {
  const n = awake + Math.floor(asleep / 2);
  if (level === "unaware") return 10 + n;
  if (level === "suspicious") return 11 + n;
  return null;
}

/** One step up (a failed Stealth roll), or down (calming down), within the ladder. */
export function ladderStep(level, dir) {
  const i = Math.max(0, LADDER.indexOf(level));
  return LADDER[Math.min(LADDER.length - 1, Math.max(0, i + dir))];
}

/* -------------------------------------------- */
/*  Tarot Criticals                             */
/* -------------------------------------------- */

/**
 * The 22 Major Arcana: number, name, and what can be applied to the victim automatically
 * (condition ids; the rest the card's text tells the table).
 */
export const ARCANA = [
  { id: "fool", n: "0", name: "The Fool", apply: ["tarotChromeShutdown"] },
  { id: "magician", n: "I", name: "The Magician", apply: ["onFireDeadly"] },
  { id: "priestess", n: "II", name: "The High Priestess", apply: ["foreignObject"] },
  { id: "empress", n: "III", name: "The Empress", apply: ["tarotFated"] },
  { id: "emperor", n: "IV", name: "The Emperor", apply: [] },
  { id: "hierophant", n: "V", name: "The Hierophant", apply: [] },
  { id: "lovers", n: "VI", name: "The Lovers", apply: [] },
  { id: "chariot", n: "VII", name: "The Chariot", apply: [] },
  { id: "strength", n: "VIII", name: "Strength", apply: [] },
  { id: "justice", n: "XI", name: "Justice", apply: ["tarotWinded"] },
  { id: "hermit", n: "IX", name: "The Hermit", apply: ["lostEye"] },
  { id: "wheel", n: "X", name: "Wheel of Fortune", apply: [] },
  { id: "hanged", n: "XII", name: "The Hanged Man", apply: ["prone", "spinalInjury", "whiplash"] },
  { id: "death", n: "XIII", name: "Death", apply: [] },
  { id: "temperance", n: "XIV", name: "Temperance", apply: [] },
  { id: "devil", n: "XV", name: "The Devil", apply: ["brainInjury", "lostEar"] },
  { id: "tower", n: "XVI", name: "The Tower", apply: ["crackedSkull", "crushedWindpipe", "whiplash", "tarotNoPain"] },
  { id: "star", n: "XVII", name: "The Star", apply: [] },
  { id: "moon", n: "XVIII", name: "The Moon", apply: ["foreignObject", "foreignObjectHead"] },
  { id: "sun", n: "XIX", name: "The Sun", apply: [] },
  { id: "judgement", n: "XX", name: "Judgement", apply: ["crushedFingers", "dismemberedHand"] },
  { id: "world", n: "XXI", name: "The World", apply: [] }
];

/** Does a damage roll draw a Tarot Critical? Three or more 6s, one target, not an area attack. */
export function drawsTarot(faces = [], { area = false } = {}) {
  return !area && faces.filter((f) => f === 6).length >= 3;
}

/** A shuffled deck (card ids), using rand() in [0, 1). */
export function shuffled(rand = Math.random) {
  const ids = ARCANA.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/**
 * Draw the top card. A card goes to the bottom once resolved; the deck isn't shuffled again
 * until the campaign has seen every card ("seen" counts them).
 * @param {object} deck - { order: [ids], seen: number, session }
 * @param {*} session - this session's id: one card a session
 * @returns {{ card, deck } | { blocked: "session" }}
 */
export function draw(deck, session, { rand = Math.random, force = false } = {}) {
  let order = deck?.order?.length === ARCANA.length ? [...deck.order] : shuffled(rand);
  let seen = Number(deck?.seen) || 0;
  if (!force && deck?.session !== undefined && deck.session === session) return { blocked: "session" };
  if (seen >= ARCANA.length) {
    order = shuffled(rand);
    seen = 0;
  }
  const id = order.shift();
  order.push(id);
  return { card: ARCANA.find((c) => c.id === id), deck: { order, seen: seen + 1, session } };
}
