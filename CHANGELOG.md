# Changelog

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
