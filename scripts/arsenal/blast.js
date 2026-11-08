import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { Registry } from "../conditions/registry.js";
import { Core } from "../neonfx/core.js";
import { Sound } from "./sound.js";
import { Dv } from "./dv.js";
import { templateData, tokenInside, centerOf, blownBack, blowBackMetres, ammoEffect } from "./area.js";
import { L, esc } from "../util.js";

/** A Shotgun Shell (and a flamethrower's) is one attack against DV13 (2070 Core Rules Ch07). */
export const SHELL_DV = 13;

/** How long an unresolved area waits for its damage roll. */
const STALE_MS = 15 * 60 * 1000;

/**
 * The numbers an "Apply damage" button on Cyberpunk RED's damage card carries, pure: total,
 * bonus (a crit's), location, ablation, ammo variety, armor ignored, lethal.
 */
export function damageFromHtml(html) {
  const s = String(html ?? "");
  const btn = /<[^>]*data-action="applyDamage"[^>]*data-scope="global"[^>]*>/.exec(s)?.[0] ?? /<[^>]*data-action="applyDamage"[^>]*>/.exec(s)?.[0];
  if (!btn) return null;
  const attr = (n) => new RegExp(`data-${n}="([^"]*)"`).exec(btn)?.[1] ?? "";
  const num = (n) => Number(attr(n)) || 0;
  return {
    total: num("total-damage"),
    bonus: num("bonus-damage"),
    location: "body",
    ablation: num("ablation"),
    ammoVariety: attr("ammo-variety"),
    ignoreArmorPercent: num("ignore-armor-percent"),
    ignoreBelowSP: num("ignore-below-sp"),
    lethal: !/^false$/i.test(attr("damage-lethal"))
  };
}

/** The tokens of a scene inside a template (documents, no canvas needed); the attacker stays out of a cone. */
export function tokensIn(template, scene, { exclude = null } = {}) {
  const grid = { size: Number(scene?.grid?.size ?? scene?.dimensions?.size) || 100, distance: Number(scene?.grid?.distance ?? scene?.dimensions?.distance) || 2 };
  const t = { t: template.t, x: template.x, y: template.y, distance: template.distance, direction: template.direction, angle: template.angle };
  return [...(scene?.tokens ?? [])].filter((tok) => tok.id !== exclude && !tok.hidden && tokenInside(t, tok, grid));
}

/**
 * Area attacks. Before the dice, the attacker places the area (a 10×10m square for an explosive,
 * a 6m cone for a Shotgun Shell), centred where they aim, and everyone inside it is targeted. The
 * roll then says where it lands: a hit is where they put it, a miss is the GM's to move. The
 * damage roll lists everyone in it, and the GM applies it to all of them at once, the way the
 * area rules have it: one roll, body armor only, armor ablates; Blown back (HOUSE RULE) throws
 * whoever took damage away from the centre; the ammo's own effects (fire, gas, EMP) follow.
 */
