import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Core, SOUNDS, img } from "../neonfx/core.js";
import { C } from "../neonfx/recipes.js";
import { squaresBetween } from "../arsenal/timing.js";
import * as Plan from "./fx-plan.js";
import { SHIELD_EXPLODE } from "./fx-timing.js";

/** JB2A entries the quickhack looks use (all in the free pack; Patreon adds colours). */
export const JB = {
  strand: ["jb2a.energy_strands.range.standard"],
  beam: ["jb2a.energy_beam.normal"],
  shieldUp: ["jb2a.shield.01.intro"],
  shieldBreak: ["jb2a.shield.01.outro_explode"],
  radar: ["jb2a.extras.tmfx.radar.circle.pulse.01", "jb2a.extras.tmfx.radar.circle.pulse"],
  shimmer: ["jb2a.shimmer.01", "jb2a.shimmer"],
  static: ["jb2a.static_electricity.03", "jb2a.static_electricity.02", "jb2a.static_electricity"],
  impact: ["jb2a.impact.004", "jb2a.impact.010", "jb2a.impact"],
  outpulse: ["jb2a.extras.tmfx.outpulse.circle.02", "jb2a.extras.tmfx.outpulse.circle.01", "jb2a.extras.tmfx.outpulse.circle"],
  inpulse: ["jb2a.extras.tmfx.inpulse.circle.01", "jb2a.extras.tmfx.inpulse.circle"],
  fire: ["jb2a.flames.01", "jb2a.flames.02", "jb2a.flames"],
  soundwave: ["jb2a.soundwave.01", "jb2a.soundwave"],
  strings: ["jb2a.energy_strands.complete", "jb2a.energy_strands.overlay"]
};

/** JB2A colour names to ask for, by the colour a step wants. */
const WANTED = {
  cyan: ["blue", "bluepink", "regular_blue"],
  red: ["dark_red", "red", "orange"],
  violet: ["purple", "dark_purple", "bluepink"],
  amber: ["orange", "yellow"],
  orange: ["orange"],
  white: ["grey", "white", "blue"],
  green: ["dark_green", "green", "bluegreen"]
};
/** Where each colour sits on the wheel (degrees), to turn a clip that only comes in another colour. */
const HUE = { cyan: 185, blue: 215, bluepink: 240, purple: 275, violet: 275, red: 355, orange: 25, amber: 40, yellow: 55, green: 120, bluegreen: 165 };
const TINT = { cyan: C.cyan, red: C.red, violet: C.violet, amber: C.amber, orange: C.orange, white: C.white, green: C.green, grey: C.grey };
const GLITCH = [1, 2, 3, 4].map((n) => img(`glitch-0${n}.webp`));

/** On-token looks: the JB2A clip, how big, how long; `tint` for the white TMFX clips (they take a tint). */
const LOOKS = {
  radar: { jb: "radar", scale: 2.4, life: 1500, tint: true },
  shimmer: { jb: "shimmer", scale: 2, life: 580 },
  static: { jb: "static", scale: 1.6, life: 1300 },
  impact: { jb: "impact", scale: 2, life: 1000 },
  overload: { jb: "outpulse", scale: 2.6, life: 1200, tint: true, also: "impact" },
  fire: { jb: "fire", scale: 1.5, life: 1100 },
  soundwave: { jb: "soundwave", scale: 2.2, life: 1200 },
  shutdown: { jb: "inpulse", scale: 2, life: 1100, tint: true },
  strings: { jb: "strings", scale: 1.7, life: 1400 },
  reboot: { jb: "outpulse", scale: 1.8, life: 1200, tint: true }
};

/** Sounds waiting on their files fall back to what Neon FX already has (or stay silent). */
const SOUND_FALLBACK = { jackIn: "upload", iceBreak: "zap", eject: "zap" };
const SOUND_KEYS = { jackIn: "hackJackIn", jackOut: "hackJackOut", eject: "hackEject", iceBlock: "hackIceBlock", iceBreak: "hackIceBreak", alert: "hackAlert", reboot: "hackReboot", ghost: "hackGhost" };

