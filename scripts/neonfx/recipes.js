import { Core, img } from "./core.js";

/**
 * What each condition looks like. A recipe:
 *   layers  persistent effects on the token while the condition lasts (the active GM draws them,
 *           Sequencer shares and saves them)
 *   once    a one-off when it's added (every client draws its own, so nothing is saved)
 *   sound   a SOUNDS key played once when it's added, at the player's FX volume
 *   motion  how the token's art moves meanwhile: psycho | glitch | tremble | sway (see motion.js)
 *
 * JB2A is used where it has the right thing (free or Patreon, whatever is installed); every JB2A
 * layer names a fallback built from Neon FX's own art, so nothing needs JB2A.
 */

export const C = {
  red: 0xff1744,
  blood: 0xb3001b,
  cyan: 0x00e5ff,
  green: 0x39ff14,
  magenta: 0xff00ff,
  toxic: 0x9cff3a,
  acid: 0xc6ff00,
  amber: 0xffb300,
  orange: 0xff7a1a,
  violet: 0x9d4dff,
  pink: 0xff4fd8,
  blue: 0x3d8bff,
  gold: 0xffd23f,
  white: 0xffffff,
  grey: 0x9e9e9e
};

/** JB2A entries to look for, most specific first. */
export const JB2A = {
  fire: ["jb2a.flames.01", "jb2a.flames.02", "jb2a.flames.04", "jb2a.flames"],
  electric: ["jb2a.static_electricity.01", "jb2a.static_electricity.02", "jb2a.static_electricity.03", "jb2a.static_electricity"],
  smoke: ["jb2a.fog_cloud.1", "jb2a.fog_cloud.2", "jb2a.fog_cloud", "jb2a.smoke.puff.centered", "jb2a.smoke.puff"],
  toxic: ["jb2a.toxic_cloud", "jb2a.stinking_cloud", "jb2a.fog_cloud.1"],
  heal: ["jb2a.healing_generic.200px", "jb2a.healing_generic.loop", "jb2a.healing_generic"],
  impact: ["jb2a.impact.004", "jb2a.impact.010", "jb2a.impact.ground_crack", "jb2a.impact"]
};

/** Hue turns (degrees) that bring a JB2A colour round to red, for the cyberpsycho's crackle. */
const HUE_TO_RED = { blue: 120, dark_blue: 120, purple: 80, dark_purple: 80, green: -120, dark_green: -120, yellow: -50 };

const GLITCH = [1, 2, 3, 4].map((n) => img(`glitch-0${n}.webp`));
const rand = (a, b) => a + Math.random() * (b - a);
const jitter = (n, amp) => Array.from({ length: n }, (_, i) => (i === 0 ? 0 : Math.round(rand(-amp, amp) * (Math.random() < 0.2 ? 2.5 : 1))));
const flicker = (n, peak = 1) => Array.from({ length: n }, (_, i) => (i === 2 || Math.random() < 0.3 ? rand(0.4, 1) * peak : 0));

/** A persistent effect on a token, named so Neon FX can find it again. */
function attached(seq, token, name, { below = false, z = 1 } = {}) {
  return seq.effect().name(name).attachTo(token, { bindAlpha: false }).persist().belowTokens(below).zIndex(z);
}

/* ---------------------------------------- */
/*  Persistent layers                       */
/* ---------------------------------------- */

