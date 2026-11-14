# Changelog

## 1.33.0

- **Chrome looks only on tokens I've selected.** A GM running many tokens saw every
  Sandevistan, Berserk and Kerenzikov look at once. A new setting of each user's own (off by
  default) shows running chrome's look, afterimages and motion on your screen only while you
  have that token selected. Nobody else's view changes, the one-off burst as chrome starts or
  stops still shows, and conditions and Cyberpsychosis are untouched.

## 1.32.0

- **Chrome activation cards.** As a Sandevistan, Berserk or one of their Operating Systems
  starts, a card in chat says what it costs and allows, with a button for each roll or choice.
  - *Humanity Loss each time* (Apogee, Falcon, Baldur): a button rolls 1d6 and takes it off.
    An FBC or Cyberspine carries it instead.
  - *Cooldown and starting early.* Stopping starts the cooldown (20 Rounds for an Apogee, an
    hour for the rest). Started again inside it, the card names the Humanity Loss (3, 6, 9 or
    2, 4, 6) with a button.
  - *A Solo's free Combat Awareness* under an Apogee or Professional: offered on a card after
    an Aimed Shot, Autofire or Suppressive Fire, and from the start card for Martial Arts
    Special Moves. One free reassignment each time, whoever's Turn it is.
  - *A Falcon's choice each Turn*: +2 MOVE or +4 on one Evasion Check (two new conditions).
  - *Berserk's Operating Systems*: -4 to ranged attacks while they run, unless an FBC or
    Cyberspine is installed. A Baldur gives 5 HP back as it stops.
- New setting *Chrome activation cards* (on).
- **Smart guns fire real rounds.** A Smart gun's shot was drawn with small glowing dots and a
  ring where it hit, which read as no projectile and no hit at all. With JB2A installed each
  round is now a JB2A bullet in the lock-on's colour (blue; purple for Improved Smart) down a
  guidance line, with a JB2A impact as it arrives; a miss flies past. The hit and its sound
  are placed by the bullet clip's own timing. Without JB2A the curving rounds remain.

## 1.31.3

- **An Operating System runs as itself.** An Operating System is an Item Upgrade fitted inside
  its Sandevistan or Berserk, and the chrome switch only looked at cyberware: switching an
  Apogee on from the Token HUD or Action HUD ran the bare Sandevistan. It now runs the
  Operating System's own condition (the Apogee's +6 Initiative, +2 to Aimed Shots, its three
  Rounds, its colour, its interrupt), for every Operating System of a Sandevistan or Berserk.
- **Nothing doubles up.** With an Operating System fitted, its "(active)" effect goes on and
  the bare chrome's stays off, so the Apogee's +6 isn't added to the Sandevistan's +3. Switch
  the bare chrome on by hand and the Operating System's takes over. An Operating System with
  no "(active)" effect of its own runs through the chrome's switch, with its own condition.

## 1.31.2

- **Low Light and Darkness don't wait for an encounter.** The light a character stands in was
  read only for tokens in a fight, so the condition appeared as they joined one. It now goes to
  everyone the weather reaches (every character on the scene by default), in a fight or not,
  as the weather's Obscured already did. Weather hazard cards (damage by the Round) stay with
  the encounter.

## 1.31.1

- **A Sandevistan switched on and off no longer piles up Initiative, and goes off when it's
  switched off.** Chrome with an Operating System has two switches, and each was handled as it
  arrived: at the table (where every write takes a trip to the server) the running condition
  could be placed twice, or put straight back as it was coming off. That left the token's
  Sandevistan look on after switching an Apogee off, and added its Initiative bonus again on
  each go. Now a character's chrome is handled one step at a time, its switches open and close
  together, a doubled condition is cleared, and the bonus is kept on record on the combatant:
  on adds it once, off takes back what was added.

## 1.31.0

- **The Apogee interrupt.** When an Apogee is switched on during someone else's Turn and its
  Initiative lands ahead of theirs, or it was switched on from a Held Action, the table is told:
  **INTERRUPT** across every screen with who cuts in on whom, a card in chat, and a gold ring
  on the interrupter's carousel entry.
- **Time stands still.** Until the next Turn begins, every screen that isn't in Sandevistan
  time shows the world stopped (drained and held); the Apogee's player keeps their own view.
  It ends on the next Turn, when the Sandevistan goes off, or with the combat, and follows each
  player's *Chrome on my screen* setting.
