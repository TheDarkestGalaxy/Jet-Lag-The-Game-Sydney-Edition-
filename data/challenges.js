// Jet Lag: Sydney Edition — Curated Challenges, Curses, Hide+Seek Questions, Powerups & Transit Costs

export const CHALLENGE_CATEGORIES = [
  { id: 'transit', label: 'Transit', color: '#F99D1C' },
  { id: 'food', label: 'Food & Drink', color: '#5AB031' },
  { id: 'explore', label: 'Sydney Explore', color: '#0098CD' },
  { id: 'photo', label: 'Photo / Proof', color: '#C4258F' },
  { id: 'chaos', label: 'Physical / Chaos', color: '#D11F2F' },
  { id: 'speed', label: 'Speed / Trivia', color: '#168388' }
];

export const DEFAULT_CHALLENGES = [
  {
    id: 'ch-01',
    title: 'Banh Mi Speedrun',
    category: 'food',
    difficulty: 'Medium',
    coins: 700,
    vetoMins: 20,
    description: 'Buy and finish a pork roll / banh mi (or vegetarian equivalent) from a local Vietnamese bakery within 15 minutes of arriving at your current suburb.',
    active: true
  },
  {
    id: 'ch-02',
    title: 'Ibis Paparazzi',
    category: 'photo',
    difficulty: 'Easy',
    coins: 450,
    vetoMins: 15,
    description: 'Find a live Australian White Ibis ("bin chicken") in the wild and capture a clear photo with yourself and the bird in frame. No zoo birds allowed.',
    active: true
  },
  {
    id: 'ch-03',
    title: 'Harbour Bridge Crossing on Foot',
    category: 'chaos',
    difficulty: 'Hard',
    coins: 1200,
    vetoMins: 30,
    description: 'Walk completely across the Sydney Harbour Bridge pedestrian walkway (Milsons Point to The Rocks or vice versa) without stopping for more than 10 seconds.',
    active: true
  },
  {
    id: 'ch-04',
    title: 'Three Modes in 30 Minutes',
    category: 'transit',
    difficulty: 'Medium',
    coins: 850,
    vetoMins: 20,
    description: 'Board three distinct Sydney transit modes (e.g. Train, Metro, Light Rail, or Ferry) within a single 30-minute window. Photo proof of each tap-on required.',
    active: true
  },
  {
    id: 'ch-05',
    title: 'Woolies vs Coles Mud Cake Duel',
    category: 'food',
    difficulty: 'Medium',
    coins: 650,
    vetoMins: 20,
    description: 'Buy a Coles or Woolworths chocolate mud cake (or mini version) and eat at least two slices using no utensils — only napkins.',
    active: true
  },
  {
    id: 'ch-06',
    title: 'Suburb Alphabet Sprint',
    category: 'explore',
    difficulty: 'Easy',
    coins: 500,
    vetoMins: 15,
    description: 'Find 5 different street signs within 600m of your current station whose names start with 5 consecutive letters of the alphabet (e.g. A-B-C-D-E or M-N-O-P-Q).',
    active: true
  },
  {
    id: 'ch-07',
    title: 'The Circular Quay Postcard',
    category: 'photo',
    difficulty: 'Easy',
    coins: 550,
    vetoMins: 15,
    description: 'Take a forced-perspective photo where you appear to be holding either the Sydney Opera House sails or a Sydney Ferry in your palm.',
    active: true
  },
  {
    id: 'ch-08',
    title: 'Metro Front-Seat Driver',
    category: 'transit',
    difficulty: 'Easy',
    coins: 500,
    vetoMins: 15,
    description: 'Ride at the very front window of a Sydney Metro M1 train for at least 3 consecutive stops and film a 10-second hyperlapse through the tunnel.',
    active: true
  },
  {
    id: 'ch-09',
    title: 'Reverse Direction Gamble',
    category: 'transit',
    difficulty: 'Medium',
    coins: 800,
    vetoMins: 20,
    description: 'Board the very next train or tram heading the OPPOSITE direction from your goal and ride it for 2 stops before transferring back.',
    active: true
  },
  {
    id: 'ch-10',
    title: 'Flat White Connoisseur',
    category: 'food',
    difficulty: 'Easy',
    coins: 450,
    vetoMins: 15,
    description: 'Order a coffee or hot chocolate at an independent cafe (no chains) with latte art and rate it out of 10 in a dramatic 15-second video review.',
    active: true
  },
  {
    id: 'ch-11',
    title: 'Ferry Wind Tunnel',
    category: 'transit',
    difficulty: 'Medium',
    coins: 900,
    vetoMins: 25,
    description: 'Ride any Sydney Ferry (F1–F10) on the outdoor deck for at least 2 wharf stops and spot 3 different ferry class names or maritime landmarks.',
    active: true
  },
  {
    id: 'ch-12',
    title: 'Bunnings / Sausage Sizzle Quest',
    category: 'food',
    difficulty: 'Medium',
    coins: 750,
    vetoMins: 20,
    description: 'Visit a local bakery or takeaway and buy an Australian meat pie or sausage roll; eat it standing outside a train station entrance.',
    active: true
  },
  {
    id: 'ch-13',
    title: 'Platform Number Roulette',
    category: 'chaos',
    difficulty: 'Medium',
    coins: 750,
    vetoMins: 20,
    description: 'Go to a station with at least 4 platforms. Roll a random platform number (or spin) and board the next service departing from that platform for at least 1 stop.',
    active: true
  },
  {
    id: 'ch-14',
    title: 'Jacaranda / Gum Tree Hunt',
    category: 'photo',
    difficulty: 'Easy',
    coins: 400,
    vetoMins: 15,
    description: 'Photograph a eucalyptus tree, a sandstone building, and a TfNSW "T / M / L / F" hop-circle sign all within 10 minutes.',
    active: true
  },
  {
    id: 'ch-15',
    title: '200-Metre Hopscotch',
    category: 'chaos',
    difficulty: 'Easy',
    coins: 550,
    vetoMins: 15,
    description: 'Walk 200 metres from your current station without stepping on a single pavement crack or tactile paving tile. Restart if you touch one!',
    active: true
  },
  {
    id: 'ch-16',
    title: 'Sydney Trivia Blitz',
    category: 'speed',
    difficulty: 'Medium',
    coins: 650,
    vetoMins: 20,
    description: 'Without searching the internet, name all 9 Sydney Trains lines (T1–T9) by number AND at least one terminus of each in under 60 seconds on video.',
    active: true
  },
  {
    id: 'ch-17',
    title: 'Library Book Coordinates',
    category: 'explore',
    difficulty: 'Medium',
    coins: 700,
    vetoMins: 20,
    description: 'Enter the nearest public library, find a book about Australia or Sydney, open to page 42, and read the first sentence aloud outside.',
    active: true
  },
  {
    id: 'ch-18',
    title: 'Suburb Postcode Math',
    category: 'speed',
    difficulty: 'Easy',
    coins: 500,
    vetoMins: 15,
    description: 'Find a visible 4-digit NSW postcode on a shopfront or sign. Do that exact number of steps (last 2 digits × 5, min 50 steps) before boarding your next vehicle.',
    active: true
  },
  {
    id: 'ch-19',
    title: 'Touch the Ocean or River',
    category: 'explore',
    difficulty: 'Hard',
    coins: 1100,
    vetoMins: 30,
    description: 'Travel to a beach, harbour cove, or river foreshore and physically touch natural saltwater or Parramatta River water with your hand. Photo proof required.',
    active: true
  },
  {
    id: 'ch-20',
    title: 'Opal Receipt Origami',
    category: 'chaos',
    difficulty: 'Easy',
    coins: 450,
    vetoMins: 15,
    description: 'Get a paper receipt from any shop or kiosk and fold a recognizable paper plane that flies at least 4 metres outdoors.',
    active: true
  },
  {
    id: 'ch-21',
    title: 'Double-Decker Upstairs-Downstairs',
    category: 'transit',
    difficulty: 'Easy',
    coins: 450,
    vetoMins: 15,
    description: 'On your next Sydney Trains ride, switch between the upper deck and lower deck at every single station stop for 4 consecutive stations.',
    active: true
  },
  {
    id: 'ch-22',
    title: 'Bubble Tea Blind Buy',
    category: 'food',
    difficulty: 'Easy',
    coins: 550,
    vetoMins: 15,
    description: 'Go to the nearest bubble tea shop, ask the cashier to pick their favourite drink with toppings, and finish at least half of it.',
    active: true
  },
  {
    id: 'ch-23',
    title: 'Find a Historic Plaque',
    category: 'explore',
    difficulty: 'Easy',
    coins: 500,
    vetoMins: 15,
    description: 'Locate a heritage plaque, monument, or war memorial dated before 1950 and take a selfie reading the year out loud.',
    active: true
  },
  {
    id: 'ch-24',
    title: 'The Exact $5 Challenge',
    category: 'food',
    difficulty: 'Medium',
    coins: 750,
    vetoMins: 20,
    description: 'Buy items at a supermarket or convenience store whose total comes to between $4.50 and $5.00 AUD without exceeding $5.00.',
    active: true
  },
  {
    id: 'ch-25',
    title: 'Escalator Statue',
    category: 'chaos',
    difficulty: 'Easy',
    coins: 400,
    vetoMins: 15,
    description: 'Stand completely motionless on the left side of the longest station escalator you can find (Town Hall, Wynyard, Martin Place, or Barangaroo) while humming the Jet Lag theme.',
    active: true
  },
  {
    id: 'ch-26',
    title: 'Interchange Marathon',
    category: 'transit',
    difficulty: 'Hard',
    coins: 1000,
    vetoMins: 25,
    description: 'Visit 3 different major interchange hubs (Central, Strathfield, Parramatta, Chatswood, Sydenham, Hornsby, Epping, Redfern, Lidcombe, or Wolli Creek) within 45 minutes.',
    active: true
  },
  {
    id: 'ch-27',
    title: 'Park Bench Sketch Artist',
    category: 'photo',
    difficulty: 'Easy',
    coins: 500,
    vetoMins: 15,
    description: 'Sit on a public park bench and draw the skyline or nearest train station in 2 minutes using your phone notes or paper. Opponents must guess the suburb!',
    active: true
  },
  {
    id: 'ch-28',
    title: 'No-Maps Navigation',
    category: 'chaos',
    difficulty: 'Hard',
    coins: 950,
    vetoMins: 25,
    description: 'Lock Google/Apple Maps for the next 20 minutes — navigate purely using physical TfNSW signage, station maps, and street signs!',
    active: true
  },
  {
    id: 'ch-29',
    title: 'Light Rail Race',
    category: 'chaos',
    difficulty: 'Hard',
    coins: 1100,
    vetoMins: 25,
    description: 'Get off a Sydney Light Rail tram (L1, L2, L3, or L4) and outrun/power-walk it to the next stop to re-board the exact same tram (or beat it by 5 seconds).',
    active: true
  },
  {
    id: 'ch-30',
    title: 'Op-Shop Outfit Upgrade',
    category: 'explore',
    difficulty: 'Medium',
    coins: 850,
    vetoMins: 20,
    description: 'Buy the funniest hat, scarf, or accessory under $8 from a Vinnies, Salvos, or local op-shop and wear it for the next 45 minutes of gameplay.',
    active: true
  },
  {
    id: 'ch-31',
    title: 'Station Concourse Haiku',
    category: 'speed',
    difficulty: 'Easy',
    coins: 400,
    vetoMins: 10,
    description: 'Write and recite an original 5-7-5 haiku about the exact Sydney suburb you are standing in right now and post it in the live feed.',
    active: true
  },
  {
    id: 'ch-32',
    title: 'Four-Line Sighting',
    category: 'photo',
    difficulty: 'Medium',
    coins: 700,
    vetoMins: 20,
    description: 'Capture photos of 4 different colored TfNSW route badges (e.g. T1, T4, M1, L2, F3) on real physical signage within 25 minutes.',
    active: true
  },
  {
    id: 'ch-33',
    title: 'Tim Tam Slam',
    category: 'food',
    difficulty: 'Medium',
    coins: 650,
    vetoMins: 15,
    description: 'Acquire a packet of Tim Tams and a hot or cold milk drink and successfully execute a Tim Tam Slam on camera without dropping the biscuit.',
    active: true
  },
  {
    id: 'ch-34',
    title: 'Intercity Border Hop',
    category: 'transit',
    difficulty: 'Hard',
    coins: 1400,
    vetoMins: 35,
    description: 'Board any Intercity service (BMT, CCN, SCO, or SHL) and ride it at least 2 stops beyond a suburban interchange (Penrith, Hornsby, Waterfall, or Campbelltown).',
    active: true
  },
  {
    id: 'ch-35',
    title: 'Local Playground Speedrun',
    category: 'chaos',
    difficulty: 'Easy',
    coins: 500,
    vetoMins: 15,
    description: 'Find the nearest public park with a swing or slide, go down the slide or swing 5 full arcs, and snap a victory selfie.',
    active: true
  },
  {
    id: 'ch-36',
    title: '100-Metre Blind Guess',
    category: 'speed',
    difficulty: 'Medium',
    coins: 600,
    vetoMins: 15,
    description: 'Pick a landmark ahead, estimate how many steps away it is, and walk it. Succeed if your guess is within ±15% of the real step count!',
    active: true
  }
];

