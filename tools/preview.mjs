// Renders the carousel, crew bar, Condition Lab, Environment window and chat cards with sample
// data into preview/index.html (`npm run preview`), to look at the styling without Foundry.
// Cyberpunk RED's status icons are copied in when the system's source is found next door
// (CPR_SOURCE=/path/to/fvtt-cyberpunk-red-core/src).
import { mkdir, writeFile, cp, access } from "node:fs/promises";
import path from "node:path";
import { makeActor, makeCombat, registerSettings, root } from "../tests/helpers/foundry.mjs";

const Settings = await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { Carousel } = await import("../scripts/combat/carousel.js");
const { Compat } = await import("../scripts/compat.js");
const { summary } = await import("../scripts/conditions/lab-app.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Registry.refresh();
await Settings.set("conditionChat", "off");
await Settings.set("weatherSource", "manual");
await Settings.set("manualWeather", { cond: "heavyRain", band: "hot", strange: "" });

const out = path.join(root, "preview");
await mkdir(out, { recursive: true });
const cprSrc = process.env.CPR_SOURCE ?? path.resolve(root, "..", "cprredfoundry", "fvtt-cyberpunk-red-core-v0.92.4", "src");
try {
  await access(path.join(cprSrc, "icons"));
  await cp(path.join(cprSrc, "icons", "compendium", "status"), path.join(out, "systems/cyberpunk-red-core/icons/compendium/status"), { recursive: true });
} catch {
  console.warn("Cyberpunk RED source not found: its status icons won't show");
}

const portrait = (hue) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue},40%,14%)"/><circle cx="32" cy="24" r="12" fill="hsl(${hue},80%,60%)"/><path d="M10 64c2-16 12-22 22-22s20 6 22 22z" fill="hsl(${hue},80%,45%)"/></svg>`)}`;
const vee = makeActor({ name: "Velvet", img: portrait(320), system: { derivedStats: { hp: { value: 31, max: 45 }, seriouslyWounded: 23 } } }, [{ name: "Solo", type: "role", system: { rank: 4 } }]);
const hazel = makeActor({ name: "Hazel Monroe", img: portrait(190), system: { derivedStats: { hp: { value: 14, max: 40 } } } }, [{ name: "Netrunner", type: "role", system: { rank: 6 } }]);
const sage = makeActor({ name: "Professor Sage", img: portrait(50), system: { derivedStats: { hp: { value: -2, max: 35 }, deathSave: { penalty: 2 } } } }, [{ name: "Medtech", type: "role", system: { rank: 5 } }]);
const ganger = makeActor({ name: "Maelstrom Ganger", type: "mook", hasPlayerOwner: false, img: portrait(0), system: { derivedStats: { hp: { value: 9, max: 30 } } } });
const boss = makeActor({ name: "Royce", type: "mook", hasPlayerOwner: false, img: portrait(10) });
await Conditions.add(["onFireMild", "wxHeavyRain", "wxHot"], vee);
await Conditions.add(["grappled", "brokenArm", "darkness"], hazel, { force: true });
await Conditions.add(["unconscious"], sage);
await Conditions.add(["prone", "lowLight", "concussion"], ganger);
await Conditions.add(["dead"], boss);
const combat = makeCombat([vee, ganger, hazel, sage, boss], { round: 4, turn: 0 });
combat.turns[1].isOwner = false;
combat.turns[4].isOwner = false;
combat.turns[4].defeated = true;
game.time.worldTime = 79200 + 14 * 60;
await combat.setFlag("cpr-neon-combat-manager", "started", game.time.worldTime - 9);