- **The Turn goes with it.** The Turn passes to the interrupter at once and, when they end it,
  back to whoever was cut into, in the same Round. Neither move counts as a Turn starting or
  ending, so start- and end-of-Turn conditions don't fire twice. New setting *An Apogee
  interrupt takes the Turn* (on) to only announce instead.

## 1.30.2

- **Smart Weapon says only what it does.** The Smart Weapon condition's description no longer
  mentions visual obscurement: that belongs to Improved Smart Loaded alone, which is on only
  while Improved Smart rounds are in a Smart gun in hand.
- **Rain gets in the way outside a fight too.** The weather's sight penalty (Heavy Rain -2,
  Inversion Smog -4...) used to be placed only on tokens in the active encounter, so a character
  standing in Heavy Rain out of combat had the rain's condition but no Obscured. Everyone the
  weather reaches now carries Obscured at the weather's penalty, in an encounter or not. Light
  and darkness are still read for the encounter only.
- **Light and weather show separately.** Poor light and weather used to be folded into one
  condition, so rain in low light read as a single *Obscured (-3)* with no Low Light in sight.
  A character now carries each for what it is: **Low Light (-1)** or **Darkness (-4)** from the
  light, and **Obscured (-2)** from the weather, side by side.
- **No cap on sight penalties.** Darkness and weather used to add up to -4 at most (a house
  rule); they now add in full, so rain in the dark is -6. The setting *Most a sight penalty can
  be* is gone.
- When obscurement penalties come off a roll, the attack card now names the round that was
  loaded, so it's plain which ammo did it.

## 1.30.1

- **Targeting a Tech scope's outline works.** The click on an outline was reaching Foundry as a
  click on empty canvas, which let go of the shooter and of every target, so the outline could
  never be targeted for a Charged Shot. The click and the Target key are now caught at the
  token layer itself: a click on an outline (anywhere in its square) targets it, Shift-click
  adds it, and the shooter stays selected.

## 1.30.0

**Weapons' own rules, third part: weapons that remember the fight.** 217 of the catalog's 466
weapons now have at least one rule applied.

- **Last Round.** A weapon keeps, for the combat it's in, the Round it last fired, Autofired,
  rolled an Aimed Shot's damage and caused a Critical Injury. A card that says *If it Autofired
  last Round...*, *ROF2 if it fired last Round* or *If it caused a Critical Injury last Round...*
  gets that sentence on the roll's card when it applies; *Excellent Quality this Round* is +1 on
  the attack and *its next one deals +5 Bonus Damage* is on the damage roll.
- **The first roll.** *Its first damage roll each fight counts 5s as 6s* and *Its first attack
  each Round...* call the Critical Injury on that roll only.
- **Autofire streaks.** *Autofire it more than twice in a row and it's Destroyed Beyond Repair*
  warns on the second and says so on the third.
- **A wounded wielder.** Rules for *Seriously or Mortally Wounded* (more or fewer Aimed Shot
  dice, +1 to hit) follow the shooter's Wound State.
- **One-off rules as reminders.** What belongs to a single Iconic and can't be run is brought
  up when it matters, in the card's own words: on the Autofire attack (*On Autofire, ...*), on
  the damage card (*Against a target ...*, *A kill ...*), or when the dice make a Critical
  Injury (*Each Critical Injury ...*, *A Head Critical Injury ...*). 29 weapons have one.
- **A weapon's own table.** Murphy's Law's *Each Critical Injury also rolls 1d6* is a button
  on the damage card that rolls it and posts the result.
- **Nehan and Satori** count each other's Critical Injuries.
- **The R.N.Geezus! Blind Box.** Every Attack rolls the Compendium's 1d100 table by itself and
  posts the round, with Malfunctions for Junk Ammo, Combo Casings, GACHA! on a Critical Success
  and the misfire on a Critical Failure.
- **Chaos** rerolls its capacity, damage and ablation on every reload. **Gris Gris** has a
  button for its NET-linked round's quickhack DV.
- **Magazines of several ammo types.** A *Next round* button on the Action HUD picks the kind
  the next shot fires, and the stacks are kept right.
- Reminders only, not run: dice rerolled, rules tied to a kill or to one particular target,
  escalating Autofire ratings, multi-target Autofire, areas set off by a Critical Injury or a
  kill.

