# Neon Combat Manager

An encounter overhaul for **Cyberpunk RED - CORE** on Foundry VTT, part of the Neon suite
(Neon Hub, Neon At Home, Neon Market). It turns Foundry's combat tracker into a Night City
encounter screen and makes the fight's conditions, clock, weather and lighting count in
Cyberpunk RED's own rolls.

- **Combat carousel**: the Initiative Queue as neon cards across the top of the screen.
- **Action HUD**: the controlled token's actions in one bar (Initiative, attacks with their fire
  modes, skills, role abilities, conditions), laid out by each player.
- **Neon Chat**: Discord-style formatting, chat portraits, merged and editable messages, roll
  privacy buttons, an Adventure Log, one place for chat commands with a completion menu, and a
  visual novel **stage** for roleplay scenes.
- **Biomon Link**: players link their characters' Biomonitors as a group; a small popout shows
  everyone's vitals (ECG, HP, status, Death Save penalty, injuries) and raises the alarm when
  someone crashes.
- **Holocalls**: Night City Messenger's phone, one click away. Holocall a character from the
  Actors directory, their sheet, the Biomon Link or the Night City Map; a Comms Jam or dead
  ground on the map stops a character calling out.
- **Night City Map**: the 2070 city full screen, with the NCZTA-70 threat zones, 85 Notable
  Places, the NCART network, the crew and the characters where they are, and a route planner
  with the 2070 travel times.
- **The Plot Die**: the GM Raises the Stakes on a Check; the player rolls the d6 and the card
  hands out the bonus, the Opportunity or the Complication (2070 Core Rules).
- **Combat Awareness**: Solos split their Rank across the six abilities in a small window,
  free before Initiative and as their Action once the fight is on.
- **The 2070 roller**: hooked into Cyberpunk RED's own rolls: the Plot Die in the roll dialog,
  Riding the Edge (Push the Limit, Second Chance, Close Call), Chain Reactions, Tarot Criticals,
  Flash of Luck, and the Awareness Ladder on the carousel.
- **Neon Conditions**: the full Cyberpunk RED condition set, wired into the system's roll
  modifiers, with a Condition Lab, a Triggler and a drop-in stand-in for Condition Lab &
  Triggler (which stopped at Foundry v12).
