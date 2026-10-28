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
    category: "situation",                 // wound | critical | combat | hazard | situation | drug | quickhack | weather | visibility | custom
    changes: [{ key: "system.stats.move.value", value: -2 }],
    duration: null,                        // seconds
    group: null,                           // only one condition of a group at a time
    turnEnd: { damage: "2" }               // optional Turn automation ("@body", "6d6"...)
  });
});
```

Changes use Cyberpunk RED's roll keys, all added (ADD mode):

| Key | Counts on |
| --- | --- |
| `bonuses.allActions` / `allActionsHands` / `allActionsSpeech` | every STAT and Skill Check (or those using a hand / speech) |
| `bonuses.<skill>` (`stealth`, `perceptionSight`, `perceptionHearing`, `resistTortureOrDrugs`...) | one Skill |
| `bonuses.ranged` / `melee` / `universalAttack` / `aimedShot` / `autofire` | attacks |
| `bonuses.initiative`, `bonuses.deathSavePenalty`, `bonuses.hasPainSuppression` | Initiative, Death Saves, Seriously Wounded |
| `system.stats.<stat>.value` | the STAT itself |

Add `situational: true` (and `onByDefault: false` to leave it unticked) to show a modifier as
a toggle in CPR's roll dialog. A value can be a dice formula (`"-1d6"`): it's rolled when the
condition lands and shown in its name. `consume: "check"` takes the condition off once the
bearer's next Cyberpunk RED roll card is posted. On a Critical Injury condition, `extra` lists
changes CPR's own item doesn't carry; the token marker keeps them while the item applies the rest. The module writes Cyberpunk RED's bookkeeping flags
(`flags["cyberpunk-red-core"].changes.cats` and `.situational`) for you; any ActiveEffect with
changes created without them gets them too.

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

## Weather and visibility: `ncm.environment`

| | |
| --- | --- |
| `weather()` | `{ keys, band, f, source, calendar }`: keys are Neon Hub's condition keys in effect now (`heavyRain`, `dustStorm`...), plus `hot` |
| `state` | the last refresh: `{ weather, rows }`, one row per character in the encounter (light level, sight penalty, gear, conditions) |
| `refresh()` | recompute now (GM) |
| `lightAt(token)` | `"bright"`, `"dim"` or `"dark"` at a token |
| `gear(actor)` | `{ breathing, radiation, rain, cold, heat, vision }` |
| `open()` | the Environment window |

Hook: `cpr-neon-combat-manager.environmentChanged` (state), on the GM's client.

### Night City Messenger

Holocalls read the messenger's stable `api` (apiVersion 1.x): `contacts.getContacts(actorId)`,
`masterContacts.getAll()`, `portraits.resolvePortrait(contact)` and `messenger.sendMessage` for
missed calls, plus the `deadZone` flag it sets on scenes. Nothing is required of it.

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
| `setPin(actor, point)` | pin a character you own (`null` unpins) |
| `travel(from, to, mode, { storm })` | (GM) the crew travels: time passes, the marker moves, a card posts. `mode`: walk, skates, bike, ncart, moto, car, av. Resolves to `{ minutes, jam, trip }` |
| `noSignal(actor)` / `whereIs(actor)` | no signal where the character is pinned / the district's name |

Points are in the city map's world grid (1294 × 2000). The 2070 data (districts with their
NCZTA-70 entries, places, stations, lines) is `scripts/hub/data.js`; the pure rules (district at
a point, travel times, NCART routes, dead zones) are in `scripts/hub/geo.js`.

Hooks: `cpr-neon-combat-manager.hubChanged` (the shared state), `cpr-neon-combat-manager.hubTravel`
`({ from, to, mode, minutes, jam })`, `cpr-neon-combat-manager.hubDoorway` `({ key, actor, scene, tile, token, userId })`
(GM side, after someone walks through a doorway).

## Holocalls: `ncm.holocall`

| | |
| --- | --- |
| `open()` | the dialer |
| `calls()` | live calls: `{ id, status, callerId, participants: [{ id, name, img, actorId, contactId, state }] }` |
| `place(from, targets)` | ring people. `from`: `{ actorId }` (a character you own; the GM can use any actor, or a Night City Messenger directory contact `{ contactId, source: "directory", name, img }`). `targets`: `{ actorId }` or contacts. Resolves to the call id |
| `say(callId, participantId, text)` | talk on a call as one of its participants |
| `hangUp(callId)` / `end(callId)` | leave a call / (GM) end it for everyone |
| `saveLog(callId, actorIds?)` | keep a call's log in Night City Messenger: each player character's inbox, from the person they spoke with, threaded `holocall-<idA>-<idB>`. Resolves to the actor ids it was kept for |
| `dial({ from, targets })` | open the dialer, calling as `from` (`"actor:<id>"`) with `targets` ticked |

In chat, `/holo <text>` says something on the user's latest call, and `/holo` alone toggles
routing plain chat to it (handled in the `chatMessage` hook, which returns false for them).

Hook: `cpr-neon-combat-manager.callsChanged` when any call changes. Holocall chat messages carry
`flags["cpr-neon-combat-manager"].holocall` (the call id).
