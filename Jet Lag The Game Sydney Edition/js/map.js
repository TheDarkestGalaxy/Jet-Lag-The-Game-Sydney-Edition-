// Interactive Real-World Sydney Transit Map & Jet Lag Strategy Toolkit (Leaflet)
import { SYDNEY_NETWORK } from '../data/sydney-network.js';
import { store, uid } from './state.js?v=12';
import { haversineM, formatDistance, canSeePlayerGps, getDividingSide, getAccess } from './modes.js?v=12';

const BASEMAPS = {
  dark: {
    label: 'Dark Transit',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    darkFilter: true
  },
  minimal_dark: {
    label: 'Minimal Dark',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    darkFilter: false
  },
  osm: {
    label: 'Street (OSM)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    darkFilter: false
  },
  light: {
    label: 'Outdoor Light',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    darkFilter: false
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    darkFilter: false
  }
};

const WORLD_OUTER_RING = [
  [-85, -180],
  [-85, 180],
  [85, 180],
  [85, -180]
];

/** Generate circle lat/lng vertices around a center for inverted masks & exact km geometry */
function circleRing(lat, lng, radiusM, steps = 72) {
  const pts = [];
  const R = 6371000;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angDist = radiusM / R;
  for (let i = 0; i < steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(angDist) + Math.cos(latRad) * Math.sin(angDist) * Math.cos(brng)
    );
    const pLng =
      lngRad +
      Math.atan2(
        Math.sin(brng) * Math.sin(angDist) * Math.cos(latRad),
        Math.cos(angDist) - Math.sin(latRad) * Math.sin(pLat)
      );
    pts.push([(pLat * 180) / Math.PI, (pLng * 180) / Math.PI]);
  }
  return pts;
}

/** Generate perpendicular bisector line & colder half-plane polygon for Thermometer tool */
function thermometerHalfPlane(pA, pB, hotterIsB = true) {
  // Use equirectangular projection scaled by cos(midLat) so perpendicular is geometrically accurate in Sydney
  const midLat = (pA[0] + pB[0]) / 2;
  const midLng = (pA[1] + pB[1]) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  const dx = (pB[1] - pA[1]) * cosLat;
  const dy = pB[0] - pA[0];
  const len = Math.hypot(dx, dy) || 1e-6;
  // Unit vector from A -> B
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular vector along the bisector
  const px = -uy;
  const py = ux;

  // Direction to shade (the COLDER side: if B is hotter, shade A's side = -u; if B is colder, shade B's side = +u)
  const sx = hotterIsB ? -ux : ux;
  const sy = hotterIsB ? -uy : uy;

  const span = 6.0; // ~650km span covers all of NSW cleanly
  const b1 = [midLat + py * span, midLng + (px * span) / cosLat];
  const b2 = [midLat - py * span, midLng - (px * span) / cosLat];
  const far1 = [b1[0] + sy * span, b1[1] + (sx * span) / cosLat];
  const far2 = [b2[0] + sy * span, b2[1] + (sx * span) / cosLat];

  return {
    bisectorLine: [b1, b2],
    shadedPolygon: [b1, b2, far2, far1]
  };
}

/** Compute pie-slice sector polygon from center */
function sectorPolygon(center, startDeg, endDeg, radiusKm = 65) {
  const [cLat, cLng] = center;
  const pts = [[cLat, cLng]];
  const R = 6371;
  const latRad = (cLat * Math.PI) / 180;
  const lngRad = (cLng * Math.PI) / 180;
  const angDist = radiusKm / R;
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const deg = startDeg + ((endDeg - startDeg) * i) / steps;
    const brng = (deg * Math.PI) / 180;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(angDist) + Math.cos(latRad) * Math.sin(angDist) * Math.cos(brng)
    );
    const pLng =
      lngRad +
      Math.atan2(
        Math.sin(brng) * Math.sin(angDist) * Math.cos(latRad),
        Math.cos(angDist) - Math.sin(latRad) * Math.sin(pLat)
      );
    pts.push([(pLat * 180) / Math.PI, (pLng * 180) / Math.PI]);
  }
  pts.push([cLat, cLng]);
  return pts;
}

export class SydneyMapController {
  constructor(containerId, callbacks = {}) {
    this.containerId = containerId;
    this.callbacks = callbacks;
    this.map = null;
    this.tileLayer = null;
    this.currentBasemap = 'dark';
    this.activeTool = 'select'; // select | radar | thermometer | ruler | polygon | pin
    this.toolScope = 'all'; // 'all' | 'team'
    this.draftPoints = [];
    this.draftLayer = null;

    // Transit filter state
    this.enabledModes = new Set(['train', 'metro', 'light_rail', 'ferry', 'intercity']);
    this.isolatedLine = null; // null or line code like 'T1', 'M1'
    this.showStationLabels = false;

    // Layer groups
    this.linesLayer = null;
    this.stationsLayer = null;
    this.modeOverlayLayer = null;
    this.annotationsLayer = null;
    this.playersLayer = null;
    this.stationById = new Map();
    this.lineByCode = new Map();
    this.stationMarkers = new Map();

    SYDNEY_NETWORK.stations.forEach((st) => this.stationById.set(st.id, st));
    SYDNEY_NETWORK.lines.forEach((ln) => this.lineByCode.set(ln.code, ln));
  }

