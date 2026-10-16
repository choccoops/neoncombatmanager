import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { Carousel } from "../combat/carousel.js";
import { debounce, L, esc } from "../util.js";

const WOUND_TONE = { notWounded: "ok", lightlyWounded: "light", seriouslyWounded: "serious", mortallyWounded: "mortal" };

/**
 * The crew's status bar: an RPG-style party HUD with each player character's portrait, HP,
 * armor, LUCK, Wound State and conditions, and a banner when they're down (Mortally Wounded,
 * Unconscious, flatlined). Everyone sees it; the GM picks who's in the crew.
 */
export const PartyBar = {
  el: null,

  init() {
    const soon = debounce(() => this.render(), 80);
    this.soon = soon;
    for (const h of ["updateActor", "createActor", "deleteActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
      "createItem", "updateItem", "deleteItem", "updateCombat", "deleteCombat", "createCombatant", "deleteCombatant",
      "updateUser", `${MODULE_ID}.refreshUI`]) {
      Hooks.on(h, () => soon());
    }
    // In the top position it sits under the carousel, so it moves when the carousel does.
    Hooks.on(`${MODULE_ID}.carouselPlaced`, () => this.place());
    window.addEventListener("resize", debounce(() => this.place(), 100));
  },

  /** The crew: the GM's list, or every character a player owns. */
  members() {
    const ids = Settings.get("partyMembers") ?? [];
    if (ids.length) return ids.map((id) => game.actors.get(id)).filter(Boolean);
    return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
  },

  async render() {
    if (!Settings.get("partyEnabled")) return this.remove();
    const members = this.members();
    // With no crew yet the GM still gets the bar, to pick one; players see nothing.
    if (!members.length && !game.user.isGM) return this.remove();
    const data = this.context(members);
    const html = await Compat.renderTemplate(`${TEMPLATE_PATH}/party-bar.hbs`, data);
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.id = "ncm-party";
      this.el.addEventListener("click", (ev) => this._onClick(ev));
      this.el.addEventListener("dblclick", (ev) => this._onDblClick(ev));
    }
    const pos = Settings.get("partyPosition");
    // Bottom flows above the hotbar; left and top are fixed to the window.
    const parent = pos === "bottom" ? Compat.uiBottom : document.body;
    if (this.el.parentElement !== parent) {
      if (pos === "bottom") parent.prepend(this.el);
      else parent.append(this.el);
    }
    this.el.className = `neon-combat ncm-party pos-${pos}${data.collapsed ? " is-collapsed" : ""}${data.empty ? " is-empty" : ""}`;
    this.el.innerHTML = html;
    this.place();
  },

  /** Top position: centred over the play area, under the carousel when it's up (else where it would be). */
  place() {
    if (!this.el || Settings.get("partyPosition") !== "top") return;
    const area = Carousel.area();
    const below = Carousel.bottom;
    this.el.style.setProperty("--ncm-top", `${below === null ? area.top : below + 6}px`);
    this.el.style.setProperty("--ncm-center", `${area.center}px`);
    this.el.style.setProperty("--ncm-room", `${area.room}px`);
  },

  remove() {
    this.el?.remove();
    this.el = null;
  },

  context(members) {
    const combat = game.combat;
    const turnActor = combat?.started ? combat.combatant?.actor : null;
    return {
      gm: game.user.isGM,
      collapsed: !!Settings.get("partyCollapsed"),
      empty: !members.length,
      members: members.map((actor) => this.member(actor, turnActor))
    };
  },

  member(actor, turnActor) {
    const hp = CPR.hp(actor);
    const wound = CPR.woundState(actor);
    const armor = CPR.armor(actor);
    const luck = { value: CPR.stat(actor, "luck"), max: Number(foundry.utils.getProperty(actor, "system.stats.luck.max")) || 0 };
    const dead = Conditions.has("dead", actor);
    const unconscious = Conditions.has("unconscious", actor) || Conditions.has("sleep", actor);
    const mortal = wound === "mortallyWounded";
    let banner = null;
    if (dead) banner = { tone: "dead", label: L(`${LANG}.Party.Flatlined`) };
    else if (mortal) banner = { tone: "mortal", label: L(`${LANG}.Party.Dying`, { penalty: CPR.deathSave(actor).penalty }) };
    else if (unconscious) banner = { tone: "down", label: L(`${LANG}.Party.Unconscious`) };
    const conditions = [];
    const seen = new Set();
    for (const e of actor.temporaryEffects ?? []) {
      const c = Registry.ofEffect(e);
      const key = c?.id ?? e.id;
      if (seen.has(key) || c?.mirror === "wound" || e.disabled) continue;
      seen.add(key);
      conditions.push({ img: e.img ?? c?.img, name: e.name, category: c?.category ?? "other" });
    }
    const role = CPR.roles(actor).sort((a, b) => b.rank - a.rank)[0];
    return {
      id: actor.id,
      name: actor.name,
      img: actor.img,
      role: role ? `${role.name}${role.rank ? ` ${role.rank}` : ""}` : "",
      hp: { ...hp, pct: hp.max ? Math.max(0, Math.min(100, Math.round((hp.value / hp.max) * 100))) : 0 },
      serious: Number(foundry.utils.getProperty(actor, "system.derivedStats.seriouslyWounded")) || Math.ceil(hp.max / 2),
      seriousPct: hp.max ? Math.round(((Number(foundry.utils.getProperty(actor, "system.derivedStats.seriouslyWounded")) || Math.ceil(hp.max / 2)) / hp.max) * 100) : 50,
      wound,
      woundTone: WOUND_TONE[wound] ?? "ok",
      woundLabel: L(`${LANG}.Wound.${wound}`),
      armor,
      luck,
      humanity: Number(foundry.utils.getProperty(actor, "system.derivedStats.humanity.value")) || 0,
      conditions,
      banner,
      down: !!banner,
      turn: turnActor === actor,
      owner: actor.isOwner
    };
  },

  async _onClick(ev) {
    const btn = ev.target.closest("[data-ncm]");
    if (btn) {
      ev.preventDefault();
      if (btn.dataset.ncm === "collapse") {
        await Settings.set("partyCollapsed", !Settings.get("partyCollapsed"));
        return this.render();
      }
      if (btn.dataset.ncm === "configure" && game.user.isGM) return this.configure();
      return null;
    }
    const li = ev.target.closest(".ncm-member");
    const actor = li ? game.actors.get(li.dataset.actorId) : null;
    const token = actor?.getActiveTokens?.(true, false)?.[0] ?? null;
    if (!token) return null;
    if (token.isOwner) token.control({ releaseOthers: !ev.shiftKey });
    if (token.visible) canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
    return null;
  },

  _onDblClick(ev) {
    const li = ev.target.closest(".ncm-member");
    const actor = li ? game.actors.get(li.dataset.actorId) : null;
    if (actor?.testUserPermission(game.user, "OBSERVER")) Compat.openSheet(actor);
  },

  /** GM: pick the crew (none ticked: every character a player owns). */
  async configure() {
    const current = new Set(Settings.get("partyMembers") ?? []);
    const chars = game.actors.filter((a) => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
    const rows = chars.map((a) => `<label class="ncm-check"><input type="checkbox" name="m" value="${a.id}" ${current.has(a.id) ? "checked" : ""}> <img src="${esc(a.img)}" alt=""> ${esc(a.name)}</label>`).join("");
    const result = await Compat.DialogV2.wait({
      window: { title: L(`${LANG}.Party.Configure`) },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<p class="ncm-hint">${L(`${LANG}.Party.ConfigureHint`)}</p><div class="ncm-member-pick">${rows}</div>`,
      buttons: [
        {
          action: "save",
          label: L(`${LANG}.Common.Save`),
          default: true,
          // v12 passes (event, button, htmlElement); v13 (event, button, dialog).
          callback: (event, button) => [...button.form.querySelectorAll("input[name=m]:checked")].map((i) => i.value)
        },
        { action: "cancel", label: L(`${LANG}.Common.Cancel`) }
      ],
      rejectClose: false
    });
    if (Array.isArray(result)) await Settings.set("partyMembers", result);
  }
};
