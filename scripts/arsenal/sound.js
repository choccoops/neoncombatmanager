import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Core } from "../neonfx/core.js";
import { SOUNDS, soundFiles } from "./profile.js";

/**
 * Weapon sounds. Each client plays them itself, at that player's own FX volume (Neon FX's volume
 * and channel settings, 0.4 by default) with a short fade-in, so nothing arrives at full blast.
 * The attacker's client tells the others what to play.
 */
export const Sound = {
  init() {
    Socket.on("event:arsenalSound", (data) => this.local(data));
  },

  get on() {
    return !!Settings.get("arsenalSounds") && Core.sequencer;
  },

  /** Play on every client. */
  play(key, { delay = 0, repeat = 1, gap = 0 } = {}) {
    if (!this.on || !SOUNDS[key]) return false;
    const data = { key, delay, repeat, gap };
    Socket.broadcast("arsenalSound", data);
    return this.local(data);
  },

  /** Play here only. */
  local({ key, delay = 0, repeat = 1, gap = 0 }) {
    const s = SOUNDS[key];
    const volume = Core.volume(s?.level ?? 0);
    if (!s || volume <= 0 || !Core.sequencer || !Settings.get("arsenalSounds")) return false;
    try {
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      const part = seq.sound().file(soundFiles(key)).volume(volume).fadeInAudio(s.fadeIn ?? 40).locally();
      if (delay) part.delay(delay);
      if (repeat > 1) part.repeats(repeat, gap);
      const channel = Settings.get("fxChannel");
      if (channel && channel !== "interface") part.audioChannel(channel);
      seq.play();
      return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | Neon Arsenal sound ${key}`, err);
      return false;
    }
  }
};
