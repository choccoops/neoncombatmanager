# Changelog

## 1.12.0

- **"No signal" screen**: when a player's view lands in a Night City Messenger dead zone, a short
  animation plays (about three seconds). This happens on changing scene, or when the GM kills the
  signal where they are.
  - The screen flickers with static, the signal bars drop one by one, and "NO SIGNAL" glitches in
    with the scene's name.
  - It fades out alongside NCM's own dead-zone sound.
  - It plays once per entry: moving from one dead zone to another doesn't replay it, and the GM
    never sees it.
  - Each player can turn it off (the "No signal" screen client setting), and reduced motion gets a
    plain fade.
  - `game.modules.get("cpr-neon-combat-manager").api.holocall.noSignal()` plays it on demand.

## 1.11.0

**Night City Messenger in the 2070s.**

- **2070 spam**: Night City Messenger's built-in junk mail is set in 2045 (the red sky, the crater,
  the Reconstruction), and it has no setting to change that. This version replaces it with 40
  messages written for the 2070s, across NCM's seven categories:
  - Night City a free city after the Unification War, and Arasaka back in town
  - braindance, cyberpsychosis warnings and Trauma Team plans
  - fixers, ripperdocs and the black market

  `{{randomDistrict}}` and `{{randomCorpo}}` now pick from the 2070s districts and corporations.
  The new Comms setting "Night City Messenger spam" chooses 2070, Both, or NCM's own. Your own
  templates stay in every mode.
- **Dead ground mutes its scenes**: when a place on the city map stands on dead ground (Utility
  Code 9 or worse, or a district listed in "More dead zones"), the scene its doorway opens into
  becomes a Night City Messenger dead zone. No messages or calls go in or out while you're there.
  Dead zones you set in NCM yourself are never touched. A scene you switch back on by hand stays
  on until its place changes. The new City Map setting is "Dead ground mutes its scenes in Night
  City Messenger".

## 1.10.0

**Neon Chat: speak as, and the stage director.**

- **Speak as**: a menu over the chat box to choose who your messages come from. The options are
  yourself, any of your characters with a token in the scene you're viewing (or on stage), or the
  selected token as before. `/as me` and `/as <name>` do the same.
- **The bar over the chat box** is a single compact row now. It no longer stretches into the chat
  log.
- **Stage director** (GM): a window to run the stage from, with `/director`. It covers:
  - who's on stage and on which side, flipping them, and their expressions
  - speaking as them, and their expression pictures
  - narration, stage mode, and clearing the stage
  - dropping actors or tokens onto the window to bring them on stage
- **Players** on stage get one row of expressions under the menu, and a button to step off.
- **Stage mode**: while someone is on stage, the table dims and blurs, and all other interface
  (Foundry's and other modules') steps back. Only the chat and open windows stay. The GM switches
  it from the director, and clearing the stage turns it back on for next time.

## 1.9.0

**Neon Chat**: Foundry's chat, enhanced.

- **Discord-style formatting**: bold, italic, underline, strike, spoilers, code, quotes,
  headings, small text, lists and masked links.
- **Chat portraits** from the token or the actor, in the player's colour.
- **Messages**: consecutive ones from the same speaker merge, and you can edit what you sent
  (right-click, or Up in an empty chat box).
- **Roll privacy as buttons** on Foundry v12.
- **Adventure Log**: `/log`, `/log q`, `/gmlog`, and adding any message to it from its
  right-click menu.
- **Chat archive** to a journal: `/archive`.
- **Chat commands in one place**, with a completion menu. Chat Commander's
  `game.chatCommands.register` works without that module, and with it installed, this module's
  commands go there.
- **The stage**, visual novel scenes over the table:
  - characters on stage, and speaking as them
  - dialogue boxes typed out
  - nine expressions, with animations and a picture each
  - the narrator
  - `/stage`, `/as`, `/mood`, `/narrate`, `/unstage`, `/curtain`, and a stage bar over the chat
    box
- **Settings**: a new **Chat & stage** menu, plus client settings for portraits, the privacy
  buttons, the command menu and showing the stage.

## 1.8.0