/** The sound to play for a step's key: the quickhack's own once it ships, else the fallback, else none. */
export function soundFor(key, have = SOUNDS) {
  const own = SOUND_KEYS[key];
  if (own && have[own]) return own;
  if (have[key]) return key;
  const fb = SOUND_FALLBACK[key];
  return fb && have[fb] ? fb : null;
}

/** The degrees to turn a JB2A file found in one colour to the colour wanted (0 when it's already there, or unknown). */
export function hueTurn(path, colour) {
  const want = HUE[colour];
  if (want === undefined || !path) return 0;
  const found = Object.keys(HUE).sort((a, b) => b.length - a.length).find((c) => String(path).toLowerCase().includes(c));
  if (!found) return 0;
  const d = Math.round(want - HUE[found]);
  return Math.abs(d) < 25 ? 0 : d;
}

const LINK = "ncm-hack";
/** The persistent link's effect name; a Ghosted link carries "-g" (it's drawn for fewer people). */
export const linkName = (runnerId, targetId, ghost = false) => `${LINK}-${runnerId}-${targetId}${ghost ? "-g" : ""}`;

/**
 * Quickhack animations, drawn with Sequencer on each client that should see them. Automated
 * Animations plays on a weapon's attack roll and a quickhack isn't one, so nothing here goes
 * through it. Without Sequencer nothing plays; without JB2A the module's own art does.
 */
