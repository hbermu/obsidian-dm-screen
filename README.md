# DM Screen

Campaign management plugin for [Obsidian](https://obsidian.md). Run D&D 5e sessions with an interactive player screen served over your local network, initiative tracking, image layer compositing, fog of war, and integrations with Hydrus Network and D&D Beyond.

## Features

- **Player Screen** — A web-based display served via HTTP/WebSocket (default port 3000). Open it in any browser on your TV, tablet, or second monitor. Includes a fullscreen toggle button for kiosk-style use.
- **Interactive Maps** — Push Leaflet-based maps with POI markers and Voronoi faction zones to the player screen.
- **Image Layers** — Stack, position, scale, and rotate multiple images with gold-bordered frames. Per-layer fog of war with circle, rectangle, and pen drawing tools.
- **Initiative Tracker** — Manual combatant management ("Local Track") or auto-sync with [Initiative Tracker](https://github.com/javalent/initiative-tracker) plugin. Shows HP bars, AC, status effects, and inline statblocks.
- **D&D Beyond Integration** — Sync encounters from your D&D Beyond account. Polls initiative, character HP, and manual entries in real time. Broadcasts sorted combatant list with active turn highlighting. Configurable PC HP visibility (numbers + condition or condition only).
- **Hydrus Network Integration** — Browse a self-hosted [Hydrus](https://hydrusnetwork.github.io/hydrus/) library by tags. Download and cache media on demand for use as backgrounds or image layers.
- **Background Media** — Set full-screen images or looping videos as the player screen background.
- **Encounter Battlemaps** — Map encounters to battlemap images. Auto-loads when combat starts.
- **Multi-Screen Support** — Track all connected player screens with per-client resolution display. Viewport indicator shown when a single screen is connected.
- **DM Preview** — Pan and zoom the DM-side preview independently of the player view.

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
4. Navigate to a map note in your vault and click **Push Map** to send it to the player screen

## Configuration

All settings are in **Settings > DM Screen**:

| Section | Key Settings |
|---------|-------------|
| Server | Port, auto-start on launch |
| Display | TV resolution, grid color/opacity |
| Faction Zones | Zone opacity, show by default |
| Hydrus | API URL, API key, tag services, cache folder, TTL |
| D&D Beyond | Enable, CobaltSession cookie, connection test |

## D&D Beyond Setup

1. Enable "D&D Beyond integration" in settings
2. Log in to [dndbeyond.com](https://www.dndbeyond.com) in your browser
3. Copy your `CobaltSession` cookie (DevTools > Application > Cookies > dndbeyond.com)
4. Paste it in the "CobaltSession cookie" field
5. Click "Test connection" to verify
6. In Combat mode, switch to the **D&D Beyond** tab and select an encounter

The player screen displays combatants sorted by initiative with active turn highlighted. PCs show health as a condition word (Well, Hurt, Bloodied, Down) and optionally exact HP numbers. Monsters and manual entries show condition only.

## Player Screen

The player screen renders in any modern browser. Features:

- **Fullscreen button** (top-right corner) — tap to hide browser chrome on tablets
- **Gold-bordered image layers** — all pushed images have a consistent framed look
- **Active turn highlight** — gold border on the current combatant during combat
- **Auto-reconnect** — reconnects to the DM server if the connection drops

### Protocol

The DM broadcasts JSON messages over WebSocket:

| Type | Purpose |
|------|---------|
| `show-map` | Leaflet map with POIs and faction zones |
| `show-battlemap` | Battlemap with grid overlay |
| `image-layers-sync` | Multi-layer image compositing |
| `initiative-update` | Combat initiative list |
| `show-background-media` | Full-screen image or video |
| `viewport-update` | Pan/zoom control |
| `set-mode` | Exploration or combat mode |

## Plugin Integrations

| Plugin | Integration |
|--------|-------------|
| [Initiative Tracker](https://github.com/javalent/initiative-tracker) | Auto-syncs combatants, HP, and statuses when an encounter runs |
| [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) | Inline statblock display for creatures in the DM panel |

## Development

Requires Docker. No Node.js on the host.

```bash
make dev         # esbuild watcher
make up          # Obsidian GUI at https://localhost:3001 + watcher
make typecheck   # tsc --noEmit
make test        # vitest run
make build       # production bundle
```

## License

[MIT](LICENSE)
