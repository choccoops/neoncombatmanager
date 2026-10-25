/**
 * Compatibility layer: Foundry VTT v12 (what Cyberpunk RED - CORE 0.92 runs on) and v13+.
 *
 * Every Foundry API that moved, was renamed or changed shape between v12 and v13 is reached
 * through here, so the rest of the module never touches a deprecated global or guesses a
 * signature. Lookups prefer the v13 namespaced path and fall back to the v12 global.
 * `npm run check` fails the build if another file uses one of the moved globals directly.
 */
const ns = (path) => foundry.utils.getProperty(globalThis, path);

/**
 * Foundry v12 globals, by name. v12 declares its classes with top-level `class` statements:
 * global names a script can use, but not properties of globalThis, so `globalThis.TextEditor`
 * is undefined there. Each is read as a bare identifier instead.
 */
const V12 = {
  FilePicker: () => (typeof FilePicker === "undefined" ? undefined : FilePicker),
  TextEditor: () => (typeof TextEditor === "undefined" ? undefined : TextEditor),
  renderTemplate: () => (typeof renderTemplate === "undefined" ? undefined : renderTemplate),
  loadTemplates: () => (typeof loadTemplates === "undefined" ? undefined : loadTemplates),
  CombatTracker: () => (typeof CombatTracker === "undefined" ? undefined : CombatTracker)
};
const v12 = (name) => globalThis[name] ?? V12[name]?.();