const T = (name, data) => Compat.renderTemplate(`modules/cpr-neon-combat-manager/templates/${name}.hbs`, data);
const carousel = await T("carousel", Carousel.context(combat));
const labList = ["brokenLeg", "onFireStrong", "darkness", "wxAcidRain", "blackLace", "flashbanged"].map((id) => {
  const c = Registry.get(id);
  return { id, name: c.name, img: c.img, hint: c.hint, category: game.i18n.localize(`NEONCOMBAT.Category.${c.category}`), summary: summary(c), page: typeof c.page === "number" ? `Core rulebook p.${c.page}` : c.page, override: id === "darkness" };
});
const lab = await T("lab", { gm: true, views: [{ id: "all", label: "All", count: 95, active: true }, { id: "critical", label: "Critical Injury", count: 22 }, { id: "weather", label: "Weather", count: 15 }], list: labList, cltPending: true, shim: true });
const card1 = await T("chat-card", { title: "Professor Sage: Death Save", kicker: "Mortally Wounded", img: Registry.get("mortallyWounded").img, tone: "red", body: "<p>Roll 1d10 + penalty under BODY 6 to hold on (penalty 2; a 10 always fails).</p>", buttons: [{ action: "deathSave", label: "Roll Death Save", icon: "fa-solid fa-heart-crack", attrs: "" }] });
const card2 = await T("chat-card", { title: "Velvet: 2 damage", kicker: "On Fire (Mild)", img: Registry.get("onFireMild").img, tone: "red", body: "<p>Straight to HP; armor isn't touched.</p>", buttons: [{ action: "applyDamage", label: "Apply", icon: "fa-solid fa-droplet", attrs: "" }] });
const env = await T("environment", { gm: true, manual: true, hub: false, sources: [{ value: "manual", label: "Manual", selected: true }], calendars: [], sky: [{ value: "heavyRain", label: "Heavy Rain", selected: true }], strange: [{ value: "", label: "None", selected: true }], bands: [{ value: "hot", label: "Hot", selected: true }],
  now: ["wxHeavyRain", "wxHot"].map((id) => ({ img: Registry.get(id).img, name: Registry.get(id).name, hint: Registry.get(id).hint })), band: "Hot", temp: "85°F / 29°C", scene: { name: "Watson Alley", darkness: 80 }, sceneModes: [{ value: "default", label: "Default", selected: true }],
  rows: [{ name: "Velvet", img: vee.img, outdoors: true, level: "dim", levelLabel: "Low light", sightLabel: "-3", conditions: ["wxHeavyRain", "obscured"].map((id) => Registry.get(id)) }, { name: "Hazel Monroe", img: hazel.img, outdoors: true, level: "dark", levelLabel: "Dark", sightLabel: "—", vision: true, conditions: [] }] });

// Comms: Biomon Link, a live holocall, the dialer, an incoming call, a holo message in chat.
const { readout, ecgPath } = await import("../scripts/comms/vitals.js");
const row = (actor, wound, extra = {}) => {
  const hp = actor.system.derivedStats.hp;
  const v = readout({ hp: hp.value, max: hp.max, wound, ...extra });
  const label = { stable: "STABLE", light: "MINOR TRAUMA", serious: "SERIOUS TRAUMA", critical: "CRITICAL", down: "UNRESPONSIVE", flatline: "FLATLINE" }[v.state];
  return { id: actor.id, name: actor.name, img: actor.img, ...v, label: v.signal ? label : "NO SIGNAL", implantHint: v.implant ? `Vitals broadcast through: ${v.implant}` : "", ecg: ecgPath(v.state), beat: v.bpm ? `${(60 / v.bpm) * 3}s` : "0s", icons: [], mine: actor === vee, fullBiomon: true };
};
const biomon = await T("biomon", { gm: false, links: [{ id: "l1", name: "Crew", canCall: true, members: [
  row(vee, "lightlyWounded", { implant: "Neuroport" }), row(hazel, "seriouslyWounded", { implant: "Biomonitor" }), row(sage, "mortallyWounded", { deathSave: 2, implant: "Neuroport" }),
  row(ganger, "notWounded", { signal: false })
] }], unlinked: [{ id: "x", name: "New Recruit", ok: true }, { id: "y", name: "Unchromed", ok: false }], canLink: true, needsImplant: true, joinable: [{ id: "l1", name: "Crew" }] });
const rogue = { name: "Rogue", img: portrait(280) };
const holo = await T("holocall", { dialer: false, gm: true, timer: "01:12", participants: [
  { id: "p0", name: "Velvet", img: vee.img, stateLabel: "On the line", state: "joined", live: true },
  { id: "p1", name: "Rogue", img: rogue.img, stateLabel: "On the line", state: "joined", live: true },
  { id: "p2", name: "Hazel Monroe", img: hazel.img, stateLabel: "Ringing…", state: "ringing" }
], messages: [
  { name: "Rogue", img: rogue.img, time: "21:04", content: '<div class="ncm-holo-line"><span class="ncm-holo-tag">◈ HOLO</span><p>Got a job for you, choom. Arasaka convoy, Watson, midnight.</p></div>' },
  { name: "Velvet", img: vee.img, time: "21:05", mine: true, content: '<div class="ncm-holo-line"><span class="ncm-holo-tag">◈ HOLO</span><p>How much?</p></div>' }
], voices: [{ value: "p1", label: "Rogue", selected: true }], canTalk: true });
const dialer = await T("holocall", { dialer: true, gm: false, callers: [{ value: "a", label: "Velvet", selected: true }], crew: [{ key: "k1", name: "Hazel Monroe", img: hazel.img, online: true }, { key: "k2", name: "Professor Sage", img: sage.img, online: false }],
  links: [{ id: "l1", name: "Crew", count: 3 }], contacts: [{ key: "c1", name: "Rogue", img: rogue.img, trustPips: [true, true, true, true, false] }, { key: "c2", name: "Snitch", img: portrait(60), burned: true, trustPips: [true, false, false, false, false] }], live: [], count: 1, messenger: true });