## 1.29.0

**Weapons' own rules, second part.** More of the lines a weapon's card carries are read and
applied; 205 of the catalog's 466 weapons now have at least one.

- **What it does to its targets.** *Sets what it damages Strongly On Fire* and *must beat DV15
  Athletics or go Prone* put a button on the damage card that places the condition on the
  targets the roll was made against.
- **What it asks of its shooter.** *BODY 11+ unless mounted* (with its Prone and cyberarm
  variants) warns on the attack card when the shooter is short. *Without BODY 8+ or a cyberarm,
  firing gives you Torn Muscle* (and the Autofire *Broken Arm*) puts the injury on the shooter as
  the shot is fired.
- **Ammo and reloading.** A warning when a weapon that takes only Improved Smart, Armor-Piercing
  or Expansive ammo has something else loaded, and when a capacity attachment is fitted to one
  that takes none. A weapon's reload rule is said as it's reloaded from the Action HUD.
- **Rounds that carry through cover** are treated as an explosive's by *Hit the cover*.
- **Weapon Strain.** A weapon whose card gives penalties *while held* without the BODY or
  paired cyberarms puts a new condition on whoever holds it, with those penalties, until it's
  stowed. A card's floor (*−2 MOVE while held (min 4)*) is kept.
- **A gun's own rounds.** Where a gun loads only its own rounds, what the card says of them
  (Armor-Piercing, extra SP ablated, On Fire, damage past cover) is applied as the gun's rule.
- **Checks worded for one weapon** go on the damage card in the card's own words, with a button
  where the result is Prone, Damaged Ear or Unconscious. A weapon whose explosives *burst in a
  6×6m area* gets a template that size.
- Not automated: magazines and barrels of several ammo types, what a failed check does where it
  isn't one of those conditions, and areas set off by a Critical Injury or a kill.

## 1.28.0

**From the first playtest.**

- **Cover pieces are barriers.** A cover piece was only a token, so people walked through it.
  Each piece now has walls of its own, kept by the GM's client: its outline stops movement, and a
  tall piece (a wall section, a fence, a partition) also blocks sight and light, Thin ones still
  showing outlines to a Tech scope. They move, turn and go with the token; a destroyed piece opens
  until it's repaired. Pieces already on a map get theirs when the GM opens the scene. New setting
  *Cover pieces are barriers*.
- **Target a Tech scope's outline.** The outline of someone behind thin cover can now be
  targeted for a Charged Shot: click it (Shift adds), hover it and press the Target key, or press
  *Target through cover* on the Tech gun's Action HUD entry (nearest first, then the next). Cyan
  brackets mark the target, since Foundry draws none on a token out of sight.
