import { DEFAULT_CHALLENGES, DEFAULT_CURSES, HIDE_SEEK_QUESTIONS } from '../data/challenges.js';
import { GAME_MODES, CTF_PRESETS, RACE_PRESETS, getDefaultRulesForMode } from './modes.js';

const STORAGE_KEY = 'jetlag_sydney_state_v2';

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createInitialState() {
  const localPlayerId = uid('p');
  const modeId = 'hide_seek';
  return {
    version: 1,
    updatedAt: Date.now(),
    localPlayerId,
    theme: 'dark',
    soundEnabled: true,
    room: {
      code: '',
      engine: 'peerjs', // 'peerjs' | 'firebase'
      isHost: false,
      connected: false,
      statusText: 'Solo / Local Mode',
      firebaseUrl: '',
      shareGps: false,
      gpsPrivacy: 'auto', // 'auto' (role-based) | 'always' | 'team' | 'hidden'
      frozenCoord: null,
      freezeEndsAt: 0
    },
    game: {
      name: 'Jet Lag: Sydney Session',
      mode: modeId,
      rules: getDefaultRulesForMode(modeId),
      status: 'lobby', // 'lobby' | 'running' | 'paused' | 'finished'
      startedAt: null,
      elapsedBeforePauseMs: 0,
      durationMins: 180,
      hidingMins: 45,
      hidingEndsAt: null,
      hidingRadiusM: 500,
      catchRadiusM: 100,
      railRushTarget: 15,
      railRushLineBonus: 5
    },
    teams: [
      { id: 'team-a', name: 'Team Harbour', color: '#F99D1C', role: 'hider', coins: 1500, points: 0, vetoEndsAt: 0, doubleNext: false, activeChallenge: null },
      { id: 'team-b', name: 'Team Bridge', color: '#0098CD', role: 'seeker', coins: 1500, points: 0, vetoEndsAt: 0, doubleNext: false, activeChallenge: null }
    ],
    players: {
      [localPlayerId]: {
        id: localPlayerId,
        name: 'Player 1',
        teamId: 'team-a',
        color: '#F99D1C',
        lat: null,
        lng: null,
        accuracy: null,
        speed: null,
        lastSeen: Date.now(),
        gpsHidden: false,
        gpsFrozen: false,
        frozenLat: null,
        frozenLng: null,
        online: true
      }
    },
    // Mode-specific shared board state
    claimedStations: {}, // { [stationId]: { teamId, playerId, playerName, claimedAt } }
    flags: [], // { id, label, teamId, status: 'base'|'carried'|'captured', stationId, lat, lng, carrierId }
    checkpoints: [], // { id, stationId, name, lat, lng, order, completedBy: { [teamId]: ts } }
    hidingZone: null, // { lat, lng, radiusM, stationId, stationName, setByTeamId, revealed }
    dividingLine: { ...CTF_PRESETS[0], enabled: false },
    winSectors: {
      enabled: false,
      center: [-33.8832, 151.2067], // Central Station
      centerName: 'Central Station',
      count: 3,
      rotationDeg: -30,
      labels: ['North & Beaches', 'South & Coast', 'West & Parramatta']
    },
    annotations: [], // { id, type, scope: 'all'|'team', teamId, createdBy, createdAt, data: {...} }
    qaLog: [], // { id, questionId, category, title, prompt, askedBy, askedTeamId, askedAt, answer, answeredBy, answeredAt, photoDataUrl }
    activeCurses: [], // { id, curseId, title, description, fromTeamId, targetTeamId, castAt, expiresAt }
    activeTransitBurn: null, // { mode, label, coinsPerMin, startedAt, teamId }
    feed: [
      {
        id: uid('ev'),
        type: 'system',
        text: 'Welcome to Jet Lag: Sydney Edition! Pick a game mode, explore the real-world Sydney network, spin the challenge wheel, or start a live room.',
        author: 'System',
        teamId: null,
        timestamp: Date.now()
      }
    ],
    decks: {
      challenges: structuredClone(DEFAULT_CHALLENGES),
      curses: structuredClone(DEFAULT_CURSES),
      questions: structuredClone(HIDE_SEEK_QUESTIONS)
    }
  };
}

