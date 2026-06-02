# DM Screen

Campaign management plugin for [Obsidian](https://obsidian.md). Run D&D 5e sessions with a player screen served over your local network, initiative tracking, image layer compositing with per-layer fog of war, and integrations with Hydrus Network and D&D Beyond.

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

- Stack multiple images on the player screen with independent position, scale, rotation, and z-order
- Drag layers in the DM preview to reposition; resize with a per-layer scale slider (Shift+Arrow snaps to 10%)
- Per-layer buttons: visibility toggle, fog toggle, gold-border toggle, rotate ±15°, raise/lower, remove
- Fit-to-viewport (W / H) and align (◀ ◆ ▶) buttons that snap a layer to the connected player's viewport
- **Fog of War** with six drawing tools (per layer):
  - Reveal circle, rectangle, and freehand eraser
  - Fog circle, rectangle, and freehand pen
  - Hold Shift to keep drawing after release
- Fog state persists across broadcasts, plugin reloads, and player reconnections
- Gold-bordered frames on the player screen (toggle off per layer for borderless images)
- "Clear All Layers" wipes the DM layer stack; "Clear Player Screen" also resets background and broadcast cache

### Background Media

- Full-screen image or looping video as player background
- Image backgrounds source from the active note's frontmatter (`image`, `portrait`) or embedded images
- Video and image backgrounds also source from the Hydrus library via the **BG from Hydrus** explorer
- Loop and mute flags come from the Hydrus default settings; videos autoplay only when muted
- "Stop BG" button on the DM panel clears the background

### Combat & Initiative Tracking

- **Three sources**: manual entry, Initiative Tracker plugin sync, or D&D Beyond — selected via tabs in the COMBAT section
- **Manual tracking** — add combatants with name/init/HP, edit HP per row, advance turn, reset round, clear all
- **Initiative Tracker plugin sync** — auto-imports combatants, HP, AC, statuses, friendly/PC flags, and round from the [Initiative Tracker](https://github.com/javalent/initiative-tracker) plugin via its `save-state` event
- **D&D Beyond sync** — poll a chosen encounter for live initiative/HP/manual entries (see D&D Beyond section below)
- Hidden combatants are filtered out of the broadcast (including PCs marked hidden in a D&D Beyond encounter)
- Round-1 reveal: combatants whose turn has not happened yet stay hidden until their initiative comes up
- Active turn highlighted with gold border on the player screen; the tracker auto-scrolls to keep the active combatant visible
- HP shown to players as condition words (Well, Hurt, Bloodied, Down); allies' numeric HP is shown when enabled
- Adjustable tracker scale with `−`, `1×`, `+` buttons (persists across sessions)
- Global "stop broadcasting combat" button in the COMBAT header

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
- Encounter browser with search; click a row to open the encounter in your browser
- Real-time polling — initiative, character HP, monsters, and manual entries update live
- Hidden players (marked as not participating in the encounter) are filtered out before broadcast and from the DM panel
- Monster avatars downloaded once, cached on disk, and added as hidden image layers; identical monsters dedupe to a single layer
- PC HP visibility toggle: show numbers + condition, or condition only
- Broadcasts sorted combatant list with active turn highlighting and round-1 reveal

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

## Commands

| Command | What it does |
|---------|--------------|
| Open DM Control Panel | Opens the main DM view (server controls, player screen preview, combat tracker) |
| Toggle Player Screen Server | Start/stop the HTTP + WebSocket server |

There is also a "DM Screen" ribbon icon that opens the DM Control Panel.

## Quick Start

1. Enable the plugin and open the **DM Control Panel** (Command Palette > "Open DM Control Panel")
2. Click **Start Server** — the player screen is now available at `http://<your-ip>:3000`
3. Open that URL on your TV, tablet, or second monitor
4. Use **Add Image** to push layers from the active note, **Add BG** to set a background, or **BG from Hydrus** to browse the Hydrus library

## Configuration

All settings are in **Settings > DM Screen**:

| Section | Key Settings |
|---------|-------------|
| Server | Port, auto-start, max connected clients |
| Hydrus Library | Enable, API URL, API key (with test), tag services (multi-select), cache folder/TTL, default loop/mute, default search tags, ignored tag regex patterns, clear cache |
| D&D Beyond | Enable, CobaltSession cookie, open dndbeyond.com, test connection |
| Advanced | Debug mode (verbose console logging) |

## D&D Beyond Setup

1. Enable "D&D Beyond integration" in settings
2. Log in to [dndbeyond.com](https://www.dndbeyond.com) in your browser
3. Copy your `CobaltSession` cookie (DevTools > Application > Cookies > dndbeyond.com)
4. Paste it in the "CobaltSession cookie" field
5. Click "Test connection" to verify
6. In the DM Control Panel's COMBAT section, switch to the **D&D Beyond** tab and click an encounter to start polling

## Player Screen

The player screen renders in any modern browser. Features:

- **Fullscreen button** (top-right corner) — tap to hide browser chrome on tablets/TVs
- **Gold-bordered image layers** — consistent framed look for all pushed images
- **Active turn highlight** — gold border on the current combatant during combat
- **Auto-reconnect** — reconnects to the DM server if the connection drops
- **Responsive layout** — adapts to the connected display resolution

### WebSocket Protocol

The DM broadcasts JSON messages over WebSocket:

| Type | Direction | Purpose |
|------|-----------|---------|
| `show-background-media` | DM → player | Full-screen image or video background (`url`, `mediaType`, `loop`, `muted`) |
| `hide-background-media` | DM → player | Clear background |
| `image-layers-sync` | DM → player | Layer stack with position, scale, rotation, visibility, border, fog data |
| `initiative-update` | DM → player | Initiative list with HP/condition, statuses, active turn, round number |
| `combat-scale` | DM → player | Initiative tracker zoom factor on the player screen |
| `viewport-update` | DM → player | Pan/zoom synchronization for the layer container |
| `clear` | DM → player | Reset all player screen content and clear the late-joiner cache |
| `client-info` | player → DM | Client reports screen dimensions and devicePixelRatio |

The server caches the last message of each type (except `clear`) and replays it to clients that connect after the broadcast, so a player joining mid-session gets the current scene immediately. The cache is also persisted to disk so it survives Obsidian restarts.

## Development

Requires Docker. No Node.js on the host.

```bash
make dev         # esbuild watcher
make up          # Obsidian GUI at https://localhost:3001 + watcher
make typecheck   # tsc --noEmit
make test        # vitest run (unit + integration)
make test-watch  # vitest in watch mode
make build       # production bundle
make down        # stop containers
make clean       # remove build artefacts
```

### Tests

The Vitest suite mixes unit tests with integration tests that boot a real `PlayerScreenServer`, connect real `ws` clients, replay sanitized D&D Beyond fixtures (`test/fixtures/ddb/`), and smoke-test the bundled `main.js`. Everything runs under `make test`.

### Contributing & AI agents

Behavioural specifications for every feature live under [`.agent/features/<feature>/`](.agent/features/) and are the canonical reference for what each subsystem must do. Start with [`AGENTS.md`](AGENTS.md) at the repo root for general conventions, then read the relevant feature spec before modifying any subsystem. See [`.agent/conventions.md`](.agent/conventions.md) for the spec format and the update rule (behaviour change → spec change, same commit).

## License

[MIT](LICENSE)
