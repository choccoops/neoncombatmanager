# Neon Combat Manager API

For modules and macros. Everything hangs off

```js
const ncm = game.modules.get("cpr-neon-combat-manager")?.api;
```

available from the `init` hook on (the conditions are ready from `setup`). Neon Conditions is
also at `game.neonConditions`. Check the module is active before using it; nothing here needs it.

## Neon Conditions: `ncm.conditions`

Conditions are named by id (`"brokenLeg"`, `"onFireMild"`, `"darkness"`), by their shown name
(`"Broken Leg"`) or loosely (case and punctuation ignored). Entities are Actors, Tokens,
TokenDocuments, uuids or arrays of them; leaving them out means the controlled tokens, else
the user's character. Non-owners' requests go through the GM.

| Call | Does |
| --- | --- |
| `list()` | every condition (resolved: `id`, `name`, `hint`, `img`, `category`, `rawChanges`, `duration`, ...) |
| `get(idOrName)` | one condition, or null |
| `has(idOrName, entity)` | is it on them? |
| `active(entity)` | the conditions on an actor |
| `effects(entity, idOrName?)` | the ActiveEffects carrying conditions |
| `add(ids, entities, options?)` | add; resolves to the effects made |
| `remove(ids, entities, options?)` | remove |
| `toggle(idOrName, entities, { active? })` | toggle, or force on/off |
| `removeAll(entities, { category? })` | remove all (of a category) |
| `register(def)` | add your own condition (see below) |
| `describe(idOrName)` | the HTML description its Active Effect carries: text, what's automated, page |
| `resync(idOrName)` | GM: bring the effects already placed up to date after the condition changed; resolves to how many |
| `openLab()` | open the Condition Lab |

`add` options: `duration` (seconds of world time), `changes` (replace the condition's
modifiers, for automation that works them out per character), `name`, `managed` (a tag for
your automation; `remove(..., { managed })` only removes yours), `flags`, `allowDuplicates`,
`force` (ignore immunity).

```js
// Flashbang a target for a minute (Anti-Dazzle protects):
await ncm.conditions.add("flashbanged", game.user.targets.first());
// Is Velvet on fire?
const velvet = game.actors.getName("Velvet");
const burning = ["onFireMild", "onFireStrong", "onFireDeadly"].some((id) => ncm.conditions.has(id, velvet));
// A custom penalty your module manages:
await ncm.conditions.add("extremeStress", actor, { managed: "my-module", duration: 3600 });
```

### Registering your own condition

Call during `init`, or in the `cpr-neon-combat-manager.registerConditions` hook (fired at
`setup` with `ncm.conditions`):

```js
Hooks.on("cpr-neon-combat-manager.registerConditions", (conditions) => {
  conditions.register({
    id: "myModule-overloaded",
    name: "MYMODULE.Overloaded",          // a localization key or plain text
    hint: "MYMODULE.OverloadedHint",
    img: "modules/my-module/overloaded.svg",
    page: "My Book p.12",                  // shown in the Lab and the effect's description
    category: "situation",                 // wound | critical | combat | hazard | situation | drug | chrome | quickhack | awareness | weather | visibility | custom
    changes: [{ key: "system.stats.move.value", value: -2 }],
    duration: null,                        // seconds
    group: null,                           // only one condition of a group at a time
    turnEnd: { damage: "2" }               // optional Turn automation ("@body", "6d6"...)
  });
});
```

Changes use Cyberpunk RED's roll keys, added (ADD mode) unless they say otherwise:

| Key | Counts on |
| --- | --- |
| `bonuses.allActions` / `allActionsHands` / `allActionsSpeech` | every STAT and Skill Check (or those using a hand / speech) |
| `bonuses.<skill>` (`stealth`, `perceptionSight`, `perceptionHearing`, `resistTortureOrDrugs`...) | one Skill |
| `bonuses.ranged` / `melee` / `universalAttack` / `aimedShot` / `autofire` | attacks |
| `bonuses.initiative`, `bonuses.deathSavePenalty`, `bonuses.hasPainSuppression` | Initiative, Death Saves, Seriously Wounded |
| `system.stats.<stat>.value` | the STAT itself |

