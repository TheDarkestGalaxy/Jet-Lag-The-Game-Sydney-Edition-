// Jet Lag: Sydney Edition — Main Application Orchestrator
import { SYDNEY_NETWORK } from '../data/sydney-network.js';
import { CHALLENGE_CATEGORIES, POWERUPS_SHOP, TRANSIT_RATES, DEFAULT_CHALLENGES, DEFAULT_CURSES } from '../data/challenges.js';
import { store, uid } from './state.js';
import {
  GAME_MODES,
  RULE_MODULES,
  CTF_PRESETS,
  RACE_PRESETS,
  getDefaultRulesForMode,
  computeRailRushStats,
  formatDistance,
  formatClock,
  getDividingSide
} from './modes.js';
import { SydneyMapController } from './map.js';
import { ChallengeWheel } from './wheel.js';
import { MultiplayerManager, generateRoomCode, compressImageFile } from './multiplayer.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class JetLagSydneyApp {
  constructor() {
    this.activeTab = 'game';
    this.wheelMode = 'challenges'; // 'challenges' | 'curses'
    this.wheelCat = 'all';
    this.wheelDiff = 'all';
    this.landedCard = null;
    this.feedFilter = 'all';
    this.showDeckBuilder = false;
    this.showRulesConfig = false;
    this.pendingPhotoDataUrl = null;
    this.qaCategoryFilter = 'Radar';

    this.mapCtrl = null;
    this.wheel = null;
    this.mp = null;
  }

  init() {
    // Register PWA Service Worker
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Apply saved theme
    this.applyTheme(store.get().theme);

    // Update network badge
    const metaEl = document.getElementById('network-meta-sub');
    if (metaEl) {
      metaEl.textContent = `${SYDNEY_NETWORK.stations.length} Real Stops • ${SYDNEY_NETWORK.lines.length} Lines`;
    }

    // Init Multiplayer Manager
    this.mp = new MultiplayerManager({
      onToast: (msg) => this.toast(msg),
      onGpsUpdate: () => {
        if (this.activeTab === 'live' || this.activeTab === 'game') this.renderDynamicPanes();
      }
    });

    // Init Interactive Sydney Map
    this.mapCtrl = new SydneyMapController('sydney-map', {
      onToast: (msg) => this.toast(msg),
      onToolStatus: (hint) => this.updateToolBanner(hint),
      onLineClick: (line) => {
        this.toast(`${line.code}: ${line.name} (${line.stationIds.length} stops)`);
      },
      onToggleClaim: (station, claim) => this.toggleStationClaim(station, claim),
      onSetHidingZone: (station) => this.setHidingZoneAt(station),
      onDropFlag: (station) => this.dropFlagAt(station),
      onAddCheckpoint: (station) => this.addCheckpoint(station),
      onCheckCheckpoint: (cpId) => this.toggleCheckpointDone(cpId),
      onQuickRadar: (lat, lng, label) => this.openRadarModal(lat, lng, label),
      onRequestThermometer: (pA, pB) => this.openThermometerModal(pA, pB),
      onRequestPin: (lat, lng) => this.openPinModal(lat, lng)
    });
    this.mapCtrl.init();

    // Init Canvas Challenge Wheel
    const canvas = document.getElementById('challenge-wheel-canvas');
    this.wheel = new ChallengeWheel(canvas, {
      onSpinStart: () => {
        this.landedCard = null;
        this.renderWheelLanded();
      },
      onLand: (item) => {
        this.landedCard = { ...item, wheelMode: this.wheelMode };
        this.renderWheelLanded();
        this.toast(`Landed on: ${item.title}!`);
      }
    });

    this.bindStaticUI();
    this.refreshWheelPool();
    this.renderAll();

    // Subscribe to reactive state changes
    store.subscribe((state, reason) => {
      this.renderTopbar(state);
      if (reason !== 'gps') {
        this.renderDynamicPanes();
      } else if (this.activeTab === 'live') {
        this.renderLivePane();
      }
    });

    // 1-second live timer ticker (updates clocks/veto/curses without resetting inputs!)
    setInterval(() => this.tickTimers(), 1000);

    // Auto-join room from URL query string (?room=SYD-XXXX&fb=...)
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const fbParam = params.get('fb');
    if (roomParam) {
      setTimeout(() => {
        if (fbParam) {
          this.mp.connectFirebaseRoom(fbParam, roomParam);
        } else {
          this.mp.joinPeerRoom(roomParam);
        }
        this.switchTab('live');
      }, 400);
    }
  }

  // ===== STATIC EVENT BINDINGS =====
  bindStaticUI() {
    // Desktop side panel tabs
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Mobile bottom nav
    document.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.mobileTab;
        document.querySelectorAll('[data-mobile-tab]').forEach((b) => b.classList.toggle('active', b === btn));
        const drawer = document.getElementById('side-panel');
        if (target === 'map') {
          drawer.classList.remove('mobile-open');
          this.mapCtrl.invalidateSize();
        } else {
          this.switchTab(target);
          drawer.classList.add('mobile-open');
        }
      });
    });

    document.getElementById('btn-close-mobile-drawer')?.addEventListener('click', () => {
      document.getElementById('side-panel').classList.remove('mobile-open');
      document.querySelectorAll('[data-mobile-tab]').forEach((b) => b.classList.toggle('active', b.dataset.mobileTab === 'map'));
    });

    // Topbar buttons
    document.getElementById('topbar-mode-btn').addEventListener('click', () => this.openTabOnMobileOrDesktop('game'));
    document.getElementById('topbar-room-btn').addEventListener('click', () => this.openTabOnMobileOrDesktop('live'));
    document.getElementById('topbar-clock-btn').addEventListener('click', () => this.toggleGameClock());
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      const next = store.get().theme === 'dark' ? 'light' : 'dark';
      store.mutate((s) => { s.theme = next; }, 'theme', false);
      this.applyTheme(next);
    });
    document.getElementById('btn-sound-toggle').addEventListener('click', () => {
      store.mutate((s) => { s.soundEnabled = !s.soundEnabled; }, 'sound', false);
      this.renderTopbar(store.get());
    });

    // Station search autocomplete
    const searchInput = document.getElementById('station-search-input');
    const searchResults = document.getElementById('station-search-results');
    const searchClear = document.getElementById('station-search-clear');

    const updateSearch = () => {
      const q = searchInput.value.trim().toLowerCase();
      searchClear.style.display = q ? 'inline-flex' : 'none';
      if (!q) {
        searchResults.classList.remove('open');
        searchResults.innerHTML = '';
        return;
      }
      const matches = SYDNEY_NETWORK.stations
        .filter((st) => st.name.toLowerCase().includes(q) || st.lines.some((l) => l.toLowerCase() === q) || st.region.toLowerCase().includes(q))
        .sort((a, b) => {
          const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          return aStarts - bStarts || b.lines.length - a.lines.length;
        })
        .slice(0, 12);

      if (!matches.length) {
        searchResults.innerHTML = `<div style="padding:10px 12px" class="muted">No stations matching "${esc(q)}"</div>`;
      } else {
        searchResults.innerHTML = matches
          .map((st) => {
            const pills = st.lines
              .slice(0, 4)
              .map((c) => {
                const ln = this.mapCtrl.lineByCode.get(c);
                return `<span class="line-pill sm" style="background:${ln?.color || '#64748b'};color:${ln?.textColor || '#fff'}">${c}</span>`;
              })
              .join('');
            return `
              <button class="search-item" data-fly-station="${st.id}">
                <div>
                  <div class="search-item-name">${esc(st.name)}</div>
                  <div class="search-item-sub">${esc(st.region)}</div>
                </div>
                <div class="row" style="gap:3px">${pills}</div>
              </button>
            `;
          })
          .join('');
      }
      searchResults.classList.add('open');
    };

    searchInput.addEventListener('input', updateSearch);
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      updateSearch();
    });
    searchResults.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fly-station]');
      if (!btn) return;
      this.mapCtrl.flyToStation(btn.dataset.flyStation);
      searchResults.classList.remove('open');
      searchInput.blur();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.map-search-bar')) searchResults.classList.remove('open');
    });

    // Map strategy tool buttons
    document.querySelectorAll('[data-map-tool]').forEach((btn) => {
      btn.addEventListener('click', () => this.selectMapTool(btn.dataset.mapTool));
    });
    document.getElementById('btn-undo-ann').addEventListener('click', () => {
      if (!store.get().annotations.length) return this.toast('Nothing to undo.');
      store.mutate((s) => { s.annotations.pop(); }, 'annotation');
      this.toast('Removed last map overlay.');
    });
    document.getElementById('btn-clear-ann').addEventListener('click', () => {
      if (!store.get().annotations.length) return;
      if (confirm('Clear all strategy overlays (radars, thermometers, zones, pins)?')) {
        store.mutate((s) => { s.annotations = []; }, 'annotation');
        this.toast('Cleared all map overlays.');
      }
    });

    document.getElementById('btn-tool-cancel').addEventListener('click', () => this.selectMapTool('select'));
    document.getElementById('btn-tool-finish').addEventListener('click', () => {
      this.mapCtrl.finishDraftTool();
      this.selectMapTool('select');
    });
    document.getElementById('btn-tool-gps').addEventListener('click', () => {
      const p = store.getLocalPlayer();
      if (p?.lat == null) return this.toast('Enable GPS (or place a Demo Pin in Live tab) first!');
      this.openRadarModal(p.lat, p.lng, 'My GPS');
    });

    // Map Quick Views & Basemap
    document.getElementById('btn-locate-me').addEventListener('click', () => {
      const p = store.getLocalPlayer();
      if (p?.lat != null) {
        this.mapCtrl.flyToCoord(p.lat, p.lng, 15);
      } else {
        this.mp.startGps();
        this.toast('Requesting live GPS location…');
      }
    });
    document.getElementById('btn-fit-sydney').addEventListener('click', () => this.mapCtrl.fitGreaterSydney());
    document.getElementById('btn-fit-nsw').addEventListener('click', () => this.mapCtrl.fitFullNetwork());
    document.getElementById('btn-toggle-labels').addEventListener('click', (e) => {
      const next = !this.mapCtrl.showStationLabels;
      this.mapCtrl.setShowLabels(next);
      e.currentTarget.classList.toggle('active', next);
    });
    document.getElementById('basemap-select').addEventListener('change', (e) => {
      this.mapCtrl.setBasemap(e.target.value);
    });

    // Transit Mode Filter Chips
    document.querySelectorAll('[data-transit-mode]').forEach((chip) => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('on');
        this.mapCtrl.setModeFilter(chip.dataset.transitMode, chip.classList.contains('on'));
      });
    });

    // Wheel controls
    document.getElementById('wheel-type-challenges').addEventListener('click', () => {
      this.wheelMode = 'challenges';
      this.refreshWheelPool();
    });
    document.getElementById('wheel-type-curses').addEventListener('click', () => {
      this.wheelMode = 'curses';
      this.refreshWheelPool();
    });
    document.getElementById('btn-spin-wheel').addEventListener('click', () => this.wheel.spin());
    document.getElementById('challenge-wheel-canvas').addEventListener('click', () => this.wheel.spin());
    document.getElementById('btn-shuffle-wheel').addEventListener('click', () => {
      this.refreshWheelPool();
      this.toast('Shuffled wheel slices from active deck!');
    });

    // Modal backdrop close
    document.getElementById('app-modal').addEventListener('click', (e) => {
      if (e.target.id === 'app-modal') this.closeModal();
    });
  }

  applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light');
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  }

  openTabOnMobileOrDesktop(tabName) {
    this.switchTab(tabName);
    if (window.innerWidth <= 920) {
      document.getElementById('side-panel').classList.add('mobile-open');
      document.querySelectorAll('[data-mobile-tab]').forEach((b) => b.classList.toggle('active', b.dataset.mobileTab === tabName));
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${tabName}`));
    const titles = { game: 'Game Control', wheel: 'Challenge Wheel', shop: 'Shop & Network', feed: 'Live Feed & Chat', live: 'Multiplayer & GPS' };
    const mTitle = document.getElementById('mobile-drawer-title');
    if (mTitle) mTitle.textContent = titles[tabName] || 'Jet Lag: Sydney';
    if (tabName === 'wheel') {
      setTimeout(() => this.wheel.draw(), 60);
    }
    this.renderDynamicPanes();
  }

  selectMapTool(tool) {
    this.mapCtrl.setTool(tool);
    document.querySelectorAll('[data-map-tool]').forEach((b) => b.classList.toggle('active', b.dataset.mapTool === tool));
    this.updateToolBanner(this.mapCtrl.getToolHint());
  }

  updateToolBanner(hint) {
    const banner = document.getElementById('map-tool-banner');
    const hintEl = document.getElementById('map-tool-hint');
    const gpsBtn = document.getElementById('btn-tool-gps');
    const finBtn = document.getElementById('btn-tool-finish');

    if (!hint) {
      banner.classList.remove('visible');
      return;
    }
    banner.classList.add('visible');
    hintEl.textContent = hint;
    gpsBtn.style.display = this.mapCtrl.activeTool === 'radar' ? 'inline-flex' : 'none';
    finBtn.style.display =
      (this.mapCtrl.activeTool === 'polygon' && this.mapCtrl.draftPoints.length >= 3) ||
      (this.mapCtrl.activeTool === 'ruler' && this.mapCtrl.draftPoints.length >= 2)
        ? 'inline-flex'
        : 'none';
  }

  // ===== RENDERERS =====
  renderAll() {
    const s = store.get();
    this.renderTopbar(s);
    this.renderDynamicPanes();
    this.renderWheelFilters();
    this.renderWheelLanded();
  }

  renderDynamicPanes() {
    this.renderGamePane();
    this.renderWheelSideSections();
    this.renderShopPane();
    this.renderFeedPane();
    this.renderLivePane();
  }

  renderTopbar(state) {
    const mode = GAME_MODES[state.game.mode] || GAME_MODES.custom;
    document.getElementById('topbar-mode-label').textContent = mode.shortName;
    document.getElementById('topbar-mode-dot').style.background = mode.color;

    const roomBtn = document.getElementById('topbar-room-btn');
    roomBtn.classList.toggle('live', state.room.connected);
    document.getElementById('topbar-room-label').textContent = state.room.connected
      ? state.room.code
      : 'Solo';

    document.getElementById('btn-sound-toggle').textContent = state.soundEnabled ? '🔊' : '🔇';
    this.tickTimers();
  }

  tickTimers() {
    const s = store.get();
    const myTeam = store.getLocalTeam();
    const clockBtn = document.getElementById('topbar-clock-btn');
    const clockIco = document.getElementById('topbar-clock-ico');
    const clockText = document.getElementById('topbar-clock-text');

    // Priority display: Active Veto countdown > Hiding countdown > Main Game Clock
    const now = Date.now();
    const vetoRem = (myTeam?.vetoEndsAt || 0) - now;
    const hidingRem = (s.game.hidingEndsAt || 0) - now;

    clockBtn.classList.remove('running', 'veto');
    if (vetoRem > 0) {
      clockBtn.classList.add('veto');
      clockIco.textContent = '🚫';
      clockText.textContent = `VETO ${formatClock(vetoRem)}`;
    } else if (s.game.status === 'running' && hidingRem > 0 && s.game.rules.hideSeekQA) {
      clockBtn.classList.add('running');
      clockIco.textContent = '🙈';
      clockText.textContent = `HIDE ${formatClock(hidingRem)}`;
    } else {
      let elapsed = s.game.elapsedBeforePauseMs || 0;
      if (s.game.status === 'running' && s.game.startedAt) {
        elapsed += now - s.game.startedAt;
        clockBtn.classList.add('running');
      }
      clockIco.textContent = s.game.status === 'running' ? '▶️' : s.game.status === 'paused' ? '⏸️' : '⏱️';
      clockText.textContent = formatClock(elapsed);
    }

    // Update inline dynamic countdown spans (curses, transit burn, tracker freeze)
    document.querySelectorAll('[data-countdown-until]').forEach((el) => {
      const until = Number(el.dataset.countdownUntil);
      const rem = until - now;
      el.textContent = rem > 0 ? formatClock(rem) : 'Expired';
    });
    document.querySelectorAll('[data-burn-since]').forEach((el) => {
      const since = Number(el.dataset.burnSince);
      const rate = Number(el.dataset.burnRate);
      const mins = Math.max(0, (now - since) / 60000);
      el.textContent = `${formatClock(now - since)} • ~${Math.round(mins * rate)} coins`;
    });
  }

  toggleGameClock() {
    store.mutate((s) => {
      const now = Date.now();
      if (s.game.status === 'running') {
        s.game.elapsedBeforePauseMs += now - (s.game.startedAt || now);
        s.game.startedAt = null;
        s.game.status = 'paused';
      } else {
        if (s.game.status === 'lobby' && s.game.rules.hideSeekQA && s.game.hidingMins > 0) {
          s.game.hidingEndsAt = now + s.game.hidingMins * 60000;
        }
        s.game.startedAt = now;
        s.game.status = 'running';
      }
    }, 'clock');
    const status = store.get().game.status;
    store.addFeed({ type: 'system', text: status === 'running' ? 'Game clock STARTED!' : 'Game clock PAUSED.' });
  }

  // ===== TAB 1: GAME PANE =====
  renderGamePane() {
    const pane = document.getElementById('pane-game');
    if (!pane) return;
    const s = store.get();
    const mode = GAME_MODES[s.game.mode] || GAME_MODES.custom;
    const myTeam = store.getLocalTeam();
    const myPlayer = store.getLocalPlayer();

    let html = `
      <!-- Mode Selector Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🎯 Game Mode</div>
          <div class="row">
            <button class="btn btn-xs btn-secondary" id="btn-toggle-rules">${this.showRulesConfig ? 'Hide Rules' : '⚙️ Customize Rules'}</button>
            <button class="btn btn-xs btn-danger" id="btn-reset-game">Reset</button>
          </div>
        </div>
        <div class="mode-grid">
          ${Object.values(GAME_MODES)
            .map(
              (m) => `
              <button class="mode-tile ${s.game.mode === m.id ? 'active' : ''}" data-pick-mode="${m.id}" style="--mcol:${m.color}">
                <div class="mode-tile-top">
                  <span class="mode-tile-name">${esc(m.shortName)}</span>
                  <span class="mode-badge">${m.badge}</span>
                </div>
                <div class="mode-tile-desc">${esc(m.tagline.slice(0, 74))}…</div>
              </button>`
            )
            .join('')}
        </div>
        <div class="muted" style="font-size:12px"><strong>${esc(mode.name)}:</strong> ${esc(mode.tagline)}</div>
        <div class="row">
          <button class="btn btn-primary btn-sm" id="btn-game-start-pause" style="flex:1">
            ${s.game.status === 'running' ? '⏸️ Pause Clock' : s.game.status === 'paused' ? '▶️ Resume Clock' : '▶️ Start Game Clock'}
          </button>
          ${
            s.game.rules.hideSeekQA
              ? `<button class="btn btn-accent btn-sm" id="btn-start-hiding-timer">🙈 ${s.game.hidingMins}m Hide Timer</button>`
              : ''
          }
        </div>
      </div>
    `;

    // Flexible Modular Rules Configurator
    if (this.showRulesConfig || s.game.mode === 'custom') {
      html += `
        <div class="card">
          <div class="card-header">
            <div class="card-title">🧩 Flexible Rule Modules</div>
            <span class="muted">Mix & match any house rules</span>
          </div>
          <div>
            ${RULE_MODULES.map(
              (rm) => `
              <label class="toggle-row">
                <div>
                  <div style="font-size:12.5px;font-weight:700">${esc(rm.label)}</div>
                  <div class="muted" style="font-size:11px">${esc(rm.desc)}</div>
                </div>
                <input type="checkbox" data-rule-toggle="${rm.key}" ${s.game.rules[rm.key] ? 'checked' : ''} />
              </label>`
            ).join('')}
          </div>
        </div>
      `;
    }

    const rrData = s.game.rules.stationClaiming
      ? computeRailRushStats(SYDNEY_NETWORK, s.claimedStations, s.teams, s.game.railRushLineBonus)
      : null;

    // Scoreboard & Teams
    html += `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🏆 Teams & Roles</div>
          <button class="btn btn-xs btn-secondary" id="btn-add-team">+ Add Team</button>
        </div>
        ${s.teams
          .map((t) => {
            const isMine = myTeam?.id === t.id;
            const members = Object.values(s.players).filter((p) => p.teamId === t.id);
            const vetoRem = (t.vetoEndsAt || 0) - Date.now();
            const rrScore = rrData?.teamStats?.[t.id];
            return `
              <div class="team-card" style="--tcol:${t.color}">
                <div class="row-between">
                  <div class="row">
                    <strong style="font-family:var(--font-display)">${esc(t.name)}</strong>
                    ${isMine ? '<span class="tag-pill" style="border-color:var(--accent);color:var(--accent)">YOU</span>' : ''}
                  </div>
                  <div class="row">
                    <select class="select" data-team-role="${t.id}" style="width:auto;padding:3px 7px;font-size:11px">
                      ${['hider', 'seeker', 'runner', 'chaser', 'north', 'south', 'racer', 'team']
                        .map((r) => `<option value="${r}" ${t.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`)
                        .join('')}
                    </select>
                    ${!isMine ? `<button class="btn btn-xs btn-ghost" data-join-team="${t.id}">Join</button>` : ''}
                    <button class="btn btn-xs btn-ghost" data-edit-team="${t.id}" title="Rename / Color">✏️</button>
                  </div>
                </div>
                <div class="team-stat-row">
                  ${s.game.rules.economy ? `<span class="stat-pill">🪙 ${t.coins}</span>` : ''}
                  <span class="stat-pill">⭐ ${t.points + (rrScore?.totalScore || 0)} pts</span>
                  ${rrScore ? `<span class="stat-pill">🚄 ${rrScore.stations} stops</span>` : ''}
                  <span class="muted" style="font-size:11.5px">${members.length ? members.map((m) => esc(m.name)).join(', ') : 'No players'}</span>
                </div>
                ${vetoRem > 0 ? `<div class="sp-badge" style="border-color:#ef4444;color:#f87171">🚫 Veto Cooldown: <span data-countdown-until="${t.vetoEndsAt}">${formatClock(vetoRem)}</span></div>` : ''}
                ${t.doubleNext ? `<div class="sp-badge" style="border-color:#F99D1C;color:#F99D1C">⚡ 2× Double Next Challenge Active!</div>` : ''}
                <div class="row">
                  <button class="btn btn-xs btn-ghost" data-pts-delta="${t.id}:1">+1 pt</button>
                  <button class="btn btn-xs btn-ghost" data-pts-delta="${t.id}:-1">-1 pt</button>
                  ${s.game.rules.economy ? `<button class="btn btn-xs btn-ghost" data-coins-delta="${t.id}:250">+250 🪙</button><button class="btn btn-xs btn-ghost" data-coins-delta="${t.id}:-250">-250 🪙</button>` : ''}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    // === MODE MODULE: HIDE + SEEK ===
    if (s.game.rules.hideSeekQA) {
      const cats = ['Radar', 'Thermometer', 'Matching', 'Measuring', 'Tentacles', 'Photo'];
      const qList = s.decks.questions.filter((q) => q.category === this.qaCategoryFilter);
      const hz = s.hidingZone;
      const canSeeHz = hz && (hz.revealed || hz.setByTeamId === myTeam?.id);

      html += `
        <div class="card">
          <div class="card-header">
            <div class="card-title">🙈 Hide + Seek HQ</div>
            <select id="hs-radius-select" class="select" style="width:auto;padding:4px 7px;font-size:11.5px">
              ${[500, 800, 1000, 1500, 2000].map((r) => `<option value="${r}" ${s.game.hidingRadiusM === r ? 'selected' : ''}>Zone: ${r}m</option>`).join('')}
            </select>
          </div>
          <div class="row">
            <button class="btn btn-accent btn-sm" id="btn-hs-set-nearest" style="flex:1">📍 Set Hiding Zone at Nearest Stop</button>
            ${hz ? `<button class="btn btn-secondary btn-sm" id="btn-hs-reveal">${hz.revealed ? 'Hide Zone' : '👁️ Reveal Zone'}</button>` : ''}
          </div>
          ${canSeeHz ? `<div class="sp-badge" style="border-color:#168388;color:#2dd4bf">Hiding Zone: ${esc(hz.stationName)} (${hz.radiusM}m) ${hz.revealed ? '— REVEALED TO ALL' : '— Hidden from Seekers'}</div>` : `<div class="muted">Tap any station on the map → "Set Hiding Zone Here" (kept hidden from Seekers!).</div>`}

          <div style="border-top:1px solid var(--border);padding-top:9px;display:flex;flex-direction:column;gap:8px">
            <div class="card-title" style="font-size:13px">❓ Seeker Question Deck</div>
            <div class="row" style="gap:4px">
              ${cats.map((c) => `<button class="btn btn-xs ${this.qaCategoryFilter === c ? 'btn-primary' : 'btn-ghost'}" data-qa-cat="${c}">${c}</button>`).join('')}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto">
              ${qList
                .map(
                  (q) => `
                  <div class="feed-item" style="padding:8px">
                    <div class="row-between">
                      <strong style="font-size:12.5px">${esc(q.title)}</strong>
                      <span class="tag-pill">${esc(q.cost)}</span>
                    </div>
                    <div class="muted" style="font-size:11.5px">${esc(q.prompt)}</div>
                    <div class="row">
                      <button class="btn btn-xs btn-primary" data-ask-q="${q.id}">Ask Hider</button>
                      ${q.mapAction === 'radar' ? `<button class="btn btn-xs btn-secondary" data-q-radar="${q.radiusKm}">📡 Draw ${q.radiusKm}km Radar</button>` : ''}
                      ${q.mapAction === 'thermometer' ? `<button class="btn btn-xs btn-secondary" data-q-thermo="1">🌡️ Plot Bisector</button>` : ''}
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          </div>

          ${
            s.qaLog.length
              ? `
            <div style="border-top:1px solid var(--border);padding-top:9px;display:flex;flex-direction:column;gap:6px">
              <div class="card-title" style="font-size:13px">📋 Asked Questions (${s.qaLog.length})</div>
              ${s.qaLog
                .slice()
                .reverse()
                .slice(0, 8)
                .map(
                  (qa) => `
                  <div class="feed-item qa">
                    <div class="row-between">
                      <strong>${esc(qa.title)}</strong>
                      <span class="muted" style="font-size:10.5px">${esc(qa.askedBy)}</span>
                    </div>
                    <div class="muted" style="font-size:11.5px">${esc(qa.prompt)}</div>
                    ${
                      qa.answer
                        ? `<div style="font-size:12.5px;color:#38bdf8;font-weight:700">Answer (${esc(qa.answeredBy)}): ${esc(qa.answer)}</div>`
                        : `<div class="row">
                            <button class="btn btn-xs btn-primary" data-ans-qa="${qa.id}:YES (HIT)">YES / HIT</button>
                            <button class="btn btn-xs btn-danger" data-ans-qa="${qa.id}:NO (MISS)">NO / MISS</button>
                            <button class="btn btn-xs btn-secondary" data-ans-qa="${qa.id}:HOTTER 🔥">HOTTER</button>
                            <button class="btn btn-xs btn-secondary" data-ans-qa="${qa.id}:COLDER ❄️">COLDER</button>
                            <button class="btn btn-xs btn-ghost" data-ans-custom="${qa.id}">Custom…</button>
                          </div>`
                    }
                  </div>`
                )
                .join('')}
            </div>`
              : ''
          }
        </div>
      `;
    }

    // === MODE MODULE: TAG / TRANSIT BURN & WIN SECTORS ===
    if (s.game.rules.transitCosts || s.game.rules.winSectors) {
      const burn = s.activeTransitBurn;
      html += `<div class="card">
        <div class="card-title">🏃 Tag & Transit Engine</div>
        ${
          s.game.rules.transitCosts
            ? burn
              ? `
                <div class="sp-badge" style="border-color:#F99D1C;color:#F99D1C">
                  🚆 Riding ${esc(burn.label)} (${burn.coinsPerMin} 🪙/min)<br/>
                  <span class="mono" data-burn-since="${burn.startedAt}" data-burn-rate="${burn.coinsPerMin}">00:00</span>
                </div>
                <button class="btn btn-danger btn-sm" id="btn-stop-burn">⏹️ Tap Off & Deduct Coins</button>
              `
              : `
                <div class="muted" style="font-size:11.5px">Tap on a transit mode to track real-time Tag coin cost:</div>
                <div class="row">
                  ${TRANSIT_RATES.map(
                    (tr) => `<button class="btn btn-xs btn-secondary" data-start-burn="${tr.mode}" style="border-color:${tr.color}">${tr.mode.replace('_', ' ').toUpperCase()} (${tr.coinsPerMin}/m)</button>`
                  ).join('')}
                </div>
              `
            : ''
        }
        ${
          s.game.rules.winSectors
            ? `
              <div style="border-top:1px solid var(--border);padding-top:9px;display:flex;flex-direction:column;gap:8px">
                <div class="row-between">
                  <strong style="font-size:12.5px">🏁 Win Sectors (Origin: ${esc(s.winSectors.centerName)})</strong>
                  <span class="muted">${s.winSectors.count} slices</span>
                </div>
                <div class="grid-2">
                  <div class="field">
                    <label>Sector Count</label>
                    <select id="ws-count" class="select">
                      ${[2, 3, 4].map((n) => `<option value="${n}" ${s.winSectors.count === n ? 'selected' : ''}>${n} Sectors</option>`).join('')}
                    </select>
                  </div>
                  <div class="field">
                    <label>Rotation (${s.winSectors.rotationDeg}°)</label>
                    <input type="range" id="ws-rot" min="-180" max="180" step="5" value="${s.winSectors.rotationDeg}" />
                  </div>
                </div>
              </div>
            `
            : ''
        }
      </div>`;
    }

    // === MODE MODULE: RAIL RUSH ===
    if (s.game.rules.stationClaiming) {
      const { teamStats, lineProgress } = computeRailRushStats(SYDNEY_NETWORK, s.claimedStations, s.teams, s.game.railRushLineBonus);
      const activeLines = lineProgress.filter((l) => l.total > 0);
      html += `
        <div class="card">
          <div class="card-header">
            <div class="card-title">🚄 Rail Rush Control</div>
            <span class="tag-pill">+${s.game.railRushLineBonus} Line Bonus</span>
          </div>
          <button class="btn btn-primary btn-sm btn-block" id="btn-gps-checkin">📍 GPS Check-In Nearest Station</button>
          <div class="grid-2">
            ${s.teams
              .map((t) => {
                const st = teamStats[t.id] || { stations: 0, completedLines: [], totalScore: 0 };
                return `
                  <div class="feed-item" style="border-left:3px solid ${t.color}">
                    <strong style="font-size:12.5px">${esc(t.name)}</strong>
                    <div class="mono" style="font-size:16px;font-weight:800">${st.totalScore} pts</div>
                    <div class="muted" style="font-size:11px">${st.stations} stops • ${st.completedLines.length} lines</div>
                  </div>
                `;
              })
              .join('')}
          </div>
          <div style="max-height:230px;overflow-y:auto;padding-right:4px">
            ${activeLines
              .map((lp) => {
                const claimedTotal = Object.values(lp.byTeam).reduce((a, b) => a + b, 0);
                const segs = s.teams
                  .map((t) => {
                    const cnt = lp.byTeam[t.id] || 0;
                    const pct = (cnt / lp.total) * 100;
                    return pct > 0 ? `<div class="progress-seg" style="width:${pct}%;background:${t.color}"></div>` : '';
                  })
                  .join('');
                return `
                  <div class="progress-row">
                    <div class="row-between">
                      <button class="row" style="background:none;border:none;padding:0" data-isolate-line="${lp.code}">
                        <span class="line-pill sm" style="background:${lp.color};color:#fff">${lp.code}</span>
                        <span style="font-size:12px;font-weight:600">${esc(lp.name)}</span>
                      </button>
                      <span class="mono" style="font-size:11px">${claimedTotal}/${lp.total}</span>
                    </div>
                    <div class="progress-bar">${segs}</div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    // === MODE MODULE: CAPTURE THE FLAG ===
    if (s.game.rules.flags || s.game.rules.dividingLine) {
      const mySide =
        myPlayer?.lat != null && s.game.rules.dividingLine
          ? getDividingSide(myPlayer.lat, myPlayer.lng, s.dividingLine)
          : null;

      html += `
        <div class="card">
          <div class="card-title">🚩 Capture the Flag HQ</div>
          ${
            s.game.rules.dividingLine
              ? `
                <div class="field">
                  <label>Territory Dividing Line</label>
                  <select id="ctf-preset-select" class="select">
                    ${CTF_PRESETS.map((p) => `<option value="${p.id}" ${s.dividingLine.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                  </select>
                </div>
                ${
                  mySide
                    ? `<div class="sp-badge" style="border-color:#f59e0b;color:#fbbf24">You are currently in: <strong>${esc(mySide === 'A' ? s.dividingLine.sideALabel : s.dividingLine.sideBLabel)}</strong></div>`
                    : `<div class="muted" style="font-size:11.5px">Enable GPS to see live territory side detection across Sydney Harbour / Parramatta River!</div>`
                }
              `
              : ''
          }
          ${
            s.game.rules.flags
              ? `
                <div class="muted" style="font-size:11.5px">Tap any station on the map → "Drop Flag" to hide flags!</div>
                ${
                  s.flags.length
                    ? s.flags
                        .map((fl) => {
                          const team = s.teams.find((t) => t.id === fl.teamId);
                          return `
                            <div class="feed-item" style="border-left:3px solid ${team?.color || '#F99D1C'}">
                              <div class="row-between">
                                <strong>🚩 ${esc(fl.label)}</strong>
                                <span class="tag-pill">${fl.status.toUpperCase()}</span>
                              </div>
                              <div class="row">
                                <button class="btn btn-xs btn-secondary" data-flag-status="${fl.id}:carried">Pick Up</button>
                                <button class="btn btn-xs btn-primary" data-flag-status="${fl.id}:captured">🏆 Capture (+1)</button>
                                <button class="btn btn-xs btn-ghost" data-flag-status="${fl.id}:base">Reset</button>
                                <button class="btn btn-xs btn-danger" data-flag-del="${fl.id}">✕</button>
                              </div>
                            </div>`;
                        })
                        .join('')
                    : `<button class="btn btn-secondary btn-sm" id="btn-seed-ctf-flags">⚡ Auto-Place Demo Flags (North Sydney & Parramatta)</button>`
                }
              `
              : ''
          }
        </div>
      `;
    }

    // === MODE MODULE: RACE ACROSS SYDNEY ===
    if (s.game.rules.checkpoints) {
      html += `
        <div class="card">
          <div class="card-title">🏁 Race Across Sydney Checkpoints</div>
          <div class="row">
            <select id="race-preset-select" class="select" style="flex:1">
              <option value="">Load a Sydney Race Preset…</option>
              ${RACE_PRESETS.map((rp) => `<option value="${rp.id}">${esc(rp.name)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary btn-sm" id="btn-load-race-preset">Load</button>
          </div>
          ${
            s.checkpoints.length
              ? s.checkpoints
                  .map((cp, idx) => {
                    const doneTeams = Object.keys(cp.completedBy || {})
                      .map((tid) => s.teams.find((t) => t.id === tid)?.name)
                      .filter(Boolean);
                    const myDone = Boolean(cp.completedBy?.[myTeam?.id]);
                    return `
                      <div class="feed-item" style="border-left:3px solid ${myDone ? '#22c55e' : '#F99D1C'}">
                        <div class="row-between">
                          <button style="background:none;border:none;font-weight:700;font-size:13px;text-align:left" data-fly-cp="${cp.stationId}">
                            #${idx + 1} ${esc(cp.name)}
                          </button>
                          <div class="row">
                            <button class="btn btn-xs ${myDone ? 'btn-accent' : 'btn-primary'}" data-toggle-cp="${cp.id}">${myDone ? '✓ Done' : 'Check In'}</button>
                            <button class="btn btn-xs btn-ghost" data-del-cp="${cp.id}">✕</button>
                          </div>
                        </div>
                        ${doneTeams.length ? `<div class="muted" style="font-size:11px">Cleared by: ${esc(doneTeams.join(', '))}</div>` : ''}
                      </div>`;
                  })
                  .join('')
              : `<div class="muted">Load a preset above or tap any station on the map → "+ Add Checkpoint"!</div>`
          }
        </div>
      `;
    }

    pane.innerHTML = html;
    this.bindGamePaneEvents(pane);
  }

  bindGamePaneEvents(pane) {
    pane.querySelector('#btn-toggle-rules')?.addEventListener('click', () => {
      this.showRulesConfig = !this.showRulesConfig;
      this.renderGamePane();
    });

    pane.querySelector('#btn-reset-game')?.addEventListener('click', () => {
      if (confirm('Reset scores, claims, flags, checkpoints, overlays, and timers for a new round?')) {
        store.resetGameOnly();
        this.toast('Game reset cleanly!');
      }
    });

    pane.querySelector('#btn-game-start-pause')?.addEventListener('click', () => this.toggleGameClock());

    pane.querySelector('#btn-start-hiding-timer')?.addEventListener('click', () => {
      const mins = prompt('Hiding countdown duration in minutes:', String(store.get().game.hidingMins || 45));
      if (!mins) return;
      const num = Math.max(1, Number(mins) || 45);
      store.mutate((s) => {
        s.game.hidingMins = num;
        s.game.hidingEndsAt = Date.now() + num * 60000;
        if (s.game.status === 'lobby') {
          s.game.status = 'running';
          s.game.startedAt = Date.now();
        }
      }, 'clock');
      store.addFeed({ type: 'system', text: `Hiding countdown started (${num} minutes)!` });
    });

    pane.querySelectorAll('[data-pick-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modeId = btn.dataset.pickMode;
        const m = GAME_MODES[modeId];
        store.mutate((s) => {
          s.game.mode = modeId;
          s.game.rules = getDefaultRulesForMode(modeId);
          s.dividingLine.enabled = Boolean(s.game.rules.dividingLine);
          s.winSectors.enabled = Boolean(s.game.rules.winSectors);
          if (m.roles?.length >= 2 && s.teams.length >= 2) {
            s.teams[0].role = m.roles[0];
            s.teams[1].role = m.roles[1];
          }
        }, 'mode');
        store.addFeed({ type: 'system', text: `Switched game mode to ${m.name}!` });
      });
    });

    pane.querySelectorAll('[data-rule-toggle]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.ruleToggle;
        store.mutate((s) => {
          s.game.rules[key] = cb.checked;
          if (key === 'dividingLine') s.dividingLine.enabled = cb.checked;
          if (key === 'winSectors') s.winSectors.enabled = cb.checked;
        }, 'rules');
      });
    });

    pane.querySelector('#btn-add-team')?.addEventListener('click', () => {
      const palette = ['#5AB031', '#C4258F', '#D11F2F', '#168388', '#F99D1C', '#0098CD'];
      const n = store.get().teams.length + 1;
      store.mutate((s) => {
        s.teams.push({
          id: uid('team'),
          name: `Team ${n}`,
          color: palette[n % palette.length],
          role: 'team',
          coins: 1500,
          points: 0,
          vetoEndsAt: 0,
          doubleNext: false,
          activeChallenge: null
        });
      }, 'teams');
    });

    pane.querySelectorAll('[data-team-role]').forEach((sel) => {
      sel.addEventListener('change', () => {
        store.mutate((s) => {
          const t = s.teams.find((x) => x.id === sel.dataset.teamRole);
          if (t) t.role = sel.value;
        }, 'teams');
      });
    });

    pane.querySelectorAll('[data-join-team]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.joinTeam;
        store.mutate((s) => {
          const p = s.players[s.localPlayerId];
          const t = s.teams.find((x) => x.id === tid);
          if (p && t) {
            p.teamId = tid;
            p.color = t.color;
          }
        }, 'teams');
        this.toast('Switched team!');
      });
    });

    pane.querySelectorAll('[data-edit-team]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = store.get().teams.find((x) => x.id === btn.dataset.editTeam);
        if (!t) return;
        const name = prompt('Team name:', t.name);
        if (name && name.trim()) {
          store.mutate((s) => {
            const tm = s.teams.find((x) => x.id === t.id);
            if (tm) tm.name = name.trim();
          }, 'teams');
        }
      });
    });

    pane.querySelectorAll('[data-pts-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [tid, delta] = btn.dataset.ptsDelta.split(':');
        store.mutate((s) => {
          const t = s.teams.find((x) => x.id === tid);
          if (t) t.points = Math.max(0, t.points + Number(delta));
        }, 'score');
      });
    });

    pane.querySelectorAll('[data-coins-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [tid, delta] = btn.dataset.coinsDelta.split(':');
        store.mutate((s) => {
          const t = s.teams.find((x) => x.id === tid);
          if (t) t.coins = Math.max(0, t.coins + Number(delta));
        }, 'score');
      });
    });

    // Hide+Seek events
    pane.querySelector('#hs-radius-select')?.addEventListener('change', (e) => {
      const r = Number(e.target.value);
      store.mutate((s) => {
        s.game.hidingRadiusM = r;
        if (s.hidingZone) s.hidingZone.radiusM = r;
      }, 'hideseek');
    });

    pane.querySelector('#btn-hs-set-nearest')?.addEventListener('click', () => {
      const p = store.getLocalPlayer();
      if (p?.lat == null) return this.toast('Enable GPS or place a Demo Pin (Live tab) — or tap any station on the map!');
      const nearest = this.mapCtrl.findNearestStation(p.lat, p.lng);
      if (nearest) this.setHidingZoneAt(nearest.station);
    });

    pane.querySelector('#btn-hs-reveal')?.addEventListener('click', () => {
      store.mutate((s) => {
        if (s.hidingZone) s.hidingZone.revealed = !s.hidingZone.revealed;
      }, 'hideseek');
      const rev = store.get().hidingZone?.revealed;
      store.addFeed({ type: 'system', text: rev ? 'Hiding Zone REVEALED to all players!' : 'Hiding Zone hidden again.' });
    });

    pane.querySelectorAll('[data-qa-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.qaCategoryFilter = btn.dataset.qaCat;
        this.renderGamePane();
      });
    });

    pane.querySelectorAll('[data-ask-q]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = store.get().decks.questions.find((x) => x.id === btn.dataset.askQ);
        if (!q) return;
        const p = store.getLocalPlayer();
        const t = store.getLocalTeam();
        store.mutate((s) => {
          s.qaLog.push({
            id: uid('qa'),
            questionId: q.id,
            category: q.category,
            title: q.title,
            prompt: q.prompt,
            askedBy: p.name,
            askedTeamId: t.id,
            askedAt: Date.now(),
            answer: null,
            answeredBy: null,
            answeredAt: null
          });
        }, 'qa');
        store.addFeed({ type: 'qa', text: `asked [${q.title}]: ${q.prompt}` });
        this.toast(`Asked Hider: ${q.title}`);
      });
    });

    pane.querySelectorAll('[data-q-radar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const km = Number(btn.dataset.qRadar);
        const p = store.getLocalPlayer();
        if (p?.lat != null) {
          this.openRadarModal(p.lat, p.lng, 'My GPS', km);
        } else {
          this.selectMapTool('radar');
          this.toast(`Tap anywhere on the map to place your ${km} km Radar!`);
        }
      });
    });

    pane.querySelectorAll('[data-q-thermo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectMapTool('thermometer');
        if (window.innerWidth <= 920) document.getElementById('side-panel').classList.remove('mobile-open');
      });
    });

    pane.querySelectorAll('[data-ans-qa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [qaId, answer] = btn.dataset.ansQa.split(':');
        this.answerQuestion(qaId, answer);
      });
    });

    pane.querySelectorAll('[data-ans-custom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ans = prompt('Enter your answer to this Hide + Seek question:');
        if (ans && ans.trim()) this.answerQuestion(btn.dataset.ansCustom, ans.trim());
      });
    });

    // Tag Transit Burn & Win Sectors
    pane.querySelectorAll('[data-start-burn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = TRANSIT_RATES.find((r) => r.mode === btn.dataset.startBurn);
        if (!tr) return;
        store.mutate((s) => {
          s.activeTransitBurn = { ...tr, startedAt: Date.now(), teamId: store.getLocalTeam().id };
        }, 'burn');
        store.addFeed({ type: 'system', text: `tapped onto ${tr.label} (${tr.coinsPerMin} coins/min).` });
      });
    });

    pane.querySelector('#btn-stop-burn')?.addEventListener('click', () => {
      const burn = store.get().activeTransitBurn;
      if (!burn) return;
      const mins = Math.max(1, Math.ceil((Date.now() - burn.startedAt) / 60000));
      const cost = mins * burn.coinsPerMin;
      store.mutate((s) => {
        const t = s.teams.find((x) => x.id === burn.teamId);
        if (t) t.coins = Math.max(0, t.coins - cost);
        s.activeTransitBurn = null;
      }, 'burn');
      store.addFeed({ type: 'system', text: `tapped off ${burn.label} after ${mins}m (-${cost} coins).` });
      this.toast(`Deducted ${cost} coins (${mins} min ride)`);
    });

    pane.querySelector('#ws-count')?.addEventListener('change', (e) => {
      store.mutate((s) => { s.winSectors.count = Number(e.target.value); }, 'sectors');
    });
    pane.querySelector('#ws-rot')?.addEventListener('input', (e) => {
      store.mutate((s) => { s.winSectors.rotationDeg = Number(e.target.value); }, 'sectors');
    });

    // Rail Rush
    pane.querySelector('#btn-gps-checkin')?.addEventListener('click', () => {
      const p = store.getLocalPlayer();
      if (p?.lat == null) return this.toast('Turn on GPS or place a Demo Pin in the Live tab first!');
      const res = this.mapCtrl.findNearestStation(p.lat, p.lng);
      if (!res) return;
      if (res.distanceM > 500) {
        if (!confirm(`Nearest station is ${res.station.name} (${formatDistance(res.distanceM)} away). Claim it anyway?`)) return;
      }
      this.toggleStationClaim(res.station, true);
      this.mapCtrl.flyToStation(res.station.id);
    });

    pane.querySelectorAll('[data-isolate-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = this.mapCtrl.toggleIsolateLine(btn.dataset.isolateLine);
        this.toast(code ? `Highlighting ${code}` : 'Showing all Sydney lines');
      });
    });

    // CTF
    pane.querySelector('#ctf-preset-select')?.addEventListener('change', (e) => {
      const p = CTF_PRESETS.find((x) => x.id === e.target.value);
      if (p) store.mutate((s) => { s.dividingLine = { ...p, enabled: true }; }, 'ctf');
    });

    pane.querySelectorAll('[data-flag-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [fid, status] = btn.dataset.flagStatus.split(':');
        store.mutate((s) => {
          const f = s.flags.find((x) => x.id === fid);
          if (!f) return;
          f.status = status;
          if (status === 'captured') {
            const myTeam = store.getLocalTeam();
            if (myTeam) myTeam.points += 1;
          }
        }, 'ctf');
        store.addFeed({ type: 'system', text: `updated flag status to ${status.toUpperCase()}!` });
      });
    });

    pane.querySelectorAll('[data-flag-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.mutate((s) => { s.flags = s.flags.filter((x) => x.id !== btn.dataset.flagDel); }, 'ctf');
      });
    });

    pane.querySelector('#btn-seed-ctf-flags')?.addEventListener('click', () => {
      const ns = SYDNEY_NETWORK.stations.find((s) => s.name === 'North Sydney');
      const parra = SYDNEY_NETWORK.stations.find((s) => s.name === 'Parramatta');
      const teams = store.get().teams;
      store.mutate((s) => {
        if (ns) s.flags.push({ id: uid('flg'), label: `${teams[0]?.name || 'North'} Flag`, teamId: teams[0]?.id, status: 'base', stationId: ns.id, lat: ns.lat, lng: ns.lng });
        if (parra) s.flags.push({ id: uid('flg'), label: `${teams[1]?.name || 'South'} Flag`, teamId: teams[1]?.id || teams[0]?.id, status: 'base', stationId: parra.id, lat: parra.lat, lng: parra.lng });
      }, 'ctf');
      this.toast('Placed starter flags at North Sydney & Parramatta!');
    });

    // Race Across Sydney
    pane.querySelector('#btn-load-race-preset')?.addEventListener('click', () => {
      const id = pane.querySelector('#race-preset-select')?.value;
      const preset = RACE_PRESETS.find((r) => r.id === id);
      if (!preset) return this.toast('Select a race preset first.');
      const cps = [];
      preset.stationNames.forEach((nm, idx) => {
        const st = SYDNEY_NETWORK.stations.find((x) => x.name.toLowerCase() === nm.toLowerCase());
        if (st) cps.push({ id: uid('cp'), stationId: st.id, name: st.name, lat: st.lat, lng: st.lng, order: idx + 1, completedBy: {} });
      });
      store.mutate((s) => { s.checkpoints = cps; }, 'race');
      store.addFeed({ type: 'system', text: `loaded Race preset: ${preset.name} (${cps.length} checkpoints)!` });
      this.mapCtrl.fitGreaterSydney();
    });

    pane.querySelectorAll('[data-fly-cp]').forEach((btn) => {
      btn.addEventListener('click', () => this.mapCtrl.flyToStation(btn.dataset.flyCp));
    });
    pane.querySelectorAll('[data-toggle-cp]').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleCheckpointDone(btn.dataset.toggleCp));
    });
    pane.querySelectorAll('[data-del-cp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.mutate((s) => { s.checkpoints = s.checkpoints.filter((c) => c.id !== btn.dataset.delCp); }, 'race');
      });
    });
  }

  // ===== GAME ACTION HELPERS =====
  toggleStationClaim(station, claim) {
    const myTeam = store.getLocalTeam();
    const myPlayer = store.getLocalPlayer();
    store.mutate((s) => {
      if (claim) {
        s.claimedStations[station.id] = { teamId: myTeam.id, playerId: myPlayer.id, playerName: myPlayer.name, claimedAt: Date.now() };
      } else {
        delete s.claimedStations[station.id];
      }
    }, 'claim');
    store.addFeed({
      type: 'challenge',
      text: claim ? `claimed ${station.name} (${station.lines.join(', ')}) for ${myTeam.name}!` : `released claim on ${station.name}.`
    });
    this.toast(claim ? `Claimed ${station.name}!` : `Unclaimed ${station.name}`);
  }

  setHidingZoneAt(station) {
    const myTeam = store.getLocalTeam();
    const radiusM = store.get().game.hidingRadiusM || 500;
    store.mutate((s) => {
      s.hidingZone = {
        lat: station.lat,
        lng: station.lng,
        radiusM,
        stationId: station.id,
        stationName: station.name,
        setByTeamId: myTeam.id,
        revealed: false
      };
    }, 'hideseek');
    this.toast(`Hiding Zone locked at ${station.name} (${radiusM}m) — hidden from Seekers!`);
  }

  dropFlagAt(station) {
    const myTeam = store.getLocalTeam();
    store.mutate((s) => {
      s.flags.push({
        id: uid('flg'),
        label: `${myTeam.name} @ ${station.name}`,
        teamId: myTeam.id,
        status: 'base',
        stationId: station.id,
        lat: station.lat,
        lng: station.lng
      });
    }, 'ctf');
    store.addFeed({ type: 'system', text: `placed a flag for ${myTeam.name} at ${station.name}!` });
  }

  addCheckpoint(station) {
    store.mutate((s) => {
      s.checkpoints.push({
        id: uid('cp'),
        stationId: station.id,
        name: station.name,
        lat: station.lat,
        lng: station.lng,
        order: s.checkpoints.length + 1,
        completedBy: {}
      });
    }, 'race');
    this.toast(`Added checkpoint: ${station.name}`);
  }

  toggleCheckpointDone(cpId) {
    const myTeam = store.getLocalTeam();
    let cpName = '';
    let nowDone = false;
    store.mutate((s) => {
      const cp = s.checkpoints.find((c) => c.id === cpId);
      if (!cp) return;
      cpName = cp.name;
      if (!cp.completedBy) cp.completedBy = {};
      if (cp.completedBy[myTeam.id]) {
        delete cp.completedBy[myTeam.id];
      } else {
        cp.completedBy[myTeam.id] = Date.now();
        myTeam.points += 1;
        nowDone = true;
      }
    }, 'race');
    if (nowDone) store.addFeed({ type: 'challenge', text: `cleared Race Checkpoint: ${cpName} (+1 pt)!` });
  }

  answerQuestion(qaId, answer) {
    const p = store.getLocalPlayer();
    let title = '';
    store.mutate((s) => {
      const qa = s.qaLog.find((x) => x.id === qaId);
      if (!qa) return;
      qa.answer = answer;
      qa.answeredBy = p.name;
      qa.answeredAt = Date.now();
      title = qa.title;
    }, 'qa');
    store.addFeed({ type: 'qa', text: `answered [${title}]: ${answer}` });
  }

  // ===== TAB 2: WHEEL, ACTIVE CARD, CURSES & DECK BUILDER =====
  refreshWheelPool() {
    const s = store.get();
    document.getElementById('wheel-type-challenges').className = `btn btn-xs ${this.wheelMode === 'challenges' ? 'btn-primary' : 'btn-ghost'}`;
    document.getElementById('wheel-type-curses').className = `btn btn-xs ${this.wheelMode === 'curses' ? 'btn-primary' : 'btn-ghost'}`;

    let pool = [];
    if (this.wheelMode === 'challenges') {
      pool = s.decks.challenges.filter((c) => {
        if (!c.active) return false;
        if (this.wheelCat !== 'all' && c.category !== this.wheelCat) return false;
        if (this.wheelDiff !== 'all' && c.difficulty !== this.wheelDiff) return false;
        return true;
      });
    } else {
      pool = s.decks.curses.filter((c) => c.active);
    }

    this.wheel.setItems(pool);
    this.renderWheelFilters();
    this.renderWheelSideSections();
  }

  renderWheelFilters() {
    const row = document.getElementById('wheel-filter-row');
    if (!row) return;
    if (this.wheelMode === 'curses') {
      row.innerHTML = `<span class="muted">Spinning active Jet Lag Sydney Curse Deck (${store.get().decks.curses.filter((c) => c.active).length} active curses)</span>`;
      return;
    }
    row.innerHTML = `
      <select id="wheel-cat-sel" class="select" style="flex:1;padding:5px 8px;font-size:12px">
        <option value="all">All Categories</option>
        ${CHALLENGE_CATEGORIES.map((c) => `<option value="${c.id}" ${this.wheelCat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
      <select id="wheel-diff-sel" class="select" style="width:110px;padding:5px 8px;font-size:12px">
        <option value="all">Any Diff</option>
        ${['Easy', 'Medium', 'Hard'].map((d) => `<option value="${d}" ${this.wheelDiff === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
    `;
    row.querySelector('#wheel-cat-sel').addEventListener('change', (e) => {
      this.wheelCat = e.target.value;
      this.refreshWheelPool();
    });
    row.querySelector('#wheel-diff-sel').addEventListener('change', (e) => {
      this.wheelDiff = e.target.value;
      this.refreshWheelPool();
    });
  }

  renderWheelLanded() {
    const slot = document.getElementById('wheel-landed-slot');
    if (!slot) return;
    const card = this.landedCard;
    if (!card) {
      slot.innerHTML = '';
      return;
    }
    const myTeam = store.getLocalTeam();
    const isCurse = card.wheelMode === 'curses';
    const reward = isCurse ? card.cost : myTeam?.doubleNext ? card.coins * 2 : card.coins;

    slot.innerHTML = `
      <div class="landed-card">
        <div class="row-between">
          <span class="tag-pill" style="border-color:var(--accent);color:var(--accent)">${isCurse ? '💀 CURSE DRAWN' : `🎯 ${esc(card.difficulty || 'Challenge')}`}</span>
          <span class="mono" style="font-weight:800;color:var(--accent)">${isCurse ? `Cost: ${card.cost} 🪙` : `+${reward} 🪙`}</span>
        </div>
        <h3>${esc(card.title)}</h3>
        <p class="muted" style="color:var(--text)">${esc(card.description)}</p>
        ${
          isCurse
            ? `
              <div class="muted" style="font-size:11.5px">Duration: ${card.durationMins}m • Condition: ${esc(card.castingCondition || 'Standard')}</div>
              <div class="row">
                <button class="btn btn-danger btn-sm" id="btn-cast-landed-curse" style="flex:1">💀 Cast on Opponent</button>
                <button class="btn btn-ghost btn-sm" id="btn-dismiss-landed">Dismiss</button>
              </div>
            `
            : `
              <div class="muted" style="font-size:11.5px">Veto Penalty: ${card.vetoMins} mins ${myTeam?.doubleNext ? '• ⚡ 2× DOUBLE ACTIVE!' : ''}</div>
              <div class="row">
                <button class="btn btn-primary btn-sm" id="btn-accept-landed" style="flex:1">Accept</button>
                <button class="btn btn-accent btn-sm" id="btn-complete-landed">✓ Complete</button>
                <button class="btn btn-danger btn-sm" id="btn-veto-landed">Veto (${card.vetoMins}m)</button>
              </div>
            `
        }
      </div>
    `;

    slot.querySelector('#btn-dismiss-landed')?.addEventListener('click', () => {
      this.landedCard = null;
      this.renderWheelLanded();
    });

    slot.querySelector('#btn-accept-landed')?.addEventListener('click', () => {
      store.mutate((s) => {
        const t = s.teams.find((x) => x.id === myTeam.id);
        if (t) t.activeChallenge = { ...card, acceptedAt: Date.now() };
      }, 'challenge');
      store.addFeed({ type: 'challenge', text: `accepted challenge: "${card.title}" (+${reward} 🪙)!` });
      this.landedCard = null;
      this.renderWheelLanded();
    });

    slot.querySelector('#btn-complete-landed')?.addEventListener('click', () => {
      this.completeChallengeCard(card);
      this.landedCard = null;
      this.renderWheelLanded();
    });

    slot.querySelector('#btn-veto-landed')?.addEventListener('click', () => {
      this.vetoChallengeCard(card);
      this.landedCard = null;
      this.renderWheelLanded();
    });

    slot.querySelector('#btn-cast-landed-curse')?.addEventListener('click', () => {
      this.castCurse(card);
      this.landedCard = null;
      this.renderWheelLanded();
    });
  }

  renderWheelSideSections() {
    const s = store.get();
    const myTeam = store.getLocalTeam();

    // Active Challenge Slot
    const acSlot = document.getElementById('active-challenge-slot');
    if (acSlot) {
      const ac = myTeam?.activeChallenge;
      if (ac) {
        const reward = myTeam.doubleNext ? ac.coins * 2 : ac.coins;
        acSlot.innerHTML = `
          <div class="card" style="border-color:var(--accent-2)">
            <div class="row-between">
              <div class="card-title">🔥 Active Challenge</div>
              <span class="mono" style="color:var(--accent);font-weight:800">+${reward} 🪙</span>
            </div>
            <strong>${esc(ac.title)}</strong>
            <p class="muted">${esc(ac.description)}</p>
            <div class="row">
              <button class="btn btn-primary btn-sm" id="btn-ac-complete" style="flex:1">✓ Complete & Claim</button>
              <button class="btn btn-danger btn-sm" id="btn-ac-veto">🚫 Veto (${ac.vetoMins}m)</button>
            </div>
          </div>
        `;
        acSlot.querySelector('#btn-ac-complete').addEventListener('click', () => this.completeChallengeCard(ac));
        acSlot.querySelector('#btn-ac-veto').addEventListener('click', () => this.vetoChallengeCard(ac));
      } else {
        acSlot.innerHTML = '';
      }
    }

    // Active Curses Slot
    const cuSlot = document.getElementById('active-curses-slot');
    if (cuSlot) {
      const liveCurses = (s.activeCurses || []).filter((c) => c.expiresAt > Date.now());
      cuSlot.innerHTML = liveCurses.length
        ? `
          <div class="card" style="border-color:rgba(239,68,68,0.45)">
            <div class="card-title">💀 Active Curses (${liveCurses.length})</div>
            ${liveCurses
              .map((c) => {
                const target = s.teams.find((t) => t.id === c.targetTeamId);
                return `
                  <div class="feed-item curse">
                    <div class="row-between">
                      <strong>${esc(c.title)}</strong>
                      <span class="mono" style="color:#f87171;font-size:12px" data-countdown-until="${c.expiresAt}">${formatClock(c.expiresAt - Date.now())}</span>
                    </div>
                    <div class="muted" style="font-size:11.5px">Target: <strong>${esc(target?.name || 'Opponents')}</strong> — ${esc(c.description)}</div>
                    <button class="btn btn-xs btn-ghost" data-clear-curse="${c.id}">Clear Curse</button>
                  </div>`;
              })
              .join('')}
          </div>`
        : '';
      cuSlot.querySelectorAll('[data-clear-curse]').forEach((b) => {
        b.addEventListener('click', () => {
          store.mutate((st) => { st.activeCurses = st.activeCurses.filter((x) => x.id !== b.dataset.clearCurse); }, 'curse');
        });
      });
    }

    // Custom Deck Builder Slot
    const dbSlot = document.getElementById('deck-builder-slot');
    if (dbSlot) {
      dbSlot.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">🃏 Custom Deck Builder</div>
            <button class="btn btn-xs btn-secondary" id="btn-toggle-deck-builder">${this.showDeckBuilder ? 'Collapse' : `Edit (${s.decks.challenges.length})`}</button>
          </div>
          ${
            this.showDeckBuilder
              ? `
                <div class="row">
                  <button class="btn btn-xs btn-primary" id="btn-new-challenge">+ Add Challenge</button>
                  <button class="btn btn-xs btn-accent" id="btn-new-curse">+ Add Curse</button>
                  <button class="btn btn-xs btn-secondary" id="btn-export-deck">Export JSON</button>
                  <button class="btn btn-xs btn-secondary" id="btn-import-deck">Import</button>
                  <button class="btn btn-xs btn-ghost" id="btn-reset-deck">Defaults</button>
                </div>
                <div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:5px">
                  ${s.decks.challenges
                    .map(
                      (c) => `
                      <div class="toggle-row">
                        <label class="row" style="flex:1;cursor:pointer">
                          <input type="checkbox" data-toggle-card="challenges:${c.id}" ${c.active ? 'checked' : ''} />
                          <div>
                            <div style="font-size:12px;font-weight:700">${esc(c.title)} <span class="muted">(${c.coins} 🪙)</span></div>
                            <div class="muted" style="font-size:11px">${esc(c.description.slice(0, 72))}…</div>
                          </div>
                        </label>
                        <button class="btn btn-xs btn-ghost" data-del-card="challenges:${c.id}">🗑️</button>
                      </div>`
                    )
                    .join('')}
                </div>
              `
              : `<div class="muted">Add your own Sydney challenges or curses, toggle cards on/off, or export/import custom decks for your group!</div>`
          }
        </div>
      `;

      dbSlot.querySelector('#btn-toggle-deck-builder')?.addEventListener('click', () => {
        this.showDeckBuilder = !this.showDeckBuilder;
        this.renderWheelSideSections();
      });

      dbSlot.querySelector('#btn-new-challenge')?.addEventListener('click', () => this.openAddCardModal('challenge'));
      dbSlot.querySelector('#btn-new-curse')?.addEventListener('click', () => this.openAddCardModal('curse'));
      dbSlot.querySelector('#btn-export-deck')?.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(store.get().decks, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'jetlag-sydney-decks.json';
        a.click();
      });
      dbSlot.querySelector('#btn-import-deck')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'application/json';
        inp.onchange = async () => {
          try {
            const data = JSON.parse(await inp.files[0].text());
            if (!data.challenges) throw new Error('Missing challenges array');
            store.mutate((st) => {
              st.decks.challenges = data.challenges;
              if (data.curses) st.decks.curses = data.curses;
            }, 'deck');
            this.refreshWheelPool();
            this.toast('Imported custom Sydney deck!');
          } catch {
            this.toast('Invalid deck JSON file.');
          }
        };
        inp.click();
      });
      dbSlot.querySelector('#btn-reset-deck')?.addEventListener('click', () => {
        if (confirm('Reset Challenges & Curses back to default Sydney decks?')) {
          store.mutate((st) => {
            st.decks.challenges = structuredClone(DEFAULT_CHALLENGES);
            st.decks.curses = structuredClone(DEFAULT_CURSES);
          }, 'deck');
          this.refreshWheelPool();
        }
      });

      dbSlot.querySelectorAll('[data-toggle-card]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const [kind, id] = cb.dataset.toggleCard.split(':');
          store.mutate((st) => {
            const card = st.decks[kind]?.find((x) => x.id === id);
            if (card) card.active = cb.checked;
          }, 'deck');
          this.refreshWheelPool();
        });
      });

      dbSlot.querySelectorAll('[data-del-card]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [kind, id] = btn.dataset.delCard.split(':');
          store.mutate((st) => {
            st.decks[kind] = st.decks[kind].filter((x) => x.id !== id);
          }, 'deck');
          this.refreshWheelPool();
        });
      });
    }
  }

  completeChallengeCard(card) {
    const myTeam = store.getLocalTeam();
    const mult = myTeam.doubleNext ? 2 : 1;
    const reward = (card.coins || 500) * mult;
    store.mutate((s) => {
      const t = s.teams.find((x) => x.id === myTeam.id);
      if (t) {
        t.coins += reward;
        t.points += 1;
        t.doubleNext = false;
        t.activeChallenge = null;
      }
    }, 'challenge');
    store.addFeed({
      type: 'challenge',
      text: `COMPLETED "${card.title}" (+${reward} 🪙, +1 pt${mult === 2 ? ' — 2× DOUBLED!' : ''})!`
    });
    this.toast(`Completed! +${reward} coins`);
  }

  vetoChallengeCard(card) {
    const myTeam = store.getLocalTeam();
    const mult = myTeam.doubleNext ? 2 : 1;
    const mins = (card.vetoMins || 15) * mult;
    store.mutate((s) => {
      const t = s.teams.find((x) => x.id === myTeam.id);
      if (t) {
        t.vetoEndsAt = Date.now() + mins * 60000;
        t.doubleNext = false;
        t.activeChallenge = null;
      }
    }, 'challenge');
    store.addFeed({
      type: 'challenge',
      text: `VETOED "${card.title}" — ${mins}-minute veto cooldown started!`
    });
    this.toast(`Vetoed! ${mins}m cooldown active.`);
  }

  castCurse(curse) {
    const s = store.get();
    const myTeam = store.getLocalTeam();
    const opponent = s.teams.find((t) => t.id !== myTeam.id) || myTeam;
    if (s.game.rules.economy && myTeam.coins < curse.cost) {
      if (!confirm(`${myTeam.name} only has ${myTeam.coins} coins (Curse costs ${curse.cost}). Cast anyway?`)) return;
    }
    store.mutate((st) => {
      const t = st.teams.find((x) => x.id === myTeam.id);
      if (t && st.game.rules.economy) t.coins = Math.max(0, t.coins - (curse.cost || 0));
      st.activeCurses.push({
        id: uid('ac'),
        curseId: curse.id,
        title: curse.title,
        description: curse.description,
        fromTeamId: myTeam.id,
        targetTeamId: opponent.id,
        castAt: Date.now(),
        expiresAt: Date.now() + (curse.durationMins || 15) * 60000
      });
    }, 'curse');
    store.addFeed({ type: 'curse', text: `CAST "${curse.title}" on ${opponent.name} (${curse.durationMins}m)! ${curse.description}` });
    this.toast(`Curse cast on ${opponent.name}!`);
  }

  // ===== TAB 3: SHOP & FULL SYDNEY LINE EXPLORER =====
  renderShopPane() {
    const pane = document.getElementById('pane-shop');
    if (!pane) return;
    const s = store.get();
    const myTeam = store.getLocalTeam();
    const groups = [
      { mode: 'train', label: 'Sydney Trains (T1–T9)' },
      { mode: 'metro', label: 'Sydney Metro (M1)' },
      { mode: 'light_rail', label: 'Light Rail (L1–L4)' },
      { mode: 'ferry', label: 'Sydney Ferries (F1–F10)' },
      { mode: 'intercity', label: 'NSW Intercity (BMT, CCN, SCO, SHL, HUN)' }
    ];

    pane.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🪙 Powerup Shop</div>
          <span class="stat-pill" style="color:var(--accent)">${esc(myTeam.name)}: ${myTeam.coins} 🪙</span>
        </div>
        ${POWERUPS_SHOP.map(
          (pw) => `
          <div class="feed-item">
            <div class="row-between">
              <strong>${pw.icon} ${esc(pw.title)}</strong>
              <button class="btn btn-xs btn-primary" data-buy-pw="${pw.id}">${pw.cost} 🪙</button>
            </div>
            <div class="muted" style="font-size:11.5px">${esc(pw.description)}</div>
          </div>`
        ).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🚇 Sydney Network Line Explorer</div>
          ${this.mapCtrl.isolatedLine ? `<button class="btn btn-xs btn-secondary" id="btn-show-all-lines">Show All</button>` : `<span class="muted">Tap to isolate</span>`}
        </div>
        ${groups
          .map((g) => {
            const lines = SYDNEY_NETWORK.lines.filter((l) => l.mode === g.mode);
            return `
              <div style="display:flex;flex-direction:column;gap:5px">
                <div style="font-size:11.5px;font-weight:700;color:var(--text-muted)">${g.label}</div>
                <div class="line-grid">
                  ${lines
                    .map(
                      (ln) => `
                      <button class="line-pill ${this.mapCtrl.isolatedLine === ln.code ? 'isolated' : ''}"
                        data-explore-line="${ln.code}"
                        style="background:${ln.color};color:${ln.textColor}"
                        title="${esc(ln.name)} (${ln.stationIds.length} stops)">
                        ${ln.code} <span style="opacity:0.8;font-weight:600;margin-left:3px;font-size:9.5px">${ln.stationIds.length}</span>
                      </button>`
                    )
                    .join('')}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    pane.querySelectorAll('[data-buy-pw]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pw = POWERUPS_SHOP.find((x) => x.id === btn.dataset.buyPw);
        if (!pw) return;
        const team = store.getLocalTeam();
        if (team.coins < pw.cost) return this.toast(`Not enough coins! Need ${pw.cost} 🪙.`);
        store.mutate((st) => {
          const t = st.teams.find((x) => x.id === team.id);
          if (!t) return;
          t.coins -= pw.cost;
          if (pw.id === 'pw-double') t.doubleNext = true;
          if (pw.id === 'pw-veto-shield') t.vetoEndsAt = 0;
          if (pw.id === 'pw-freeze') {
            const p = st.players[st.localPlayerId];
            if (p) {
              p.gpsFrozen = true;
              p.frozenLat = p.lat;
              p.frozenLng = p.lng;
              st.room.freezeEndsAt = Date.now() + 15 * 60000;
            }
          }
        }, 'powerup');
        store.addFeed({ type: 'system', text: `bought powerup: ${pw.icon} ${pw.title} (-${pw.cost} 🪙)!` });
        this.toast(`Activated ${pw.title}!`);
      });
    });

    pane.querySelectorAll('[data-explore-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const iso = this.mapCtrl.toggleIsolateLine(btn.dataset.exploreLine);
        this.renderShopPane();
        if (iso && window.innerWidth <= 920) document.getElementById('side-panel').classList.remove('mobile-open');
      });
    });

    pane.querySelector('#btn-show-all-lines')?.addEventListener('click', () => {
      this.mapCtrl.toggleIsolateLine(this.mapCtrl.isolatedLine);
      this.renderShopPane();
    });
  }

  // ===== TAB 4: LIVE ACTIVITY FEED, CHAT & PHOTO PROOFS =====
  renderFeedPane() {
    const pane = document.getElementById('pane-feed');
    if (!pane) return;
    const s = store.get();
    const items = s.feed
      .filter((f) => this.feedFilter === 'all' || f.type === this.feedFilter)
      .slice()
      .reverse();

    pane.innerHTML = `
      <div class="card">
        <div class="card-title">📸 Post Update / Photo Proof</div>
        <div class="row" style="gap:6px">
          <input type="text" id="feed-msg-input" class="input" placeholder="Send message, clue, or proof note…" style="flex:1" />
          <label class="btn btn-secondary btn-sm" title="Attach compressed camera photo proof">
            📷
            <input type="file" id="feed-photo-input" accept="image/*" capture="environment" style="display:none" />
          </label>
          <button class="btn btn-primary btn-sm" id="btn-send-feed">Send</button>
        </div>
        ${
          this.pendingPhotoDataUrl
            ? `<div class="row-between"><img src="${this.pendingPhotoDataUrl}" style="height:56px;border-radius:7px;border:1px solid var(--border)" /><button class="btn btn-xs btn-danger" id="btn-clear-photo">Remove Photo</button></div>`
            : ''
        }
      </div>

      <div class="card" style="flex:1">
        <div class="card-header">
          <div class="card-title">💬 Live Timeline</div>
          <div class="row" style="gap:4px">
            ${[
              ['all', 'All'],
              ['challenge', 'Challenges'],
              ['qa', 'Q&A'],
              ['curse', 'Curses'],
              ['chat', 'Chat']
            ]
              .map(([k, lbl]) => `<button class="btn btn-xs ${this.feedFilter === k ? 'btn-primary' : 'btn-ghost'}" data-feed-f="${k}">${lbl}</button>`)
              .join('')}
          </div>
        </div>
        <div class="feed-list">
          ${items
            .map((f) => {
              const t = s.teams.find((x) => x.id === f.teamId);
              const timeStr = new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return `
                <div class="feed-item ${esc(f.type)}">
                  <div class="feed-head">
                    <strong style="color:${t?.color || 'var(--text)'}">${esc(f.author)}</strong>
                    <span>${timeStr}</span>
                  </div>
                  <div class="feed-text">${esc(f.text)}</div>
                  ${f.photoDataUrl ? `<img class="feed-photo" src="${f.photoDataUrl}" data-zoom-photo="1" alt="Proof photo" />` : ''}
                </div>`;
            })
            .join('')}
        </div>
      </div>
    `;

    const sendMsg = () => {
      const inp = pane.querySelector('#feed-msg-input');
      const text = inp.value.trim();
      if (!text && !this.pendingPhotoDataUrl) return;
      store.addFeed({
        type: 'chat',
        text: text || 'Sent a photo proof 📷',
        photoDataUrl: this.pendingPhotoDataUrl
      });
      this.pendingPhotoDataUrl = null;
      this.renderFeedPane();
    };

    pane.querySelector('#btn-send-feed').addEventListener('click', sendMsg);
    pane.querySelector('#feed-msg-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMsg();
    });

    pane.querySelector('#feed-photo-input').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        this.pendingPhotoDataUrl = await compressImageFile(file);
        this.toast('Photo compressed & ready to send!');
        this.renderFeedPane();
      } catch {
        this.toast('Could not process photo.');
      }
    });

    pane.querySelector('#btn-clear-photo')?.addEventListener('click', () => {
      this.pendingPhotoDataUrl = null;
      this.renderFeedPane();
    });

    pane.querySelectorAll('[data-feed-f]').forEach((b) => {
      b.addEventListener('click', () => {
        this.feedFilter = b.dataset.feedF;
        this.renderFeedPane();
      });
    });

    pane.querySelectorAll('[data-zoom-photo]').forEach((img) => {
      img.addEventListener('click', () => {
        this.openModal(`<img src="${img.src}" style="width:100%;border-radius:10px" /><button class="btn btn-secondary" id="m-close">Close</button>`);
        document.getElementById('m-close').onclick = () => this.closeModal();
      });
    });
  }

  // ===== TAB 5: MULTIPLAYER LIVE ROOMS, GPS & SYNC =====
  renderLivePane() {
    const pane = document.getElementById('pane-live');
    if (!pane) return;
    const s = store.get();
    const me = store.getLocalPlayer();
    const nearest = me?.lat != null ? this.mapCtrl.findNearestStation(me.lat, me.lng) : null;
    const players = Object.values(s.players || {});

    pane.innerHTML = `
      <!-- Player Profile & Live GPS -->
      <div class="card">
        <div class="card-title">🛰️ Player Identity & Live GPS</div>
        <div class="grid-2">
          <div class="field">
            <label>Your Name</label>
            <input type="text" id="inp-player-name" class="input" value="${esc(me.name)}" />
          </div>
          <div class="field">
            <label>Your Team</label>
            <select id="sel-player-team" class="select">
              ${s.teams.map((t) => `<option value="${t.id}" ${me.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="row">
          <button class="btn ${s.room.shareGps ? 'btn-danger' : 'btn-primary'} btn-sm" id="btn-toggle-gps" style="flex:1">
            ${s.room.shareGps ? '⏹️ Stop Live GPS' : '📍 Start Live GPS'}
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-toggle-hide-gps">${me.gpsHidden ? '👁️ Show My Pin' : '🙈 Hide My Pin'}</button>
          <button class="btn btn-secondary btn-sm" id="btn-toggle-freeze-gps">${me.gpsFrozen ? '🔥 Unfreeze' : '❄️ Freeze'}</button>
        </div>

        ${
          nearest
            ? `<div class="sp-badge" style="border-color:var(--accent-2);color:#2dd4bf">Nearest Stop: <strong>${esc(nearest.station.name)}</strong> (${formatDistance(nearest.distanceM)}) • ${nearest.station.lines.join(', ')}</div>`
            : `<div class="muted" style="font-size:11.5px">No GPS fix yet. Testing indoors? Drop a quick Demo GPS pin anywhere in Sydney:</div>`
        }
        <div class="row" style="gap:4px">
          ${[
            ['Central', -33.88488, 151.20665],
            ['Circular Quay', -33.86133, 151.21046],
            ['Parramatta', -33.81744, 151.00493],
            ['Manly', -33.80045, 151.28371],
            ['Chatswood', -33.79749, 151.18111]
          ]
            .map(([lbl, lat, lng]) => `<button class="btn btn-xs btn-ghost" data-demo-gps="${lat},${lng},${lbl}">📌 ${lbl}</button>`)
            .join('')}
        </div>
      </div>

      <!-- Engine 1: Zero-Setup PeerJS Room Codes -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">⚡ Instant Live Room (Zero Setup)</div>
          <span class="tag-pill" style="${s.room.connected ? 'border-color:#22c55e;color:#4ade80' : ''}">${esc(s.room.statusText)}</span>
        </div>
        ${
          s.room.connected
            ? `
              <div class="room-code-big">${esc(s.room.code)}</div>
              <div class="qr-box" id="room-qr-box"></div>
              <div class="row">
                <button class="btn btn-primary btn-sm" id="btn-copy-invite" style="flex:1">📋 Copy Invite Link</button>
                <button class="btn btn-danger btn-sm" id="btn-leave-room">Leave Room</button>
              </div>
            `
            : `
              <div class="muted" style="font-size:12px">Start a live room right now with zero accounts (WebRTC P2P + multi-tab sync) and invite opponents via Room Code or QR!</div>
              <button class="btn btn-primary btn-block" id="btn-host-peer">🚀 Create Live Room</button>
              <div class="row">
                <input type="text" id="inp-join-code" class="input mono" placeholder="Enter code e.g. SYD-4K9P" style="flex:1;text-transform:uppercase" value="${esc(s.room.code)}" />
                <button class="btn btn-accent" id="btn-join-peer">Join</button>
              </div>
            `
        }
      </div>

      <!-- Engine 2: Tunnel-Proof Firebase Realtime Database -->
      <div class="card">
        <div class="card-title">🔥 Tunnel-Proof Firebase Sync (Optional)</div>
        <div class="muted" style="font-size:11.5px">
          Best for real Sydney outdoor game days through Metro tunnels & locked phone screens! Paste your free Firebase Realtime DB URL (Singapore region recommended):
        </div>
        <div class="field">
          <label>Firebase Realtime Database URL</label>
          <input type="url" id="inp-fb-url" class="input" placeholder="https://your-app-default-rtdb.asia-southeast1.firebasedatabase.app" value="${esc(s.room.firebaseUrl)}" />
        </div>
        <div class="row">
          <input type="text" id="inp-fb-code" class="input mono" placeholder="Room code (e.g. SYD-GAME1)" value="${esc(s.room.code || generateRoomCode())}" style="flex:1;text-transform:uppercase" />
          <button class="btn btn-accent btn-sm" id="btn-connect-fb">Connect Firebase</button>
        </div>
      </div>

      <!-- Connected Players Roster -->
      <div class="card">
        <div class="card-title">👥 Players in Session (${players.length})</div>
        ${players
          .map((p) => {
            const t = s.teams.find((x) => x.id === p.teamId);
            return `
              <div class="row-between" style="padding:5px 0;border-bottom:1px solid var(--border)">
                <div class="row">
                  <span style="width:10px;height:10px;border-radius:50%;background:${t?.color || '#94a3b8'}"></span>
                  <strong style="font-size:13px">${esc(p.name)} ${p.id === s.localPlayerId ? '(You)' : ''}</strong>
                </div>
                <span class="muted" style="font-size:11px">
                  ${esc(t?.name || '')} • ${p.gpsFrozen ? '❄️ Frozen' : p.gpsHidden ? '🙈 Hidden' : p.lat != null ? '📍 GPS Live' : 'No GPS'}
                </span>
              </div>`;
          })
          .join('')}
      </div>

      <!-- Full Game JSON Backup -->
      <div class="card">
        <div class="card-title">💾 Save / Share Full Game Snapshot</div>
        <div class="row">
          <button class="btn btn-secondary btn-sm" id="btn-export-game" style="flex:1">Export Game JSON</button>
          <button class="btn btn-secondary btn-sm" id="btn-import-game" style="flex:1">Import Game JSON</button>
        </div>
      </div>
    `;

    // Render scannable QR code if connected
    if (s.room.connected && window.qrcode) {
      const qrBox = pane.querySelector('#room-qr-box');
      if (qrBox) {
        try {
          const qr = window.qrcode(0, 'M');
          qr.addData(this.mp.getInviteUrl());
          qr.make();
          qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
        } catch {}
      }
    }

    // Bind Live Pane events
    pane.querySelector('#inp-player-name').addEventListener('change', (e) => {
      const v = e.target.value.trim() || 'Player';
      store.mutate((st) => { st.players[st.localPlayerId].name = v; }, 'profile');
    });

    pane.querySelector('#sel-player-team').addEventListener('change', (e) => {
      const tid = e.target.value;
      store.mutate((st) => {
        const t = st.teams.find((x) => x.id === tid);
        st.players[st.localPlayerId].teamId = tid;
        if (t) st.players[st.localPlayerId].color = t.color;
      }, 'profile');
    });

    pane.querySelector('#btn-toggle-gps').addEventListener('click', () => {
      if (store.get().room.shareGps) this.mp.stopGps();
      else this.mp.startGps();
      this.renderLivePane();
    });

    pane.querySelector('#btn-toggle-hide-gps').addEventListener('click', () => {
      store.mutate((st) => {
        const p = st.players[st.localPlayerId];
        p.gpsHidden = !p.gpsHidden;
      }, 'gps');
    });

    pane.querySelector('#btn-toggle-freeze-gps').addEventListener('click', () => {
      store.mutate((st) => {
        const p = st.players[st.localPlayerId];
        p.gpsFrozen = !p.gpsFrozen;
        if (p.gpsFrozen) {
          p.frozenLat = p.lat;
          p.frozenLng = p.lng;
        } else {
          p.frozenLat = null;
          p.frozenLng = null;
        }
      }, 'gps');
    });

    pane.querySelectorAll('[data-demo-gps]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [lat, lng, lbl] = btn.dataset.demoGps.split(',');
        this.mp.setSimulatedGps(Number(lat), Number(lng), lbl);
        this.mapCtrl.flyToCoord(Number(lat), Number(lng), 14);
      });
    });

    pane.querySelector('#btn-host-peer')?.addEventListener('click', () => this.mp.hostPeerRoom());
    pane.querySelector('#btn-join-peer')?.addEventListener('click', () => {
      const code = pane.querySelector('#inp-join-code').value.trim();
      if (!code) return this.toast('Enter a room code first.');
      this.mp.joinPeerRoom(code);
    });
    pane.querySelector('#btn-leave-room')?.addEventListener('click', () => this.mp.disconnect());
    pane.querySelector('#btn-copy-invite')?.addEventListener('click', async () => {
      const url = this.mp.getInviteUrl();
      try {
        await navigator.clipboard.writeText(url);
        this.toast('Invite link copied to clipboard!');
      } catch {
        prompt('Copy invite link:', url);
      }
    });

    pane.querySelector('#btn-connect-fb')?.addEventListener('click', () => {
      const url = pane.querySelector('#inp-fb-url').value.trim();
      const code = pane.querySelector('#inp-fb-code').value.trim();
      this.mp.connectFirebaseRoom(url, code);
    });

    pane.querySelector('#btn-export-game').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(store.getSharedSnapshot(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `jetlag-sydney-game-${Date.now()}.json`;
      a.click();
    });

    pane.querySelector('#btn-import-game').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json';
      inp.onchange = async () => {
        try {
          const snap = JSON.parse(await inp.files[0].text());
          store.applySharedSnapshot(snap);
          this.toast('Imported game snapshot!');
        } catch {
          this.toast('Invalid game JSON file.');
        }
      };
      inp.click();
    });
  }

  // ===== MODALS FOR STRATEGY TOOLS & CUSTOM DECK =====
  openModal(html) {
    document.getElementById('app-modal-box').innerHTML = html;
    document.getElementById('app-modal').classList.add('open');
  }

  closeModal() {
    document.getElementById('app-modal').classList.remove('open');
  }

  openRadarModal(lat, lng, label = '', defaultKm = 2) {
    this.openModal(`
      <div class="card-title">📡 Place Radar Overlay ${label ? `(${esc(label)})` : ''}</div>
      <div class="field">
        <label>Radius (km)</label>
        <div class="row">
          ${[0.5, 1, 2, 5, 10, 25].map((km) => `<button class="btn btn-xs btn-secondary" data-rad-preset="${km}">${km} km</button>`).join('')}
        </div>
        <input type="number" id="m-rad-km" class="input" step="0.1" min="0.1" value="${defaultKm}" />
      </div>
      <div class="field">
        <label>Radar Result (Auto-Shades Eliminated Map Area)</label>
        <select id="m-rad-res" class="select">
          <option value="hit">HIT — Hider IS Inside (Shades Outside Red)</option>
          <option value="miss">MISS — Hider is NOT Inside (Shades Inside Red)</option>
          <option value="ref">Reference Circle Only (No Shading)</option>
        </select>
      </div>
      <div class="row">
        <button class="btn btn-primary" id="m-rad-ok" style="flex:1">Draw Radar</button>
        <button class="btn btn-ghost" id="m-rad-cancel">Cancel</button>
      </div>
    `);

    document.querySelectorAll('[data-rad-preset]').forEach((b) => {
      b.onclick = () => { document.getElementById('m-rad-km').value = b.dataset.radPreset; };
    });
    document.getElementById('m-rad-ok').onclick = () => {
      const km = Math.max(0.1, Number(document.getElementById('m-rad-km').value) || 2);
      const res = document.getElementById('m-rad-res').value;
      this.mapCtrl.addRadar(lat, lng, km, res, label);
      this.selectMapTool('select');
      this.closeModal();
    };
    document.getElementById('m-rad-cancel').onclick = () => this.closeModal();
  }

  openThermometerModal(pA, pB) {
    this.openModal(`
      <div class="card-title">🌡️ Thermometer Result</div>
      <p class="muted">Moving from Point A to Point B, did the Hider answer HOTTER (closer to B) or COLDER (closer to A)?</p>
      <div class="grid-2">
        <button class="btn btn-primary" id="m-th-hot">🔥 HOTTER (Shade A Side)</button>
        <button class="btn btn-accent" id="m-th-cold">❄️ COLDER (Shade B Side)</button>
      </div>
      <button class="btn btn-ghost btn-sm" id="m-th-cancel">Cancel</button>
    `);
    document.getElementById('m-th-hot').onclick = () => {
      this.mapCtrl.addThermometer(pA, pB, true);
      this.selectMapTool('select');
      this.closeModal();
    };
    document.getElementById('m-th-cold').onclick = () => {
      this.mapCtrl.addThermometer(pA, pB, false);
      this.selectMapTool('select');
      this.closeModal();
    };
    document.getElementById('m-th-cancel').onclick = () => this.closeModal();
  }

  openPinModal(lat, lng) {
    this.openModal(`
      <div class="card-title">📍 Drop Tactical Map Pin</div>
      <div class="field">
        <label>Pin Label</label>
        <input type="text" id="m-pin-label" class="input" placeholder="e.g. Suspected Hider, Flag, Veto Spot" value="Tactical Pin" />
      </div>
      <div class="row">
        <button class="btn btn-primary" id="m-pin-ok" style="flex:1">Drop Pin</button>
        <button class="btn btn-ghost" id="m-pin-cancel">Cancel</button>
      </div>
    `);
    document.getElementById('m-pin-ok').onclick = () => {
      const lbl = document.getElementById('m-pin-label').value.trim() || 'Pin';
      this.mapCtrl.addPin(lat, lng, lbl);
      this.selectMapTool('select');
      this.closeModal();
    };
    document.getElementById('m-pin-cancel').onclick = () => this.closeModal();
  }

  openAddCardModal(kind) {
    const isChallenge = kind === 'challenge';
    this.openModal(`
      <div class="card-title">${isChallenge ? '🎯 Add Custom Challenge' : '💀 Add Custom Curse'}</div>
      <div class="field">
        <label>Title</label>
        <input type="text" id="mc-title" class="input" placeholder="e.g. Ferry Race to Balmain" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="mc-desc" class="textarea" placeholder="Full rules and proof requirements…"></textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>${isChallenge ? 'Reward (Coins)' : 'Cost (Coins)'}</label>
          <input type="number" id="mc-coins" class="input" value="600" />
        </div>
        <div class="field">
          <label>${isChallenge ? 'Veto Penalty (Mins)' : 'Duration (Mins)'}</label>
          <input type="number" id="mc-mins" class="input" value="20" />
        </div>
      </div>
      ${
        isChallenge
          ? `<div class="grid-2">
              <div class="field">
                <label>Category</label>
                <select id="mc-cat" class="select">${CHALLENGE_CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select>
              </div>
              <div class="field">
                <label>Difficulty</label>
                <select id="mc-diff" class="select"><option>Easy</option><option selected>Medium</option><option>Hard</option></select>
              </div>
            </div>`
          : ''
      }
      <div class="row">
        <button class="btn btn-primary" id="mc-save" style="flex:1">Add to Deck</button>
        <button class="btn btn-ghost" id="mc-cancel">Cancel</button>
      </div>
    `);
    document.getElementById('mc-save').onclick = () => {
      const title = document.getElementById('mc-title').value.trim();
      const description = document.getElementById('mc-desc').value.trim();
      if (!title || !description) return this.toast('Enter both title and description.');
      const coins = Number(document.getElementById('mc-coins').value) || 500;
      const mins = Number(document.getElementById('mc-mins').value) || 15;
      store.mutate((s) => {
        if (isChallenge) {
          s.decks.challenges.unshift({
            id: uid('ch'),
            title,
            description,
            coins,
            vetoMins: mins,
            category: document.getElementById('mc-cat').value,
            difficulty: document.getElementById('mc-diff').value,
            active: true
          });
        } else {
          s.decks.curses.unshift({
            id: uid('cu'),
            title,
            description,
            cost: coins,
            durationMins: mins,
            castingCondition: 'Custom Curse',
            active: true
          });
        }
      }, 'deck');
      this.refreshWheelPool();
      this.closeModal();
      this.toast(`Added "${title}" to custom deck!`);
    };
    document.getElementById('mc-cancel').onclick = () => this.closeModal();
  }

  toast(msg) {
    const stack = document.getElementById('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new JetLagSydneyApp();
  app.init();
  window.__jetLagApp = app;
});
