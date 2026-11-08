/**
 * Junk mail for the 2070s, for Night City Messenger's spam (its own is set in 2045: the red sky,
 * the crater, the Reconstruction). Night City is a free city again after the Unification War,
 * Arasaka is back, braindance is everywhere and Trauma Team never stopped selling. Pure data, in
 * Night City Messenger's template shape; tokens: {{playerName}}, {{networkName}}, {{currentDate}},
 * {{randomCorpo}}, {{randomDistrict}}.
 */

const t = (category, n, fromName, fromEmail, subject, body) => ({ id: `ncm2070-${category}-${String(n).padStart(2, "0")}`, category, fromName, fromEmail, subject, body });

/** For {{randomCorpo}}. */
export const CORPS_2070 = [
  "Arasaka", "Militech", "Kang Tao", "Biotechnica", "Petrochem", "Zetatech", "Kiroshi", "Night Corp",
  "Trauma Team", "Ziggurat", "Network 54", "Orbital Air", "Kendachi", "Budget Arms", "Dynalar",
  "Rocklin Augmentics", "Danger Gal", "Continental Brands", "SovOil", "Zhirafa", "Tsunami Arms", "Midnight Arms"
];

/** For {{randomDistrict}}: the city's districts in the 2070s. */
export const DISTRICTS_2070 = [
  "Watson", "Kabuki", "Little China", "Northside", "Westbrook", "Japantown", "Charter Hill", "North Oak",
  "City Center", "Corpo Plaza", "Downtown", "Heywood", "The Glen", "Vista del Rey", "Wellsprings",
  "Santo Domingo", "Arroyo", "Rancho Coronado", "Pacifica", "Coastview", "the Badlands"
];

