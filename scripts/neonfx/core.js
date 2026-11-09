import { MODULE_ID, ASSET_PATH } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { FX } from "../fx.js";

/**
 * Neon FX's shared pieces: where its art and sounds live, who draws what, sound at a volume
 * players can stand, and JB2A lookups. Everything visual goes through Sequencer; without it
 * Neon FX stays quiet and the rest of the module carries on.
 */
export const FX_ROOT = `${ASSET_PATH}/fx`;
export const img = (file) => `${FX_ROOT}/img/${file}`;
const sfx = (file) => `${FX_ROOT}/sfx/${file}`;
const takes = (name) => [sfx(`${name}-a.ogg`), sfx(`${name}-b.ogg`)];

/** Token flag (under the module scope) holding the switchable effects: { psycho, sandevistan }. */
export const FX_FLAG = "fx";
/** Every persistent Neon FX effect is named `${PREFIX}-<key>-<tokenId>`. */
export const PREFIX = "ncm-fx";

/**
 * Sounds. `level` is the share of the player's own FX volume (a client setting, 0.4 by default)
 * each one plays at; the files are levelled quiet (about -22 dBFS) and fade in, so nothing jumps.
 */
export const SOUNDS = {
  psychoSting: { files: takes("psycho-sting"), level: 0.55, fadeIn: 300 },
  psychoLoop: { files: takes("psycho-loop"), level: 0.3, fadeIn: 2000 },
  sandeOn: { files: takes("sande-activate"), level: 0.65, fadeIn: 120 },
  sandeOff: { files: takes("sande-deactivate"), level: 0.55, fadeIn: 80 },
  sandeLoop: { files: takes("sande-loop"), level: 0.3, fadeIn: 2000 },
  upload: { files: takes("qh-upload"), level: 0.45, fadeIn: 40 },
  zap: { files: takes("zap"), level: 0.45, fadeIn: 40 },
  avZoneOn: { files: takes("av-zone-on"), level: 0.5, fadeIn: 150 },
  avZoneLoop: { files: takes("av-zone-loop"), level: 0.35, fadeIn: 1500 },
  avApproach: { files: takes("av-approach"), level: 0.55, fadeIn: 1200 },
  avTouchdown: { files: takes("av-touchdown"), level: 0.55, fadeIn: 60 }
};

const jb2aCache = new Map();

export const Core = {
  /** Is Sequencer here to draw with? */
  get sequencer() {
    return !!game.modules.get("sequencer")?.active && typeof globalThis.Sequence === "function" && !!globalThis.Sequencer;
  },

  /** Neon FX on in this world (and drawable). */
  get on() {
    return this.sequencer && !!Settings.get("fxEnabled");
  },

  /** Shaking and swaying tokens: the player's choice, and their system's reduced-motion wish. */
  get motion() {
    return !!Settings.get("fxMotion") && !FX.reduced();
  },

  /** Does this client write the shared (persistent) effects? The active GM, else whoever acted. */
  writes(userId = game.user.id) {
    return Compat.activeGM ? Compat.isActiveGM : userId === game.user.id;
  },

  name(key, token) {
    return `${PREFIX}-${key}-${token.id}`;
  },

  /** The key of one of our effect names on a token, or null. */
  keyOf(name, token) {
    const head = `${PREFIX}-`;
    const tail = `-${token.id}`;
    if (typeof name !== "string" || !name.startsWith(head) || !name.endsWith(tail)) return null;
    return name.slice(head.length, -tail.length) || null;
  },

  /** A token's switchable effects. */
  state(token) {
    const doc = token?.document ?? token;
    return doc?.flags?.[MODULE_ID]?.[FX_FLAG] ?? {};
  },

  /** An actor's tokens on the scene being viewed. */
  tokensOf(actor) {
    try {
      return actor?.getActiveTokens?.() ?? [];
    } catch {
      return [];
    }
  },

  /** Size of the token art as drawn (texture scale, "contain" fit). */
  artSize(token) {
    const d = token.document;
    const gs = canvas.grid.size;
    const w = d.width * gs * Math.abs(d.texture?.scaleX ?? 1);
    const h = d.height * gs * Math.abs(d.texture?.scaleY ?? 1);
    const tex = token.mesh?.texture;
    if (d.texture?.fit === "fill" || !tex?.width || !tex?.height) return { width: w, height: h };
    const ar = tex.width / tex.height;
    return w / h > ar ? { width: h * ar, height: h } : { width: w, height: w / ar };
  },

  /* ---------------------------------------- */
  /*  JB2A                                    */
  /* ---------------------------------------- */

  dbHas(path) {
    try {
      return !!Sequencer.Database.getEntry(path, { softFail: true });
    } catch {
      return false;
    }
  },

  /**
   * The first JB2A entry that exists (free or Patreon), preferring the wanted colours one or two
   * levels down. null when none of them is installed.
   */
  jb2a(bases, wanted = []) {
    const key = `${bases.join("|")}#${wanted.join("|")}`;
    if (jb2aCache.has(key)) return jb2aCache.get(key);
    let found = null;
    for (const base of bases) {
      if (!this.dbHas(base)) continue;
      const kids = Sequencer.Database.getPathsUnder(base) || [];
      const levels = [base, ...kids.map((k) => `${base}.${k}`)];
      for (const lvl of levels) {
        found = wanted.map((c) => `${lvl}.${c}`).find((p) => this.dbHas(p)) ?? null;
        if (found) break;
      }
      found ??= base;
      break;
    }
    jb2aCache.set(key, found);
    return found;
  },

  /** Forget JB2A lookups (after modules change). */
  clearCache() {
    jb2aCache.clear();
  },

  /* ---------------------------------------- */
  /*  Sound                                   */
  /* ---------------------------------------- */

  volume(level) {
    const v = Number(level) * Number(Settings.get("fxVolume") ?? 0);
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  },

  /**
   * Play one of the Neon FX sounds on this client only, at the player's FX volume, on the channel
   * they picked. A name lets endSound stop it (loops); a duration loops it that long.
   */
  sound(key, { name = null, duration = null } = {}) {
    const s = SOUNDS[key];
    const volume = this.volume(s?.level ?? 0);
    if (!s || volume <= 0 || !this.sequencer) return false;
    try {
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      const part = seq.sound().file(s.files).volume(volume).fadeInAudio(s.fadeIn).locally();
      const channel = Settings.get("fxChannel");
      if (channel && channel !== "interface") part.audioChannel(channel);
      if (name) part.name(name);
      if (duration) part.duration(duration).fadeOutAudio(1500);
      seq.play();
      return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | Neon FX sound ${key}`, err);
      return false;
    }
  },

  /** Stop a named Neon FX sound on this client. */
  endSound(name) {
    try {
      Sequencer.SoundManager?.endSounds?.({ name }, false);
    } catch {
      /* nothing playing */
    }
  }
};