- **Neon FX** (with Sequencer): conditions show on the tokens (fire, electricity, glitching
  quickhacks, Mortally Wounded's heartbeat...), plus a Cyberpsychosis glitch and a Sandevistan
  afterimage trail you switch on with a macro. Uses JB2A when it's installed.
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
[Night City Messenger](https://github.com/christinophrappuccino/night-city-messenger) 2.1+ (holocalls),
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

## Action HUD

A bar of the controlled token's actions, above the hotbar. A player with no token selected gets
their own character. Each group opens on hover, or click a group to keep it open.

- **The template**, a fight's basics:
  - **Turn**: Initiative (joins the encounter if needed), End Turn (lit on your turn), Death
    Save (lit when Mortally Wounded, with the penalty), Facedown
  - **Weapons**: every equipped weapon and installed cyberweapon, with Attack, Aimed Shot,
    Autofire and Suppressive Fire where the weapon has them, Damage and Reload. Ammo is shown,
    and red when the magazine is empty.
  - **Skills**: Evasion, Perception, Brawling, Melee Weapon, Athletics, Stealth and First Aid,
    with their base
  - **Role**: abilities that roll
  - **Netrunning**: Interface abilities, when the character has a cyberdeck
  - **Status**: Prone, In Cover, Hidden, Holding Action, Grappled and Suppressed, toggled on and
    off
  - **Utility**: the Plot Die, Holocall, Biomon Link, Night City Map and the sheet
  - **Macros**: any macro the player can run, for this character and token. Drop one on the HUD
    (from the hotbar, the Macros sidebar or a compendium, such as this module's Holocall macro or
    Neon At Home's window macros) to add it, or pick them in Customize. Hidden until it has one.

  STATs and Gear (drugs) are there too, hidden until you show them.
- **Everything rolls the way the sheet does**: Cyberpunk RED's roll dialog (Ctrl-click skips
  it), ammo, LUCK, targets and its roll card, with this module's 2070 roller on top. A fire
  mode stays set on the weapon, as the sheet's checkboxes do, so Damage after Autofire is
  Autofire damage.
- **Customize it** (the sliders button). Each player has their own HUD:
  - rename, reorder, hide and show groups
  - leave a group on **Auto** (everything it has, like every equipped weapon), or pick its
    actions and their order
  - add groups of your own that mix actions from anywhere
  - keep a layout for all your characters, or give one character a layout of its own. A
    layout follows names ("Evasion", "Militech Viper"), so it carries over between characters.
  - **Template** starts over.
- Drag it by the grip; the chevron folds it to the portrait. A client setting turns it off, and
  a keybinding shows or hides it.

Inspired by Token Action HUD and p4vl0-dev's
[Cyberpunk style](https://github.com/p4vl0-dev/Token-Action-HUD-Cyberpunk-style), but standalone:
it doesn't need Token Action HUD Core. If you run Token Action HUD too, turn one of them off.

## Neon Chat

Foundry's chat, enhanced. Each part can be switched off under **Chat & stage** (world) or in
your own settings (client).

- **Discord formatting**: `**bold**`, `*italic*` or `_italic_`, `__underline__`, `~~strike~~`,
  `||spoiler||` (click to reveal), `` `code` `` and code blocks, `> quotes` (`>>>` quotes the rest),
  `#` headings, `-# small text`, lists, and `[masked links](https://…)`. Inline rolls, `@UUID`
  links and HTML you type pass through untouched.
- **Chat portraits**: the speaker's token art or actor art by their name, in their player's
  colour. Out of character, a player gets their avatar. Double-click a portrait to pan to the
  token. Size and shape are client settings.
- **Merged messages**: lines from the same speaker a few minutes apart read as one block.
- **Edit sent messages**: right-click a message, or press Up in an empty chat box. It shows
  *edited*. The GM can edit anyone's.
- **Roll privacy buttons**: Public, GM, Blind and Self as buttons instead of the dropdown
  (Foundry v12; v13 has its own).
- **Adventure Log**: `/log something happened` keeps a dated line in a journal the players can
  read, and `/log q "Source" what they said` keeps a quote. `/gmlog` writes to the GM's own log.
  Right-click any message to add it to the log.
- **Chat archive** (GM): `/archive [name]` saves the chat log to a journal, then offers to
  clear it.
- **Chat commands, one place for all of them**: type `/` for every command you may use, with
  aliases and what each does. Keep typing, and the menu offers what the command takes (names,
  conditions, expressions). Arrow keys move, Tab or Enter picks. `@name` starts a whisper.
  - Other modules register with Chat Commander's own call, `game.chatCommands.register(...)`,
    which this module provides when Chat Commander isn't installed. With Chat Commander
    installed, this module's commands go to it instead.
  - This module's commands are `/log`, `/gmlog`, `/archive`, `/plot`, `/map`, `/biomon`, `/hud`,
    `/cond <condition>` (on your selected tokens), and the stage's commands below.

### The stage

Visual novel scenes over the table, in the spirit of Theatre Inserts.

- **Putting characters on stage**:
  - from the chat box, `/stage` (your selected tokens or your character) or `/stage Name`
  - the + on the stage bar over the chat box
  - **Put on stage** in the Actors directory menu

  They come on as big portraits at the bottom of the screen, alternating sides.
- **Speaking as someone**: click their portrait on the stage bar, or type `/as Name`. What you
  type in chat is then theirs, in character, and appears in a dialogue box under them, typed
  out and formatted. Emotes (`/em`) show in italics. Out of character (`/ooc`) stays off stage.
- **Expressions**: the face buttons on the stage bar, or `/mood angry`. The expressions are
  Neutral, Happy, Angry, Sad, Surprised, Scared, Smug, Hurt and Thinking, each with its own
  animation. **Stage expressions** in the Actors directory menu sets a picture for each.
- **The narrator** (GM): `/narrate text`, or the megaphone (narrator mode: everything you type
  is narration). It shows in a box across the screen and in chat.
- On the stage bar, right-click a portrait to move it to the other side, and × takes it off.
  `/unstage [Name|all]` and `/curtain` (GM) clear the stage. **Show the stage** hides it for
  you alone.

If you also run DF Chat Enhancements, Chat Portrait or Theatre Inserts, switch off the matching
part here or there.

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
- The phone button on someone else's readout holocalls them (through Night City Messenger).
- The GM sees every link and can rename or break one.

## Holocalls

Calls are [Night City Messenger](https://github.com/christinophrappuccino/night-city-messenger)'s
(2.1 or later, with Calls on): phone numbers, the call screen, voicemail, call logs, networks
and dead zones, payphones and the rest. This module gives it more ways in, and stays out of the
call itself.

- **Holocall** in the Actors directory's right-click menu: the GM gets *Holocall as* an NPC (that
  NPC's phone opens, at its Calls tab); a player's own character opens their phone; anyone else is
  called. The sheet header can have it too (**Holocall button on character sheets** in the Comms
  settings), off by default because sheet headers get crowded.
- The **Holocall macro** (the *Neon Combat Manager: Macros* compendium) opens the phone of the
  selected token's character, or your own. Drag it to the hotbar, or drop it on the Action HUD to
  put it in its Macros group.
- **Calling someone** dials their number in Night City Messenger, as the token you have selected
  (if it's yours), else your character. The GM with nothing selected calls as the messenger's
  operator. An NPC without a number of its own answers on the number of the directory contact
  linked to it. No number, no call: the GM gives numbers in the messenger's Phone settings.
- The **Biomon Link** has a phone button on each linkmate, and the **Night City Map** a Holocall
  button on each pinned character.
- **What stops a call going out**: a **Comms Jam** quickhack, and a pin on the Night City Map
  where nothing works (Utility Code 9+: West Wind, the Occupied Zone, Laguna Bend, plus any
  district the GM adds). Night City Messenger decides who can be reached, by its own networks
  and dead zones: this module can't stop a call ringing.
- Without Night City Messenger (or with its Calls off), the Holocall buttons don't show.

Up to 1.6 this module had its own holocalls (group calls, a dialer, `/holo` in chat, logs saved
to the messenger). Night City Messenger 2.3 does all of that one-to-one and more, so they were
retired in 1.7. Old call logs stay in the messenger.

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
  characters (**I'm here**, no GM needed: the pin is kept on the character). Going through a
  doorway moves the pin there. Click a character to holocall them (unless they're out of signal).
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
- **Dossiers**: every place has a full-screen file (its picture, or its number on a neon sigil,
  with its ratings and the write-up typing out). **Reveal** opens it on the players' screens
  (setting), and so does **Show the players**. Places a player hasn't opened yet ping on their map.
- **Doorways: visiting places between sessions**: link a place to a scene you've already built
  (the bar, the shop, the fixer's booth) and pick where to land: one of **Monk's Active Tiles**'
  tiles, a **Tagger** tag, or the scene's starting view. Tick "Players can walk in from the map",
  and they get **Go there** on the place (and its dossier; a green light on its marker). Their
  character's token lands on the tile, they're pulled into the scene, and the tile's Monk's
  actions run (open a shop, start a conversation, teleport on). The GM gets a whispered note.
  With the setting on "Any time", players can go during downtime too: with no GM online they view
  the scene and move their own token there if Foundry lets them, and the tile's actions wait for
  a GM.
- **For the GM**: notes on any place (only you see them), **View** a place's scene or **Move
  everyone there**, and **Show the players** to open the map on their screens at what you're
  looking at (showing a hidden place reveals it).
- **Motion**: the map boots up like a CitiNet uplink and switches off like an old screen, a scan
  line sweeps it, it goes dark at night (21:00 to 06:00 by the world clock), and panels glitch in.
  All of it stops for anyone whose system asks for reduced motion.
- Settings: whether players can open the map, whether places are discovered, whether a reveal
  opens the dossier, when players can visit places, whether map positions decide holocall signal,
  and extra dead zones.

The maps, places and district data are the Night City 2070 maps and the NCZTA-70 threat zones
made for this campaign (`tools/nc2070-data.py` rebuilds the data from their source). The hub's
approach (a full-screen map with places, districts, routes and a crew marker) and the
actor-menu calls were inspired by Verlierboy's
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

## The 2070 roller

The 2070 Core Rules' dice rules, inside Cyberpunk RED's own roller (it imports the system's roll
classes and checks they're the system's own before touching anything; with another build of the
system, these features simply stay off). Each one can be switched off under **Roller & rules**.

- **Raise the Stakes in the roll dialog**: every Check's dialog gets a Plot Die bar. The GM rolls
  the Plot Die right there; a player can when the GM has Raised the Stakes on their character
  (or Force Fate, at LUCK 7+), or ask for it at LUCK 5+. A Complication's +2/+4 goes straight onto
  that roll, and the result card offers the Opportunity or Complication.
- **Riding the Edge** (LUCK no longer buys +1s): **Push the Limit** in the dialog (2 LUCK: add
  your LUCK STAT); under the roll card, **Second Chance** (1 LUCK: reroll with the same modifiers,
  not on a natural 1) and **Close Call** (3 LUCK: a natural 1 doesn't implode). One per roll.
- **Chain Reactions**: an explosion whose extra die is another 10 (or an implosion's another 1)
  keeps rolling. Chain dice don't change the total; a card pays out by the table: Opportunities,
  +d6 damage and an automatic Critical Injury on attacks, Complications, malfunctions.
- **Crits feed the Plot Die**: the GM gets Opportunity / Complication buttons under any roll that
  exploded or imploded without chaining.
- **Tarot Criticals**: three or more 6s on a damage roll offer the GM a card from the 22 Major
  Arcana instead of the normal Critical Injury. One card a session (the Plot Die's New session);
  the deck goes round once before it's shuffled. The card's injuries and conditions apply to the
  target in one click (Fated, Winded, No Pain and Chrome Shutdown are new conditions for it).
- **Flash of Luck** (in the Plot Die window): a player describes something they already did and
  picks Simple, Unlikely or Improbable (2/4/8 LUCK); the GM approves or vetoes. One a Beat, three
  a Mission; the GM's New beat / New mission reset them.
- **The Awareness Ladder** (GM, on the carousel): the encounter's enemies' awareness from Unaware
  to Spotted, with the Stealth DV to beat (10 or 11 + enemies, sleepers count half). A failed
  Stealth roll steps it up, something obvious jumps to Alert, and a fight that starts puts them at
  Alert.

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
| Hazards (p.180-181) | On Fire (Mild/Strong/Deadly; **2070**: a fire that wouldn't raise the stage pushes it up one), Drowning, Asphyxiating, Electrocuted, Radiation (Low/High), Falling, Exposure, Acid |
| Situational (p.129) | Exhausted, Fatigued / Slept Badly, Extreme Stress, Drunk or Sedated, In Smoke; **Extreme Cyberpsychosis** (2070 ch.09: Humanity below 0, the GM plays the character; a +2 the GM can switch on in the roll); the Plot Die's one-Check Bonus, Aided and Hindered |
| Quickhacks (2070 ch.10) | Comms Jam (no holocalls out), Vitals Spoof (the Biomon Link shows calm vitals; the GM sees SPOOFED), PopUp-geddon, Impair Movement, Slow (MOVE -1d6, rolled), Short Circuit, Cyberware Malfunction, Reboot Optics, Cripple Movement, Weapon Glitch, Limb Seize, Speedware Crash, Sonic Shock (Damaged Ear), Frame Lock, Q-KRASH, System Reset (Unconscious and Prone), Puppet, Cyberpsychosis. Each runs its 3 or 20 Rounds. Overheat is On Fire (Strong) |
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
- **Extreme Cyberpsychosis follows Humanity** (setting): below 0 a character gets it, and it goes
  once Humanity is positive again (Immunoblockers, Prime Time). A reminder on their next Turn
  covers the LUCK roll to retake the Move Action or the Action. One the GM placed by hand stays.
- **2070 rulings**: Mortally Wounded is also -6 MOVE; a hit wakes the Unconscious (and ends a
  System Reset), unless drugged asleep or choked; a flashbang is a Damaged Eye and a Damaged Ear
  for a minute.

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

## Neon FX

Visual effects through [Sequencer](https://foundryvtt.com/packages/sequencer) (needed for Neon
FX; the rest of the module doesn't use it). JB2A, free or Patreon, is used where it has the right
animation; everything else is Neon FX's own art, so nothing needs JB2A.

**Conditions on the tokens.** While a condition lasts, its token shows it, for everyone:

| | |
| --- | --- |
| Wounds | Seriously Wounded: a faint red outline. Mortally Wounded: a pulsing red outline, a heartbeat line over the token and a tremble. Unconscious and Knocked Out: drifting z's. Stabilized and Speedheal: a heal flash |
| Critical Injuries | a hit flash when one lands (JB2A impact) |
| Hazards | On Fire grows with the stage (JB2A flames); Electrocuted crackles (JB2A static electricity) with a zap; Radiation, Acid, Drowning and Asphyxiating glow and tremble |
| Combat | Netrunning: a turning data ring. Suppressed: an amber target reticle. Hidden: an optical-camo ripple. Grappled, Choked, Flashbanged, Teargassed, In Smoke (JB2A fog), EMP'd |
| Quickhacks | each lands with an upload burst and chirp; most leave a cyan glitch while they run (Short Circuit sparks, Sonic Shock pulses, Puppet's ring) |
| Drugs | a coloured glow per drug; Blue Glass sways, Synthcoke jitters |
| Extreme Cyberpsychosis | the full glitch below, a red target-lock reticle under the token, and a sting |

**The switches** (macros in the "Neon FX" macro folder, added for the GM once; or the API):

- **Sandevistan**: switch it on, and every move the token makes (drag, ruler, arrow keys) leaves
  fading green, magenta and cyan afterimages, with a green and magenta fringe on the token and a
  slow-time hum. Run it again to switch it off.
- **Cyberpsychosis Glitch**: the token itself shakes and jerks, with red and cyan copies tearing
  off it, red scanlines and flickering corrupted-signal bands. A look only; the condition is
  Extreme Cyberpsychosis. Run it again to switch it off.
- **Clear Neon FX**: switches both off on the selected tokens.

Players can switch their own tokens. The switches are saved on the token, so they survive a
reload and show for everyone.

**Sound and motion are each player's own** (client settings): *Neon FX volume* (0.4 by default,
0 silences it) on top of the channel slider they pick (Interface by default); the sounds are
levelled quiet and fade in, so nothing jumps out at the table. *Neon FX token motion* turns off
shaking and swaying (so does the system's reduced-motion setting); it only ever moves the art,
never the token, and the token is never hidden.

World settings (Neon FX menu): Neon FX on or off, condition visuals on or off, and the macros.
`api.fx.report()` in the console shows which JB2A files are in use.

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

**Who it reaches**: every character token out in it on the scene, in combat or not (setting
"Weather reaches everyone on the scene"); visibility stays with the encounter. Protective gear is
matched by name (settings): Nasal Filters, Anti-Smog Breathing Mask, Radiation Suit, umbrellas and
the jacket linings from the Night City Weather pack the system ships.

**Where it reaches.** Each scene has a weather setting in its configuration (Ambience tab):

| | |
| --- | --- |
| Outdoors | the weather shows and hits the characters out in it |
| Indoors | no weather here |
| Off | for HUB, title and menu screens: no weather at all, and the scene's own weather is never touched |
| Default | follows the module setting (Outdoors unless you change it) |

On an Outdoors scene, these keep characters out of the weather (no conditions), and the first
two keep the visuals off too:

- **roof and awning tiles** with Foundry's *Restrict Weather*;
- **regions** with a *Suppress Weather* behavior;
- any tile ticked **Shelters from weather** (a checkbox this module adds to the tile's
  configuration, for an awning or bus shelter drawn on the map);
- **regions named** with a shelter keyword ("Interior", "Bar - inside", "Roof"...).

### Weather you can see

The day's weather shows on Outdoors scenes as Foundry's own scene weather, so everyone sees the
same sky. Presets built from Foundry's rain, storm, snow and fog are tinted for the city: Light
and Heavy Rain, **Acid Rain** (green), **Blood Rain** (red), **Ash Storm** (grey), **Dust Storm**
(brown), **Inversion Smog** (yellow haze), **Radioactive Windstorm** (green), Cold Snap snow, a
Heat Wave haze, and the **Deadly Thunderstorm**. When several are in effect, the most dramatic
shows. They're in the scene weather list as "Night City: ..." too.

- A weather you set on a scene yourself is left alone; the module only changes what it put there.
- Each player hears quiet ambience on the Environment slider (rain, wind, a Geiger counter in
  radioactive wind), scaled by their Neon FX volume. A thunderstorm adds soft lightning flashes
  with thunder (no flashes with token motion off or reduced motion). Client setting "Weather
  sounds and lightning".
- World setting "Weather you can see" turns the visuals off (the conditions carry on).

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

## Macros

The *Neon Combat Manager: Macros* compendium (in the Neon Combat Manager folder) has one macro per
window, for the hotbar, the Action HUD's Macros group, a Neon Hub page button or an active tile:

- **Holocall**: the phone of the selected token's character (or your own), at its Calls tab
- **Biomon Link**, **Night City Map**
- **Plot Die**: Raising the Stakes for the selected token's character (or your own)
- **Condition Lab** (GM)

Drop one on the Action HUD to add it to the HUD's Macros group.

## For other modules

Everything is in `game.modules.get("cpr-neon-combat-manager").api` (and the conditions also at
`game.neonConditions`): conditions, combat time, weather and visibility, with hooks for each.
See [docs/API.md](docs/API.md).

## Development

```bash
npm ci
npm test          # rules, conditions engine, CLT import, Turn automation, templates
npm run check     # scripts parse, JSON and localization complete, icons exist, v13 guard
npm run build:packs  # the Macros compendium: writes packs/_source/macros, compiles packs/macros
npm run preview   # renders the carousel, Biomon, Lab and cards to preview/index.html,
                  # and the live Night City Map to preview/hub.html (serve the repo, open /preview/hub.html)
```

Nothing here reproduces the Cyberpunk RED rulebooks' text: names and summaries are this
module's own wording, with page references. Releases: [PUBLISHING.md](PUBLISHING.md).

## License

MIT. The Tektur font is under the SIL Open Font License (fonts/Tektur-OFL.txt). Cyberpunk RED
is a trademark of R. Talsorian Games; this is unofficial fan content.