export const DEFAULT_CURSES = [
  {
    id: 'cu-01',
    title: 'Curse of the Opal Tap Delay',
    cost: 600,
    durationMins: 15,
    castingCondition: 'Discard 1 challenge or pay coins',
    description: 'Target team must wait 3 minutes outside the Opal gates before tapping onto their next station or wharf.',
    active: true
  },
  {
    id: 'cu-02',
    title: 'Curse of the Slow Boat',
    cost: 900,
    durationMins: 30,
    castingCondition: 'Target is within 3km of Sydney Harbour or Parramatta River',
    description: 'Target team may NOT board any Heavy Rail or Metro train for 20 minutes — only Ferries, Light Rail, or walking!',
    active: true
  },
  {
    id: 'cu-03',
    title: 'Curse of the Urban Explorer',
    cost: 500,
    durationMins: 20,
    castingCondition: 'Roll a die; must be 3+',
    description: 'Target team cannot use any transit until they take a photo of a street sign containing a tree, bird, or royal title.',
    active: true
  },
  {
    id: 'cu-04',
    title: 'Curse of the Wrong Platform',
    cost: 700,
    durationMins: 15,
    castingCondition: 'Pay coin cost',
    description: 'Target team must let the very next train/tram/ferry they wanted to board depart without getting on it.',
    active: true
  },
  {
    id: 'cu-05',
    title: 'Curse of the Silent Commuter',
    cost: 400,
    durationMins: 20,
    castingCondition: 'Free to cast once per hour',
    description: 'Target team cannot speak aloud for 15 minutes (hand gestures & text only). Speaking adds +5 minutes to their freeze!',
    active: true
  },
  {
    id: 'cu-06',
    title: 'Curse of the Iced Coffee Detour',
    cost: 650,
    durationMins: 20,
    castingCondition: 'Target is in a commercial suburb',
    description: 'Before asking their next question or boarding their next train, target must purchase a drink and carry it finished/empty to the next station.',
    active: true
  },
  {
    id: 'cu-07',
    title: 'Curse of the Gambler’s Feet',
    cost: 800,
    durationMins: 25,
    castingCondition: 'Pay coin cost',
    description: 'Target team must walk at least 1.0 km on foot before their next Opal tap-on (verified by GPS track).',
    active: true
  },
  {
    id: 'cu-08',
    title: 'Curse of the Bridge Toll',
    cost: 750,
    durationMins: 30,
    castingCondition: 'Pay coin cost',
    description: 'Target team pays DOUBLE transit coin cost (or loses 10 minutes) the next time they cross Sydney Harbour or the Parramatta River.',
    active: true
  },
  {
    id: 'cu-09',
    title: 'Curse of the Scrambled Compass',
    cost: 850,
    durationMins: 15,
    castingCondition: 'Pay coin cost',
    description: 'Target team cannot look at any map app (including this map!) for 10 minutes — physical station signs only.',
    active: true
  },
  {
    id: 'cu-10',
    title: 'Curse of the Jammed Door',
    cost: 1000,
    durationMins: 10,
    castingCondition: 'Hider / Runner emergency card',
    description: 'Target team is FROZEN in place for 10 full minutes immediately upon receiving this curse (cannot board any vehicle).',
    active: true
  },
  {
    id: 'cu-11',
    title: 'Curse of the Express Skip',
    cost: 600,
    durationMins: 25,
    castingCondition: 'Pay coin cost',
    description: 'Target team may only board all-stops services for the next 25 minutes — no limited-stops express trains or Intercity express runs!',
    active: true
  },
  {
    id: 'cu-12',
    title: 'Curse of the Photo Toll',
    cost: 450,
    durationMins: 15,
    castingCondition: 'Pay coin cost',
    description: 'Target must photograph a yellow Sydney Trains double-decker, a teal Metro sign, OR a green Sydney Ferry before asking another Hide+Seek question.',
    active: true
  }
];

