# Changelog

## 1.21.0

**Weapons in the Action HUD**, after a session at the table. Also in this release: 1.20.0's AV
landings (the AV Landing Zone and AV Landing macros, below).

- **Change Ammo is on each gun**, next to Reload, with Attack, Aimed Shot, Autofire,
  Suppressive Fire and Damage. It opens Cyberpunk RED's own load dialog (another kind of ammo,
  or unload), as the sheet's Change Ammo does.
- **Equip / Change Weapon** ends the Weapons group (it shows how many hands are free) and opens a
  small window:
  - **your hands**, and what's in each. Two to start, plus Cyberpunk RED's Number of Hands
    effects (the system's Artificial Shoulder Mount gives two more). The 2070 Item Compendium's
    Shoulder Mount has no such effect, so this module counts it as two more hands. A Dismembered
    Arm or Hand takes one away: the side Neon At Home asked for, else right first.
  - **in hand**: Free puts the weapon back to Carried; Drop puts it on the ground.
  - **Carried**: your weapons marked Carried, each with a button per free hand. A two-handed
    weapon takes the hand you pick and the next free one. With no hand free (or not enough for a
    two-handed one), nothing changes and you're told to free one first. Neon At Home's own
    checks (a lost hand, carry slots) still apply.
  - Hands come from Cyberpunk RED's Equipped state and each weapon's Hands Required; shields
    take one too. Which hand holds what is this module's own note on the item. A weapon equipped
    on the sheet takes the first free hand.
- **Dropping**: with Neon At Home on, its own drop: an Item Piles pile beside the token, the
  weapon's attachments going back on when it's picked up, the pile cleared once it's empty.
  Without Neon At Home, an Item Piles pile beside the token. Without Item Piles, the weapon stays
  on the sheet as Owned (no longer on the character) rather than being deleted. A chat card says
  which.
- **Picking up lands it Carried**: anything equippable taken out of an Item Piles pile goes onto
  the character as Carried, ready to equip. So does anything dropped earlier by this module or
  Neon At Home, however it comes back. Without Item Piles, an item dropped on a character's token
  or sheet is a pickup too. A world setting (Combat) turns it off.

## 1.20.0

**AV landings** for Neon FX (needs Sequencer; uses JB2A's smoke where it's installed):

- **AV Landing Zone** (macro): a holo warning zone you place on the ground. It is a rectangular
  amber grav field with a hazard-striped pad, a scan bar, a pulsing frame, corner brackets and
  blinking beacons, sized to the selected AV and squared on the grid. Everyone sees it, and it
  stays after a reload.
- **AV Landing** (macro): the selected AV flies in to the nearest zone, high, with its shadow
  below, then hovers and sets down in dust, and the zone powers down. A hidden AV comes in from
  the sky and is revealed.
- New quiet sounds made with ElevenLabs: zone power-up, warning beeps, engines and touchdown.
- Worlds that already have the Neon FX macro folder get the two new macros added once. A macro
  you delete stays deleted.

## 1.19.4

- A Neon Hub mook's **Punknife** gets the light blade look (it was drawn as a blunt weapon).

## 1.19.3

- **A repair asks everyone to reload.** The old entries' ids didn't just lose the gun entries:
  Automated Animations stopped loading partway on every browser that opened the world with them,
  so it never picked up attacks at all, and putting the entries back didn't start it again. After
  Install now (or the macro) repairs those entries, the GM is asked to reload: everyone, just
  themselves, or later. Each connected player gets their own prompt (it only comes from a GM). A
  normal install or update asks nothing.

## 1.19.2

- **The gun animations stay in Automated Animations.** The weapon animations went in with ids AA's
  menu won't keep (it only takes UUIDv4 ids). When AA loaded its range menu, it stopped at our
  first entry, kept only its own entries, and saved that list back the next time anything touched
  the menu. Every gun's entry was lost, and attacks played no shot and no muzzle flash: in one
  browser straight away, in another after a reload. The entries now carry UUIDv4 ids, the
  exported JSON included. A menu that's lost some of them counts as not installed, so the GM's
  prompt offers to put them all back (it says why). That was also why the silent install in
  1.18.0 and 1.19.0 "didn't take".
- **Neon Hub's grenades keep their effects.** Neon Hub now loads its grenades into a Thrown Weapon
  and names them the system's way, as in "Grenade (Sonic)". The Sonic, Arachnid and CO2 grenades
  were still looked up as "Sonic Grenade" and so on, so they hit with no save, webbing or dousing.
  Either name works now.

## 1.19.1

- **The GM is asked to install the weapon animations.** Putting Neon Arsenal's animations into
  Automated Animations silently when the world loaded didn't always take (AA could still be
  loading its menus), and attacks then played no shot and no muzzle flash. Now, a few seconds after
  the GM loads the world, a window offers to install them whenever they're missing from AA's menu
  or from an older version: Install now, Not now, or Don't ask again (the setting **Offer to
  install the animations**). The **Install Weapon Animations** macro (Macros compendium) still does
  it any time.

