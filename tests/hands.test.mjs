/** Equip / Change Weapon: hands, equipping into a free one, freeing, dropping, and picking things up as Carried. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, testUsers, missingKeys, notes, chat } from "./helpers/foundry.mjs";

await registerSettings();
const { Hands } = await import("../scripts/hud/hands.js");
const { context } = await import("../scripts/hud/hands-app.js");
const { catalog } = await import("../scripts/hud/catalog.js");
const { Run } = await import("../scripts/hud/run.js");
const { Compat } = await import("../scripts/compat.js");
const { Settings } = await import("../scripts/settings.js");
Hands.init();

const NCM = "cpr-neon-combat-manager";
const { player } = testUsers;

/** A character with a pistol in hand, a rifle and a knife Carried, a stashed shotgun and a pop-up cyberweapon. */
function choom(extra = []) {
  return makeActor({ name: "Kade", owners: [player.id] }, [
    { _id: "pistol", name: "Heavy Pistol", type: "weapon", system: { equipped: "equipped", handsReq: 1, isRanged: true, magazine: { value: 8, max: 8 } } },
    { _id: "rifle", name: "Assault Rifle", type: "weapon", system: { equipped: "carried", handsReq: 2, isRanged: true } },
    { _id: "knife", name: "Combat Knife", type: "weapon", system: { equipped: "carried", handsReq: 1, isRanged: false } },
    { _id: "stash", name: "Shotgun", type: "weapon", system: { equipped: "owned", handsReq: 2 } },
    { _id: "popup", name: "Popup Gun", type: "cyberware", system: { isWeapon: true, isInstalled: true } },
    ...extra
  ]);
}
const modules = () => game.modules;

test("hands: two to start, the sheet's equipped weapon in the first, Carried weapons to equip", () => {
  const kade = choom();
  const st = Hands.state(kade);
  assert.deepEqual(st.slots.map((s) => [s.id, s.item?.id ?? null]), [["R", "pistol"], ["L", null]]);
  assert.deepEqual([st.free, st.total], [1, 2]);
  assert.deepEqual(st.carried.map((c) => [c.item.id, c.need]), [["rifle", 2], ["knife", 1]], "Carried weapons only: not the stash, not cyberware");
});

test("more hands from Cyberpunk RED's Number of Hands (or the 2070 Shoulder Mount); fewer for a Dismembered Arm", () => {
  const four = choom();
  four._getHands = () => 4;
  assert.deepEqual(Hands.slots(four).map((s) => s.id), ["R", "L", "R2", "L2"]);
  const mount = choom([{ _id: "asm", name: "Artificial Shoulder Mount", type: "cyberware", system: { isInstalled: true } }]);
  assert.equal(Hands.slots(mount).length, 4, "the 2070 item has no Number of Hands effect: it counts as two more");
  const armless = choom([{ _id: "inj", name: "Dismembered Arm", type: "criticalInjury", flags: { "cpr-neon-at-home": { side: "L" } }, system: {} }]);
  const st = Hands.state(armless);
  assert.deepEqual(st.slots.map((s) => [s.id, s.lost]), [["R", false], ["L", true]]);
  assert.equal(st.free, 0);
});

test("equipping into a chosen free hand; a two-handed weapon with one hand free is blocked with a warning", async () => {
  const kade = choom();
  notes.length = 0;
  assert.equal(await Hands.equip(kade, kade.items.get("rifle")), false);
  assert.equal(kade.items.get("rifle").system.equipped, "carried");
  assert.match(notes.at(-1)[1], /needs 2 hands and Kade has 1 free/);
  assert.equal(await Hands.equip(kade, kade.items.get("knife"), "L"), true);
  assert.equal(kade.items.get("knife").system.equipped, "equipped");
  assert.deepEqual(kade.items.get("knife").flags[NCM].hands, ["L"]);
  assert.deepEqual(Hands.state(kade).slots.map((s) => s.item?.id), ["pistol", "knife"]);
  // Full: nothing more goes in.
  const extra = choom([{ _id: "smg", name: "SMG", type: "weapon", system: { equipped: "carried", handsReq: 1 } }]);
  await Hands.equip(extra, extra.items.get("knife"));
  notes.length = 0;
  assert.equal(await Hands.equip(extra, extra.items.get("smg")), false);
  assert.match(notes.at(-1)[1], /no free hand for SMG/);
});

