import { LANG, SYSTEM_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Conditions } from "../conditions/engine.js";
import { Bridge } from "../roller/bridge.js";
import { combatantOf } from "./catalog.js";
import { L } from "../util.js";

/** Fire modes that stay set on the weapon (as the sheet's checkboxes do), for its Damage roll too. */
const MODES = { atk: "attack", aim: "aimed", auto: "autofire", supp: "suppressive" };

/**
 * Run an Action HUD action the way Cyberpunk RED's sheet does: its roll dialog (Ctrl-click skips
 * it, as on the sheet), the item's confirmRoll (ammo), LUCK, the Death Save result, and its roll
 * card with the targets. This module's roller features ride along, since they hook CPR's rolls.
 */
export const Run = {
  /**
   * @param {Actor} actor
   * @param {string} key - the action's run key ("atk:<id>", "sk:<id>", "turn:initiative"...)
   * @param {object} [ctx] - { event, token }
   */
  async action(actor, key, { event = null, token = null } = {}) {
    if (!actor?.isOwner) return null;
    const [kind, ...rest] = String(key).split(":");
    const id = rest[0];
    const item = id ? actor.items.get(id) : null;
    switch (kind) {
      case "turn":
        return this.turn(actor, id, { event, token });
      case "atk":
      case "aim":
      case "auto":
      case "supp": {
        if (!item) return null;
        if (kind === "atk" || kind === "aim") {
          const { specialsOf, singleShots } = await import("../arsenal/specials.js");
          const { Rebuilds } = await import("../arsenal/rebuilds.js");
          if (!singleShots(specialsOf(item), Rebuilds.isCharged(actor, item))) {
            ui.notifications?.warn(L(`${LANG}.Arsenal.NoSingle`, { name: item.name }));
            return null;
          }
        }
        if (kind === "aim" && (await import("../arsenal/specials.js")).specialsOf(item)?.noAimed) {
          ui.notifications?.warn(L(`${LANG}.Arsenal.NoAimed`, { name: item.name }));
          return null;
        }
        // The mode sticks to the weapon, so its Damage roll knows it (Autofire's multiplier).
        if (kind === "atk") await actor.unsetFlag(SYSTEM_ID, `firetype-${item.id}`);
        else await actor.setFlag(SYSTEM_ID, `firetype-${item.id}`, MODES[kind]);
        return this.roll(actor, item, () => item.createRoll(MODES[kind], actor), { event, token });
      }
      case "dmg": {
        if (!item) return null;
        const damageType = actor.flags?.[SYSTEM_ID]?.[`firetype-${item.id}`] || "attack";
        return this.roll(actor, item, () => {
          const r = item.createRoll("damage", actor, { damageType });
          if (damageType === "aimed" && r) r.location = actor.flags?.[SYSTEM_ID]?.aimedLocation || "body";
          return r;
        }, { event, token });
      }
      case "rico":
      case "chg":
      case "2h":
      case "rnd": {
        if (!item) return null;
        const { Arsenal } = await import("../arsenal/arsenal.js");
        return Arsenal.toggle(actor, item, { rico: "ricochet", chg: "charge", "2h": "twoHands", rnd: "round" }[kind], { token });
      }
      case "chrome":
        return (await import("../neonfx/switches.js")).Switches.toggle(actor, `chrome:${id}`, { token });
      case "scope":
        return (await import("../arsenal/xray.js")).Xray.cycle();
      case "rld": {
        if (!item?.doAction) return null;
        // The weapon's own reload rule (its card), said as it's reloaded.
        const rl = (await import("../arsenal/specials.js")).specialsOf(item)?.reload;
        if (rl) ui.notifications?.info(`${item.name}: ${[rl.actions > 1 ? L(`${LANG}.Arsenal.ReloadRule.actions`, { count: rl.actions }) : "", rl.move ? L(`${LANG}.Arsenal.ReloadRule.${rl.move}`) : ""].filter(Boolean).join(" ")}`);
        return item.doAction(actor, { "data-action": { nodeValue: "reload-ammo" } });
      }
      case "ammo":
        if (!item?.doAction) return null;
        // The sheet's Change Ammo: CPR's load dialog (another ammo, or unload).
        return item.doAction(actor, { "data-action": { nodeValue: "select-ammo" } });
      case "hands":
        return (await import("./hands-app.js")).HandsApp.open(actor);
      case "brawl": {
        // Bare hands: Unarmed in a free hand (made from the compendium if need be), then its Attack.
        const { Hands } = await import("./hands.js");
        const fist = await Hands.bareHands(actor);
        return fist ? this.action(actor, `atk:${fist.id}`, { event, token }) : null;
      }
      case "sk":
        return item ? this.roll(actor, item, () => item.createRoll("skill", actor), { event, token }) : null;
      case "ra": {
        const [, sub, ...name] = rest;
        const subRoleName = name.join(":");
        return item ? this.roll(actor, item, () => item.createRoll("roleAbility", actor, { rollSubType: sub === "main" ? "mainRoleAbility" : "subRoleAbility", subRoleName }), { event, token }) : null;
      }
      case "net": {
        const deck = item;
        const role = (actor.items ?? []).find((i) => i.type === "role" && i.id === actor.system?.roleInfo?.activeNetRole);
        if (!deck) return null;
        if (!role) {
          ui.notifications.error(L(`${LANG}.Hud.NoNetRole`));
          return null;
        }
        return this.roll(actor, deck, () => deck.createRoll("interfaceAbility", actor, { interfaceAbility: rest[1], cyberdeck: deck, netRoleItem: role }), { event, token });
      }
      case "hack": {
        // Quickhacking: Jack In, Breach, a slotted quickhack, Jack Out, Eject.
        const { Hack } = await import("../hack/hack.js");
        return Hack.run(actor, rest, { event, token });
      }
      case "stat":
        return this.roll(actor, null, () => actor.createRoll("stat", id), { event, token });
      case "drug":
        return item?.snort?.();
      case "cond":
        return Conditions.toggle(id, actor);
      case "util":
        return this.utility(actor, id);
      case "macro": {
        // A macro runs for this character and token (its actor and token in the script).
        const macro = game.macros?.get(id);
        if (!macro?.canExecute) return null;
        return macro.execute({ actor, token });
      }
      default:
        return null;
    }
  },

  async turn(actor, what, { event, token }) {
    const combat = game.combat;
    switch (what) {
      case "initiative": {
        if (!combat) {
          ui.notifications.warn(L(`${LANG}.Hud.NoCombat`));
          return null;
        }
        let cb = combatantOf(actor, token, combat);
        // Not in the fight yet: join it (with this token) and roll.
        if (!cb && token?.document) {
          await token.document.toggleCombatant?.();
          cb = combatantOf(actor, token, combat);
        }
        if (!cb) {
          ui.notifications.warn(L(`${LANG}.Hud.NotInCombat`, { name: actor.name }));
          return null;
        }
        return combat.rollInitiative([cb.id]);
      }
      case "run": {
        const { NeonRuler } = await import("../ruler/ruler.js");
        return NeonRuler.toggleRun(actor, token);
      }
      case "endTurn": {
        const cb = combatantOf(actor, token, combat);
        if (combat?.started && cb && combat.combatant?.id === cb.id) return combat.nextTurn();
        ui.notifications.warn(L(`${LANG}.Hud.NotYourTurn`));
        return null;
      }
      case "deathSave":
        return this.roll(actor, null, () => actor.createRoll("deathsave"), { event, token, deathSave: true });
      case "facedown":
        return this.roll(actor, null, () => actor.createRoll("facedown"), { event, token });
      default:
        return null;
    }
  },

  async utility(actor, what) {
    switch (what) {
      case "stakes":
        return (await import("../stakes/stakes.js")).Stakes.open(actor);
      case "phone":
        return (await import("../comms/phone.js")).Phone.open(actor);
      case "biomon":
        return (await import("../comms/biomon-app.js")).BiomonApp.open();
      case "map":
        return (await import("../hub/hub.js")).Hub.open();
      case "sheet":
        return Compat.openSheet(actor);
      default:
        return null;
    }
  },

  /** A CPR roll, from making it to its card (the sheet's _onRoll). */
  async roll(actor, item, make, { event = null, token = null, deathSave = false } = {}) {
    let roll = make();
    if (!roll) return null;
    const ev = event ?? { type: "click", ctrlKey: false, metaKey: false };
    if (typeof roll.handleRollDialog === "function" && !(await roll.handleRollDialog(ev, actor, item))) return null;
    if (item && typeof item.confirmRoll === "function") roll = await item.confirmRoll(roll);
    await roll.roll();
    if (deathSave && typeof actor.processDeathSave === "function") roll.saveResult = actor.processDeathSave(roll);
    const luck = Number(roll.luck);
    if (Number.isInteger(luck) && luck > 0) {
      const have = Number(actor.system?.stats?.luck?.value) || 0;
      await actor.update({ "system.stats.luck.value": have - Math.min(luck, have) });
    }
    const targets = [...(game.user.targets ?? [])].sort((a, b) => (a.name > b.name ? 1 : -1));
    roll.entityData = { actor: actor.id, token: token?.id ?? null, tokens: targets };
    if (item) roll.entityData.item = item.id;
    if (!Bridge.chat) await Bridge.load();
    if (typeof Bridge.chat?.RenderRollCard === "function") await Bridge.chat.RenderRollCard(roll);
    else if (roll.rollCard) {
      roll.criticalCard = typeof roll.wasCritical === "function" ? roll.wasCritical() : false;
      await ChatMessage.create({ content: await Compat.renderTemplate(roll.rollCard, roll), speaker: ChatMessage.getSpeaker({ actor }) });
    }
    // Later Damage rolls hit where the aimed shot did.
    if (roll.location && MODES.aim === actor.flags?.[SYSTEM_ID]?.[`firetype-${item?.id}`]) await actor.setFlag(SYSTEM_ID, "aimedLocation", roll.location);
    return roll;
  }
};