export const HackFx = {
  get on() {
    return Core.on && !!Settings.get("hackFx");
  },

  get ghostMode() {
    const m = Settings.get("hackGhostFx");
    return Plan.GHOST_MODES.includes(m) ? m : "owners";
  },

  /** Is JB2A's strand there for the pulse (its timing differs from the module's own tracer)? */
  get jb2a() {
    return Core.sequencer && !!Core.jb2a(JB.strand, []);
  },

  init() {
    Socket.on("event:hackFx", (data) => this.receive(data));
    // A character's links changed (an unlinked token's actor data lives in the token's delta).
    const touched = (changes) => Object.keys(foundry.utils.flattenObject(changes ?? {})).some((k) => k.includes(`flags.${MODULE_ID}.hack`) || k.includes(`flags.${MODULE_ID}.-=hack`));
    Hooks.on("updateActor", (actor, changes, options, userId) => touched(changes) && this.syncLinks(userId));
    Hooks.on("updateToken", (doc, changes, options, userId) => touched(changes) && this.syncLinks(userId));
    Hooks.on("canvasReady", () => setTimeout(() => this.syncLinks(), 2500));
    Hooks.on(`${MODULE_ID}.fxChanged`, () => this.syncLinks());
  },

  /* ---------------------------------------- */
  /*  Beats                                   */
  /* ---------------------------------------- */

  /**
   * Play a beat for everyone who should see it: here, and on the other clients.
   * @param {string} beat - jackIn | jackOut | eject | breach | upload | detect | conditionEnd
   * @param {object} ctx - { runner, target (token ids), scene, ghosted, ...the plan's own arguments }
   */
  send(beat, ctx) {
    const data = { beat, ...ctx, scene: ctx.scene ?? canvas?.scene?.id, audience: Plan.audience({ ghost: !!ctx.ghosted, setting: this.ghostMode }) };
    try {
      Socket.broadcast("hackFx", data);
    } catch (err) {
      console.warn(`${MODULE_ID} | quickhack animation`, err);
    }
    return this.receive(data);
  },

  /** A beat arriving on this client: play it if it's for us and we can see who it's about. */
  receive(data) {
    if (!this.on || !data || !canvas?.ready || canvas.scene?.id !== data.scene) return null;
    const runner = data.runner ? canvas.tokens.get(data.runner) : null;
    const target = data.target ? canvas.tokens.get(data.target) : null;
    if (!Plan.sees(data.audience, { isGM: game.user.isGM, ownsRunner: !!runner?.document?.isOwner })) return null;
    const make = Plan[data.beat];
    if (typeof make !== "function") return null;
    const squares = runner && target ? squaresBetween(runner.center, target.center, canvas.grid.size) : 0;
    const steps = make({ ...data, squares, jb2a: this.jb2a });
    this.draw(steps, { runner, target });
    return steps;
  },

  /** Draw a plan's steps: effects in one Sequence (this client only), sounds at this player's FX volume. */
  draw(steps, tokens) {
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    let any = false;
    for (const s of steps) {
      if (s.kind === "sound") {
        const key = soundFor(s.key);
        if (key) setTimeout(() => Core.sound(key), s.at);
        continue;
      }
      try {
        if (this._step(seq, s, tokens)) any = true;
      } catch (err) {
        console.warn(`${MODULE_ID} | quickhack animation ${s.kind}`, err);
      }
    }
    if (any) seq.play();
  },

  _step(seq, s, tokens) {
    const on = s.on ? tokens[s.on] : null;
    if (s.on && !on?.visible) return false;
    switch (s.kind) {
      case "strand":
      case "beam":
        return this._line(seq, s, tokens);
      case "port":
        seq.effect().atLocation(on).locally().file(img("data-ring.webp")).scaleToObject(1.8).belowTokens().tint(TINT[s.colour] ?? C.cyan).delay(s.at)
          .animateProperty("spriteContainer", "scale.x", { from: 1.6, to: 0.9, duration: 400 })
          .animateProperty("spriteContainer", "scale.y", { from: 1.6, to: 0.9, duration: 400 })
          .fadeIn(80).fadeOut(300).duration(800);
        return true;
      case "open":
        seq.effect().atLocation(on).locally().file(img("data-ring.webp")).scaleToObject(1.8).belowTokens().tint(TINT[s.colour] ?? C.cyan).delay(s.at)
          .animateProperty("spriteContainer", "scale.x", { from: 0.9, to: 1.9, duration: 600 })
          .animateProperty("spriteContainer", "scale.y", { from: 0.9, to: 1.9, duration: 600 })
          .fadeOut(450).duration(700);
        return true;
      case "burst":
        return this._burst(seq, s, on);
      case "fizzle":
        seq.effect().atLocation(on).locally().file(GLITCH).scaleToObject(1.1).tint(C.grey).opacity(0.45).delay(s.at).fadeOut(150).duration(280);
        return true;
      case "shield":
        return this._shield(seq, s, on);
      case "alert":
        seq.effect().atLocation(on).locally().file(img("reticle-red.webp")).scaleToObject(1.7).delay(s.at)
          .loopProperty("sprite", "alpha", { values: [1, 0.25], duration: 160, pingPong: true, absolute: true }).fadeOut(250).duration(1300);
        seq.effect().atLocation(on).locally().file(img("ring-pulse.webp")).scaleToObject(1).tint(C.red).delay(s.at)
          .animateProperty("spriteContainer", "scale.x", { from: 0.6, to: 2.6, duration: 700 })
          .animateProperty("spriteContainer", "scale.y", { from: 0.6, to: 2.6, duration: 700 })
          .fadeOut(500).duration(700);
        return true;
      case "spark": {
        const file = this._file("static", s.colour);
        if (file) this._hue(seq.effect().atLocation(on).locally().file(file).scaleToObject(1.5).delay(s.at).fadeOut(200).duration(650), file, s.colour);
        seq.effect().atLocation(on).locally().file(img("glow-soft.webp")).scaleToObject(1.8).tint(TINT[s.colour] ?? C.red).opacity(0.8).delay(s.at).fadeOut(350).duration(450);
        return true;
      }
      default:
        return false;
    }
  },

  /** The JB2A entry for a look in a colour: the wanted colour if the pack has it, else a named one to turn. */
  _file(jb, colour) {
    const path = Core.jb2a(JB[jb], WANTED[colour] ?? []);
    if (!path || hueTurn(path, colour) || Object.keys(HUE).some((c) => path.toLowerCase().includes(c))) return path;
    try {
      const kid = (Sequencer.Database.getPathsUnder(path) || []).find((k) => k in HUE);
      return kid ? `${path}.${kid}` : path;
    } catch {
      return path;
    }
  },

  /** Turn a clip to the colour wanted when JB2A only has it in another. */
  _hue(effect, file, colour) {
    if (colour === "white") return effect.filter("ColorMatrix", { saturate: -1, brightness: 1.3 });
    const turn = hueTurn(file, colour);
    return turn ? effect.filter("ColorMatrix", { hue: turn }) : effect;
  },

  /** A pulse or a beam between the two tokens (both have to be in sight). */
  _line(seq, s, tokens) {
    const from = tokens[s.from];
    const to = tokens[s.to];
    if (!from?.visible || !to?.visible) return false;
    const file = this._file(s.kind === "beam" ? "beam" : "strand", s.colour);
    if (!file) {
      const life = s.life ?? Plan.travel(squaresBetween(from.center, to.center, canvas.grid.size), false).gone;
      seq.effect().file(img("trajectory.webp")).atLocation(from).stretchTo(to).locally().tint(TINT[s.colour] ?? C.cyan)
        .opacity(s.dim ? 0.3 : 0.75).delay(s.at).fadeIn(80).fadeOut(Math.min(300, life / 2)).duration(life);
      return true;
    }
    const e = seq.effect().file(file).atLocation(from).stretchTo(to).locally().delay(s.at).opacity(s.dim ? 0.35 : 0.95);
    if (s.dim) e.scale({ x: 1, y: 0.5 });
    if (s.life) e.duration(s.life).fadeIn(100).fadeOut(250);
    this._hue(e, file, s.colour);
    return true;
  },

  _burst(seq, s, on) {
    if (s.look === "glitch") {
      seq.effect().atLocation(on).locally().file(GLITCH).scaleToObject(1.15).filter("ColorMatrix", { hue: 180 }).opacity(0.5).delay(s.at)
        .loopProperty("sprite", "alpha", { values: [0.5, 0, 0.4, 0, 0.5], duration: 60, absolute: true }).duration(320);
      return true;
    }
    const look = LOOKS[s.look];
    const tint = TINT[s.colour] ?? C.cyan;
    const clip = (jb, scale) => {
      const file = this._file(jb, s.colour);
      if (!file) return false;
      const e = seq.effect().atLocation(on).locally().file(file).scaleToObject(scale).delay(s.at).fadeOut(250).duration(look.life);
      if (look.tint && jb === look.jb) e.tint(tint);
      else this._hue(e, file, s.colour);
      return true;
    };
    const drawn = look ? clip(look.jb, look.scale) : false;
    if (look?.also) clip(look.also, look.scale * 0.8);
    // The module's own art: a flash in the look's colour (all there is without JB2A).
    seq.effect().atLocation(on).locally().file(img("glow-soft.webp")).scaleToObject(drawn ? 1.6 : 2.2).tint(tint).opacity(drawn ? 0.5 : 0.9).delay(s.at).fadeOut(400).duration(520);
    if (!drawn) {
      seq.effect().atLocation(on).locally().file(img("ring-pulse.webp")).scaleToObject(1).tint(tint).delay(s.at)
        .animateProperty("spriteContainer", "scale.x", { from: 0.6, to: 2.4, duration: 700 })
        .animateProperty("spriteContainer", "scale.y", { from: 0.6, to: 2.4, duration: 700 })
        .fadeOut(500).duration(700);
    }
    return true;
  },

  _shield(seq, s, on) {
    const shatter = s.result === "shatter";
    const file = this._file(shatter ? "shieldBreak" : "shieldUp", "cyan");
    const opacity = s.dim ? 0.45 : 1;
    if (file) {
      const e = seq.effect().atLocation(on).locally().file(file).scaleToObject(1.8).delay(s.at).opacity(opacity);
      if (shatter) e.startTime(SHIELD_EXPLODE.skip).fadeIn(100);
      else e.fadeOut(200);
      return true;
    }
    // Without JB2A: a ring that stands (holds) or flies apart (shatters).
    const ring = seq.effect().atLocation(on).locally().file(img("ring-pulse.webp")).scaleToObject(1.5).tint(C.cyan).delay(s.at).opacity(opacity);
    if (shatter) {
      const at = SHIELD_EXPLODE.burst - SHIELD_EXPLODE.skip;
      ring.animateProperty("spriteContainer", "scale.x", { from: 1, to: 2.4, duration: 300, delay: at })
        .animateProperty("spriteContainer", "scale.y", { from: 1, to: 2.4, duration: 300, delay: at })
        .fadeIn(100).fadeOut(250).duration(at + 320);
    } else ring.loopProperty("sprite", "alpha", { values: [1, 0.5], duration: 140, pingPong: true, absolute: true }).fadeIn(120).fadeOut(300).duration(1100);
    return true;
  },

  /* ---------------------------------------- */
  /*  The link (persistent)                   */
  /* ---------------------------------------- */

  /** Links a token's actor holds to tokens on this scene: [{ target, ghost }]. */
  linksOf(token) {
    const links = token?.actor?.flags?.[MODULE_ID]?.hack?.links ?? {};
    return Object.entries(links)
      .filter(([id, l]) => l && (!l.scene || l.scene === canvas.scene?.id) && canvas.tokens.get(id))
      .map(([id, l]) => ({ target: canvas.tokens.get(id), ghost: !!l.ghost }));
  },

  /**
   * Keep the drawn links in step with the links characters hold: one writer (the active GM, else
   * whoever acted) makes and ends them, and Sequencer shares them. A Ghosted link is made only
   * for those who see the Ghost.
   */
  syncLinks(userId = game.user.id) {
    if (!Core.sequencer || !canvas?.ready || !Core.writes(userId)) return;
    const want = new Map();
    if (this.on) {
      for (const runner of canvas.tokens.placeables) {
        for (const { target, ghost } of this.linksOf(runner)) {
          if (ghost && this.ghostMode === "off") continue;
          want.set(linkName(runner.id, target.id, ghost), { runner, target, ghost });
        }
      }
    }
    const have = new Set();
    for (const e of Sequencer.EffectManager.getEffects({ name: `${LINK}-*` }) ?? []) {
      const name = e?.data?.name;
      if (typeof name !== "string" || !name.startsWith(`${LINK}-`)) continue;
      if (want.has(name)) have.add(name);
      else Sequencer.EffectManager.endEffects({ name });
    }
    const add = [...want].filter(([name]) => !have.has(name));
    if (!add.length) return;
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    for (const [name, { runner, target, ghost }] of add) {
      const e = seq.effect().name(name).file(img("trajectory.webp")).attachTo(runner).stretchTo(target, { attachTo: true }).persist()
        .belowTokens().tint(C.cyan).fadeIn(400).fadeOut(400)
        .loopProperty("sprite", "alpha", { values: ghost ? [0.12, 0.28] : [0.3, 0.6], duration: 1400, pingPong: true, absolute: true });
      if (ghost && this.ghostMode === "owners") e.forUsers(this.ghostViewers(runner));
    }
    seq.play();
  },

  /** User ids who see a Ghosted link: the GMs and the Netrunner's players. */
  ghostViewers(runner) {
    return game.users.filter((u) => u.isGM || runner?.actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);
  },

  /** The quickhack condition ending on a token (Neon FX calls this as its effect goes). */
  conditionEnded(token) {
    if (!this.on || !token?.visible) return;
    this.draw(Plan.conditionEnd(), { target: token });
  },

  /** For the GM's report: which JB2A files the looks found here. */
  report() {
    return Object.fromEntries(Object.entries(JB).map(([k, bases]) => [k, Core.sequencer ? Core.jb2a(bases, []) : null]));
  }
};
