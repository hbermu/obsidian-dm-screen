# DM Screen Plugin — Technical Reference

## Overview

Obsidian plugin for D&D 5e campaign management. Provides a WebSocket-based player screen server, multi-image layer compositing, initiative tracking, interactive Leaflet maps with faction zones, and encounter management.

**Runtime:** Obsidian desktop (Electron/Node.js)
**Build:** `npm run build` (esbuild) / `npm run deploy` (build + copy to vault) / `make build` (Docker, no host install)
**Dependencies:** `ws` (WebSocket server), `d3-delaunay` (Voronoi tessellation), Obsidian's `requestUrl` for the Hydrus client

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Obsidian (Electron)                                 │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ DM Control   │  │ POI        │  │ Encounter    │ │
│  │ Panel        │  │ Sidebar    │  │ Battlemap    │ │
│  │ (sidebar)    │  │ (sidebar)  │  │ Panel        │ │
│  └──────┬───────┘  └────────────┘  └──────────────┘ │
│         │                                           │
│  ┌──────┴───────┐                                   │
│  │ main.ts      │ ← Plugin core, event handling     │
│  │ (DmScreen    │                                   │
│  │  Plugin)     │                                   │
│  └──────┬───────┘                                   │
│         │                                           │
│  ┌──────┴───────┐     ┌─────────────────────┐       │
│  │ server.ts    │────→│ HTTP + WebSocket     │       │
│  │ (PlayerScreen│     │ Port (default 3000)  │       │
│  │  Server)     │     └──────────┬──────────┘       │
│  └──────────────┘                │                  │
└──────────────────────────────────┼──────────────────┘
                                   │ WebSocket JSON
                          ┌────────┴────────┐
                          │ Player Screen   │
                          │ (browser on TV) │
                          │ player.ts       │
                          └─────────────────┘
```

## Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/main.ts` | ~810 | Plugin entry point. View registration, commands, markdown post-processor, Initiative Tracker integration, faction zone calculation |
| `src/server.ts` | ~180 | HTTP server + WebSocket. Serves player HTML/JS/CSS, broadcasts messages, serves vault files via `/vault/*` |
| `src/settings.ts` | ~140 | Settings interface, defaults, and Obsidian settings tab |
| `src/types.ts` | ~120 | Shared TypeScript interfaces |
| `src/player/player.ts` | ~510 | Browser-side player screen. WebSocket client, Leaflet map, battlemap renderer, image layers, video background |
| `src/player/player.css` | ~370 | Player screen styling (dark D&D theme) |
| `src/player/VoronoiFactionLayer.ts` | ~120 | Voronoi tessellation for faction territory overlays on Leaflet maps |
| `src/views/DmControlPanel.ts` | ~810 | DM sidebar: server controls, image layers with drag/scale/rotate/visibility, initiative tracker |
| `src/views/PoiSidebar.ts` | ~330 | Context-aware POI list for current place/map note |
| `src/views/EncounterBattlemapPanel.ts` | ~290 | Encounter list from Initiative Tracker with battlemap assignment and launch |
| `src/views/StatblockPanel.ts` | ~170 | 5e statblock renderer for DM panel |
| `src/views/HydrusExplorerModal.ts` | ~330 | Hydrus library browser: search by tag, online/offline modes, click-to-cache, set as background or image layer |
| `src/hydrus/client.ts` | ~170 | Hydrus Client API wrapper (verifyAccess / searchFiles / getFileMetadata / getFileBytes / getThumbnailBytes) |
| `src/hydrus/cache.ts` | ~210 | Vault-side cache: downloads files + thumbnails, persists `index.json` sidecar, TTL sweep |
| `styles.css` | ~1100 | Obsidian-side UI styles (DM panel, Hydrus modal grid) |

## Build System

**esbuild.config.mjs** performs a two-stage build:

1. **Player screen bundle** — `src/player/player.ts` → IIFE bundle (standalone browser JS)
2. **Main plugin** — `src/main.ts` → CJS module. Player HTML/CSS/JS are inlined at build time via esbuild `define` globals