- **Tactile Boost** (p.359). A new **Feeling for Motion** condition for the hand on a surface
  (Token HUD, and the Action HUD's Status group when the chipware is installed). While that
  character is selected, their player sees an amber ripple where anyone out of sight moves within
  20 m/yds, through any wall, and a faint ring showing the reach. It marks where motion was last
  felt, not who it is. New setting *Tactile Boost ripples*.
- **Improved Smart Ammunition, where you can see it.** The obscurement penalties used to come off
  after the roll dialog, so the dialog still showed Obscured −4 and a total that was wrong until
  the dice. They now come off before it opens (listed unticked), and a new condition, **Improved
  Smart Loaded**, sits on the character while the rounds are in a Smart gun in hand.
- **Smart's +1 by name.** The +1 is on the roll before its dialog as *Smart weapon +1* (taken out
  of the gun's own attack modifier on Neon Hub's Smart guns, so it's never counted twice), and on
  the attack card. No link: no +1, and the card says so.
- **Cyberware upgrades and Borgware** land in the sibling modules: **Neon Hub 1.25.0** ships
  every piece of 2070 chrome open to Operating Systems and Enhancements and fixes the copies
  already in a world once; **Neon At Home 1.14.0** counts a piece as Borgware for Maximum
  Humanity (−4 in place of −2) while an Operating System or Enhancement that says so is in it.
- **Weapons' own rules, first part.** The lines the Item Compendium words the same way on every
  weapon that has them are read from the weapon's card and applied: 3-round (and 2-round) bursts
  named on the attack card, with the short-magazine damage on the next damage roll; *Aimed Shots
  deal +1d6*; *Ablates N extra SP*; *5s count as 6s for Critical Injuries*, called out on the
  damage card; *−2 to every attack* as a named modifier before the dialog; *No Aimed Shots* and
  *can't ricochet* on the Action HUD. Also: *Critical Injuries deal +N Bonus Damage*; rounds
  that *count as Armor-Piercing*; *+1 to hit on its first Single Shot of a fight*; a **Two
  hands** switch for *Excellent Quality two-handed* and *Two-handed: +1...*; Autofire-only guns
  and guns that only Autofire while charged; charged shots that stop at cover; Tech scopes that
  read one layer of Thick cover; Critical Injury rules on a head Aimed Shot or within a range;
  dice that drop the lowest; what a weapon's Tech charge costs, on the charge card; Aimed Shots
  that are harder to dodge. 144 weapons in the catalog have at least one; weapons already on
  sheets count. The rounds themselves are spent by Neon Hub 1.25.0. Rules tied to a wound state
  or to an earlier Round, two-mode weapons, effects on targets, recoil and the Iconics' one-off
  rules are not automated yet.
- **Chrome switches.** A *Chrome* group on the Action HUD and a chip button on the Token HUD
  list the chrome a character can switch on and off, lit while it runs: Sandevistan and Berserk
  (by their Operating System), Tactile Boost, Optical Camo, Microrotors, the KERS mask (three new
  Chrome running conditions), and any piece whose item has an "(active)" effect. Each one puts
  its Active Effect on the character and takes it off.
- **A Kerenzikov is always on.** Installed, it puts the new **Kerenzikov** condition on the
  character: the token's faint look, +2 to notice an Ambush as a tick box, and the Boost
  System's +2 Initiative when that's fitted.
- **Chrome on your own screen.** While your character's Sandevistan or Berserk runs, your screen
  alone shows it, in the Operating System's colour; a Kerenzikov cools the picture slightly all
  the time. A GM sees it for an NPC while that NPC's token is selected. A layer over the map
  that takes no clicks and hides nothing. New per-player setting
  *Chrome on my screen*; new world setting *Chrome switches on the Token HUD*.

## 1.27.0

**The Alert.** The Awareness Ladder (2070 Core Rules, Chapter 06) comes out onto the map.

- **Awareness on the tokens.** An encounter's enemies carry the Ladder's step as a condition
  (new **Awareness** category: Suspicious, Searching, Alert, Spotted), placed and removed as the
  GM moves the Ladder. By default only Alert and Spotted show; below that the GM alone gets a
  **?** over each enemy. A setting shows every step to everyone, or none.
- **Reaching Alert.** A **!** over each enemy, **ALERT** across everyone's screen, and one quiet
  sting.
- **A countdown to the security response**, Metal Gear style: a timer for everyone that runs on
  the game clock (20 Rounds by default, 3 seconds a Round). The GM can wave it away.
- **An Alert is kept until something is done about it.** Every enemy dead or out before the
  response is called: the alarm never goes out, and the Ladder drops to Unaware. At zero the
  response is called, the GM gets a card, and the enemies stay at Alert.
- Three quiet sounds made with ElevenLabs: the alert sting, the response being called, and the
  all-clear.
- Settings: Awareness on the tokens, Rounds until the response is called, whether an Alert
  clears, and each player's own switch for the banner and timer.

## 1.26.0

**Quickhacking, and chrome that runs.**

- **Quickhacking on the Action HUD** (2070 Core Rules, Chapter 10). The Netrunning group gets
  **Jack In**, **Ghost Jack In**, **Breach**, a button for each quickhack slotted in the deck (Neon
  At Home's Programs) and **Jack Out**; someone being hacked gets **Eject**, on their Action HUD
  and on the card. Each rolls by the rules and posts a card:
  - Jack In is Interface against WILL (the firewall first at Interface 1-2); a loss tells them.
  - Breach is DV6, 8 or 10 by the port's Self-ICE, one Passwall each.
  - A quickhack rolls against its DV, once per target per Turn, and its Cooldown starts hit or
    miss. A hit places its Neon Condition, or rolls Synapse Burnout's, Contagion's and Total
    System Kill's damage straight to HP (4 less against Self-ICE: Defender).
  - A Ghost run is whispered to the GM and the Netrunner's players. Quiet quickhacks keep it; a
    failed Breach rattles the port; anything else breaks it.
  - Range, line of sight, NET Actions, a quickhack's Needs and vehicles stay with the table.
- **Quickhack animations** (Sequencer; JB2A's free pack, with the module's own art without it):
  - a pulse and a data ring as you Jack In, and a faint link between the tokens while you're in;
  - Self-ICE flaring and throwing the pulse back, or shattering;
  - the upload running up the link and landing by its family (a scan, a shimmer, static, a red
    hit, an overload), or fizzling on a miss;
  - a red alert on the target and a trace back to the Netrunner when they're found out;
  - the link tearing on an Eject, and running home on a Jack Out;
  - a quickhack's condition ending, however it ends: a ring opens and a green pulse runs out.
  - A Ghost's link and uploads are dim, and play for the GM and the Netrunner's players only
    (setting: everyone, or no one) until the Ghost breaks.
  - Timed from JB2A's clips, measured as the weapon animations were. Automated Animations isn't
    used: it plays on attack rolls, and a quickhack isn't one.
- **Chrome running.** A Sandevistan, Berserk and their nine Operating Systems are now conditions
  (a new **Chrome running** category): an Active Effect with the rule's Initiative, Aimed Shot and
  REF bonuses, its Rounds, and a status icon.
  - The **Sandevistan** macro now runs the condition (new worlds; a macro already in your folder
    keeps flipping the look alone), and there are **Berserk** and **Speedware (Kerenzikov)** macros.
  - The token shows it: a burst as it kicks in, Berserk's red pulse and shakes or the
    Sandevistan's trail while it runs, each Operating System in its own colour, a ring as it stops.
  - Initiative in a fight under way moves with it.
  - Neon Hub's "(active)" effects on a Sandevistan and Apogee switch the condition, and the other
    way round, with nothing counted twice.
- **Eight quiet quickhack sounds** made with ElevenLabs, two takes each, at each player's Neon FX
  volume: Jack In, Jack Out, Eject, Self-ICE holding, Self-ICE breaking, the alert, a system
  coming back up, and a Ghost's whisper (quieter still). Berserk surges as it kicks in and winds down as it stops,
  and speedware (the Kerenzikov look) has a quick rush of its own.

## 1.25.2

**Animations in step.** Every weapon's shot, hit and sound was checked against JB2A's own clips,
frame by frame, and placed by what the clip shows.

- **The hit lands when the round does.** Automated Animations played a weapon's hit effect at the
  same moment as its projectile, so a Tech bolt showed its impact first. A round's flight also
  depends on the distance: a bullet crosses 3 squares in under a tenth of a second and 15 in three
  quarters. Neon Arsenal now draws the hit itself at the moment the round arrives, for each target.
  - A shot shown missing (Suppressive Fire, a miss with AA's misses on) hits nothing.
  - An Incendiary hit burns for a moment, not for its whole five-second loop.
- **Sounds follow the picture.**
  - The shot sounds as the round leaves: a bow's string at the release (the arrow is nocked and
    drawn first), a thrown blade at the throw.
  - The impact sounds as the round arrives, by distance.
  - A melee weapon sounds as its swing connects (about a second in, later for a heavy blade), and a
    Propulsion Impact shows then.
  - A ricochet whines at the bounce and hits when the second leg ends; a Smart gun fires after its
    lock, and its hit sounds when the rounds curve in.
- **One clock.** Sounds and hits wait for Automated Animations' first frame, so a clip that takes
  a moment to load no longer leaves them running ahead.
- **Blasts.** The explosion, its sound and the screen shake all come when the grenade or launcher
  round lands. The sound used to come at a fixed 0.45 s, well before a thrown grenade arrived.
- A charged Tech shot's ripples through thin cover follow the bolt.
- The GM is offered the updated animations on the next load (**Install**), as after any update.

## 1.25.1

- **Window close buttons show their icon again.** The module's button style gave the header's close
  (and controls) button its display font, so Foundry showed a missing-glyph box instead of the ×.
  Every Neon Combat Manager window had it; the Plot Die is where it was spotted.
- **The Plot Die's six faces are all the same size.** The 6 came out taller than the others; each
  face's box is now fixed so no outside rule can stretch one.
- **Double Down in the roll dialog.** Roll the Plot Die from Cyberpunk RED's roll dialog and a
  **Double Down** button now sits beside the result (LUCK 7+, once a session). The reroll's bonus
  replaces the one on the roll, and its cost (2 LUCK on a Complication, or two Complications) applies
  as on the card. The result card from the dialog no longer offers its own Double Down, which used
  to leave the dialog holding the old bonus.
- **Spend Double Down and Force Fate from the Plot Die window.** Their lines become buttons when the
  character can use them: Double Down once a Plot Die result rolled from chat is waiting, Force Fate
  once the GM has Raised the Stakes for them. Otherwise the line says what it's waiting for.

## 1.25.0

**Your ride as cover** (HOUSE RULE, 2070 Core Rules Ch07), done in full:

- **Every vehicle is cover.** That's MMuton's vehicle sheet actors, and Neon Hub's 2070s vehicles and ACPAs.
- **Behind a ride:** its SP and SDP. Cyberpunk RED's own vehicle damage applies: SP first, and it
  ablates, then SDP. The area window's numbers take the SP into account, and a rocket's double
  counts on what gets past the SP (Bunker Buster). A wrecked ride lets a blast through.
- **Inside a ride:** the ride isn't your cover. Your seat's Bulletproof Glass is (15 HP Thin, or 30 HP
  Thick on MMuton's sheet), and plain windows are no cover at all. Damage to the glass goes on that
  seat's glass HP. A charged Tech shot goes through Thin glass.
- Someone firing out of a ride isn't behind it.

## 1.24.0

**Cover** (2070 Core Rules, Ch07): the Cover HP table on the map.

- **Walls as cover.** A wall's settings take a material and a thickness (Plaster, Wood, Concrete,
  Bulletproof glass, Stone, Steel; Thin or Thick), with the book's HP for each 2×2 m/yds section.
  The GM's *Tag walls as cover* button tags the selected walls, or every untagged wall in the
  scene, at once. Doors count as Wood (Thin) unless you say otherwise.
- **Destroyed sections open.** At 0 HP a wall section stops blocking movement and sight: tokens
  walk and see through the gap until the GM clicks *Repair cover*. The GM sees damaged sections'
  HP on the map.
- **Cover pieces.** A new *Cover* compendium with twenty pieces, each with its own top-down
  token. One for each material and thickness: Office Partition, Sofa, Overturned Table, Bar
  Counter, Low Brick Wall, Dataterm, Teller Glass, Armored Glass Barrier, Statue, Boulder, Car Door
  and Engine Block. And wall sections for the rest: Interior Wall, Wooden Fence, Timber Wall,
  Concrete Barrier, Low Stone Wall, Fieldstone Wall, Corrugated Fence and Blast Wall. Rides count as
  cover with their SP and SDP. Moving Thick cover without BODY 10+
  brings a reminder.
- **Shots:** *Does it hit?* says when a target is behind cover, and the damage card's GM button
  *Hit the cover* puts the damage on it (at 0 it soaks that shot). Cover the shooter leans out from
  doesn't count; a charged Tech shot goes through Thin cover.
- **Areas:** the apply window lists the cover that takes the blast or the spread, and unticks
  whoever it shields. An explosive that destroys cover hits whoever's behind it; rockets do double
  to cover.
- Thin cover of any material counts for Tech scopes. `api.cover` for macros.

## 1.23.1

- **Neon Hub's Range Table Modifications** (Neon Hub 1.23.0: Snub Barrel, Choke, Long Tube and
  the rest) change a gun's own range table, and Neon Arsenal reads that table: the DV display,
  Does it hit?, the AA look and the areas follow the swap. Autofire stays on the gun's type's
  Autofire table, as the rule says.
- **Neon Hub's Autofire attachments** (Pistol Autosear, SMG Cyclic Internals, Constant Recoil
  System and the rest) set the gun's Autofire rating and Suppressive Fire, which the Action HUD's
  Autofire and Suppressive buttons and Does it hit?'s multiplier cap already read, and name its new
  Autofire table on the gun, which the DV display and Does it hit? now read first: a Constant
  Recoil rifle autofires on the Machine Gun table.