Add `situational: true` (and `onByDefault: false` to leave it unticked) to show a modifier as
a toggle in CPR's roll dialog. A STAT floor is a second change with `mode: 4` (UPGRADE), which
Foundry applies after every ADD: `{ key: "system.stats.move.value", value: 1, mode: 4 }` keeps
MOVE at 1 or more. Roll keys (`bonuses.*`) only count in ADD mode. A value can be a dice formula (`"-1d6"`): it's rolled when the
condition lands and shown in its name. `consume: "check"` takes the condition off once the
bearer's next Cyberpunk RED roll card is posted. On a Critical Injury condition, `extra` lists
changes CPR's own item doesn't carry; the token marker keeps them while the item applies the rest. The module writes Cyberpunk RED's bookkeeping flags
(`flags["cyberpunk-red-core"].changes.cats` and `.situational`) for you; any ActiveEffect with
changes created without them gets them too.

Each condition's Active Effect carries a `description` (HTML) written from the condition: its
`hint`, an *Automated:* line (its changes in words and what the module runs for it) or *Not
automated*, and its `page`. A condition brought along by another (`also`) is flagged
`flags["cpr-neon-combat-manager"].alsoOf` with that effect's id and goes when it does.

### Hooks

| Hook | Arguments |
| --- | --- |
| `cpr-neon-combat-manager.conditionAdded` | actor, condition, effect (every client) |
| `cpr-neon-combat-manager.conditionRemoved` | actor, condition, effect (every client) |
| `cpr-neon-combat-manager.registerConditions` | the conditions API (setup) |
| `cpr-neon-combat-manager.statusEffectsChanged` | CONFIG.statusEffects |

### Status effects

`CONFIG.statusEffects` holds each enabled condition by id, with its changes and CPR's flags,
so `actor.toggleStatusEffect("prone")` and the token HUD work as usual. Statuses other modules
push into `CONFIG.statusEffects` during `init` stay.

### Moving from Condition Lab & Triggler

While Condition Lab & Triggler isn't running, `game.clt` is a stand-in (`game.clt.neon` is set)
with `addCondition`, `applyCondition`, `removeCondition`, `removeAllConditions`,
`hasCondition`, `getCondition`, `getConditions`, `getConditionEffects`, `toggleCondition` and
`conditions`. Effects don't carry `flags["condition-lab-triggler"]`, and
`effect.getFlag("condition-lab-triggler", ...)` throws in Foundry while that module is off;
read the raw flags (`effect.flags["condition-lab-triggler"]?.conditionId`) or move to
`ncm.conditions`.

## Stealth segments: `ncm.encounter`

| | |
| --- | --- |
| `mode(combat?)` | `"stealth"` or `"combat"` (a combat not begun yet: the mode it will begin in) |
| `isStealth(combat?)` | true in a stealth segment |
| `begin(mode, combat?)` | GM: begin the combat as a stealth segment or full combat |
| `setMode(mode, combat?)` / `toggle(combat?)` | GM: switch, Initiative order kept; full combat raises the Awareness Ladder to Alert once |

Kept on the combat (`flags.cpr-neon-combat-manager.mode`). Hook
`cpr-neon-combat-manager.encounterMode` (combat, mode) when a combat under way switches.

## The Alert: `ncm.alert`

| | |
| --- | --- |
| `state(combat?)` | the Alert on a combat: `{ id, at, round, rounds, total, endsAt, endRound, called, dismissed }`, or `null` |
| `remaining(combat?)` | seconds left before the response is called |
| `dismiss(combat?)` | GM: wave the countdown away (the Alert stays) |
| `restart(combat?, rounds?)` | GM: start the countdown again from now |
| `call(combat?)` | GM: call the response now |
| `sync(combat?)` | GM: bring the enemies' Awareness conditions in step with the Ladder |

Kept on the combat (`flags.cpr-neon-combat-manager.alert`), written by the active GM when the
Ladder (`flags.cpr-neon-combat-manager.ladder`) climbs to Alert and removed when it drops below.
The conditions are `awareSuspicious`, `awareSearching`, `awareAlert` and `awareSpotted`, placed
with `managed: "ladder"`.

## Combat time: `ncm.time`

