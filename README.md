# DM Screen

> Player screen for in-person D&D 5e sessions, powered by Obsidian.

![Player screen mid-session](docs/screenshots/player-screen-hero.png)

DM Screen turns Obsidian into a local control center for tabletop play: it serves a live player screen to any browser on your network — TV, tablet, second monitor — and pushes what your party should see while you keep your notes on the DM side.

Built for in-person 5e games where the DM wants a clean visual layer for the players (maps, portraits, video backgrounds, an initiative tracker) without leaving Obsidian.

![DM Control Panel](docs/screenshots/dm-control-panel.png)

## Features

- **Player screen on any device** — HTTP + WebSocket server. Open the URL on a TV, tablet, or second monitor; auto-reconnect handles bumps.
- **Image layers with per-layer fog of war** — stack maps and portraits, fog each layer independently, reveal as combat unfolds.
- **Background image or video** — full-screen scene from the active note, the Hydrus library, or a video loop.
- **Initiative tracker** — manual, synced from the Initiative Tracker plugin, or live from a D&D Beyond encounter.
- **Statblock display** — inline 5e statblocks via Fantasy Statblocks.
- **Multi-screen aware** — multiple connected players with per-client resolution detection.

![Fog of war on the DM preview](docs/screenshots/fog-of-war.png)

*Fog of war is drawn per layer with reveal / fog circle, rectangle, and freehand tools.*

## Quickstart

1. Install and enable the plugin (see [Installation](#installation)).
2. Open the **DM Control Panel** from the ribbon icon or the Command Palette ("Open DM Control Panel").
3. Click **Start Server**. The panel shows a LAN URL — open it on the device your players will look at.
4. Use **Add Image** to push images from the active note, **Add BG** to set a background, or **Image from Hydrus** to browse your Hydrus library.
5. In the COMBAT section, pick a source (Manual, Initiative Tracker plugin, or D&D Beyond) and start the encounter.

## Installation

### BRAT (recommended)

DM Screen is not yet listed in the Obsidian Community Plugins gallery. The easiest install path is [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT from Community Plugins.
2. Add this repository: `hbermu/obsidian-dm-screen`.
3. BRAT keeps you on the latest release automatically.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/hbermu/obsidian-dm-screen/releases) and drop them into `.obsidian/plugins/dm-screen/`.

## Integrations

### Hydrus Network

![Hydrus explorer modal](docs/screenshots/hydrus-explorer.png)

Browse a self-hosted [Hydrus](https://hydrusnetwork.github.io/hydrus/) media library by tags and push files to the player screen.

- Click **Image from Hydrus** in the DM Control Panel to open the explorer.
- A default click on a tile pushes the file as an image layer; shift-click sets it as the background.
- Videos can only be used as backgrounds — the tile's ⋮ menu also offers a "Set as background" option.
- Downloaded media is cached locally; the cache folder, retention, and tag filters are all configurable in settings.

### D&D Beyond

![D&D Beyond encounter sync](docs/screenshots/dndbeyond-encounter.png)

Sync live encounters from your [D&D Beyond](https://www.dndbeyond.com) account so the player screen reflects the real-time state of combat.

To set it up:

1. Enable D&D Beyond integration in settings.
2. Log in to [dndbeyond.com](https://www.dndbeyond.com) in your browser and copy your `CobaltSession` cookie (DevTools → Application → Cookies → dndbeyond.com).
3. Paste it into the settings field and click **Test connection**.
4. In the DM Control Panel's COMBAT section, switch to the **D&D Beyond** tab and pick an encounter. Initiative, HP, and monster avatars start streaming to the player screen automatically.

## Configuration

Open **Settings → DM Screen**. The tab is split into four sections — Server, Hydrus Library, D&D Beyond, and Advanced — each with inline descriptions for every option. Most defaults are fine for a first run; you only need to revisit settings when you plug in Hydrus or D&D Beyond.

## Compatible plugins

DM Screen integrates with two community plugins when they are installed and enabled:

- [Initiative Tracker](https://github.com/javalent/initiative-tracker) — auto-syncs combatants, HP, statuses, and rounds.
- [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) — inline 5e statblock display in the DM combat panel.

## Support & contributing

- Found a bug or want to request a feature? [Open an issue](https://github.com/hbermu/obsidian-dm-screen/issues).
- Contributing? Start with [AGENTS.md](AGENTS.md) for build, test, branch, and release conventions.

## License

[MIT](LICENSE)
