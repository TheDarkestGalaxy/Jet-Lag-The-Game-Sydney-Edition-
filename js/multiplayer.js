// Real-Time Multiplayer Sync (Zero-Setup PeerJS WebRTC + BroadcastChannel + Optional Firebase RTDB SSE) & Live GPS
import { store } from './state.js';

function cleanCode(code) {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `SYD-${suffix}`;
}

/** Compress a phone camera image to a compact JPEG data URL (~30KB) for instant P2P/Firebase sync */
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
    this.peer = null;
    this.hostConn = null; // when guest
    this.guestConns = new Map(); // when host: peerId -> DataConnection
    this.bc = null; // same-browser tab BroadcastChannel
    this.firebaseES = null; // EventSource for Firebase RTDB
    this.geoWatchId = null;
    this.lastBroadcastAt = 0;
    this.pendingSyncTimer = null;
    this.reconnectTimer = null;

    // Subscribe to local store changes and propagate when connected
    store.subscribe((state, reason, shouldSync) => {
      if (!shouldSync) return;
      if (!state.room.connected) return;
      this.scheduleBroadcast(reason);
    });
  }

  getInviteUrl() {
    const s = store.get();
    const url = new URL(window.location.href);
    url.search = '';
    if (s.room.code) url.searchParams.set('room', s.room.code);
    if (s.room.engine === 'firebase' && s.room.firebaseUrl) {
      url.searchParams.set('fb', s.room.firebaseUrl);
    }
    return url.toString();
  }

  disconnect() {
    clearTimeout(this.pendingSyncTimer);
    clearTimeout(this.reconnectTimer);
    if (this.peer) {
      try { this.peer.destroy(); } catch {}
      this.peer = null;
    }
    this.hostConn = null;
    this.guestConns.clear();
    if (this.bc) {
      try { this.bc.close(); } catch {}
      this.bc = null;
    }
    if (this.firebaseES) {
      try { this.firebaseES.close(); } catch {}
      this.firebaseES = null;
    }
    store.mutate((s) => {
      s.room.connected = false;
      s.room.isHost = false;
      s.room.statusText = 'Solo / Local Mode';
    }, 'room_status', false);
  }

  // ===== ENGINE 1: ZERO-SETUP PEERJS + BROADCASTCHANNEL =====
  hostPeerRoom(rawCode) {
    this.disconnect();
    const code = rawCode ? rawCode.toUpperCase().trim() : generateRoomCode();
    const peerId = `jetlag-syd-room-${cleanCode(code)}`;

    store.mutate((s) => {
      s.room.engine = 'peerjs';
      s.room.code = code;
      s.room.isHost = true;
      s.room.connected = false;
      s.room.statusText = `Opening room ${code}…`;
    }, 'room_status', false);

    this.setupBroadcastChannel(code, true);

    if (!window.Peer) {
      store.mutate((s) => {
        s.room.connected = true;
        s.room.statusText = `Local Tabs Room ${code} (PeerJS offline)`;
      }, 'room_status', false);
      this.callbacks.onToast?.('PeerJS CDN unavailable — running in local multi-tab mode.');
      return code;
    }

    try {
      this.peer = new window.Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', () => {
        store.mutate((s) => {
          s.room.connected = true;
          s.room.isHost = true;
          s.room.statusText = `Hosting ${code} • 0 peers`;
        }, 'room_status', false);
        store.addFeed({ type: 'system', text: `Live room ${code} created! Share the code or QR with opponents.` }, false);
        this.callbacks.onToast?.(`Room ${code} is LIVE!`);
      });

      this.peer.on('connection', (conn) => {
        conn.on('open', () => {
          this.guestConns.set(conn.peer, conn);
          this.updateHostPeerCount();
          // Push authoritative snapshot to joining guest
          conn.send({ type: 'snapshot', payload: store.getSharedSnapshot() });
        });
        conn.on('data', (msg) => this.handleHostMessage(conn, msg));
        conn.on('close', () => {
          this.guestConns.delete(conn.peer);
          this.updateHostPeerCount();
        });
        conn.on('error', () => {
          this.guestConns.delete(conn.peer);
          this.updateHostPeerCount();
        });
      });

      this.peer.on('error', (err) => {
        console.warn('PeerJS host error:', err);
        if (err.type === 'unavailable-id') {
          this.callbacks.onToast?.(`Room ${code} already exists — try Joining it or pick a fresh code.`);
        }
        store.mutate((s) => {
          s.room.statusText = `Room ${code} (${err.type || 'reconnecting'})`;
        }, 'room_status', false);
      });
    } catch (e) {
      console.error(e);
    }
    return code;
  }

  joinPeerRoom(rawCode) {
    this.disconnect();
    const code = rawCode.toUpperCase().trim();
    if (!code) return;
    const hostPeerId = `jetlag-syd-room-${cleanCode(code)}`;

    store.mutate((s) => {
      s.room.engine = 'peerjs';
      s.room.code = code;
      s.room.isHost = false;
      s.room.connected = false;
      s.room.statusText = `Connecting to ${code}…`;
    }, 'room_status', false);

    this.setupBroadcastChannel(code, false);

    if (!window.Peer) {
      store.mutate((s) => {
        s.room.connected = true;
        s.room.statusText = `Local Tabs Room ${code}`;
      }, 'room_status', false);
      return;
    }

    this.peer = new window.Peer(undefined, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', () => {
      const conn = this.peer.connect(hostPeerId, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => {
        store.mutate((s) => {
          s.room.connected = true;
          s.room.statusText = `Connected to ${code}`;
        }, 'room_status', false);
        // Announce our player profile to Host
        conn.send({ type: 'player_update', payload: store.getLocalPlayer() });
        this.callbacks.onToast?.(`Joined live room ${code}!`);
      });
      conn.on('data', (msg) => {
        if (msg?.type === 'snapshot') {
          store.applySharedSnapshot(msg.payload);
        }
      });
      conn.on('close', () => {
        store.mutate((s) => {
          s.room.connected = false;
          s.room.statusText = `Disconnected from ${code} — retrying…`;
        }, 'room_status', false);
        this.reconnectTimer = setTimeout(() => {
          if (store.get().room.code === code && store.get().room.engine === 'peerjs') {
            this.joinPeerRoom(code);
          }
        }, 4500);
      });
      conn.on('error', (err) => {
        console.warn('Guest conn error:', err);
      });
    });

    this.peer.on('error', (err) => {
      store.mutate((s) => {
        s.room.statusText = `Could not reach ${code} (${err.type || 'error'})`;
      }, 'room_status', false);
    });
  }

  setupBroadcastChannel(code, isHost) {
    if (typeof BroadcastChannel === 'undefined') return;
    this.bc = new BroadcastChannel(`jetlag-syd-${cleanCode(code)}`);
    this.bc.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || msg.senderId === store.get().localPlayerId) return;
      if (msg.type === 'snapshot') {
        store.applySharedSnapshot(msg.payload);
      } else if (msg.type === 'player_update') {
        store.mutate((s) => {
          s.players[msg.payload.id] = msg.payload;
        }, 'remote_sync', false);
        if (isHost) this.broadcastSnapshotToPeers();
      } else if (msg.type === 'hello' && isHost) {
        this.bc.postMessage({ type: 'snapshot', senderId: store.get().localPlayerId, payload: store.getSharedSnapshot() });
      }
    };
    if (!isHost) {
      this.bc.postMessage({ type: 'hello', senderId: store.get().localPlayerId });
      this.bc.postMessage({ type: 'player_update', senderId: store.get().localPlayerId, payload: store.getLocalPlayer() });
    }
  }

  handleHostMessage(conn, msg) {
    if (!msg) return;
    if (msg.type === 'player_update' && msg.payload?.id) {
      store.mutate((s) => {
        s.players[msg.payload.id] = { ...(s.players[msg.payload.id] || {}), ...msg.payload, lastSeen: Date.now(), online: true };
      }, 'remote_sync', false);
      this.broadcastSnapshotToPeers(conn.peer);
    } else if (msg.type === 'snapshot' && msg.payload) {
      store.applySharedSnapshot(msg.payload);
      this.broadcastSnapshotToPeers(conn.peer);
    }
  }

  updateHostPeerCount() {
    const s = store.get();
    if (!s.room.isHost) return;
    store.mutate((st) => {
      st.room.statusText = `Hosting ${st.room.code} • ${this.guestConns.size} peer${this.guestConns.size === 1 ? '' : 's'}`;
    }, 'room_status', false);
  }

  // ===== ENGINE 2: TUNNEL-PROOF FIREBASE REALTIME DATABASE (REST + SSE) =====
  async connectFirebaseRoom(rawUrl, rawCode) {
    this.disconnect();
    const dbUrl = (rawUrl || '').trim().replace(/\/+$/, '');
    if (!dbUrl.startsWith('https://')) {
      this.callbacks.onToast?.('Please enter a valid https:// Firebase Realtime Database URL.');
      return;
    }
    const code = rawCode ? rawCode.toUpperCase().trim() : generateRoomCode();
    const roomPath = `${dbUrl}/jetlag_rooms/${cleanCode(code)}`;

    store.mutate((s) => {
      s.room.engine = 'firebase';
      s.room.firebaseUrl = dbUrl;
      s.room.code = code;
      s.room.isHost = false;
      s.room.connected = false;
      s.room.statusText = `Connecting Firebase ${code}…`;
    }, 'room_status', false);

    try {
      // Check if room exists; if not, seed it with current snapshot
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
      // Push our own player node separately to prevent race overwrites
      await this.pushFirebasePlayer(roomPath);

      // Open Server-Sent Events live stream (auto-reconnects through tunnels!)
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
                  if (pid !== s.localPlayerId) s.players[pid] = pdata;
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
          s.room.statusText = `Firebase Live • ${code}`;
        }, 'room_status', false);
      };
      es.onerror = () => {
        store.mutate((s) => {
          s.room.statusText = `Firebase reconnecting (${code})…`;
        }, 'room_status', false);
      };

      store.mutate((s) => {
        s.room.connected = true;
        s.room.statusText = `Firebase Live • ${code}`;
      }, 'room_status', false);
      this.callbacks.onToast?.(`Connected to Firebase room ${code}!`);
    } catch (err) {
      console.error('Firebase sync error:', err);
      store.mutate((s) => {
        s.room.connected = false;
        s.room.statusText = 'Firebase Error (check DB rules/URL)';
      }, 'room_status', false);
      this.callbacks.onToast?.('Firebase connection failed — ensure your RTDB URL is correct & read/write rules allow access.');
    }
  }

  async pushFirebasePlayer(roomPath) {
    const p = store.getLocalPlayer();
    if (!p) return;
    try {
      await fetch(`${roomPath}/players/${p.id}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      });
    } catch {}
  }

  // ===== BROADCAST SCHEDULER =====
  scheduleBroadcast(reason) {
    clearTimeout(this.pendingSyncTimer);
    const delay = reason === 'gps' ? 350 : 120;
    this.pendingSyncTimer = setTimeout(() => {
      const s = store.get();
      if (!s.room.connected) return;

      if (s.room.engine === 'firebase' && s.room.firebaseUrl) {
        const roomPath = `${s.room.firebaseUrl.replace(/\/+$/, '')}/jetlag_rooms/${cleanCode(s.room.code)}`;
        if (reason === 'gps') {
          this.pushFirebasePlayer(roomPath);
        } else {
          fetch(`${roomPath}/state.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(store.getSharedSnapshot())
          }).catch(() => {});
          this.pushFirebasePlayer(roomPath);
        }
        return;
      }

      // PeerJS + BroadcastChannel
      if (reason === 'gps') {
        const p = store.getLocalPlayer();
        if (s.room.isHost) {
          this.broadcastSnapshotToPeers();
        } else if (this.hostConn?.open) {
          this.hostConn.send({ type: 'player_update', payload: p });
        }
        this.bc?.postMessage({ type: 'player_update', senderId: s.localPlayerId, payload: p });
      } else {
        if (s.room.isHost) {
          this.broadcastSnapshotToPeers();
        } else if (this.hostConn?.open) {
          this.hostConn.send({ type: 'snapshot', payload: store.getSharedSnapshot() });
        }
        this.bc?.postMessage({ type: 'snapshot', senderId: s.localPlayerId, payload: store.getSharedSnapshot() });
      }
    }, delay);
  }

  broadcastSnapshotToPeers(excludePeerId = null) {
    const snap = store.getSharedSnapshot();
    for (const [pid, conn] of this.guestConns.entries()) {
      if (pid === excludePeerId) continue;
      if (conn.open) {
        try { conn.send({ type: 'snapshot', payload: snap }); } catch {}
      }
    }
    this.bc?.postMessage({ type: 'snapshot', senderId: store.get().localPlayerId, payload: snap });
  }

  // ===== LIVE GPS TRACKING =====
  startGps() {
    if (!navigator.geolocation) {
      this.callbacks.onToast?.('Geolocation is not supported by this browser.');
      return;
    }
    if (this.geoWatchId != null) return;

    store.mutate((s) => { s.room.shareGps = true; }, 'gps', false);

    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed } = pos.coords;
        store.mutate((s) => {
          const p = s.players[s.localPlayerId];
          if (!p) return;
          p.lat = latitude;
          p.lng = longitude;
          p.accuracy = accuracy;
          p.speed = speed;
          p.lastSeen = Date.now();
          p.online = true;
          // Auto-unfreeze if freeze timer expired
          if (p.gpsFrozen && s.room.freezeEndsAt && Date.now() > s.room.freezeEndsAt) {
            p.gpsFrozen = false;
            p.frozenLat = null;
            p.frozenLng = null;
          }
        }, 'gps', true);
        this.callbacks.onGpsUpdate?.(latitude, longitude, accuracy);
      },
      (err) => {
        console.warn('GPS error:', err);
        this.callbacks.onToast?.(`GPS unavailable (${err.message}). You can use Demo Pin to test anywhere in Sydney!`);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  stopGps() {
    if (this.geoWatchId != null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    store.mutate((s) => { s.room.shareGps = false; }, 'gps', false);
  }

  setSimulatedGps(lat, lng, label = '') {
    store.mutate((s) => {
      const p = s.players[s.localPlayerId];
      if (!p) return;
      p.lat = lat;
      p.lng = lng;
      p.accuracy = 15;
      p.lastSeen = Date.now();
      p.online = true;
    }, 'gps', true);
    if (label) this.callbacks.onToast?.(`Demo GPS positioned at ${label}`);
  }
}
