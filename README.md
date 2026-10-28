# Neon Combat Manager

An encounter overhaul for **Cyberpunk RED - CORE** on Foundry VTT, part of the Neon suite
(Neon Hub, Neon At Home, Neon Market). It turns Foundry's combat tracker into a Night City
encounter screen and makes the fight's conditions, clock, weather and lighting count in
Cyberpunk RED's own rolls.

- **Combat carousel**: the Initiative Queue as neon cards across the top of the screen.
- **Biomon Link**: players link their characters' Biomonitors as a group; a small popout shows
  everyone's vitals (ECG, HP, status, Death Save penalty, injuries) and raises the alarm when
  someone crashes.
- **Holocalls**: ring the crew, a Biomon Link or an NPC anywhere in Night City and talk in
  holo blue, with Night City Messenger contacts, dead zones, missed calls, ringtones, and call
  logs kept as conversations in the messenger.
- **Night City Map**: the 2070 city full screen, with the NCZTA-70 threat zones, 85 Notable
  Places, the NCART network, the crew and the characters where they are, and a route planner
  with the 2070 travel times.
- **The Plot Die**: the GM Raises the Stakes on a Check; the player rolls the d6 and the card
  hands out the bonus, the Opportunity or the Complication (2070 Core Rules).
- **Combat Awareness**: Solos split their Rank across the six abilities in a small window,
  free before Initiative and as their Action once the fight is on.
- **Neon Conditions**: the full Cyberpunk RED condition set, wired into the system's roll
  modifiers, with a Condition Lab, a Triggler and a drop-in stand-in for Condition Lab &
  Triggler (which stopped at Foundry v12).
- **Combat time**: each Round moves world time 3 seconds, so SmallTime, Neon Hub's calendar and
  every timed effect keep pace with the fight.
- **Night City weather**: the day's weather from Neon Hub's calendar becomes conditions on the
  characters out in it, adjusted for their gear.
- **Visibility**: darkness, light sources (token lights, DF Active Lights) and weather set Low
  Light or Darkness penalties; Low Light/Infrared/UV cybereyes cut through.

Built for Foundry v12 (what Cyberpunk RED 0.92 runs on), with a compatibility layer ready for
v13 (see [docs/V13.md](docs/V13.md)).

## Install

In Foundry's **Add-on Modules → Install Module**, paste this manifest URL:

```
https://github.com/choccoops/neoncombatmanager/releases/latest/download/module.json
```