  init() {
    if (!window.L) {
      console.error('Leaflet failed to load');
      return;
    }

    this.map = L.map(this.containerId, {
      center: [-33.8688, 151.1950],
      zoom: 12,
      minZoom: 7,
      maxZoom: 18,
      zoomControl: false,
      preferCanvas: true
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(this.map);

    this.setBasemap(store.get().theme === 'light' ? 'light' : 'dark');

    this.modeOverlayLayer = L.layerGroup().addTo(this.map);
    this.annotationsLayer = L.layerGroup().addTo(this.map);
    this.linesLayer = L.layerGroup().addTo(this.map);
    this.stationsLayer = L.layerGroup().addTo(this.map);
    this.draftLayer = L.layerGroup().addTo(this.map);
    this.playersLayer = L.layerGroup().addTo(this.map);

    this.renderTransitNetwork();
    this.renderAllDynamicLayers(store.get());

    this.map.on('zoomend', () => this.renderStations());
    this.map.on('click', (e) => this.handleMapClick(e));
    this.map.on('dblclick', (e) => {
      if (this.activeTool === 'polygon' && this.draftPoints.length >= 3) {
        L.DomEvent.stop(e);
        this.finishDraftTool();
      }
    });

    store.subscribe((state, reason) => {
      if (reason === 'theme') {
        if (state.theme === 'light' && this.currentBasemap === 'dark') this.setBasemap('light');
        if (state.theme === 'dark' && this.currentBasemap === 'light') this.setBasemap('dark');
      }
      this.renderAllDynamicLayers(state);
    });
  }

  setBasemap(key) {
    const cfg = BASEMAPS[key] || BASEMAPS.dark;
    this.currentBasemap = key;
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    this.tileLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19
    }).addTo(this.map);
    this.tileLayer.bringToBack();
    const container = this.map.getContainer();
    container.classList.toggle('map-dark-filter', Boolean(cfg.darkFilter));
  }

  setModeFilter(mode, enabled) {
    if (enabled) this.enabledModes.add(mode);
    else this.enabledModes.delete(mode);
    this.renderTransitNetwork();
  }

  toggleIsolateLine(code) {
    this.isolatedLine = this.isolatedLine === code ? null : code;
    this.renderTransitNetwork();
    if (this.isolatedLine) {
      const ln = this.lineByCode.get(this.isolatedLine);
      if (ln?.segments?.length) {
        const allPts = ln.segments.flat();
        if (allPts.length) this.map.fitBounds(L.latLngBounds(allPts), { padding: [50, 50], maxZoom: 13 });
      }
    }
    return this.isolatedLine;
  }

  setShowLabels(show) {
    this.showStationLabels = show;
    this.renderStations();
  }

  fitSydney() {
    this.map.flyTo([-33.8688, 151.1850], 12, { duration: 0.7 });
  }

  fitGreaterSydney() {
    this.map.fitBounds([[-34.11, 150.65], [-33.61, 151.34]], { padding: [30, 30] });
  }

  fitFullNetwork() {
    this.map.fitBounds([[-34.85, 149.55], [-32.05, 151.95]], { padding: [30, 30] });
  }

  flyToStation(stationId) {
    const st = this.stationById.get(stationId);
    if (!st) return;
    this.map.flyTo([st.lat, st.lng], Math.max(this.map.getZoom(), 14), { duration: 0.65 });
    setTimeout(() => {
      const m = this.stationMarkers.get(stationId);
      if (m) this.openStationPopup(m, st);
      else this.openStationPopupAt(st);
    }, 700);
  }

  flyToCoord(lat, lng, zoom = 15) {
    this.map.flyTo([lat, lng], zoom, { duration: 0.6 });
  }

  findNearestStation(lat, lng) {
    let best = null;
    let bestDist = Infinity;
    for (const st of SYDNEY_NETWORK.stations) {
      const d = haversineM(lat, lng, st.lat, st.lng);
      if (d < bestDist) {
        bestDist = d;
        best = st;
      }
    }
    return best ? { station: best, distanceM: bestDist } : null;
  }

