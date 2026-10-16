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
  holo blue, with Night City Messenger contacts, dead zones and missed calls.
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
  blue in the call window and in the chat log.
- **Night City Messenger**: its dead-zone scenes have no signal (you can't call out, and calls
  there go unanswered); a call that rings out leaves a **missed holocall** in the character's
  messenger inbox (setting).
- Settings: ring time; whether characters need something to call with: an Agent (carried), an
  Internal Agent, or a Neuroport (its Holophone).

## Neon Conditions

The token HUD gets the Cyberpunk RED set in place of Foundry's generic one (statuses other
modules add, like Neon At Home's encumbrance, stay). Every condition is written in Cyberpunk
RED's roll keys, so the system's own roll code applies it: penalties show in the roll dialog
with their source, situational ones as toggles.

| Group | Conditions |
| --- | --- |
| Wound States (p.186) | Lightly / Seriously / Mortally Wounded (shown automatically; CPR applies their penalties itself), Dead, Unconscious, Stabilized |
| Critical Injuries (p.187-188) | All 22. Placing one gives the actor **CPR's own Critical Injury item** from the system compendium (its effect carries the penalty and the Death Save increase); a Critical Injury rolled or dropped onto a sheet shows on the token |
| Combat (p.168-185, p.345-347) | Prone, Grappled, Grappling, Iron Grip, Choked, Human Shield, In Cover, Hidden, Holding Action, Suppressed, Netrunning, Blinded, Deafened, Flashbanged, Teargassed, Knocked Out (Sleep), EMP'd |
| Hazards (p.180-181) | On Fire (Mild/Strong/Deadly), Drowning, Asphyxiating, Electrocuted, Radiation (Low/High), Falling, Exposure, Acid |
| Situational (p.129) | Exhausted, Slept Badly, Extreme Stress, Drunk or Sedated, In Smoke |
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
npm run preview   # renders the carousel, Biomon, holocalls, Lab and cards to preview/index.html
```

Nothing here reproduces the Cyberpunk RED rulebooks' text: names and summaries are this
module's own wording, with page references. Releases: [PUBLISHING.md](PUBLISHING.md).

## License

MIT. The Tektur font is under the SIL Open Font License (fonts/Tektur-OFL.txt). Cyberpunk RED
is a trademark of R. Talsorian Games; this is unofficial fan content.