Requires the Cyberpunk RED - CORE system (0.92+). Works best with
[Neon Hub](https://github.com/choccoops/neonredlanding) (weather and clock),
Night City Messenger (contacts to holocall),
[SmallTime](https://github.com/unsoluble/smalltime) (darkness that follows the clock) and
DF Active Lights. Nothing else is required.

## The combat carousel

While a combat is on, the Initiative Queue runs across the top of the screen:

- One card per combatant: portrait, Initiative (or a roll button), HP bar, Wound State badge,
  condition icons and a pulsing Death Save marker for the Mortally Wounded. Defeated
  combatants read **FLATLINED**.
- The header shows the Round, **T+** time since the fight began, the time of day (Neon Hub's
  clock when it's installed) and the weather chip (GM: click it for the Environment window).
- GM controls: start, previous/next Turn and Round, roll NPC Initiative, the Condition Lab, the
  sidebar tracker and end. Hover a card for hide, defeat, re-roll and remove.
- Players get **End Turn** on their own Turn.
- Click a card to select and pan to the token; double-click to open the sheet; GM right-click
  to target. Hovering a card highlights its token.
- **What players see of NPCs** is a setting: nothing, the Wound State only (default), or the HP
  bar. Hidden combatants and hidden tokens never show to players; names follow the token's
  name display setting.

Foundry's own sidebar tracker gets each combatant's Wound State and the combat clock too.

## Biomon Link

Cyberpunk RED's Biomonitor is an implant "showing vitals readouts" that "can be linked to your
Agent". A Biomon Link is that, for a group: players choose to link their own characters (it's
their vitals), and everyone on the link sees everyone's readout.

- Open it from the **heart-pulse button** in the token controls (or a keybinding you set in
  Configure Controls). A player whose character isn't linked yet picks a link to join or starts
  one ("Crew"); a character is on one link at a time, and **Unlink** takes them off.
- **A character needs a Biomonitor or a Neuroport installed to link**: Cyberpunk RED's
  Biomonitor cyberware, or the *Edgerunners Mission Kit* Neuroport (either version, "Neuroport"
  or "Neuroport (Free)"), whose built-in Biomonitor does the broadcasting. Characters without one
  show in the link-up list but can't be picked. If a linked character's implant comes out, their
  readout shows **NO SIGNAL** until it's back. The GM can switch the rule off or change which
  implants count (settings).
- Each readout: portrait, an animated **ECG trace** whose pace follows the character's state,
  BPM, HP, the status (STABLE, MINOR / SERIOUS TRAUMA, CRITICAL with the Death Save penalty,
  UNRESPONSIVE, FLATLINE), a chip naming the implant broadcasting it, and their Critical
  Injuries and hazards as icons. Click a readout to look at the token; with Neon At Home, the
  wave button opens that character's full Biomonitor.
- **Alarms**: when someone on your link goes critical, drops unconscious or flatlines, you get a
  notice (or the Biomon pops open, or nothing: a per-user setting).
- The phone button on a link holocalls everyone else on it.
- The GM sees every link and can rename or break one.

## Holocalls

Talk to the crew, or to someone who isn't in the scene, the way calls look in *Edgerunners* and
2077: blue holo portraits, and the conversation in blue.

- Open the dialer from the **phone button** in the token controls (or a keybinding). Pick who
  you're calling as, then who to ring: the crew (with who's online), a whole Biomon Link, your
  character's **Night City Messenger contacts** (with trust pips; burned contacts can't be
  reached), and for the GM every NPC and the messenger's directory, as anyone.
- The people called get an **incoming holocall** with Accept and Decline. Players answer for
  their own characters; the GM answers for NPCs, messenger contacts, and characters whose
  players are away (so you can call an NPC anywhere in Night City and the GM picks up as them).
- On the call: holo tiles for everyone (ringing, on the line, declined, no answer...), a call
  timer, the conversation, and a line to talk on (Enter sends; the GM picks which NPC is
  speaking). **Add** rings more people into the call; **Hang up** leaves it; the GM can end it.
- Messages are chat messages **whispered to the people on the call** (and the GM), shown in holo
  blue in the call window and in the chat log. Closing or minimizing the call window doesn't
  hang up.
- **Talking from the regular chat box**: `/holo On my way` says it on your call (the latest, if
  you're on several), as whoever you last spoke as there (the GM: the NPC). `/holo` alone, or the
  **Talk from chat** button in the call window, switches your regular chat to the call: plain
  messages go to it, while other commands and rolls work as usual. A blue banner over the chat box
  shows it's on; click it (or `/holo` again) to go back. It switches off when the call ends.
- **Night City Messenger**: its dead-zone scenes have no signal (you can't call out, and calls
  there go unanswered); a call that rings out leaves a **missed holocall** in the character's
  messenger inbox (setting).
- **Call logs in Night City Messenger**: when a call ends, **Save to Messenger** keeps the
  conversation in the inbox of every player character who was on it, as mail from the person
  they spoke with. Every call between the same two lands in one thread, so the messenger shows
  their whole holocall history as one conversation. The GM can make it automatic, or switch it
  off.
- **Call from an actor**: the Actors directory's right-click menu and the sheet header have a
  **Holocall** entry. The GM calls *as* an NPC; anyone calls a character.
- **Ringtone and busy**: incoming calls ring (a synth chirp, or your own audio file in the
  settings), callers hear ringback, and calls blip when they connect and drop. Someone already
  on a call shows **Busy**.
- **Signal on the map**: a character pinned on the Night City Map where nothing works
  (Utility Code 9+: West Wind, the Occupied Zone, Laguna Bend, plus any district the GM adds)
  can't call out, and calls to them don't get through.
- Settings: ring time; whether characters need something to call with: an Agent (carried), an
  Internal Agent, or a Neuroport (its Holophone).

## Night City Map

The City & NCART hub: Night City in 2070, full screen. Open it with **Shift+M**, the map button
in the token controls or on the carousel, or `/map` (`/ncart` opens the metro). Drag to move,
scroll to zoom, Esc to close.

- **Three views**: the **City** map, the **Threat Zones** map (each district tinted by its
  NCZTA-70 rating), and the **NCART** poster.
- **Notable Places**: all 85, numbered and colored by category (filter them by category). Click
  one for its write-up from the Night City 2070 sourcebook, its Security Code, its district and
  rating, and the nearest NCART stations with the walk.
- **Districts**: click anywhere for the district's NCZTA-70 dossier: Threat Rating (and the
  secondary one), Zone Type, Security Code and provider, Utility Code, what it was in 2045, its
  NCART stops, whose turf it is, and its places. The Badlands and Laguna Bend too.