## 1.19.0

- **Scatter a missed blast.** A grenade, rocket or missile that misses gets a **Scatter** button on
  its card for the GM (HOUSE RULE): the template jumps to a random square in the 10×10 m/yds area
  around the aimed square (never the aimed one) and goes off there, with a line saying how far it
  went. Dragging it by hand, as the rules have it, works as before.
- **Defense: Evade or Tank**, the flow of Vec's Cyberpunk RED Evasion Workflow, built in. After a
  ranged attack, each target who can dodge bullets picks Evade (CPR's Evasion roll against the
  attack; ties to the defender) or Tank (the range DV stands); a melee attack is an opposed
  Evasion roll, rolled at once or by the target's player. Dodging bullets takes REF 8+ or chrome
  that says so: the Reflex Co-Processor, Corgo's Kerenzikov, and the Militech 'Apogee' and
  'Falcon' Sandevistan OS while switched on. No dodging a ricochet, a Hidden shooter, or blind.
  In an area, whoever dodges out leaves it: their token moves to the nearest open square outside
  the area, straight away from its centre (round walls), so the blast passes them by. "Does it hit?" now
  notes who can dodge by their chrome too.

## 1.18.0

**A movement ruler in place of Drag Ruler.**

- **Drag a token and its path shows Cyberpunk RED's movement**: within the Move Action (MOVE × 2
  m/yds, cyan), with a Run (yellow), out of reach (red), square by square, from the character's
  MOVE now. Prone, Grappled and a lost Move Action count. In combat, what they've walked this
  Turn shows faded and counts, on every client.
- **Waypoints**: Space or right-click, Backspace to take one back; the token walks them on
  release, and a wall stops a player's.
- **Foundry v13**: its own token ruler is coloured by the same bands. **Drag Ruler** (v12 only),
  while it's still running, gets the bands as its speed provider.
- Settings (Combat & Time): **Movement ruler**, **Tokens walk their waypoints**. API: `ncm.ruler`.

## 1.17.0

**Neon Arsenal: 2070 weapons at the table, with Automated Animations, sounds, areas and Rebuilds.**

- **An Automated Animations profile for every kind of weapon**: pistols to sniper rifles,
  shotguns (slugs and shells), bows, grenade, rocket and missile launchers, thrown grenades,
  flamethrowers, knives, blades, blunt weapons, monowire and fists, with Tech and Smart looks,
  Incendiary and EMP rounds, mono-edged blades and Propulsion Impact. JB2A free or Patreon (the
  better grenades and coloured bullets with Patreon). Neon Arsenal picks the entry from what the
  weapon is (kind, 2070 flavor, ammo, Melee Rebuild), so it covers Neon Hub's Item Compendium
  (2070s) whatever its guns are called. Put into AA's menu when the GM loads the world and kept
  up to date; your own entries stay. Also shipped as AA menu exports in `assets/arsenal` for a
  world without this module.
- **For the CPR fork of AA**: the ammo handed to AA the way the fork reads it, fire modes
  (Autofire bursts, Suppressive Fire), and hits and misses by the 2070 range tables.
- **Weapon sounds**, made with ElevenLabs: 24 of them, two takes each, played on each client at
  its own Neon FX volume (quiet by default, with a fade-in).
- **Diwako's muzzle flashes** for players' shots too (Diwako's only light the GM's own), blue for
  Tech guns; none for arrows, grenades and rockets.
- **Diwako's DV display shows the 2070 range tables**, and each gun's own Autofire table as its
  card names it.
