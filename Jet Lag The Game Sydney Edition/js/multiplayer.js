// Reliable Real-Time Multiplayer Sync + Hardened Outdoor Sydney GPS Telemetry
// Lazy-loads mqtt.min.js & qrcode.min.js on demand for blazing-fast initial mobile page loads!
import { store } from './state.js?v=15';
import { haversineM } from './modes.js?v=15';

const MQTT_CDN = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';

const MQTT_BROKERS = [
  { name: 'EMQX Cloud', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HiveMQ Cloud', url: 'wss://broker.hivemq.com:8884/mqtt' }
];

const TOPIC_PREFIX = 'jetlag-sydney/live/v2';

const _scriptPromises = new Map();
export function loadScriptOnce(src) {
  if (_scriptPromises.has(src)) return _scriptPromises.get(src);
  const p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = '';
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  _scriptPromises.set(src, p);
  return p;
}

export async function ensureQrLib() {
  if (window.qrcode) return window.qrcode;
  try {
    await loadScriptOnce(QR_CDN);
    return window.qrcode || null;
  } catch {
    return null;
  }
}

/** Normalize any user input ("4k9p", "syd 4k9p", "SYD-4K9P", "MYGAME") into one consistent canonical code */
export function normalizeRoomCode(raw) {
  const alnum = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!alnum) return '';
  if (alnum.startsWith('SYD') && alnum.length > 3) {
    return `SYD-${alnum.slice(3, 9)}`;
  }
  if (alnum.length <= 5) {
    return `SYD-${alnum}`;
  }
  return alnum.slice(0, 10);
}

function topicKey(code) {
  return normalizeRoomCode(code).replace(/[^A-Z0-9]/g, '');
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `SYD-${suffix}`;
}

