# Changelog

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