export const Layers = {
  /** A pulsing neon outline that follows the token's own shape. */
  glow(colour, { min = 0.25, max = 0.65, period = 1100, distance = 10 } = {}) {
    return (seq, token, name) => attached(seq, token, name, { below: true })
      .copySprite(token)
      .size(Core.artSize(token))
      .rotate(0)
      .filter("Glow", { color: colour, distance, outerStrength: 4, innerStrength: 0, quality: 0.2, knockout: true })
      .loopProperty("sprite", "alpha", { values: [min, max], duration: period, pingPong: true, absolute: true });
  },

  /** A soft coloured haze under the token. */
  aura(colour, { scale = 1.6, min = 0.15, max = 0.4, period = 1400 } = {}) {
    return (seq, token, name) => attached(seq, token, name, { below: true, z: 0 })
      .file(img("glow-soft.webp"))
      .scaleToObject(scale)
      .tint(colour)
      .loopProperty("sprite", "alpha", { values: [min, max], duration: period, pingPong: true, absolute: true });
  },

  /** A ring or marker image (under the token by default), optionally turning and tinted. */
  ring(file, { scale = 1.7, tint = null, opacity = 0.85, spin = 0, below = true, pulse = 0 } = {}) {
    return (seq, token, name) => {
      const e = attached(seq, token, name, { below, z: 0 }).file(file).scaleToObject(scale).opacity(opacity);
      if (tint !== null) e.tint(tint);
      if (spin) e.loopProperty("spriteContainer", "rotation", { from: 0, to: 360, duration: spin });
      if (pulse) e.loopProperty("spriteContainer", "scale.x", { values: [1, 1.06], duration: pulse, pingPong: true })
        .loopProperty("spriteContainer", "scale.y", { values: [1, 1.06], duration: pulse, pingPong: true });
      return e;
    };
  },

  /** A JB2A animation if one is installed, else the fallback layer (or nothing). */
  jb2a(bases, wanted, { scale = 1.2, opacity = 0.85, below = false, tint = null, hueToRed = false } = {}, fallback = null) {
    return (seq, token, name) => {
      const file = Core.jb2a(bases, wanted);
      if (!file) return fallback?.(seq, token, name);
      const e = attached(seq, token, name, { below, z: 2 }).file(file).scaleToObject(scale).opacity(opacity);
      if (tint !== null) e.tint(tint);
      if (hueToRed) {
        const colour = Object.keys(HUE_TO_RED).find((c) => file.split(".").includes(c));
        if (colour) e.filter("ColorMatrix", { hue: HUE_TO_RED[colour] });
      }
      return e;
    };
  },

  /** Flickering bands of corrupted signal. hue turns the red bands (180 = cyan). */
  glitch({ hue = 0, peak = 1, scale = 1.35, amp = 7, period = 60 } = {}) {
    return (seq, token, name) => {
      const e = attached(seq, token, name, { z: 5 })
        .file(GLITCH)
        .scaleToObject(scale)
        .randomizeMirrorX()
        .randomizeMirrorY()
        .loopProperty("sprite", "alpha", { values: flicker(14, peak), duration: period, absolute: true })
        .loopProperty("sprite", "position.x", { values: jitter(8, amp * 3), duration: 50 });
      if (hue) e.filter("ColorMatrix", { hue });
      return e;
    };
  },

  /** Red and cyan copies tearing off the body (RGB split). */
  rgbSplit({ amp = 7, step = 45, peak = 0.75 } = {}) {
    return (seq, token, name) => {
      for (const [tint, side] of [[0xff0033, -1], [0x00e5ff, 1]]) {
        attached(seq, token, name, { z: 1 })
          .copySprite(token)
          .size(Core.artSize(token))
          .rotate(0)
          .tint(tint)
          .loopProperty("sprite", "position.x", { values: jitter(10, amp * 1.6).map((v) => v + side * amp), duration: step * 1.2 })
          .loopProperty("sprite", "position.y", { values: jitter(8, amp * 0.4), duration: step * 1.5 })
          .loopProperty("sprite", "alpha", { values: flicker(12, peak), duration: step * 1.6, absolute: true });
      }
    };
  },

  /** Red scanlines with a rolling scan bar. */
  scanlines() {
    return (seq, token, name) => {
      const art = Core.artSize(token);
      attached(seq, token, name, { z: 3 })
        .file(img("scanlines-red.webp"))
        .scaleToObject(1.25)
        .loopProperty("sprite", "position.y", { values: [0, 3, -2, 5, 0, -4], duration: 70 })
        .loopProperty("sprite", "alpha", { values: [0.8, 0.5, 0.9, 0.2, 0.85, 0.7], duration: 90, absolute: true });
      attached(seq, token, name, { z: 4 })
        .file(img("scanband-red.webp"))
        .size({ width: art.width * 1.3, height: art.height * 0.3 })
        .opacity(0.65)
        .loopProperty("sprite", "position.y", { from: -art.height * 0.6, to: art.height * 0.6, duration: 1400 });
    };
  },

  /** A biomonitor heartbeat line over the token. */
  ekg() {
    return (seq, token, name) => {
      const art = Core.artSize(token);
      attached(seq, token, name, { z: 6 })
        .file(img("ekg-red.webp"))
        .size({ width: art.width * 1.3, height: art.width * 0.38 })
        .spriteOffset({ x: 0, y: -art.height * 0.62 })
        .loopProperty("sprite", "alpha", { values: [0.25, 1, 0.35, 0.9, 0.25, 0.25, 0.25], duration: 170, absolute: true });
    };
  },

  /** Drifting z's: asleep or out cold. */
  zzz(tint = C.cyan) {
    return (seq, token, name) => {
      const art = Core.artSize(token);
      attached(seq, token, name, { z: 6 })
        .file(img("zzz.webp"))
        .size({ width: art.width * 0.55, height: art.width * 0.55 })
        .tint(tint)
        .spriteOffset({ x: art.width * 0.38, y: -art.height * 0.42 })
        .loopProperty("sprite", "position.y", { values: [0, -art.height * 0.08], duration: 1600, pingPong: true })
        .loopProperty("sprite", "alpha", { values: [0.45, 1], duration: 1600, pingPong: true, absolute: true });
    };
  },

  /** Optical camo: a blurred copy rippling over the token. */
  camo() {
    return (seq, token, name) => attached(seq, token, name, { z: 2 })
      .copySprite(token)
      .size(Core.artSize(token))
      .rotate(0)
      .tint(C.cyan)
      .filter("Blur", { strength: 4, quality: 2 })
      .loopProperty("sprite", "alpha", { values: [0, 0.35, 0.1, 0.45, 0], duration: 600, pingPong: true, absolute: true })
      .loopProperty("sprite", "position.x", { values: [-2, 2], duration: 300, pingPong: true });
  },

  /** Green and magenta fringes: the Sandevistan is running. */
  fringe() {
    return (seq, token, name) => {
      for (const [tint, side] of [[C.green, -1], [C.magenta, 1]]) {
        attached(seq, token, name, { below: true })
          .copySprite(token)
          .size(Core.artSize(token))
          .rotate(0)
          .tint(tint)
          .loopProperty("sprite", "position.x", { values: [3, 5, 2, 6, 4].map((v) => v * side), duration: 140, pingPong: true })
          .loopProperty("sprite", "alpha", { values: [0.55, 0.3, 0.6, 0.4], duration: 160, pingPong: true, absolute: true });
      }
    };
  }
};