- **The Shotgun Automatic Control Group's shell attack** (Neon Hub 1.23.0): with shells loaded, an
  Autofire attack from a shotgun with the control group is the shell attack the rule describes.
  The spread is placed as usual, the damage roll is the shells' damage with no Autofire multiplier,
  and everyone in the spread who can dodge bullets gets Evade at −3 (the prompt and the spread's card
  say why). How many rounds a burst spends is Neon Hub's.
- **Fixed: a rocket launcher with a Long Tube looked like a missile launcher.** Its look comes from
  the table it was made with, not the one the tube moved it to.

## 1.23.0

**What the 2070 gun flavors look like** (Neon Arsenal, with Sequencer):

- **Weapon conditions:** *Power Weapon*, *Smart Weapon* and *Tech Weapon* follow the gun in hand.
  Equip one and its condition goes on; stow it and it comes off. They carry no numbers (the
  weapon traits add those on the roll). On the token they show as a faint orange haze, a pink
  reticle or a blue data ring.
- **Tech scope:** the player of a selected Tech shooter sees glowing outlines of anyone behind thin
  cover. Walls get a new *Thin cover* box in their settings, and closed doors count too (a setting).
- **Ricochet:** the shot bounces off the nearest wall that gets it round to the target, with
  sparks and the path left hanging for a moment.
