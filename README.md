# Neon Combat Manager

An encounter overhaul for **Cyberpunk RED - CORE** on Foundry VTT, part of the Neon suite
(Neon Hub, Neon At Home, Neon Market). It turns Foundry's combat tracker into a Night City
encounter screen and makes the fight's conditions, clock, weather and lighting count in
Cyberpunk RED's own rolls.

- **Combat carousel**: the Initiative Queue as neon cards across the top of the screen. **Sneak**
  runs it as a stealth segment, Turn by Turn before anyone's spotted, and switches to full combat
  without losing the order.
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
  afterimage trail you switch on with a macro, and AV landings: a holo warning zone on the ground
  and an AV flying in to set down on it. Uses JB2A when it's installed.
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

### Stealth segments

Sneaking in Turn by Turn, before anyone's spotted. Before the combat begins, the GM picks
**Sneak** or **Start** on the carousel. **Start** begins full combat, as it always has. **Sneak**
begins a *stealth segment*, with the carousel in violet and a **STEALTH** chip by the Round.

- **What stays the same as a fight:**
  - the Initiative order;
  - Turns and Rounds;
  - each Round moving world time 3 seconds, and the conditions that run out with it;
  - Turn automation (fire, drowning, Death Saves for the Mortally Wounded);
  - Combat Awareness costing the Solo's Action;
  - End Turn for players.
- **What waits:** the Awareness Ladder isn't touched. It stays wherever the GM has it, so failed
  Stealth rolls step it up as usual. A fight puts the enemies at Alert; a stealth segment doesn't.
- **Spotted?** The GM clicks the **STEALTH** chip and the encounter becomes full combat. Same
  queue, same Round, same Turn. Everyone gets a card, and the Ladder goes up to Alert if it's
  lower. That happens once: the GM can lower it again, and the next Round won't put it back.
  Click the **COMBAT** chip to go back to stealth.