- **Does it hit?** under each ranged attack card: each target's DV at their range (2070
  tables, Autofire on the gun's own table), hit or miss and by how much, Autofire's multiplier,
  and whether they can dodge (REF 8+). Diwako's own hit message, which reads the wrong Autofire
  tables and has no switch, is kept out of the chat while this is on.
- **Area attacks place their template**: 10×10 m/yds for explosives (or the ammo card's size), a
  6 m/yds cone for Shotgun Shells and flamethrowers. Everyone inside is targeted; the roll says
  if it lands (a miss is the GM's to move); the GM applies one damage roll to everyone through
  Cyberpunk RED's own damage application, with Blown back (HOUSE RULE), and the ammo's effects:
  fire, gas and EMP saves for each target's player, grappling webs, CO2, smoke that stays.
- **Weapon traits** (2070 Core Rules Ch07): Power's +5 crit Bonus Damage and a **Ricochet**
  switch (−4, can't be dodged); Smart's +1 needs a link (Neon Hub's Smart guns lose their built-in +1 without one) and the Improved Smart retry; Tech's
  **Charge** switch (Move Action; ROF1 through Thin cover, half SP; a charged slug knocks Prone).
  The switches are on the Action HUD's weapons and in the new **Weapon Rebuilds** macro.
- **Rebuilds that are always on apply on every attack**: Neon At Home 1.13 registers the Melee
  Rebuilds (Mono-edge Blading and Monoblade Rebuild ignore armor below their SP; Propulsion
  Impact pushes the target, stopping at walls) and the Ricochet Compensator. API:
  `arsenal.registerRebuild` and the `registerRebuilds` hook.
- Macros: **Weapon Rebuilds**, **Install Weapon Animations** (GM). API: `ncm.arsenal`.
- A damage roll for an area draws no Tarot card.

## 1.16.0

**Conditions that explain themselves on the character sheet.**

- **Every condition says what it does.** Its Active Effect's description has the condition's
  text, an *Automated:* line (its STAT and skill changes in words, roll-dialog toggles, damage at
  Turn start or end, reminders, waking on damage, the conditions it brings along) or *Not
  automated: play it out at the table*, and its page.
- **On the Effects tab** of a character sheet, each condition shows a line with its text and
  page under its name, so EMP, Human Shield, Suppressed and the rest that Cyberpunk RED can't
  automate still explain themselves. Setting: **Condition notes on character sheets**
  (Conditions), on by default.
- **MOVE penalties stop at 1**: Mortally Wounded, Collapsed Lung, Broken Leg and Dismembered Leg
  (with or without CPR's Critical Injury item). Quickhacks can still take MOVE to 0.
- **Tarot: Chrome Shutdown** carries its extra -4 to every Check as a roll-dialog toggle, off
  until ticked.
- **Removing a condition takes off what it brought along**: a flashbang's Damaged Eye and Ear,
  Sleep's Prone, System Reset's Unconscious and Prone, Into the Wall's Spinal Injury, Sonic
  Shock's Damaged Ear (and any Critical Injury item they added). One that another condition
  still brings, or that was there first, stays.
- **Condition Lab**: saving or resetting a condition updates the effects already on
  characters (text and icon, and the modifiers where they're the condition's own). Conditions
  with nothing automated are marked *not automated*; a floor like MOVE's shows as "MOVE minimum 1".
- API: `conditions.describe(idOrName)` and `conditions.resync(idOrName)`.
- Audited every condition against Cyberpunk RED 0.92.4's effect keys; none double-counts
  what the system applies itself (Wound State penalties, Critical Injury items, the Plot Die).

## 1.15.0

- **Macros in the Action HUD.** A new **Macros** group runs any macro the player can use, for the
  HUD's character and token (the script's `actor` and `token`).
  - Drop a macro on the HUD (from the hotbar, the Macros sidebar or a compendium) to add it.
    A compendium macro is imported first, as the hotbar does.
  - Or pick macros in **Customize** like any other action. A group of your own can mix them in.
  - The group stays out of sight until it has a macro. Layouts from before it have it hidden:
    show it in Customize.
  - Made for Neon At Home's window macros (Home, Biomonitor, Perk Tree, Spend IP...), but any
    macro works.
- **A Macros compendium.** *Neon Combat Manager: Macros*, in its own Neon Combat Manager folder,
  has one macro per window: **Holocall**, **Biomon Link**, **Night City Map**, **Plot Die** and
  **Condition Lab** (GM).
  - Holocall and the Plot Die open for the selected token's character, or your own.
  - Tip: drop the Holocall macro on the Action HUD to keep it in the Macros group.
- **The Holocall sheet button is now off by default.** Character sheet headers got crowded (the
  sheet's Close button was pushed off). Turn it back on with **Holocall button on character
  sheets** in the Comms settings.
  - Holocall stays in the Actors directory's right-click menu, the Action HUD's Utility group, the
    Biomon Link and the Night City Map.

## 1.14.0

**Weather you can see.**

- The day's Night City weather now shows on Outdoors scenes as Foundry's own scene weather.
  Presets are built from Foundry's rain, storm, snow and fog and tinted for the city: acid rain
  green, blood rain red, ash grey, dust brown, smog yellow, radioactive wind green, plus a Cold
  Snap, a Heat Wave haze and the Deadly Thunderstorm.
- The weather follows the calendar as it changes, including strange weather that starts and
  stops mid-scene. A weather you set on a scene by hand is never replaced.
- Quiet ambience on each client: rain, wind, and a Geiger counter in radioactive wind. A
  thunderstorm adds soft lightning flashes and distant thunder. It plays on the Environment
  slider, scaled by the Neon FX volume, and has its own client setting.
- **The weather reaches everyone on the scene**: every character token out in it gets the
  weather's conditions, in combat or not, unless their gear protects them. This is a setting,
  on by default. Visibility and timed hazard cards stay with the encounter.
- **Shelters**: roof tiles with Foundry's Restrict Weather and regions with a Suppress Weather
  behavior now keep characters out of the weather, as well as the visuals. A new "Shelters from
  weather" checkbox on tiles covers awnings and bus shelters drawn on the map. Keyword-named
  regions still work.
- **Scene weather modes** are clearer: Outdoors, Indoors (no weather), and Off for HUB, title
  and menu screens. An Off scene gets no weather and its own weather is never touched.

## 1.13.0

**Neon FX**: Sequencer visuals for the table (needs the Sequencer module; uses JB2A where it's
installed).

- **Conditions show on the tokens**: fire by stage, crackling electricity, glitching quickhacks
  with an upload burst, Mortally Wounded's heartbeat line, drifting z's, a netrunner's data ring,
  a Suppressed reticle, drug glows and more. The GM's client draws them through Sequencer, so
  everyone sees the same thing and they come back after a reload.
- **Sandevistan**: a switch (macro) that leaves green, magenta and cyan afterimages behind the
  token on every move, with a fringe and a slow-time hum while it's on. Every client draws the
  trail itself as the token moves.
- **Cyberpsychosis Glitch**: a switch (macro) that shakes the token itself, with an RGB split,
  scanlines and corrupted-signal bands. Unlike the first standalone macro, it never hides the
  token.
- **Quiet sound**: Neon FX volume (a client setting, 0.4 by default) and a choice of channel; the
  sounds are levelled about 20 dB below the first macros and fade in.
- **Token motion** (shake, tremble, sway, jolt) moves only the art, on each client, and each
  player can turn it off.
- A "Neon FX" macro folder (Sandevistan, Cyberpsychosis Glitch, Extreme Cyberpsychosis, Clear
  Neon FX) is added once for the GM; `api.fx` has the same.
- Art and sounds ship in `assets/fx` (sounds and some textures made with ElevenLabs; the rest
  drawn for the module).

**Extreme Cyberpsychosis** (2070 Core Rules, Chapter 09) is a new condition: the GM plays the
character, with a +2 the GM can switch on in the roll, and a reminder of the LUCK roll to retake
the Move Action or the Action. With "Extreme Cyberpsychosis follows Humanity" (on by default) it
starts when Humanity drops below 0 and ends once Humanity is positive again.

## 1.12.1

- **Stage mode hides windows too.** Other modules' floating panels (SmallTime's clock, a Token
  Action HUD) and any window open when stage mode starts now step out with the rest of the
  interface.
  - A panel without a title bar stays hidden even if it redraws itself.
  - What stays visible: the stage director, the chat popout, dialogs, file pickers, and any window
    you open during stage mode.
  - Everything comes back when stage mode ends.

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
