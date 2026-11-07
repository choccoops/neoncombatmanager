import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";

const FALLBACK = "icons/svg/mystery-man.svg";

/**
 * The speaker of a message: its token (on its scene), its actor, or nobody.
 * @returns {{ actor, token }}
 */
export function speakerOf(message) {
  const sp = message?.speaker ?? {};
  const scene = sp.scene ? game.scenes?.get(sp.scene) : null;
  const token = sp.token ? scene?.tokens?.get(sp.token) ?? null : null;
  const actor = token?.actor ?? (sp.actor ? game.actors?.get(sp.actor) : null) ?? null;
  return { actor, token };
}

/**
 * The picture for a message: the speaking token's art or the actor's (a setting), or, for a
 * player talking as themselves (out of character), their avatar.
 * @param {"token"|"actor"} source
 */
export function portraitOf(message, source = "token") {
  const { actor, token } = speakerOf(message);
  const author = message?.author ?? message?.user ?? null;
  if (actor) {
    if (source === "token") return token?.texture?.src ?? actor.prototypeToken?.texture?.src ?? actor.img ?? FALLBACK;
    return actor.img ?? FALLBACK;
  }
  return author?.avatar ?? FALLBACK;
}

/**
 * Chat portraits: the speaker's picture by their name in every message, framed in their player's
 * colour. This module's own cards carry their picture already and are left alone.
 */
export const Portraits = {
  decorate(message, el) {
    const source = Settings.get("chatPortraits");
    if (!el || source === "off" || el.querySelector(".ncm-chat-portrait")) return;
    if (message.flags?.[MODULE_ID]?.card || message.flags?.[MODULE_ID]?.narration) return;
    const header = el.querySelector(".message-header");
    const sender = header?.querySelector(".message-sender");
    if (!sender) return;
    const author = message.author ?? message.user;
    const img = document.createElement("img");
    img.className = `ncm-chat-portrait shape-${Settings.get("chatPortraitShape")}`;
    img.src = portraitOf(message, source);
    img.alt = "";
    const size = Number(Settings.get("chatPortraitSize")) || 36;
    img.style.setProperty("--ncm-portrait", `${size}px`);
    img.style.setProperty("--ncm-portrait-color", author?.color?.css ?? author?.color ?? "#ff2a6d");
    // Double-click: to the token (when it's on this scene).
    img.addEventListener("dblclick", () => {
      const { token } = speakerOf(message);
      if (token?.object && token.parent?.id === globalThis.canvas?.scene?.id) globalThis.canvas.animatePan({ x: token.object.center.x, y: token.object.center.y });
    });
    header.classList.add("ncm-has-portrait");
    header.prepend(img);
  }
};