| | |
| --- | --- |
| `roundSeconds` | seconds per Round (3 by default) |
| `elapsed(combat?)` | seconds of world time since the combat began |
| `toRounds(seconds)` / `toSeconds(rounds)` | 60 s = 20 Rounds |
| `clock()` | time of day "HH:MM" (Neon Hub's clock when installed) |

Hooks: `cpr-neon-combat-manager.roundTime` (combat, seconds) when a Round moves world time;
`cpr-neon-combat-manager.turnStart` / `turnEnd` (combat, combatant) after the module's own
Turn automation, on the GM's client.

Store timed things as world-time end points and check them on `updateWorldTime`; Rounds,
SmallTime and Neon Hub all move world time.

## Movement ruler: `ncm.ruler`

| | |
| --- | --- |
| `reach(token)` | how far the token's character gets this Turn: `{ move, run, why }` in m/yds (`why`: `"prone"`, `"grappled"`, `"noMove"` or null) |
| `history(token)` | what it walked this Turn, on its own Turn in combat: `{ points, metres }` |

The path is the combatant flag `flags.cpr-neon-combat-manager.path` (`{ points: [{x, y}] centres,
metres, noMove }`), written by the active GM as the token moves and reset at the start of its Turn.

## Cover: `ncm.cover`

| Call | What it does |
|---|---|
| `between(fromToken, toToken, { throughThin })` | the first intact cover on the line of fire (not cover the shooter leans out from): `{ kind: "wall"\|"piece"\|"vehicle", id, section, label, hp, max, thickness, scene }`, or `null` |
| `damage(ref, amount, { explosive, bunkerBuster })` | put damage on that cover (the active GM does it): `{ before, after, taken, destroyed, soaks, label }` |
| `repair(scene)` | (GM) every wall section and cover piece back to full, destroyed sections closed again |
| `tag({ ids, scope, material, thickness })` | (GM) tag walls: `scope` is `"selected"` (with `ids`), `"untagged"` or `"all"`; `material` `""` untags |
| `scan(scene)` | everything that's cover: `{ walls, pieces }` |

Walls keep it in `flags.cpr-neon-combat-manager.cover`: `{ material, thickness, hp: [per 2 m section], broken, restore }`.
Cover pieces are actors with `flags.cpr-neon-combat-manager.cover = { material, thickness }`; their HP is the piece's.
The hook `cpr-neon-combat-manager.coverChanged` (scene) fires when cover is damaged, repaired or tagged.

## Weather and visibility: `ncm.environment`

| | |
| --- | --- |
| `weather()` | `{ keys, band, f, source, calendar }`: keys are Neon Hub's condition keys in effect now (`heavyRain`, `dustStorm`...), plus `hot` |
| `state` | the last refresh: `{ weather, rows }`, one row per character in the encounter (light level, sight penalty, gear, conditions) |
| `refresh()` | recompute now (GM) |
| `lightAt(token)` | `"bright"`, `"dim"` or `"dark"` at a token |
| `gear(actor)` | `{ breathing, radiation, rain, cold, heat, vision }` |
| `open()` | the Environment window |
| `syncWeather()` | GM: put the right Night City weather on the scenes in use now |
| `weatherPreset(keys?)` | the Night City weather preset (`ncmAcidRain`...) for weather keys, default the weather now; `""` for clear skies |

Scene flags: `flags.cpr-neon-combat-manager.weather` is the scene's mode (`outdoor`, `indoor`,
`off`, `default`); `.weatherFx` is `{ weather, preset }`, what the module last put on the scene.
Tile flag `.shelter` (true) shelters what's under the tile. The presets are in
`CONFIG.weatherEffects` under `ncmThunderstorm`, `ncmAcidRain`, `ncmBloodRain`, `ncmHeavyRain`,
`ncmLightRain`, `ncmAshStorm`, `ncmDustStorm`, `ncmRadioactiveWind`, `ncmSmog`, `ncmColdSnap`
and `ncmHeatWave`.

Hook: `cpr-neon-combat-manager.environmentChanged` (state), on the GM's client.

### Night City Messenger

