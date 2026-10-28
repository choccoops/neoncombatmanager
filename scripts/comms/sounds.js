import { Settings } from "../settings.js";

/**
 * Holocall sounds: the ringtone (your own audio file from the settings, or a synth chirp), the
 * ringback a caller hears while it rings, and a blip when a call connects or drops. Synth tones
 * use Web Audio at Foundry's interface volume; nothing plays with sounds switched off.
 */
export const Sounds = {
  ctx: null,
  audio: null,
  timer: null,
  /** What's playing: "ring", "back" or null. */
  playing: null,

  get on() {
    return Settings.get("callSounds") !== false && typeof window !== "undefined";
  },

  volume() {
    try {
      return Math.min(1, Number(game.settings.get("core", "globalInterfaceVolume") ?? 0.5));
    } catch {
      return 0.5;
    }
  },

  _ctx() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    this.ctx ??= new C();
    this.ctx.resume?.();
    return this.ctx;
  },

  /** One tone sliding from f1 to f2 Hz over d seconds. */
  _tone(at, f1, f2, d, type = "square", gain = 0.07) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, at);
    o.frequency.exponentialRampToValueAtTime(f2, at + d);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * this.volume()), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + d + 0.03);
  },

  /** Incoming call: loops until stop(). */
  ring() {
    if (!this.on || this.playing === "ring") return;
    this.stop();
    this.playing = "ring";
    const src = Settings.get("callRingtone");
    if (src) {
      const a = new Audio(src);
      a.loop = true;
      a.volume = this.volume();
      a.play().catch(() => null);
      this.audio = a;
      return;
    }
    try {
      if (!this._ctx()) return;
      const chirp = () => {
        const t = this.ctx.currentTime + 0.02;
        [0, 0.14, 0.28].forEach((o, i) => this._tone(t + o, 660 + i * 220, 990 + i * 260, 0.11));
        [0.62, 0.76].forEach((o) => this._tone(t + o, 1480, 880, 0.13, "sawtooth", 0.05));
      };
      chirp();
      this.timer = setInterval(chirp, 2100);
    } catch {
      /* no sound */
    }
  },

  /** The caller's ringback, while the other end rings. */
  back() {
    if (!this.on || this.playing === "back") return;
    this.stop();
    this.playing = "back";
    try {
      if (!this._ctx()) return;
      const beep = () => this._tone(this.ctx.currentTime + 0.02, 425, 425, 0.9, "sine", 0.05);
      beep();
      this.timer = setInterval(beep, 3000);
    } catch {
      /* no sound */
    }
  },

  stop() {
    this.audio?.pause();
    this.audio = null;
    clearInterval(this.timer);
    this.timer = null;
    this.playing = null;
  },

  /** A short blip: connected (up) or dropped (down). */
  blip(up) {
    if (!this.on) return;
    try {
      if (!this._ctx()) return;
      const t = this.ctx.currentTime + 0.02;
      if (up) {
        this._tone(t, 880, 1320, 0.09, "sine", 0.09);
        this._tone(t + 0.1, 1320, 1760, 0.09, "sine", 0.09);
      } else this._tone(t, 900, 300, 0.25, "sawtooth", 0.06);
    } catch {
      /* no sound */
    }
  }
};