- **Action HUD**: a bar of the controlled token's actions above the hotbar, with no Token
  Action HUD needed.
  - The template has the basics of a fight: Initiative, End Turn, Death Save, each equipped
    weapon's Attack, fire modes, Damage and Reload, combat skills, role abilities, Interface
    abilities for netrunners, combat conditions and this module's windows.
  - Everything rolls through Cyberpunk RED's own rolls, as the sheet does.
- **Customize Action HUD**: each player lays out their own HUD.
  - Rename, reorder, hide and show groups.
  - Pick the actions in a group, or leave it on Auto.
  - Add groups of your own.
  - Keep a layout for all your characters, or one for a single character.
- New client setting (Action HUD on or off) and keybinding (show or hide it).

## 1.7.0

Holocalls are now **Night City Messenger**'s (2.1 or later; 2.3 recommended). Its phone does
what this module's calls did, and more: numbers, voicemail, call logs, networks, payphones,
taps and traces.

- **Holocall buttons ring through the messenger**: the Actors directory menu, the sheet header,
  a phone button on each linkmate in the Biomon Link, and the Holocall button on the Night City
  Map's pins. The GM's *Holocall as* an NPC opens that NPC's phone.
- **Calling out still respects the table**: a Comms Jam or a pin on dead ground on the map
  (Utility Code 9+) stops a character calling. The messenger decides who can be reached.
- **Removed**: this module's own dialer, call window and incoming-call prompt, group calls,
  `/holo` and talking from chat, ringtones and busy signals, missed-call mail, call logs saved to
  the messenger, the "needs an Agent" rule, their settings, and the 1.6 `holocall` API
  (`place`, `say`, `saveLog`...). See docs/API.md for the new `holocall.call` / `open`.

## 1.6.0

The 2070 Core Rules, in the roller and on the table:

- **The 2070 roller**, hooked into Cyberpunk RED's own rolls:
  - a **Raise the Stakes** bar in the roll dialog, where the Plot Die's +2/+4 lands on that roll
  - **Riding the Edge** in place of +1 a LUCK point: Push the Limit in the dialog, Second Chance and Close Call under the roll card
  - **Chain Reactions** with their payout card
  - the GM's crit Opportunity and Complication buttons
  - **Tarot Criticals** from three 6s on damage, with a 22-card deck, one card a session, and one-click injuries
- **Flash of Luck** in the Plot Die window, with the GM's approval and the Beat and Mission limits.
- **Awareness Ladder** on the carousel for the GM: Unaware to Spotted, with the Stealth DV. It goes to Alert when the fight starts.
- **Conditions** to the 2070 book:
  - Mortally Wounded −6 MOVE
  - Already On Fire escalates
  - damage wakes the Unconscious
  - a flashbang is a Damaged Eye and a Damaged Ear for a minute
  - new Tarot conditions (Fated, Winded, No Pain, Chrome Shutdown)
- A new **Roller & rules** settings menu.

## 1.5.1

- **Players pin themselves without a GM**: a character's "I'm here" pin is now kept on the
  character (which its player owns) instead of in a world setting only a GM can write, so it works
  during downtime. Pins from 1.4.0-1.5.0 move onto their characters the next time a GM logs in.
- **Go there moves the pin**: walking through a place's doorway pins the character at that place.

## 1.5.0

- **Doorways**: visit places between sessions. Link a place on the Night City Map to a scene and
  a landing spot (a Monk's Active Tiles tile, a Tagger tag, or the scene's start), open it to the
  players, and they get **Go there**: their token lands on the tile, they're pulled into the
  scene, and the tile's Monk's actions run. Allowed any time (downtime too), only while a GM is
  online, or off. Without a GM, players can still view the scene.
- **Dossiers**: a full-screen file for every place, with its picture or a neon sigil, ratings, and
  the write-up typing out. Revealing a place opens it on the players' screens (setting), as does
  Show the players. New places ping until a player opens them.
- **Motion**: the map boots like a CitiNet uplink, switches off like an old screen, has a sweeping
  scan line, darkens at night by the world clock, and its panels glitch in. Holocalls get a
  talking equalizer, typed-out lines, and shaking, glitching portraits while ringing. Reduced
  motion turns it all off.
- The sourcebook's "See Chapter N" pointers are gone from place write-ups.

## 1.4.0

