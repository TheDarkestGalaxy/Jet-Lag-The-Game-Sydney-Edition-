// Jet Lag: Sydney Edition — Mobile-First Main Application Orchestrator
import { SYDNEY_NETWORK } from '../data/sydney-network.js';
import { CHALLENGE_CATEGORIES, POWERUPS_SHOP, TRANSIT_RATES, DEFAULT_CHALLENGES, DEFAULT_CURSES } from '../data/challenges.js?v=12';
import { store, uid } from './state.js?v=12';
import {
  GAME_MODES,
  RULE_MODULES,
  CTF_PRESETS,
  RACE_PRESETS,
  getDefaultRulesForMode,
  computeRailRushStats,
  haversineM,
  formatDistance,
  formatClock,
  getDividingSide,
  getAccess
} from './modes.js?v=12';
import { SydneyMapController } from './map.js?v=12';
import { ChallengeWheel } from './wheel.js?v=12';
import { MultiplayerManager, generateRoomCode, normalizeRoomCode, compressImageFile } from './multiplayer.js?v=12';
import { icon } from './icons.js?v=12';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function defaultScheduleDateTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatScheduledCountdown(ms) {
  if (ms <= 0) return 'READY FOR KICKOFF';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return days > 0 ? `${days}d ${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function encodeScheduleParam(sched) {
  try {
    const compact = {
      t: sched.title,
      m: sched.mode,
      s: sched.startTimeIso,
      p: sched.meetingStation,
      c: sched.roomCode,
      g: sched.hostIsSpectator ? (sched.hostName || 'Host') : ''
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(compact))));
  } catch {
    return '';
  }
}

function decodeScheduleParam(str) {
  try {
    const raw = JSON.parse(decodeURIComponent(escape(atob(str))));
    if (!raw || !raw.s || !raw.c) return null;
    return {
      id: uid('sched'),
      title: raw.t || 'Scheduled Jet Lag Session',
      mode: GAME_MODES[raw.m] ? raw.m : 'hide_seek',
      startTimeIso: raw.s,
      meetingStation: raw.p || 'Central',
      roomCode: raw.c,
      hostIsSpectator: Boolean(raw.g),
      hostName: raw.g || '',
      locked: true,
      lockedAt: Date.now(),
      rsvps: []
    };
  } catch {
    return null;
  }
}

function downloadScheduleIcs(sched, inviteUrl) {
  const start = new Date(sched.startTimeIso);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const fmt = (dt) =>
    dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const modeName = GAME_MODES[sched.mode]?.name || sched.mode;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jet Lag Sydney Edition//EN',
    'BEGIN:VEVENT',
    `UID:${sched.id || Date.now()}@jetlag-sydney`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${sched.title} (${modeName})`,
    `LOCATION:${sched.meetingStation}, Sydney NSW`,
    `DESCRIPTION:Room Code: ${sched.roomCode}\\nMode: ${modeName}\\nJoin Link: ${inviteUrl}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jetlag-sydney-${(sched.roomCode || 'game').toLowerCase()}.ics`;
  a.click();
}

class JetLagSydneyApp {
  constructor() {
    this.activeTab = 'game';
    this.wheelSubTab = 'spin'; // 'spin' | 'shop' | 'deck'
    this.deckKind = 'challenges'; // 'challenges' | 'curses'
    this.wheelMode = 'challenges'; // 'challenges' | 'curses'
    this.wheelCat = 'all';
    this.wheelDiff = 'all';
    this.landedCard = null;
    this.feedFilter = 'all';
    this.showModePicker = false;
    this.showRulesConfig = false;
    this.pendingPhotoDataUrl = null;
    this.qaCategoryFilter = 'Radar';

    this.mapCtrl = null;
    this.wheel = null;
    this.mp = null;
  }

  init() {
    if ('serviceWorker' in navigator) {
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        // Avoid stale local-dev caches; unregister any older SW on localhost
        navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
        if ('caches' in window) {
          caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
        }
      } else if (location.protocol === 'https:') {
        navigator.serviceWorker.register('./sw.js?v=12').then((reg) => reg.update()).catch(() => {});
      }
    }

    this.applyTheme(store.get().theme);

    const metaEl = document.getElementById('network-meta-sub');
    if (metaEl) {
      metaEl.textContent = `${SYDNEY_NETWORK.stations.length} Stops · ${SYDNEY_NETWORK.lines.length} Lines`;
    }

    this.mp = new MultiplayerManager({
      onToast: (msg) => this.toast(msg),
      onGpsUpdate: () => {
        if (this.activeTab === 'live' || this.activeTab === 'game') this.renderDynamicPanes();
      }
    });

    this.mapCtrl = new SydneyMapController('sydney-map', {
      onToast: (msg) => this.toast(msg),
      onToolStatus: (hint) => this.updateToolBanner(hint),
      onLineClick: (line) => {
        this.toast(`${line.code}: ${line.name} (${line.stationIds.length} stops)`);
      },
      onToggleClaim: (station, claim, teamId) => this.toggleStationClaim(station, claim, teamId),
      onSetHidingZone: (station) => this.setHidingZoneAt(station),
      onDropFlag: (station, teamId) => this.dropFlagAt(station, teamId),
      onHostBroadcastStation: (station) => {
        store.addFeed({ type: 'broadcast', author: `${store.getLocalPlayer()?.name || 'Host'} (HOST)`, teamId: null, text: `Station Spotlight: ${station.name} (${station.lines.join(', ')})` });
        this.toast(`Broadcasted station alert for ${station.name}.`);
      },
      onAddCheckpoint: (station) => this.addCheckpoint(station),
      onCheckCheckpoint: (cpId) => this.toggleCheckpointDone(cpId),
      onQuickRadar: (lat, lng, label) => this.openRadarModal(lat, lng, label),
      onRequestThermometer: (pA, pB) => this.openThermometerModal(pA, pB),
      onRequestPin: (lat, lng) => this.openPinModal(lat, lng)
    });
    this.mapCtrl.init();

    const canvas = document.getElementById('challenge-wheel-canvas');
    this.wheel = new ChallengeWheel(canvas, {
      onSpinStart: () => {
        this.landedCard = null;
        this.renderWheelLanded();
      },
      onLand: (item) => {
        this.landedCard = { ...item, wheelMode: this.wheelMode };
        this.renderWheelLanded();
        this.toast(`Landed on: ${item.title}`);
      }
    });

    this.bindStaticUI();
    this.refreshWheelPool();
    this.renderLayerLineExplorer();
    this.renderAll();

    store.subscribe((state, reason) => {
      this.renderTopbar(state);
      // Avoid wiping an input the user is actively typing in during background remote/GPS syncs
      const activeEl = document.activeElement;
      const typingInFeed = activeEl && activeEl.closest?.('#pane-feed') && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      const typingInLive = activeEl && activeEl.closest?.('#pane-live') && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      const typingInDeck = activeEl && activeEl.closest?.('#wsub-deck') && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      if (reason === 'gps') {
        if (this.activeTab === 'live' && !typingInLive) this.renderLivePane();
        return;
      }
      this.renderGamePane();
      if (!typingInDeck) this.renderWheelSideSections();
      if (!typingInFeed) this.renderFeedPane();
      if (!typingInLive || reason === 'room_status') this.renderLivePane();
    });

