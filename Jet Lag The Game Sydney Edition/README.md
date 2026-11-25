# Jet Lag: Sydney Edition

A mobile-first, real-world transit game companion built for **Jet Lag: The Game**-style games across the **entire Greater Sydney & NSW Intercity network** — designed to host directly on **GitHub Pages** with **zero build step**.

## Features

- **Real-World Accurate Sydney Transit Map (OpenStreetMap ODbL data)**
  - **Sydney Trains** (`T1`–`T9`), **Sydney Metro** (`M1` Tallawong ↔ Bankstown), **Light Rail** (`L1`–`L4` including Parramatta Light Rail), **Sydney Ferries** (`F1`–`F10`), and **NSW Intercity** (`BMT` Blue Mountains, `CCN` Central Coast & Newcastle, `SCO` South Coast, `SHL` Southern Highlands, `HUN` Hunter).
  - Exact GPS coordinates for ~380+ stations, tram stops & ferry wharves and stitched real-world track/harbour geometries.
  - 5 watermark-free base maps (**Dark Street**, **Minimal Dark**, **Day Street (OSM)**, **Outdoor Light** for bright sun, and **Esri Satellite**), instant fuzzy station search, and one-click line isolation.
- **Jet Lag Strategy Map Tools (Synced Live)**
  - **Radar Circles** (`HIT` inverted elimination mask shading everything outside red, `MISS` shading inside red, or neutral reference).
  - **Thermometer Perpendicular Bisector** — tap Start A & End B to automatically shade the colder half-plane across Sydney.
  - **Distance & Transit Ruler**, **Custom Polygon Zone Shader**, **Tactical Pins**, Undo/Clear, and Team-Only vs Room-Wide scopes.
- **Flexible Multi-Mode Game Engine**
  - **Hide + Seek Sydney**: Hiding zone circle, auto-masked Hider GPS, full Question Deck (Radar, Thermometer, Matching, Measuring, Tentacles, Photo) & live Q&A log.
  - **Tag Across Sydney**: Runner vs Chasers, coins, live per-minute Transit Coin Burner, Catching Radius ring, and configurable radiating Win Sectors.
  - **Rail Rush Sydney**: Claim stations by tap or GPS Proximity Check-In, track line completion bars across all 29 lines, and earn line-completion bonus points.
  - **Capture the Flag**: Sydney Harbour / Parramatta River dividing line presets, live player territory detection, and drop/carry/capture flag tracking.
  - **Race Across Sydney**: Curated Sydney & Intercity checkpoint presets or custom station routes with live split timestamps.
  - **Custom / Sandbox Mode**: Independently toggle any rule module on/off to invent your own house games.
- **Tactile Challenge & Curse Randomizer Wheel + Custom Deck Builder**
  - Physics-driven HTML5 Canvas spinning wheel with synth tick audio & confetti.
  - 36 original Sydney challenges + 12 Jet Lag curses out of the box.
  - Full custom card editor, active toggles, and JSON Export/Import.
- **Real-Time Multiplayer & Live Location Sharing (GitHub Pages Friendly)**
  - **Instant Zero-Setup Rooms (PeerJS WebRTC)**: Create a `SYD-XXXX` room code with scannable QR code & shareable `?room=` URL — works immediately with no accounts.
  - **Optional Tunnel-Proof Firebase Realtime Database**: Plug in a free Firebase RTDB URL for instant Server-Sent Events sync that survives locked phone screens and Sydney Metro / City Circle train tunnels.
  - **Live Activity Feed & Compressed Photo Proofs**: Snap proof photos straight from your phone camera (compressed client-side to ~30 KB JPEG).
- **Installable PWA with Offline / Tunnel Caching**
  - Add to Home Screen on iOS/Android; Service Worker caches the app shell, complete Sydney network geometry, and viewed map tiles.

---

## Deploying to GitHub Pages (2 Minutes)

1. Create a new GitHub repository (e.g. `jet-lag-sydney`).
2. Upload/push all files from this folder to the `main` branch.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`, select `main` and `/ (root)`, then click **Save**.
5. After ~30 seconds your site will be live at `https://<your-username>.github.io/jet-lag-sydney/`!

---

## Optional: Tunnel-Proof Firebase Realtime Database Setup (Free)

PeerJS rooms work out-of-the-box with zero accounts, but if you want rock-solid sync through Sydney Metro underground tunnels and locked phone screens:

1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and create a free Spark project.
2. Click **Build → Realtime Database → Create Database** (pick **Singapore `asia-southeast1`** for lowest Sydney latency, start in **Test Mode**).
3. Copy the database URL (looks like `https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app`).
4. In the app, open the **📡 Live** tab → **Firebase Realtime DB** section → paste the URL, pick a Room Code, and click **Connect Firebase Room**.
5. Share the generated invite link or QR code with friends — it automatically includes the room code & database URL!

---

## Data Attribution

Transit station coordinates and track/ferry route geometries are derived from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Base map tiles courtesy of CARTO, OpenStreetMap, and Esri.