- **NCART**: the network over the city (closed, planned and suspended track dashed), and the
  poster view with every station clickable: its lines, its district, what's near it.
- **Routes**: pick a start and a destination (places, stations, characters, the crew, or any
  spot) for the distance and the trip **on foot, skates, bike, NCART, motorcycle, car and AV**,
  from the 2070 Travel Times (Core Ch.11): rush hour from the world clock (Arroyo's shift
  changes too), a storm toggle, the NCART ride with its changes and the walk at each end, and a
  warning for the Combat, Extraterritorial or Occupied ground on the way.
- **Travel** (GM): the crew makes the trip. The clock moves by the trip's time, a car rolls for a
  jam (gridlock in rush hour), the crew marker moves, and a card tells the table.
- **Where everyone is**: the GM sets **We are here** for the crew, and players pin their own
  characters (**I'm here**). Click a character to holocall them (unless they're out of signal).
- **Discovery**: the players start with an empty map and find Night City as the campaign goes.
  The GM sees every place (the undiscovered ones faded) and **Reveals** them one at a time, or a
  whole district at once. A reveal posts a "Location discovered" card (or **Reveal quietly**).
  **Hide** takes a place back off the players' map. Turn the setting off and players see every
  place except the ones you hide.
- **Your own places**: click the map where it is, then **Add a place here**: a name, a category
  (the map's seven, or Campaign), a Security Code and who guards it, a description the players
  read, and a picture. Your places start hidden unless you tick "Players see it right away".
  **Edit**, **Move** (then click the new spot) and **Delete** them.
- **The map's own places**: edit their name, category, description or picture, and move them.
  **Back to the map's** undoes your changes. They can be hidden, not deleted.
- **For the GM**: notes on any place (only you see them), a battle-map scene linked to a place
  (view it, or move everyone there), and **Show the players** to open the map on their screens
  at what you're looking at (showing a hidden place reveals it).
- Settings: whether players can open the map, whether places are discovered, whether map
  positions decide holocall signal, and extra dead zones.

The maps, places and district data are the Night City 2070 maps and the NCZTA-70 threat zones
made for this campaign (`tools/nc2070-data.py` rebuilds the data from their source). The hub's
approach (a full-screen map with places, districts, routes and a crew marker) and the holocall
ringtone, ringback, busy signal and actor-menu calls were inspired by Verlierboy's
[Night City · Interactive Map](https://github.com/samroaleksej-bit/night-city-map).

## The Plot Die

Raising the Stakes from the 2070 Core Rules (Chapter 02, LUCK). **Carousel → die button**, the
token controls, `/stakes`, or a keybinding (unassigned) opens the Plot Die window.

- **The GM** picks whose Check it is (the combatant whose Turn it is, a controlled token, or any
  crew member), adds what's riding on it if they like, and clicks **Raise the Stakes**. A card
  goes to chat with **Roll the Plot Die** for that character's player (and **Force Fate** when
  they qualify). `/stakes <what's riding on it>` does the same for the current combatant.
- **The roll** (Dice So Nice shows it) posts the result:
  - **1 or 2: Complication.** +2 or +4 goes straight onto the character's next Check as a ticked
    situational modifier in Cyberpunk RED's roll dialog, and comes off once that Check's roll
    card is posted. The GM picks the Complication from the card: **Hinder an Ally** (pick who
    and the penalty; it rides their next Check), **Feeling Unlucky** (-1 LUCK; out of LUCK, pick
    Prone, a jam or a malfunction) or **Influence the Narrative** (type what goes wrong).
  - **3-4: nothing.**
  - **5-6: Opportunity.** The player picks: **Aid an Ally** (+2 on an ally's next Check),
    **Feeling Lucky** (+2 LUCK, up to the STAT), **Critically Hit** (a Critical Injury of their
    choice on their target, from CPR's own compendium) or **Influence the Narrative**.
- **LUCK perks**: LUCK 5+ can **ask** the GM to Raise the Stakes (the GM gets a whispered card to
  approve or turn down). LUCK 7+ can **Double Down** (reroll; a Complication then costs 2 LUCK,
  or brings two Complications without it) and **Force Fate** (3 LUCK for an Opportunity), each
  once a session. **New session** in the window gives them back.
- **Crits**: the GM's **Crit: Opportunity** and **Crit: Complication** buttons hand out a twist
  for an exploding 10 or an imploding 1, without the Plot Die.

## Combat Awareness

A Solo's Role Ability, from the Solo's carousel card (the crosshair; yellow, or pink once this
Round's Action is spent on it), the token controls, `/awareness` (or `/ca`), or a keybinding.

- The window shows the Rank as points, one stepper per ability (Precision Attack steps by 3,
  Damage Deflection by 2, Fumble Recovery takes 4), what each split does right now, and points
  that buy nothing.
- **Assign** writes the split onto the Solo's Cyberpunk RED role item, so the system applies
  Initiative, attack, damage, deflection and Perception itself, and posts a card.
- When it costs: free outside combat and before Initiative. Once the combat has started and the
  Solo has an Initiative, it's **their Action, on their Turn** (the card says so and their
  carousel card marks the Action spent for the Round); off their Turn a player has to wait. The
  GM can adjust it any time without spending the Action.

## Neon Conditions

The token HUD gets the Cyberpunk RED set in place of Foundry's generic one (statuses other
modules add, like Neon At Home's encumbrance, stay). Every condition is written in Cyberpunk
RED's roll keys, so the system's own roll code applies it: penalties show in the roll dialog
with their source, situational ones as toggles.

| Group | Conditions |
| --- | --- |
| Wound States (p.186) | Lightly / Seriously / Mortally Wounded (shown automatically; CPR applies their penalties itself), Dead, Unconscious, Stabilized |
| Critical Injuries (p.187-188) | All 22. Placing one gives the actor **CPR's own Critical Injury item** from the system compendium (its effect carries the penalty and the Death Save increase); a Critical Injury rolled or dropped onto a sheet shows on the token. **2070**: Broken Leg also costs -2 Evasion, per leg (both: -4) |
| Combat (p.168-185, p.345-347) | Prone (**2070**: -4 Evasion vs melee and Grapples, as roll-dialog toggles), Grappled, Grappling, Iron Grip, Choked, Human Shield, In Cover, Hidden, **Into the Wall** (2070: Spinal Injury for one Round), Holding Action, Suppressed, Netrunning, Blinded, Deafened, Flashbanged, Teargassed, Knocked Out (Sleep), EMP'd |
| Hazards (p.180-181) | On Fire (Mild/Strong/Deadly), Drowning, Asphyxiating, Electrocuted, Radiation (Low/High), Falling, Exposure, Acid |
| Situational (p.129) | Exhausted, Fatigued / Slept Badly, Extreme Stress, Drunk or Sedated, In Smoke; the Plot Die's one-Check Bonus, Aided and Hindered |
| Quickhacks (2070 ch.10) | Comms Jam (no holocalls), Vitals Spoof (the Biomon Link shows calm vitals; the GM sees SPOOFED), PopUp-geddon, Impair Movement, Slow (MOVE -1d6, rolled), Short Circuit, Cyberware Malfunction, Reboot Optics, Cripple Movement, Weapon Glitch, Limb Seize, Speedware Crash, Sonic Shock (Damaged Ear), Frame Lock, Q-KRASH, System Reset (Unconscious and Prone), Puppet, Cyberpsychosis. Each runs its 3 or 20 Rounds. Overheat is On Fire (Strong) |
| Drugs (p.150, p.227-229) | Antibiotics, Rapidetox, Speedheal, Stim, Surge, Black Lace, Blue Glass, Boost, Smash, Synthcoke and their addictions |
| Weather (Night City Weather) | Light/Heavy Rain, Acid Rain, Blood Rain, Ash Storm, Dust Storm, Inversion Smog, Deadly Thunderstorm, Radioactive Windstorm, Cold Snap, Heat Wave, Hot, Cold, Flooding, Blackout |
| Visibility (p.129) | Low Light (-1), Darkness (-4), Obscured |

What they do on their own:

- **Timed conditions** end on world time (a flashbang's minute is 20 Rounds; Stim's hour; Black
  Lace's day), whether time passes by Rounds, SmallTime or a Neon Hub skip.
- **Turn automation** (run by the GM's client): a Death Save card at the start of a Mortally
  Wounded character's Turn (a failure flatlines them); fire, high radiation and electrocution at
  the end of the Turn; drowning at the start; Broken Ribs and Foreign Objects reopening when the
  character moved more than 4 m/yds on foot that Turn (the module measures the token's moves);
  Damaged/Lost Ear and flashbangs costing the next Move Action; Spinal Injury's lost Action.
  Damage comes as a card with an **Apply** button, or applies itself (setting).
- **Groups**: one fire, one Wound State, one visibility level at a time.
- **Drugs**: Speedheal heals BODY + WILL; Rapidetox purges drugs (not addictions); when a street
  drug wears off a card asks for the Resist Torture/Drugs Check against its Secondary Effect DV
  and adds the addiction on a failure; Black Lace and Synthcoke switch their addiction's REF
  penalty off while their Primary Effect runs.
- **Stabilized** on a Mortally Wounded character: 1 HP, Unconscious for a minute, Death Save
  penalty back to base.
- **Immunity**: Anti-Dazzle stops flashbangs.
- **Dead** marks the combatant defeated (and Foundry's "defeated" toggle sets Dead).

Every effect created on an actor with changes but without Cyberpunk RED's bookkeeping flags
(from any module or macro) gets them, so the character sheet keeps opening.

### The Condition Lab

**Carousel → flask button**, or `game.modules.get("cpr-neon-combat-manager").api.conditions.openLab()`.
Every condition with what it does in roll terms, by category, with search. The GM can edit any
condition (name, icon, text, modifiers, duration, exclusive group, damage at Turn start/end),
switch it off, reset it to the original, make custom ones, and export/import the lot as JSON.
Click a condition's icon to toggle it on the selected tokens.

### The Triggler

Rules of the form *when an actor's `data path` `≤ / = / ≥ …` `value`, add (or remove)
`condition`*, optionally undone when the test stops passing. Paths are Cyberpunk RED's, like
`system.derivedStats.hp.value` or `system.stats.luck.value`, and can be limited to actor types.

### Coming from Condition Lab & Triggler

Condition Lab & Triggler (CLT) stopped development at Foundry v12. Neon Conditions replaces it:

1. With CLT still installed (or after turning it off: its saved map stays in the world), open
   the Condition Lab and click **Import from Condition Lab & Triggler**. Its Cyberpunk RED map
   is matched to Neon Conditions (spelling slips like "Unconcious" included); anything else
   becomes a custom condition; the effects CLT placed on actors are moved over.
2. Turn CLT off. While it's off, Neon Combat Manager provides `game.clt` with CLT's calls
   (`addCondition`, `removeCondition`, `hasCondition`, `getCondition(s)`, `toggleCondition`,
   `removeAllConditions`), so macros and modules written for CLT keep working.
   `game.clt.neon` tells it's the stand-in.

New code should use Neon Conditions' API directly: see [docs/API.md](docs/API.md).

## Combat time

A Cyberpunk RED Round is about 3 seconds (p.126, p.168): one minute is 20 Rounds. The module
sets Foundry's combat clock to that (it's 6 by default), so each new Round moves world time 3
seconds, and going back a Round takes it back. Everything that follows world time follows the
fight:

- **SmallTime**'s clock and its scene darkness;
- **Neon Hub**'s calendars (a fight past midnight moves the date, rent day included);
- timed conditions here, and Neon At Home's EMP and malfunction timers.

The GM's client checks the clock really moved after each Round and moves it if not. When the
combat ends, a card says how many Rounds it ran, how long that was and the time of day.
Seconds per Round (and per skipped Turn) are settings.

## Weather

Weather comes from **Neon Hub's calendar** (the calendar that follows the clock, or one the GM
picks in the Environment window), or from the GM's **manual** pick. Neon Hub rolls it on R.
Talsorian's free *Night City Weather* tables; this module applies its rules to the characters
out in it:

- **Sight**: Heavy Rain and storms -2, Blood Rain -1, Inversion Smog -4, to Perception by sight
  and ranged attacks (joined with darkness into one visibility condition, see below).
- **Footing**: light and heavy rain -1, black ice -2 on Athletics, Drive Land Vehicle and similar,
  as unticked situational modifiers the player ticks when the GM calls for it.
- **Heat**: in Hot weather and Heat Waves, armor penalties to REF, DEX and MOVE get 1 or 2 worse
  (a Hot-Weather Jacket Lining takes 1 off).
- **Radioactive wind**: High Radiation (2 a Turn) for anyone without a Radiation Suit.
- **Timed hazards** (GM cards with buttons, during combat): acid rain ablating armor each full
  minute, blood rain's 1d6, a minute in ash or smog (Resist Torture/Drugs or poison), five
  minutes in dust (Foreign Object), lightning every ten minutes.
- Strange weather that lasts minutes (a dust storm from 14:05 for 30 minutes) starts and stops
  with the clock, including mid-fight.

Weather reaches **outdoor** scenes. Each scene has a weather setting in its configuration
(Default / Outdoors / Indoors / Off); **regions** named with a shelter keyword ("Interior",
"Bar - inside", "Roof"...) keep the tokens in them out of it. Protective gear is matched by
name (settings): Nasal Filters, Anti-Smog Breathing Mask, Radiation Suit, umbrellas and the
jacket linings from the Night City Weather pack the system ships.

## Visibility

For each character in the encounter, the module looks at the light where they are, or where
their target is while they have one (setting):

- **Scene darkness** (which SmallTime moves with the clock): low light from 0.3, dark from 0.7
  (settings). Global illumination lights the scene up to its threshold (night in a lit city is
  still low light).
- **Light sources**: ambient lights, DF Active Lights and token lights (a character with a light
  on, a flashlight, a lit token next to them). Bright light means no penalty; dim light is low
  light. Walls block light as Foundry draws it. Darkness sources make a spot dark.
- **Weather** obscurement adds on, up to a cap (4 by default: dark and foggy are both just
  "obscured").

The result is one condition per character: **Low Light** (-1, night or poor lighting, p.129),
**Darkness** (-4, a task obscured by darkness, p.129) or **Obscured** (weather, smoke). Its
penalty applies to the checks that need sight (Perception by sight, ranged and melee attacks
by default; a setting), as situational modifiers shown ticked in the roll dialog, so a player
with an Infrared Nightvision Scope can untick it for that shot. **Low Light/Infrared/UV
cybereyes** cancel it entirely (p.360). Conditions the GM places by hand win over the
automatic ones.

## For other modules

Everything is in `game.modules.get("cpr-neon-combat-manager").api` (and the conditions also at
`game.neonConditions`): conditions, combat time, weather and visibility, with hooks for each.
See [docs/API.md](docs/API.md).

## Development

```bash
npm ci
npm test          # rules, conditions engine, CLT import, Turn automation, templates
npm run check     # scripts parse, JSON and localization complete, icons exist, v13 guard
npm run preview   # renders the carousel, Biomon, holocalls, Lab and cards to preview/index.html,
                  # and the live Night City Map to preview/hub.html (serve the repo, open /preview/hub.html)
```

Nothing here reproduces the Cyberpunk RED rulebooks' text: names and summaries are this
module's own wording, with page references. Releases: [PUBLISHING.md](PUBLISHING.md).

## License

MIT. The Tektur font is under the SIL Open Font License (fonts/Tektur-OFL.txt). Cyberpunk RED
is a trademark of R. Talsorian Games; this is unofficial fan content.
