/**
 * Gigs on the city map, as data. A gig sits on a place:
 *   { id, title, place, client, fixer (an NCM directory contact id), fixerName, reward (eb),
 *     perHead, text, note (GM only), state, crew: [actor ids], paid: [actor ids], journal }
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
    paid: ids(raw.paid),
    // Its entry under Gigs in Neon Hub's Journal (a JournalEntry id), when it has one.
    journal: text(raw.journal, 32)
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

/* ---------------------------------------- */
/*  Neon Hub's Journal                      */
/* ---------------------------------------- */

/** Our pay, as a reward row on the Journal's gig. */
export const PAY_ROW = "ncm-pay";

const HUB_STATUS = { draft: "found", offered: "found", taken: "active", done: "completed", failed: "failed" };
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (html) => String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

/**
 * A map gig as the Journal keeps it: the fields to write over the Journal's record. The briefing
 * is only written when ours changed (the Journal's can be richer), and the Journal's own
 * objectives and other rewards are left as they are.
 * @param {object} gig - ours
 * @param {object} o - { place: its name, hub: the Journal's record now (or null), before: our gig before this change }
 */
export function toJournal(gig, { place = "", hub = null, before = null } = {}) {
  const others = (hub?.rewards ?? []).filter((w) => w.id !== PAY_ROW);
  const paidOut = gig.state === "done" || (gig.crew.length > 0 && gig.crew.every((id) => gig.paid.includes(id)));
  const pay = gig.reward ? [{ id: PAY_ROW, kind: "eddies", amount: gig.reward, split: gig.perHead ? "each" : "split", paid: paidOut }] : [];
  const out = { status: HUB_STATUS[gig.state], client: gig.client, location: place, crew: gig.crew.map((id) => `Actor.${id}`), rewards: [...pay, ...others] };
  if (!hub || !before || before.text !== gig.text) out.briefing = gig.text ? `<p>${esc(gig.text).replace(/\n/g, "<br>")}</p>` : "";
  return out;
}

/**
 * What the Journal's record says our gig should be: the fields that differ (an empty object when
 * they agree). Pay settled in the Journal counts as paid here, so it isn't paid twice.
 */
export function fromJournal(hub, gig, { name = null } = {}) {
  if (!hub) return {};
  const out = {};
  const state = hub.status === "completed" ? "done" : hub.status === "failed" ? "failed" : hub.status === "active" ? "taken" : gig.state === "draft" ? "draft" : "offered";
  if (state !== gig.state) out.state = state;
  const crew = (hub.crew ?? []).map((u) => String(u).split(".").pop()).filter(Boolean);
  if (crew.join() !== gig.crew.join()) out.crew = crew;
  if ((hub.client ?? "") !== gig.client) out.client = hub.client ?? "";
  if (name !== null && name !== gig.title) out.title = name;
  const text = plain(hub.briefing);
  if (text !== gig.text.trim()) out.text = text;
  const row = (hub.rewards ?? []).find((w) => w.id === PAY_ROW);
  if (row) {
    if (row.amount !== gig.reward) out.reward = row.amount;
    if ((row.split !== "split") !== gig.perHead) out.perHead = row.split !== "split";
    const all = out.crew ?? gig.crew;
    if (row.paid && all.some((id) => !gig.paid.includes(id))) out.paid = [...new Set([...gig.paid, ...all])];
  } else if (gig.reward) out.reward = 0;
  return out;
}
