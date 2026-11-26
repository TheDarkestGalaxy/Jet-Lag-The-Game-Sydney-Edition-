// Multi-Mode Flexible Game Engine for Jet Lag: Sydney Edition

export const GAME_MODES = {
  hide_seek: {
    id: 'hide_seek',
    name: 'Hide + Seek Sydney',
    shortName: 'Hide + Seek',
    badge: 'H+S',
    color: '#168388',
    tagline: 'Hide around any Sydney station. Seekers ask Radar, Thermometer, Matching & Photo questions to narrow the map!',
    roles: ['hider', 'seeker'],
    defaultRules: {
      economy: false,
      stationClaiming: false,
      flags: false,
      checkpoints: false,
      hideSeekQA: true,
      curses: true,
      dividingLine: false,
      winSectors: false,
      hideHiderGps: true,
      transitCosts: false,
      challengeWheel: true
    }
  },
  tag: {
    id: 'tag',
    name: 'Tag Across Sydney',
    shortName: 'Tag',
    badge: 'TAG',
    color: '#F99D1C',
    tagline: 'One Runner flees toward their Win Sector using coins earned from challenges while Chasers track and intercept!',
    roles: ['runner', 'chaser'],
    defaultRules: {
      economy: true,
      stationClaiming: false,
      flags: false,
      checkpoints: false,
      hideSeekQA: false,
      curses: true,
      dividingLine: false,
      winSectors: true,
      hideHiderGps: false,
      transitCosts: true,
      challengeWheel: true
    }
  },
  rail_rush: {
    id: 'rail_rush',
    name: 'Rail Rush Sydney',
    shortName: 'Rail Rush',
    badge: 'RUSH',
    color: '#D11F2F',
    tagline: 'Race across Trains, Metro, Light Rail & Ferries to claim stations, complete whole lines for bonus points, and block rivals!',
    roles: ['team', 'team'],
    defaultRules: {
      economy: true,
      stationClaiming: true,
      flags: false,
      checkpoints: false,
      hideSeekQA: false,
      curses: true,
      dividingLine: false,
      winSectors: false,
      hideHiderGps: false,
      transitCosts: false,
      challengeWheel: true
    }
  },
  ctf: {
    id: 'ctf',
    name: 'Capture the Flag',
    shortName: 'Capture Flag',
    badge: 'CTF',
    color: '#0098CD',
    tagline: 'Split Sydney across the Harbour & Parramatta River! Hide flags at stations, cross into enemy territory, grab & return home.',
    roles: ['north', 'south'],
    defaultRules: {
      economy: true,
      stationClaiming: false,
      flags: true,
      checkpoints: false,
      hideSeekQA: false,
      curses: true,
      dividingLine: true,
      winSectors: false,
      hideHiderGps: false,
      transitCosts: false,
      challengeWheel: true
    }
  },
  race: {
    id: 'race',
    name: 'Race Across Sydney',
    shortName: 'Race',
    badge: 'RACE',
    color: '#5AB031',
    tagline: 'Sprint between iconic Sydney & Intercity checkpoints! Complete challenges at stops or earn coins to unlock faster modes.',
    roles: ['racer', 'racer'],
    defaultRules: {
      economy: true,
      stationClaiming: false,
      flags: false,
      checkpoints: true,
      hideSeekQA: false,
      curses: true,
      dividingLine: false,
      winSectors: false,
      hideHiderGps: false,
      transitCosts: true,
      challengeWheel: true
    }
  },
  custom: {
    id: 'custom',
    name: 'Custom / Sandbox',
    shortName: 'Custom',
    badge: 'MOD',
    color: '#C4258F',
    tagline: 'Mix and match ANY rule modules — coins, station claims, flags, checkpoints, dividing lines, curses & map tools for your own house games!',
    roles: ['team', 'team'],
    defaultRules: {
      economy: true,
      stationClaiming: true,
      flags: true,
      checkpoints: true,
      hideSeekQA: true,
      curses: true,
      dividingLine: false,
      winSectors: false,
      hideHiderGps: false,
      transitCosts: true,
      challengeWheel: true
    }
  }
};