export const HIDE_SEEK_QUESTIONS = [
  // RADAR
  { id: 'q-rad-500m', category: 'Radar', title: 'Radar: 500 m', cost: 'Draw 2, Keep 1', radiusKm: 0.5, mapAction: 'radar', prompt: 'Are you within 500 metres of our current location?' },
  { id: 'q-rad-1km', category: 'Radar', title: 'Radar: 1 km', cost: 'Draw 2, Keep 1', radiusKm: 1, mapAction: 'radar', prompt: 'Are you within 1 km of our current location?' },
  { id: 'q-rad-2km', category: 'Radar', title: 'Radar: 2 km', cost: 'Draw 2, Keep 1', radiusKm: 2, mapAction: 'radar', prompt: 'Are you within 2 km of our current location?' },
  { id: 'q-rad-5km', category: 'Radar', title: 'Radar: 5 km', cost: 'Draw 2, Keep 1', radiusKm: 5, mapAction: 'radar', prompt: 'Are you within 5 km of our current location?' },
  { id: 'q-rad-10km', category: 'Radar', title: 'Radar: 10 km', cost: 'Draw 2, Keep 1', radiusKm: 10, mapAction: 'radar', prompt: 'Are you within 10 km of our current location?' },
  { id: 'q-rad-25km', category: 'Radar', title: 'Radar: 25 km', cost: 'Draw 2, Keep 1', radiusKm: 25, mapAction: 'radar', prompt: 'Are you within 25 km of our current location?' },

  // THERMOMETER
  { id: 'q-thm-1km', category: 'Thermometer', title: 'Thermometer: 1 km', cost: 'Draw 2, Keep 1', distanceKm: 1, mapAction: 'thermometer', prompt: 'After travelling 1 km from Point A to Point B, are we hotter (closer) or colder (farther)?' },
  { id: 'q-thm-3km', category: 'Thermometer', title: 'Thermometer: 3 km', cost: 'Draw 2, Keep 1', distanceKm: 3, mapAction: 'thermometer', prompt: 'After travelling 3 km from Point A to Point B, are we hotter (closer) or colder (farther)?' },
  { id: 'q-thm-5km', category: 'Thermometer', title: 'Thermometer: 5 km', cost: 'Draw 2, Keep 1', distanceKm: 5, mapAction: 'thermometer', prompt: 'After travelling 5 km from Point A to Point B, are we hotter (closer) or colder (farther)?' },

  // MATCHING
  { id: 'q-mat-line', category: 'Matching', title: 'Same Transit Line?', cost: 'Draw 3, Keep 1', mapAction: 'none', prompt: 'Does your nearest station share at least one transit line (T1–T9, M1, L1–L4, F1–F10, Intercity) with our nearest station?' },
  { id: 'q-mat-side', category: 'Matching', title: 'Same Side of Harbour / River?', cost: 'Draw 3, Keep 1', mapAction: 'none', prompt: 'Are we on the same side (North vs South) of Sydney Harbour & the Parramatta River?' },
  { id: 'q-mat-region', category: 'Matching', title: 'Same Sydney Region?', cost: 'Draw 3, Keep 1', mapAction: 'none', prompt: 'Are we in the same Greater Sydney region (CBD, Inner West, Eastern Suburbs, North Shore, Western Sydney, South, Northern Beaches, Intercity)?' },
  { id: 'q-mat-letter', category: 'Matching', title: 'Station Starts With Same Letter?', cost: 'Draw 3, Keep 1', mapAction: 'none', prompt: 'Does your nearest station start with the same first letter as our nearest station?' },
  { id: 'q-mat-mode', category: 'Matching', title: 'Same Nearest Mode?', cost: 'Draw 3, Keep 1', mapAction: 'none', prompt: 'Is your nearest transit stop the same mode (Train, Metro, Light Rail, or Ferry) as ours?' },

  // MEASURING
  { id: 'q-mea-central', category: 'Measuring', title: 'Distance to Central Station', cost: 'Draw 3, Keep 1', targetCoord: [-33.8832, 151.2067], mapAction: 'measure', prompt: 'Compared to us, are you closer to or farther from Central Station?' },
  { id: 'q-mea-opera', category: 'Measuring', title: 'Distance to Opera House', cost: 'Draw 3, Keep 1', targetCoord: [-33.8568, 151.2153], mapAction: 'measure', prompt: 'Compared to us, are you closer to or farther from the Sydney Opera House?' },
  { id: 'q-mea-parra', category: 'Measuring', title: 'Distance to Parramatta Station', cost: 'Draw 3, Keep 1', targetCoord: [-33.8176, 151.0052], mapAction: 'measure', prompt: 'Compared to us, are you closer to or farther from Parramatta Station?' },
  { id: 'q-mea-airport', category: 'Measuring', title: 'Distance to Sydney Airport', cost: 'Draw 3, Keep 1', targetCoord: [-33.9399, 151.1753], mapAction: 'measure', prompt: 'Compared to us, are you closer to or farther from Sydney Airport?' },
  { id: 'q-mea-coast', category: 'Measuring', title: 'Distance to Coastline / Ocean', cost: 'Draw 3, Keep 1', mapAction: 'none', prompt: 'Compared to us, are you closer to or farther from the Pacific Ocean coastline?' },

  // TENTACLES
  { id: 'q-ten-metro', category: 'Tentacles', title: 'Nearest Metro Station (within 5 km)', cost: 'Draw 4, Keep 2', mapAction: 'none', prompt: 'Of all Sydney Metro M1 stations within 5 km of you, which one are you closest to? (Or answer "None within 5 km")' },
  { id: 'q-ten-ferry', category: 'Tentacles', title: 'Nearest Ferry Wharf (within 3 km)', cost: 'Draw 4, Keep 2', mapAction: 'none', prompt: 'Of all Sydney Ferry wharves within 3 km of you, which one are you closest to? (Or answer "None within 3 km")' },
  { id: 'q-ten-interchange', category: 'Tentacles', title: 'Nearest Major Interchange (within 8 km)', cost: 'Draw 4, Keep 2', mapAction: 'none', prompt: 'Which major rail interchange within 8 km are you closest to?' },

  // PHOTOS
  { id: 'q-pho-station', category: 'Photo', title: 'Station Exterior (Name Hidden)', cost: 'Draw 1, Keep 1', mapAction: 'none', prompt: 'Send a photo of the exterior entrance of your hiding station with the station name obscured/out of frame.' },
  { id: 'q-pho-tallest', category: 'Photo', title: 'Tallest Structure Visible', cost: 'Draw 1, Keep 1', mapAction: 'none', prompt: 'Send a photo of the tallest building or structure visible from your exact spot.' },
  { id: 'q-pho-street', category: 'Photo', title: 'Nearest Street View (20m)', cost: 'Draw 1, Keep 1', mapAction: 'none', prompt: 'Send a photo looking straight down the nearest public street (no street name signs visible).' },
  { id: 'q-pho-sky', category: 'Photo', title: '5 Trees / Sky Straight Up', cost: 'Draw 1, Keep 1', mapAction: 'none', prompt: 'Point your phone straight up and send a photo of the sky/canopy directly above you.' }
];

