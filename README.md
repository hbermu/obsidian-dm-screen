# DM Screen

Campaign management plugin for [Obsidian](https://obsidian.md). Run D&D 5e sessions with an interactive player screen served over your local network, initiative tracking, image layer compositing, fog of war, and integrations with Hydrus Network and D&D Beyond.

## Features

### Player Screen Server

- Web-based display served via HTTP + WebSocket (default port 3000)
- Open in any browser on your TV, tablet, or second monitor
- Auto-start on Obsidian launch (optional)
- Configurable max client connections (default 10)
- Late-joiner state caching — new clients receive the current scene immediately
- LAN URL auto-discovery for easy sharing
- Health check endpoint (`/health`)

### Image Layers & Fog of War

- Stack, position, scale, and rotate multiple images
- Per-layer controls: visibility, z-order, label
- Drag handles for position and size adjustment in DM preview
- **Fog of War** with six drawing tools:
  - Reveal circle, rectangle, and freehand eraser
  - Fog circle, rectangle, and freehand pen
- Fog state persists across broadcasts and reconnections
- Gold-bordered frames on the player screen

### Interactive Maps

- Push Leaflet-based maps with POI markers to the player screen
- Voronoi faction zones with configurable opacity
- Map breadcrumb navigation
- POI sidebar for quick location reference

### Background Media

- Full-screen images or looping videos as player background
- Media controls: loop toggle, mute toggle (videos autoplay muted)
- Source from vault files, Hydrus library, or D&D Beyond artwork

### Combat & Initiative Tracking

- **Two modes**: Exploration (map/media focus) and Combat (initiative + battlemap)
- **Manual tracking** — add/remove combatants, edit HP, AC, initiative, statuses, advance turns
- **Initiative Tracker plugin sync** — auto-imports combatants, HP, statuses, and round from the [Initiative Tracker](https://github.com/javalent/initiative-tracker) plugin
- Combatant properties: name, HP/maxHP/tempHP, AC, initiative, statuses, hidden, friendly, player character flag
- Hidden combatants filtered from player screen automatically
- Active turn highlighting with gold border on player screen
- HP shown as condition words to players (Well, Hurt, Bloodied, Down)

### Encounter Battlemaps

- Map encounter names to battlemap images in settings
- Auto-loads the associated battlemap when combat starts (round 1)
- Encounter Battlemaps panel: browse encounters, see creature tables (name, CR, AC, HP, initiative mod)
- One-click launch: push battlemap + start initiative in a single action

### Battlemap Grid

- Dynamic grid overlay on battlemaps
- Grid types: square and hexagonal
- Configurable grid color and opacity

### Statblock Display

- Inline 5e statblock panel in the DM combat view
- Expands per-creature: stats, abilities, traits, actions, reactions, legendary actions
- Data sourced from [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) bestiary
- Name-based lookup with fallback (e.g., "Goblin 3" resolves to "Goblin")
- Statblock cache for instant repeated lookups

### Multi-Screen Support

- Tracks all connected player screens with per-client resolution display
- Viewport indicator shown on the DM preview when a single screen is connected
- Pan and zoom DM preview independently of the player view
- Resolution-aware viewport calculations

### DM Preview

- Real-time preview of what the player screen displays
- Independent pan and zoom
- Layer manipulation directly on the preview canvas

## Integrations

### Hydrus Network

Browse a self-hosted [Hydrus](https://hydrusnetwork.github.io/hydrus/) media library by tags and use files as backgrounds or image layers.

- Hydrus Client API connectivity with connection testing
- Tag service discovery and multi-service selection
- Regex-based tag filtering (hide unwanted tag namespaces)
- Local file cache with configurable folder and TTL (default 30 days)
- Default loop/mute settings for video media

### D&D Beyond

Sync encounters from your [D&D Beyond](https://www.dndbeyond.com) account for live combat sessions.

- CobaltSession cookie authentication with validation
- Encounter browser with search
- Real-time polling — initiative, character HP, and manual entries update live
- Monster image caching for fast statblock display
- PC HP visibility options: numbers + condition, or condition only
- Broadcasts sorted combatant list with active turn highlighting

### Obsidian Plugin Integrations

| Plugin | Integration |
|--------|-------------|
| [Initiative Tracker](https://github.com/javalent/initiative-tracker) | Auto-syncs combatants, HP, statuses, and rounds when an encounter runs |
| [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) | Inline statblock display for creatures in the DM combat panel |

## Installation

### BRAT (beta releases)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Add this repo URL: `hbermu/obsidian-dm-screen`
3. BRAT will notify you of new releases automatically

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/hbermu/obsidian-dm-screen/releases) and place them in `.obsidian/plugins/dm-screen/`.

## Quick Start

1. Enable the plugin and open the **DM Control Panel** (Command Palette > "Open DM Control Panel")
2. Click **Start Server** — the player screen is now available at `http://<your-ip>:3000`
3. Open that URL on your TV, tablet, or second monitor
4. Push a map, image layers, or background media to the player screen from the DM panel

## Configuration

All settings are in **Settings > DM Screen**:

| Section | Key Settings |
|---------|-------------|
| Server | Port, auto-start, max connected clients |
| Combat Grid | Grid color, opacity |
| Hydrus Library | Enable, API URL, API key, tag services, cache folder/TTL, ignored patterns |
| D&D Beyond | Enable, CobaltSession cookie, connection test |
| Advanced | Debug mode (verbose console logging) |

## D&D Beyond Setup

1. Enable "D&D Beyond integration" in settings
2. Log in to [dndbeyond.com](https://www.dndbeyond.com) in your browser
3. Copy your `CobaltSession` cookie (DevTools > Application > Cookies > dndbeyond.com)
4. Paste it in the "CobaltSession cookie" field
5. Click "Test connection" to verify
6. In Combat mode, switch to the **D&D Beyond** tab and select an encounter

## Player Screen

The player screen renders in any modern browser. Features:

- **Fullscreen button** (top-right corner) — tap to hide browser chrome on tablets/TVs
- **Gold-bordered image layers** — consistent framed look for all pushed images
- **Active turn highlight** — gold border on the current combatant during combat
- **Auto-reconnect** — reconnects to the DM server if the connection drops
- **Responsive layout** — adapts to the connected display resolution

### WebSocket Protocol

The DM broadcasts JSON messages over WebSocket:

| Type | Purpose |
|------|---------|
| `show-background-media` | Full-screen image or video background |
| `hide-background-media` | Clear background |
| `image-layers-sync` | Multi-layer image compositing with fog state |
| `initiative-update` | Combat initiative list with HP, statuses, active turn |
| `viewport-update` | Pan/zoom synchronization |
| `set-mode` | Switch between exploration and combat display |
| `clear` | Reset all player screen content |
| `client-info` | Client reports screen dimensions to DM |

## Development

Requires Docker. No Node.js on the host.

```bash
make dev         # esbuild watcher
make up          # Obsidian GUI at https://localhost:3001 + watcher
make typecheck   # tsc --noEmit
make test        # vitest run
make test-watch  # vitest in watch mode
make build       # production bundle
make down        # stop containers
make clean       # remove build artefacts
```

## License

[MIT](LICENSE)