```bash
npm run dev      # watch mode
npm run build    # production build
npm run deploy   # build + copy main.js, manifest.json, styles.css → vault/.obsidian/plugins/dm-screen/
```

## WebSocket Message Protocol

All messages are JSON: `{ type: string, payload: Record<string, unknown> }`

| Message Type | Direction | Payload | Effect |
|---|---|---|---|
| `show-map` | DM → Player | `{ name, image, bounds, markers, factionZones, factionZoneOpacity, showFactionZones }` | Renders Leaflet map with image overlay, POI markers, Voronoi faction zones |
| `show-battlemap` | DM → Player | `{ name, image, gridSize, gridType, creatures }` | Displays battlemap with canvas grid overlay |
| `initiative-update` | DM → Player | `{ combatants, round }` | Updates initiative tracker sidebar (visible combatants only) |
| `set-mode` | DM → Player | `{ mode: "exploration" \| "combat" }` | Sets display mode without changing content |
| `image-layers-sync` | DM → Player | `{ layers: ImageLayer[] }` | Full sync of all image layers (position, scale, rotation, visibility) |
| `show-background-media` | DM → Player | `{ url, mediaType: "image" \| "video", loop?, muted? }` | Sets a full-screen background. Videos play looping (default), images swap into a fitted `<img>`. URL is served via the `/vault/` HTTP route |
| `hide-background-media` | DM → Player | `{}` | Stops and hides whichever background is showing |
| `show-video-bg` | DM → Player | `{ url }` | **Deprecated** alias for `show-background-media` with `mediaType: "video"` |
| `hide-video-bg` | DM → Player | `{}` | **Deprecated** alias for `hide-background-media` |
| `clear` | DM → Player | `{}` | Returns to waiting screen, clears all layers and background |

## Key Data Structures

### ImageLayer (`types.ts`)
```typescript
interface ImageLayer {
  id: string;        // unique ID (layer-{timestamp})
  label: string;     // display name
  dataUrl: string;   // base64 data URL of image
  x: number;         // x position (% of screen, can be negative)
  y: number;         // y position (% of screen, can be negative)
  width: number;     // width (% of screen, can exceed 100)
  height: number;    // height (% of screen, can exceed 100)
  zIndex: number;    // stacking order
  rotation: number;  // degrees
  visible: boolean;  // shown on player screen
}
```

### TrackerCombatant (`types.ts`)
```typescript
interface TrackerCombatant {
  name: string;
  displayName: string;
  initiative: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  active: boolean;    // current turn
  hidden: boolean;    // DM-only (not sent to player)
  friendly: boolean;
  isPlayer: boolean;
  statuses: string[];
  statblock: StatblockCreature | null;
  source: "manual" | "tracker-plugin";
}
```

### FactionZone (`main.ts`)
```typescript
interface FactionZone {
  name: string;       // faction name
  color: string;      // hex color from faction note frontmatter
  points: number[][]; // [[y, x], ...] settlement locations in Leaflet CRS.Simple
}
```

## Plugin Integration Points

### Initiative Tracker (Javalent)
- **Listens to:** `initiative-tracker:save-state` → syncs combatants to DM panel + player screen
- **Listens to:** `initiative-tracker:stop-viewing`, `initiative-tracker:unloaded` → disconnects
- **Triggers:** `initiative-tracker:start-encounter` → launches encounter from Encounter Battlemap panel
- **Data access:** Reads `itPlugin.data.encounters` for encounter list

### Fantasy Statblocks
- **Access:** `window.FantasyStatblocks.getCreatureFromBestiary(name)` → looks up statblock for DM panel display
- **Caching:** Results cached in `statblockCache` Map on the plugin instance

## Obsidian Views

| View Type ID | Class | Icon | Purpose |
|---|---|---|---|
| `dm-control-panel` | DmControlPanel | monitor | Main DM interface: server, image layers, initiative |
| `poi-sidebar` | PoiSidebar | map-pin | Context-aware POI list for active place/map |
| `encounter-battlemap-panel` | EncounterBattlemapPanel | swords | Encounter list with battlemap mapping |