export const POWERUPS_SHOP = [
  {
    id: 'pw-double',
    title: 'Double Next Challenge',
    cost: 400,
    icon: '2X',
    description: 'Doubles the coin/point reward of the next challenge you complete — but also doubles the veto penalty if you fail!'
  },
  {
    id: 'pw-freeze',
    title: 'Tracker Freeze (15 min)',
    cost: 1200,
    icon: 'FREEZE',
    description: 'Freezes your shared live GPS pin at your current coordinates for 15 minutes while you keep moving!'
  },
  {
    id: 'pw-veto-shield',
    title: 'Instant Veto Clear',
    cost: 700,
    icon: 'CLEAR',
    description: 'Immediately cancels an active veto penalty countdown so you can draw a fresh challenge right away.'
  },
  {
    id: 'pw-radar-ping',
    title: 'Opponent Location Ping',
    cost: 1500,
    icon: 'PING',
    description: 'Forces a one-time approximate 1 km accuracy ping of the opposing team (or reveals their current transit line).'
  },
  {
    id: 'pw-swap',
    title: 'Challenge Swap',
    cost: 350,
    icon: 'SWAP',
    description: 'Reroll the challenge wheel once without incurring a veto timeout.'
  }
];

export const TRANSIT_RATES = [
  { mode: 'train', label: 'Sydney Trains (T1–T9)', coinsPerMin: 25, color: '#F99D1C' },
  { mode: 'metro', label: 'Sydney Metro (M1)', coinsPerMin: 35, color: '#168388' },
  { mode: 'light_rail', label: 'Light Rail (L1–L4)', coinsPerMin: 15, color: '#BE1622' },
  { mode: 'ferry', label: 'Sydney Ferries (F1–F10)', coinsPerMin: 20, color: '#5AB031' },
  { mode: 'intercity', label: 'Intercity Trains (BMT/CCN/SCO/SHL)', coinsPerMin: 45, color: '#005AA3' }
];