- **Smart rounds:** a lock-on reticle, then rounds that curve in to the target. Improved Smart
  rounds are magenta, steer harder and paint the shooter with a data ring.
- **Improved Smart retry:** the shooter is asked straight away on a miss by 5 or less. The retry
  now keeps the first shot's penalties and can add LUCK (the rule's "+ LUCK"), and its round
  loops back round from past the target.
- **Improved Smart ignores obscurement** (the rule): penalties from Low Light, Darkness,
  Obscured, smoke, pop-ups and weather's sight come off Improved Smart attacks.
- **Following a ricochet:** a target with speedware that's on, or low-light, IR or UV optics in the
  dark, can Evade a ricochet at −4 instead of not at all (a setting).
- **Charged Tech shots** punch a ripple through each piece of thin cover they cross. The Weapon
  Rebuilds macro can target whoever the Tech scope shows behind cover.
- **Power Critical Injuries** hit with a shockwave. **Propulsion Impact** pushes leave a streak.
  A **Smartgun Link** on a Power or Tech gun gets the lock-on reticle. **Mono-edge Weapon** is a
  fourth weapon condition, with a faint cyan edge glow.
- New quiet sounds made with ElevenLabs: lock-on, homing rounds, re-acquire.

## 1.22.0

**Stealth segments.** Begin no longer puts the enemies at Alert: the carousel runs sneaking Turn
by Turn too.

