/**
 * Gigs on the city map, as data. A gig sits on a place:
 *   { id, title, place, client, fixer (an NCM directory contact id), fixerName, reward (eb),
 *     perHead, text, note (GM only), state, crew: [actor ids], paid: [actor ids] }
 * States: draft (GM only) -> offered (on the board) -> taken (a crew is on it) -> done | failed.
 */
export const GIG_STATES = ["draft", "offered", "taken", "done", "failed"];

const text = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))];

export function cleanGig(raw = {}) {
  const reward = Math.max(0, Math.round(Number(raw.reward) || 0));
  return {
    id: text(raw.id, 32),
    title: text(raw.title, 80),
    place: text(raw.place, 40),
    client: text(raw.client, 80),
    fixer: text(raw.fixer, 40),
    fixerName: text(raw.fixerName, 80),
    reward,
    perHead: !!raw.perHead,
    text: text(raw.text, 2000),
    note: text(raw.note, 2000),
    state: GIG_STATES.includes(raw.state) ? raw.state : "draft",
    crew: ids(raw.crew),
    paid: ids(raw.paid)
  };
}

/** What the GM can do with a gig next. */
export function movesFor(gig) {
  switch (gig?.state) {
    case "draft": return ["offer", "assign", "edit", "remove"];
    case "offered": return ["assign", "withdraw", "edit", "remove"];
    case "taken": return ["done", "failed", "assign", "edit", "remove"];
    default: return ["remove"];
  }
}

/** Is the gig still to be done: on the board or being worked? */
export const open = (gig) => gig?.state === "offered" || gig?.state === "taken";

/** May a player's character take it (or join the crew on it)? */
export const canTake = (gig, actorId) => open(gig) && !!actorId && !gig.crew.includes(String(actorId));

/** Can a player see it: on the board, or one their character worked. */
export const seenBy = (gig, actorIds = []) => open(gig) || ((gig?.state === "done" || gig?.state === "failed") && gig.crew.some((id) => actorIds.includes(id)));

/**
 * Who gets what. Per head: each the stated reward. Otherwise the reward is the team's, split
 * evenly, the odd eddies going to the first names on the crew.
 * @returns {Record<string, number>}
 */
export function shares(gig) {
  const crew = gig?.crew ?? [];
  const reward = Math.max(0, Math.round(Number(gig?.reward) || 0));
  if (!crew.length || !reward) return {};
  if (gig.perHead) return Object.fromEntries(crew.map((id) => [id, reward]));
  const each = Math.floor(reward / crew.length);
  let odd = reward - each * crew.length;
  return Object.fromEntries(crew.map((id) => [id, each + (odd-- > 0 ? 1 : 0)]));
}