export const RULE_MODULES = [
  { key: 'challengeWheel', label: 'Challenge Wheel & Vetoes', desc: 'Spin challenges, accept, veto, and earn rewards' },
  { key: 'economy', label: 'Coins & Powerup Shop', desc: 'Track team coins, buy powerups & curses' },
  { key: 'transitCosts', label: 'Live Transit Coin Burn', desc: 'Burn coins per minute while riding transit' },
  { key: 'curses', label: 'Curses & Cooldowns', desc: 'Draw & cast timed Jet Lag curses on opponents' },
  { key: 'hideSeekQA', label: 'Hide + Seek Questions & Hiding Zone', desc: 'Radar, Thermometer, Matching, Photo Q&A log' },
  { key: 'hideHiderGps', label: 'Auto-Hide Hider GPS', desc: 'Automatically masks Hider GPS from Seekers' },
  { key: 'stationClaiming', label: 'Rail Rush Station & Line Claims', desc: 'Claim stations & earn line-completion bonuses' },
  { key: 'flags', label: 'Capture the Flag Markers', desc: 'Place, pick up, carry & capture flags at stations' },
  { key: 'dividingLine', label: 'Territory Dividing Line', desc: 'Split map into Team A / Team B territories' },
  { key: 'checkpoints', label: 'Race Checkpoints', desc: 'Ordered or open station waypoints to check off' },
  { key: 'winSectors', label: 'Tag Win Sectors', desc: 'Radiating pie-slice end zones on the map' }
];

export const CTF_PRESETS = [
  {
    id: 'harbour-parra',
    name: 'Sydney Harbour & Parramatta River (North vs South)',
    p1: [-33.8080, 150.9850], // Parramatta River West
    p2: [-33.8540, 151.2800], // Sydney Heads East
    sideALabel: 'North Side',
    sideBLabel: 'South Side'
  },
  {
    id: 'george-st-ns',
    name: 'East vs West (Central / Harbour Bridge Axis)',
    p1: [-33.6800, 151.1800],
    p2: [-34.0500, 151.2100],
    sideALabel: 'West Sydney',
    sideBLabel: 'East Sydney'
  },
  {
    id: 't1-corridor',
    name: 'Inner Ring (Strathfield to Bondi Axis)',
    p1: [-33.8720, 151.0940],
    p2: [-33.8915, 151.2475],
    sideALabel: 'North Zone',
    sideBLabel: 'South Zone'
  }
];

export const RACE_PRESETS = [
  {
    id: 'four-corners',
    name: 'Four Corners of Greater Sydney',
    description: 'Hit Manly Wharf, Parramatta, Bondi Junction, and Cronulla (or Chatswood) in any order!',
    ordered: false,
    stationNames: ['Manly', 'Parramatta', 'Bondi Junction', 'Cronulla', 'Chatswood']
  },
  {
    id: 'quad-mode',
    name: 'Sydney Quad-Mode Triathlon',
    description: 'Central → Tallawong (Metro) → Carlingford (L4) → Parramatta → Circular Quay (F3 Ferry) → Randwick (L2)',
    ordered: true,
    stationNames: ['Central', 'Tallawong', 'Carlingford', 'Parramatta', 'Circular Quay', 'Randwick']
  },
  {
    id: 'intercity-epic',
    name: 'Mountains to the Sea Epic',
    description: 'Katoomba (BMT) → Central → Bondi Junction → Manly Wharf → Gosford (CCN)',
    ordered: true,
    stationNames: ['Katoomba', 'Central', 'Bondi Junction', 'Manly', 'Gosford']
  },
  {
    id: 'cbd-sprint',
    name: 'Inner Sydney Speedrun (60 min)',
    description: 'Circular Quay → Barangaroo → Dulwich Hill → Sydenham → Mascot → Milsons Point',
    ordered: false,
    stationNames: ['Circular Quay', 'Barangaroo', 'Dulwich Hill', 'Sydenham', 'Mascot', 'Milsons Point']
  }
];

export function getDefaultRulesForMode(modeId) {
  const m = GAME_MODES[modeId] || GAME_MODES.custom;
  return { ...m.defaultRules };
}

