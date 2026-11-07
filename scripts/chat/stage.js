import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { FX } from "../fx.js";
import { L, esc } from "../util.js";

/** Expressions, each with its icon (and an animation in the CSS). */
export const MOODS = {
  neutral: "fa-solid fa-face-meh",
  happy: "fa-solid fa-face-smile",
  angry: "fa-solid fa-face-angry",
  sad: "fa-solid fa-face-sad-tear",
  surprised: "fa-solid fa-face-surprise",
  scared: "fa-solid fa-face-grimace",
  smug: "fa-solid fa-face-smile-wink",
  hurt: "fa-solid fa-face-dizzy",
  thinking: "fa-solid fa-face-rolling-eyes"
};

/* -------------------------------------------- */
/*  The cast, pure (tests import it)            */
/* -------------------------------------------- */

/**
 * Change the cast: { op: "add"|"remove"|"mood"|"flip"|"clear", actorId, name, img, side, mood }.
 * Characters alternate sides as they come on, the first on the left.
 * @returns {object[]} the new cast
 */
export function castChange(cast, change) {
  const list = (cast ?? []).map((c) => ({ ...c }));
  const i = list.findIndex((c) => c.id === change.actorId);
  switch (change.op) {
    case "add": {
      if (i >= 0) return list;
      const left = list.filter((c) => c.side === "left").length;
      const right = list.length - left;
      list.push({ id: change.actorId, name: change.name ?? "", img: change.img ?? "", side: change.side ?? (left <= right ? "left" : "right"), mood: "neutral", flip: false });
      return list;
    }
    case "remove":
      return i >= 0 ? list.filter((c) => c.id !== change.actorId) : list;
    case "mood":
      if (i >= 0 && change.mood in MOODS) list[i].mood = change.mood;
      return list;
    case "flip":
      if (i >= 0) list[i].flip = !list[i].flip;
      return list;
    case "side":
      if (i >= 0) list[i].side = list[i].side === "left" ? "right" : "left";
      return list;
    case "clear":
      return [];
    default:
      return list;
  }
}

/** How long a line stays up, in ms: enough to read it. */
export const readTime = (text) => Math.min(20000, Math.max(5000, String(text ?? "").length * 70));

/**
 * The stage: a visual novel over the table. Characters come on stage as big portraits at the
 * bottom of the screen; while you speak as one, what you type in chat is theirs and appears in a
 * dialogue box under them, typed out, formatted. Expressions change the portrait (an image per
 * expression if the character has one, an animation either way). The GM narrates in a box across
 * the screen. The cast is a world setting (the GM writes it, so everyone sees the same stage);
 * the lines come from the chat messages themselves.
 */
