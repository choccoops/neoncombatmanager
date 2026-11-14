import { MODULE_ID } from "../constants.js";
import { Core } from "./core.js";
import { C } from "./recipes.js";

/**
 * The Sandevistan's trail: while a token has it switched on, every move it makes (drag, ruler,
 * arrow keys, another module) leaves green, magenta and cyan afterimages that fade out. Each client
 * draws its own from where it sees the token drawn, so the trail follows the move as it animates
 * and nothing crosses the network.
 */
export const TRAIL = {
  spacing: 0.35, // grid squares between afterimages
  life: 900, // ms an afterimage lingers
  opacity: 0.7,
  colours: [C.green, C.magenta, C.cyan],
  maxJump: 30 // grid squares: a bigger jump is a teleport, not a run
};

/** Where a token is drawn right now (mid-move included). */
export const drawnCentre = (t) => ({ x: t.position.x + t.w / 2, y: t.position.y + t.h / 2 });

export const Trail = {
  /** tokenId -> { last: {x,y}, i } */
  tracks: new Map(),

  /** Called on every token refresh: drop afterimages along the way the token has been drawn. */
  onRefresh(token) {
    if (!token?.id) return;
    if (!Core.on || !Core.state(token).sandevistan || !token.visible) {
      this.tracks.delete(token.id);
      return;
    }
    const gs = canvas.grid.size;
    const step = TRAIL.spacing * gs;
    const now = drawnCentre(token);
    const track = this.tracks.get(token.id);
    if (!track) {
      this.tracks.set(token.id, { last: now, i: 0 });
      return;
    }
    let dx = now.x - track.last.x;
    let dy = now.y - track.last.y;
    let dist = Math.hypot(dx, dy);
    if (dist < step) return;
    if (dist > gs * TRAIL.maxJump) {
      track.last = now;
      return;
    }
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    while (dist >= step) {
      track.last = { x: track.last.x + (dx / dist) * step, y: track.last.y + (dy / dist) * step };
      this.ghost(seq, token, track.last, track.i++);
      dx = now.x - track.last.x;
      dy = now.y - track.last.y;
      dist = Math.hypot(dx, dy);
    }
    seq.play();
  },

  /** One afterimage at a point, tinted, glowing, fading out. Drawn on this client only. */
  ghost(seq, token, at, i, life = TRAIL.life) {
    const tint = TRAIL.colours[i % TRAIL.colours.length];
    return seq.effect()
      .copySprite(token)
      .atLocation(at)
      .size(Core.artSize(token))
      .tint(tint)
      .filter("ColorMatrix", { brightness: 1.5, contrast: 1.2 })
      .filter("Glow", { color: tint, distance: 10, outerStrength: 2, quality: 0.15 })
      .opacity(TRAIL.opacity)
      .fadeOut(Math.round(life * 0.8))
      .animateProperty("spriteContainer", "scale.x", { from: 1, to: 1.06, duration: life })
      .animateProperty("spriteContainer", "scale.y", { from: 1, to: 1.06, duration: life })
      .duration(life)
      .belowTokens()
      .locally();
  },

  /** A chromatic pop on the spot: three offset copies at once (switching on or off). */
  pop(token, life = 600) {
    if (!Core.on || !token?.visible) return;
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    const c = drawnCentre(token);
    const off = canvas.grid.size * 0.06;
    [[-off, 0], [off, 0], [0, -off]].forEach(([dx, dy], i) => this.ghost(seq, token, { x: c.x + dx, y: c.y + dy }, i, life));
    seq.play();
  },

  forget(tokenId) {
    this.tracks.delete(tokenId);
  },

  clear() {
    this.tracks.clear();
  }
};