/** Compress a phone camera image to a compact JPEG data URL (~30KB) for instant room sync */
export function compressImageFile(file, maxDim = 560, quality = 0.68) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export class MultiplayerManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.mqttClient = null;
    this.brokerIdx = 0;
    this.bc = null;
    this.firebaseES = null;
    this.geoWatchId = null;

    this.stateSyncTimer = null;
    this.playerSyncTimer = null;
    this.heartbeatTimer = null;
    this.connectTimeoutTimer = null;
    this.gpsStaleTimer = null;
    this.lastAppliedStateTs = 0;
    this.activeTopicBase = '';

    store.subscribe((state, reason, shouldSync) => {
      if (!shouldSync) return;
      if (!state.room.connected) return;
      if (reason === 'gps') {
        this.schedulePlayerSync();
      } else {
        this.scheduleStateSync();
        if (reason === 'profile' || reason === 'teams') this.schedulePlayerSync();
      }
    });

    // Screen-wake & tunnel recovery: auto-refresh GPS & resync room when phone wakes or reconnects!
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.handleResume();
    });
    window.addEventListener('online', () => this.handleResume());
  }

  handleResume() {
    const s = store.get();
    if (s.room.shareGps) {
      this.refreshGpsFix(true);
    }
    if (s.room.connected) {
      this.publishLocalPlayerNow();
      if (this.mqttClient?.connected && this.activeTopicBase) {
        try {
          this.mqttClient.publish(`${this.activeTopicBase}/ping`, JSON.stringify({ senderId: s.localPlayerId, ts: Date.now() }));
        } catch {}
      }
    }
  }

  getInviteUrl() {
    const s = store.get();
    const url = new URL(window.location.href);
    url.search = '';
    if (s.room.code) url.searchParams.set('room', normalizeRoomCode(s.room.code));
    if (s.room.engine === 'firebase' && s.room.firebaseUrl) {
      url.searchParams.set('fb', s.room.firebaseUrl);
    }
    return url.toString();
  }

  disconnect(silent = false) {
    clearTimeout(this.stateSyncTimer);
    clearTimeout(this.playerSyncTimer);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.connectTimeoutTimer);
    this.activeTopicBase = '';

    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch {}
      this.mqttClient = null;
    }
    if (this.bc) {
      try { this.bc.close(); } catch {}
      this.bc = null;
    }
    if (this.firebaseES) {
      try { this.firebaseES.close(); } catch {}
      this.firebaseES = null;
    }

    if (!silent) {
      store.mutate((s) => {
        s.room.connected = false;
        s.room.isHost = false;
        s.room.statusText = 'Solo / Local Mode';
      }, 'room_status', false);
    }
  }

  // ===== ENGINE 1: ZERO-SETUP CLOUD WSS RELAY (LAZY-LOADED MQTT) + BROADCASTCHANNEL =====
  hostPeerRoom(rawCode) {
    const code = normalizeRoomCode(rawCode) || generateRoomCode();
    this.connectCloudRoom(code, true);
    return code;
  }

  joinPeerRoom(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (!code) {
      this.callbacks.onToast?.('Enter a valid room code (e.g. SYD-4K9P or 4K9P).');
      return '';
    }
    this.connectCloudRoom(code, false);
    return code;
  }

  async connectCloudRoom(code, isCreating = false, brokerIdx = 0) {
    this.disconnect(true);
    this.brokerIdx = brokerIdx;
    this.lastAppliedStateTs = 0;

    const key = topicKey(code);
    const base = `${TOPIC_PREFIX}/${key}`;
    this.activeTopicBase = base;

    store.mutate((s) => {
      s.room.engine = 'cloud';
      s.room.code = code;
      s.room.isHost = isCreating;
      s.room.connected = false;
      s.room.statusText = `Connecting to ${code}...`;
    }, 'room_status', false);

    this.setupBroadcastChannel(key, isCreating);

    // Lazy-load mqtt.min.js + qrcode.min.js on demand so startup stays ultra-fast!
    if (!window.mqtt) {
      try {
        await loadScriptOnce(MQTT_CDN);
      } catch {}
    }
    ensureQrLib(); // fire-and-forget for QR rendering

    if (!window.mqtt) {
      store.mutate((s) => {
        s.room.connected = true;
        s.room.statusText = `Local Tabs · ${code}`;
      }, 'room_status', false);
      this.callbacks.onToast?.(`Connected locally to ${code} (cloud script offline).`);
      return code;
    }

    const broker = MQTT_BROKERS[brokerIdx % MQTT_BROKERS.length];
    const clientId = `jlsyd_${store.get().localPlayerId}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      const client = window.mqtt.connect(broker.url, {
        clientId,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 2500,
        connectTimeout: 8000
      });
      this.mqttClient = client;

      this.connectTimeoutTimer = setTimeout(() => {
        if (!client.connected && this.mqttClient === client && brokerIdx + 1 < MQTT_BROKERS.length) {
          this.connectCloudRoom(code, isCreating, brokerIdx + 1);
        }
      }, 6000);

      client.on('connect', () => {
        clearTimeout(this.connectTimeoutTimer);
        if (this.mqttClient !== client) return;

        client.subscribe(`${base}/#`, { qos: 0 }, (err) => {
          if (err) return;
          store.mutate((s) => {
            s.room.connected = true;
            s.room.statusText = `Live · ${code}`;
          }, 'room_status', false);

          this.publishLocalPlayerNow();

          if (isCreating) {
            this.publishStateNow();
            store.addFeed({ type: 'system', text: `Live room ${code} created. Share the code or invite link.` }, true);
            this.callbacks.onToast?.(`Room ${code} is LIVE.`);
          } else {
            this.callbacks.onToast?.(`Joined live room ${code}.`);
            try {
              client.publish(`${base}/ping`, JSON.stringify({ senderId: store.get().localPlayerId, ts: Date.now() }));
            } catch {}
          }
        });
      });

      client.on('message', (topic, payloadBuf) => {
        if (this.mqttClient !== client) return;
        try {
          const msg = JSON.parse(payloadBuf.toString());
          if (!msg || msg.senderId === store.get().localPlayerId) return;

          if (topic === `${base}/state` && msg.payload) {
            const ts = msg.ts || msg.payload.updatedAt || 0;
            if (ts >= this.lastAppliedStateTs) {
              this.lastAppliedStateTs = ts;
              store.applySharedSnapshot(msg.payload);
            }
          } else if (topic.startsWith(`${base}/players/`) && msg.payload?.id) {
            const pid = msg.payload.id;
            if (pid !== store.get().localPlayerId) {
              store.mutate((s) => {
                s.players[pid] = { ...(s.players[pid] || {}), ...msg.payload, online: true };
              }, 'remote_sync', false);
            }
          } else if (topic === `${base}/ping`) {
            this.publishLocalPlayerNow();
            if (store.get().room.isHost) this.publishStateNow();
          }
        } catch {}
      });

      client.on('reconnect', () => {
        store.mutate((s) => { s.room.statusText = `Reconnecting ${code}...`; }, 'room_status', false);
      });

      client.on('offline', () => {
        store.mutate((s) => { s.room.statusText = `Offline (${code}) — retrying...`; }, 'room_status', false);
      });

      client.on('error', () => {});

      this.heartbeatTimer = setInterval(() => {
        if (store.get().room.connected) this.publishLocalPlayerNow();
      }, 20000);
    } catch {
      store.mutate((s) => {
        s.room.connected = true;
        s.room.statusText = `Local Tabs · ${code}`;
      }, 'room_status', false);
    }

    return code;
  }

  setupBroadcastChannel(key, isCreating) {
    if (typeof BroadcastChannel === 'undefined') return;
    this.bc = new BroadcastChannel(`jetlag-syd-${key}`);
    this.bc.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || msg.senderId === store.get().localPlayerId) return;
      if (msg.type === 'snapshot' && msg.payload) {
        store.applySharedSnapshot(msg.payload);
      } else if (msg.type === 'player_update' && msg.payload?.id) {
        store.mutate((s) => {
          s.players[msg.payload.id] = { ...(s.players[msg.payload.id] || {}), ...msg.payload, online: true };
        }, 'remote_sync', false);
      } else if (msg.type === 'hello') {
        this.bc.postMessage({ type: 'player_update', senderId: store.get().localPlayerId, payload: store.getLocalPlayer() });
        if (store.get().room.isHost) {
          this.bc.postMessage({ type: 'snapshot', senderId: store.get().localPlayerId, payload: store.getSharedSnapshot() });
        }
      }
    };
    if (!isCreating) {
      this.bc.postMessage({ type: 'hello', senderId: store.get().localPlayerId });
      this.bc.postMessage({ type: 'player_update', senderId: store.get().localPlayerId, payload: store.getLocalPlayer() });
    }
  }

  publishStateNow() {
    const s = store.get();
    if (!s.room.connected) return;
    const snap = store.getSharedSnapshot();
    const now = Date.now();
    this.lastAppliedStateTs = Math.max(this.lastAppliedStateTs, now);

    if (s.room.engine === 'firebase' && s.room.firebaseUrl) {
      const roomPath = `${s.room.firebaseUrl.replace(/\/+$/, '')}/jetlag_rooms/${topicKey(s.room.code)}`;
      fetch(`${roomPath}/state.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snap)
      }).catch(() => {});
      return;
    }

    if (this.mqttClient?.connected && this.activeTopicBase) {
      try {
        this.mqttClient.publish(
          `${this.activeTopicBase}/state`,
          JSON.stringify({ senderId: s.localPlayerId, ts: now, payload: snap }),
          { qos: 0, retain: true }
        );
      } catch {}
    }
    this.bc?.postMessage({ type: 'snapshot', senderId: s.localPlayerId, payload: snap });
  }

  publishLocalPlayerNow() {
    const s = store.get();
    const p = store.getLocalPlayer();
    if (!p || !s.room.connected) return;
    const payload = { ...p, lastSeen: p.lastSeen || Date.now(), online: true };

    if (s.room.engine === 'firebase' && s.room.firebaseUrl) {
      const roomPath = `${s.room.firebaseUrl.replace(/\/+$/, '')}/jetlag_rooms/${topicKey(s.room.code)}`;
      this.pushFirebasePlayer(roomPath);
      return;
    }

    if (this.mqttClient?.connected && this.activeTopicBase) {
      try {
        this.mqttClient.publish(
          `${this.activeTopicBase}/players/${p.id}`,
          JSON.stringify({ senderId: s.localPlayerId, ts: Date.now(), payload }),
          { qos: 0, retain: true }
        );
      } catch {}
    }
    this.bc?.postMessage({ type: 'player_update', senderId: s.localPlayerId, payload });
  }

  forceSyncNow() {
    if (!store.get().room.connected) return this.callbacks.onToast?.('Not connected to a room.');
    this.publishLocalPlayerNow();
    this.publishStateNow();
    this.callbacks.onToast?.('Synced room state to all connected players.');
  }

  scheduleStateSync() {
    clearTimeout(this.stateSyncTimer);
    this.stateSyncTimer = setTimeout(() => this.publishStateNow(), 120);
  }

  schedulePlayerSync() {
    clearTimeout(this.playerSyncTimer);
    this.playerSyncTimer = setTimeout(() => this.publishLocalPlayerNow(), 280);
  }

  // ===== ENGINE 2: OPTIONAL PRIVATE FIREBASE REALTIME DATABASE (REST + SSE) =====
  async connectFirebaseRoom(rawUrl, rawCode) {
    this.disconnect(true);
    const dbUrl = (rawUrl || '').trim().replace(/\/+$/, '');
    if (!dbUrl.startsWith('https://')) {
      this.callbacks.onToast?.('Enter a valid https:// Firebase Realtime Database URL.');
      return;
    }
    const code = normalizeRoomCode(rawCode) || generateRoomCode();
    const roomPath = `${dbUrl}/jetlag_rooms/${topicKey(code)}`;
    ensureQrLib();

    store.mutate((s) => {
      s.room.engine = 'firebase';
      s.room.firebaseUrl = dbUrl;
      s.room.code = code;
      s.room.isHost = false;
      s.room.connected = false;
      s.room.statusText = `Connecting Firebase ${code}...`;
    }, 'room_status', false);

    try {
      const existing = await fetch(`${roomPath}/state.json`).then((r) => r.json());
      if (existing && existing.game) {
        store.applySharedSnapshot(existing);
      } else {
        await fetch(`${roomPath}/state.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(store.getSharedSnapshot())
        });
      }
      await this.pushFirebasePlayer(roomPath);

      const es = new EventSource(`${roomPath}.json`);
      this.firebaseES = es;

      const handleSSE = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (!msg || msg.data == null) return;
          if (msg.path === '/') {
            if (msg.data.state) store.applySharedSnapshot(msg.data.state);
            if (msg.data.players) {
              store.mutate((s) => {
                for (const [pid, pdata] of Object.entries(msg.data.players)) {
                  if (pid !== s.localPlayerId && pdata) s.players[pid] = pdata;
                }
              }, 'remote_sync', false);
            }
          } else if (msg.path === '/state') {
            store.applySharedSnapshot(msg.data);
          } else if (msg.path.startsWith('/players/')) {
            const pid = msg.path.split('/')[2];
            if (pid && pid !== store.get().localPlayerId && msg.data) {
              store.mutate((s) => {
                s.players[pid] = msg.data;
              }, 'remote_sync', false);
            }
          }
        } catch {}
      };

      es.addEventListener('put', handleSSE);
      es.addEventListener('patch', handleSSE);
      es.onopen = () => {
        store.mutate((s) => {
          s.room.connected = true;
          s.room.statusText = `Firebase · ${code}`;
        }, 'room_status', false);
      };
      es.onerror = () => {
        store.mutate((s) => {
          s.room.statusText = `Firebase reconnecting (${code})...`;
        }, 'room_status', false);
      };

      store.mutate((s) => {
        s.room.connected = true;
        s.room.statusText = `Firebase · ${code}`;
      }, 'room_status', false);
      this.callbacks.onToast?.(`Connected to Firebase room ${code}.`);
    } catch {
      store.mutate((s) => {
        s.room.connected = false;
        s.room.statusText = 'Firebase Error (check DB rules/URL)';
      }, 'room_status', false);
      this.callbacks.onToast?.('Firebase connection failed — check your RTDB URL and read/write rules.');
    }
  }

  async pushFirebasePlayer(roomPath) {
    const p = store.getLocalPlayer();
    if (!p) return;
    try {
      await fetch(`${roomPath}/players/${p.id}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, lastSeen: p.lastSeen || Date.now(), online: true })
      });
    } catch {}
  }

  // ===== HARDENED OUTDOOR SYDNEY GPS TELEMETRY ENGINE =====
  applyGpsPosition(coords) {
    const { latitude, longitude, accuracy, speed, heading } = coords;
    const now = Date.now();
    const speedKmh = speed != null && !Number.isNaN(speed) && speed >= 0 ? Math.round(speed * 3.6) : null;
    const quality = accuracy != null && accuracy > 80 ? 'weak' : 'live';

    store.mutate((s) => {
      const p = s.players[s.localPlayerId];
      if (!p) return;
      p.lat = latitude;
      p.lng = longitude;
      p.accuracy = accuracy != null ? Math.round(accuracy) : null;
      p.speed = speed;
      p.heading = heading != null && !Number.isNaN(heading) ? Math.round(heading) : p.heading;
      p.lastSeen = now;
      p.online = true;

      if (p.gpsFrozen && s.room.freezeEndsAt && now > s.room.freezeEndsAt) {
        p.gpsFrozen = false;
        p.frozenLat = null;
        p.frozenLng = null;
      }

      // Append breadcrumb trail point if moved >= 25m
      const trail = s.gpsTelemetry.trail || [];
      const lastPt = trail[trail.length - 1];
      if (!lastPt || haversineM(lastPt[0], lastPt[1], latitude, longitude) >= 25) {
        trail.push([latitude, longitude]);
        if (trail.length > 160) trail.shift();
      }
      s.gpsTelemetry = {
        status: quality,
        accuracy: p.accuracy,
        speedKmh,
        heading: p.heading,
        lastFixAt: now,
        errorMsg: '',
        trail
      };
    }, 'gps', true);

    this.callbacks.onGpsUpdate?.(latitude, longitude, accuracy);
  }

  startGps() {
    if (!navigator.geolocation) {
      store.mutate((s) => {
        s.gpsTelemetry.status = 'unavailable';
        s.gpsTelemetry.errorMsg = 'Browser does not support Geolocation.';
      }, 'gps', false);
      this.callbacks.onToast?.('Geolocation is not supported by this browser.');
      return;
    }
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure) {
      store.mutate((s) => {
        s.gpsTelemetry.status = 'insecure';
        s.gpsTelemetry.errorMsg = 'Mobile browsers require HTTPS for live GPS (works automatically on GitHub Pages).';
      }, 'gps', false);
      this.callbacks.onToast?.('Live GPS requires HTTPS — works automatically on GitHub Pages.');
      return;
    }
    if (this.geoWatchId != null) {
      this.refreshGpsFix();
      return;
    }

    store.mutate((s) => {
      s.room.shareGps = true;
      s.gpsTelemetry.status = 'acquiring';
      s.gpsTelemetry.errorMsg = '';
    }, 'gps', false);

    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => this.applyGpsPosition(pos.coords),
      (err) => {
        const denied = err.code === 1;
        store.mutate((s) => {
          s.gpsTelemetry.status = denied ? 'denied' : 'weak';
          s.gpsTelemetry.errorMsg = denied
            ? 'Location permission denied. Enable location access for this site in your phone browser settings.'
            : `Signal weak / tunnel (${err.message}).`;
        }, 'gps', false);
        this.callbacks.onToast?.(denied ? 'Location permission denied in browser settings.' : `GPS signal weak: ${err.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
    );

    // Monitor stale GPS signal (e.g. underground in Sydney Metro / City Circle tunnels)
    clearInterval(this.gpsStaleTimer);
    this.gpsStaleTimer = setInterval(() => {
      const s = store.get();
      if (!s.room.shareGps || !s.gpsTelemetry.lastFixAt) return;
      const ageSec = (Date.now() - s.gpsTelemetry.lastFixAt) / 1000;
      if (ageSec > 60 && s.gpsTelemetry.status !== 'stale') {
        store.mutate((st) => {
          st.gpsTelemetry.status = 'stale';
          st.gpsTelemetry.errorMsg = 'No fresh GPS fix for >60s (tunnel or background sleep).';
        }, 'gps', false);
      }
    }, 10000);
  }

  refreshGpsFix(silent = false) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.applyGpsPosition(pos.coords);
        if (!silent) this.callbacks.onToast?.(`GPS refreshed (±${Math.round(pos.coords.accuracy)}m).`);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  stopGps() {
    if (this.geoWatchId != null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    clearInterval(this.gpsStaleTimer);
    store.mutate((s) => {
      s.room.shareGps = false;
      s.gpsTelemetry.status = 'off';
    }, 'gps', false);
  }

  clearGpsTrail() {
    store.mutate((s) => { s.gpsTelemetry.trail = []; }, 'gps', false);
  }

  setSimulatedGps(lat, lng, label = '') {
    this.applyGpsPosition({ latitude: lat, longitude: lng, accuracy: 10, speed: 0, heading: null });
    if (label) this.callbacks.onToast?.(`Demo GPS positioned at ${label}.`);
  }
}