- **Players see** the mode chip (they know they're sneaking), but not the Ladder below Alert
  (see [The Alert](#the-alert)). In their Action
  HUD, their **Stealth** roll joins the Turn group for the segment.
- When a stealth segment ends, the summary card says *Stealth segment over* instead of *Combat
  over*.

Settings: **Begin a combat as** (Combat) is the mode a combat begun from Foundry's tracker or a
macro gets, and which of Sneak and Start is the carousel's main button. **Full combat puts the
enemies at Alert** (Table rules) can stop a fight from moving the Ladder at all. Macros:
`api.encounter.begin("stealth")`, `setMode("combat")`, `toggle()`, `mode()`.

### The Alert

The Awareness Ladder shows on the map once the enemies know someone's there.

- **On the tokens.** Each enemy in the encounter (every combatant that isn't a player's
  character) carries the Ladder's step as a condition, an Active Effect with a status icon:
  **Alert** and **Spotted** by default, so everything below stays the GM's and sneaking keeps
  its tension. Below Alert the GM alone gets a **?** over each enemy as the Ladder moves. A
  setting shows every step (Suspicious, Searching too) for everyone, or none. Someone dead, out
  cold or asleep carries nothing. The conditions follow the Ladder; they post no cards.
- **Reaching Alert.** A red **!** jumps over each enemy (**!!** at Spotted), **ALERT** flashes
  across everyone's screen, and one quiet sting plays (not one per enemy).
- **The countdown.** A timer appears for everyone: the seconds until the security response is
  called, 20 Rounds by default. It runs on the game clock, 3 seconds a Round in a fight or a
  stealth segment, and turns yellow in its last quarter. The GM can wave it away with its ✕ (the
  Alert stays, and the clock then calls nothing), or wind it back with `api.alert.restart()`.
- **An Alert is kept until something is done about it.**
  - Put every enemy down (dead, out cold, asleep) **before** the response is called and the
    alarm never goes out: the Ladder drops to Unaware, the conditions go, **ALERT CLEARED**.
  - At zero the response **is called**: the GM gets a card (roll the district's Security Code;
    Heat goes up), everyone sees **RESPONSE CALLED**, and the enemies stay at Alert until the GM
    moves the Ladder. Putting them down after that doesn't call it back.
  - The GM lowering the Ladder below Alert ends it at any time.

Settings (Table rules): **Awareness on the tokens**, **Alert: Rounds until the response is
called** (0: no countdown), **An Alert clears when no one's left to raise it**. Each player can
turn the banner and timer off (**Alert on screen**); the sounds follow their Neon FX volume. The
marks over the tokens need Sequencer.

## Action HUD

A bar of the controlled token's actions, above the hotbar. A player with no token selected gets
their own character. Each group opens on hover, or click a group to keep it open.

- **The template**, a fight's basics:
  - **Turn**: Initiative (joins the encounter if needed), End Turn (lit on your turn), Death
    Save (lit when Mortally Wounded, with the penalty), Facedown
  - **Weapons**: every equipped weapon and installed cyberweapon, with Attack, Aimed Shot,
    Autofire and Suppressive Fire where the weapon has them, Damage, Reload and Change Ammo
    (Cyberpunk RED's load dialog). Ammo is shown, and red when the magazine is empty. The group
    ends with **Equip / Change Weapon** (see below).
  - **Skills**: Evasion, Perception, Brawling, Melee Weapon, Athletics, Stealth and First Aid,
    with their base
  - **Role**: abilities that roll
  - **Netrunning**: Interface abilities, when the character has a cyberdeck, and
    [Quickhacking](#quickhacking): Jack In, Ghost Jack In, Breach, the quickhacks slotted in the
    deck, Jack Out; Eject for whoever's being hacked
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

### Equip / Change Weapon

The last entry in the Weapons group shows how many hands are free and opens a small window:

- **Hands**: two, plus Cyberpunk RED's Number of Hands effects (the system's Artificial Shoulder
  Mount gives two more; the 2070 Item Compendium's Shoulder Mount, which has no effect, counts as
  two more too). A Dismembered Arm or Hand takes one away.
- **In hand**: each held weapon (or shield) and the hands it's in. **Free** puts it back to
  Carried; **Drop** puts it on the ground.
- **Carried**: weapons marked Carried on the sheet, with a button for each free hand. A
  two-handed weapon takes the hand you pick and the next free one. With no hand free, it isn't
  equipped and you're told to free one first.

Dropping uses Neon At Home's drop when it's on (an Item Piles pile beside the token; the
attachments go back on when it's picked up), else an Item Piles pile, else the weapon stays on the
sheet as Owned. Anything picked up out of an Item Piles pile lands on the character as **Carried**
(without Item Piles: an item dropped on a character's token or sheet). The **Picked-up items are
Carried** setting (Combat) turns that off.

**Bare Hands** sits next to it: a Brawling attack with Cyberpunk RED's own **Unarmed** weapon (its
Core Weapons compendium; damage by BODY, core rulebook p.176). It uses the character's Unarmed
item if they have one (in hand, Carried or Owned), or puts one in their inventory, equips it into a
free hand and rolls its Attack. Fists need a free hand like any weapon: with none free, Unarmed
stays Carried and you're told to free one. Once it's in hand, Unarmed is a weapon row of its own
(Attack, Damage) and Bare Hands steps aside.

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
  once a session. Spend them from the result or Raise card, the roll dialog, or their line in the
  Plot Die window (a button when they're ready). **New session** in the window gives them back.
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
  Stealth roll steps it up, something obvious jumps to Alert, and full combat puts them at Alert
  (once). A [stealth segment](#stealth-segments) leaves it alone.

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

### On the character sheet

Every condition is a real Active Effect on the character for as long as it lasts:

- **STATs and skills change by themselves.** Its changes are on Cyberpunk RED's own keys
  (`system.stats.move.value`, `bonuses.evasion`, `bonuses.allActions`...), so the sheet's numbers
  and the roll dialog follow. Nothing CPR already applies is counted twice: Wound State
  penalties, a Critical Injury item's own penalties and Death Save increase, and the Plot Die's
  bonus stay with the system or the roller.
- **MOVE penalties stop at 1** (Mortally Wounded, Collapsed Lung, Broken and Dismembered Legs),
  as the book says. Quickhacks can still take MOVE to 0.
- **Each effect says what it does.** Its description has the condition's text, what Neon
  Conditions automates (the changes, roll-dialog toggles, damage at Turn start or end, reminders,
  the conditions it brings along) or *Not automated: play it out at the table*, and the page.
  On the sheet's Effects tab, each condition gets a line with its text and page under its name,
  so ones Cyberpunk RED can't automate (EMP, Human Shield, Suppressed) still explain themselves
  there. **Condition notes on character sheets** (Conditions settings) turns that line off.
- **Removing a condition removes its effects**: its changes, the Critical Injury item it added,
  and the conditions it brought along (a flashbang's Damaged Eye and Ear, Sleep's Prone, System
  Reset's Unconscious), unless another condition on the character still brings them.
- **Tarot: Chrome Shutdown**'s extra -4 is a roll-dialog toggle, off until the GM ticks it (for
  someone with no other way to sense the enemy).

Every effect created on an actor with changes but without Cyberpunk RED's bookkeeping flags
(from any module or macro) gets them, so the character sheet keeps opening.

### The Condition Lab

**Carousel → flask button**, or `game.modules.get("cpr-neon-combat-manager").api.conditions.openLab()`.
Every condition with what it does in roll terms, by category, with search. The GM can edit any
condition (name, icon, text, modifiers, duration, exclusive group, damage at Turn start/end),
switch it off, reset it to the original, make custom ones, and export/import the lot as JSON.
Conditions with nothing automated are marked *not automated*. Saving or resetting a condition
updates the effects already on characters: their text and icon, and their modifiers where
they're the condition's own (weather, visibility and rolled ones keep their numbers).
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

## Quickhacking

Quickhacking in the field, as the 2070 Core Rules run it (Chapter 10, Part 1), from the Action
HUD's Netrunning group. Each step rolls, posts a card and plays on the map by what the roll decided.
Quickhacks are the Programs Neon At Home's compendium ships, slotted in the deck the character runs.

| Step | The roll | On the map |
| --- | --- | --- |
| **Jack In** to the token you target | Interface + 1d10 against their WILL + 1d10 (Interface 1-2 beats the firewall's DV6 first). You're in either way; lose and they know | a pulse runs from the Netrunner to the target and a data ring snaps shut on it; a faint link stays between the two tokens while you're in |
| **Ghost Jack In** | the same with Cloak, for 2 NET Actions (a Netrunner target rolls Interface). Win and you're Ghosted | a thin, dim pulse and link, and nothing on the target |
| **Breach** | Interface against DV6, 8 or 10 by how many Passwalls (Self-ICE) the port has, one Passwall each | the pulse meets Self-ICE: the shield flares, holds and throws the pulse back, or it shatters |
| **A quickhack** (once every Passwall is down) | Interface against its DV; one per target per Turn; its Cooldown starts hit or miss | the upload runs up the link and lands in the way of its family: Intel a scan sweep, Covert a violet shimmer, Control crackling static, Combat a red hit, Ultimates an overload (Overheat burns, Sonic Shock rings, System Reset powers down, Puppet strings). A miss fizzles |
| **Detected** | a lost Jack In, a loud quickhack, a broken Ghost | a red alert on the target and a trace running back up the link to the Netrunner |
| **Eject** (the target's Action; a button on the card and on their Action HUD) | WILL + Concentration + 1d10 against Interface + 1d10 | the link tears and snaps back into the Netrunner, who can't hack them for an hour |
| **Jack Out** | none | the ring lets go and the link runs home |

- **What a hit does.** A quickhack with a Neon Condition (Short Circuit, Reboot Optics, System
  Reset, Overheat's fire...) places it as the upload arrives, with the condition's own burst and
  look; when it ends, however it ends, the token shows the system coming back up. Synapse Burnout,
  Contagion and Total System Kill roll their damage straight to HP, 4 less against Self-ICE:
  Defender. Anything else is the GM's to apply, and the card says so.
- **Ghost runs.** While the Netrunner is Ghosted and unnoticed, the cards are whispered to the GM
  and the Netrunner's players, and the dim link and uploads play only for them (setting: for
  everyone, or not at all). Quiet (◆) quickhacks keep the Ghost; a failed Breach or a Quiet hit on
  a Netrunner gives the target a roll to notice; anything else breaks it, and from then on
  everyone sees.
- **Left to the table:** range and line of sight, counting NET Actions (the card names the cost),
  a quickhack's Needs (the card names them; `api.hack.reset(actor)` clears a Cooldown that
  shouldn't have started), vehicles, a Cybersuite's built-in quickhacks, Pathfinder bonuses, and
  how many times an hour Self-ICE: Defender has soaked.

Automated Animations isn't involved: it plays on a weapon's attack roll, and a quickhack isn't one,
so the module draws every beat itself with Sequencer, timed from JB2A's clips (all of them in the
free pack; Patreon adds colours). Without JB2A the module's own art plays; without Sequencer the
flow runs with no animation. Each beat has a short, quiet sound (made with ElevenLabs for this
module), played at each player's Neon FX volume; a Ghost's is quieter still. Settings: *Quickhacking on the Action HUD* (Table rules), *Quickhack
animations* and *Who sees a Ghost Hack* (Neon FX).

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
| Quickhacks | each lands with an upload burst and chirp; most leave a cyan glitch while they run (Short Circuit sparks, Sonic Shock pulses, Puppet's ring); a ring opens and a green pulse runs out as one ends |
| Chrome running | a Sandevistan, Berserk or one of their Operating Systems: see below |
| Drugs | a coloured glow per drug; Blue Glass sways, Synthcoke jitters |
| Extreme Cyberpsychosis | the full glitch below, a red target-lock reticle under the token, and a sting |

**The switches** (macros in the "Neon FX" macro folder, added for the GM once; or the API):

- **Sandevistan**: switch it on, and every move the token makes (drag, ruler, arrow keys) leaves
  fading green, magenta and cyan afterimages, with a green and magenta fringe on the token and a
  slow-time hum. Run it again to switch it off.
- **Berserk**: a hard red pulse and haze on the token, which shakes; the ground cracks under it as
  it kicks in (JB2A), with a low surge, and it winds down as it stops.
- **Speedware (Kerenzikov)**: a cool blue edge and a quick rush, for speedware that's always on.
  A look only.
- **Cyberpsychosis Glitch**: the token itself shakes and jerks, with red and cyan copies tearing
  off it, red scanlines and flickering corrupted-signal bands. A look only; the condition is
  Extreme Cyberpsychosis. Run it again to switch it off.
- **Clear Neon FX**: switches them all off on the selected tokens.

**Chrome running.** The Sandevistan and Berserk macros run the chrome as the rules do: the
character gets a **Chrome running** condition (an Active Effect with a status icon), their
Operating System's when they have one installed, and the condition holds the look on.

| Condition | Lasts | On the character |
| --- | --- | --- |
| Sandevistan | 20 Rounds | +3 Initiative |
| Apogee OS / Falcon OS | 3 Rounds | +6 Initiative and +2 Aimed Shots / +4 Initiative |
| Professional OS / Warp Dancer OS / Reflex-Plus OS | 3 / 4 / 5 Rounds | +3 Initiative (Reflex-Plus: +1 REF too) |
| Berserk | 20 Rounds | the hint: no Seriously or Mortally Wounded penalties |
| Berserker OS / Baldur OS / Matterhorn OS / Brawler OS | 5 / 4 / 10 / 5 Rounds | the hint: what each does while it runs |

- Each Operating System runs in its own colour, with a burst as it kicks in and a ring as it stops.
- In a fight under way, the character's Initiative moves up by the bonus as it starts and back
  down as it ends.
- Neon Hub's Sandevistan and Apogee carry an "(active)" effect of their own: switching that on or
  off places or removes the condition, the macro goes through it, and the condition ending
  switches it off. What that effect already gives isn't counted again.
- Humanity Loss on activation, cooldowns, halved damage and the other things the hints list stay
  with the table. A Kerenzikov is always on and has no condition.
- A setting (*Speedware and Berserk conditions*) turns this off: the macros are then looks only.

Players can switch their own tokens. The switches are saved on the token, so they survive a
reload and show for everyone.

**Tactile Boost** (Cyberpunk RED p.359). The chipware feels motion within 20 m/yds through a hand
on a surface. That's the **Feeling for Motion** condition (Chrome running; on the Token HUD, and
in the Action HUD's Status group for anyone with a Tactile Boost installed). While a character
with it is selected, their player sees:

- an **amber ripple where anyone out of sight moves** within 20 m/yds, through any wall or door
  (it's the surface that carries it, so thin or thick makes no difference). It marks where motion
  was last felt: no outline and no name, unlike a Tech scope. It follows them as they move again,
  and goes when they come into view, pass 20 m/yds or the hand comes off;
- a slow, faint ring out from their own token to the edge of the 20 m/yds.

Someone standing still isn't felt. Only that player sees any of it, GM-hidden tokens never show,
and the hand being busy is left to the table. A setting (*Tactile Boost ripples*) turns it off.

**AV landings** (two more macros in the folder):

- **AV Landing Zone**: pick a spot and a holo warning zone lights up on the ground: a rectangular
  amber grav field with a hazard-striped pad, a scan bar running its length, a frame pulsing out,
  cyan corner brackets and blinking beacons, with a power-up chime and a few seconds of quiet
  warning beeps. It's sized to the selected token (a square's margin all round, and long along
  its longer side; 3x5 squares with nothing selected) and squared on the grid so the AV sits in
  the middle. Everyone sees it, and it stays after a reload. Run the macro and cancel the pick
  (right-click) to take a scene's zones away.
- **AV Landing**: select the AV and run it. It lands on the nearest zone (with none, you pick a
  spot): the AV flies in from where it was, drawn bigger while it's up in the air with its shadow
  cast below, slows into a hover over the pad, and sets down in a blast of dust (JB2A's smoke
  where it's installed), engine roar and a touchdown thump. The zone powers down after. A GM can
  place the AV hidden anywhere first: it then comes in from the sky above the pad and is revealed.

The token moves in one step, straight onto the pad; only the drawing flies (each player's own
motion setting applies: with motion off it just appears on the pad, with the dust and sound).

**Sound and motion are each player's own** (client settings): *Neon FX volume* (0.4 by default,
0 silences it) on top of the channel slider they pick (Interface by default); the sounds are
levelled quiet and fade in, so nothing jumps out at the table. *Neon FX token motion* turns off
shaking and swaying (so does the system's reduced-motion setting); it only ever moves the art,
never the token, and the token is never hidden.

World settings (Neon FX menu): Neon FX on or off, condition visuals on or off, chrome conditions,
quickhack animations and who sees a Ghost Hack, and the macros.
`api.fx.report()` in the console shows which JB2A files are in use.

## Neon Arsenal

Cyberpunk RED's weapons in the 2070s, at the table: animations through
[Automated Animations](https://foundryvtt.com/packages/autoanimations) (AA) and JB2A, weapon
sounds, area attacks that place their own template, and the traits a 2070 gun or a Rebuild gives
it. It covers the weapons and ammo in Neon Hub's *Item Compendium (2070s)*, Cyberpunk RED's own
compendiums and anything you make, because it reads what a weapon *is*, not what it's called.

**What a weapon is.** Its kind (Pistol to Very Heavy Pistol, SMG, Heavy SMG, Assault Rifle,
Sniper Rifle, Shotgun with slugs or shells, Bow, Grenade, Rocket and Missile Launchers, thrown
grenades, flamethrowers, knives, blades, blunt weapons, monowire and fists), its 2070 flavor
(Power, Smart or Tech: Neon Hub's flag, "(Power)" in a generic gun's name, "Built-in: Power
Rebuild" on an Iconic's card, or a Power, Smart or Tech Rebuild installed on a RED-era gun), the
ammo loaded in it, and its Melee Rebuilds. `api.arsenal.explain(item)` shows the reading.

**Automated Animations.** The profile has an entry for every kind, its Tech and Smart looks,
Incendiary and EMP rounds, and mono-edged blades and Propulsion Impact hammers, all JB2A. With
JB2A Patreon it uses Patreon's grenades, launcher rounds and coloured bullets; with the free pack,
the nearest it has. When the GM loads the world and the entries aren't in AA's Global Automatic
Recognition menu (or are from an older version), a window offers to put them in: **Install now**,
**Not now** (asked again next time) or **Don't ask again**. They're labelled *Neon Arsenal · ...*;
your own entries stay as they are. Only the GM installs: the menu belongs to the world, so players
need nothing. If the install repairs entries from before 1.19.2, the GM is asked to reload
everyone, because Automated Animations stopped loading on browsers that opened the world with
them; each player gets a prompt of their own. At each attack Neon Arsenal hands AA its entry for what the weapon is, the ammo the way
the CPR fork of AA reads it (Cyberpunk RED 0.92 keeps it among the weapon's installed items), the
fire mode (Autofire bursts, Suppressive Fire sprays and misses), and, when AA is set to show
misses, a hit or a miss by the 2070 range tables. The *Install Weapon Animations* macro (GM) puts
the profile in by hand; `api.arsenal.uninstall()` takes it out.

**Timing.** Each sound and hit is placed by what JB2A's clip shows, measured frame by frame
(`scripts/arsenal/timing.js`): the shot sounds as the round leaves (a bow's string at the release),
the hit shows and sounds as it arrives (sooner up close, later across the map), a melee weapon
sounds as its swing connects, and a blast goes off as its round lands. Neon Arsenal draws the hit
itself, since Automated Animations can only hold an entry's second effect back by a fixed time,
and everything waits for Automated Animations' first frame so a slow-loading clip doesn't leave
the sound ahead.

*Why a module and not a fork of AA, or only a JSON file:* a JSON profile can only match items by
name, and the 2070 catalog names its guns, not their kinds; a fork of AA would have to be kept in
step with AA itself. Registering the profile from this module lets it match on the weapon's data,
keep up to date with each release, and still work with the CPR fork the table runs (or AA
itself). For a world without this module, `assets/arsenal/neon-arsenal-autorec.json` (and
`-patreon.json`) are the same profile as AA menu exports to merge in AA's Menu Manager, sounds
included.

**Sounds.** Gunshots for each kind, bursts, Smart and Tech shots, a Tech charge-up, ricochets,
impacts, launcher thumps, rocket launches, grenade and rocket blasts, EMP and smoke, blades and
blunt hits, a monoblade and a flamethrower (made with ElevenLabs for this module). Each client
plays them at its own *Neon FX volume* and channel, quiet by default, with a short fade-in. AA's
entries are silent in a world with this module.

**Muzzle flashes** come from
[Diwako's Cyberpunk Red - Core Additions](https://github.com/diwako/foundry-cyberpunk-red-core-additions)
with DF Active Lights: it lights a flash when AA plays a ranged attack, reading the ammo Neon
Arsenal hands AA. Diwako's flash only lights for attacks the GM rolls; Neon Arsenal sends the
players' shots to the GM's client so theirs flash too (the GM must be viewing the scene), and a
Tech gun flashes blue. Arrows, paintballs, grenades and rockets don't flash.

**Diwako's DV display, with the 2070 tables.** Hovering a token shows the DV for each of your
ranged weapons; Neon Arsenal hands Diwako's display the numbers from the 2070 range tables (Neon
Hub's *DV Tables (2070s)*, or whichever compendium Cyberpunk RED is set to, a world table of the
same name first), and each gun's own Autofire table as its card names it ("Autofire (Machine
Pistol 4)"), where Diwako's own looks for "<table> (Autofire)". Diwako's settings (in combat only,
names or types, left or right) still apply.

**Range Table Modifications.** Neon Hub's barrels, chokes, limbs and tubes (1.23.0) move a gun to
another table by changing its own range table, so the DV display, Does it hit?, the AA look and
the areas all follow with nothing to set here: a Snub Barrel pistol shows DV Snubnose Pistol.
Autofire stays on the gun's type's Autofire table (the rule changes the range table and nothing
else), and a rocket launcher with a Long Tube still looks like a rocket launcher. Neon Hub's Autofire
attachments (a Pistol Autosear, SMG Cyclic Internals, a Constant Recoil System...) set the gun's
Autofire rating and Suppressive Fire, so the HUD's buttons follow, and name the gun's new Autofire
table (`flags.cpr-neon-hub.autofireTable`), which the DV display and Does it hit? use first.
With shells loaded, a shotgun with the Shotgun Automatic Control Group makes the rule's shell
attack when you pick Autofire. You place the spread as usual. Its damage is the shells' damage
with no Autofire multiplier, and anyone in the spread who dodges takes −3 on Evade. Neon Hub
spends the 4 shells, and the other attachments' rounds per burst.

**Does it hit?** Under each ranged attack card, for each target: the DV at their range (the
2070 tables, an Autofire shot on the gun's own Autofire table), hit or miss and by how much (a
Check must beat the DV), Autofire's damage multiplier (what it beat the DV by, up to the gun's
number), and whether the target can dodge bullets (REF 8+). Diwako's own "Does it hit?" message
reads tables the 2070 guns don't have and can't be switched off in its module, so Neon Arsenal
keeps it out of the chat while its own check is on (a setting). Diwako's hit sounds and hit
animations are its own settings: with Neon Arsenal, switch them off, since AA's hit and miss
animations and Neon Arsenal's impact sounds already play.

**Defense: Evade or Tank.** After an attack, each target who can dodge bullets gets a card for
their player (and the GM): **Evade** rolls DEX + Evasion + 1d10 with Cyberpunk RED's own roll, and
the attack must beat it (a tie goes to the defender; a setting); **Tank** lets the range DV stand.
Dodging bullets takes REF 8+, or chrome whose card says so: a Reflex Co-Processor, Corgo's
Kerenzikov, or a Militech 'Apogee' or 'Falcon' Sandevistan OS while its "(active)" effect is on.
Nobody can dodge a ricochet, a shooter they don't know is there (the attacker is Hidden), or
bullets with their eyes shut down (Blind, Reboot Optics). A melee attack is always an opposed
Evasion roll: rolled for the target at once, or from a card their player rolls (a setting). In
an area, everyone caught who can dodge gets the same choice, and whoever dodges out leaves it (Ch07;
Core p.174): their token goes to the nearest open square outside the area, straight away from its
centre (round a wall if one's in the way), so the blast passes them by. Walled in with no way out,
they stay put and start unticked in the GM's apply window. A result card says who dodged and who's hit (for everyone, or
the GM and the target's players). It follows the flow of Vec's
[Cyberpunk RED – Evasion Workflow](https://github.com/Vec97/cpred-evasion-workflow), built in.

**Area attacks.** A grenade, rocket or missile (launched or thrown) places a 10×10 m/yds area, or
the size its ammo card names (a Laser Grenade's 6×6m, a Wall-Piercing Grenade's cone); a Shotgun
Shell or a flamethrower a 6 m/yds cone in front of the shooter. When the attack is rolled (from
the sheet, the HUD, a macro), the template follows the mouse; left-click places it centred on the
square you aim at, right-click or Escape makes it a normal attack. Everyone inside is targeted.
The roll says where it lands, by the weapon's range table at that distance (a Shotgun Shell is
DV13): a hit goes off there, with the shot and the blast drawn and heard. On a miss the GM decides
where it lands, as the rules have it (Core p.174, 2070 Ch07): drag the template there (within the
10×10 area around the aimed square), or press **Scatter** on the card (GM only, HOUSE RULE) to drop
it on a random square of that area, never the aimed one. Either way it goes off there. A card says
which, and who is in it.

The GM applies it from that card or the damage card's *Apply to the area*, the way the 2070
Core Rules have it (Ch07, Firing Modes): one damage roll for everyone, through Cyberpunk RED's own
damage application (body armor, ablation, shields, damage reduction, its card for each). The GM
unticks anyone who dodged out or whose cover took it. **Blown back** (HOUSE RULE) throws whoever
took damage 2 m/yds (4 from a rocket or missile) away from the centre, stopping at a wall with
Into the Wall. The ammo does the rest: Incendiary sets whoever took damage On Fire (a flamethrower,
Strongly); Teargas, Flashbang, Sleep, Poison, Biotoxin, EMP and the Sonic Grenade post a save for
each target's player to roll with Cyberpunk RED's own roll (a failure gets the condition, or the
damage straight to HP); an Arachnid Grenade grapples; a CO2 Grenade puts fires out; smoke stays
on the scene. A damage roll for an area draws no Tarot card.

**Weapon traits** (2070 Core Rules Ch07, The Three Flavors of 2070 Firearms):

| | |
| --- | --- |
| Power | a Critical Injury's Bonus Damage +5 (on the damage card). **Ricochet**: a switch on the HUD's weapon (and the *Weapon Rebuilds* macro) for the next shot: −4, can't be dodged (an Aimed Shot ricochet only takes the −8); a Ricochet Compensator makes it −3. A ricochet whines. |
| Smart | +1 to ranged attacks with a Neuroport, Personal Link or Subdermal Grip (Neon Hub's Smart guns have the +1 in their attack modifier already, so without a link it comes off). With Improved Smart Ammunition, a miss by 5 or less gets an *Improved Smart retry* button: 14 + 1d10 against the same DV. |
| Tech | **Charge**: a switch (it's the Move Action) that holds 20 Rounds or until fired, crackling on the token. The next non-explosive attack is ROF1 through Thin cover (noted on its card) and its damage ignores half the target's SP; a charged slug knocks the target Prone. |

**What the flavors look like** (with Sequencer; each a world setting):

- **Weapon conditions.** *Power Weapon*, *Smart Weapon* and *Tech Weapon* go on a character while
  a gun of that flavor (or with that Rebuild) is equipped, and come off when it's stowed. They
  carry no numbers, since the traits above are added on the roll. They show faintly on the token:
  an orange heat haze for Power, a slow pink reticle for Smart, a blue data ring for Tech.
- **Tech scope.** While a character with a Tech Weapon is selected, their player sees a glowing
  cyan outline of anyone behind thin cover they can't otherwise see, within 50 m/yds. Thin cover
  is a wall ticked *Thin cover* in its settings, and closed doors (a setting). Only that player
  sees the outlines, and GM-hidden tokens never show. **An outline can be targeted**, for a
  Charged Shot through the cover: click it (Shift-click adds a target), hover it and press the
  Target key, or use *Target through cover* beside the Tech gun's switches on the Action HUD,
  which takes the nearest and then the next with each press. Cyan brackets mark a target you
  can't otherwise see.
- **Ricochet.** A ricochet shot flies to a bounce point and on to the target. The bounce point is
  on the nearest wall that faces both the shooter and the target with a clear line to each, or
  off to one side when there's no such wall. Sparks fly at the bounce (JB2A's impact where it's
  installed), and the path hangs in the air for a moment.
- **Smart rounds.** A reticle locks onto each target with a beep, then the rounds launch wide and
  curve in, trailing (four for Autofire). Improved Smart rounds glow magenta, steer harder and
  paint the shooter with a data ring.
- **Improved Smart retry.** On a miss by 5 or less, the shooter is asked at once whether to
  re-acquire (the card's button stays too). The second try is 14 + 1d10, with the first shot's
  penalties and any LUCK they choose to add. The round loops back from past the target.

- **Improved Smart vs obscurement.** Improved Smart rounds ignore visual obscurement penalties
  (2070 Ch07), so Low Light, Darkness, Obscured, smoke, pop-ups and weather's sight penalties come
  off that roll. The card says how much.
- **Following a ricochet.** A ricochet can't be dodged, unless the target can follow the bounce: a
  Kerenzikov, a running Sandevistan or other speedware, or low-light, IR or UV optics while they're
  in the dark. Then their Evade card takes −4 (Ch07, Ricochets in Play; a setting).
- **Charged Tech shot.** A blue line runs to the target, with a ripple where it punches through
  each piece of thin cover. The *Weapon Rebuilds* macro also lists whoever the Tech scope shows
  behind cover, so you can target them from there.
- **Power Critical Injury.** A heavy hit and an orange shockwave on the target, and a note on the
  card that the Bonus Damage is +5 more.
- **Smartgun Link** on a Power or Tech gun: the lock-on reticle, over the gun's own shot.
- **Mono-edge Weapon.** A faint cyan edge glow while a blade with Mono-edge Blading or the
  Monoblade Rebuild is in hand (a weapon condition, like the three above).
- **Propulsion Impact.** A shockwave and a streak along the push, with sparks if it ends in a wall.

Ricochets and Smart shots replace Automated Animations' straight shot; the gunshot sounds stay.
Smart bows get the homing look too, with Improved Smart Arrows steering like rounds.

**Rebuilds that are always on** apply on every attack: Neon At Home registers the Melee Rebuilds
(Mono-edge Blading and the Monoblade Rebuild ignore armor below SP7, 11 or 13 by tier; Propulsion
Impact pushes whoever it hits 2 m/yds, under BODY 13, or 4 m/yds, stopping at walls) and the
Ricochet Compensator. Other modules can add their own (see [docs/API.md](docs/API.md)).

World settings (Neon Arsenal menu): the animations, offering to install the profile in AA, the sounds, the
areas, Blown back, the weapon traits, Does it hit? (and hiding Diwako's), the defense step (melee
rolled at once or by the player, ties, who sees the result), Diwako's DV display tables and
players' muzzle flashes.

## Cover

The 2070 Core Rules' Cover HP (Ch07, Cover, Shields & Armor) on the map. HP is per 2×2 m/yds
section, Thin / Thick: Plaster 0 / 15, Wood 5 / 20, Concrete 10 / 25, Bulletproof glass 15 / 30,
Stone 20 / 40, Steel 25 / 50. Cover has no armor: it takes the whole hit.

**Walls.** A wall's settings have a *Cover* block: its material and thickness, and its sections'
HP. To tag many walls at once, the GM's **Tag walls as cover** button (in the walls controls) tags
the selected walls, every untagged wall in the scene, or every wall (*Not cover* untags them).
Doors with no cover of their own count as Wood (Thin), as a setting. Bulletproof glass stops
bullets even where you can see through it. Thin cover of any material also counts for Tech scopes
and charged Tech shots. A long wall takes damage where the line of fire (or the blast) meets it:
each 2 m/yds section has its own HP. **A section at 0 HP is destroyed: the wall opens there**, and
the gap stops blocking movement, sight, light and sound, so tokens can walk and see through it.
The GM sees each damaged section's HP on the map, and an ✕ where one is destroyed (a setting).

**Cover pieces.** The *Neon Combat Manager: Cover* compendium has twenty, each with its own
top-down token. One piece for each material and thickness, each one of the book's own examples:
Office Partition and Sofa (Plaster), Overturned Table and Bar Counter (Wood), Low Brick Wall and
Dataterm (Concrete), Teller Glass and Armored Glass Barrier (Bulletproof glass), Statue and Boulder
(Stone), Car Door and Engine Block (Steel). And a 2-square wall section for every material and
thickness the pieces don't already draw as a wall: Interior Wall (Plaster, Thick), Wooden Fence and
Timber Wall (Wood), Concrete Barrier (Concrete, Thick), Low Stone Wall and Fieldstone Wall (Stone),
Corrugated Fence and Blast Wall (Steel). Drag one onto the map; its HP bar is the piece's HP,
seen by the GM. **A piece is a barrier**, like the wall it stands for: the GM's client gives each
one walls of its own (its outline, turned with the token), so nobody walks through it, and a tall
piece (Office Partition, Interior Wall, the fences, Timber, Fieldstone and Blast Walls) also blocks
sight and light along its length; a Thin one of those still shows outlines to a Tech scope. You
see over the low ones and through glass. The walls move, turn and go with the token; pieces already
on a map get theirs when the GM next opens the scene. A destroyed piece fades and opens: people
walk and see through it until *Repair cover* (a setting turns the barriers off). A player who moves Thick cover without BODY 10+ is
reminded of the rule. Cover pieces aren't people: no Wound States, Biomon or death saves.

**Your ride as cover** (HOUSE RULE, 2070 Core Rules Ch07). Every vehicle actor is cover: MMuton's
vehicle sheet, and Neon Hub's 2070s vehicles and ACPAs.
- **Crouched behind a ride**, its SP and SDP are the cover's HP. Damage goes through Cyberpunk
  RED's own vehicle damage: the SP stops its share and ablates, and the SDP takes the rest. A
  rocket's double counts on what gets past the SP (Bunker Buster). A ride the blast wrecks lets it
  through to whoever is behind.
- **Inside a ride**, normal cover rules apply. The ride itself isn't your cover, because people see
  you through its windows. Windows aren't cover, but a seat with **Bulletproof Glass** on MMuton's
  sheet is: Thin (15 HP) or Thick (30 HP, two installs). *Hit the cover* and the area window put
  the damage on that seat's glass HP, on the sheet. Cover out past the ride (a wall between you and
  the shooter) still comes first. Who sits where comes from the sheet's seats.
- Someone firing out of a ride isn't behind it.

**When someone shoots:**
- **A shot** at a target behind intact cover: *Does it hit?* names the cover and its HP. Cover the
  shooter leans out from (within 2 m/yds of them) doesn't count, and a charged Tech shot goes
  through Thin cover. The damage card gets a GM button, **Hit the cover**. The cover takes the
  damage, and at 0 HP it's destroyed but soaks that whole shot, so the next one gets through.
  Shooting a cover piece itself works the same way.
- **An area** (grenades, rockets, shells): the GM's apply window lists the cover that takes the
  damage: pieces and rides in the area, and the cover between the blast (or the shell's shooter)
  and each person in it. Anyone it shields is unticked. An explosive that destroys the cover hits
  whoever is behind it for full damage; a Shotgun Shell's cover always soaks it. Rocket launchers
  do double to cover (Bunker Buster).
- The damage only goes on when the GM clicks; nothing is applied on its own.

**Repair cover** (the GM's button in the token controls) puts every wall section and cover piece
on the scene back to full and closes the gaps. World settings (Neon Arsenal menu): cover on or off,
doors as Wood (Thin), the HP on the map. For macros: `api.cover` (`between`, `damage`, `repair`,
`tag`, `scan`).

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

## Movement ruler

In place of [Drag Ruler](https://github.com/manuelVo/foundryvtt-drag-ruler) (which stops at
Foundry v12), with Cyberpunk RED's own movement (2070 Core Rules, Ch07): while you drag a token,
its path lights square by square in the band each square falls in:

| | |
| --- | --- |
| cyan | within the Move Action: MOVE × 2 m/yds |
| yellow | with a Run (a second Move Action, your Action): MOVE × 4 m/yds in all |
| red | out of reach this Turn |

MOVE is the character's MOVE now, so Neon Conditions, Critical Injuries, encumbrance and the rest
count. Prone, nothing is in reach until they Get Up; Grappled, no Move Action; a lost Move Action
(Damaged Ear, a flashbang) leaves only the Run. In combat, on their own Turn, what they've already
walked shows faded and counts toward the bands, on every client (the path is kept on the
combatant, and starts over each Turn). The label at the cursor says how far, and which band.

**Waypoints**: Space or right-click drops one where the token is, Backspace takes the last one
back. On release, the token walks them one leg at a time; a wall stops a player's token at the
last waypoint it reached.

**On Foundry v13**, Foundry measures token drags itself (with its own waypoints and history): Neon
Combat Manager colours that ruler by the same bands. **With Drag Ruler running** (v12), Neon
Combat Manager hands Drag Ruler the bands as its speed provider instead, and tells the GM once
that its own ruler takes over when Drag Ruler is disabled. Settings (Combat & Time): the ruler on
or off, and whether tokens walk their waypoints.

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
- **Weapon Rebuilds**: the switches for the selected token's weapons (a Power gun's Ricochet, a
  Tech gun's Charge)
- **Install Weapon Animations** (GM): Neon Arsenal's profile into Automated Animations

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

Neon Arsenal works alongside, and learned from, two MIT-licensed projects without including their
code: [Automated Animations](https://github.com/theripper93/autoanimations) and its Cyberpunk RED
fork ([rhlowe/autoanimations-foundry12](https://github.com/rhlowe/autoanimations-foundry12)), whose
menu format and workflow hook the profile follows, and
[Diwako's Cyberpunk Red - Core Additions](https://github.com/diwako/foundry-cyberpunk-red-core-additions),
whose muzzle flash and DV display it feeds. Its defense step follows the flow of Vec's
[Cyberpunk RED – Evasion Workflow](https://github.com/Vec97/cpred-evasion-workflow) (MIT), also
without its code. The JB2A animations are JB2A's (installed separately).
The weapon sounds were made with ElevenLabs for this module.