const ring = await T("incoming-call", { caller: rogue, others: "Velvet" });
const holoChat = `<li class="chat-message message ncm-holo"><header class="message-header"><h4 class="message-sender">Rogue</h4><span class="whisper-to">To: Velvet, GM</span></header><div class="message-content"><div class="ncm-holo-line"><span class="ncm-holo-tag">◈ HOLO</span><p>Got a job for you, choom.</p></div></div></li>`;

const icons = Registry.all().map((c) => `<figure><img src="${c.img}" alt=""><figcaption>${c.name}</figcaption></figure>`).join("");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Neon Combat Manager preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="../styles/neon-combat.css">
<style>
body{margin:0;background:#2b2d35 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 0h40v40' fill='none' stroke='%23383a44'/%3E%3C/svg%3E");font-family:Signika,sans-serif;color:#ddd}
#ui-left{position:fixed;left:0;top:0;bottom:0;width:110px;background:rgba(255,255,255,.04);border-right:1px dashed #555}
#ui-right{position:fixed;right:0;top:0;bottom:0;width:300px;background:rgba(255,255,255,.04);border-left:1px dashed #555}
#ui-middle{position:fixed;left:110px;right:300px;top:0;height:200px;pointer-events:none}
#navigation{margin:60px 8px 0;padding:6px;border:1px dashed #666;color:#888;font-size:12px}
body>.row,body>.icons,#ui-bottom{margin-top:240px}
.row{display:flex;gap:16px;align-items:flex-start;padding:16px;flex-wrap:wrap}
.win{width:760px;border:1px solid #36364f}
.win .window-content{max-height:520px;overflow:auto}
.chat-message{padding:6px;margin:4px 0;border:1px solid #666;background:#e8e3d4;color:#222}.message-header{display:flex;justify-content:space-between}.message-sender{margin:0}
.chat{width:300px;display:grid;gap:10px}
.icons{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;padding:16px;background:#111}
.icons figure{margin:0;text-align:center;font-size:11px}.icons img{width:48px;height:48px;display:block;margin:0 auto 4px}
#ui-bottom{display:flex;justify-content:center;padding:16px}
</style></head><body>
<div id="ui-left"></div><div id="ui-middle"><div id="ui-top"><nav id="navigation">Scene tabs</nav></div></div><div id="ui-right"></div>
<section id="ncm-carousel" class="neon-combat ncm-carousel size-medium">${carousel}</section>
<script>
  // What Carousel.place() does: centre over #ui-middle, at the top.
  const r = document.getElementById("ui-middle").getBoundingClientRect();
  const el = document.getElementById("ncm-carousel");
  el.style.setProperty("--ncm-center", Math.round(r.left + r.width / 2) + "px");
  el.style.setProperty("--ncm-room", Math.round(r.width - 16) + "px");
</script>
<div class="row">
  <div class="neon-combat ncm-window ncm-lab application win"><header class="window-header">Condition Lab</header><section class="window-content">${lab}</section></div>
  <div class="chat">${card1}${card2}</div>
  <div class="neon-combat ncm-window ncm-environment application win" style="width:620px"><header class="window-header">Environment</header><section class="window-content">${env}</section></div>
</div>
<div class="row">
  <div class="neon-combat ncm-window ncm-biomon application win" style="width:340px"><header class="window-header">Biomon Link</header><section class="window-content">${biomon}</section></div>
  <div class="neon-combat ncm-window ncm-holocall application win" style="width:460px;height:560px;display:flex;flex-direction:column"><header class="window-header">Holocall</header><section class="window-content" style="flex:1">${holo}</section></div>
  <div class="neon-combat ncm-window ncm-holocall application win" style="width:400px;height:560px;display:flex;flex-direction:column"><header class="window-header">Holocall</header><section class="window-content" style="flex:1">${dialer}</section></div>
  <div style="display:grid;gap:12px;align-content:start">
    <div class="neon-combat ncm-window ncm-incoming application win" style="width:300px"><header class="window-header">Incoming holocall</header><section class="window-content">${ring}</section></div>
    <ol style="list-style:none;padding:0;width:300px;font-size:13px">${holoChat}</ol>
  </div>
</div>
<div class="icons">${icons}</div>
</body></html>`;
await writeFile(path.join(out, "index.html"), html.replaceAll('src="modules/cpr-neon-combat-manager/', 'src="../').replaceAll('src="systems/', 'src="systems/'));
console.log(`preview/index.html written`);