- **Night City Map** (the City & NCART hub): Night City 2070 full screen, from Shift+M, the token
  controls, the carousel or `/map`. City, Threat Zones and NCART views of the 2070 maps; the 85
  Notable Places with their sourcebook write-ups; every district's NCZTA-70 dossier (ratings,
  Security and Utility Codes, turf, NCART); the NCART network on the city and every station on
  the poster.
- **Routes** between any two points with the 2070 Travel Times for every mode, rush hour from
  the clock, a storm toggle, the NCART ride with its changes, and warnings for dangerous ground.
  The GM's **Travel** moves the clock and the crew, and rolls for jams.
- **Discovery**: players see only the places the GM reveals (one at a time with a "Location
  discovered" card, quietly, or a whole district), and the GM can hide any again.
- **Your own places**: add pins with a name, category, Security Code, description and picture
  (hidden until revealed); edit, move and delete them. The map's 85 can be edited, moved, put
  back, or hidden.
- **Where everyone is**: the crew's "We are here" marker and each character's pin (players pin
  their own). Click a character to holocall them. GM notes and linked battle maps on places, and
  **Show the players**.
- **Holocall logs in Night City Messenger**: keep a call's conversation in each player
  character's inbox, threaded per contact into one holocall history (a button on the ended call,
  automatic, or off).
- **Holocalls**: a ringtone (synth, or your own file), ringback for the caller, connect and drop
  blips, a **Busy** signal, and **Holocall** in the Actors directory menu and the sheet header.
  A character pinned where the Utility Code is 9+ (or in a district the GM lists) has no signal.

## 1.3.0

From the 2070 Core Rules (Cyberpunk: The Unification Era):

- **The Plot Die**: the GM Raises the Stakes on a character's Check from a new window (carousel,
  token controls, `/stakes`). The player rolls the d6 from the chat card: a Complication's +2/+4
  rides their next Check as a ticked roll-dialog modifier and clears itself after it; the GM
  picks the Complication (Hinder an Ally, Feeling Unlucky, Influence the Narrative) and the
  player the Opportunity (Aid an Ally, Feeling Lucky, Critically Hit, Influence the Narrative),
  each with its effect applied. LUCK 5+ asks for the Stakes; LUCK 7+ Doubles Down and Forces
  Fate, once a session each. Crit buttons give an Opportunity or Complication without the die.
- **Combat Awareness**: Solos split their Rank across the six abilities in a stepper window; it
  goes on the Cyberpunk RED role item, so the system applies it. Free before Initiative or out of
  combat; in combat it's their Action on their Turn, with a chat card and a marker on their
  carousel card. The GM can adjust it any time.
- **New rulings as conditions**: Broken Leg also costs -2 Evasion per leg (-4 with both); Prone
  is -4 Evasion against melee and to resist Grapples (roll-dialog toggles); **Into the Wall**
  (Spinal Injury for one Round); Fatigued / Slept Badly; Hidden's -4 to enemies in its text.
- **Quickhack conditions**: 18 of them, each on its own clock (3 or 20 Rounds, Vitals Spoof an
  hour). Comms Jam blocks holocalls; Vitals Spoof makes the Biomon Link show calm vitals (the GM
  sees a SPOOFED tag); Slow rolls its MOVE -1d6; Sonic Shock and System Reset bring Damaged Ear,
  or Unconscious and Prone, for as long.
- Condition references now name the 2070 Core Rules where a ruling comes from it.

## 1.2.0

- **Holocalls from the regular chat box**: `/holo <text>` says it on your call, whispered to the
  people on it like any holocall message, as whoever you last spoke as there (the GM: the NPC).
- **Talk from chat**: `/holo` alone, or the new button in the call window, sends your plain chat
  to the call until you switch it off (other commands and rolls still work). A blue banner over
  the chat box shows it's on and turns it off when clicked; it also stops when the call ends.

## 1.1.0

- **Biomon Link** (replaces the crew status bar): players link their characters' Biomonitors
  as a group. A small popout shows each linked character's vitals: an animated ECG paced by
  their state, BPM, HP, STABLE to FLATLINE with the Death Save penalty, Critical Injuries and
  hazards. Link members get an alarm when someone goes critical, drops or flatlines. Neon At
  Home's full Biomonitor opens from a readout.
- **Linking needs an implant**: a Biomonitor (Cyberpunk RED cyberware) or an *Edgerunners Mission
  Kit* Neuroport (or Neuroport (Free)) installed. A linked character whose implant comes out
  reads NO SIGNAL. The GM can turn the rule off or change the accepted implants.