test("freeing a hand puts the weapon back to Carried; a two-handed one then fits", async () => {
  const kade = choom();
  await Hands.free(kade, kade.items.get("pistol"));
  assert.equal(kade.items.get("pistol").system.equipped, "carried");
  assert.equal(await Hands.equip(kade, kade.items.get("rifle"), "L"), true);
  assert.deepEqual(kade.items.get("rifle").flags[NCM].hands, ["L", "R"], "the chosen hand first, then the next free one");
  assert.equal(Hands.state(kade).free, 0);
});

test("dropping: Neon At Home's drop when it's on; Item Piles otherwise; without either it stays on the sheet as Owned", async () => {
  const calls = [];
  modules().set("cpr-neon-at-home", { id: "cpr-neon-at-home", active: true, api: { drop: async (actor, id) => calls.push(["home", id]) } });
  const kade = choom();
  await Hands.drop(kade, kade.items.get("pistol"));
  assert.deepEqual(calls, [["home", "pistol"]]);
  modules().delete("cpr-neon-at-home");

  // Item Piles: a pile beside the token, and the weapon leaves the character.
  const piles = [];
  modules().set("item-piles", { id: "item-piles", active: true });
  game.itempiles = { API: { createItemPile: async (o) => (piles.push(o), { actorUuid: "Actor.pile" }), isValidItemPile: (a) => a?.id === "pile" } };
  const scene = { id: "sc1", grid: { size: 100 } };
  const withToken = choom();
  withToken.getActiveTokens = () => [{ document: { x: 300, y: 200, parent: scene } }];
  chat.length = 0;
  await Hands.drop(withToken, withToken.items.get("pistol"));
  assert.equal(piles[0].sceneId, "sc1");
  assert.deepEqual(piles[0].position, { x: 400, y: 200 });
  assert.equal(piles[0].items[0].name, "Heavy Pistol");
  assert.equal(piles[0].items[0].flags[NCM].dropped, true);
  assert.equal(withToken.items.get("pistol"), undefined);
  assert.match(chat.at(-1).content, /drops Heavy Pistol on the ground/);
  modules().delete("item-piles");
  delete game.itempiles;

  // Neither: Owned, a chat line.
  const plain = choom();
  await Hands.drop(plain, plain.items.get("pistol"));
  assert.equal(plain.items.get("pistol").system.equipped, "owned");
  assert.match(chat.at(-1).content, /stays on the sheet as Owned/);
});