export const Blast = {
  init() {
    Socket.on("arsenalApply", (data) => this.applyAsGM(data));
    Socket.on("event:arsenalDetonate", (data) => this.local(data));
    // The attacker's targets follow the area as it moves (the GM moving a miss, or the attacker).
    Hooks.on("updateMeasuredTemplate", (doc, changes, options, userId) => {
      const b = doc.flags?.[MODULE_ID]?.blast;
      if (!b || !("x" in changes || "y" in changes || "direction" in changes)) return;
      if (b.userId === game.user.id) this.retarget(doc);
      // A miss the GM has moved lands there.
      if (b.state === "miss" && Compat.isActiveGM && userId === game.user.id) this.land(doc).catch((err) => console.error(`${MODULE_ID} | blast`, err));
    });
  },

  get on() {
    return !!Settings.get("arsenalAreas");
  },

  grid(scene = canvas?.scene) {
    return { size: Number(scene?.grid?.size ?? canvas?.grid?.size) || 100, distance: Number(scene?.grid?.distance ?? canvas?.dimensions?.distance) || 2 };
  },

  /* ---------------------------------------- */
  /*  Placing                                 */
  /* ---------------------------------------- */

  /**
   * Let the attacker place an area for an attack. Resolves to the template, or null if they
   * cancel (right-click or Escape): the attack then goes ahead at its targets as usual.
   */
  async place({ area, actor, item, token, info, ammo = null }) {
    if (!canvas?.scene || !token || !area) return null;
    const grid = this.grid();
    const origin = token.center;
    const target = [...(game.user.targets ?? [])][0]?.center ?? null;
    const at = (p) => (area.shape === "cone" ? templateData(area, { origin, toward: p }, grid) : templateData(area, { center: Compat.snapCenter(p) }, grid));
    const flags = {
      [MODULE_ID]: {
        blast: {
          actorId: actor.id, tokenId: token.id, itemId: item.id, userId: game.user.id, kind: info.kind, area,
          ammoType: info.ammoType, ammoVariety: info.ammoVariety, ammoName: ammo?.name ?? "", explosive: info.explosive,
          at: Date.now(), state: "placed"
        }
      }
    };
    const cls = CONFIG.MeasuredTemplate.documentClass;
    const doc = new cls({ ...at(target ?? { x: origin.x + grid.size * 3, y: origin.y }), user: game.user.id, fillColor: game.user.color?.css ?? game.user.color ?? "#ff2a6d", flags }, { parent: canvas.scene });
    const preview = new CONFIG.MeasuredTemplate.objectClass(doc);
    await preview.draw();
    const layer = canvas.templates;
    const before = canvas.activeLayer;
    layer.activate?.();
    layer.preview?.addChild(preview);
    ui.notifications.info(L(`${LANG}.Arsenal.PlaceHint`, { size: area.size }));
    return new Promise((resolve) => {
      let done = false;
      const refresh = () => {
        if (typeof preview.renderFlags?.set === "function") preview.renderFlags.set({ refreshShape: true, refreshPosition: true, refreshTemplate: true });
        else preview.refresh?.();
      };
      const move = () => {
        const p = Compat.mousePosition;
        if (!p) return;
        doc.updateSource(at(p));
        refresh();
      };
      const finish = async (ok) => {
        if (done) return;
        done = true;
        canvas.stage.off("pointermove", move);
        canvas.stage.off("pointerdown", down);
        document.removeEventListener("keydown", key, true);
        layer.preview?.removeChild(preview);
        preview.destroy?.({ children: true });
        before?.activate?.();
        if (!ok) return resolve(null);
        const [created] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [doc.toObject()]);
        if (created) this.retarget(created);
        resolve(created ?? null);
      };
      const down = (ev) => {
        const b = ev.button ?? ev.data?.button;
        if (b === 0) finish(true);
        else if (b === 2) finish(false);
      };
      const key = (ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          finish(false);
        }
      };
      canvas.stage.on("pointermove", move);
      canvas.stage.on("pointerdown", down);
      document.addEventListener("keydown", key, true);
      refresh();
    });
  },

  /** Target everyone in the area (the attacker's client). */
  retarget(doc) {
    const b = doc.flags?.[MODULE_ID]?.blast;
    const scene = doc.parent ?? canvas?.scene;
    if (!b || scene?.id !== canvas?.scene?.id) return;
    const ids = tokensIn(doc, scene, { exclude: b.area?.shape === "cone" ? b.tokenId : null }).map((t) => t.id);
    Compat.setTargets(ids);
  },

  /** The open area an attack placed (newest first), on the scene in view. */
  find(actorId, itemId, { states = ["placed", "hit", "miss", "landed"] } = {}) {
    const list = [...(canvas?.scene?.templates ?? [])]
      .filter((t) => {
        const b = t.flags?.[MODULE_ID]?.blast;
        return b && b.actorId === actorId && b.itemId === itemId && states.includes(b.state) && Date.now() - b.at < STALE_MS;
      })
      .sort((a, b) => b.flags[MODULE_ID].blast.at - a.flags[MODULE_ID].blast.at);
    return list[0] ?? null;
  },

  /* ---------------------------------------- */
  /*  The roll                                */
  /* ---------------------------------------- */

  /**
   * The attack card is posted (the attacker's client): does it land where they put it? Updates the
   * area, draws the shot and the blast, and posts the result.
   */
  async onAttack(r, doc) {
    const actor = game.actors.get(r.actorId);
    const item = actor?.items.get(r.itemId);
    const b = doc.flags[MODULE_ID].blast;
    const token = canvas.tokens?.get(b.tokenId);
    const grid = this.grid();
    const center = centerOf(doc, grid);
    let dv;
    if (b.area.shape === "cone") dv = SHELL_DV;
    else dv = await Dv.forWeapon(item, token ? Compat.measure(token.center, center) : 0);
    const total = Number(r.total) || 0;
    const known = Number.isFinite(dv) && dv !== null;
    const hit = known ? total > dv : true;
    const state = hit ? (b.area.shape === "cone" ? "hit" : "landed") : "miss";
    await doc.update({ [`flags.${MODULE_ID}.blast`]: { ...b, state, dv: known ? dv : null, total, attackId: r.messageId ?? null } });
    if (hit) this.detonate(doc, { launch: true });
    else if (b.explosive) this.launchOnly(doc);
    const effect = ammoEffect({ kind: b.kind, ammoType: b.ammoType, ammoName: b.ammoName });
    const inside = tokensIn(doc, doc.parent, { exclude: b.area.shape === "cone" ? b.tokenId : null });
    const result = known ? L(`${LANG}.Arsenal.${hit ? "Hit" : "Miss"}`, { total, dv }) : L(`${LANG}.Arsenal.NoDv`, { total });
    const body = [`<p>${result}</p>`];
    if (!hit && b.explosive) body.push(`<p>${L(`${LANG}.Arsenal.MissMoves`)}</p>`);
    if (hit || b.explosive) body.push(`<p>${L(`${LANG}.Arsenal.Inside`, { count: inside.length, names: esc(inside.map((t) => t.name).join(", ")) || "—" })}</p>`);
    body.push(`<p class="ncm-ref">${L(`${LANG}.Arsenal.AreaRules`)}</p>`);
    const buttons = [];
    if (hit || b.explosive) buttons.push({ action: "arsenal-apply", label: L(`${LANG}.Arsenal.${effect.noDamage ? "ApplyEffects" : "ApplyArea"}`), icon: "fa-solid fa-burst", gm: true, data: { template: doc.uuid } });
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Arsenal.Kicker`),
      title: L(`${LANG}.Arsenal.${b.explosive ? "BlastTitle" : "ConeTitle"}`, { name: esc(actor?.name ?? ""), weapon: esc(item?.name ?? "") }),
      img: item?.img ?? null,
      tone: hit ? "pink" : "cyan",
      body: body.join(""),
      buttons,
      flags: { arsenal: { blast: doc.uuid } }
    });
  },

  /** A moved miss comes down where the GM put it. */
  async land(doc) {
    await doc.update({ [`flags.${MODULE_ID}.blast.state`]: "landed" });
    this.detonate(doc, { launch: false });
  },

  /* ---------------------------------------- */
  /*  Looks and sounds                        */
  /* ---------------------------------------- */

  /** Every client draws and hears the blast (Sequencer effects are shared; sounds are each player's). */
  detonate(doc, { launch = true, noBlast = false } = {}) {
    const data = { template: doc.uuid, launch, noBlast };
    Socket.broadcast("arsenalDetonate", data);
    return this.local(data, doc);
  },

  launchOnly(doc) {
    return this.detonate(doc, { launch: true, noBlast: true });
  },

  /** The looks for an area: a projectile to it, then what the ammo does there. */
  lookFor(b) {
    const type = b.ammoType;
    if (b.kind === "flamethrower") return { bases: ["jb2a.breath_weapons02.burst.cone.fire", "jb2a.breath_weapons.fire.cone", "jb2a.burning_hands.01", "jb2a.burning_hands"], wanted: ["orange"], sound: null, cone: true };
    if (b.area?.shape === "cone") return null;
    if (type === "emp") return { bases: ["jb2a.static_electricity.03", "jb2a.static_electricity.01", "jb2a.static_electricity"], wanted: ["blue"], sound: "emp" };
    if (type === "smoke") return { bases: ["jb2a.fog_cloud.1", "jb2a.fog_cloud", "jb2a.smoke.puff.centered"], wanted: ["white", "grey"], sound: "smoke", duration: 8000 };
    if (["teargas", "poison", "biotoxin", "sleep"].includes(type)) return { bases: ["jb2a.toxic_cloud", "jb2a.fog_cloud.1", "jb2a.fog_cloud"], wanted: ["green", "white"], sound: "smoke", duration: 6000 };
    if (type === "flashbang") return { bases: ["jb2a.explosion.01", "jb2a.explosion"], wanted: ["yellowblue", "whiteblue", "blue"], sound: "grenadeBlast" };
    const rocket = b.kind === "rocketLauncher" || b.kind === "missileLauncher";
    return { bases: ["jb2a.explosion.01", "jb2a.explosion.02", "jb2a.explosion", "jb2a.fireball.explosion"], wanted: ["orange"], sound: rocket ? "rocketBlast" : "grenadeBlast" };
  },

  async local({ template, launch = true, noBlast = false }, given = null) {
    const doc = given ?? (await fromUuid(template));
    const b = doc?.flags?.[MODULE_ID]?.blast;
    if (!doc || !b || doc.parent?.id !== canvas?.scene?.id) return false;
    const grid = this.grid(doc.parent);
    const center = centerOf(doc, grid);
    const token = canvas.tokens?.get(b.tokenId);
    const look = this.lookFor(b);
    const travel = launch && b.explosive && token ? 450 : 0;
    if (look?.sound && !noBlast && Settings.get("arsenalSounds")) Sound.local({ key: look.sound, delay: travel });
    // Only the client that set it off starts the effects: Sequencer shows them to everyone.
    if (given === null || !Core.sequencer || !Settings.get("fxEnabled")) return true;
    try {
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      if (travel) {
        const shot = Core.jb2a(b.kind === "thrownGrenade" ? ["jb2a.throwable.throw.grenade", "jb2a.throwable.throw", "jb2a.bullet.02"] : ["jb2a.throwable.launch.grenade", "jb2a.bullet.02", "jb2a.bullet.01", "jb2a.bullet"], ["green", "orange"]);
        if (shot) seq.effect().file(shot).atLocation(token).stretchTo(center).waitUntilFinished(-100);
      }
      if (look && !noBlast) {
        const file = Core.jb2a(look.bases, look.wanted);
        if (file) {
          const fx = seq.effect().file(file).fadeOut(400);
          if (look.cone && token) fx.atLocation(token).stretchTo(center, { onlyX: false });
          else fx.atLocation(center).size(b.area.size / grid.distance * 1.15, { gridUnits: true });
          if (look.duration) fx.duration(look.duration);
        }
        if (Core.motion && b.explosive && !["smoke", "teargas", "poison", "biotoxin", "sleep"].includes(b.ammoType)) {
          seq.canvasPan().atLocation(center).shake({ duration: 350, strength: 4, rotation: false, fadeOutDuration: 200 });
        }
      }
      seq.play();
    } catch (err) {
      console.warn(`${MODULE_ID} | blast look`, err);
    }
    return true;
  },

  /* ---------------------------------------- */
  /*  Applying it (the GM)                    */
  /* ---------------------------------------- */

  /** The damage card that goes with an area: the newest after it was placed, for the same weapon. */
  damageFor(b) {
    const list = [...(game.messages ?? [])].filter((m) => {
      const a = m.flags?.[MODULE_ID]?.arsenal;
      return a?.kind === "damage" && a.actorId === b.actorId && a.itemId === b.itemId && (m.timestamp ?? 0) >= b.at - 1000;
    });
    const m = list.sort((x, y) => (y.timestamp ?? 0) - (x.timestamp ?? 0))[0];
    return m ? damageFromHtml(m.content) : null;
  },

  /** The GM's dialog: who is in it (untick anyone who dodged out or hid behind cover), Blown back. */
  async askAndApply(uuid, damage = null) {
    const doc = await fromUuid(uuid);
    const b = doc?.flags?.[MODULE_ID]?.blast;
    if (!doc || !b) return ui.notifications.warn(L(`${LANG}.Arsenal.Gone`));
    if (b.state === "resolved") return ui.notifications.info(L(`${LANG}.Arsenal.Done`));
    const effect = ammoEffect({ kind: b.kind, ammoType: b.ammoType, ammoName: b.ammoName });
    const dmg = damage ?? (effect.noDamage ? null : this.damageFor(b));
    if (!effect.noDamage && !dmg) return ui.notifications.warn(L(`${LANG}.Arsenal.RollDamageFirst`));
    const inside = tokensIn(doc, doc.parent, { exclude: b.area.shape === "cone" ? b.tokenId : null }).filter((t) => t.actor);
    const rows = inside.map((t) => `<label class="ncm-check"><input type="checkbox" name="t-${t.id}" checked> ${esc(t.name)}</label>`).join("") || `<p>${L(`${LANG}.Arsenal.Nobody`)}</p>`;
    const blow = b.explosive && Settings.get("arsenalBlowBack");
    const content = `<div class="ncm-grid">${dmg ? `<p>${L(`${LANG}.Arsenal.Damage`, { total: dmg.total, ablation: dmg.ablation })}</p>` : ""}`
      + `<p class="ncm-ref">${L(`${LANG}.Arsenal.UntickHint`)}</p>${rows}`
      + (blow ? `<label class="ncm-check"><input type="checkbox" name="blow" checked> ${L(`${LANG}.Arsenal.BlowBack`, { metres: blowBackMetres(b.kind) })}</label>` : "")
      + `<label class="ncm-check"><input type="checkbox" name="keep"${effect.persist ? " checked" : ""}> ${L(`${LANG}.Arsenal.KeepArea`)}</label></div>`;
    const picked = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Arsenal.ApplyTitle`) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      ok: {
        label: L(`${LANG}.Arsenal.Apply`),
        callback: (event, button) => {
          const f = button.form.elements;
          return { tokens: inside.filter((t) => f[`t-${t.id}`]?.checked).map((t) => t.id), blow: !!f.blow?.checked, keep: !!f.keep?.checked };
        }
      },
      rejectClose: false
    });
    if (!picked) return null;
    return Socket.request("arsenalApply", { template: uuid, damage: dmg, ...picked });
  },

  /**
   * Apply an area (the active GM): Cyberpunk RED's own damage application for each one in it
   * (their armor, shields, damage reduction; its card), then fire, gas or EMP, then Blown back.
   */
  async applyAsGM({ template, damage, tokens = [], blow = false, keep = false }) {
    const doc = await fromUuid(template);
    const b = doc?.flags?.[MODULE_ID]?.blast;
    if (!doc || !b || b.state === "resolved") return null;
    await doc.update({ [`flags.${MODULE_ID}.blast.state`]: "resolved" });
    const scene = doc.parent;
    const grid = this.grid(scene);
    const center = centerOf(doc, grid);
    const effect = ammoEffect({ kind: b.kind, ammoType: b.ammoType, ammoName: b.ammoName });
    const lines = [];
    for (const id of tokens) {
      const tok = scene.tokens.get(id);
      const actor = tok?.actor;
      if (!actor) continue;
      const before = CPR.hp(actor).value;
      if (!effect.noDamage && damage && typeof actor._applyDamage === "function") {
        await actor._applyDamage(damage.total, damage.bonus, "body", damage.ablation, damage.ammoVariety || b.ammoVariety, damage.ignoreArmorPercent, damage.ignoreBelowSP, damage.lethal,
          { damageReductionRole: true, damageReductionAE: true, useShield: true, brainDamageReduction: false });
      }
      const hurt = CPR.hp(actor).value < before;
      const notes = [];
      if (hurt && effect.onDamage?.length) {
        await Conditions.add(effect.onDamage, actor);
        notes.push(effect.onDamage.map((c) => Registry.get(c)?.name ?? c).join(", "));
      }
      if (effect.conditions?.length && !effect.save) {
        await Conditions.add(effect.conditions, actor);
        notes.push(effect.conditions.map((c) => Registry.get(c)?.name ?? c).join(", "));
      }
      if (effect.douse) {
        await Conditions.remove(["onFireMild", "onFireStrong", "onFireDeadly"], actor);
        notes.push(L(`${LANG}.Arsenal.Doused`));
      }
      if (effect.save) await this.saveCard(actor, b, effect);
      if (blow && hurt) {
        const where = this.blowTo(tok, center, blowBackMetres(b.kind), grid);
        if (where) {
          await tok.update({ x: where.x, y: where.y });
          if (where.wall) {
            await Conditions.add("intoTheWall", actor);
            notes.push(Registry.get("intoTheWall")?.name ?? "Into the Wall");
          } else notes.push(L(`${LANG}.Arsenal.BlownBack`));
        }
      }
      lines.push(`<li><strong>${esc(tok.name)}</strong>${effect.noDamage ? "" : ` · ${L(`${LANG}.Arsenal.HpLine`, { before, after: CPR.hp(actor).value })}`}${notes.length ? ` · ${esc(notes.join(" · "))}` : ""}</li>`);
    }
    if (!keep && !effect.persist) await doc.delete();
    const actor = game.actors.get(b.actorId);
    await Cards.post({
      actor,
      kicker: L(`${LANG}.Arsenal.Kicker`),
      title: L(`${LANG}.Arsenal.Applied`, { count: lines.length }),
      tone: "pink",
      body: lines.length ? `<ul class="ncm-chain-pay">${lines.join("")}</ul>` : `<p>${L(`${LANG}.Arsenal.Nobody`)}</p>`
    });
    return lines.length;
  },

  /** Where a token thrown by the blast stops: its new corner, and whether a wall stopped it. */
  blowTo(tok, center, metres, grid) {
    const to = blownBack(tok, center, metres, grid, Math.random() * 360);
    const w = (Number(tok.width) || 1) * grid.size;
    const h = (Number(tok.height) || 1) * grid.size;
    const from = { x: tok.x + w / 2, y: tok.y + h / 2 };
    const stop = Compat.moveBlocked(from, { x: to.x + w / 2, y: to.y + h / 2 });
    if (!stop) return { ...to, wall: false };
    const snap = (v) => Math.round(v / grid.size) * grid.size;
    return { x: snap(stop.x - w / 2), y: snap(stop.y - h / 2), wall: true };
  },

  /** A save against the ammo, for the target's player (and the GM) to roll with CPR's own roll. */
  saveCard(actor, b, effect) {
    const adds = (effect.conditions ?? []).join(",");
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Arsenal.Kicker`),
      title: L(`${LANG}.Arsenal.Save`, { name: esc(actor.name), skill: esc(effect.save.skill), dv: effect.save.dv }),
      tone: "cyan",
      body: `<p>${L(`${LANG}.Arsenal.SaveBody`, { ammo: esc(b.ammoName || b.ammoType) })}</p>`,
      buttons: [{ action: "arsenal-save", label: L(`${LANG}.Arsenal.RollSave`, { skill: esc(effect.save.skill) }), icon: "fa-solid fa-shield-virus", owner: true,
        data: { skill: effect.save.skill, dv: effect.save.dv, adds, direct: effect.direct ?? "" } }],
      whisper: Cards.owners(actor)
    });
  }
};