/* ---------------------------------------- */
/*  One-offs (drawn on each client)         */
/* ---------------------------------------- */

function local(seq, token) {
  return seq.effect().atLocation(token).locally();
}

export const Once = {
  flash(colour, { scale = 2.2, life = 600 } = {}) {
    return (seq, token) => local(seq, token).file(img("glow-soft.webp")).scaleToObject(scale).tint(colour)
      .opacity(0.9).fadeOut(life - 100).duration(life);
  },

  /** A ring that widens and fades. */
  pulse(colour, { life = 700 } = {}) {
    return (seq, token) => local(seq, token).file(img("ring-pulse.webp")).scaleToObject(1).tint(colour)
      .animateProperty("spriteContainer", "scale.x", { from: 0.6, to: 2.4, duration: life })
      .animateProperty("spriteContainer", "scale.y", { from: 0.6, to: 2.4, duration: life })
      .fadeOut(life * 0.7).duration(life);
  },

  jb2a(bases, wanted, { scale = 1.4, below = false } = {}, fallback = null) {
    return (seq, token) => {
      const file = Core.jb2a(bases, wanted);
      if (!file) return fallback?.(seq, token);
      return local(seq, token).file(file).scaleToObject(scale).belowTokens(below);
    };
  },

  /** A hit: JB2A impact, else a red flash. */
  hit() {
    return Once.jb2a(JB2A.impact, ["dark_red", "red", "orange"], { scale: 1.6 }, Once.flash(C.red, { scale: 1.8, life: 450 }));
  },

  /** Healing: JB2A's green swirl, else a green cross rising. */
  heal() {
    return Once.jb2a(JB2A.heal, ["green", "green_orange"], { scale: 1.6 }, (seq, token) =>
      local(seq, token).file(img("cross.webp")).scaleToObject(0.7).tint(C.green)
        .animateProperty("sprite", "position.y", { from: 0, to: -canvas.grid.size * 0.6, duration: 1200 })
        .fadeIn(150).fadeOut(600).duration(1200));
  },

  /**
   * Chrome switching on: a flash and a ring in its colour; Berserk cracks the ground (JB2A) and
   * speedware leaves a quick second ring.
   */
  activate(key, tint) {
    const out = [Once.flash(tint, { scale: key === "berserk" ? 2.6 : 2, life: key === "kerenzikov" ? 350 : 550 }), Once.pulse(tint, { life: key === "berserk" ? 800 : 500 })];
    if (key === "berserk") out.push(Once.jb2a(["jb2a.impact.ground_crack", "jb2a.impact.004"], ["orange", "dark_red", "red"], { scale: 2.4, below: true }));
    else out.push((seq, token) => Once.pulse(tint, { life: 500 })(seq, token).delay(140));
    return out;
  },

  /** Chrome switching off: a small grey ring. */
  deactivate() {
    return [Once.pulse(C.grey, { life: 450 })];
  },

  /** A quickhack landing: a cyan glitch burst and the data ring snapping shut. */
  upload() {
    return (seq, token) => {
      local(seq, token).file(GLITCH).scaleToObject(1.4).filter("ColorMatrix", { hue: 180 })
        .loopProperty("sprite", "alpha", { values: flicker(8), duration: 50, absolute: true }).duration(500);
      local(seq, token).file(img("data-ring.webp")).scaleToObject(1.8).belowTokens()
        .animateProperty("spriteContainer", "scale.x", { from: 1.6, to: 0.9, duration: 400 })
        .animateProperty("spriteContainer", "scale.y", { from: 1.6, to: 0.9, duration: 400 })
        .fadeOut(300).duration(700);
    };
  }
};