test("picking up: out of an Item Piles pile, onto a dropped mark, or (no Item Piles) a sheet drop, it lands Carried", async () => {
  modules().set("item-piles", { id: "item-piles", active: true });
  game.itempiles = { API: { isValidItemPile: (a) => a?.id === "pile" } };
  const kade = choom();
  const pile = { id: "pile", type: "container" };
  const targetUpdates = { itemsToCreate: [{ name: "Knife", type: "weapon", system: { equipped: "owned" }, flags: { [NCM]: { dropped: true, hands: ["R"] } } }, { name: "Rounds", type: "ammo", system: {} }] };
  Hooks.call("item-piles-preTransferItems", pile, {}, kade, targetUpdates, "x");
  assert.equal(targetUpdates.itemsToCreate[0].system.equipped, "carried");
  assert.equal(targetUpdates.itemsToCreate[0].flags[NCM].hands, undefined);
  assert.equal(targetUpdates.itemsToCreate[1].system.equipped, undefined, "ammo isn't equippable");
  // From one character to another (a trade, not a pickup): untouched.
  const other = { itemsToCreate: [{ name: "Knife", type: "weapon", system: { equipped: "owned" } }] };
  Hooks.call("item-piles-preTransferItems", choom(), {}, kade, other, "x");
  assert.equal(other.itemsToCreate[0].system.equipped, "owned");
  // Into a pile: untouched.
  const intoPile = { itemsToCreate: [{ name: "Knife", type: "weapon", system: { equipped: "carried" } }] };
  Hooks.call("item-piles-preTransferItems", kade, {}, pile, intoPile, "x");
  assert.equal(intoPile.itemsToCreate[0].system.equipped, "carried");
  await Settings.set("pickupCarried", false);
  const off = { itemsToCreate: [{ name: "Knife", type: "weapon", system: { equipped: "owned" } }] };
  Hooks.call("item-piles-preTransferItems", pile, {}, kade, off, "x");
  assert.equal(off.itemsToCreate[0].system.equipped, "owned", "the setting turns it off");
  await Settings.set("pickupCarried", true);
  modules().delete("item-piles");
  delete game.itempiles;

  // Something dropped earlier (here or by Neon At Home), however it comes back.
  const made = (data) => {
    const item = { type: data.type, system: { ...data.system }, flags: data.flags ?? {}, parent: kade };
    item.updateSource = (u) => {
      for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(item, k, v);
    };
    Hooks.call("preCreateItem", item, data, {}, game.user.id);
    return item;
  };
  assert.equal(made({ type: "weapon", system: { equipped: "owned" }, flags: { "cpr-neon-at-home": { dropped: true } } }).system.equipped, "carried");
  assert.equal(made({ type: "gear", system: { equipped: "owned" } }).system.equipped, "owned", "a plain new item keeps the system's default");
  // No Item Piles: an item dropped on the character's sheet is a pickup.
  Hooks.call("dropActorSheetData", kade, {}, { type: "Item", uuid: "Item.x" });
  assert.equal(made({ type: "gear", system: { equipped: "owned" } }).system.equipped, "carried");
  Hands.expect(null);
});

test("the HUD: Change Ammo sits with each gun's buttons, Equip / Change Weapon ends the Weapons group and opens the window", async () => {
  const kade = choom();
  const c = catalog(kade);
  const pistol = c.weapons.find((w) => w.key === "weapon:heavypistol");
  assert.deepEqual(pistol.buttons.map((b) => b.key).slice(-2), ["rld:pistol", "ammo:pistol"]);
  assert.equal(c.weapons.at(-1).key, "hands:equip");
  assert.equal(c.weapons.at(-1).sub, "1/2 free");
  const log = [];
  kade.items.get("pistol").doAction = async (actor, attrs) => log.push(attrs["data-action"].nodeValue);
  await Run.action(kade, "ammo:pistol");
  assert.deepEqual(log, ["select-ammo"], "the sheet's own Change Ammo");
  const app = await Run.action(kade, "hands:open");
  assert.equal(app.actor, kade);
  // Empty-handed with something Carried: the entry lights up.
  const bare = choom();
  await Hands.free(bare, bare.items.get("pistol"));
  assert.equal(catalog(bare).weapons.at(-1).alert, true);
});

test("the Equip / Change Weapon window renders with every string", async () => {
  const kade = choom([{ _id: "inj", name: "Dismembered Hand", type: "criticalInjury", system: {} }]);
  await Hands.free(kade, kade.items.get("pistol"));
  const ctx = context(kade);
  assert.deepEqual(ctx.hands.map((h) => [h.id, h.lost]), [["R", true], ["L", false]]);
  assert.equal(ctx.carried.find((c) => c.id === "rifle").fits, false);
  const html = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/hud-hands.hbs", ctx);
  assert.ok(html.includes('data-action="equipHand" data-item="knife" data-hand="L"'));
  assert.ok(html.includes("1 of 1 hands free") && html.includes("Left hand"));
  await Hands.equip(kade, kade.items.get("knife"), "L");
  const held = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/hud-hands.hbs", context(kade));
  assert.ok(held.includes('data-action="freeHand" data-item="knife"') && held.includes('data-action="dropItem"'));
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});