/** Haversine distance in metres between two [lat, lng] coordinates */
export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(metres) {
  if (metres == null || Number.isNaN(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

/** Determine which side of a dividing line a lat/lng lies on ('A' or 'B') */
export function getDividingSide(lat, lng, dividingLine) {
  if (!dividingLine?.p1 || !dividingLine?.p2) return null;
  const [y1, x1] = dividingLine.p1;
  const [y2, x2] = dividingLine.p2;
  const cross = (x2 - x1) * (lat - y1) - (y2 - y1) * (lng - x1);
  return cross >= 0 ? 'A' : 'B';
}

/** Calculate Rail Rush progress per line and total scores per team */
export function computeRailRushStats(network, claimedStations, teams, lineBonus = 5, stationPts = 1) {
  const teamStats = {};
  for (const t of teams) {
    teamStats[t.id] = { stations: 0, completedLines: [], bonusPoints: 0, totalScore: 0 };
  }

  // Count claimed stations per team
  for (const [, claim] of Object.entries(claimedStations || {})) {
    if (teamStats[claim.teamId]) {
      teamStats[claim.teamId].stations += 1;
    }
  }

  // Compute line progress
  const lineProgress = (network?.lines || []).map((line) => {
    const stationIds = line.stationIds || [];
    const total = stationIds.length;
    const byTeam = {};
    for (const sid of stationIds) {
      const claim = claimedStations?.[sid];
      if (claim) {
        byTeam[claim.teamId] = (byTeam[claim.teamId] || 0) + 1;
      }
    }
    let winnerTeamId = null;
    if (total > 0) {
      for (const [tid, count] of Object.entries(byTeam)) {
        if (count >= total) {
          winnerTeamId = tid;
          if (teamStats[tid]) {
            teamStats[tid].completedLines.push(line.code);
            teamStats[tid].bonusPoints += lineBonus;
          }
        }
      }
    }
    return {
      code: line.code,
      name: line.name,
      color: line.color,
      mode: line.mode,
      total,
      byTeam,
      winnerTeamId
    };
  });

  for (const tid of Object.keys(teamStats)) {
    teamStats[tid].totalScore = teamStats[tid].stations * stationPts + teamStats[tid].bonusPoints;
  }

  return { teamStats, lineProgress };
}

/** Check whether any Game Master currently exists in the session */
export function hasActiveGameMaster(state) {
  return Object.values(state.players || {}).some((p) => p && (p.isEventHost || p.accessLevel === 'gm'));
}

/** Evaluate fine-grained access permissions for the current local user */
export function getAccess(state) {
  const me = state.players?.[state.localPlayerId];
  const gmExists = hasActiveGameMaster(state);
  const isGm = Boolean(me?.isEventHost || me?.accessLevel === 'gm');
  const isPermitted = isGm || me?.accessLevel === 'co_host';
  const perms = state.permissions || {};

  // If no GM exists in the session (solo / casual group play), everyone has normal access;
  // Once a GM exists, standard players are restricted according to GM permission locks!
  const restricted = gmExists && !isPermitted;

  return {
    gmExists,
    isGm,
    isPermitted,
    canEditRules: !restricted || !perms.lockRulesToGm,
    canEditScores: !restricted || !perms.lockScoresToGm,
    canEditTeams: !restricted || !perms.lockTeamsToGm,
    canEditDeck: !restricted || !perms.lockDeckToGm,
    canClaimGm: isGm || !gmExists,
    canUseDemoGps: isGm || Boolean(perms.allowDemoGps) || (!gmExists && !state.room?.connected),
    mustVerifyGps: !isGm && Boolean(perms.strictGpsProximity),
    canRenameSelf: isGm || !me?.nameLocked || !perms.lockNamesAfterJoin
  };
}

/** Determine whether player `targetPlayer` GPS should be visible to `viewerPlayer` */
export function canSeePlayerGps(state, viewerPlayer, targetPlayer) {
  if (!targetPlayer || targetPlayer.lat == null || targetPlayer.lng == null) return false;
  // Non-playing Event Hosts do not appear as competing pins on the map
  if (targetPlayer.isEventHost) return false;
  // Non-playing Event Host (GM) has full spectator visibility of all players
  if (viewerPlayer?.isEventHost) return true;
  if (viewerPlayer && targetPlayer.id === viewerPlayer.id) return true;
  if (targetPlayer.gpsHidden) return false;

  const sameTeam = viewerPlayer && targetPlayer.teamId === viewerPlayer.teamId;
  if (sameTeam) return true;

  // Hide + Seek rule: hide Hider's GPS from Seekers unless revealed
  if (state.game.rules.hideHiderGps) {
    const targetTeam = state.teams.find((t) => t.id === targetPlayer.teamId);
    if (targetTeam?.role === 'hider' && !state.hidingZone?.revealed) {
      return false;
    }
  }
  return true;
}

/** Format milliseconds as HH:MM:SS or MM:SS */
export function formatClock(ms) {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