/* ---------------------------------------- */
/*  The looks                               */
/* ---------------------------------------- */

/** The full cyberpsychosis glitch (the macro's switch, and Extreme Cyberpsychosis). */
export const PSYCHO = [
  Layers.glow(C.red, { min: 0.35, max: 0.85, period: 260, distance: 8 }),
  Layers.rgbSplit(),
  Layers.scanlines(),
  Layers.glitch(),
  Layers.glitch({ period: 85, amp: 5 }),
  Layers.jb2a(JB2A.electric, ["dark_red", "red", "orange"], { scale: 1.4, opacity: 0.6, hueToRed: true })
];

const electric = (opacity = 0.75) => Layers.jb2a(JB2A.electric, ["blue"], { scale: 1.3, opacity }, Layers.glow(C.cyan, { min: 0.2, max: 0.9, period: 180 }));
const hacked = (peak = 0.55) => Layers.glitch({ hue: 180, peak, period: 90 });
const fire = (scale, opacity, glow) => [
  Layers.jb2a(JB2A.fire, ["orange"], { scale, opacity }, Layers.aura(C.orange, { scale: scale + 0.4, min: 0.3, max: 0.7, period: 300 })),
  ...(glow ? [Layers.glow(C.orange, { min: 0.3, max: 0.8, period: 240 })] : [])
];