Open via Command Palette: "Open DM Control Panel", "Open POI Sidebar", "Open Encounter Battlemaps"

## Frontmatter Fields Used

### Map notes (`type: map`)
```yaml
type: map
place: "[[PlaceName]]"       # linked place
cssclasses: [dm-map-layout]  # split layout CSS
```
Leaflet config is in a `leaflet` code block (not frontmatter).

### Place notes (`type: place`)
```yaml
type: place
name: "Name"
place-type: city | castle | village | town | building | dungeon | wilderness
parent: "[[ParentPlace]]"
faction: "[[FactionName]]"
location: [lat, lng]          # Leaflet CRS.Simple coords (y, x)
mapmarker: city | castle | village | town | building | dungeon | npc | quest | poi
map-image: "path/to/map.jpg" # for Leaflet map display
image: "path/to/image.jpg"   # for image layer push
player-visible: true | false
tags: [place, map/parent-name]
```

### Person notes (`type: person`)
```yaml
type: person
name: "Name"
portrait: "[[image.jpg]]"
image: "path/to/image.jpg"   # for image layer push (centered portrait size)
cssclasses: [dm-person-layout]
player-visible: true | false
```

### Encounter notes (`type: encounter`)
```yaml
type: encounter
battlemap: "path/to/battlemap.jpg"
grid-size: 5
grid-type: square | hex
creatures:
  - name: "Goblin"
    count: 3
    hp: 7
    ac: 15
    initiative-mod: 2
```

### Faction notes (`type: faction`)
```yaml
type: faction
name: "FactionName"
color: "#hex"                 # used for Voronoi zone fill and map markers
tags: [faction, calradia]
```

## Image Layer System

The DM can push multiple images to the player screen and control them independently:

1. **Add images** — "Add Current Note Image" reads all image fields (`map-image`, `battlemap`, `image`) and adds them as hidden layers
2. **Visibility** — Eye toggle (👁) shows/hides each layer on the player screen
3. **Position** — Drag rectangles in the preview area (percentage-based, maps to TV resolution)
4. **Scale** — Slider from 10% to 500%. Images can exceed screen bounds for pan-and-reveal
5. **Rotation** — ↺/↻ buttons rotate in 15° steps
6. **Z-order** — ▲/▼ buttons change stacking order
7. **Background media** — A full-screen still image or looping video sits behind all layers, served via the `/vault/` HTTP route (not base64). Sources: vault `.webm`/`.mp4` files via the **Video BG** picker, or any Hydrus file via **Hydrus Source** (see below).

Shift+Arrow keys on the scale slider snap to nearest 10% increment.

## Hydrus Library Integration