    setInterval(() => this.tickTimers(), 1000);

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const fbParam = params.get('fb');
    const schedParam = params.get('sched');
    if (schedParam) {
      const decoded = decodeScheduleParam(schedParam);
      if (decoded) {
        store.mutate((s) => {
          s.scheduledRoom = decoded;
          s.game.mode = decoded.mode;
          s.game.rules = getDefaultRulesForMode(decoded.mode);
          s.room.code = decoded.roomCode;
        }, 'schedule', false);
        setTimeout(() => {
          this.openTabOnMobileOrDesktop('live');
          this.toast(`Loaded locked-in game: ${decoded.title}`);
        }, 300);
      }
    } else if (roomParam) {
      setTimeout(() => {
        if (fbParam) this.mp.connectFirebaseRoom(fbParam, roomParam);
        else this.mp.joinPeerRoom(roomParam);
        this.openTabOnMobileOrDesktop('live');
      }, 400);
    }
  }

  // ===== POPOVERS & STATIC UI =====
  closePopovers() {
    document.querySelectorAll('.map-popover').forEach((p) => p.classList.remove('open'));
    document.getElementById('fab-tools')?.classList.toggle('active', this.mapCtrl?.activeTool !== 'select');
    document.getElementById('fab-layers')?.classList.toggle('active', Boolean(this.mapCtrl?.isolatedLine));
  }

  togglePopover(id, fabId) {
    const el = document.getElementById(id);
    const wasOpen = el.classList.contains('open');
    this.closePopovers();
    if (!wasOpen) {
      el.classList.add('open');
      document.getElementById(fabId)?.classList.add('active');
    }
  }

  bindStaticUI() {
    // Map FAB Popovers
    document.getElementById('fab-tools').addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePopover('popover-tools', 'fab-tools');
    });
    document.getElementById('fab-layers').addEventListener('click', (e) => {
      e.stopPropagation();
      this.renderLayerLineExplorer();
      this.togglePopover('popover-layers', 'fab-layers');
    });
    document.querySelectorAll('[data-close-popover]').forEach((b) => {
      b.addEventListener('click', () => this.closePopovers());
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.map-popover') && !e.target.closest('.map-fab-stack')) {
        this.closePopovers();
      }
      if (!e.target.closest('.map-search-bar')) {
        document.getElementById('station-search-results')?.classList.remove('open');
      }
    });

    // Clear isolated line pill
    document.getElementById('btn-clear-isolated').addEventListener('click', () => {
      if (this.mapCtrl.isolatedLine) {
        this.mapCtrl.toggleIsolateLine(this.mapCtrl.isolatedLine);
        this.updateIsolatedPill();
        this.renderLayerLineExplorer();
      }
    });

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
        this.closePopovers();
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

    // Wheel sub-tabs (Wheel | Powerup Shop | Deck Builder)
    document.querySelectorAll('[data-wsub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.wheelSubTab = btn.dataset.wsub;
        document.querySelectorAll('[data-wsub]').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.sub-view').forEach((v) => v.classList.toggle('active', v.id === `wsub-${this.wheelSubTab}`));
        if (this.wheelSubTab === 'spin') setTimeout(() => this.wheel.draw(), 50);
        this.renderWheelSideSections();
      });
    });

    // Topbar actions
    document.getElementById('topbar-mode-btn').addEventListener('click', () => {
      this.showModePicker = true;
      this.openTabOnMobileOrDesktop('game');
    });
    document.getElementById('topbar-room-btn').addEventListener('click', () => this.openTabOnMobileOrDesktop('live'));
    document.getElementById('topbar-clock-btn').addEventListener('click', () => this.toggleGameClock());
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      const next = store.get().theme === 'dark' ? 'light' : 'dark';
      store.mutate((s) => { s.theme = next; }, 'theme', false);
      this.applyTheme(next);
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
        .slice(0, 10);

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

    // Map strategy tools (inside Tools popover)
    document.querySelectorAll('[data-map-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectMapTool(btn.dataset.mapTool);
        this.closePopovers();
      });
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
        this.closePopovers();
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
      if (p?.lat == null) return this.toast('Enable GPS (or place a Demo Pin in the Live tab) first.');
      this.openRadarModal(p.lat, p.lng, 'My GPS');
    });

    // Map Quick Views & Basemap (inside Layers popover + GPS FAB)
    document.getElementById('btn-locate-me').addEventListener('click', () => {
      const p = store.getLocalPlayer();
      if (p?.lat != null) {
        this.mapCtrl.flyToCoord(p.lat, p.lng, 15);
      } else {
        this.mp.startGps();
        this.toast('Requesting live GPS location...');
      }
    });
    document.getElementById('btn-fit-sydney').addEventListener('click', () => {
      this.mapCtrl.fitGreaterSydney();
      this.closePopovers();
    });
    document.getElementById('btn-fit-nsw').addEventListener('click', () => {
      this.mapCtrl.fitFullNetwork();
      this.closePopovers();
    });
    document.getElementById('btn-toggle-labels').addEventListener('click', (e) => {
      const next = !this.mapCtrl.showStationLabels;
      this.mapCtrl.setShowLabels(next);
      e.currentTarget.classList.toggle('btn-primary', next);
      e.currentTarget.classList.toggle('btn-secondary', !next);
    });
    document.getElementById('basemap-select').addEventListener('change', (e) => {
      this.mapCtrl.setBasemap(e.target.value);
    });

    // Transit Mode Filter Chips (inside Layers popover)
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
      this.toast('Shuffled wheel slices from active deck.');
    });
    document.getElementById('btn-wheel-quick-create').addEventListener('click', () => {
      if (!getAccess(store.get()).canEditDeck) return this.toast('Challenge deck is locked by the Game Master.');
      this.openAddCardModal(this.wheelMode === 'curses' ? 'curse' : 'challenge');
    });

    document.getElementById('app-modal').addEventListener('click', (e) => {
      if (e.target.id === 'app-modal') this.closeModal();
    });
  }

  renderLayerLineExplorer() {
    const slot = document.getElementById('popover-line-explorer');
    if (!slot) return;
    const groups = [
      { mode: 'train', label: 'Sydney Trains' },
      { mode: 'metro', label: 'Metro' },
      { mode: 'light_rail', label: 'Light Rail' },
      { mode: 'ferry', label: 'Ferries' },
      { mode: 'intercity', label: 'Intercity' }
    ];
    slot.innerHTML = `
      <div class="row-between">
        <label>Isolate a Single Line</label>
        ${this.mapCtrl.isolatedLine ? `<button class="btn btn-xs btn-secondary" id="pop-show-all-lines">Show All</button>` : ''}
      </div>
      ${groups
        .map((g) => {
          const lines = SYDNEY_NETWORK.lines.filter((l) => l.mode === g.mode);
          return `
            <div style="margin-top:4px">
              <div style="font-size:10.5px;color:var(--text-dim);margin-bottom:3px">${g.label}</div>
              <div class="line-grid">
                ${lines
                  .map(
                    (ln) => `
                    <button class="line-pill ${this.mapCtrl.isolatedLine === ln.code ? 'isolated' : ''}"
                      data-explore-line="${ln.code}"
                      style="background:${ln.color};color:${ln.textColor}"
                      title="${esc(ln.name)} (${ln.stationIds.length} stops)">
                      ${ln.code}
                    </button>`
                  )
                  .join('')}
              </div>
            </div>`;
        })
        .join('')}
    `;

    slot.querySelectorAll('[data-explore-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mapCtrl.toggleIsolateLine(btn.dataset.exploreLine);
        this.updateIsolatedPill();
        this.renderLayerLineExplorer();
        this.closePopovers();
      });
    });

    slot.querySelector('#pop-show-all-lines')?.addEventListener('click', () => {
      if (this.mapCtrl.isolatedLine) this.mapCtrl.toggleIsolateLine(this.mapCtrl.isolatedLine);
      this.updateIsolatedPill();
      this.renderLayerLineExplorer();
    });
  }

  updateIsolatedPill() {
    const pill = document.getElementById('isolated-line-pill');
    const txt = document.getElementById('isolated-line-text');
    const iso = this.mapCtrl.isolatedLine;
    if (iso) {
      const ln = this.mapCtrl.lineByCode.get(iso);
      txt.textContent = `${iso} · ${ln?.name || ''}`;
      pill.style.display = 'flex';
    } else {
      pill.style.display = 'none';
    }
    document.getElementById('fab-layers')?.classList.toggle('active', Boolean(iso));
  }

  applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light');
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.innerHTML = icon(theme === 'light' ? 'moon' : 'sun', 15);
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
    const titles = { game: 'Game Control', wheel: 'Wheel & Shop', feed: 'Live Feed', live: 'Live Room & GPS' };
    const mTitle = document.getElementById('mobile-drawer-title');
    if (mTitle) mTitle.textContent = titles[tabName] || 'Jet Lag: Sydney';
    if (tabName === 'wheel' && this.wheelSubTab === 'spin') {
      setTimeout(() => this.wheel.draw(), 60);
    }
    this.renderDynamicPanes();
  }

  selectMapTool(tool) {
    this.mapCtrl.setTool(tool);
    document.querySelectorAll('[data-map-tool]').forEach((b) => b.classList.toggle('active', b.dataset.mapTool === tool));
    document.getElementById('fab-tools')?.classList.toggle('active', tool !== 'select');
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
    this.renderFeedPane();
    this.renderLivePane();
  }

  renderTopbar(state) {
    const mode = GAME_MODES[state.game.mode] || GAME_MODES.custom;
    const isHostGm = Boolean(store.getLocalPlayer()?.isEventHost);
    document.getElementById('topbar-mode-label').textContent = isHostGm ? `HOST · ${mode.shortName}` : mode.shortName;
    document.getElementById('topbar-mode-dot').style.background = isHostGm ? '#a855f7' : mode.color;

    const roomBtn = document.getElementById('topbar-room-btn');
    roomBtn.classList.toggle('live', state.room.connected);
    document.getElementById('topbar-room-label').textContent = state.room.connected
      ? state.room.code
      : 'Solo';

    this.tickTimers();
  }

  tickTimers() {
    const s = store.get();
    const myTeam = store.getLocalTeam();
    const clockBtn = document.getElementById('topbar-clock-btn');
    const clockIco = document.getElementById('topbar-clock-ico');
    const clockText = document.getElementById('topbar-clock-text');

    const now = Date.now();
    const vetoRem = (myTeam?.vetoEndsAt || 0) - now;
    const hidingRem = (s.game.hidingEndsAt || 0) - now;

    clockBtn.classList.remove('running', 'veto');
    if (vetoRem > 0) {
      clockBtn.classList.add('veto');
      clockIco.innerHTML = icon('ban', 13);
      clockText.textContent = `VETO ${formatClock(vetoRem)}`;
    } else if (s.game.status === 'running' && hidingRem > 0 && s.game.rules.hideSeekQA) {
      clockBtn.classList.add('running');
      clockIco.innerHTML = icon('eyeOff', 13);
      clockText.textContent = `HIDE ${formatClock(hidingRem)}`;
    } else {
      let elapsed = s.game.elapsedBeforePauseMs || 0;
      if (s.game.status === 'running' && s.game.startedAt) {
        elapsed += now - s.game.startedAt;
        clockBtn.classList.add('running');
      }
      clockIco.innerHTML = icon(s.game.status === 'running' ? 'play' : s.game.status === 'paused' ? 'pause' : 'clock', 13);
      clockText.textContent = formatClock(elapsed);
    }

    document.querySelectorAll('[data-countdown-until]').forEach((el) => {
      const until = Number(el.dataset.countdownUntil);
      const rem = until - now;
      el.textContent = rem > 0 ? formatClock(rem) : 'Expired';
    });
    document.querySelectorAll('[data-burn-since]').forEach((el) => {
      const since = Number(el.dataset.burnSince);
      const rate = Number(el.dataset.burnRate);
      const mins = Math.max(0, (now - since) / 60000);
      el.textContent = `${formatClock(now - since)} · ~${Math.round(mins * rate)} coins`;
    });
    document.querySelectorAll('[data-sched-iso]').forEach((el) => {
      const targetMs = Date.parse(el.dataset.schedIso);
      if (!Number.isNaN(targetMs)) {
        el.textContent = formatScheduledCountdown(targetMs - now);
      }
    });
  }

  toggleGameClock() {
    if (!getAccess(store.get()).canEditRules) {
      return this.toast('Only the Game Master (or permitted Co-Host) can control the game clock.');
    }
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
    store.addFeed({ type: 'system', text: status === 'running' ? 'Game clock started.' : 'Game clock paused.' });
  }

  // ===== TAB 1: GAME PANE (Active Mode First, Collapsible Setup!) =====
  renderGamePane() {
    const pane = document.getElementById('pane-game');
    if (!pane) return;
    const s = store.get();
    const mode = GAME_MODES[s.game.mode] || GAME_MODES.custom;
    const myTeam = store.getLocalTeam();
    const myPlayer = store.getLocalPlayer();
    const access = getAccess(s);
    const isHostGm = access.isGm;
    const rrData = s.game.rules.stationClaiming
      ? computeRailRushStats(SYDNEY_NETWORK, s.claimedStations, s.teams, s.game.railRushLineBonus, s.game.stationPoints || 1)
      : null;

    // 0. Event Host (Non-Playing Game Master) Console or Managed-Game Notice
    let html = '';
    if (isHostGm) {
      html += `
        <div class="card host-card">
          <div class="row-between">
            <div class="row" style="gap:7px">
              <span class="host-pill">GAME MASTER</span>
              <strong style="font-family:var(--font-display)">Host Control Console</strong>
            </div>
            ${access.canStepDownGm ? `<button class="btn btn-xs btn-secondary" id="btn-gm-exit">Step Down</button>` : `<span class="tag-pill">${icon('lock', 11)} Locked In-Game</span>`}
          </div>
          <div class="muted" style="font-size:11.5px">
            Full GM authority active — players cannot alter locked rules, scores, teams, names, or bypass GPS checks unless you grant permission in the Live tab.
          </div>
          <div class="row" style="gap:6px">
            <input type="text" id="gm-broadcast-input" class="input" placeholder="Send live announcement to all players..." style="flex:1;padding:7px 10px;font-size:13px" />
            <button class="btn btn-primary btn-sm" id="btn-gm-broadcast">Broadcast</button>
          </div>
        </div>
      `;
    } else if (access.gmExists) {
      html += `
        <div class="sp-badge" style="border-color:#a855f7;color:#c084fc;display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span>${access.isPermitted ? 'Permitted Co-Host — elevated controls enabled' : 'Game Master Active — rules, scores & GPS checks enforced'}</span>
        </div>
      `;
    }

    // 0b. Locked-In Scheduled Game Room Banner (if scheduled)
    if (s.scheduledRoom?.locked) {
      const sr = s.scheduledRoom;
      const startMs = Date.parse(sr.startTimeIso);
      const formatted = Number.isNaN(startMs)
        ? sr.startTimeIso
        : new Date(startMs).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      html += `
        <div class="card sched-card locked">
          <div class="row-between">
            <div class="row" style="gap:6px">${icon('lock', 14)}<strong style="font-family:var(--font-display)">${esc(sr.title)}</strong></div>
            <span class="tag-pill" style="border-color:var(--accent);color:var(--accent)">LOCKED IN</span>
          </div>
          <div class="sched-countdown" data-sched-iso="${esc(sr.startTimeIso)}">${formatScheduledCountdown(startMs - Date.now())}</div>
          <div class="row-between muted" style="font-size:11.5px">
            <span>${esc(formatted)} · ${esc(sr.meetingStation)}${sr.hostIsSpectator ? ` · GM: ${esc(sr.hostName || 'Host')}` : ''}</span>
            <button class="btn btn-xs btn-secondary" id="btn-game-open-sched">Manage</button>
          </div>
        </div>
      `;
    }

    // 1. Compact Active Mode Header + Clock
    html += `
      <div class="card">
        <div class="row-between">
          <div class="row" style="gap:7px">
            <span class="mode-badge" style="background:${mode.color}">${mode.badge}</span>
            <strong style="font-family:var(--font-display);font-size:15px">${esc(mode.name)}</strong>
          </div>
          <div class="row" style="gap:5px">
            ${access.canEditRules ? `<button class="btn btn-xs btn-secondary" id="btn-toggle-modes">${this.showModePicker ? 'Done' : 'Change'}</button>` : ''}
            <button class="btn btn-xs ${this.showRulesConfig ? 'btn-primary' : 'btn-ghost'}" id="btn-toggle-rules" title="Game Rules & Parameters">${icon('sliders', 13)} Rules</button>
            ${access.canEditRules ? `<button class="btn btn-xs btn-danger" id="btn-reset-game">Reset</button>` : ''}
          </div>
        </div>
        ${
          this.showModePicker && access.canEditRules
            ? `<div class="mode-grid">
                ${Object.values(GAME_MODES)
                  .map(
                    (m) => `
                    <button class="mode-tile ${s.game.mode === m.id ? 'active' : ''}" data-pick-mode="${m.id}" style="--mcol:${m.color}">
                      <div class="mode-tile-top">
                        <span class="mode-tile-name">${esc(m.shortName)}</span>
                        <span class="mode-badge">${m.badge}</span>
                      </div>
                      <div class="mode-tile-desc">${esc(m.tagline.slice(0, 68))}...</div>
                    </button>`
                  )
                  .join('')}
              </div>`
            : `<div class="muted" style="font-size:12px">${esc(mode.tagline)}</div>`
        }
        ${
          access.canEditRules
            ? `<div class="row">
                <button class="btn btn-primary btn-sm" id="btn-game-start-pause" style="flex:1">
                  ${icon(s.game.status === 'running' ? 'pause' : 'play', 13)}
                  ${s.game.status === 'running' ? 'Pause Clock' : s.game.status === 'paused' ? 'Resume Clock' : 'Start Clock'}
                </button>
                ${
                  s.game.rules.hideSeekQA
                    ? `<button class="btn btn-accent btn-sm" id="btn-start-hiding-timer">${s.game.hidingMins}m Hide Timer</button>`
                    : ''
                }
              </div>`
            : ''
        }
      </div>
    `;

    if (this.showRulesConfig || (s.game.mode === 'custom' && access.canEditRules)) {
      const dis = access.canEditRules ? '' : 'disabled';
      const perms = s.permissions || {};
      const trMap = s.game.transitRates || {};
      html += `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Custom Rules & Parameters</div>
            <span class="tag-pill">${access.canEditRules ? 'EDITABLE' : 'VIEW ONLY'}</span>
          </div>

          <!-- Universal Economy & Clock -->
          <div class="grid-2">
            <div class="field">
              <label>Starting Coins</label>
              <input type="number" class="input" data-cfg-num="startingCoins" value="${s.game.startingCoins ?? 1500}" min="0" step="50" ${dis} />
            </div>
            <div class="field">
              <label>Game Duration (mins)</label>
              <input type="number" class="input" data-cfg-num="durationMins" value="${s.game.durationMins ?? 180}" min="10" step="10" ${dis} />
            </div>
          </div>
          ${
            access.canEditRules
              ? `<button class="btn btn-secondary btn-xs" id="btn-apply-start-coins">Apply ${s.game.startingCoins ?? 1500} Starting Coins to All Teams</button>`
              : ''
          }

          <!-- Rail Rush Parameters -->
          <div style="border-top:1px solid var(--border);padding-top:8px;display:flex;flex-direction:column;gap:7px">
            <strong style="font-size:12px;color:var(--accent)">Rail Rush Rules</strong>
            <div class="grid-2">
              <div class="field">
                <label>Claim GPS Radius (m)</label>
                <input type="number" class="input" data-cfg-num="stationClaimRadiusM" value="${s.game.stationClaimRadiusM ?? 100}" min="25" max="2000" step="25" ${dis} />
              </div>
              <div class="field">
                <label>Points per Station</label>
                <input type="number" class="input" data-cfg-num="stationPoints" value="${s.game.stationPoints ?? 1}" min="1" max="50" ${dis} />
              </div>
              <div class="field">
                <label>Completed Line Bonus</label>
                <input type="number" class="input" data-cfg-num="railRushLineBonus" value="${s.game.railRushLineBonus ?? 5}" min="0" max="100" ${dis} />
              </div>
              <div class="field">
                <label>Default Veto (mins)</label>
                <input type="number" class="input" data-cfg-num="defaultVetoMins" value="${s.game.defaultVetoMins ?? 15}" min="1" max="120" ${dis} />
              </div>
            </div>
            <label class="toggle-row" style="padding:4px 0">
              <span style="font-size:12px;font-weight:600">Allow Stealing Already-Claimed Stations</span>
              <input type="checkbox" data-cfg-bool="allowStealingStations" ${s.game.allowStealingStations !== false ? 'checked' : ''} ${dis} />
            </label>
          </div>

          <!-- Hide + Seek & Tag Parameters -->
          <div style="border-top:1px solid var(--border);padding-top:8px;display:flex;flex-direction:column;gap:7px">
            <strong style="font-size:12px;color:var(--accent-2)">Hide + Seek & Tag Rules</strong>
            <div class="grid-2">
              <div class="field">
                <label>Hiding Time (mins)</label>
                <input type="number" class="input" data-cfg-num="hidingMins" value="${s.game.hidingMins ?? 45}" min="5" max="180" ${dis} />
              </div>
              <div class="field">
                <label>Hiding Zone Radius (m)</label>
                <input type="number" class="input" data-cfg-num="hidingRadiusM" value="${s.game.hidingRadiusM ?? 500}" min="100" max="5000" step="100" ${dis} />
              </div>
              <div class="field">
                <label>Tag Catch Radius (m)</label>
                <input type="number" class="input" data-cfg-num="catchRadiusM" value="${s.game.catchRadiusM ?? 100}" min="10" max="1000" step="10" ${dis} />
              </div>
              <div class="field">
                <label>Flag / Checkpoint Radius (m)</label>
                <input type="number" class="input" data-cfg-num="checkpointRadiusM" value="${s.game.checkpointRadiusM ?? 100}" min="25" max="2000" step="25" ${dis} />
              </div>
            </div>
            <label class="toggle-row" style="padding:4px 0">
              <span style="font-size:12px;font-weight:600">Require Ordered Race Checkpoints (#1, #2, #3)</span>
              <input type="checkbox" data-cfg-bool="orderedCheckpoints" ${s.game.orderedCheckpoints ? 'checked' : ''} ${dis} />
            </label>
            <div class="field">
              <label>Transit Coin Costs (per min)</label>
              <div class="grid-2" style="gap:6px">
                ${TRANSIT_RATES.map(
                  (tr) => `
                  <div class="row-between" style="background:var(--bg);padding:5px 8px;border-radius:8px;border:1px solid var(--border)">
                    <span style="font-size:11px;font-weight:700">${tr.mode.replace('_', ' ').toUpperCase()}</span>
                    <input type="number" data-transit-rate="${tr.mode}" value="${trMap[tr.mode] ?? tr.coinsPerMin}" min="0" step="5" style="width:62px;background:var(--bg-card);border:1px solid var(--border-strong);border-radius:6px;padding:3px 6px;font-size:12px;text-align:right" ${dis} />
                  </div>`
                ).join('')}
              </div>
            </div>
          </div>

          <!-- Access Control & Anti-Cheat (GM Authority) -->
          <div style="border-top:1px solid var(--border);padding-top:8px;display:flex;flex-direction:column;gap:4px">
            <strong style="font-size:12px;color:#c084fc">Access Levels & Anti-Cheat</strong>
            ${[
              ['strictGpsProximity', 'Strict GPS Proximity Checks', 'Disable claiming stations/checkpoints unless physically within radius'],
              ['lockNamesAfterJoin', 'Lock Player Names', 'Players cannot rename themselves after locking/joining'],
              ['lockRulesToGm', 'Lock Rules & Clock to GM', 'Only Game Master or Permitted Co-Hosts can edit rules/mode/clock'],
              ['lockScoresToGm', 'Lock Score & Coin Overrides', 'Prevent players from manually adding/removing coins or points'],
              ['lockTeamsToGm', 'Lock Teams & Roles to GM', 'Prevent players from switching teams or roles mid-game'],
              ['lockDeckToGm', 'Lock Challenge Deck to GM', 'Prevent players from editing or deleting challenges'],
              ['allowDemoGps', 'Allow Demo GPS Pins', 'Enable only for indoor testing — keep OFF for real games']
            ]
              .map(
                ([k, lbl, desc]) => `
                <label class="toggle-row">
                  <div>
                    <div style="font-size:12px;font-weight:700">${lbl}</div>
                    <div class="muted" style="font-size:10.5px">${desc}</div>
                  </div>
                  <input type="checkbox" data-perm-toggle="${k}" ${perms[k] ? 'checked' : ''} ${access.isGm || !access.gmExists ? '' : 'disabled'} />
                </label>`
              )
              .join('')}
          </div>

          <!-- Modular Feature Toggles -->
          <div style="border-top:1px solid var(--border);padding-top:8px">
            <strong style="font-size:12px;color:var(--text-muted)">Enabled Mode Modules</strong>
            ${RULE_MODULES.map(
              (rm) => `
              <label class="toggle-row">
                <div>
                  <div style="font-size:12px;font-weight:700">${esc(rm.label)}</div>
                  <div class="muted" style="font-size:10.5px">${esc(rm.desc)}</div>
                </div>
                <input type="checkbox" data-rule-toggle="${rm.key}" ${s.game.rules[rm.key] ? 'checked' : ''} ${dis} />
              </label>`
            ).join('')}
          </div>
        </div>
      `;
    }

    // 2. ACTIVE MODE HQ RIGHT UP TOP (Most used controls during live play!)
    if (s.game.rules.hideSeekQA) {
      const cats = ['Radar', 'Thermometer', 'Matching', 'Measuring', 'Tentacles', 'Photo'];
      const qList = s.decks.questions.filter((q) => q.category === this.qaCategoryFilter);
      const hz = s.hidingZone;
      const canSeeHz = hz && (isHostGm || hz.revealed || hz.setByTeamId === myTeam?.id);
      const canManageHz = isHostGm || myTeam?.role === 'hider' || !access.gmExists;

      html += `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Hide + Seek HQ</div>
            <select id="hs-radius-select" class="select" style="width:auto;padding:4px 8px;font-size:12px" ${access.canEditRules ? '' : 'disabled'}>
              ${[500, 800, 1000, 1500, 2000].map((r) => `<option value="${r}" ${s.game.hidingRadiusM === r ? 'selected' : ''}>Zone: ${r}m</option>`).join('')}
            </select>
          </div>
          ${
            canManageHz
              ? `<div class="row">
                  <button class="btn btn-accent btn-sm" id="btn-hs-set-nearest" style="flex:1">${icon('pin', 13)} Set Zone at Nearest Stop</button>
                  ${hz ? `<button class="btn btn-secondary btn-sm" id="btn-hs-reveal">${hz.revealed ? 'Hide Zone' : 'Reveal'}</button>` : ''}
                </div>`
              : ''
          }
          ${canSeeHz ? `<div class="sp-badge" style="border-color:#168388;color:#2dd4bf">Hiding Zone: ${esc(hz.stationName)} (${hz.radiusM}m) ${hz.revealed ? '— REVEALED' : '— Private'}</div>` : ''}

          <div style="border-top:1px solid var(--border);padding-top:9px;display:flex;flex-direction:column;gap:8px">
            <div class="card-title" style="font-size:13px">Question Deck</div>
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
                      ${q.mapAction === 'radar' ? `<button class="btn btn-xs btn-secondary" data-q-radar="${q.radiusKm}">${icon('radar', 12)} Draw ${q.radiusKm}km</button>` : ''}
                      ${q.mapAction === 'thermometer' ? `<button class="btn btn-xs btn-secondary" data-q-thermo="1">${icon('thermometer', 12)} Plot Bisector</button>` : ''}
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
              <div class="card-title" style="font-size:13px">Asked Questions (${s.qaLog.length})</div>
              ${s.qaLog
                .slice()
                .reverse()
                .slice(0, 6)
                .map(
                  (qa) => `
                  <div class="feed-item qa">
                    <div class="row-between">
                      <strong>${esc(qa.title)}</strong>
                      <span class="muted" style="font-size:10.5px">${esc(qa.askedBy)}</span>
                    </div>
                    ${
                      qa.answer
                        ? `<div style="font-size:12.5px;color:#38bdf8;font-weight:700">${esc(qa.answeredBy)}: ${esc(qa.answer)}</div>`
                        : `<div class="row">
                            <button class="btn btn-xs btn-primary" data-ans-qa="${qa.id}:YES (HIT)">YES</button>
                            <button class="btn btn-xs btn-danger" data-ans-qa="${qa.id}:NO (MISS)">NO</button>
                            <button class="btn btn-xs btn-secondary" data-ans-qa="${qa.id}:HOTTER">HOTTER</button>
                            <button class="btn btn-xs btn-secondary" data-ans-qa="${qa.id}:COLDER">COLDER</button>
                            <button class="btn btn-xs btn-ghost" data-ans-custom="${qa.id}">Reply</button>
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

    if (s.game.rules.transitCosts || s.game.rules.winSectors) {
      const burn = s.activeTransitBurn;
      html += `<div class="card">
        <div class="card-title">Tag & Transit Engine</div>
        ${
          s.game.rules.transitCosts
            ? burn
              ? `
                <div class="sp-badge" style="border-color:#F99D1C;color:#F99D1C">
                  Riding ${esc(burn.label)} (${burn.coinsPerMin} coins/min)<br/>
                  <span class="mono" data-burn-since="${burn.startedAt}" data-burn-rate="${burn.coinsPerMin}">00:00</span>
                </div>
                <button class="btn btn-danger btn-sm" id="btn-stop-burn">Tap Off & Deduct Coins</button>
              `
              : `
                <div class="muted" style="font-size:11.5px">Tap onto transit to track live coin burn:</div>
                <div class="row">
                  ${TRANSIT_RATES.map((tr) => {
                    const rate = s.game.transitRates?.[tr.mode] ?? tr.coinsPerMin;
                    return `<button class="btn btn-xs btn-secondary" data-start-burn="${tr.mode}" style="border-color:${tr.color}">${tr.mode.replace('_', ' ').toUpperCase()} (${rate}/m)</button>`;
                  }).join('')}
                </div>
              `
            : ''
        }
        ${
          s.game.rules.winSectors
            ? `
              <div style="border-top:1px solid var(--border);padding-top:9px;display:flex;flex-direction:column;gap:8px">
                <div class="row-between">
                  <strong style="font-size:12.5px">Win Sectors (${esc(s.winSectors.centerName)})</strong>
                  <span class="muted">${s.winSectors.count} slices</span>
                </div>
                <div class="grid-2">
                  <div class="field">
                    <label>Sectors</label>
                    <select id="ws-count" class="select" ${access.canEditRules ? '' : 'disabled'}>
                      ${[2, 3, 4].map((n) => `<option value="${n}" ${s.winSectors.count === n ? 'selected' : ''}>${n} Sectors</option>`).join('')}
                    </select>
                  </div>
                  <div class="field">
                    <label>Rotation (${s.winSectors.rotationDeg}°)</label>
                    <input type="range" id="ws-rot" min="-180" max="180" step="5" value="${s.winSectors.rotationDeg}" ${access.canEditRules ? '' : 'disabled'} />
                  </div>
                </div>
              </div>
            `
            : ''
        }
      </div>`;
    }

    if (s.game.rules.stationClaiming) {
      const { teamStats, lineProgress } = rrData;
      const activeLines = lineProgress.filter((l) => l.total > 0);
      html += `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Rail Rush Control</div>
            <span class="tag-pill">${s.game.stationClaimRadiusM ?? 100}m GPS · +${s.game.railRushLineBonus} Bonus</span>
          </div>
          <button class="btn btn-primary btn-sm btn-block" id="btn-gps-checkin">${icon('crosshair', 13)} GPS Check-In Nearest Station</button>
          <div class="grid-2">
            ${s.teams
              .map((t) => {
                const st = teamStats[t.id] || { stations: 0, completedLines: [], totalScore: 0 };
                return `
                  <div class="feed-item" style="border-left:3px solid ${t.color}">
                    <strong style="font-size:12.5px">${esc(t.name)}</strong>
                    <div class="mono" style="font-size:16px;font-weight:800">${st.totalScore} pts</div>
                    <div class="muted" style="font-size:11px">${st.stations} stops · ${st.completedLines.length} lines</div>
                  </div>
                `;
              })
              .join('')}
          </div>
          <div style="max-height:220px;overflow-y:auto;padding-right:4px">
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

    if (s.game.rules.flags || s.game.rules.dividingLine) {
      const mySide =
        myPlayer?.lat != null && s.game.rules.dividingLine
          ? getDividingSide(myPlayer.lat, myPlayer.lng, s.dividingLine)
          : null;

      html += `
        <div class="card">
          <div class="card-title">Capture the Flag HQ</div>
          ${
            s.game.rules.dividingLine
              ? `
                <div class="field">
                  <label>Dividing Line</label>
                  <select id="ctf-preset-select" class="select" ${access.canEditRules ? '' : 'disabled'}>
                    ${CTF_PRESETS.map((p) => `<option value="${p.id}" ${s.dividingLine.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                  </select>
                </div>
                ${
                  mySide
                    ? `<div class="sp-badge" style="border-color:#f59e0b;color:#fbbf24">Current Territory: <strong>${esc(mySide === 'A' ? s.dividingLine.sideALabel : s.dividingLine.sideBLabel)}</strong></div>`
                    : ''
                }
              `
              : ''
          }
          ${
            s.game.rules.flags
              ? `
                ${
                  s.flags.length
                    ? s.flags
                        .map((fl) => {
                          const team = s.teams.find((t) => t.id === fl.teamId);
                          return `
                            <div class="feed-item" style="border-left:3px solid ${team?.color || '#F99D1C'}">
                              <div class="row-between">
                                <strong>${esc(fl.label)}</strong>
                                <span class="tag-pill">${fl.status.toUpperCase()}</span>
                              </div>
                              <div class="row">
                                <button class="btn btn-xs btn-secondary" data-flag-status="${fl.id}:carried">Pick Up</button>
                                <button class="btn btn-xs btn-primary" data-flag-status="${fl.id}:captured">Capture (+1)</button>
                                ${access.canEditRules ? `<button class="btn btn-xs btn-ghost" data-flag-status="${fl.id}:base">Reset</button>` : ''}
                                ${access.canEditRules ? `<button class="btn btn-xs btn-danger" data-flag-del="${fl.id}">${icon('x', 11)}</button>` : ''}
                              </div>
                            </div>`;
                        })
                        .join('')
                    : access.canEditRules
                      ? `<button class="btn btn-secondary btn-sm" id="btn-seed-ctf-flags">Place Starter Flags (North Sydney & Parramatta)</button>`
                      : `<div class="muted" style="font-size:11.5px">Waiting for Game Master to place flags.</div>`
                }
              `
              : ''
          }
        </div>
      `;
    }

    if (s.game.rules.checkpoints) {
      html += `
        <div class="card">
          <div class="card-title">Race Checkpoints</div>
          ${
            access.canEditRules
              ? `<div class="row">
                  <select id="race-preset-select" class="select" style="flex:1">
                    <option value="">Load a Sydney Race Preset...</option>
                    ${RACE_PRESETS.map((rp) => `<option value="${rp.id}">${esc(rp.name)}</option>`).join('')}
                  </select>
                  <button class="btn btn-secondary btn-sm" id="btn-load-race-preset">Load</button>
                </div>`
              : ''
          }
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
                            <button class="btn btn-xs ${myDone ? 'btn-accent' : 'btn-primary'}" data-toggle-cp="${cp.id}">${myDone ? 'Done' : 'Check In'}</button>
                            ${access.canEditRules ? `<button class="btn btn-xs btn-ghost" data-del-cp="${cp.id}">${icon('x', 11)}</button>` : ''}
                          </div>
                        </div>
                        ${doneTeams.length ? `<div class="muted" style="font-size:11px">Cleared by: ${esc(doneTeams.join(', '))}</div>` : ''}
                      </div>`;
                  })
                  .join('')
              : `<div class="muted">Load a preset above or tap any station on the map to add checkpoints.</div>`
          }
        </div>
      `;
    }

    // 3. Teams & Scoreboard
    html += `
      <div class="card">
        <div class="card-header">
          <div class="card-title">Teams & Scoreboard</div>
          <div class="row" style="gap:5px">
            ${access.canClaimGm && !isHostGm ? `<button class="btn btn-xs btn-ghost" id="btn-gm-enter">Host Event (GM)</button>` : ''}
            ${access.canEditTeams ? `<button class="btn btn-xs btn-secondary" id="btn-add-team">+ Add Team</button>` : ''}
          </div>
        </div>
        ${s.teams
          .map((t) => {
            const isMine = !isHostGm && myTeam?.id === t.id;
            const members = Object.values(s.players).filter((p) => !p.isEventHost && p.teamId === t.id);
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
                    ${
                      access.canEditTeams
                        ? `<select class="select" data-team-role="${t.id}" style="width:auto;padding:3px 7px;font-size:11px">
                            ${['hider', 'seeker', 'runner', 'chaser', 'north', 'south', 'racer', 'team']
                              .map((r) => `<option value="${r}" ${t.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`)
                              .join('')}
                          </select>`
                        : `<span class="tag-pill">${esc((t.role || 'team').toUpperCase())}</span>`
                    }
                    ${!isMine && !isHostGm && access.canEditTeams ? `<button class="btn btn-xs btn-ghost" data-join-team="${t.id}">Join</button>` : ''}
                    ${access.canEditTeams ? `<button class="btn btn-xs btn-ghost" data-edit-team="${t.id}" title="Rename team">${icon('edit', 12)}</button>` : ''}
                  </div>
                </div>
                <div class="team-stat-row">
                  ${s.game.rules.economy ? `<span class="stat-pill">${t.coins} coins</span>` : ''}
                  <span class="stat-pill">${t.points + (rrScore?.totalScore || 0)} pts</span>
                  ${rrScore ? `<span class="stat-pill">${rrScore.stations} stops</span>` : ''}
                  <span class="muted" style="font-size:11.5px">${members.length ? members.map((m) => esc(m.name)).join(', ') : 'No players'}</span>
                </div>
                ${vetoRem > 0 ? `<div class="sp-badge" style="border-color:#ef4444;color:#f87171">Veto Cooldown: <span data-countdown-until="${t.vetoEndsAt}">${formatClock(vetoRem)}</span> ${access.canEditScores ? `<button class="btn btn-xs btn-ghost" data-gm-clear-veto="${t.id}" style="margin-left:6px">Clear</button>` : ''}</div>` : ''}
                ${t.doubleNext ? `<div class="sp-badge" style="border-color:#F99D1C;color:#F99D1C">2X Double Next Challenge Active</div>` : ''}
                ${
                  access.canEditScores
                    ? `<div class="row">
                        <button class="btn btn-xs btn-ghost" data-pts-delta="${t.id}:1">+1 pt</button>
                        <button class="btn btn-xs btn-ghost" data-pts-delta="${t.id}:-1">-1 pt</button>
                        ${s.game.rules.economy ? `<button class="btn btn-xs btn-ghost" data-coins-delta="${t.id}:250">+250</button><button class="btn btn-xs btn-ghost" data-coins-delta="${t.id}:-250">-250</button>` : ''}
                      </div>`
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    pane.innerHTML = html;
    this.bindGamePaneEvents(pane);
  }

  bindGamePaneEvents(pane) {
    pane.querySelector('#btn-game-open-sched')?.addEventListener('click', () => this.switchTab('live'));
    pane.querySelector('#btn-gm-enter')?.addEventListener('click', () => this.setEventHostMode(true));
    pane.querySelector('#btn-gm-exit')?.addEventListener('click', () => this.setEventHostMode(false));

    const sendBroadcast = () => {
      const inp = pane.querySelector('#gm-broadcast-input');
      const text = inp?.value.trim();
      if (!text) return;
      store.addFeed({
        type: 'broadcast',
        author: `${store.getLocalPlayer()?.name || 'Host'} (HOST)`,
        teamId: null,
        text
      });
      inp.value = '';
      this.toast('Announcement broadcasted to all players.');
    };
    pane.querySelector('#btn-gm-broadcast')?.addEventListener('click', sendBroadcast);
    pane.querySelector('#gm-broadcast-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendBroadcast();
    });

    pane.querySelectorAll('[data-gm-clear-veto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.mutate((s) => {
          const t = s.teams.find((x) => x.id === btn.dataset.gmClearVeto);
          if (t) t.vetoEndsAt = 0;
        }, 'teams');
        this.toast('Cleared team veto cooldown.');
      });
    });

    pane.querySelector('#btn-toggle-modes')?.addEventListener('click', () => {
      this.showModePicker = !this.showModePicker;
      this.renderGamePane();
    });

    pane.querySelector('#btn-toggle-rules')?.addEventListener('click', () => {
      this.showRulesConfig = !this.showRulesConfig;
      this.renderGamePane();
    });

    pane.querySelector('#btn-reset-game')?.addEventListener('click', () => {
      if (confirm('Reset scores, claims, flags, checkpoints, overlays, and timers for a new round?')) {
        store.resetGameOnly();
        this.toast('Game reset cleanly.');
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
      store.addFeed({ type: 'system', text: `Hiding countdown started (${num} minutes).` });
    });

    pane.querySelectorAll('[data-pick-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modeId = btn.dataset.pickMode;
        const m = GAME_MODES[modeId];
        this.showModePicker = false;
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
        store.addFeed({ type: 'system', text: `Switched game mode to ${m.name}.` });
      });
    });

    pane.querySelectorAll('[data-rule-toggle]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (!getAccess(store.get()).canEditRules) return;
        const key = cb.dataset.ruleToggle;
        store.mutate((s) => {
          s.game.rules[key] = cb.checked;
          if (key === 'dividingLine') s.dividingLine.enabled = cb.checked;
          if (key === 'winSectors') s.winSectors.enabled = cb.checked;
        }, 'rules');
      });
    });

    pane.querySelectorAll('[data-cfg-num]').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (!getAccess(store.get()).canEditRules) return;
        const key = inp.dataset.cfgNum;
        const val = Math.max(0, Number(inp.value) || 0);
        store.mutate((s) => {
          s.game[key] = val;
          if (key === 'checkpointRadiusM') s.game.flagPickupRadiusM = val;
          if (key === 'hidingRadiusM' && s.hidingZone) s.hidingZone.radiusM = val;
        }, 'rules');
      });
    });

    pane.querySelectorAll('[data-cfg-bool]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (!getAccess(store.get()).canEditRules) return;
        const key = cb.dataset.cfgBool;
        store.mutate((s) => { s.game[key] = cb.checked; }, 'rules');
      });
    });

    pane.querySelectorAll('[data-transit-rate]').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (!getAccess(store.get()).canEditRules) return;
        const mode = inp.dataset.transitRate;
        const val = Math.max(0, Number(inp.value) || 0);
        store.mutate((s) => {
          if (!s.game.transitRates) s.game.transitRates = {};
          s.game.transitRates[mode] = val;
        }, 'rules');
      });
    });

    pane.querySelector('#btn-apply-start-coins')?.addEventListener('click', () => {
      if (!getAccess(store.get()).canEditRules) return;
      const amt = Math.max(0, Number(store.get().game.startingCoins) || 0);
      store.mutate((s) => {
        s.teams.forEach((t) => { t.coins = amt; });
      }, 'score');
      store.addFeed({ type: 'system', text: `set all teams to ${amt} starting coins.` });
      this.toast(`Set all teams to ${amt} coins.`);
    });

    pane.querySelectorAll('[data-perm-toggle]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const acc = getAccess(store.get());
        if (!acc.isGm && acc.gmExists) return;
        const key = cb.dataset.permToggle;
        store.mutate((s) => {
          if (!s.permissions) s.permissions = {};
          s.permissions[key] = cb.checked;
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
        this.toast('Switched team.');
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
      if (p?.lat == null) return this.toast('Enable GPS or place a Demo Pin (Live tab), or tap any station on the map.');
      const nearest = this.mapCtrl.findNearestStation(p.lat, p.lng);
      if (nearest) this.setHidingZoneAt(nearest.station);
    });

    pane.querySelector('#btn-hs-reveal')?.addEventListener('click', () => {
      store.mutate((s) => {
        if (s.hidingZone) s.hidingZone.revealed = !s.hidingZone.revealed;
      }, 'hideseek');
      const rev = store.get().hidingZone?.revealed;
      store.addFeed({ type: 'system', text: rev ? 'Hiding Zone revealed to all players.' : 'Hiding Zone hidden again.' });
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
            askedBy: p.isEventHost ? `${p.name} (HOST)` : p.name,
            askedTeamId: t?.id || null,
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
          if (window.innerWidth <= 920) document.getElementById('side-panel').classList.remove('mobile-open');
          this.toast(`Tap anywhere on the map to place your ${km} km Radar.`);
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
        const customRate = store.get().game.transitRates?.[tr.mode] ?? tr.coinsPerMin;
        const targetTeam = this.getActionTeam();
        store.mutate((s) => {
          s.activeTransitBurn = { ...tr, coinsPerMin: customRate, startedAt: Date.now(), teamId: targetTeam.id };
        }, 'burn');
        store.addFeed({ type: 'system', text: `tapped onto ${tr.label} for ${targetTeam.name} (${customRate} coins/min).` });
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
      this.toast(`Deducted ${cost} coins (${mins} min ride).`);
    });

    pane.querySelector('#ws-count')?.addEventListener('change', (e) => {
      store.mutate((s) => { s.winSectors.count = Number(e.target.value); }, 'sectors');
    });
    pane.querySelector('#ws-rot')?.addEventListener('input', (e) => {
      store.mutate((s) => { s.winSectors.rotationDeg = Number(e.target.value); }, 'sectors');
    });

    // Rail Rush
    pane.querySelector('#btn-gps-checkin')?.addEventListener('click', () => {
      const s = store.get();
      const access = getAccess(s);
      const p = store.getLocalPlayer();
      if (p?.lat == null) {
        return this.toast(access.canUseDemoGps ? 'Turn on Live GPS (or place a Demo Pin in the Live tab) first.' : 'Live GPS fix required to check in at a station.');
      }
      const res = this.mapCtrl.findNearestStation(p.lat, p.lng);
      if (!res) return;
      const maxM = Number(s.game.stationClaimRadiusM) || 100;
      if (access.mustVerifyGps && res.distanceM > maxM) {
        return this.toast(`Too far from ${res.station.name} (${formatDistance(res.distanceM)} away — must be within ${maxM}m).`);
      }
      this.toggleStationClaim(res.station, true);
      this.mapCtrl.flyToStation(res.station.id);
    });

    pane.querySelectorAll('[data-isolate-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = this.mapCtrl.toggleIsolateLine(btn.dataset.isolateLine);
        this.updateIsolatedPill();
        this.toast(code ? `Highlighting ${code}` : 'Showing all Sydney lines');
        if (code && window.innerWidth <= 920) document.getElementById('side-panel').classList.remove('mobile-open');
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
        store.addFeed({ type: 'system', text: `updated flag status to ${status.toUpperCase()}.` });
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
      this.toast('Placed starter flags at North Sydney and Parramatta.');
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
      store.addFeed({ type: 'system', text: `loaded Race preset: ${preset.name} (${cps.length} checkpoints).` });
      this.mapCtrl.fitGreaterSydney();
    });

    pane.querySelectorAll('[data-fly-cp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mapCtrl.flyToStation(btn.dataset.flyCp);
        if (window.innerWidth <= 920) document.getElementById('side-panel').classList.remove('mobile-open');
      });
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
  setEventHostMode(enabled) {
    const s = store.get();
    const access = getAccess(s);
    if (access.gameActive) {
      return this.toast('Roles are locked while the game is active. Reset to Lobby to switch.');
    }
    if (enabled && !access.canClaimGm) {
      return this.toast(access.gmExists ? 'A Game Master is already active.' : 'Only the room host can claim Game Master — ask them for permission.');
    }
    if (!enabled && !access.canStepDownGm) {
      return;
    }
    if (enabled && s.room.shareGps) {
      this.mp.stopGps();
    }
    store.mutate((st) => {
      const p = st.players[st.localPlayerId];
      if (!p) return;
      p.isEventHost = Boolean(enabled);
      p.accessLevel = enabled ? 'gm' : 'player';
      if (enabled) {
        p.teamId = null;
        p.gpsHidden = true;
      } else {
        const firstTeam = st.teams[0];
        p.teamId = firstTeam?.id || 'team-a';
        p.color = firstTeam?.color || '#F99D1C';
        p.gpsHidden = false;
      }
    }, 'profile');
    this.toast(enabled ? 'Switched to Game Master (Non-Playing Host) mode.' : 'Switched back to Playing mode.');
  }

  getActionTeam(overrideTeamId = null) {
    const s = store.get();
    if (overrideTeamId) return s.teams.find((t) => t.id === overrideTeamId) || s.teams[0];
    return store.getLocalTeam() || s.teams[0];
  }

  toggleStationClaim(station, claim, overrideTeamId = null) {
    const s = store.get();
    const access = getAccess(s);
    const targetTeam = this.getActionTeam(overrideTeamId);
    const myPlayer = store.getLocalPlayer();

    if (claim && !access.isGm) {
      const existing = s.claimedStations?.[station.id];
      if (existing && existing.teamId !== targetTeam?.id && s.game.allowStealingStations === false) {
        return this.toast(`${station.name} is already claimed (stealing disabled).`);
      }
      if (access.mustVerifyGps) {
        const maxM = Number(s.game.stationClaimRadiusM) || 100;
        if (myPlayer?.lat == null) {
          return this.toast(`Live GPS required to claim ${station.name} (must be within ${maxM}m).`);
        }
        const dist = haversineM(myPlayer.lat, myPlayer.lng, station.lat, station.lng);
        if (dist > maxM) {
          return this.toast(`Too far from ${station.name} (${formatDistance(dist)} away — limit is ${maxM}m).`);
        }
      }
    }

    store.mutate((st) => {
      if (claim && targetTeam) {
        st.claimedStations[station.id] = { teamId: targetTeam.id, playerId: myPlayer.id, playerName: myPlayer.name, claimedAt: Date.now() };
      } else {
        delete st.claimedStations[station.id];
      }
    }, 'claim');
    store.addFeed({
      type: 'challenge',
      text: claim ? `claimed ${station.name} (${station.lines.join(', ')}) for ${targetTeam.name}.` : `released claim on ${station.name}.`
    });
    this.toast(claim ? `Claimed ${station.name} for ${targetTeam.name}` : `Unclaimed ${station.name}`);
  }

  setHidingZoneAt(station) {
    const myTeam = this.getActionTeam();
    const radiusM = store.get().game.hidingRadiusM || 500;
    store.mutate((s) => {
      s.hidingZone = {
        lat: station.lat,
        lng: station.lng,
        radiusM,
        stationId: station.id,
        stationName: station.name,
        setByTeamId: myTeam?.id || null,
        revealed: false
      };
    }, 'hideseek');
    this.toast(`Hiding Zone locked at ${station.name} (${radiusM}m).`);
  }

  dropFlagAt(station, overrideTeamId = null) {
    const targetTeam = this.getActionTeam(overrideTeamId);
    store.mutate((s) => {
      s.flags.push({
        id: uid('flg'),
        label: `${targetTeam.name} @ ${station.name}`,
        teamId: targetTeam.id,
        status: 'base',
        stationId: station.id,
        lat: station.lat,
        lng: station.lng
      });
    }, 'ctf');
    store.addFeed({ type: 'system', text: `placed a flag for ${targetTeam.name} at ${station.name}.` });
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
    const s = store.get();
    const access = getAccess(s);
    const myTeam = this.getActionTeam();
    const myPlayer = store.getLocalPlayer();
    const cpIdx = s.checkpoints.findIndex((c) => c.id === cpId);
    const cpObj = s.checkpoints[cpIdx];
    if (!cpObj) return;

    const alreadyDone = Boolean(cpObj.completedBy?.[myTeam.id]);
    if (!alreadyDone && !access.isGm) {
      if (s.game.orderedCheckpoints && cpIdx > 0) {
        const prevDone = Boolean(s.checkpoints[cpIdx - 1]?.completedBy?.[myTeam.id]);
        if (!prevDone) {
          return this.toast(`Ordered Race: complete Checkpoint #${cpIdx} (${s.checkpoints[cpIdx - 1].name}) first.`);
        }
      }
      if (access.mustVerifyGps) {
        const maxM = Number(s.game.checkpointRadiusM) || 100;
        if (myPlayer?.lat == null) return this.toast(`Live GPS required to check in at ${cpObj.name}.`);
        const dist = haversineM(myPlayer.lat, myPlayer.lng, cpObj.lat, cpObj.lng);
        if (dist > maxM) {
          return this.toast(`Too far from ${cpObj.name} (${formatDistance(dist)} away — must be within ${maxM}m).`);
        }
      }
    }

    const pts = Math.max(0, Number(s.game.checkpointPoints) || 1);
    let cpName = '';
    let nowDone = false;
    store.mutate((st) => {
      const cp = st.checkpoints.find((c) => c.id === cpId);
      if (!cp) return;
      cpName = cp.name;
      if (!cp.completedBy) cp.completedBy = {};
      if (cp.completedBy[myTeam.id]) {
        if (!access.canEditScores) return;
        delete cp.completedBy[myTeam.id];
      } else {
        cp.completedBy[myTeam.id] = Date.now();
        const tm = st.teams.find((x) => x.id === myTeam.id);
        if (tm) tm.points += pts;
        nowDone = true;
      }
    }, 'race');
    if (nowDone) store.addFeed({ type: 'challenge', text: `cleared Race Checkpoint: ${cpName} (+${pts} pt).` });
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

  // ===== TAB 2: WHEEL, POWERUP SHOP & DECK BUILDER =====
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
      row.innerHTML = `<span class="muted">Active Sydney Curse Deck (${store.get().decks.curses.filter((c) => c.active).length} active)</span>`;
      return;
    }
    row.innerHTML = `
      <select id="wheel-cat-sel" class="select" style="flex:1;padding:6px 8px;font-size:12.5px">
        <option value="all">All Categories</option>
        ${CHALLENGE_CATEGORIES.map((c) => `<option value="${c.id}" ${this.wheelCat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
      <select id="wheel-diff-sel" class="select" style="width:110px;padding:6px 8px;font-size:12.5px">
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
    const s = store.get();
    const card = this.landedCard;

    // Show clean empty-state prompt when user hasn't created any custom challenges yet
    if (!card && this.wheelMode === 'challenges' && s.decks.challenges.length === 0) {
      slot.innerHTML = `
        <div class="empty-box">
          <strong style="font-family:var(--font-display);font-size:15px">Your Challenge Deck is Empty</strong>
          <div class="muted">Create your own custom challenges to load onto the wheel.</div>
          <button class="btn btn-primary btn-sm" id="btn-empty-create-challenge">${icon('plus', 14)} Create Your First Challenge</button>
        </div>
      `;
      slot.querySelector('#btn-empty-create-challenge')?.addEventListener('click', () => {
        this.openAddCardModal('challenge');
      });
      return;
    }

    if (!card) {
      slot.innerHTML = '';
      return;
    }
    const isHostGm = Boolean(store.getLocalPlayer()?.isEventHost);
    const myTeam = this.getActionTeam(this.hostTargetTeamId);
    const isCurse = card.wheelMode === 'curses';
    const reward = isCurse ? card.cost : myTeam?.doubleNext ? card.coins * 2 : card.coins;

    slot.innerHTML = `
      <div class="landed-card">
        <div class="row-between">
          <span class="tag-pill" style="border-color:var(--accent);color:var(--accent)">${isCurse ? 'CURSE DRAWN' : esc(card.difficulty || 'Challenge').toUpperCase()}</span>
          <span class="mono" style="font-weight:800;color:var(--accent)">${isCurse ? `Cost: ${card.cost} coins` : `+${reward} coins`}</span>
        </div>
        <h3>${esc(card.title)}</h3>
        <p class="muted" style="color:var(--text)">${esc(card.description)}</p>
        ${
          isHostGm
            ? `<div class="field">
                <label>Apply to Team (Event Host)</label>
                <select id="gm-wheel-team" class="select" style="padding:6px 8px;font-size:12.5px">
                  ${s.teams.map((t) => `<option value="${t.id}" ${myTeam?.id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                </select>
              </div>`
            : ''
        }
        ${
          isCurse
            ? `
              <div class="muted" style="font-size:11.5px">Duration: ${card.durationMins}m · ${esc(card.castingCondition || 'Standard')}</div>
              <div class="row">
                <button class="btn btn-danger btn-sm" id="btn-cast-landed-curse" style="flex:1">${isHostGm ? `Cast on ${esc(myTeam?.name || 'Team')}` : 'Cast on Opponent'}</button>
                <button class="btn btn-ghost btn-sm" id="btn-dismiss-landed">Dismiss</button>
              </div>
            `
            : `
              <div class="muted" style="font-size:11.5px">Veto Penalty: ${card.vetoMins} mins ${myTeam?.doubleNext ? '· 2X DOUBLE ACTIVE' : ''}</div>
              <div class="row">
                <button class="btn btn-primary btn-sm" id="btn-accept-landed" style="flex:1">${isHostGm ? 'Assign' : 'Accept'}</button>
                <button class="btn btn-accent btn-sm" id="btn-complete-landed">Complete</button>
                <button class="btn btn-danger btn-sm" id="btn-veto-landed">Veto (${card.vetoMins}m)</button>
              </div>
            `
        }
      </div>
    `;

    slot.querySelector('#gm-wheel-team')?.addEventListener('change', (e) => {
      this.hostTargetTeamId = e.target.value;
      this.renderWheelLanded();
    });
    slot.querySelector('#btn-dismiss-landed')?.addEventListener('click', () => {
      this.landedCard = null;
      this.renderWheelLanded();
    });
    slot.querySelector('#btn-accept-landed')?.addEventListener('click', () => {
      const target = this.getActionTeam(this.hostTargetTeamId);
      store.mutate((st) => {
        const t = st.teams.find((x) => x.id === target.id);
        if (t) t.activeChallenge = { ...card, acceptedAt: Date.now() };
      }, 'challenge');
      store.addFeed({ type: 'challenge', text: isHostGm ? `assigned "${card.title}" (+${reward} coins) to ${target.name}.` : `accepted challenge: "${card.title}" (+${reward} coins).` });
      this.landedCard = null;
      this.renderWheelLanded();
    });
    slot.querySelector('#btn-complete-landed')?.addEventListener('click', () => {
      this.completeChallengeCard(card, isHostGm ? this.hostTargetTeamId : null);
      this.landedCard = null;
      this.renderWheelLanded();
    });
    slot.querySelector('#btn-veto-landed')?.addEventListener('click', () => {
      this.vetoChallengeCard(card, isHostGm ? this.hostTargetTeamId : null);
      this.landedCard = null;
      this.renderWheelLanded();
    });
    slot.querySelector('#btn-cast-landed-curse')?.addEventListener('click', () => {
      this.castCurse(card, isHostGm ? this.hostTargetTeamId : null);
      this.landedCard = null;
      this.renderWheelLanded();
    });
  }

  renderWheelSideSections() {
    const s = store.get();
    const myTeam = store.getLocalTeam();

    // Active Challenge
    const acSlot = document.getElementById('active-challenge-slot');
    if (acSlot) {
      const ac = myTeam?.activeChallenge;
      if (ac) {
        const reward = myTeam.doubleNext ? ac.coins * 2 : ac.coins;
        acSlot.innerHTML = `
          <div class="card" style="border-color:var(--accent-2)">
            <div class="row-between">
              <div class="card-title">Active Challenge</div>
              <span class="mono" style="color:var(--accent);font-weight:800">+${reward} coins</span>
            </div>
            <strong>${esc(ac.title)}</strong>
            <p class="muted">${esc(ac.description)}</p>
            <div class="row">
              <button class="btn btn-primary btn-sm" id="btn-ac-complete" style="flex:1">Complete & Claim</button>
              <button class="btn btn-danger btn-sm" id="btn-ac-veto">Veto (${ac.vetoMins}m)</button>
            </div>
          </div>
        `;
        acSlot.querySelector('#btn-ac-complete').addEventListener('click', () => this.completeChallengeCard(ac));
        acSlot.querySelector('#btn-ac-veto').addEventListener('click', () => this.vetoChallengeCard(ac));
      } else {
        acSlot.innerHTML = '';
      }
    }

    // Active Curses
    const cuSlot = document.getElementById('active-curses-slot');
    if (cuSlot) {
      const canClearCurse = getAccess(s).canEditScores;
      const liveCurses = (s.activeCurses || []).filter((c) => c.expiresAt > Date.now());
      cuSlot.innerHTML = liveCurses.length
        ? `
          <div class="card" style="border-color:rgba(239,68,68,0.45)">
            <div class="card-title">Active Curses (${liveCurses.length})</div>
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
                    ${canClearCurse ? `<button class="btn btn-xs btn-ghost" data-clear-curse="${c.id}">Clear Curse</button>` : ''}
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

    // Powerup Shop Sub-view
    const shopSlot = document.getElementById('wsub-shop');
    if (shopSlot) {
      const shopTeam = this.getActionTeam(this.hostTargetTeamId);
      const isHostGm = Boolean(store.getLocalPlayer()?.isEventHost);
      shopSlot.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Powerup Shop</div>
            <span class="stat-pill" style="color:var(--accent)">${esc(shopTeam.name)}: ${shopTeam.coins} coins</span>
          </div>
          ${
            isHostGm
              ? `<div class="field">
                  <label>Team Buying Powerup (Event Host)</label>
                  <select id="gm-shop-team" class="select" style="padding:6px 8px;font-size:12.5px">
                    ${s.teams.map((t) => `<option value="${t.id}" ${shopTeam.id === t.id ? 'selected' : ''}>${esc(t.name)} (${t.coins} coins)</option>`).join('')}
                  </select>
                </div>`
              : ''
          }
          ${POWERUPS_SHOP.map(
            (pw) => `
            <div class="feed-item">
              <div class="row-between">
                <div class="row"><span class="pw-badge">${esc(pw.icon)}</span><strong>${esc(pw.title)}</strong></div>
                <button class="btn btn-xs btn-primary" data-buy-pw="${pw.id}">${pw.cost} coins</button>
              </div>
              <div class="muted" style="font-size:11.5px">${esc(pw.description)}</div>
            </div>`
          ).join('')}
        </div>
      `;
      shopSlot.querySelector('#gm-shop-team')?.addEventListener('change', (e) => {
        this.hostTargetTeamId = e.target.value;
        this.renderWheelSideSections();
      });
      shopSlot.querySelectorAll('[data-buy-pw]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pw = POWERUPS_SHOP.find((x) => x.id === btn.dataset.buyPw);
          if (!pw) return;
          const team = this.getActionTeam(this.hostTargetTeamId);
          if (team.coins < pw.cost) return this.toast(`Not enough coins. Need ${pw.cost} coins.`);
          store.mutate((st) => {
            const t = st.teams.find((x) => x.id === team.id);
            if (!t) return;
            t.coins -= pw.cost;
            if (pw.id === 'pw-double') t.doubleNext = true;
            if (pw.id === 'pw-veto-shield') t.vetoEndsAt = 0;
            if (pw.id === 'pw-freeze' && !isHostGm) {
              const p = st.players[st.localPlayerId];
              if (p) {
                p.gpsFrozen = true;
                p.frozenLat = p.lat;
                p.frozenLng = p.lng;
                st.room.freezeEndsAt = Date.now() + 15 * 60000;
              }
            }
          }, 'powerup');
          store.addFeed({ type: 'system', text: `${team.name} bought powerup: ${pw.title} (-${pw.cost} coins).` });
          this.toast(`Activated ${pw.title} for ${team.name}.`);
        });
      });
    }

    // Custom Deck Builder Sub-view (Locked when GM restricts deck editing)
    const deckSlot = document.getElementById('wsub-deck');
    if (deckSlot) {
      const access = getAccess(s);
      const isCh = this.deckKind === 'challenges';
      const list = isCh ? s.decks.challenges : s.decks.curses;
      deckSlot.innerHTML = `
        ${
          access.canEditDeck
            ? `<div class="card">
                <div class="card-header">
                  <div class="card-title">Create Custom ${isCh ? 'Challenge' : 'Curse'}</div>
                  <div class="row" style="gap:4px">
                    <button class="btn btn-xs ${isCh ? 'btn-primary' : 'btn-ghost'}" data-deck-kind="challenges">Challenges (${s.decks.challenges.length})</button>
                    <button class="btn btn-xs ${!isCh ? 'btn-primary' : 'btn-ghost'}" data-deck-kind="curses">Curses (${s.decks.curses.length})</button>
                  </div>
                </div>
                <div class="field">
                  <label>Title</label>
                  <input type="text" id="qc-title" class="input" placeholder="${isCh ? 'e.g. Touch the Water at Manly' : 'e.g. Curse of the Slow Train'}" />
                </div>
                <div class="field">
                  <label>Rules / Description</label>
                  <textarea id="qc-desc" class="textarea" placeholder="What do players need to do to complete or prove it?"></textarea>
                </div>
                <div class="grid-2">
                  <div class="field">
                    <label>${isCh ? 'Reward (Coins)' : 'Cost (Coins)'}</label>
                    <input type="number" id="qc-coins" class="input" value="500" min="0" step="50" />
                  </div>
                  <div class="field">
                    <label>${isCh ? 'Veto Penalty (Mins)' : 'Duration (Mins)'}</label>
                    <input type="number" id="qc-mins" class="input" value="${s.game.defaultVetoMins ?? 15}" min="1" />
                  </div>
                </div>
                ${
                  isCh
                    ? `<div class="grid-2">
                        <div class="field">
                          <label>Category</label>
                          <select id="qc-cat" class="select">${CHALLENGE_CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select>
                        </div>
                        <div class="field">
                          <label>Difficulty</label>
                          <select id="qc-diff" class="select"><option>Easy</option><option selected>Medium</option><option>Hard</option></select>
                        </div>
                      </div>`
                    : `<div class="field">
                        <label>Casting Condition (Optional)</label>
                        <input type="text" id="qc-cond" class="input" placeholder="e.g. Pay coin cost / Discard 1 card" value="Pay coin cost" />
                      </div>`
                }
                <button class="btn btn-primary btn-block" id="btn-qc-add">${icon('plus', 14)} Add ${isCh ? 'Challenge' : 'Curse'} to Wheel</button>
              </div>`
            : `<div class="card"><div class="card-title">${icon('lock', 14)} Deck Locked by Game Master</div><div class="muted">Only the Game Master (or permitted Co-Host) can add, edit, or delete cards while this session is active.</div></div>`
        }

        <div class="card">
          <div class="card-header">
            <div class="card-title">${isCh ? 'My Challenges' : 'Curses'} (${list.length})</div>
            <div class="row" style="gap:4px">
              <button class="btn btn-xs btn-secondary" id="btn-export-deck">Export</button>
              ${access.canEditDeck ? `<button class="btn btn-xs btn-secondary" id="btn-import-deck">Import</button>` : ''}
              ${access.canEditDeck && list.length ? `<button class="btn btn-xs btn-danger" id="btn-clear-deck">Clear All</button>` : ''}
            </div>
          </div>
          ${
            list.length === 0
              ? `<div class="muted" style="text-align:center;padding:8px 0">No ${isCh ? 'challenges' : 'curses'} yet.</div>`
              : `<div style="display:flex;flex-direction:column;gap:4px">
                  ${list
                    .map(
                      (c) => `
                      <div class="toggle-row">
                        <label class="row" style="flex:1;cursor:pointer;min-width:0">
                          <input type="checkbox" data-toggle-card="${this.deckKind}:${c.id}" ${c.active ? 'checked' : ''} ${access.canEditDeck ? '' : 'disabled'} />
                          <div style="min-width:0">
                            <div style="font-size:12.5px;font-weight:700">${esc(c.title)} <span class="muted">(${isCh ? `${c.coins} coins` : `${c.cost} coins`})</span></div>
                            <div class="muted" style="font-size:11px">${esc(c.description.slice(0, 74))}${c.description.length > 74 ? '...' : ''}</div>
                          </div>
                        </label>
                        ${
                          access.canEditDeck
                            ? `<div class="row" style="gap:4px;flex-shrink:0">
                                <button class="btn btn-xs btn-ghost" data-edit-card="${this.deckKind}:${c.id}" title="Edit">${icon('edit', 12)}</button>
                                <button class="btn btn-xs btn-ghost" data-del-card="${this.deckKind}:${c.id}" title="Delete">${icon('trash', 12)}</button>
                              </div>`
                            : ''
                        }
                      </div>`
                    )
                    .join('')}
                </div>`
          }
        </div>
      `;

      deckSlot.querySelectorAll('[data-deck-kind]').forEach((b) => {
        b.addEventListener('click', () => {
          this.deckKind = b.dataset.deckKind;
          this.renderWheelSideSections();
        });
      });

      deckSlot.querySelector('#btn-qc-add')?.addEventListener('click', () => {
        const title = deckSlot.querySelector('#qc-title').value.trim();
        const description = deckSlot.querySelector('#qc-desc').value.trim();
        if (!title) return this.toast('Enter a title for your card.');
        const coins = Math.max(0, Number(deckSlot.querySelector('#qc-coins').value) || 0);
        const mins = Math.max(1, Number(deckSlot.querySelector('#qc-mins').value) || 15);
        store.mutate((st) => {
          if (isCh) {
            st.decks.challenges.unshift({
              id: uid('ch'),
              title,
              description: description || 'Complete this challenge and submit proof.',
              coins,
              vetoMins: mins,
              category: deckSlot.querySelector('#qc-cat').value,
              difficulty: deckSlot.querySelector('#qc-diff').value,
              active: true
            });
          } else {
            st.decks.curses.unshift({
              id: uid('cu'),
              title,
              description: description || 'Custom curse.',
              cost: coins,
              durationMins: mins,
              castingCondition: deckSlot.querySelector('#qc-cond')?.value.trim() || 'Pay coin cost',
              active: true
            });
          }
        }, 'deck');
        this.refreshWheelPool();
        this.renderWheelLanded();
        this.toast(`Added "${title}" to your deck.`);
      });

      deckSlot.querySelector('#btn-export-deck')?.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(store.get().decks, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'jetlag-sydney-decks.json';
        a.click();
      });

      deckSlot.querySelector('#btn-import-deck')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'application/json';
        inp.onchange = async () => {
          try {
            const data = JSON.parse(await inp.files[0].text());
            if (!Array.isArray(data.challenges)) throw new Error('Missing challenges array');
            store.mutate((st) => {
              st.decks.challenges = data.challenges;
              if (Array.isArray(data.curses)) st.decks.curses = data.curses;
            }, 'deck');
            this.refreshWheelPool();
            this.renderWheelLanded();
            this.toast(`Imported ${data.challenges.length} challenges.`);
          } catch {
            this.toast('Invalid deck JSON file.');
          }
        };
        inp.click();
      });

      deckSlot.querySelector('#btn-clear-deck')?.addEventListener('click', () => {
        if (confirm(`Delete all ${isCh ? 'challenges' : 'curses'} in this list?`)) {
          store.mutate((st) => { st.decks[this.deckKind] = []; }, 'deck');
          this.refreshWheelPool();
          this.renderWheelLanded();
        }
      });

      deckSlot.querySelectorAll('[data-edit-card]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [kind, id] = btn.dataset.editCard.split(':');
          const card = store.get().decks[kind]?.find((x) => x.id === id);
          if (card) this.openAddCardModal(kind === 'challenges' ? 'challenge' : 'curse', card);
        });
      });

      deckSlot.querySelectorAll('[data-toggle-card]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const [kind, id] = cb.dataset.toggleCard.split(':');
          store.mutate((st) => {
            const card = st.decks[kind]?.find((x) => x.id === id);
            if (card) card.active = cb.checked;
          }, 'deck');
          this.refreshWheelPool();
        });
      });

      deckSlot.querySelectorAll('[data-del-card]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [kind, id] = btn.dataset.delCard.split(':');
          store.mutate((st) => {
            st.decks[kind] = st.decks[kind].filter((x) => x.id !== id);
          }, 'deck');
          this.refreshWheelPool();
          this.renderWheelLanded();
        });
      });
    }
  }

  completeChallengeCard(card, overrideTeamId = null) {
    const targetTeam = this.getActionTeam(overrideTeamId);
    const mult = targetTeam.doubleNext ? 2 : 1;
    const reward = (card.coins || 500) * mult;
    store.mutate((s) => {
      const t = s.teams.find((x) => x.id === targetTeam.id);
      if (t) {
        t.coins += reward;
        t.points += 1;
        t.doubleNext = false;
        t.activeChallenge = null;
      }
    }, 'challenge');
    store.addFeed({
      type: 'challenge',
      text: `${targetTeam.name} COMPLETED "${card.title}" (+${reward} coins, +1 pt${mult === 2 ? ' — 2X DOUBLED' : ''}).`
    });
    this.toast(`Completed for ${targetTeam.name}! +${reward} coins`);
  }

  vetoChallengeCard(card, overrideTeamId = null) {
    const targetTeam = this.getActionTeam(overrideTeamId);
    const mult = targetTeam.doubleNext ? 2 : 1;
    const mins = (card.vetoMins || 15) * mult;
    store.mutate((s) => {
      const t = s.teams.find((x) => x.id === targetTeam.id);
      if (t) {
        t.vetoEndsAt = Date.now() + mins * 60000;
        t.doubleNext = false;
        t.activeChallenge = null;
      }
    }, 'challenge');
    store.addFeed({
      type: 'challenge',
      text: `${targetTeam.name} VETOED "${card.title}" — ${mins}-minute veto cooldown started.`
    });
    this.toast(`Vetoed (${targetTeam.name}). ${mins}m cooldown active.`);
  }

  castCurse(curse, overrideTargetTeamId = null) {
    const s = store.get();
    const isHostGm = Boolean(store.getLocalPlayer()?.isEventHost);
    const myTeam = store.getLocalTeam();
    const opponent = overrideTargetTeamId
      ? (s.teams.find((t) => t.id === overrideTargetTeamId) || s.teams[0])
      : (s.teams.find((t) => t.id !== myTeam?.id) || s.teams[0]);
    if (!isHostGm && myTeam && s.game.rules.economy && myTeam.coins < curse.cost) {
      if (!confirm(`${myTeam.name} only has ${myTeam.coins} coins (Curse costs ${curse.cost}). Cast anyway?`)) return;
    }
    store.mutate((st) => {
      if (!isHostGm && myTeam && st.game.rules.economy) {
        const t = st.teams.find((x) => x.id === myTeam.id);
        if (t) t.coins = Math.max(0, t.coins - (curse.cost || 0));
      }
      st.activeCurses.push({
        id: uid('ac'),
        curseId: curse.id,
        title: curse.title,
        description: curse.description,
        fromTeamId: myTeam?.id || null,
        targetTeamId: opponent.id,
        castAt: Date.now(),
        expiresAt: Date.now() + (curse.durationMins || 15) * 60000
      });
    }, 'curse');
    store.addFeed({ type: 'curse', text: `CAST "${curse.title}" on ${opponent.name} (${curse.durationMins}m): ${curse.description}` });
    this.toast(`Curse cast on ${opponent.name}.`);
  }

  // ===== TAB 3: LIVE ACTIVITY FEED, CHAT & PHOTO PROOFS =====
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
        <div class="card-title">Post Update / Photo Proof</div>
        <div class="row" style="gap:6px">
          <input type="text" id="feed-msg-input" class="input" placeholder="Send message, clue, or proof note..." style="flex:1" />
          <label class="btn btn-secondary btn-sm" title="Attach compressed camera photo proof">
            ${icon('camera', 15)}
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
          <div class="card-title">Live Timeline</div>
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
        text: text || 'Attached photo proof.',
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
        this.toast('Photo compressed and ready to send.');
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

  // ===== TAB 4: MULTIPLAYER LIVE ROOMS, GPS & PREFERENCES =====
  renderLivePane() {
    const pane = document.getElementById('pane-live');
    if (!pane) return;
    const s = store.get();
    const me = store.getLocalPlayer();
    const nearest = me?.lat != null ? this.mapCtrl.findNearestStation(me.lat, me.lng) : null;
    const players = Object.values(s.players || {});

    const access = getAccess(s);
    const sr = s.scheduledRoom;
    const isLocked = Boolean(sr?.locked);
    const schedInviteUrl = (() => {
      if (!sr) return '';
      const u = new URL(window.location.href);
      u.search = '';
      u.searchParams.set('room', sr.roomCode);
      u.searchParams.set('sched', encodeScheduleParam(sr));
      return u.toString();
    })();
    const myRsvp = Boolean(sr?.rsvps?.some((r) => r.id === s.localPlayerId));

    pane.innerHTML = `
      <!-- SCHEDULE & LOCK IN GAME ROOM -->
      <div class="card sched-card ${isLocked ? 'locked' : ''}">
        <div class="card-header">
          <div class="card-title">${icon(isLocked ? 'lock' : 'calendar', 15)} ${isLocked ? 'Locked-In Game Room' : 'Schedule a Game Room'}</div>
          <span class="tag-pill" style="${isLocked ? 'border-color:var(--accent);color:var(--accent)' : ''}">${isLocked ? 'LOCKED IN' : 'PROTOTYPE'}</span>
        </div>
        ${
          isLocked
            ? `
              <div style="display:flex;flex-direction:column;gap:4px">
                <strong style="font-family:var(--font-display);font-size:16px">${esc(sr.title)}</strong>
                <div class="muted" style="font-size:12px">
                  ${esc(GAME_MODES[sr.mode]?.name || sr.mode)} · Meet at <strong>${esc(sr.meetingStation)}</strong>
                </div>
                <div class="muted" style="font-size:12px">
                  Start: <strong>${esc(new Date(sr.startTimeIso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</strong>
                </div>
              </div>
              <div class="sched-countdown" data-sched-iso="${esc(sr.startTimeIso)}">${formatScheduledCountdown(Date.parse(sr.startTimeIso) - Date.now())}</div>
              <div class="row-between" style="background:var(--bg);padding:8px 10px;border-radius:9px;border:1px solid var(--border)">
                <span class="muted" style="font-size:11.5px">Reserved Room Code</span>
                <strong class="mono" style="color:var(--accent);letter-spacing:1.5px">${esc(sr.roomCode)}</strong>
              </div>
              <div class="row">
                <button class="btn ${myRsvp ? 'btn-accent' : 'btn-secondary'} btn-sm" id="btn-sched-rsvp" style="flex:1">
                  ${icon('check', 13)} ${myRsvp ? 'Locked In (Ready)' : 'Mark Ready'} (${sr.rsvps?.length || 0})
                </button>
                <button class="btn btn-primary btn-sm" id="btn-sched-golive" style="flex:1">Launch Room Now</button>
              </div>
              ${
                sr.rsvps?.length
                  ? `<div class="muted" style="font-size:11.5px">Ready roster: ${sr.rsvps.map((r) => esc(r.name)).join(', ')}</div>`
                  : ''
              }
              <div class="row">
                <button class="btn btn-secondary btn-xs" id="btn-sched-copy" style="flex:1">${icon('copy', 12)} Copy Invite Link</button>
                <button class="btn btn-secondary btn-xs" id="btn-sched-ics" style="flex:1">${icon('calendar', 12)} Add to Calendar</button>
                ${access.canEditRules ? `<button class="btn btn-ghost btn-xs" id="btn-sched-unlock">${icon('unlock', 12)} Unlock</button>` : ''}
              </div>
            `
            : `
              <div class="muted" style="font-size:12px">Pick a kickoff time, mode, and Sydney meeting station, then lock it in to generate a countdown & shareable invite link.</div>
              <div class="field">
                <label>Session Title</label>
                <input type="text" id="sched-title" class="input" placeholder="e.g. Saturday Tag Across Sydney" value="${esc(sr?.title || 'Sydney Jet Lag Session')}" ${access.canEditRules ? '' : 'disabled'} />
              </div>
              <div class="grid-2">
                <div class="field">
                  <label>Game Mode</label>
                  <select id="sched-mode" class="select" ${access.canEditRules ? '' : 'disabled'}>
                    ${Object.values(GAME_MODES).map((m) => `<option value="${m.id}" ${(sr?.mode || s.game.mode) === m.id ? 'selected' : ''}>${esc(m.shortName)}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label>Room Code</label>
                  <input type="text" id="sched-code" class="input mono" style="text-transform:uppercase" value="${esc(sr?.roomCode || s.room.code || generateRoomCode())}" ${access.canEditRules ? '' : 'disabled'} />
                </div>
              </div>
              <div class="grid-2">
                <div class="field">
                  <label>Kickoff Date & Time</label>
                  <input type="datetime-local" id="sched-time" class="input" value="${esc(sr?.startTimeIso || defaultScheduleDateTime())}" ${access.canEditRules ? '' : 'disabled'} />
                </div>
                <div class="field">
                  <label>Meeting Station</label>
                  <input type="text" id="sched-station" class="input" placeholder="Central" value="${esc(sr?.meetingStation || 'Central')}" ${access.canEditRules ? '' : 'disabled'} />
                </div>
              </div>
              <label class="toggle-row" style="padding:4px 0">
                <div>
                  <div style="font-size:12.5px;font-weight:700">Host as Non-Playing GM</div>
                  <div class="muted" style="font-size:11px">Run and spectate the event while your friends play</div>
                </div>
                <input type="checkbox" id="sched-host-gm" ${(sr ? sr.hostIsSpectator : me.isEventHost) ? 'checked' : ''} ${access.canEditRules ? '' : 'disabled'} />
              </label>
              <div class="row">
                <button class="btn btn-primary btn-sm" id="btn-sched-lock" style="flex:1" ${access.canEditRules ? '' : 'disabled'}>${icon('lock', 13)} Lock In Schedule</button>
                ${sr && access.canEditRules ? `<button class="btn btn-ghost btn-sm" id="btn-sched-clear">Clear</button>` : ''}
              </div>
            `
        }
      </div>

      <div class="card ${me.isEventHost ? 'host-card' : ''}">
        <div class="card-header">
          <div class="card-title">Your Role & Live GPS</div>
          ${me.isEventHost ? '<span class="host-pill">GAME MASTER</span>' : access.isPermitted ? '<span class="tag-pill" style="border-color:#a855f7;color:#c084fc">PERMITTED CO-HOST</span>' : '<span class="tag-pill">PLAYER</span>'}
        </div>
        <div class="seg-bar" style="grid-template-columns:repeat(2,1fr)">
          <button class="seg-btn ${!me.isEventHost ? 'active' : ''}" id="btn-role-player" ${access.canStepDownGm || !me.isEventHost ? '' : 'disabled title="Reset game to Lobby to step down"'} ${access.gameActive && !me.isEventHost ? 'disabled' : ''}>Playing</button>
          <button class="seg-btn ${me.isEventHost ? 'active' : ''}" id="btn-role-host" ${access.canClaimGm ? '' : 'disabled title="Locked while game is active or GM already set"'}>${me.isEventHost ? 'Game Master (GM)' : access.gameActive ? 'Locked In-Game' : access.gmExists ? 'GM Active' : access.isGuest ? 'Host Only' : 'Host Event (GM)'}</button>
        </div>
        ${access.gameActive ? `<div class="muted" style="font-size:11px">Roles are locked while the game is running. Reset to Lobby to switch Playing / GM.</div>` : ''}
        <div class="grid-2">
          <div class="field">
            <label>Your Name ${!access.canRenameSelf ? '(Locked)' : ''}</label>
            <div class="row" style="gap:4px;flex-wrap:nowrap">
              <input type="text" id="inp-player-name" class="input" value="${esc(me.name)}" ${access.canRenameSelf ? '' : 'disabled'} />
              ${access.canRenameSelf && !me.isEventHost ? `<button class="btn btn-xs btn-secondary" id="btn-lock-my-name" title="Lock in your player name">${icon('lock', 12)}</button>` : ''}
            </div>
          </div>
          ${
            me.isEventHost
              ? `<div class="field">
                  <label>Participation</label>
                  <input type="text" class="input" value="Spectator / GM" disabled />
                </div>`
              : `<div class="field">
                  <label>Your Team ${!access.canEditTeams ? '(GM Assigned)' : ''}</label>
                  <select id="sel-player-team" class="select" ${access.canEditTeams ? '' : 'disabled'}>
                    ${s.teams.map((t) => `<option value="${t.id}" ${me.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                  </select>
                </div>`
          }
        </div>
        ${!access.canRenameSelf ? `<div class="muted" style="font-size:11px">Your name is locked to prevent mid-game changes. Ask the Game Master to unlock it if needed.</div>` : ''}
        ${
          me.isEventHost
            ? `<div class="muted" style="font-size:12px">You are hosting this event without playing. You can watch every team's live GPS (including private Hide+Seek zones), customize all game rules, grant Co-Host permissions, and broadcast announcements.</div>`
            : `
              <div class="row">
                <button class="btn ${s.room.shareGps ? 'btn-danger' : 'btn-primary'} btn-sm" id="btn-toggle-gps" style="flex:1">
                  ${icon('crosshair', 13)} ${s.room.shareGps ? 'Stop GPS' : 'Start Live GPS'}
                </button>
                <button class="btn btn-secondary btn-sm" id="btn-toggle-hide-gps">${me.gpsHidden ? 'Show Pin' : 'Hide Pin'}</button>
                <button class="btn btn-secondary btn-sm" id="btn-toggle-freeze-gps">${me.gpsFrozen ? 'Unfreeze' : 'Freeze'}</button>
              </div>
              ${
                nearest
                  ? `<div class="sp-badge" style="border-color:var(--accent-2);color:#2dd4bf">Nearest: <strong>${esc(nearest.station.name)}</strong> (${formatDistance(nearest.distanceM)}) · ${nearest.station.lines.join(', ')}</div>`
                  : `<div class="muted" style="font-size:11.5px">${access.mustVerifyGps ? `Strict GPS is ON — you must be within ${s.game.stationClaimRadiusM ?? 100}m of a station to claim it.` : 'Start Live GPS to track your distance to stations.'}</div>`
              }
              ${
                access.canUseDemoGps
                  ? `<div class="muted" style="font-size:11px">Demo GPS Pins (Indoor Testing):</div>
                     <div class="row" style="gap:4px">
                       ${[
                         ['Central', -33.88488, 151.20665],
                         ['Circular Quay', -33.86133, 151.21046],
                         ['Parramatta', -33.81744, 151.00493],
                         ['Manly', -33.80045, 151.28371],
                         ['Chatswood', -33.79749, 151.18111]
                       ]
                         .map(([lbl, lat, lng]) => `<button class="btn btn-xs btn-ghost" data-demo-gps="${lat},${lng},${lbl}">${lbl}</button>`)
                         .join('')}
                     </div>`
                  : ''
              }
            `
        }
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Instant Live Room</div>
          <span class="tag-pill" style="${s.room.connected ? 'border-color:#22c55e;color:#4ade80' : ''}">${esc(s.room.statusText)}</span>
        </div>
        ${
          s.room.connected
            ? `
              <div class="room-code-big">${esc(s.room.code)}</div>
              <div class="qr-box" id="room-qr-box"></div>
              <div class="row">
                <button class="btn btn-primary btn-sm" id="btn-copy-invite" style="flex:1">${icon('copy', 13)} Copy Invite Link</button>
                <button class="btn btn-secondary btn-sm" id="btn-force-sync" title="Push latest room state now">${icon('refresh', 13)} Sync</button>
                <button class="btn btn-danger btn-sm" id="btn-leave-room">Leave</button>
              </div>
            `
            : `
              <div class="muted" style="font-size:12px">Start or join a live room across any phones or laptops — type either <strong>4K9P</strong> or <strong>SYD-4K9P</strong>.</div>
              <button class="btn btn-primary btn-block" id="btn-host-peer">Create Live Room</button>
              <div class="row">
                <input type="text" id="inp-join-code" class="input mono" placeholder="Code e.g. SYD-4K9P or 4K9P" style="flex:1;text-transform:uppercase" value="${esc(s.room.code)}" />
                <button class="btn btn-accent" id="btn-join-peer">Join</button>
              </div>
            `
        }
      </div>

      <div class="card">
        <div class="card-title">Tunnel-Proof Firebase Sync (Optional)</div>
        <div class="muted" style="font-size:11.5px">
          Recommended for outdoor game days through Metro tunnels and locked phone screens.
        </div>
        <div class="field">
          <label>Firebase Realtime Database URL</label>
          <input type="url" id="inp-fb-url" class="input" placeholder="https://your-app-default-rtdb.asia-southeast1.firebasedatabase.app" value="${esc(s.room.firebaseUrl)}" />
        </div>
        <div class="row">
          <input type="text" id="inp-fb-code" class="input mono" placeholder="Room code" value="${esc(s.room.code || generateRoomCode())}" style="flex:1;text-transform:uppercase" />
          <button class="btn btn-accent btn-sm" id="btn-connect-fb">Connect</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Participants & Access (${players.length})</div>
        ${players
          .map((p) => {
            const t = s.teams.find((x) => x.id === p.teamId);
            const lvl = p.isEventHost ? 'gm' : (p.accessLevel || 'player');
            return `
              <div style="padding:7px 0;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:5px">
                <div class="row-between">
                  <div class="row" style="gap:6px">
                    <span style="width:10px;height:10px;border-radius:50%;background:${p.isEventHost ? '#a855f7' : (t?.color || '#94a3b8')}"></span>
                    <strong style="font-size:13px">${esc(p.name)} ${p.id === s.localPlayerId ? '(You)' : ''}</strong>
                    ${p.isEventHost ? '<span class="host-pill">GM</span>' : lvl === 'co_host' ? '<span class="tag-pill" style="border-color:#a855f7;color:#c084fc">PERMITTED</span>' : ''}
                    ${p.nameLocked ? `<span class="muted" title="Name Locked">${icon('lock', 11)}</span>` : ''}
                  </div>
                  <span class="muted" style="font-size:11px">
                    ${p.isEventHost ? 'Hosting' : `${esc(t?.name || '')} · ${p.gpsFrozen ? 'Frozen' : p.gpsHidden ? 'Hidden' : p.lat != null ? 'GPS Live' : 'No GPS'}`}
                  </span>
                </div>
                ${
                  access.isGm && p.id !== s.localPlayerId
                    ? `<div class="row" style="gap:5px">
                        <select class="select" data-gm-assign-player="${p.id}" style="flex:1;padding:4px 7px;font-size:11px">
                          <option value="__host__" ${p.isEventHost ? 'selected' : ''}>Event Host (GM)</option>
                          ${s.teams.map((tm) => `<option value="${tm.id}" ${!p.isEventHost && p.teamId === tm.id ? 'selected' : ''}>${esc(tm.name)}</option>`).join('')}
                        </select>
                        <select class="select" data-gm-access="${p.id}" style="width:118px;padding:4px 7px;font-size:11px">
                          <option value="player" ${lvl === 'player' ? 'selected' : ''}>Player</option>
                          <option value="co_host" ${lvl === 'co_host' ? 'selected' : ''}>Permitted</option>
                          <option value="gm" ${lvl === 'gm' ? 'selected' : ''}>Game Master</option>
                        </select>
                        <button class="btn btn-xs btn-ghost" data-gm-unlock-name="${p.id}" title="${p.nameLocked ? 'Unlock or rename player' : 'Lock player name'}">${icon(p.nameLocked ? 'unlock' : 'lock', 12)}</button>
                      </div>`
                    : ''
                }
              </div>`;
          })
          .join('')}
      </div>

      <div class="card">
        <div class="card-title">Preferences & Backup</div>
        <label class="toggle-row">
          <span style="font-size:13px;font-weight:600">Wheel Sound Effects</span>
          <input type="checkbox" id="cb-sound-pref" ${s.soundEnabled ? 'checked' : ''} />
        </label>
        <div class="row">
          <button class="btn btn-secondary btn-sm" id="btn-export-game" style="flex:1">Export Game JSON</button>
          ${access.canEditRules ? `<button class="btn btn-secondary btn-sm" id="btn-import-game" style="flex:1">Import Game JSON</button>` : ''}
        </div>
      </div>
    `;

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

    // Scheduled & Locked Room events
    pane.querySelector('#btn-sched-lock')?.addEventListener('click', () => {
      const title = pane.querySelector('#sched-title').value.trim() || 'Sydney Jet Lag Session';
      const mode = pane.querySelector('#sched-mode').value;
      const roomCode = normalizeRoomCode(pane.querySelector('#sched-code').value) || generateRoomCode();
      const startTimeIso = pane.querySelector('#sched-time').value;
      const meetingStation = pane.querySelector('#sched-station').value.trim() || 'Central';
      const hostIsSpectator = Boolean(pane.querySelector('#sched-host-gm')?.checked);
      if (!startTimeIso) return this.toast('Choose a kickoff date and time.');
      const meNow = store.getLocalPlayer();
      if (hostIsSpectator && !meNow.isEventHost) this.setEventHostMode(true);
      store.mutate((st) => {
        st.scheduledRoom = {
          id: st.scheduledRoom?.id || uid('sched'),
          title,
          mode,
          roomCode,
          startTimeIso,
          meetingStation,
          hostIsSpectator,
          hostName: meNow.name,
          locked: true,
          lockedAt: Date.now(),
          rsvps: hostIsSpectator ? [] : [{ id: meNow.id, name: meNow.name, readyAt: Date.now() }]
        };
        st.game.mode = mode;
        st.game.rules = getDefaultRulesForMode(mode);
        st.room.code = roomCode;
      }, 'schedule');
      store.addFeed({ type: 'system', text: `locked in scheduled event "${title}" (${roomCode})${hostIsSpectator ? ' as Non-Playing Host' : ''} starting at ${new Date(startTimeIso).toLocaleString()}.` });
      this.toast(`Game room ${roomCode} locked in.`);
    });

    pane.querySelector('#btn-sched-clear')?.addEventListener('click', () => {
      store.mutate((st) => { st.scheduledRoom = null; }, 'schedule');
      this.toast('Cleared scheduled room.');
    });

    pane.querySelector('#btn-sched-unlock')?.addEventListener('click', () => {
      if (!confirm('Unlock this scheduled game room so you can edit the time, mode, or meeting station?')) return;
      store.mutate((st) => {
        if (st.scheduledRoom) st.scheduledRoom.locked = false;
      }, 'schedule');
      this.toast('Schedule unlocked for editing.');
    });

    pane.querySelector('#btn-sched-rsvp')?.addEventListener('click', () => {
      const meNow = store.getLocalPlayer();
      store.mutate((st) => {
        if (!st.scheduledRoom) return;
        const list = st.scheduledRoom.rsvps || [];
        const exists = list.some((r) => r.id === meNow.id);
        st.scheduledRoom.rsvps = exists
          ? list.filter((r) => r.id !== meNow.id)
          : [...list, { id: meNow.id, name: meNow.name, readyAt: Date.now() }];
      }, 'schedule');
    });

    pane.querySelector('#btn-sched-golive')?.addEventListener('click', () => {
      const sched = store.get().scheduledRoom;
      if (!sched) return;
      this.mp.hostPeerRoom(sched.roomCode);
    });

    pane.querySelector('#btn-sched-copy')?.addEventListener('click', async () => {
      if (!schedInviteUrl) return;
      try {
        await navigator.clipboard.writeText(schedInviteUrl);
        this.toast('Scheduled room invite link copied.');
      } catch {
        prompt('Copy scheduled invite link:', schedInviteUrl);
      }
    });

    pane.querySelector('#btn-sched-ics')?.addEventListener('click', () => {
      if (sr) {
        downloadScheduleIcs(sr, schedInviteUrl);
        this.toast('Downloaded calendar invite (.ics).');
      }
    });

    pane.querySelector('#btn-role-player')?.addEventListener('click', () => this.setEventHostMode(false));
    pane.querySelector('#btn-role-host')?.addEventListener('click', () => this.setEventHostMode(true));

    pane.querySelectorAll('[data-gm-assign-player]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const pid = sel.dataset.gmAssignPlayer;
        const val = sel.value;
        store.mutate((st) => {
          const pl = st.players[pid];
          if (!pl) return;
          if (val === '__host__') {
            pl.isEventHost = true;
            pl.accessLevel = 'gm';
            pl.teamId = null;
            pl.reassignedAt = Date.now();
          } else {
            const tm = st.teams.find((x) => x.id === val);
            pl.isEventHost = false;
            if (pl.accessLevel === 'gm') pl.accessLevel = 'player';
            pl.teamId = val;
            if (tm) pl.color = tm.color;
            pl.reassignedAt = Date.now();
          }
        }, 'teams');
      });
    });

    pane.querySelectorAll('[data-gm-access]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const pid = sel.dataset.gmAccess;
        const lvl = sel.value;
        store.mutate((st) => {
          const pl = st.players[pid];
          if (!pl) return;
          pl.accessLevel = lvl;
          pl.isEventHost = lvl === 'gm';
          if (lvl === 'gm') pl.teamId = null;
          else if (!pl.teamId) pl.teamId = st.teams[0]?.id || 'team-a';
          pl.reassignedAt = Date.now();
        }, 'teams');
        this.toast(`Updated access level to ${lvl.toUpperCase()}.`);
      });
    });

    pane.querySelectorAll('[data-gm-unlock-name]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.gmUnlockName;
        const pl = store.get().players[pid];
        if (!pl) return;
        store.mutate((st) => {
          const target = st.players[pid];
          if (!target) return;
          target.nameLocked = !target.nameLocked;
          target.reassignedAt = Date.now();
        }, 'teams');
        this.toast(pl.nameLocked ? `Unlocked ${pl.name}'s name.` : `Locked ${pl.name}'s name.`);
      });
    });

    pane.querySelector('#btn-lock-my-name')?.addEventListener('click', () => {
      const inp = pane.querySelector('#inp-player-name');
      const v = inp?.value.trim();
      if (!v) return this.toast('Enter your name first.');
      store.mutate((st) => {
        const p = st.players[st.localPlayerId];
        p.name = v;
        p.nameLocked = true;
      }, 'profile');
      this.toast(`Name locked as "${v}".`);
    });

    pane.querySelector('#inp-player-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pane.querySelector('#btn-lock-my-name')?.click();
    });

    pane.querySelector('#inp-player-name').addEventListener('change', (e) => {
      if (!getAccess(store.get()).canRenameSelf) return;
      const v = e.target.value.trim() || 'Player';
      store.mutate((st) => {
        const p = st.players[st.localPlayerId];
        p.name = v;
        if (st.permissions?.lockNamesAfterJoin && !p.isEventHost) {
          p.nameLocked = true;
        }
      }, 'profile');
    });

    pane.querySelector('#sel-player-team')?.addEventListener('change', (e) => {
      const tid = e.target.value;
      store.mutate((st) => {
        const t = st.teams.find((x) => x.id === tid);
        st.players[st.localPlayerId].teamId = tid;
        if (t) st.players[st.localPlayerId].color = t.color;
      }, 'profile');
    });

    pane.querySelector('#btn-toggle-gps')?.addEventListener('click', () => {
      if (store.get().room.shareGps) this.mp.stopGps();
      else this.mp.startGps();
      this.renderLivePane();
    });

    pane.querySelector('#btn-toggle-hide-gps')?.addEventListener('click', () => {
      store.mutate((st) => {
        const p = st.players[st.localPlayerId];
        p.gpsHidden = !p.gpsHidden;
      }, 'gps');
    });

    pane.querySelector('#btn-toggle-freeze-gps')?.addEventListener('click', () => {
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
      const code = normalizeRoomCode(pane.querySelector('#inp-join-code').value);
      if (!code) return this.toast('Enter a room code first (e.g. SYD-4K9P or 4K9P).');
      // Lock player name upon joining a room so players can't spoof names mid-game
      store.mutate((st) => {
        const p = st.players[st.localPlayerId];
        if (p && !p.isEventHost && st.permissions?.lockNamesAfterJoin) p.nameLocked = true;
      }, 'profile', false);
      this.mp.joinPeerRoom(code);
    });
    pane.querySelector('#inp-join-code')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pane.querySelector('#btn-join-peer')?.click();
    });
    pane.querySelector('#btn-force-sync')?.addEventListener('click', () => this.mp.forceSyncNow());
    pane.querySelector('#btn-leave-room')?.addEventListener('click', () => this.mp.disconnect());
    pane.querySelector('#btn-copy-invite')?.addEventListener('click', async () => {
      const url = this.mp.getInviteUrl();
      try {
        await navigator.clipboard.writeText(url);
        this.toast('Invite link copied to clipboard.');
      } catch {
        prompt('Copy invite link:', url);
      }
    });

    pane.querySelector('#btn-connect-fb')?.addEventListener('click', () => {
      const url = pane.querySelector('#inp-fb-url').value.trim();
      const code = pane.querySelector('#inp-fb-code').value.trim();
      this.mp.connectFirebaseRoom(url, code);
    });

    pane.querySelector('#cb-sound-pref')?.addEventListener('change', (e) => {
      store.mutate((st) => { st.soundEnabled = e.target.checked; }, 'sound', false);
    });

    pane.querySelector('#btn-export-game').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(store.getSharedSnapshot(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `jetlag-sydney-game-${Date.now()}.json`;
      a.click();
    });

    pane.querySelector('#btn-import-game')?.addEventListener('click', () => {
      if (!getAccess(store.get()).canEditRules) return this.toast('Only the Game Master can import a game snapshot.');
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json';
      inp.onchange = async () => {
        try {
          const snap = JSON.parse(await inp.files[0].text());
          store.applySharedSnapshot(snap);
          this.toast('Imported game snapshot.');
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
      <div class="card-title">Place Radar Overlay ${label ? `(${esc(label)})` : ''}</div>
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
      <div class="card-title">Thermometer Result</div>
      <p class="muted">Moving from Point A to Point B, did the Hider answer HOTTER (closer to B) or COLDER (closer to A)?</p>
      <div class="grid-2">
        <button class="btn btn-primary" id="m-th-hot">HOTTER (Shade A Side)</button>
        <button class="btn btn-accent" id="m-th-cold">COLDER (Shade B Side)</button>
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
      <div class="card-title">Drop Tactical Map Pin</div>
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

  openAddCardModal(kind, existing = null) {
    const isChallenge = kind === 'challenge';
    const isEdit = Boolean(existing);
    this.openModal(`
      <div class="card-title">${isEdit ? 'Edit' : 'Create'} ${isChallenge ? 'Challenge' : 'Curse'}</div>
      <div class="field">
        <label>Title</label>
        <input type="text" id="mc-title" class="input" placeholder="e.g. Ferry Race to Balmain" value="${esc(existing?.title || '')}" />
      </div>
      <div class="field">
        <label>Rules / Description</label>
        <textarea id="mc-desc" class="textarea" placeholder="Full rules and proof requirements...">${esc(existing?.description || '')}</textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>${isChallenge ? 'Reward (Coins)' : 'Cost (Coins)'}</label>
          <input type="number" id="mc-coins" class="input" value="${existing ? (isChallenge ? existing.coins : existing.cost) : 500}" min="0" step="50" />
        </div>
        <div class="field">
          <label>${isChallenge ? 'Veto Penalty (Mins)' : 'Duration (Mins)'}</label>
          <input type="number" id="mc-mins" class="input" value="${existing ? (isChallenge ? existing.vetoMins : existing.durationMins) : 15}" min="1" />
        </div>
      </div>
      ${
        isChallenge
          ? `<div class="grid-2">
              <div class="field">
                <label>Category</label>
                <select id="mc-cat" class="select">${CHALLENGE_CATEGORIES.map((c) => `<option value="${c.id}" ${(existing?.category || 'transit') === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
              </div>
              <div class="field">
                <label>Difficulty</label>
                <select id="mc-diff" class="select">${['Easy', 'Medium', 'Hard'].map((d) => `<option ${(existing?.difficulty || 'Medium') === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
              </div>
            </div>`
          : `<div class="field">
              <label>Casting Condition</label>
              <input type="text" id="mc-cond" class="input" value="${esc(existing?.castingCondition || 'Pay coin cost')}" />
            </div>`
      }
      <div class="row">
        <button class="btn btn-primary" id="mc-save" style="flex:1">${isEdit ? 'Save Changes' : 'Add to Deck'}</button>
        <button class="btn btn-ghost" id="mc-cancel">Cancel</button>
      </div>
    `);
    document.getElementById('mc-save').onclick = () => {
      const title = document.getElementById('mc-title').value.trim();
      const description = document.getElementById('mc-desc').value.trim();
      if (!title) return this.toast('Enter a title.');
      const coins = Math.max(0, Number(document.getElementById('mc-coins').value) || 0);
      const mins = Math.max(1, Number(document.getElementById('mc-mins').value) || 15);
      store.mutate((s) => {
        if (isChallenge) {
          const payload = {
            id: existing?.id || uid('ch'),
            title,
            description: description || 'Complete this challenge and submit proof.',
            coins,
            vetoMins: mins,
            category: document.getElementById('mc-cat').value,
            difficulty: document.getElementById('mc-diff').value,
            active: existing ? existing.active : true
          };
          if (isEdit) {
            const idx = s.decks.challenges.findIndex((x) => x.id === existing.id);
            if (idx >= 0) s.decks.challenges[idx] = payload;
          } else {
            s.decks.challenges.unshift(payload);
          }
        } else {
          const payload = {
            id: existing?.id || uid('cu'),
            title,
            description: description || 'Custom curse.',
            cost: coins,
            durationMins: mins,
            castingCondition: document.getElementById('mc-cond')?.value.trim() || 'Custom Curse',
            active: existing ? existing.active : true
          };
          if (isEdit) {
            const idx = s.decks.curses.findIndex((x) => x.id === existing.id);
            if (idx >= 0) s.decks.curses[idx] = payload;
          } else {
            s.decks.curses.unshift(payload);
          }
        }
      }, 'deck');
      this.refreshWheelPool();
      this.renderWheelLanded();
      this.closeModal();
      this.toast(isEdit ? `Saved "${title}".` : `Added "${title}" to your deck.`);
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
