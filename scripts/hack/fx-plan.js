/**
 * What each beat of a quickhack looks and sounds like, pure (tests import it): a list of timed
 * steps the player (fx.js) draws with Sequencer. Every beat follows what the roll decided.
 *
 * A step: { at (ms), kind, ... }
 *   strand  a pulse along the link         { from, to, colour, dim }
 *   beam    a steady line (the trace back) { from, to, colour, life }
 *   port    the data ring snapping shut    { on, colour, dim }
 *   open    the ring letting go            { on, colour }
 *   burst   the quickhack landing          { on, look, colour, dim }
 *   fizzle  a quickhack that didn't take   { on }
 *   shield  Self-ICE                       { on, result: "hold" | "shatter" }
 *   alert   they know                      { on }
 *   spark   a link torn out                { on, colour }
 *   sound   { key }
 */
import { strandFor, tracerFor, SHIELD_INTRO, SHIELD_EXPLODE } from "./fx-timing.js";

/** How each family of quickhack lands. */
export const FAMILY_LOOKS = {
  intel: { look: "radar", colour: "cyan", sound: null },
  covert: { look: "shimmer", colour: "violet", sound: null },
  control: { look: "static", colour: "amber", sound: "zap" },
  combat: { look: "impact", colour: "red", sound: "zap" },
  ultimate: { look: "overload", colour: "white", sound: "zap" },
  vehicle: { look: "static", colour: "amber", sound: "zap" }
};

/** Quickhacks with a look of their own (by hackKey). */
export const HACK_LOOKS = {
  overheat: { look: "fire", colour: "orange" },
  synapseburnout: { look: "static", colour: "red" },
  shortcircuit: { look: "static", colour: "cyan" },
  sonicshock: { look: "soundwave", colour: "cyan" },
  systemreset: { look: "shutdown", colour: "white" },
  puppet: { look: "strings", colour: "violet" },
  cyberpsychosis: { look: "overload", colour: "red" },
  totalsystemkill: { look: "overload", colour: "red" }
};

/** The look of a quickhack landing: its own, else its family's. */
export function lookFor(family, key = "") {
  const base = FAMILY_LOOKS[family] ?? FAMILY_LOOKS.control;
  return { ...base, ...(HACK_LOOKS[key] ?? {}) };
}

/** Ghost Hack visibility settings. */
export const GHOST_MODES = ["owners", "all", "off"];

/**
 * Who a beat plays for. An ordinary hack: everyone. A beat while Ghosted and undetected: the GM
 * and the Netrunner's players only ("owners"), everyone in its subdued form ("all"), or no one.
 */
export function audience({ ghost = false, setting = "owners" } = {}) {
  if (!ghost) return "all";
  return setting === "all" ? "all" : setting === "off" ? "none" : "owners";
}

/** Does this client play a beat for that audience? */
export const sees = (aud, { isGM = false, ownsRunner = false } = {}) => aud === "all" || (aud === "owners" && (isGM || ownsRunner));

const shift = (steps, ms) => steps.map((s) => ({ ...s, at: s.at + ms }));
const sound = (key, at = 0) => ({ at: Math.max(0, Math.round(at)), kind: "sound", key });

/** The pulse's timing over a distance: JB2A's strand, else the module's own tracer. */
export const travel = (squares, jb2a = true) => (jb2a ? strandFor(squares) : tracerFor(squares));

/** They know: an alert on the target, and (when the rules give the Netrunner away) a trace back up the link. */
export function detect({ trace = true } = {}) {
  const steps = [{ at: 0, kind: "alert", on: "target" }, sound("alert")];
  if (trace) steps.push({ at: 200, kind: "beam", from: "target", to: "runner", colour: "red", life: 900 }, { at: 350, kind: "spark", on: "runner", colour: "red" });
  return steps;
}

/**
 * Jack In: a pulse to the target's Neuroport and the data ring snapping shut on it. Lost the
 * Check: they know, and the alert follows. Ghosted: a thin, dim pulse and nothing on the target.
 */
export function jackIn({ squares = 0, aware = false, ghosted = false, jb2a = true } = {}) {
  const t = travel(squares, jb2a);
  const steps = [{ at: 0, kind: "strand", from: "runner", to: "target", colour: "cyan", dim: ghosted }, sound(ghosted ? "ghost" : "jackIn", t.launch)];
  if (!ghosted) steps.push({ at: t.arrive, kind: "port", on: "target", colour: "cyan" });
  if (aware) steps.push(...shift(detect({ trace: true }), t.arrive + 250));
  return steps;
}