Holocalls go through the messenger's `api.v2` (2.1+): `features.has("calls")`, `calls.place(number, { actorId })`,
`directory.list()` (the GM: an NPC's directory contact) and `open.inbox(actorId)`. api v2 has no
number lookup yet, so a number comes from its macro helper `game.nightcity.messenger.getNumber(actorId)`
(then `callService.numberOf` / `numberOfContact`), and a phone opens at its Calls tab through
`game.nightcity.openInbox(actorId, null, { filter: "calls" })` (falling back to `open.inbox`). All
of it is guarded: without the messenger the Holocall buttons don't show. Nothing is required of it.

### Neon Hub

The module reads Neon Hub's public API: `listCalendars()`, `weather(calendarId)` and `time()`,
and listens to `cpr-neon-hub.weatherChanged` and `cpr-neon-hub.calendarChanged`. Combat moves
world time, which Neon Hub's Clock already follows. Nothing has to change in Neon Hub.

## Biomon Link: `ncm.biomon`

| | |
| --- | --- |
| `open()` | the Biomon Link window |
| `links()` | every link: `{ id, name, members: [actorId] }` |
| `linkOf(actor)` | the link a character is in, or null |
| `vitals(actor)` | `{ state, bpm, pct, hp, max, deathSave, alerts, criticals, implant, signal }`; state is stable, light, serious, down, critical, flatline, or nosignal (no Biomonitor or Neuroport installed while the rule is on: no readings) |
| `create(name, actor)` / `join(linkId, actor)` / `leave(actor)` | link a character you own (through the GM) |

Hook: `cpr-neon-combat-manager.linksChanged` when links change.

## The Plot Die: `ncm.stakes`

| | |
| --- | --- |
| `open(actor?)` | the Plot Die window |
| `raise(actor, { reason })` | (GM) Raise the Stakes on a character's Check: posts the card their player rolls from |
| `roll(actor, { doubleDown })` | roll the Plot Die now and post the result |
| `ask(actor, reason)` | a player asks the GM (LUCK STAT 5+) |
| `luck(actor)` / `options(actor)` | `{ value, max }` / `{ ask, doubleDown, forceFate }` |
| `newSession()` | (GM) Double Down and Force Fate come back for everyone |

A Complication's bonus is the `stakesBonus` condition (Aid / Hinder: `stakesAided`,
`stakesHindered`); all three carry `consume: "check"`. `/stakes` opens the window; `/stakes
<text>` raises (GM) or asks (player) for the speaker. Hook: `cpr-neon-combat-manager.stakesChanged`
when the session counter moves.

## Combat Awareness: `ncm.awareness`

| | |
| --- | --- |
| `open(actor?)` | the Combat Awareness window |
| `isSolo(actor)` / `rank(actor)` | has the Solo role / its Rank |
| `current(actor)` | points by ability: `{ initiativeReaction, precisionAttack, spotWeakness, damageDeflection, threatDetection, fumbleRecovery }` |
| `mode(actor)` | what assigning costs now: `free`, `action` (their Turn), `wait` (not their Turn) or `gm` |
| `assign(actor, points)` | write the split to the role item and post a card. Rejects past the Rank or off-Turn (players). Resolves to the mode, or null if nothing changed |

Hook: `cpr-neon-combat-manager.awarenessAssigned` `(actor, points, mode)`.

## Night City Map: `ncm.hub`

| | |
| --- | --- |
| `open({ view, focus })` / `close()` | the map; `view` is `city`, `zones` or `ncart`; `focus` `{ x, y, key }` |
| `state` | `{ crew: { x, y, label }, pins: { [actorId]: { x, y } }, notes, shown, seen, custom, edits }` |
| `places()` / `visiblePlaces(user?)` | every place (built-in with the GM's edits, then the GM's own: `{ key, name, cat, x, y, text, sc, guard, img, custom, edited, hidden }`) / what a user may see |
| `reveal(keys, { quiet })` / `hide(keys)` | (GM) discovery: reveal places to the players (a "Location discovered" card unless `quiet`), or hide them |
| `addPlace({ name, cat, x, y, text, sc, guard, img }, { visible })` | (GM) a place of your own, hidden until revealed unless `visible`. Resolves to its key (`c-<id>`) |
| `updatePlace(key, fields)` / `resetPlace(key)` / `removePlace(key)` | (GM) change a place (built-in ones keep only what differs), undo a built-in's changes, delete one of your own |
| `doorOf(key)` / `setDoor(key, { scene, tile, tag, open })` | a place's doorway: the scene it leads into, the tile (id) or Tagger tag to land on, and whether players may walk in |
| `go(key, actorId?)` | walk through a place's doorway as a character you own: with a GM online the token lands on the tile, the player is pulled into the scene and a Monk's Active Tiles tile is triggered (`tile.trigger({ tokens, userId, method: "trigger" })`); without one, the scene is viewed |
| `setCrew(point, label)` | (GM) the crew marker (`null` clears it) |
| `setPin(actor, point)` | pin a character you own (`null` unpins); kept on the actor as `flags["cpr-neon-combat-manager"].hubPin`, so players can do it with no GM online |
| `travel(from, to, mode, { storm })` | (GM) the crew travels: time passes, the marker moves, a card posts. `mode`: walk, skates, bike, ncart, moto, car, av. Resolves to `{ minutes, jam, trip }` |
| `noSignal(actor)` / `whereIs(actor)` | no signal where the character is pinned / the district's name |