- **Holocalls**: ring the crew, a whole Biomon Link, your Night City Messenger contacts, or (GM)
  any NPC or messenger directory contact, wherever they are. Incoming-call prompt with Accept /
  Decline; holo tiles, a call timer, and the conversation in holo blue, in the call window and
  the chat log, whispered to the people on the call. The GM answers and speaks for NPCs. Add
  people mid-call, hang up, or (GM) end it.
- A Neuroport's Holophone counts as something to call with, when holocalls need an Agent.
- **Night City Messenger integration**: contacts and portraits from its address books and
  directory; its dead zones have no signal; missed calls land in the messenger inbox.
- Token-control buttons and (unassigned) keybindings open the Biomon Link and the dialer.
- **Removed**: the crew status bar and its settings.

## 1.0.3

- **Crew bar for the GM with no crew yet**: when no characters are picked and no player owns a
  character, the GM now sees the crew bar with a note and a **Choose the crew** button (players
  still see nothing). Before, the bar stayed hidden, and so did the button to set it up.
- **Crew bar at the top** now sits just under the combat carousel (or where the carousel would
  be, out of combat), centred over the play area, and moves with it, instead of overlapping it.

## 1.0.2

- **Carousel position**: the carousel now sits at the very top of the play area, centred
  between the scene controls and the sidebar, instead of below whatever else is in the top bar
  (scene tabs, a hub scene's hidden navigation). A new per-user setting puts it just under the
  scene tabs instead.
- **Clock format**: the time of day on the carousel, in the combat tracker and on the
  end-of-combat card follows SmallTime's 12/24-hour setting, the same as Neon Hub's calendar
  ("7:00 PM" or "19:00"). Without SmallTime it's a 12-hour clock, as in Neon Hub.

## 1.0.1

- **Condition Lab**: saving a condition whose modifier isn't a plain number no longer turns it
  into +0. Other modules' CUSTOM changes (Neon At Home's Encumbered and Overloaded MOVE) keep
  their mode, value and priority, and the Lab lists them as they are instead of "NaN".

## 1.0.0

First release: an encounter overhaul for Cyberpunk RED - CORE 0.92 on Foundry v12.

- **Combat carousel**: the Initiative Queue as neon cards across the top of the screen, with
  portraits, Initiative, HP (what players see of NPCs is a setting), Wound States, conditions,
  Death Save markers, the Round, combat time, the time of day and the weather, and GM and
  End Turn controls. The sidebar tracker gets Wound States and the combat clock.
- **Crew status bar**: every player character's HP, armor, LUCK, Humanity, Wound State and
  conditions, with Dying / Unconscious / Flatlined banners; the GM picks the crew.
- **Neon Conditions**: 95 Cyberpunk RED conditions (Wound States, all 22 Critical Injuries,
  combat states, hazards, situational modifiers, pharmaceuticals and street drugs, Night City
  weather, visibility) in CPR's roll keys, so the system's roll code applies them. Critical
  Injuries use CPR's own items. Timed conditions run on world time. Turn automation for Death
  Saves, fire, drowning, radiation, electrocution and reopened injuries (with movement
  tracking). Drugs heal, purge, wear off into Secondary Effect checks and suppress their
  addictions. The Condition Lab edits, adds, imports and exports conditions; the Triggler adds
  them from actor data.
- **Condition Lab & Triggler replacement**: imports CLT's saved map and moves its effects over;
  stands in as `game.clt` while CLT is off.
- **Combat time**: a Round moves world time 3 seconds (setting), so SmallTime, Neon Hub's
  calendars and timed effects follow the fight; a summary card when it ends.
- **Weather**: Neon Hub's calendar weather (or the GM's pick) as conditions on characters
  outdoors, per the Night City Weather rules, adjusted for their gear; scene and region shelter;
  GM cards for timed hazards.
- **Visibility**: Low Light / Darkness / Obscured from scene darkness, light sources (token
  lights, DF Active Lights) and weather, at the character's or their target's spot; Low
  Light/Infrared/UV cybereyes cancel it.
- A public API and hooks for other modules (docs/API.md), and a v12/v13 compatibility layer
  with a CI guard (docs/V13.md).