/** Jack Out: the ring lets go and the link runs back to the Netrunner. */
export function jackOut({ ghosted = false } = {}) {
  return [
    { at: 0, kind: "strand", from: "target", to: "runner", colour: "cyan", dim: true },
    ...(ghosted ? [] : [{ at: 0, kind: "open", on: "target", colour: "cyan" }]),
    sound(ghosted ? "ghost" : "jackOut")
  ];
}

/** Kicked out: the link tears and snaps back into the Netrunner. */
export function eject({ squares = 0, jb2a = true } = {}) {
  const t = travel(squares, jb2a);
  return [
    { at: 0, kind: "open", on: "target", colour: "red" },
    { at: 0, kind: "strand", from: "target", to: "runner", colour: "red", dim: false },
    sound("eject"),
    { at: t.arrive, kind: "spark", on: "runner", colour: "red" }
  ];
}

/**
 * Breach: the pulse meets Self-ICE. The Passwall holds (the shield flares and throws the pulse
 * back) or goes down (it shatters). Ghosted: the shield only shows to those who see the Ghost.
 */
export function breach({ squares = 0, down = false, ghosted = false, jb2a = true } = {}) {
  const t = travel(squares, jb2a);
  const steps = [{ at: 0, kind: "strand", from: "runner", to: "target", colour: "cyan", dim: ghosted }];
  if (down) {
    steps.push({ at: t.arrive, kind: "shield", on: "target", result: "shatter", dim: ghosted });
    steps.push(sound(ghosted ? "ghost" : "iceBreak", t.arrive + SHIELD_EXPLODE.burst - SHIELD_EXPLODE.skip));
  } else {
    steps.push({ at: Math.max(0, t.arrive - SHIELD_INTRO.up), kind: "shield", on: "target", result: "hold", dim: ghosted });
    steps.push(sound(ghosted ? "ghost" : "iceBlock", t.arrive));
    steps.push({ at: t.arrive + 100, kind: "strand", from: "target", to: "runner", colour: "white", dim: true });
  }
  return steps;
}

/**
 * A quickhack: the upload runs up the link, then lands in the way of its family (or fizzles).
 * `condition`: the hit places a Neon Condition, whose own burst and sound play as it's placed
 * (the flow places it at `arrive`), so the upload adds only its family's look.
 * Ghosted and still unnoticed: a dim pulse and a small glitch, as their chrome acting up.
 */
export function upload({ squares = 0, hit = false, family = "control", key = "", ghosted = false, condition = false, jb2a = true } = {}) {
  const t = travel(squares, jb2a);
  const steps = [{ at: 0, kind: "strand", from: "runner", to: "target", colour: ghosted ? "cyan" : lookFor(family, key).colour, dim: ghosted }];
  if (!hit) {
    if (!ghosted) steps.push({ at: t.arrive, kind: "fizzle", on: "target" });
    return steps;
  }
  const look = lookFor(family, key);
  if (ghosted) {
    steps.push({ at: t.arrive, kind: "burst", on: "target", look: "glitch", colour: "cyan", dim: true }, sound("ghost", t.arrive));
    return steps;
  }
  steps.push({ at: t.arrive, kind: "burst", on: "target", look: look.look, colour: look.colour, dim: false });
  if (!condition) steps.push(sound("upload", t.arrive));
  if (look.sound) steps.push(sound(look.sound, t.arrive + 60));
  return steps;
}

/** A quickhack's condition ending (run out, cleared, removed by hand): the system comes back up. */
export function conditionEnd() {
  return [{ at: 0, kind: "open", on: "target", colour: "green" }, { at: 0, kind: "burst", on: "target", look: "reboot", colour: "green", dim: false }, sound("reboot")];
}

/** When a beat's main moment falls (ms): the flow waits this long before the card's effects apply. */
export const arrival = (squares, jb2a = true) => travel(squares, jb2a).arrive;

/** How long a plan runs, for tests and for holding the link's redraw. */
export const length = (steps) => steps.reduce((m, s) => Math.max(m, s.at + (s.life ?? 0)), 0);
