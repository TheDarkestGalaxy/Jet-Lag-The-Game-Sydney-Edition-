// Jet Lag: Sydney Edition — Curated Challenges, Curses, Hide+Seek Questions, Powerups & Transit Costs

export const CHALLENGE_CATEGORIES = [
  { id: 'transit', label: 'Transit', color: '#F99D1C' },
  { id: 'food', label: 'Food & Drink', color: '#5AB031' },
  { id: 'explore', label: 'Sydney Explore', color: '#0098CD' },
  { id: 'photo', label: 'Photo / Proof', color: '#C4258F' },
  { id: 'chaos', label: 'Physical / Chaos', color: '#D11F2F' },
  { id: 'speed', label: 'Speed / Trivia', color: '#168388' }
];

// Preset challenges intentionally empty so players build their own custom Sydney challenge deck
export const DEFAULT_CHALLENGES = [];

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