export const Compat = {
  /** 12, 13, ... */
  get generation() {
    return Number(game.release?.generation ?? 12);
  },

  get isV13() {
    return this.generation >= 13;
  },

  get ApplicationV2() {
    return foundry.applications.api.ApplicationV2;
  },

  get HandlebarsApplicationMixin() {
    return foundry.applications.api.HandlebarsApplicationMixin;
  },

  get DialogV2() {
    return foundry.applications.api.DialogV2;
  },

  get FilePicker() {
    return ns("foundry.applications.apps.FilePicker.implementation") ?? v12("FilePicker");
  },

  get TextEditor() {
    return ns("foundry.applications.ux.TextEditor.implementation") ?? v12("TextEditor");
  },

  renderTemplate(path, data) {
    const fn = ns("foundry.applications.handlebars.renderTemplate") ?? v12("renderTemplate");
    return fn(path, data);
  },

  loadTemplates(paths) {
    const fn = ns("foundry.applications.handlebars.loadTemplates") ?? v12("loadTemplates");
    return fn(paths);
  },

  /** Hooks hand AppV1 apps a jQuery object and AppV2 apps an HTMLElement: always get the element. */
  element(html) {
    if (!html) return null;
    if (html instanceof HTMLElement) return html;
    return html[0] ?? null;
  },

  /** The chat message render hook: v13 renamed it and passes an HTMLElement. */
  get chatRenderHook() {
    return this.isV13 ? "renderChatMessageHTML" : "renderChatMessage";
  },

  /* ---------------------------------------- */
  /*  Users                                   */
  /* ---------------------------------------- */

  /** The active GM who runs automation (one client does each write). */
  get activeGM() {
    return game.users?.activeGM ?? game.users?.find((u) => u.isGM && u.active) ?? null;
  },

  get isActiveGM() {
    return !!game.user?.isGM && this.activeGM?.id === game.user.id;
  },

  /* ---------------------------------------- */
  /*  Scenes and lighting                     */
  /* ---------------------------------------- */

  /** Scene darkness, 0 (day) to 1 (night). v12 moved it to scene.environment. */
  darkness(scene) {
    if (!scene) return 0;
    const env = scene.environment?.darknessLevel;
    if (Number.isFinite(env)) return env;
    return Number(scene.darkness ?? 0) || 0;
  },

  /**
   * Global illumination: { enabled, max } where max is the darkness at or below which the
   * whole scene counts as lit. v12: scene.environment.globalLight; v11: globalLight(Threshold).
   */
  globalLight(scene) {
    const gl = scene?.environment?.globalLight;
    if (gl) return { enabled: !!gl.enabled, max: Number.isFinite(gl.darkness?.max) ? gl.darkness.max : 1 };
    return { enabled: !!scene?.globalLight, max: scene?.globalLightThreshold ?? 1 };
  },

  /** Active light sources on the canvas (ambient lights and token lights), excluding darkness sources. */
  lightSources() {
    const sources = canvas?.effects?.lightSources;
    if (!sources) return [];
    const list = typeof sources.values === "function" ? [...sources.values()] : [...sources];
    return list.filter((s) => s && s.active !== false && !s.isDarkness && !s.isPreview);
  },

  /** Is a canvas point inside a darkness source (v12 darkness lights)? */
  insideDarkness(point, elevation = 0) {
    try {
      if (typeof canvas?.effects?.testInsideDarkness === "function") return !!canvas.effects.testInsideDarkness(point, elevation);
    } catch {
      /* not supported */
    }
    return false;
  },

  /** Regions of a scene (v12+), empty before. */
  regions(scene) {
    return scene?.regions ? [...scene.regions] : [];
  },

  /** Is a point (with elevation) inside a region? */
  inRegion(region, point, elevation = 0) {
    try {
      if (typeof region.testPoint === "function") return !!region.testPoint({ ...point, elevation }, elevation);
      if (typeof region.object?.testPoint === "function") return !!region.object.testPoint({ ...point, elevation }, elevation);
    } catch {
      /* fall through */
    }
    return false;
  },

  /** Distance in grid units (m/yds) between two canvas points. */
  measure(a, b) {
    try {
      const grid = canvas?.grid;
      if (typeof grid?.measurePath === "function") return Number(grid.measurePath([a, b]).distance) || 0;
      if (typeof grid?.measureDistance === "function") return Number(grid.measureDistance(a, b, { gridSpaces: true })) || 0;
    } catch {
      /* fall through */
    }
    const size = canvas?.dimensions?.size || 100;
    const per = canvas?.dimensions?.distance || 2;
    return (Math.hypot(b.x - a.x, b.y - a.y) / size) * per;
  },

  /* ---------------------------------------- */
  /*  Status effects                          */
  /* ---------------------------------------- */

  /** Toggle a status on an actor (v12+: Actor#toggleStatusEffect), else through a token. */
  async toggleStatus(actor, statusId, { active, overlay = false } = {}) {
    if (typeof actor?.toggleStatusEffect === "function") return actor.toggleStatusEffect(statusId, { active, overlay });
    const token = actor?.getActiveTokens?.()[0];
    const status = CONFIG.statusEffects.find((s) => s.id === statusId);
    if (token && status) return token.toggleEffect(status, { active, overlay });
    return null;
  },

  /** Combatants marked defeated: v12 also uses the DEFEATED status. */
  get defeatedStatus() {
    return CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
  },

  /* ---------------------------------------- */
  /*  Interface                               */
  /* ---------------------------------------- */

  /** Where top-of-screen overlays live (v12 and v13 both have #ui-top). */
  get uiTop() {
    return document.getElementById("ui-top") ?? document.body;
  },

  /** Where bottom-of-screen overlays live (v12 and v13 both have #ui-bottom, holding the hotbar). */
  get uiBottom() {
    return document.getElementById("ui-bottom") ?? document.body;
  },

  /**
   * Add buttons to the token controls. v12 hands getSceneControlButtons an array of controls
   * with tool arrays and onClick; v13 an object of controls ("tokens") with tool objects and onChange.
   * @param {object[]|object} controls
   * @param {object[]} tools - { name, title, icon, onClick, visible? }
   */
  addSceneTools(controls, tools) {
    const token = Array.isArray(controls) ? controls.find((c) => c.name === "token") : controls?.tokens ?? controls?.token;
    if (!token) return;
    tools.forEach((t, i) => {
      const tool = { name: t.name, title: t.title, icon: t.icon, button: true, visible: t.visible ?? true, order: t.order ?? 100 + i, onClick: () => t.onClick(), onChange: () => t.onClick() };
      if (Array.isArray(token.tools)) token.tools.push(tool);
      else if (token.tools) token.tools[t.name] = tool;
    });
  },

  /** Open a document's sheet. */
  openSheet(doc) {
    doc?.sheet?.render(true);
  }
};