export const RECIPES = {
  // Wound States
  seriouslyWounded: { layers: [Layers.glow(C.blood, { min: 0.15, max: 0.35, period: 1600 })] },
  mortallyWounded: { layers: [Layers.glow(C.red, { min: 0.3, max: 0.8, period: 700 }), Layers.ekg()], motion: "tremble" },
  unconscious: { layers: [Layers.zzz(C.cyan)] },
  stabilized: { once: [Once.heal()] },

  // Combat
  grappled: { layers: [Layers.glow(C.amber, { min: 0.2, max: 0.45 })] },
  grappling: { layers: [Layers.glow(C.amber, { min: 0.15, max: 0.3 })] },
  choking1: { layers: [Layers.glow(C.violet, { min: 0.2, max: 0.45 })], motion: "tremble" },
  choking2: { layers: [Layers.glow(C.violet, { min: 0.4, max: 0.85, period: 600 })], motion: "tremble" },
  hidden: { layers: [Layers.camo()] },
  // The 2070 gun in hand (Neon Arsenal puts these on): kept faint, they're on most of a crew.
  powerRebuild: { layers: [Layers.aura(C.orange, { scale: 1.45, min: 0.06, max: 0.18, period: 2200 })] },
  smartRebuild: { layers: [Layers.ring(img("reticle-white.webp"), { scale: 1.45, tint: C.pink, opacity: 0.22, spin: 16000 })] },
  improvedSmart: { layers: [Layers.ring(img("reticle-white.webp"), { scale: 1.2, tint: C.cyan, opacity: 0.2, spin: -11000 })] },
  monoRebuild: { layers: [Layers.glow(C.cyan, { min: 0.08, max: 0.22, period: 1800, distance: 6 })] },
  techRebuild: { layers: [Layers.ring(img("data-ring-white.webp"), { scale: 1.55, tint: C.blue, opacity: 0.25, spin: 12000 })] },
  intoTheWall: { once: [Once.hit()] },
  suppressed: { layers: [Layers.ring(img("reticle-white.webp"), { tint: C.amber, opacity: 0.55, spin: 9000, scale: 1.8 })] },
  netrunning: { layers: [Layers.ring(img("data-ring.webp"), { opacity: 0.9, spin: 14000, scale: 2 }), Layers.glow(C.cyan, { min: 0.2, max: 0.45 })] },
  flashbanged: { once: [Once.flash(C.white, { scale: 3, life: 900 })], layers: [Layers.glow(C.white, { min: 0.1, max: 0.6, period: 300 })], motion: "tremble" },
  teargassed: { layers: [Layers.jb2a(JB2A.smoke, ["white", "grey"], { scale: 1.6, opacity: 0.55, tint: 0xd8ff6a }, Layers.aura(0xd8ff6a))] },
  sleep: { layers: [Layers.zzz(C.violet)] },
  emp: { once: [Once.pulse(C.cyan)], sound: "zap", layers: [electric(0.7), hacked(0.7)], motion: "glitch" },
  tarotWinded: { once: [Once.flash(C.gold)] },
  tarotNoPain: { once: [Once.flash(C.gold)] },
  tarotChromeShutdown: { once: [Once.flash(C.gold)] },
  tarotFated: { once: [Once.flash(C.gold)] },

  // Hazards
  onFireMild: { layers: fire(1, 0.75, false) },
  onFireStrong: { layers: fire(1.3, 0.9, false) },
  onFireDeadly: { layers: fire(1.6, 1, true), motion: "tremble" },
  drowning: { layers: [Layers.aura(C.blue)], motion: "tremble" },
  asphyxiating: { layers: [Layers.glow(C.violet, { min: 0.2, max: 0.5 })], motion: "tremble" },
  electrocuted: { sound: "zap", layers: [electric(0.85)], motion: "tremble" },
  radiationLow: { layers: [Layers.glow(C.toxic, { min: 0.15, max: 0.35, period: 1800 })] },
  radiationHigh: { layers: [Layers.glow(C.toxic, { min: 0.35, max: 0.75, period: 900 }), Layers.jb2a(JB2A.toxic, ["green"], { scale: 1.5, opacity: 0.45 })] },
  acid: { layers: [Layers.glow(C.acid, { min: 0.3, max: 0.6, period: 800 })] },

  // Situations
  extremeStress: { motion: "tremble" },
  drunk: { motion: "sway" },
  smoke: { layers: [Layers.jb2a(JB2A.smoke, ["grey", "white"], { scale: 1.8, opacity: 0.55 }, Layers.aura(C.grey))] },
  extremeCyberpsychosis: {
    sound: "psychoSting",
    once: [Once.pulse(C.red)],
    layers: [Layers.ring(img("reticle-red.webp"), { scale: 2.1, spin: 6000, opacity: 0.9, pulse: 500 }), ...PSYCHO],
    motion: "psycho"
  },

  // Drugs
  speedheal: { once: [Once.heal()] },
  blackLace: { layers: [Layers.glow(0x7a1cff, { min: 0.2, max: 0.5, period: 900 })] },
  blueGlass: { layers: [Layers.glow(0x2f7bff, { min: 0.2, max: 0.5, period: 2000 })], motion: "sway" },
  boost: { layers: [Layers.glow(C.gold, { min: 0.15, max: 0.35 })] },
  smash: { layers: [Layers.glow(C.pink, { min: 0.15, max: 0.4 })] },
  synthcoke: { layers: [Layers.glow(C.white, { min: 0.15, max: 0.4, period: 500 })], motion: "tremble" },

  // Quickhacks (each also gets the upload burst and sound, below)
  qhPopupGeddon: { layers: [hacked(0.7)] },
  qhRebootOptics: { layers: [hacked(0.8)], motion: "glitch" },
  qhShortCircuit: { sound: "zap", layers: [electric(0.8)], motion: "tremble" },
  qhCyberwareMalfunction: { layers: [hacked(0.5)], motion: "glitch" },
  qhWeaponGlitch: { layers: [hacked(0.4)] },
  qhLimbSeize: { layers: [hacked(0.5)], motion: "glitch" },
  qhSpeedwareCrash: { layers: [hacked(0.4)] },
  qhSonicShock: { layers: [Layers.ring(img("ring-pulse.webp"), { tint: C.cyan, opacity: 0.6, scale: 1.8, pulse: 300 })], motion: "tremble" },
  qhFrameLock: { layers: [hacked(0.6)], motion: "glitch" },
  qhQKrash: { layers: [hacked(0.6)] },
  qhSystemReset: { layers: [hacked(0.8)] },
  qhPuppet: { layers: [Layers.ring(img("data-ring-white.webp"), { tint: C.violet, opacity: 0.85, spin: 8000, scale: 1.9 })] },
  qhCyberpsychosis: { layers: [Layers.glow(C.red, { min: 0.3, max: 0.7, period: 300 }), Layers.rgbSplit({ amp: 5 }), Layers.glitch({ peak: 0.7 })], motion: "psycho" },

  // Switched on by the macros, not by a condition
  psycho: { layers: PSYCHO, motion: "psycho" },
  sandevistan: { layers: [Layers.fringe(), Layers.glow(C.green, { min: 0.15, max: 0.4, period: 900 })] },
  // Berserk running: a hard red pulse and a red haze, and the shakes
  berserk: { layers: [Layers.glow(C.red, { min: 0.3, max: 0.8, period: 420 }), Layers.aura(C.red, { scale: 1.9, min: 0.2, max: 0.45, period: 700 })], motion: "tremble" },
  // A Kerenzikov (and other speedware) running: a cool blue edge
  kerenzikov: { layers: [Layers.glow(C.blue, { min: 0.12, max: 0.35, period: 700 })] }
};

/**
 * The recipe for a condition: the table's own, plus the shared pieces every Critical Injury
 * (a hit) and every quickhack (the upload) gets.
 */
export function recipeFor(condition) {
  if (!condition) return null;
  const own = RECIPES[condition.id] ?? null;
  if (condition.category === "critical") return { ...own, once: [...(own?.once ?? []), Once.hit()] };
  if (condition.category === "quickhack") return { ...own, once: [...(own?.once ?? []), Once.upload()], sound: own?.sound ?? "upload" };
  return own;
}

/** Keys (condition ids, and the macro switches) that have persistent layers. */
export const LAYERED = new Set(Object.entries(RECIPES).filter(([, r]) => r.layers?.length).map(([k]) => k));