export const Stage = {
  el: null,
  /** The actor this user speaks as, or null. */
  speaker: null,
  /** GM: everything typed is narration. */
  narrating: false,
  /** Lines on screen: actorId -> { html, text, timer, emote }. */
  lines: new Map(),

  get cast() {
    return Settings.get("stageCast")?.cast ?? [];
  },

  get enabled() {
    return !!Settings.get("stageEnabled");
  },

  init() {
    Hooks.on(`${MODULE_ID}.stageChanged`, () => this.render());
    Hooks.on("createChatMessage", (message) => this.onMessage(message));
    Hooks.on("updateActor", (actor) => this.cast.some((c) => c.id === actor.id) && this.render());
  },

  registerSocket() {
    Socket.on("stageSet", async (change, userId) => {
      const user = game.users.get(userId);
      const actor = change.actorId ? game.actors.get(change.actorId) : null;
      if (change.op === "clear" ? !user?.isGM : !(user?.isGM || actor?.testUserPermission(user, "OWNER"))) throw new Error(L(`${LANG}.Stage.NotYours`));
      const data = change.op === "add" ? { ...change, name: actor?.name ?? change.name, img: actor?.img ?? change.img } : change;
      return Settings.set("stageCast", { cast: castChange(this.cast, data), at: Date.now() });
    });
  },

  /* ---------------------------------------- */
  /*  Changing the cast                       */
  /* ---------------------------------------- */

  async set(change) {
    return Socket.request("stageSet", change);
  },

  /** Put characters on stage; you speak as the last one of yours. */
  async add(actors) {
    const list = (Array.isArray(actors) ? actors : [actors]).filter((a) => a && (game.user.isGM || a.isOwner));
    if (!list.length) throw new Error(L(`${LANG}.Stage.NoOne`));
    for (const a of list) await this.set({ op: "add", actorId: a.id });
    const mine = list.filter((a) => a.isOwner).at(-1);
    if (mine) this.speakAs(mine.id);
    return list;
  },

  async remove(actorId) {
    if (this.speaker === actorId) this.speakAs(null);
    return this.set({ op: "remove", actorId });
  },

  async mood(mood, actorId = this.speaker) {
    if (!actorId) throw new Error(L(`${LANG}.Stage.NotSpeaking`));
    if (!(mood in MOODS)) throw new Error(L(`${LANG}.Stage.NoMood`, { mood }));
    return this.set({ op: "mood", actorId, mood });
  },

  async clear() {
    this.speakAs(null);
    return this.set({ op: "clear" });
  },

  /** Speak as a staged character (or stop: null). */
  speakAs(actorId) {
    this.speaker = actorId && this.cast.some((c) => c.id === actorId) ? actorId : actorId && game.actors.get(actorId) ? actorId : null;
    this.renderDock();
    this.render();
  },

  /** The picture for a cast member: the expression's image if their actor has one. */
  imgOf(c) {
    const actor = game.actors.get(c.id);
    return actor?.flags?.[MODULE_ID]?.moods?.[c.mood] || actor?.img || c.img || "icons/svg/mystery-man.svg";
  },

  /* ---------------------------------------- */
  /*  Chat                                    */
  /* ---------------------------------------- */

  /**
   * Before a typed message is sent: speaking as someone on stage makes it theirs, in character.
   * @returns {object|null} what to set on the message, or null
   */
  speakerFor(messageData) {
    if (!this.enabled || !this.speaker || !this.cast.some((c) => c.id === this.speaker)) return null;
    const actor = game.actors.get(this.speaker);
    if (!actor?.isOwner) return null;
    return { speaker: { scene: null, token: null, actor: actor.id, alias: actor.name } };
  },

  /** A message was posted: if its speaker is on stage (or it's narration), it shows on stage. */
  onMessage(message) {
    if (!this.enabled || !message?.visible) return;
    const flags = message.flags?.[MODULE_ID] ?? {};
    if (flags.narration) return this.narrate(message.content);
    const actorId = message.speaker?.actor;
    if (!actorId || !this.cast.some((c) => c.id === actorId)) return;
    if (message.rolls?.length || flags.card) return;
    const style = message.style ?? message.type;
    const emote = style === CONST.CHAT_MESSAGE_STYLES?.EMOTE;
    if (style === CONST.CHAT_MESSAGE_STYLES?.OOC) return;
    return this.say(actorId, message.content, { emote });
  },

  /** A line under a character. */
  say(actorId, html, { emote = false } = {}) {
    const prev = this.lines.get(actorId);
    if (prev) clearTimeout(prev.timer);
    const text = textOf(html);
    const line = { html, text, emote, fresh: true };
    line.timer = setTimeout(() => {
      this.lines.delete(actorId);
      this.render();
    }, readTime(text));
    this.lines.set(actorId, line);
    this.render();
  },

  /** The narrator's box across the screen. */
  narrate(html) {
    if (typeof document === "undefined") return;
    this.render();
    const box = document.createElement("div");
    box.className = "ncm-st-narration";
    box.innerHTML = `<span class="ncm-kicker">// ${esc(L(`${LANG}.Stage.Narrator`))}</span><div class="ncm-st-ntext"></div>`;
    box.addEventListener("click", () => box.remove());
    document.querySelector("#ncm-stage .ncm-st-narration")?.remove();
    this.el?.append(box);
    const target = box.querySelector(".ncm-st-ntext");
    const text = textOf(html);
    FX.typeOut(target, text, { speed: 18 });
    setTimeout(() => {
      if (target.isConnected) target.innerHTML = html;
    }, Math.min(6000, text.length * 18 + 400));
    setTimeout(() => box.remove(), readTime(text) + 4000);
  },

  /* ---------------------------------------- */
  /*  Rendering                               */
  /* ---------------------------------------- */

  render() {
    if (typeof document === "undefined") return;
    const cast = this.enabled && Settings.get("stageShow") ? this.cast : [];
    if (!cast.length) {
      this.el?.querySelectorAll(".ncm-st-insert").forEach((e) => e.remove());
      if (this.el && !this.el.querySelector(".ncm-st-narration")) {
        this.el.remove();
        this.el = null;
      }
      this.renderDock();
      return;
    }
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.id = "ncm-stage";
      this.el.className = "neon-combat ncm-stage";
      this.el.innerHTML = '<div class="ncm-st-side left"></div><div class="ncm-st-side right"></div>';
      document.body.append(this.el);
    }
    // Stop short of the sidebar.
    const sidebar = document.getElementById("sidebar");
    this.el.style.setProperty("--ncm-stage-right", `${sidebar && !sidebar.classList.contains("collapsed") ? sidebar.offsetWidth + 10 : 40}px`);
    for (const side of ["left", "right"]) {
      const box = this.el.querySelector(`.ncm-st-side.${side}`);
      const want = cast.filter((c) => c.side === side);
      // Keep inserts that stay (so their animations and lines don't restart).
      for (const fig of [...box.children]) if (!want.some((c) => c.id === fig.dataset.actorId)) fig.remove();
      for (const c of want) {
        let fig = box.querySelector(`[data-actor-id="${c.id}"]`);
        if (!fig) {
          fig = document.createElement("figure");
          fig.dataset.actorId = c.id;
          fig.innerHTML = '<div class="ncm-st-say"><b></b><div class="ncm-st-text"></div></div><img alt=""><figcaption></figcaption>';
          box.append(fig);
        }
        const line = this.lines.get(c.id);
        fig.className = `ncm-st-insert mood-${c.mood}${c.flip ? " is-flip" : ""}${line ? " is-speaking" : ""}${c.id === this.speaker ? " is-mine" : ""}`;
        const img = fig.querySelector("img");
        const src = this.imgOf(c);
        if (img.getAttribute("src") !== src) img.src = src;
        fig.querySelector("figcaption").textContent = game.actors.get(c.id)?.name ?? c.name;
        const say = fig.querySelector(".ncm-st-say");
        say.querySelector("b").textContent = game.actors.get(c.id)?.name ?? c.name;
        say.classList.toggle("is-emote", !!line?.emote);
        const text = say.querySelector(".ncm-st-text");
        if (!line) {
          text.textContent = "";
        } else if (line.fresh) {
          line.fresh = false;
          FX.typeOut(text, line.text, { speed: 22 });
          const html = line.html;
          setTimeout(() => {
            if (text.isConnected && this.lines.get(c.id)?.html === html) text.innerHTML = html;
          }, Math.min(5000, line.text.length * 22 + 300));
        }
      }
    }
    this.renderDock();
  },

  /** The stage bar over the chat box: who you speak as, expressions, staging. */
  renderDock() {
    if (typeof document === "undefined") return;
    const form = document.querySelector("#chat-form, #chat-message")?.closest("form") ?? document.querySelector("#chat-form");
    let dock = document.getElementById("ncm-stage-dock");
    if (!this.enabled || !form) {
      dock?.remove();
      return;
    }
    if (!dock) {
      dock = document.createElement("div");
      dock.id = "ncm-stage-dock";
      dock.className = "neon-combat ncm-st-dock";
      dock.addEventListener("click", (ev) => this._onDock(ev));
      dock.addEventListener("contextmenu", (ev) => {
        const chip = ev.target.closest("[data-actor-id]");
        if (!chip) return;
        ev.preventDefault();
        this.set({ op: "side", actorId: chip.dataset.actorId });
      });
    }
    if (dock.nextElementSibling !== form) form.before(dock);
    const mine = this.cast.filter((c) => game.user.isGM || game.actors.get(c.id)?.isOwner);
    const speaking = this.cast.find((c) => c.id === this.speaker);
    const chips = mine.map((c) => `<span class="ncm-st-chip${c.id === this.speaker ? " is-on" : ""}" data-actor-id="${c.id}" data-tooltip="${esc(L(`${LANG}.Stage.SpeakAs`, { name: c.name }))}"><img src="${esc(this.imgOf(c))}" alt=""><button type="button" data-st="off" aria-label="×"><i class="fa-solid fa-xmark"></i></button></span>`).join("");
    const moods = speaking ? Object.entries(MOODS).map(([k, icon]) => `<button type="button" class="${speaking.mood === k ? "on" : ""}" data-st="mood" data-mood="${k}" data-tooltip="${esc(L(`${LANG}.Stage.Mood.${k}`))}"><i class="${icon}"></i></button>`).join("") : "";
    dock.innerHTML = `<div class="ncm-st-dockrow">
      <span class="ncm-kicker">// ${esc(L(`${LANG}.Stage.Title`))}</span>
      ${chips}
      <button type="button" data-st="add" data-tooltip="${esc(L(`${LANG}.Stage.AddHint`))}"><i class="fa-solid fa-user-plus"></i></button>
      ${game.user.isGM ? `<button type="button" class="${this.narrating ? "on" : ""}" data-st="narrator" data-tooltip="${esc(L(`${LANG}.Stage.NarratorHint`))}"><i class="fa-solid fa-bullhorn"></i></button>` : ""}
      ${game.user.isGM && this.cast.length ? `<button type="button" data-st="curtain" data-tooltip="${esc(L(`${LANG}.Stage.Curtain`))}"><i class="fa-solid fa-person-booth"></i></button>` : ""}
    </div>${moods ? `<div class="ncm-st-dockrow ncm-st-moods">${moods}</div>` : ""}`;
  },

  async _onDock(ev) {
    const btn = ev.target.closest("[data-st]");
    const chip = ev.target.closest("[data-actor-id]");
    try {
      switch (btn?.dataset.st) {
        case "off":
          return await this.remove(chip.dataset.actorId);
        case "mood":
          return await this.mood(btn.dataset.mood);
        case "add":
          return await this.add(this.defaultActors());
        case "narrator":
          this.narrating = !this.narrating;
          return this.renderDock();
        case "curtain":
          return await this.clear();
        default:
          if (chip) return this.speakAs(this.speaker === chip.dataset.actorId ? null : chip.dataset.actorId);
      }
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    return null;
  },

  /** Who "stage" means with no name: the selected tokens, else your character. */
  defaultActors() {
    const selected = (globalThis.canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean);
    if (selected.length) return [...new Set(selected)];
    return game.user.character ? [game.user.character] : [];
  },

  /** An actor by name, among those this user may stage. */
  findActor(name) {
    const want = String(name ?? "").trim().toLowerCase();
    if (!want) return null;
    const pool = game.actors.filter((a) => (game.user.isGM || a.isOwner) && ["character", "mook"].includes(a.type));
    return pool.find((a) => a.name.toLowerCase() === want) ?? pool.find((a) => a.name.toLowerCase().startsWith(want)) ?? null;
  },

  /** A cast member by name. */
  findCast(name) {
    const want = String(name ?? "").trim().toLowerCase();
    return this.cast.find((c) => c.name.toLowerCase() === want) ?? this.cast.find((c) => c.name.toLowerCase().startsWith(want)) ?? null;
  },

  /** Set the expression pictures for a character (owner). */
  async editMoods(actor) {
    if (!actor?.isOwner) return null;
    const cur = actor.flags?.[MODULE_ID]?.moods ?? {};
    const rows = Object.entries(MOODS).map(([k, icon]) => `<div class="ncm-st-moodrow"><i class="${icon}"></i><label>${esc(L(`${LANG}.Stage.Mood.${k}`))}</label><input type="text" name="${k}" value="${esc(cur[k] ?? "")}" placeholder="${esc(actor.img)}"><button type="button" data-pick="${k}"><i class="fa-solid fa-file-image"></i></button></div>`).join("");
    const result = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Stage.MoodsTitle`, { name: actor.name }) },
      content: `<p class="ncm-hint">${esc(L(`${LANG}.Stage.MoodsHint`))}</p><div class="ncm-st-moodform">${rows}</div>`,
      render: (event, dialog) => {
        const root = dialog?.element ?? event?.target?.element ?? document;
        for (const b of root.querySelectorAll?.("[data-pick]") ?? []) {
          b.addEventListener("click", () => {
            const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
            if (!FP) return;
            const input = b.previousElementSibling;
            new FP({ type: "image", current: input.value, callback: (path) => (input.value = path) }).render(true);
          });
        }
      },
      ok: { callback: (event, button) => Object.fromEntries(Object.keys(MOODS).map((k) => [k, button.form.elements[k].value.trim()])) },
      rejectClose: false
    });
    if (!result) return null;
    return actor.update({ [`flags.${MODULE_ID}.moods`]: result });
  }
};

/** The words of a message, for typing out. */
function textOf(html) {
  if (typeof document === "undefined") return String(html ?? "").replace(/<[^>]+>/g, "");
  const d = document.createElement("div");
  d.innerHTML = html ?? "";
  return d.textContent ?? "";
}