  renderTransitNetwork() {
    this.linesLayer.clearLayers();

    // Draw order: intercity bottom -> trains -> ferry -> metro -> light rail top
    const modeOrder = { intercity: 0, train: 1, ferry: 2, metro: 3, light_rail: 4 };
    const sortedLines = [...SYDNEY_NETWORK.lines].sort((a, b) => (modeOrder[a.mode] ?? 1) - (modeOrder[b.mode] ?? 1));

    for (const line of sortedLines) {
      const modeOn = this.enabledModes.has(line.mode);
      const isIsolated = this.isolatedLine && this.isolatedLine !== line.code;
      if (!modeOn && this.isolatedLine !== line.code) continue;

      const opacity = isIsolated ? 0.14 : line.mode === 'intercity' ? 0.72 : 0.92;
      const weight =
        this.isolatedLine === line.code
          ? 5.5
          : line.mode === 'metro'
            ? 4.6
            : line.mode === 'train'
              ? 3.6
              : line.mode === 'intercity'
                ? 3.0
                : line.mode === 'light_rail'
                  ? 3.2
                  : 2.8;
      const dashArray =
        line.mode === 'ferry' ? '7 6' : line.mode === 'intercity' ? '10 4' : null;

      for (const seg of line.segments) {
        // Subtle dark casing behind active lines for crisp map contrast
        if (!isIsolated) {
          L.polyline(seg, {
            color: '#070b14',
            weight: weight + 2.4,
            opacity: 0.45,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(this.linesLayer);
        }

        const poly = L.polyline(seg, {
          color: line.color,
          weight,
          opacity,
          dashArray,
          lineCap: 'round',
          lineJoin: 'round'
        });

        poly.bindTooltip(
          `<span class="line-pill" style="background:${line.color};color:${line.textColor}">${line.code}</span> ${line.name}`,
          { sticky: true, className: 'jl-tooltip' }
        );
        poly.on('click', (ev) => {
          if (this.activeTool !== 'select') return;
          L.DomEvent.stopPropagation(ev);
          this.callbacks.onLineClick?.(line);
        });
        poly.addTo(this.linesLayer);
      }
    }

    this.renderStations();
  }

  renderStations() {
    this.stationsLayer.clearLayers();
    this.stationMarkers.clear();

    const state = store.get();
    const zoom = this.map.getZoom();
    const teamById = Object.fromEntries(state.teams.map((t) => [t.id, t]));

    for (const st of SYDNEY_NETWORK.stations) {
      const visibleMode = st.modes.some((m) => this.enabledModes.has(m));
      const visibleLine = !this.isolatedLine || st.lines.includes(this.isolatedLine);
      if (!visibleMode && !this.isolatedLine) continue;
      if (!visibleLine) continue;

      const claim = state.claimedStations?.[st.id];
      const isCheckpoint = state.checkpoints?.some((c) => c.stationId === st.id);
      const hasFlag = state.flags?.some((f) => f.stationId === st.id && f.status === 'base');

      // Smart zoom decluttering while always showing claimed, checkpoints, flags, and interchanges
      const forceShow = Boolean(claim || isCheckpoint || hasFlag || this.isolatedLine);
      if (!forceShow && zoom < 10 && !st.isInterchange) continue;
      if (!forceShow && zoom < 11 && st.modes.length === 1 && st.modes[0] === 'light_rail') continue;

      const primaryLine = this.lineByCode.get(this.isolatedLine || st.lines[0]);
      const baseColor = primaryLine?.color || '#ffffff';
      const claimTeam = claim ? teamById[claim.teamId] : null;

      const radius = claimTeam
        ? zoom >= 13 ? 8 : 6.5
        : st.isInterchange
          ? zoom >= 13 ? 6.5 : 5
          : zoom >= 14 ? 5 : 3.6;

      const marker = L.circleMarker([st.lat, st.lng], {
        radius,
        fillColor: claimTeam ? claimTeam.color : st.isInterchange ? '#ffffff' : baseColor,
        color: claimTeam ? '#ffffff' : st.isInterchange ? '#0b1020' : '#0b1020',
        weight: claimTeam ? 2.5 : st.isInterchange ? 2.2 : 1.4,
        fillOpacity: 1
      });

      const pills = st.lines
        .slice(0, 6)
        .map((c) => {
          const ln = this.lineByCode.get(c);
          return `<span class="line-pill sm" style="background:${ln?.color || '#64748b'};color:${ln?.textColor || '#fff'}">${c}</span>`;
        })
        .join('');

      marker.bindTooltip(
        `<div class="tt-station"><strong>${st.name}</strong><div class="tt-pills">${pills}</div>${claimTeam ? `<div class="tt-claim" style="color:${claimTeam.color}">Claimed by ${claimTeam.name}</div>` : ''}</div>`,
        {
          direction: 'top',
          offset: [0, -6],
          className: 'jl-tooltip',
          permanent: this.showStationLabels && (zoom >= 14 || (zoom >= 12 && st.isInterchange))
        }
      );

      marker.on('click', (ev) => {
        if (this.activeTool !== 'select') return;
        L.DomEvent.stopPropagation(ev);
        this.openStationPopup(marker, st);
      });

      marker.addTo(this.stationsLayer);
      this.stationMarkers.set(st.id, marker);
    }
  }

  openStationPopupAt(st) {
    const popup = L.popup({ className: 'jl-popup', maxWidth: 310 })
      .setLatLng([st.lat, st.lng])
      .setContent(this.buildStationPopupEl(st))
      .openOn(this.map);
    return popup;
  }

  openStationPopup(marker, st) {
    marker.bindPopup(this.buildStationPopupEl(st), { className: 'jl-popup', maxWidth: 310 }).openPopup();
  }

  buildStationPopupEl(st) {
    const state = store.get();
    const myPlayer = store.getLocalPlayer();
    const myTeam = store.getLocalTeam();
    const claim = state.claimedStations?.[st.id];
    const claimTeam = claim ? state.teams.find((t) => t.id === claim.teamId) : null;
    const dist =
      myPlayer?.lat != null ? haversineM(myPlayer.lat, myPlayer.lng, st.lat, st.lng) : null;

    const pills = st.lines
      .map((c) => {
        const ln = this.lineByCode.get(c);
        return `<span class="line-pill" style="background:${ln?.color || '#64748b'};color:${ln?.textColor || '#fff'}">${c}</span>`;
      })
      .join('');

    const div = document.createElement('div');
    div.className = 'station-popup';
    div.innerHTML = `
      <div class="sp-head">
        <h4>${st.name}</h4>
        <span class="sp-region">${st.region}</span>
      </div>
      <div class="sp-lines">${pills}</div>
      <div class="sp-meta">
        <span>${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}</span>
        ${dist != null ? `<span>• ${formatDistance(dist)} away</span>` : ''}
      </div>
      ${claimTeam ? `<div class="sp-badge" style="border-color:${claimTeam.color};color:${claimTeam.color}">Claimed by ${claimTeam.name}</div>` : ''}
      <div class="sp-actions"></div>
    `;

    const actions = div.querySelector('.sp-actions');
    const addBtn = (label, cls, onClick, disabled = false) => {
      const b = document.createElement('button');
      b.className = `btn btn-xs ${cls}`;
      b.textContent = label;
      b.disabled = Boolean(disabled);
      if (!disabled) {
        b.onclick = () => {
          onClick();
          this.map.closePopup();
        };
      }
      actions.appendChild(b);
    };

    const access = getAccess(state);
    const isHostGm = access.isGm;
    const claimLimitM = Number(state.game.stationClaimRadiusM) || 100;
    const cpLimitM = Number(state.game.checkpointRadiusM) || 100;

    if (state.game.rules.stationClaiming) {
      if (isHostGm) {
        state.teams.forEach((tm) => {
          addBtn(`Award to ${tm.name}`, 'btn-primary', () => this.callbacks.onToggleClaim?.(st, true, tm.id));
        });
        if (claim) addBtn('Clear Claim', 'btn-ghost', () => this.callbacks.onToggleClaim?.(st, false));
      } else if (claim && claim.teamId === myTeam?.id) {
        if (access.canEditScores) {
          addBtn('Unclaim Station', 'btn-ghost', () => this.callbacks.onToggleClaim?.(st, false));
        } else {
          addBtn('Claimed by Your Team', 'btn-ghost', () => {}, true);
        }
      } else if (myTeam) {
        const blockedBySteal = Boolean(claim && !state.game.allowStealingStations);
        const needGps = access.mustVerifyGps && dist == null;
        const tooFar = access.mustVerifyGps && dist != null && dist > claimLimitM;

        if (blockedBySteal) {
          addBtn('Already Claimed (No Stealing)', 'btn-ghost', () => {}, true);
        } else if (needGps) {
          addBtn(`Enable Live GPS (<= ${claimLimitM}m to claim)`, 'btn-secondary', () => {}, true);
        } else if (tooFar) {
          addBtn(`Too far to claim (${formatDistance(dist)} / ${claimLimitM}m max)`, 'btn-secondary', () => {}, true);
        } else {
          addBtn(claim ? `Steal for ${myTeam.name}` : `Claim for ${myTeam.name}`, 'btn-primary', () =>
            this.callbacks.onToggleClaim?.(st, true)
          );
        }
      }
    }

    if (state.game.rules.hideSeekQA && (isHostGm || myTeam?.role === 'hider' || !access.gmExists)) {
      addBtn('Set Hiding Zone Here', 'btn-accent', () => this.callbacks.onSetHidingZone?.(st));
    }

    if (state.game.rules.flags) {
      if (isHostGm) {
        state.teams.forEach((tm) => {
          addBtn(`Place ${tm.name} Flag`, 'btn-accent', () => this.callbacks.onDropFlag?.(st, tm.id));
        });
      } else if (myTeam) {
        const flagLimitM = Number(state.game.flagPickupRadiusM) || 100;
        const tooFarFlag = access.mustVerifyGps && (dist == null || dist > flagLimitM);
        addBtn(
          tooFarFlag ? `Move <= ${flagLimitM}m to Drop Flag` : `Drop ${myTeam.name} Flag`,
          tooFarFlag ? 'btn-secondary' : 'btn-accent',
          () => this.callbacks.onDropFlag?.(st),
          tooFarFlag
        );
      }
    }

    if (state.game.rules.checkpoints) {
      const existingCp = state.checkpoints.find((c) => c.stationId === st.id);
      if (existingCp && !isHostGm) {
        const needGpsCp = access.mustVerifyGps && dist == null;
        const tooFarCp = access.mustVerifyGps && dist != null && dist > cpLimitM;
        addBtn(
          needGpsCp ? `Enable GPS (<= ${cpLimitM}m)` : tooFarCp ? `Move <= ${cpLimitM}m (${formatDistance(dist)})` : 'Check Off Checkpoint',
          needGpsCp || tooFarCp ? 'btn-secondary' : 'btn-primary',
          () => this.callbacks.onCheckCheckpoint?.(existingCp.id),
          needGpsCp || tooFarCp
        );
      } else if (!existingCp && access.canEditRules) {
        addBtn('+ Add Checkpoint', 'btn-secondary', () => this.callbacks.onAddCheckpoint?.(st));
      }
    }

    if (isHostGm) {
      addBtn('Broadcast Station Alert', 'btn-secondary', () => this.callbacks.onHostBroadcastStation?.(st));
    }

    addBtn('Draw Radar Here', 'btn-ghost', () => this.callbacks.onQuickRadar?.(st.lat, st.lng, st.name));
    addBtn('Live TfNSW Trip ↗', 'btn-ghost', () => {
      const q = encodeURIComponent(`${st.name}, NSW`);
      window.open(`https://transportnsw.info/trip#/trip?from=${q}`, '_blank', 'noopener');
    });

    return div;
  }

  renderAllDynamicLayers(state) {
    if (!this.map) return;
    this.renderStations();
    this.renderModeOverlays(state);
    this.renderAnnotations(state);
    this.renderPlayers(state);
  }

  renderModeOverlays(state) {
    this.modeOverlayLayer.clearLayers();
    const myTeam = store.getLocalTeam();
    const isHostGm = Boolean(store.getLocalPlayer()?.isEventHost);

    // 1. Hide + Seek Hiding Zone (always visible to Event Host GM!)
    if (state.game.rules.hideSeekQA && state.hidingZone && (isHostGm || state.hidingZone.revealed || state.hidingZone.setByTeamId === myTeam?.id)) {
      const hz = state.hidingZone;
      L.circle([hz.lat, hz.lng], {
        radius: hz.radiusM || state.game.hidingRadiusM || 500,
        color: '#168388',
        weight: 2.5,
        dashArray: '8 6',
        fillColor: '#168388',
        fillOpacity: 0.16
      })
        .bindTooltip(`Hiding Zone: ${hz.stationName || 'Custom'} (${hz.radiusM}m)`, { className: 'jl-tooltip' })
        .addTo(this.modeOverlayLayer);
    }

    // 2. Capture the Flag Dividing Line
    if (state.game.rules.dividingLine && state.dividingLine?.p1 && state.dividingLine?.p2) {
      const dl = state.dividingLine;
      const midLat = (dl.p1[0] + dl.p2[0]) / 2;
      const midLng = (dl.p1[1] + dl.p2[1]) / 2;
      const dLat = dl.p2[0] - dl.p1[0];
      const dLng = dl.p2[1] - dl.p1[1];
      // Extend dividing line across Sydney
      const ext1 = [midLat - dLat * 3, midLng - dLng * 3];
      const ext2 = [midLat + dLat * 3, midLng + dLng * 3];

      L.polyline([ext1, ext2], {
        color: '#f59e0b',
        weight: 4,
        dashArray: '12 8',
        opacity: 0.95
      })
        .bindTooltip(`CTF Border: ${dl.name}`, { sticky: true, className: 'jl-tooltip' })
        .addTo(this.modeOverlayLayer);

      // Side labels (matches getDividingSide: cross = dLng*(lat-y1) - dLat*(lng-x1) > 0 => Side A)
      const perpLat = dLng * 0.25;
      const perpLng = -dLat * 0.25;
      L.marker([midLat + perpLat, midLng + perpLng], {
        interactive: false,
        icon: L.divIcon({
          className: 'map-zone-label',
          html: `<span>${dl.sideALabel || 'Side A'}</span>`,
          iconSize: [120, 26]
        })
      }).addTo(this.modeOverlayLayer);

      L.marker([midLat - perpLat, midLng - perpLng], {
        interactive: false,
        icon: L.divIcon({
          className: 'map-zone-label',
          html: `<span>${dl.sideBLabel || 'Side B'}</span>`,
          iconSize: [120, 26]
        })
      }).addTo(this.modeOverlayLayer);
    }

    // 3. Tag Across Sydney Win Sectors
    if (state.game.rules.winSectors && state.winSectors?.center) {
      const ws = state.winSectors;
      const count = Math.max(2, Math.min(6, ws.count || 3));
      const rot = ws.rotationDeg || 0;
      const sectorColors = ['#F99D1C', '#0098CD', '#5AB031', '#C4258F', '#D11F2F', '#168388'];
      const step = 360 / count;
      for (let i = 0; i < count; i++) {
        const startDeg = rot + i * step;
        const endDeg = startDeg + step;
        const poly = sectorPolygon(ws.center, startDeg, endDeg, 65);
        const col = state.teams[i]?.color || sectorColors[i % sectorColors.length];
        const label = ws.labels?.[i] || state.teams[i]?.name || `Sector ${i + 1}`;
        L.polygon(poly, {
          color: col,
          weight: 2,
          dashArray: '6 6',
          fillColor: col,
          fillOpacity: 0.08,
          interactive: false
        }).addTo(this.modeOverlayLayer);

        // Sector edge label ~16km out
        const midRad = (((startDeg + endDeg) / 2) * Math.PI) / 180;
        const lLat = ws.center[0] + Math.cos(midRad) * 0.14;
        const lLng = ws.center[1] + Math.sin(midRad) * 0.17;
        L.marker([lLat, lLng], {
          interactive: false,
          icon: L.divIcon({
            className: 'map-zone-label',
            html: `<span style="border-color:${col};color:${col}">${label}</span>`,
            iconSize: [150, 26]
          })
        }).addTo(this.modeOverlayLayer);
      }
    }

    // 4. Flags (CTF / Custom)
    if (state.game.rules.flags && state.flags?.length) {
      for (const fl of state.flags) {
        const team = state.teams.find((t) => t.id === fl.teamId);
        const col = team?.color || '#F99D1C';
        const statusTag = fl.status === 'captured' ? 'CAPTURED' : fl.status === 'carried' ? 'CARRIED' : 'FLAG';
        const m = L.marker([fl.lat, fl.lng], {
          icon: L.divIcon({
            className: 'map-flag-icon',
            html: `<div class="flag-pin" style="background:${col}"><strong>${statusTag}</strong><span>${fl.label}</span></div>`,
            iconSize: [120, 30],
            iconAnchor: [60, 15]
          })
        });
        m.bindPopup(
          `<div class="station-popup"><h4>${fl.label}</h4><p>Team: <strong>${team?.name || 'Neutral'}</strong><br/>Status: <strong>${fl.status.toUpperCase()}</strong></p></div>`,
          { className: 'jl-popup' }
        );
        m.addTo(this.modeOverlayLayer);
      }
    }

    // 5. Race Checkpoints
    if (state.game.rules.checkpoints && state.checkpoints?.length) {
      state.checkpoints.forEach((cp, idx) => {
        const completedCount = Object.keys(cp.completedBy || {}).length;
        const myDone = Boolean(cp.completedBy?.[myTeam?.id]);
        const m = L.marker([cp.lat, cp.lng], {
          icon: L.divIcon({
            className: 'map-cp-icon',
            html: `<div class="cp-pin ${myDone ? 'done' : ''}">${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
        });
        m.bindTooltip(
          `Checkpoint #${idx + 1}: <strong>${cp.name}</strong> (${completedCount} team${completedCount === 1 ? '' : 's'} done)`,
          { className: 'jl-tooltip' }
        );
        m.addTo(this.modeOverlayLayer);
      });
    }
  }

  renderAnnotations(state) {
    this.annotationsLayer.clearLayers();
    const myTeam = store.getLocalTeam();
    const isHostGm = Boolean(store.getLocalPlayer()?.isEventHost);

    for (const ann of state.annotations || []) {
      if (ann.scope === 'team' && !isHostGm && ann.teamId !== myTeam?.id) continue;
      const d = ann.data;

      if (ann.type === 'radar') {
        const radiusM = (d.radiusKm || 2) * 1000;
        const ring = circleRing(d.lat, d.lng, radiusM, 72);
        if (d.result === 'hit') {
          // Shade OUTSIDE the circle red (eliminated!) and outline inside emerald
          L.polygon([WORLD_OUTER_RING, ring], {
            color: '#10b981',
            weight: 2.5,
            fillColor: '#ef4444',
            fillOpacity: 0.24,
            interactive: false
          }).addTo(this.annotationsLayer);
        } else if (d.result === 'miss') {
          // Shade INSIDE the circle red (eliminated!)
          L.circle([d.lat, d.lng], {
            radius: radiusM,
            color: '#ef4444',
            weight: 2,
            dashArray: '6 5',
            fillColor: '#ef4444',
            fillOpacity: 0.26,
            interactive: false
          }).addTo(this.annotationsLayer);
        } else {
          L.circle([d.lat, d.lng], {
            radius: radiusM,
            color: '#38bdf8',
            weight: 2,
            dashArray: '6 4',
            fillColor: '#38bdf8',
            fillOpacity: 0.1,
            interactive: false
          }).addTo(this.annotationsLayer);
        }
        L.circleMarker([d.lat, d.lng], {
          radius: 5,
          fillColor: d.result === 'hit' ? '#10b981' : d.result === 'miss' ? '#ef4444' : '#38bdf8',
          color: '#fff',
          weight: 1.5
        })
          .bindTooltip(
            `Radar ${d.radiusKm} km (${(d.result || 'ref').toUpperCase()})${d.label ? ` — ${d.label}` : ''}`,
            { className: 'jl-tooltip' }
          )
          .addTo(this.annotationsLayer);
      } else if (ann.type === 'thermometer') {
        const { bisectorLine, shadedPolygon } = thermometerHalfPlane(d.pA, d.pB, d.hotterIsB !== false);
        L.polygon(shadedPolygon, {
          color: '#ef4444',
          weight: 0,
          fillColor: '#ef4444',
          fillOpacity: 0.22,
          interactive: false
        }).addTo(this.annotationsLayer);
        L.polyline(bisectorLine, {
          color: '#f97316',
          weight: 2.5,
          dashArray: '8 6',
          interactive: false
        }).addTo(this.annotationsLayer);
        L.polyline([d.pA, d.pB], {
          color: '#fbbf24',
          weight: 3
        })
          .bindTooltip(
            `Thermometer (${formatDistance(haversineM(d.pA[0], d.pA[1], d.pB[0], d.pB[1]))}) — B is ${d.hotterIsB !== false ? 'HOTTER' : 'COLDER'}`,
            { className: 'jl-tooltip' }
          )
          .addTo(this.annotationsLayer);
        L.circleMarker(d.pA, { radius: 5, fillColor: '#60a5fa', color: '#fff', weight: 1.5 })
          .bindTooltip('Thermometer Start (A)', { className: 'jl-tooltip' })
          .addTo(this.annotationsLayer);
        L.circleMarker(d.pB, { radius: 6, fillColor: '#f97316', color: '#fff', weight: 1.5 })
          .bindTooltip('Thermometer End (B)', { className: 'jl-tooltip' })
          .addTo(this.annotationsLayer);
      } else if (ann.type === 'polygon') {
        L.polygon(d.points, {
          color: d.color || '#ef4444',
          weight: 2,
          dashArray: '5 5',
          fillColor: d.color || '#ef4444',
          fillOpacity: 0.24
        })
          .bindTooltip(d.label || 'Eliminated Zone', { className: 'jl-tooltip' })
          .addTo(this.annotationsLayer);
      } else if (ann.type === 'ruler') {
        const totalM = d.points.reduce(
          (acc, pt, i) => (i === 0 ? 0 : acc + haversineM(d.points[i - 1][0], d.points[i - 1][1], pt[0], pt[1])),
          0
        );
        L.polyline(d.points, { color: '#38bdf8', weight: 3, dashArray: '6 6' })
          .bindTooltip(`Distance: ${formatDistance(totalM)} (~${Math.ceil(totalM / 80)} min walk)`, {
            sticky: true,
            className: 'jl-tooltip'
          })
          .addTo(this.annotationsLayer);
      } else if (ann.type === 'pin') {
        L.marker([d.lat, d.lng], {
          icon: L.divIcon({
            className: 'map-custom-pin',
            html: `<div class="custom-pin" style="background:${d.color || '#a855f7'}"><span>${d.label || 'Pin'}</span></div>`,
            iconSize: [110, 28],
            iconAnchor: [55, 14]
          })
        }).addTo(this.annotationsLayer);
      }
    }
  }

  renderPlayers(state) {
    this.playersLayer.clearLayers();
    const viewer = store.getLocalPlayer();

    for (const p of Object.values(state.players || {})) {
      if (!canSeePlayerGps(state, viewer, p)) continue;
      const lat = p.gpsFrozen && p.frozenLat != null ? p.frozenLat : p.lat;
      const lng = p.gpsFrozen && p.frozenLng != null ? p.frozenLng : p.lng;
      if (lat == null || lng == null) continue;

      const team = state.teams.find((t) => t.id === p.teamId);
      const col = team?.color || p.color || '#F99D1C';
      const isMe = p.id === state.localPlayerId;
      const roleTag = team?.role ? team.role.toUpperCase() : '';
      const side = state.game.rules.dividingLine ? getDividingSide(lat, lng, state.dividingLine) : null;
      const sideText =
        side === 'A'
          ? state.dividingLine.sideALabel
          : side === 'B'
            ? state.dividingLine.sideBLabel
            : '';

      // Accuracy circle
      if (p.accuracy && p.accuracy < 600 && !p.gpsFrozen) {
        L.circle([lat, lng], {
          radius: p.accuracy,
          color: col,
          weight: 1,
          fillColor: col,
          fillOpacity: 0.12,
          interactive: false
        }).addTo(this.playersLayer);
      }

      // Catching radius ring for Runner in Tag mode
      if (state.game.mode === 'tag' && team?.role === 'runner') {
        L.circle([lat, lng], {
          radius: state.game.catchRadiusM || 100,
          color: '#ef4444',
          weight: 2,
          dashArray: '4 4',
          fillColor: '#ef4444',
          fillOpacity: 0.14,
          interactive: false
        }).addTo(this.playersLayer);
      }

      const initials = (p.name || 'P').slice(0, 2).toUpperCase();
      const icon = L.divIcon({
        className: 'player-marker-wrap',
        html: `
          <div class="player-marker ${isMe ? 'is-me' : ''} ${p.gpsFrozen ? 'is-frozen' : ''}" style="--pcolor:${col}">
            <div class="pm-pulse"></div>
            <div class="pm-dot">${p.gpsFrozen ? 'FRZ' : initials}</div>
            <div class="pm-label">${p.name}${p.gpsFrozen ? ' (FROZEN)' : ''}</div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      const ageSec = Math.max(0, Math.round((Date.now() - (p.lastSeen || Date.now())) / 1000));
      L.marker([lat, lng], { icon, zIndexOffset: isMe ? 1000 : 800 })
        .bindPopup(
          `<div class="station-popup">
            <h4>${p.name} ${isMe ? '(You)' : ''}</h4>
            <p>Team: <strong style="color:${col}">${team?.name || 'None'}</strong> ${roleTag ? `(${roleTag})` : ''}</p>
            ${sideText ? `<p>Zone: <strong>${sideText}</strong></p>` : ''}
            <p class="sp-meta">Updated ${ageSec < 5 ? 'just now' : `${ageSec}s ago`}${p.gpsFrozen ? ' · Tracker Frozen' : ''}</p>
          </div>`,
          { className: 'jl-popup' }
        )
        .addTo(this.playersLayer);
    }
  }

  // ===== INTERACTIVE STRATEGY DRAWING TOOLS =====
  setTool(toolName) {
    this.activeTool = toolName;
    this.draftPoints = [];
    this.draftLayer.clearLayers();
    this.map.getContainer().style.cursor = toolName === 'select' ? '' : 'crosshair';
    this.callbacks.onToolStatus?.(this.getToolHint());
  }

  getToolHint() {
    switch (this.activeTool) {
      case 'radar':
        return 'Radar Tool: Tap anywhere on the map (or press "At My GPS") to place a Hit/Miss radar circle.';
      case 'thermometer':
        return this.draftPoints.length === 0
          ? 'Thermometer Tool: Tap START Point (A) on the map.'
          : 'Thermometer Tool: Now tap END Point (B) to draw the perpendicular bisector & shade the colder half!';
      case 'ruler':
        return this.draftPoints.length === 0
          ? 'Ruler Tool: Tap points to measure exact km, walking time & Tag transit coin estimates.'
          : `Ruler: ${this.draftPoints.length} point(s) placed. Keep tapping or click Finish.`;
      case 'polygon':
        return this.draftPoints.length < 3
          ? `Zone Shader: Tap ${3 - this.draftPoints.length}+ points to outline an eliminated zone.`
          : `Zone Shader: ${this.draftPoints.length} vertices placed. Double-click or press Finish to shade!`;
      case 'pin':
        return 'Pin Tool: Tap anywhere on the map to drop a labeled tactical marker.';
      default:
        return '';
    }
  }

  handleMapClick(e) {
    const { lat, lng } = e.latlng;
    if (this.activeTool === 'select') return;

    if (this.activeTool === 'radar') {
      this.callbacks.onQuickRadar?.(lat, lng, '');
      return;
    }

    if (this.activeTool === 'pin') {
      this.callbacks.onRequestPin?.(lat, lng);
      return;
    }

    if (this.activeTool === 'thermometer') {
      this.draftPoints.push([lat, lng]);
      this.renderDraft();
      if (this.draftPoints.length === 2) {
        const [pA, pB] = this.draftPoints;
        this.draftPoints = [];
        this.draftLayer.clearLayers();
        this.callbacks.onRequestThermometer?.(pA, pB);
      }
      this.callbacks.onToolStatus?.(this.getToolHint());
      return;
    }

    if (this.activeTool === 'ruler' || this.activeTool === 'polygon') {
      this.draftPoints.push([lat, lng]);
      this.renderDraft();
      this.callbacks.onToolStatus?.(this.getToolHint());
    }
  }

  renderDraft() {
    this.draftLayer.clearLayers();
    if (!this.draftPoints.length) return;
    this.draftPoints.forEach((pt) => {
      L.circleMarker(pt, { radius: 5, fillColor: '#38bdf8', color: '#fff', weight: 2 }).addTo(this.draftLayer);
    });
    if (this.draftPoints.length >= 2) {
      L.polyline(this.draftPoints, { color: '#38bdf8', weight: 2.5, dashArray: '5 5' }).addTo(this.draftLayer);
    }
  }

  finishDraftTool() {
    const myTeam = store.getLocalTeam();
    const myPlayer = store.getLocalPlayer();
    const teamId = myTeam?.id || null;
    if (this.activeTool === 'polygon' && this.draftPoints.length >= 3) {
      store.mutate((s) => {
        s.annotations.push({
          id: uid('ann'),
          type: 'polygon',
          scope: this.toolScope,
          teamId,
          createdBy: myPlayer.name,
          createdAt: Date.now(),
          data: { points: [...this.draftPoints], color: '#ef4444', label: 'Eliminated Zone' }
        });
      }, 'annotation');
      store.addFeed({ type: 'map', text: `shaded an eliminated zone on the map.` });
    } else if (this.activeTool === 'ruler' && this.draftPoints.length >= 2) {
      const totalM = this.draftPoints.reduce(
        (acc, pt, i) => (i === 0 ? 0 : acc + haversineM(this.draftPoints[i - 1][0], this.draftPoints[i - 1][1], pt[0], pt[1])),
        0
      );
      store.mutate((s) => {
        s.annotations.push({
          id: uid('ann'),
          type: 'ruler',
          scope: this.toolScope,
          teamId,
          createdBy: myPlayer.name,
          createdAt: Date.now(),
          data: { points: [...this.draftPoints] }
        });
      }, 'annotation');
      this.callbacks.onToast?.(`Measured ${formatDistance(totalM)} (~${Math.ceil(totalM / 80)} min walk)`);
    }
    this.draftPoints = [];
    this.draftLayer.clearLayers();
    this.setTool('select');
  }

  addRadar(lat, lng, radiusKm, result, label = '') {
    const myTeam = store.getLocalTeam();
    const myPlayer = store.getLocalPlayer();
    store.mutate((s) => {
      s.annotations.push({
        id: uid('ann'),
        type: 'radar',
        scope: this.toolScope,
        teamId: myTeam?.id || null,
        createdBy: myPlayer.name,
        createdAt: Date.now(),
        data: { lat, lng, radiusKm, result, label }
      });
    }, 'annotation');
    store.addFeed({
      type: 'map',
      text: `placed a ${radiusKm} km Radar (${result.toUpperCase()})${label ? ` at ${label}` : ''}.`
    });
  }

  addThermometer(pA, pB, hotterIsB = true) {
    const myTeam = store.getLocalTeam();
    const myPlayer = store.getLocalPlayer();
    const dist = haversineM(pA[0], pA[1], pB[0], pB[1]);
    store.mutate((s) => {
      s.annotations.push({
        id: uid('ann'),
        type: 'thermometer',
        scope: this.toolScope,
        teamId: myTeam?.id || null,
        createdBy: myPlayer.name,
        createdAt: Date.now(),
        data: { pA, pB, hotterIsB }
      });
    }, 'annotation');
    store.addFeed({
      type: 'map',
      text: `plotted a ${formatDistance(dist)} Thermometer bisector (${hotterIsB ? 'HOTTER' : 'COLDER'}).`
    });
  }

  addPin(lat, lng, label, color) {
    const myTeam = store.getLocalTeam();
    const myPlayer = store.getLocalPlayer();
    store.mutate((s) => {
      s.annotations.push({
        id: uid('ann'),
        type: 'pin',
        scope: this.toolScope,
        teamId: myTeam?.id || null,
        createdBy: myPlayer.name,
        createdAt: Date.now(),
        data: { lat, lng, label, color: color || myTeam?.color || '#168388' }
      });
    }, 'annotation');
  }

  invalidateSize() {
    setTimeout(() => this.map?.invalidateSize(), 120);
  }
}