Points are in the city map's world grid (1294 × 2000). The 2070 data (districts with their
NCZTA-70 entries, places, stations, lines) is `scripts/hub/data.js`; the pure rules (district at
a point, travel times, NCART routes, dead zones) are in `scripts/hub/geo.js`.

Hooks: `cpr-neon-combat-manager.hubChanged` (the shared state), `cpr-neon-combat-manager.hubTravel`
`({ from, to, mode, minutes, jam })`, `cpr-neon-combat-manager.hubDoorway` `({ key, actor, scene, tile, token, userId })`
(GM side, after someone walks through a doorway).

## Neon Chat: `ncm.chat`

| | |
| --- | --- |
| `format(text)` | Discord-style formatting, as HTML |
| `register(data, override?)` / `unregister(name)` | a chat command, in Chat Commander's shape: `{ name, module, aliases, description, icon, requiredRole, callback(chat, parameters, messageData), autocompleteCallback(menu, alias, parameters), closeOnComplete }`. With Chat Commander running, it goes there |
| `commands()` | every registered command (Foundry's own are listed with `core: true`) |
| `log(text, { gm? })` / `quote(source, text, { gm? })` | an Adventure Log entry |
| `narrate(text)` | GM: narration, in chat and across the stage |
| `stage.cast` | `[{ id, name, img, side, mood, flip }]` |
| `stage.add(actors)` / `remove(actorId)` / `mood(mood, actorId?)` / `speakAs(actorId)` / `clear()` | change the stage (players: their own characters) |
| `stage.editMoods(actor)` | the expression pictures, kept in `flags["cpr-neon-combat-manager"].moods` |

Without Chat Commander, `game.chatCommands` is this module's registry, with Chat Commander's
`register`, `unregister`, `createCommandElement`, `createInfoElement`, `createSeparatorElement`
and `createLoadingElement`. The `chatCommandsReady` and `invokeChatCommand` hooks fire as they do
there.

Typed messages carry `flags["cpr-neon-combat-manager"].chat` and `.raw` (what was typed, for
editing). Narration carries `.narration`. The stage's cast is the world setting `stageCast`.

## Action HUD: `ncm.hud`

| | |
| --- | --- |
| `render()` | redraw the HUD for the controlled token |
| `layoutFor(actor)` | the layout this user sees for a character: the character's own, else the user's, else the template |
| `saveLayout(layout, actor?)` | keep a layout on the user: for all their characters, or one |
| `clearLayout(actor)` | drop a character's own layout |
| `customize(actor?)` | open the Customize window |
| `resetPosition()` | put the HUD back above the hotbar |

A layout is `{ v: 1, groups: [{ id, source, name, icon, picks, hidden }] }`:
- `source` is one of `turn`, `weapons`, `skills`, `role`, `net`, `status`, `utility`, `stats`
  or `gear`, or `null` for a user's own group.
- `picks` are action keys in order, or `null` for everything the source has. The keys are
  `turn:initiative`, `weapon:<name>`, `skill:<name>`, `role:<ability>`, `net:<ability>`,
  `cond:<condition id>`, `util:stakes|phone|biomon|map|sheet`, `stat:<ref>` and `drug:<name>`.
  Names are lower-case letters and digits only.

Layouts live in the user's flags: `flags["cpr-neon-combat-manager"].hud.layout` and
`.hud.actors[actorId]`. The pure rules are in `scripts/hud/layout.js`.

## Holocalls: `ncm.holocall`

Calls are Night City Messenger's (2.1+); these are the module's ways in.

| | |
| --- | --- |
| `available` | Night City Messenger is up with Calls on |
| `call(actor, { as? })` | holocall a character: their number, as `as` (an actor you own), else your selected token (if yours) or your character; the GM with neither calls as the messenger's operator. Resolves to `{ callId, emergency }`, or `null` after a warning (no messenger, no number, a Comms Jam, no signal on the map, or the messenger's own refusal) |
| `open(actor?)` | open a character's phone (their Agent, at its Calls tab); with no actor, the messenger's phone button |
| `numberOf(actor)` | resolves to the number they answer on (an NPC: its directory contact's, for the GM), or `""` |
| `blocked(actor)` | why they can't call out, in words (Comms Jam, dead ground on the map), or `""` |

1.6's `place`, `say`, `hangUp`, `end`, `saveLog`, `dial` and `calls`, the `/holo` chat command and
the `callsChanged` hook are gone with the module's own calls.

## Neon FX: `ncm.fx`

Needs Sequencer. Tokens default to the selected ones; only tokens you own are switched.

| | |
| --- | --- |
| `sandevistan(tokens?, on?)` | flip the Sandevistan (the afterimage trail as the token moves); `on: true/false` forces it |
| `activate(kind, tokens?, on?)` | run a `"sandevistan"` or `"berserk"` as the rules do: the Chrome running condition (the installed Operating System's), through the chrome's "(active)" effect when it has one; the condition holds the look on and moves Initiative in a fight |
| `berserk(tokens?, on?)`, `kerenzikov(tokens?, on?)` | flip Berserk's red look, or speedware's blue edge (looks only) |
| `psycho(tokens?, on?)` | flip the Cyberpsychosis glitch (a look only; the condition is `extremeCyberpsychosis`) |
| `clear(tokens?)` | switch both off |
| `refresh()` | redraw every token on the scene |
| `landingZone({ at?, size?, token? })` | put an AV landing zone down: centre `at: { x, y }` (else picked on the map), `size: { w, h }` in grid squares (else fitted to `token` or the selected one). Resolves to `{ id, w, h, x, y }`, or `null` when the pick is cancelled |
| `land(tokens?, { zone?, keepZone? })` | land an AV (the first of `tokens` you own, else the selected one) on the zone with id `zone`, else the nearest, else a spot picked on the map; `keepZone: true` leaves the zone lit. A hidden token flies in from off the map and is revealed (GM). Resolves to the landing, or `null` |
| `landingZones(sceneId?)` | the AV landing zones on a scene (default: the one being viewed): `[{ id, w, h, x, y }]` |
| `clearLandingZones(id?)` | take one zone away, or every zone on the viewed scene |
| `installMacros()` | GM: add the Neon FX macros to the "Neon FX" macro folder (skips ones already there) |
| `report()` | which JB2A files (or Neon FX fallbacks) the looks use here |

The switches are the token flags `flags.cpr-neon-combat-manager.fx.sandevistan`, `.berserk`,
`.kerenzikov` and `.psycho` (`true`, or the running Operating System's key: `"falcon"`). A
condition with `chrome: { kind, os? }` holds its kind's switch on while it lasts.
Persistent looks are Sequencer effects named `ncm-fx-<condition or switch>-<tokenId>`.

An AV landing zone is a set of persistent Sequencer effects named `ncm-fx-avzone-<id>-<w>x<h>` (the
pad itself ends in `-pad`). A landing is one token update with `animate: false` and the flag
`flags.cpr-neon-combat-manager.fx.landing` (`{ id, fx, fy, airborne, zone, w, h, keep }`: where it
flew in from); every client draws the flight from that.

## Quickhacking: `ncm.hack`

The steps the Action HUD runs (2070 Core Rules ch.10), for macros. Each resolves to what the roll
decided, or `null` when it didn't happen (no target, a closed dialog, a Cooldown).

| | |
| --- | --- |
| `jackIn(actor, { ghost?, target?, token? })` | Jack In to the token the user targets (or `target`): `{ won, aware, ghosted, walls }` |
| `breach(actor, targetTokenId?)` | Breach a Passwall: `{ down, broken }` (`broken`: the Ghost) |
| `quickhack(actor, itemId, targetTokenId?)` | run a slotted quickhack: `{ hit, aware, broken, damage, condition }` |
| `jackOut(actor, targetTokenId?)` | Jack Out of one Neuroport, or all |
| `eject(target, runnerTokenId?)` | the target tries to kick a Netrunner out: `{ ejected }` |
| `state(actor)` | `{ links, cooldowns, lockouts }` |
| `reset(actor)` | forget a character's Cooldowns and lockouts |
| `fx(beat, ctx)` | play a beat by hand: `jackIn`, `jackOut`, `eject`, `breach`, `upload`, `detect`, with `{ runner, target }` token ids and the beat's own fields (`aware`, `down`, `hit`, `family`, `key`, `ghosted`) |
| `report()` | which JB2A files the looks use here |

State is the actor flag `flags.cpr-neon-combat-manager.hack`: `links` by target token id
(`{ scene, name, ghost, aware, walls, total, at }`), `cooldowns` by item id, `lockouts` by token id
(world time). A quickhack is a `program` item with `flags.cpr-neon-at-home.quickhack`
(`{ type, dv, cooldown, quiet, needs }`). The drawn link is a Sequencer effect named
`ncm-hack-<runner token>-<target token>` (`-g` while Ghosted).

## Neon Arsenal: `ncm.arsenal`

| | |
| --- | --- |
| `install()` / `uninstall()` | GM: put Neon Arsenal's entries into Automated Animations' Global Automatic Recognition menu (replacing older ones of ours, keeping the world's), or take them out |
| `exportProfile()` | download the profile as an AA menu export (sounds included), for a world without this module |
| `explain(item)` | what Neon Arsenal reads off a weapon: `{ kind, flavor, ammoVariety, ammoType, ranged, explosive, area, traits, keys, entry, dvTable }` |
| `traits(item)` | the weapon's traits (flavor and Rebuilds), merged |
| `registerRebuild(def)` / `rebuilds()` | add a Rebuild that is an item (below), list them |
| `ricochet(actor, item)` / `charge(actor, item)` | flip a Power gun's ricochet or a Tech gun's charge |
| `menu(actor?)` | the Weapon Rebuilds window |
| `dv(item, metres, { autofire })` | the DV the weapon faces at a distance, by the 2070 range tables |
| `applyArea(templateUuid)` | GM: the apply window for an area Neon Arsenal placed |

### Registering a Rebuild

In the `cpr-neon-combat-manager.registerRebuilds` hook (called at setup with `ncm.arsenal`), or
with `registerRebuild` during init or setup:

```js
Hooks.on("cpr-neon-combat-manager.registerRebuilds", (arsenal) => {
  arsenal.registerRebuild({
    id: "monoEdgeBlading",
    label: "Mono-edge Blading",
    match: "^Mono-edge Blading\\b",          // a RegExp or its source, against the upgrade's name
    tiers: {                                 // optional; the tier named in the item's name wins,
      Basic: { ignoreBelowSP: 7, tag: "Monoblade" },   // else flags.cpr-neon-at-home.rebuildTier,
      Upgraded: { ignoreBelowSP: 11, tag: "Monoblade" } // else the first
    }
  });
});
```

Traits: `attackMod` (+N to ranged attacks), `needsLink` (only with a Neuroport, Personal Link or
Subdermal Grip), `critBonus` (added to a Critical Injury's Bonus Damage), `ignoreBelowSP`,
`push: { metres, maxBody? }` (a target hit is pushed away from the attacker), `ricochetBonus`,
`active: ["ricochet" | "charge"]` (a switch on the HUD), `tag` (the AA look: `Monoblade`,
`Propulsion`). The switches live on the actor: `flags.cpr-neon-combat-manager.arsenal.<itemId>`
(`ricochet`, `chargedUntil` in world time, `fired`).

### On the cards and templates

A roll card Neon Arsenal saw carries `flags.cpr-neon-combat-manager.arsenal`: `{ kind ("attack"
| "damage"), actorId, itemId, tokenId, mode, weapon, flavor, ammoType, ammoVariety, explosive,
area, targets, ricochet, charged, dv, total }`. An area's template carries
`flags.cpr-neon-combat-manager.blast`: `{ actorId, itemId, tokenId, userId, kind, area, ammoType,
ammoName, explosive, state ("placed" | "hit" | "miss" | "landed" | "resolved"), dv, total }`.
Automated Animations entries are labelled `Neon Arsenal · <Kind>[ · <Flavor>][ · <Ammo or tag>]`.