- **Sneak or Start.** Before a combat begins, the GM's carousel has two buttons.
  - **Start** is full combat, as before.
  - **Sneak** begins a stealth segment: the carousel turns violet, with a **STEALTH** chip by the
    Round. Players see the chip too.
- **In a stealth segment, everything runs as in a fight:**
  - the Initiative order, Turns and Rounds;
  - each Round moving world time 3 seconds;
  - timed conditions, Turn automation and Death Saves;
  - Combat Awareness costing the Solo's Action.
- **What waits:** the Awareness Ladder. It stays where the GM puts it.
- **Spotted?** Click the chip: full combat, with the same queue, Round and Turn. Everyone gets a
  card. The Ladder goes up to Alert if it was lower. Click again to go back to stealth.
- **The Ladder rises once per stretch of full combat.** Before, every new Round put the Ladder
  back to Alert. Now full combat raises it once, so the GM can lower it mid-fight and the next
  Round won't undo that.
- **Action HUD:** in a stealth segment, the character's Stealth roll joins the Turn group.
- **New settings:**
  - **Begin a combat as** (Combat): the mode for a combat begun from Foundry's own tracker or a
    macro, and which carousel button is the main one.
  - **Full combat puts the enemies at Alert** (on): turn it off to keep fights away from the
    Ladder entirely.
- The end-of-combat card reads *Stealth segment over* for a stealth segment.
- **API:** `api.encounter` (`mode`, `isStealth`, `begin`, `setMode`, `toggle`) and the hook
  `cpr-neon-combat-manager.encounterMode`.

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
- **Bare Hands**, next to Equip / Change Weapon (with the Brawling base): a Brawling attack with
  Cyberpunk RED's own Unarmed weapon. The character's Unarmed item is used if they have one (in
  hand, Carried or Owned); otherwise one is put in their inventory from the system's Core Weapons
  compendium. It goes into a free hand and its Attack rolls. With no hand free, Unarmed stays
  Carried and the player is told to free one. In hand, it's a weapon row like any other.
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