The plugin can browse a self-hosted [Hydrus Network](https://hydrusnetwork.github.io/hydrus/) instance from the DM panel and pull tagged media into the vault on demand. Useful when your scene library lives outside the vault (e.g. an indexed Czepeku catalogue) and you want tag-based search instead of folders.

### Workflow
1. Enable Hydrus in **Settings → DM Screen → Hydrus Library**, set the API URL + key, and hit **Test connection**.
2. In the DM Control Panel, click **Hydrus Source** to open the explorer modal.
3. Search by tags (space-separated). Tiles are tagged `R` (remote, not yet downloaded) or `L` (already cached locally).
4. **Click a tile** — downloads the binary + a JPEG thumbnail to the vault cache (if remote) and pushes it as the player background. Image MIME → `mediaType: "image"`, video MIME → `mediaType: "video"`.
5. **Shift-click a tile** — downloads it (if remote) and adds it to the DM Control Panel as an image layer (still images only).
6. **⋮ menu** per tile — view tags, copy vault path (local only), evict from cache.
7. If Hydrus is unreachable when the modal opens, a yellow banner appears and the grid falls back to whatever lives in the cache (search filters on each entry's stored `knownTags`).

### Cache behaviour
- Files land at `<vault>/<cacheFolder>/<sha256>.<ext>` plus a sibling `<sha256>.thumb.jpg`.
- A sidecar `index.json` tracks `downloadedAt`, `lastUsedAt`, mime, dimensions, and known tags.
- `lastUsedAt` is **only** bumped when the file is used as background or added as a layer — appearing in a search result does not count.
- Files unused for `hydrusCacheTtlDays` (default 30) are deleted on plugin load and on a 24-hour timer thereafter.
- Settings → DM Screen → **Clear Hydrus cache** wipes everything in the cache folder.

### Network path
The plugin calls Hydrus from Electron via `requestUrl()` (no CORS, API key never reaches the player browser). The cluster manifest in `k3s/qol/hydrus.yaml` exposes the Client API at `https://hydrus-api.int.hbermu.com` for LAN clients. The player browser still only ever talks to the plugin's own HTTP server on `localhost:3000`, fetching the cached file via `/vault/<cacheFolder>/<hash>.<ext>`.

## HTTP Server Routes

| Route | Method | Response |
|---|---|---|
| `/` | GET | Player screen HTML (inlined CSS/JS) |
| `/player.js` | GET | Player screen JavaScript bundle |
| `/player.css` | GET | Player screen stylesheet |
| `/health` | GET | JSON status: `{ status, clients }` |
| `/vault/{path}` | GET | Serves any vault file (images, videos) with proper MIME type and caching |

## Player Screen Rendering

The player screen (`player.ts`) runs in any browser (typically a TV). It connects via WebSocket and renders content in layers:

1. **Video background** (`z-index: 0`) — Optional looping video
2. **Map/Battlemap content** — Leaflet map or battlemap with grid
3. **Image layers container** (`z-index: 500`) — Composited images from DM
4. **Initiative tracker** (`z-index: 1000`) — Combat initiative list (top-right)

### Map Rendering
- Uses Leaflet with `CRS.Simple` (pixel coordinates)
- Image overlay from base64 data URL
- POI markers with emoji icons and labels
- Voronoi faction zone polygons with toggle control and legend

### Battlemap Rendering
- Full-screen image with canvas grid overlay (square or hex)
- Grid auto-scales to image dimensions
- Initiative tracker visible in combat mode

## Coordinate System

Maps use Leaflet's CRS.Simple where coordinates are `[lat, lng]` = `[y, x]` in pixel space.

Image layers use percentage-based positioning relative to the viewport:
- `x: 0, y: 0` = top-left corner
- `width: 100, height: 100` = full screen
- Values can be negative (offscreen) or >100 (oversized for panning)
- `object-fit: cover` ensures the image fills the specified area

## Settings (`DmScreenSettings`)

| Setting | Default | Purpose |
|---|---|---|
| `serverPort` | 3000 | HTTP/WebSocket server port |
| `autoStartServer` | false | Start server on Obsidian load |
| `gridColor` | #ffffff | Battlemap grid line color |
| `gridOpacity` | 0.3 | Grid line opacity |
| `tvWidth` | 1920 | Player screen width (for preview aspect ratio) |
| `tvHeight` | 1080 | Player screen height |
| `factionZoneOpacity` | 0.2 | Voronoi zone fill opacity |
| `showFactionZonesByDefault` | true | Auto-show faction zones on map load |
| `encounterBattlemaps` | {} | Map of encounter name → battlemap vault path |
| `hydrusEnabled` | false | Master switch for Hydrus integration (also gates the **Hydrus Source** button) |
| `hydrusApiUrl` | `https://hydrus-api.int.hbermu.com` | Base URL of the Hydrus Client API (no trailing slash) |
| `hydrusApiKey` | "" | 64-hex `Hydrus-Client-API-Access-Key`, kept locally |
| `hydrusTagService` | `A.I. Tags` | Name of the Hydrus tag service used to scope `knownTags` |
| `hydrusCacheFolder` | `.hydrus-cache` | Vault-relative folder where downloaded files live |
| `hydrusCacheTtlDays` | 30 | Days of `lastUsedAt` inactivity before a cached file is swept |
| `hydrusDefaultLoop` | true | Default `loop` flag on `show-background-media` |
| `hydrusDefaultMuted` | true | Default `muted` flag on `show-background-media` (videos autoplay only when muted) |