class Store {
  constructor() {
    this.listeners = new Set();
    this.state = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createInitialState();
      const parsed = JSON.parse(raw);
      const base = createInitialState();
      const merged = {
        ...base,
        ...parsed,
        room: { ...base.room, ...(parsed.room || {}), connected: false, statusText: 'Solo / Local Mode' },
        game: { ...base.game, ...(parsed.game || {}), rules: { ...base.game.rules, ...(parsed.game?.rules || {}) } },
        dividingLine: { ...base.dividingLine, ...(parsed.dividingLine || {}) },
        winSectors: { ...base.winSectors, ...(parsed.winSectors || {}) },
        decks: {
          challenges: parsed.decks?.challenges?.length ? parsed.decks.challenges : base.decks.challenges,
          curses: parsed.decks?.curses?.length ? parsed.decks.curses : base.decks.curses,
          questions: parsed.decks?.questions?.length ? parsed.decks.questions : base.decks.questions
        }
      };
      if (!merged.players[merged.localPlayerId]) {
        merged.players[merged.localPlayerId] = base.players[base.localPlayerId];
        merged.players[merged.localPlayerId].id = merged.localPlayerId;
      }
      return merged;
    } catch {
      return createInitialState();
    }
  }

  save() {
    try {
      // Trim photo proofs if storage gets large
      const copy = { ...this.state };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    } catch {
      try {
        const trimmed = {
          ...this.state,
          feed: this.state.feed.slice(-40).map((f) => ({ ...f, photoDataUrl: undefined }))
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {}
    }
  }

  get() {
    return this.state;
  }

  getLocalPlayer() {
    return this.state.players[this.state.localPlayerId];
  }

  getLocalTeam() {
    const p = this.getLocalPlayer();
    return this.state.teams.find((t) => t.id === p?.teamId) || this.state.teams[0];
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(reason = 'update', sync = true) {
    this.state.updatedAt = Date.now();
    this.save();
    for (const fn of this.listeners) {
      try { fn(this.state, reason, sync); } catch (e) { console.error(e); }
    }
  }

  mutate(mutator, reason = 'update', sync = true) {
    mutator(this.state);
    this.notify(reason, sync);
  }

  addFeed(entry, sync = true) {
    const p = this.getLocalPlayer();
    this.mutate((s) => {
      s.feed.push({
        id: uid('ev'),
        type: entry.type || 'chat',
        text: entry.text,
        detail: entry.detail || '',
        photoDataUrl: entry.photoDataUrl || null,
        author: entry.author || p?.name || 'Player',
        teamId: entry.teamId !== undefined ? entry.teamId : (p?.teamId || null),
        timestamp: Date.now()
      });
      if (s.feed.length > 150) s.feed = s.feed.slice(-150);
    }, 'feed', sync);
  }

  /** Extract the shared room payload that gets broadcast between devices */
  getSharedSnapshot() {
    const s = this.state;
    return {
      updatedAt: s.updatedAt,
      game: s.game,
      teams: s.teams,
      players: s.players,
      claimedStations: s.claimedStations,
      flags: s.flags,
      checkpoints: s.checkpoints,
      hidingZone: s.hidingZone,
      dividingLine: s.dividingLine,
      winSectors: s.winSectors,
      annotations: s.annotations,
      qaLog: s.qaLog,
      activeCurses: s.activeCurses,
      feed: s.feed.slice(-80),
      decks: s.decks
    };
  }

  /** Merge an incoming shared snapshot from host/Firebase without clobbering local identity or preferences */
  applySharedSnapshot(snap) {
    if (!snap) return;
    this.mutate((s) => {
      const myId = s.localPlayerId;
      const myLocalPlayer = s.players[myId];
      if (snap.game) s.game = { ...s.game, ...snap.game };
      if (snap.teams) s.teams = snap.teams;
      if (snap.players) {
        s.players = { ...snap.players };
        if (myLocalPlayer) {
          s.players[myId] = {
            ...(snap.players[myId] || {}),
            ...myLocalPlayer,
            // Allow host role/team reassignment only if local wasn't just changed
            teamId: myLocalPlayer.teamId || snap.players[myId]?.teamId || s.teams[0]?.id
          };
        }
      }
      if (snap.claimedStations) s.claimedStations = snap.claimedStations;
      if (snap.flags) s.flags = snap.flags;
      if (snap.checkpoints) s.checkpoints = snap.checkpoints;
      if (snap.hidingZone !== undefined) s.hidingZone = snap.hidingZone;
      if (snap.dividingLine) s.dividingLine = snap.dividingLine;
      if (snap.winSectors) s.winSectors = snap.winSectors;
      if (snap.annotations) s.annotations = snap.annotations;
      if (snap.qaLog) s.qaLog = snap.qaLog;
      if (snap.activeCurses) s.activeCurses = snap.activeCurses;
      if (snap.feed) s.feed = snap.feed;
      if (snap.decks) s.decks = snap.decks;
    }, 'remote_sync', false);
  }

  resetGameOnly() {
    this.mutate((s) => {
      s.game.status = 'lobby';
      s.game.startedAt = null;
      s.game.elapsedBeforePauseMs = 0;
      s.game.hidingEndsAt = null;
      s.claimedStations = {};
      s.flags = [];
      s.checkpoints = [];
      s.hidingZone = null;
      s.annotations = [];
      s.qaLog = [];
      s.activeCurses = [];
      s.activeTransitBurn = null;
      s.winSectors.labels = ['North & Beaches', 'South & Coast', 'West & Parramatta'];
      s.teams.forEach((t) => {
        t.coins = 1500;
        t.points = 0;
        t.vetoEndsAt = 0;
        t.doubleNext = false;
        t.activeChallenge = null;
      });
      s.feed = [{
        id: uid('ev'),
        type: 'system',
        text: `Game reset for ${GAME_MODES[s.game.mode]?.name || 'Custom Mode'}. Ready in Lobby!`,
        author: 'System',
        teamId: null,
        timestamp: Date.now()
      }];
    }, 'reset');
  }
}

export const store = new Store();