export const SPAM_2070 = [
  /* Corpo ads */
  t("corpo", 1, "Trauma Team International", "plans@traumateam.nc", "Your Platinum Upgrade Is One Blink Away",
    "{{playerName}},\n\nOur AVs answered 3,912 calls in {{randomDistrict}} last month. Average time from flatline to rooftop: 4 minutes 10 seconds.\n\nSilver: priority response, ground and air\nGold: armed escort, full trauma suite\nPlatinum: response in under three minutes, anywhere, against anything\n\nUpgrade from your agent with one blink and keep your card on you. Cards found on bodies are honoured. Cards found on looters are not.\n\nTrauma Team — We Come For You.\n\n*Coverage does not extend to non-subscribers in the line of fire. Collateral damage is billed to the client."),
  t("corpo", 2, "Kiroshi Optics", "upgrade@kiroshi.jp", "See Night City The Way It Sees You",
    "Still running factory eyes, {{playerName}}?\n\nThe new Kiroshi line ships with zoom you can read a vending machine with from across {{randomDistrict}}, threat tagging, and an ad filter that blocks up to 60% of street holos (premium tier: 85%).\n\nTrade in your old optics at any partner ripperdoc and take 1,000 eb off.\n\nKiroshi — Look Closer.\n\n*Ad filter does not apply to Kiroshi partner advertising."),
  t("corpo", 3, "Arasaka Night City", "careers@arasaka.co.jp", "Arasaka Is Home Again. Are You Ready To Serve?",
    "The Tower is back on the skyline, and Arasaka is hiring in Night City.\n\nSecurity, logistics, research, facilities. Full medical, company housing in Corpo Plaza for qualifying grades, and loyalty implants at no cost to you.\n\nApply through your agent. A recruiter will reach you, wherever you are.\n\nArasaka — Tradition. Security. Tomorrow.\n\n*Past employment with Militech is not disqualifying. It is noted."),
  t("corpo", 4, "Militech Civilian Division", "home@militech.com", "Home Defence The Way The Army Does It",
    "{{playerName}}, the war is over. The neighbourhood isn't.\n\nMilitech's Civilian Defence packages bring battlefield-proven hardware to your door: smart locks, auto-turrets licensed for residential use, and a 24-hour response line staffed by veterans.\n\nNew this season: the Sentinel door turret, now with a polite warning mode.\n\nMilitech — Peace Through Superior Firepower.\n\n*Turret licensing varies by district. Not available in Corpo Plaza."),
  t("corpo", 5, "Petrochem Fuel Club", "club@petrochem.com", "CHOOH2 Points Double This Week",
    "Double points at every Petrochem pump, {{playerName}}.\n\nFill up in {{randomDistrict}}, tap your agent at the pump and watch the points stack: free car washes, discounted tolls on the Badlands highway, and entries into our monthly draw for a brand new Quadra.\n\nPetrochem — Keeping Night City Moving.\n\n*Points void if the station is closed for a firefight. Draw open to Free City residents only."),
  t("corpo", 6, "Biotechnica Fresh", "fresh@biotechnica.com", "Real Food Taste. Grown In A Vat Near You.",
    "Tired of kibble, {{playerName}}?\n\nBiotechnica Fresh brings you vat-grown proteins and greens that taste almost exactly like the real thing. Delivered weekly to your door in {{randomDistrict}}.\n\nTry the Starter Box: four meals, one dessert, zero mystery.\n\nBiotechnica — Life, Improved.\n\n*\"Almost exactly\" independently verified by a Biotechnica-funded panel."),

  /* Scams */
  t("scam", 1, "Free City Treasury Office", "refunds@freecity-nc.gov.net", "Unification Tax Refund Waiting For You",
    "Dear {{playerName}},\n\nUnder the Treaty of Unification, Night City residents overcharged during the war years are owed a refund. Our records show 4,380 eb waiting in your name.\n\nTo release it, reply with your agent passcode and bank routing, plus a 150 eb processing fee to cover the Free City's paperwork.\n\nRef: FCT-{{currentDate}}-REF\n\n*The Free City Treasury has never once contacted anyone about a refund."),
  t("scam", 2, "NetWatch Security Notice", "alerts@netwatch-secure.co", "URGENT: Your Agent Has Touched The Blackwall",
    "{{playerName}},\n\nOur monitors caught your agent pinging past the Blackwall at 03:12 last night. This is a serious violation.\n\nTo avoid a NetWatch field visit, install the attached Compliance Patch within 24 hours. Your agent will restart and everything will be fine.\n\nNetWatch — Protecting The Net.\n\n*NetWatch does not send patches. NetWatch does not ask. NetWatch arrives."),
  t("scam", 3, "Afterlife Booking", "vip@afterlife-bookings.net", "You're On The Afterlife VIP List",
    "Congrats, {{playerName}}!\n\nA fixer vouched for you. You're on this month's Afterlife VIP list: a booth, a named drink, and a sit-down with the people who matter.\n\nSecure your spot with a 500 eb deposit to the account below. Places go fast.\n\n*The Afterlife does not have a VIP list. Ask anyone. Carefully."),
  t("scam", 4, "Arasaka Estate Services", "inheritance@arasaka-legacy.org", "Your Distant Relative Left You Arasaka Stock",
    "Dear {{playerName}},\n\nA distant relative of yours, a mid-level Arasaka manager, has passed away without heirs. Their 2,000 shares in Arasaka Corporation now pass to you.\n\nTo transfer them, please send a copy of your ID, your agent passcode and a 900 eb transfer fee.\n\nWith deepest sympathy,\nEstate Services (no relation to Arasaka Corporation)"),
  t("scam", 5, "Your Cousin", "itsme.cousin@citinet.nc", "lost my agent, can you send eb",
    "hey {{playerName}} its me, new agent, long story\n\ngot jumped in {{randomDistrict}}, they took everything. need 300 eb for a ripper to stitch me up and a cab home. send it to this account and ill pay you back tuesday\n\ndont call the old number, its with the gang now\n\nlove u"),
  t("scam", 6, "Kang Tao Lottery", "winners@kangtao-draw.cn", "You Won A Kang Tao Smart Pistol!",
    "WINNER! WINNER!\n\n{{playerName}}, your agent number was drawn in the Kang Tao Free City Celebration Draw. You've won a brand new smart pistol with a lifetime ammo voucher!\n\nShipping and import licence: 450 eb. Reply within 48 hours to claim.\n\n*Kang Tao doesn't run lotteries. It runs Night City's south side."),

  /* Ripperdocs */
  t("ripperdoc", 1, "Doc Okafor's Clinic", "appointments@okafor-clinic.nc", "Sandevistan Fitting: Walk-Ins Welcome",
    "Want to move like the legends do, {{playerName}}?\n\nDoc Okafor fits Sandevistans in the back of a pharmacy in {{randomDistrict}}. Clean room, real anaesthetic, and a cooling regimen so you don't fry your own nerves.\n\nFitting, tuning and a 30-day follow-up, all in.\n\n*Doc Okafor is not responsible for what you do at speed."),
  t("ripperdoc", 2, "Free City Health Advisory", "advisory@nc-health.nc", "Know The Signs Of Cyberpsychosis",
    "A public message for {{playerName}}.\n\nThe Free City Health Board reminds every chromed citizen: cyberpsychosis is treatable when caught early. Warning signs include losing time, anger at the people closest to you, and feeling more machine than human.\n\nFree therapy sessions run weekly in {{randomDistrict}}. Ask a friend to come with you.\n\n*If you see someone in crisis, keep your distance and call MAX-TAC. Do not intervene."),
  t("ripperdoc", 3, "Chrome Kings", "deals@chromekings.nc", "Arms, Legs, Optics: Everything Must Go",
    "{{playerName}}, we're clearing the shelves!\n\nGorilla Arms, Mantis Blades, a Projectile Launch System with barely any history. All sourced honestly*.\n\nBring this message to our {{randomDistrict}} shop for 15% off any limb.\n\n*\"Honestly\" means we didn't ask."),
  t("ripperdoc", 4, "Raven Microcybernetics", "care@ravenmicro.com", "Your Neural Link Warranty Expires Soon",
    "Hello {{playerName}},\n\nOur records show the warranty on your neural link runs out this month. Extend it now and get a free diagnostic at any licensed clinic.\n\nUnlicensed upgrades may void your warranty. Unlicensed downgrades may void you.\n\nRaven Microcybernetics — Connected For Life."),
  t("ripperdoc", 5, "Street Medicine Collective", "help@streetmed.nc", "Free Clinic Night In {{randomDistrict}}",
    "No insurance? No problem, {{playerName}}.\n\nThe Street Medicine Collective runs a free clinic every Thursday. Wound care, implant checks, antibiotics, and no questions about where the bullet came from.\n\nDonations keep the lights on. Bring painkillers if you can spare them."),
  t("ripperdoc", 6, "Dynalar Technologies", "fit@dynalar.com", "Cyberlimb Recall: Is Yours On The List?",
    "Important, {{playerName}}.\n\nA batch of cyberarms sold through unlicensed resellers in the Free City may lock their grip without warning. If your arm's serial starts with DX-7, book a free check at an approved clinic today.\n\nDynalar apologises for any crushed property, hands or coffee cups.\n\nDynalar — Precision Without Compromise."),

  /* Braindance */
  t("braindance", 1, "Ziggurat BD Network", "subscribe@ziggurat.bd", "Feel Everything. Ziggurat BD Unlimited.",
    "{{playerName}}, why live one life?\n\nZiggurat BD Unlimited streams thousands of braindances straight to your wreath: a Corpo Plaza penthouse, a Badlands race, a rooftop first kiss in the rain.\n\nFirst month free. Cancel anytime*.\n\n*Cancellation must be requested in person at a Ziggurat office between 09:00 and 09:15."),
  t("braindance", 2, "Kabuki BD Exchange", "exchange@kabukibd.nc", "Rare Recordings Just Came In",
    "Psst, {{playerName}}.\n\nNew stock at the Exchange: a pro racer's last lap, a stunt off the Arasaka Tower, a jazz set from an underground club that burned down the next night.\n\nThe really rare stuff stays off the net. Come to Kabuki and ask for the back room.\n\n*Back room recordings may be illegal, real, or both."),
  t("braindance", 3, "Network 54 Entertainment", "bd@n54.net", "Relive The Unification Treaty Signing In Full BD",
    "History, from the inside.\n\nNetwork 54 presents the signing of the Treaty of Unification as a full-sense braindance, recorded by a delegate in the room. Feel the handshake that made Night City free again.\n\nAvailable now in all BD parlours in {{randomDistrict}}.\n\n*Delegate's own nerves included at no extra charge."),
  t("braindance", 4, "Mood Studio BD", "studio@moodbd.nc", "Get Paid To Record Your Day",
    "{{playerName}}, your life could be content.\n\nMood Studio pays 200 eb a day for ordinary people to record ordinary days: cooking, commuting, falling in love on the NCART. Our editors do the rest.\n\nWe provide the rig. You just live.\n\n*Mood Studio owns every recording made while wearing the rig, including the ones you forget."),
  t("braindance", 5, "BD Safety Board", "safety@bdsafety.org", "Black BD: Not Even Once",
    "A message for {{playerName}}.\n\nBlack braindances, real recordings of real deaths, are circulating again in {{randomDistrict}}. They can cause lasting psychological harm and they're evidence of real crimes.\n\nIf you're offered one, report it. If you've watched one, talk to someone."),

  /* Political */
  t("political", 1, "Free City Council", "updates@council.nc.gov", "Night City Is Free. Keep It That Way.",
    "Citizen {{playerName}},\n\nThe Unification War is over and the Free City stands. Your Council thanks you for your patience during the rebuilding of the city's services.\n\nTown hall this week in {{randomDistrict}}: water, power and NCART expansion. Bring questions. Leave weapons at the door.\n\nYour Free City Council."),
  t("political", 2, "NUSA Information Office", "info@nusa.gov", "Come Home To The United States",
    "{{playerName}},\n\nNight City chose its own path. The New United States respects that, and our door stays open.\n\nNUSA residency brings federal healthcare, pension rights and the protection of the most powerful military on Earth.\n\nApply today. We're closer than you think.\n\n*Message paid for by the NUSA Information Office. Militech had no part in this message."),
  t("political", 3, "Citizens For Clean Streets", "join@cleanstreets.nc", "Gangs Out Of {{randomDistrict}}",
    "{{playerName}}, enough is enough.\n\nTyger Claws on one block, Maelstrom on the next, Valentinos selling at the school gate. NCPD won't come. We will.\n\nJoin a neighbourhood patrol this weekend. We provide the armbands.\n\n*Citizens For Clean Streets is not affiliated with 6th Street. Whatever you've heard."),
  t("political", 4, "Recall The Mayor Campaign", "recall@nc-recall.org", "Sign The Recall Petition Today",
    "The Mayor promised NCART to Pacifica. Then the money vanished.\n\n{{playerName}}, add your name to the recall petition. 40,000 signatures and the Council has to call a vote.\n\nSign with your agent. Your identity will be kept private*.\n\n*Except from the Mayor's office, which requested the list."),
  t("political", 5, "Aldecaldo Outreach", "road@nomadoutreach.net", "The Road Is Open",
    "Hey {{playerName}}.\n\nThe city chews people up. Out in the Badlands, family means something. Nomad clans are taking on drivers, mechanics and medics.\n\nCome out to the Rocky Ridge camp on Sunday. Bring a jacket. Nights get cold.\n\nRide free."),

  /* Black market */
  t("blackmarket", 1, "a friend", "nobody@darknet.void", "Militech Surplus, No Serials",
    "{{playerName}},\n\nPost-war surplus, straight off a convoy that never arrived. Assault rifles, frag grenades, a smart gun or two. Serials filed, history forgotten.\n\nCash or crypto. Meet in {{randomDistrict}}, details on your burner.\n\nDon't bring friends."),
  t("blackmarket", 2, "Bootleg Chrome", "chrome@darknet.void", "Mil-Spec Sandevistan, Barely Used",
    "One owner, {{playerName}}. Owner doesn't need it any more.\n\nMil-spec Sandevistan, full overclock, cooling intact. Fitted by a real doc for a price we'll keep quiet.\n\nFirst offer over 20k takes it. Serious buyers only. Time-wasters get a demonstration."),
  t("blackmarket", 3, "The Pharmacist", "rx@darknet.void", "Glitter, Black Lace, Synthcoke: Restocked",
    "Back in business, {{playerName}}.\n\nFull menu restocked, cut clean, priced fair. Delivery anywhere in {{randomDistrict}} inside an hour, or pickup at the usual spot.\n\nAsk about the loyalty card.\n\n*Black Lace is not for first-timers. Seriously."),
  t("blackmarket", 4, "Ghost Netrunners", "hire@darknet.void", "Need Something Gone From The Net?",
    "{{playerName}},\n\nArrest record, credit score, an ex's photos, an employer's files. We make data disappear and put better data in its place.\n\nWe don't touch the Blackwall. We touch everything else.\n\nPayment in advance. Results by morning."),
  t("blackmarket", 5, "Scav Reclamation", "parts@darknet.void", "Organs Wanted. Cash Paid Same Day.",
    "Need eddies fast, {{playerName}}?\n\nWe buy kidneys, corneas and spare limbs for cash. Clean clinic, real doctors, you walk out the same day.\n\nAsk about our cyber-replacement plan: sell the original, get chrome at cost.\n\n*Scav Reclamation is a legitimate business. Stop asking about the people who didn't walk out."),
  t("blackmarket", 6, "Crate Diggers", "crates@darknet.void", "Arasaka Lost A Shipment. We Found It.",
    "A whole container, {{playerName}}. Arasaka paint, Arasaka locks, Arasaka contents.\n\nWe're selling by the crate, unopened, sight unseen. Could be cyberdecks. Could be rations. Could be something they'll come looking for.\n\nBids close Friday."),

  /* Fixers */
  t("fixer", 1, "a fixer", "jobs@darknet.void", "Work In {{randomDistrict}}. Pays Well.",
    "{{playerName}},\n\nI hear you're reliable. I have a job: one night, one address, one item that needs to change hands. Nobody gets hurt if you're good.\n\n10k on delivery, half up front if you've worked with me before.\n\nReply to this message and delete it."),
  t("fixer", 2, "Lizzie's", "bookings@lizzies.nc", "Someone's Asking For You At Lizzie's",
    "Hey {{playerName}},\n\nA client sat in a booth at Lizzie's all evening asking for you by name. Paid for their drinks in cash and left a card with an Arroyo address.\n\nNot our business. Just thought you'd want to know.\n\n— the bartender"),
  t("fixer", 3, "Edgerunner Job Board", "board@darknet.void", "This Week's Gigs",
    "{{playerName}}, this week on the board:\n\n- Escort a Biotechnica scientist across the Badlands. 8k.\n- Retrieve a stolen car from a Maelstrom garage. 5k plus the car's contents.\n- Find a missing BD editor last seen in Kabuki. Pay on recovery.\n- Netrunner wanted for a corporate data run. Rate negotiable.\n\nReply with the gig you want. First come, first paid."),
  t("fixer", 4, "Unknown Sender", "ghost@darknet.void", "You Owe Me",
    "{{playerName}},\n\nThat job in {{randomDistrict}}. I covered for you when it went sideways. You remember.\n\nTime to square it. One favour, no questions. I'll be in touch with the when and the where.\n\nDon't make me ask twice."),
  t("fixer", 5, "Night Market Collective", "market@nightmarket.nc", "Night Market Returns This Weekend",
    "The Night Market is back in {{randomDistrict}}, {{playerName}}!\n\nStreet food, BD stalls, ripperdocs, a mechanic who can get anything running, and fixers looking to hire.\n\nSaturday from dusk till the NCPD shows up. Bring cash."),
  t("fixer", 6, "Retired Solo", "oldtimer@citinet.nc", "Learn From Someone Who Survived",
    "{{playerName}},\n\nThirty years running the streets and I'm still here. Most of my crew aren't.\n\nI teach. Shooting, driving, reading a room, knowing when to walk away from a job. Weekly lessons at a range in Rancho Coronado.\n\nFirst lesson's free. The last lesson is always the same: don't get greedy."),
];
