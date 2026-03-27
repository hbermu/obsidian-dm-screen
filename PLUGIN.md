# DM Screen Plugin — Technical Reference

## Overview

Obsidian plugin for D&D 5e campaign management. Provides a WebSocket-based player screen server, multi-image layer compositing with per-layer fog of war, initiative tracking, interactive Leaflet maps with faction zones, DM preview with pan/zoom, and encounter management.

**Runtime:** Obsidian desktop (Electron/Node.js)
**Build:** `npm run build` (esbuild) / `npm run deploy` (build + copy to vault)
**Dependencies:** `ws` (WebSocket server), `d3-delaunay` (Voronoi tessellation)

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
                                   │ (bidirectional)
                          ┌────────┴────────┐
                          │ Player Screen   │
                          │ (browser on TV) │
                          │ player.ts       │
                          └─────────────────┘
```

## Source Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Plugin entry point. View registration, commands, markdown post-processor, Initiative Tracker integration, faction zone calculation, fog of war broadcast |
| `src/server.ts` | HTTP server + WebSocket. Serves player HTML/JS/CSS, broadcasts messages, serves vault files via `/vault/*`, caches state for late-joining clients, forwards client-info from browsers |
| `src/settings.ts` | Settings interface, defaults, Obsidian settings tab, `FogRegion` type, persisted state fields |
| `src/types.ts` | Shared TypeScript interfaces (`ImageLayer`, `TrackerCombatant`, `StatblockCreature`, etc.) |
| `src/player/player.ts` | Browser-side player screen. WebSocket client, Leaflet map, battlemap renderer, image layers with fog overlay, video background, viewport updates, sends client-info back to server |
| `src/player/player.css` | Player screen styling (dark D&D theme) |
| `src/player/VoronoiFactionLayer.ts` | Voronoi tessellation for faction territory overlays on Leaflet maps |
| `src/views/DmControlPanel.ts` | DM sidebar: server controls, unified player screen section with preview, image layers with drag/scale/rotate/visibility, per-layer fog of war drawing, DM preview pan/zoom, player viewport indicator, initiative tracker |
| `src/views/PoiSidebar.ts` | Context-aware POI list for current place/map note |
| `src/views/EncounterBattlemapPanel.ts` | Encounter list from Initiative Tracker with battlemap assignment and launch |
| `src/views/StatblockPanel.ts` | 5e statblock renderer for DM panel |
| `styles.css` | Obsidian-side UI styles |

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

### DM → Player (server broadcasts)

| Message Type | Payload | Effect |
|---|---|---|
| `show-map` | `{ name, image, bounds, markers, factionZones, factionZoneOpacity, showFactionZones, fogOfWar, fogRevealed }` | Renders Leaflet map with image overlay, POI markers, Voronoi faction zones, optional fog of war overlay |
| `show-battlemap` | `{ name, image, gridSize, gridType, creatures }` | Displays battlemap with canvas grid overlay |
| `initiative-update` | `{ combatants, round }` | Updates initiative tracker sidebar (visible combatants only) |
| `set-mode` | `{ mode: "exploration" \| "combat" }` | Sets display mode without changing content |
| `image-layers-sync` | `{ layers: ImageLayer[] }` | Full sync of all image layers (position, scale, rotation, visibility, fog) |
| `show-video-bg` | `{ url }` | Plays looping video background (served via `/vault/` HTTP route) |
| `hide-video-bg` | `{}` | Stops and hides video background |
| `fog-update` | `{ revealed: FogRegion[] }` | Updates map-level fog of war revealed regions |
| `viewport-update` | `{ panX, panY, zoom }` | Updates player screen viewport pan/zoom |
| `clear` | `{}` | Returns to waiting screen, clears all layers and video |

### Player → Server (client messages)

| Message Type | Payload | Effect |
|---|---|---|
| `client-info` | `{ width, height, devicePixelRatio }` | Browser reports viewport dimensions on connect and resize. Forwarded to DM Control Panel for preview aspect ratio and viewport indicator |

### State Caching

The server caches the last broadcast of each message type. When a new browser connects, all cached state is replayed immediately so late-joining clients see the current state. `clear` wipes the cache.

## Key Data Structures

### ImageLayer (`types.ts`)
```typescript
interface ImageLayer {
  id: string;          // unique ID (layer-{timestamp})
  label: string;       // display name
  dataUrl: string;     // base64 data URL of image
  x: number;           // x position (% of screen, can be negative)
  y: number;           // y position (% of screen, can be negative)
  width: number;       // width (% of screen, can exceed 100)
  height: number;      // height (% of screen, can exceed 100)
  zIndex: number;      // stacking order
  rotation: number;    // degrees
  visible: boolean;    // shown on player screen
  fogEnabled: boolean; // per-layer fog of war active
  fogDataUrl: string;  // PNG data URL of fog canvas (black = fogged, transparent = revealed)
}
```

Image dimensions are calculated from the image's natural pixel size relative to the configured TV resolution. A 3840x2160 image on a 1920x1080 TV becomes 200% width x 200% height. Images are not cropped or stretched.

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

### FogRegion (`settings.ts`)
```typescript
interface FogRegion {
  x: number;      // map coordinate
  y: number;      // map coordinate
  w: number;      // width in map coordinates
  h: number;      // height in map coordinates
}
```

## Plugin Integration Points

### Initiative Tracker (Javalent)
- **Listens to:** `initiative-tracker:save-state` → syncs combatants to DM panel + player screen
- **Listens to:** `initiative-tracker:stop-viewing`, `initiative-tracker:unloaded` → disconnects
- **Triggers:** `initiative-tracker:start-encounter` → launches encounter from Encounter Battlemap panel
- **Data access:** Reads `itPlugin.data.encounters` for encounter list
- **Battlemap auto-add:** When an encounter starts (round ≤ 1) and has a mapped battlemap, it is added as a **hidden** image layer. The DM toggles visibility when ready to reveal it to players.

### Fantasy Statblocks
- **Access:** `window.FantasyStatblocks.getCreatureFromBestiary(name)` → looks up statblock for DM panel display
- **Caching:** Results cached in `statblockCache` Map on the plugin instance

## Obsidian Views

| View Type ID | Class | Icon | Purpose |
|---|---|---|---|
| `dm-control-panel` | DmControlPanel | monitor | Main DM interface: server, player screen preview, image layers, fog of war, initiative |
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
Leaflet config is in a `leaflet` code block (not frontmatter). The plugin parses the leaflet block as a fallback to extract `image` and `bounds` when the linked place file doesn't have `map-image`.

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
map-note: "[[MapNoteName]]"  # link to the map note that renders this place
image: "path/to/image.jpg"   # for image layer push
fogOfWar: true | false        # enables map-level fog of war when pushed
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

## Player Screen Section (DM Control Panel)

The unified "Player Screen" section in the DM Control Panel provides:

### Image Layers
1. **Add Image** — If the current note has one image, adds it directly. If multiple, shows a picker menu. Images from frontmatter fields (`map-image`, `battlemap`, `image`, `portrait`) and embedded images (`![[image.ext]]`) are detected.
2. **Visibility** — Eye toggle shows/hides each layer on the player screen
3. **Position** — Drag rectangles in the preview area (percentage-based)
4. **Scale** — Slider from 10% to 500%. Shift+Arrow keys snap to nearest 10%
5. **Rotation** — ↺/↻ buttons rotate in 15° steps
6. **Z-order** — ▲/▼ buttons change stacking order
7. **Video background** — Loops `.webm`/`.mp4` files behind all layers (served via HTTP)

### Per-Layer Fog of War
Each image layer has a cloud icon toggle to enable fog of war:

1. **Enable** — Click cloud icon. Entire image is covered in black fog.
2. **Drawing tools** — 6 tools appear in the layer list:
   - **Reveal tools** (outlined icons): Circle, Rectangle, Eraser — remove fog
   - **Fog tools** (filled icons): Circle, Rectangle, Pen — add fog back
3. **Drawing** — Click a tool, then draw on the image in the preview. Mouse up completes the operation and exits draw mode.
4. **Shift+draw** — Hold Shift while releasing mouse to stay in draw mode for multiple operations.
5. **Esc** — Cancel draw mode
6. **Fog data** — Stored as PNG data URL on the `ImageLayer`, sent to player screen as an overlay image on top of the layer.

The fog canvas resolution is 1024px wide, height scaled to match image aspect ratio.

### DM Preview Pan/Zoom
The preview area supports local pan/zoom that does NOT affect the player screen:

- **Scroll wheel** — Zoom in/out (DM only)
- **Middle-click drag** — Pan (DM only)
- **Reset View** button — Returns to 100% zoom at player viewport position
- **Green dashed rectangle** — Shows the actual player browser viewport, using the connected browser's aspect ratio. Border and fill become more prominent as you zoom out further.

### State Persistence
Image layers, player screen dimensions, and server broadcast cache are saved to plugin settings. On Obsidian reload, layers restore and late-joining browsers receive cached state.

## HTTP Server Routes

| Route | Method | Response |
|---|---|---|
| `/` | GET | Player screen HTML (inlined CSS/JS, loads Leaflet from CDN) |
| `/player.js` | GET | Player screen JavaScript bundle |
| `/player.css` | GET | Player screen stylesheet |
| `/health` | GET | JSON status: `{ status, clients }` |
| `/vault/{path}` | GET | Serves any vault file (images, videos) with proper MIME type and caching |

## Player Screen Rendering

The player screen (`player.ts`) runs in any browser (typically a TV). It connects via WebSocket, sends its viewport dimensions, and renders content in layers:

1. **Video background** (`z-index: 0`) — Optional looping video
2. **Map/Battlemap content** — Leaflet map or battlemap with grid
3. **Image layers container** (`z-index: 500`) — Composited images from DM, each with optional fog overlay. Inner container supports DM-controlled pan/zoom via `viewport-update`.
4. **Initiative tracker** (`z-index: 1000`) — Combat initiative list (top-right)

### Map Rendering
- Uses Leaflet with `CRS.Simple` (pixel coordinates)
- Image overlay from base64 data URL
- POI markers with emoji icons and labels
- Voronoi faction zone polygons with toggle control and legend
- Optional SVG fog of war overlay (map-level, from `fogOfWar` frontmatter)

### Battlemap Rendering
- Full-screen image with canvas grid overlay (square or hex)
- Grid auto-scales to image dimensions
- Initiative tracker visible in combat mode

### Image Layer Rendering
- Each layer wrapped in a positioned div with the image and optional fog overlay
- Fog overlay is a PNG image rendered on top of the layer image
- All layers sit inside a pannable/zoomable inner container

## Coordinate System

Maps use Leaflet's CRS.Simple where coordinates are `[lat, lng]` = `[y, x]` in pixel space.

Image layers use percentage-based positioning relative to the viewport:
- `x: 0, y: 0` = top-left corner
- `width: 100, height: 100` = full screen
- Values can be negative (offscreen) or >100 (oversized for panning)
- Dimensions are calculated from image natural pixels vs TV resolution

## Settings (`DmScreenSettings`)

| Setting | Default | Purpose |
|---|---|---|
| `serverPort` | 3000 | HTTP/WebSocket server port |
| `autoStartServer` | false | Start server on Obsidian load |
| `gridColor` | #ffffff | Battlemap grid line color |
| `gridOpacity` | 0.3 | Grid line opacity |
| `tvWidth` | 1920 | Player screen width (for preview aspect ratio and image sizing) |
| `tvHeight` | 1080 | Player screen height |
| `factionZoneOpacity` | 0.2 | Voronoi zone fill opacity |
| `showFactionZonesByDefault` | true | Auto-show faction zones on map load |
| `encounterBattlemaps` | {} | Map of encounter name → battlemap vault path |
| `fogOfWarState` | {} | Map of map name → revealed `FogRegion[]` (map-level fog persistence) |
| `lastPlayerScreenWidth` | 0 | Persisted player screen width from last connected browser |
| `lastPlayerScreenHeight` | 0 | Persisted player screen height from last connected browser |
| `lastImageLayers` | "[]" | JSON-serialized `ImageLayer[]` for state persistence |
| `lastBroadcastCache` | {} | Cached server broadcasts for late-joining clients |
