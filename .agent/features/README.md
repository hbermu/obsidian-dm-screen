# Feature specs

Each row points to a directory under `features/` containing one or more spec files. Start with `overview.md`; read sub-spec files when your change touches that sub-functionality.

| Feature | Purpose | Sub-spec files |
|---------|---------|----------------|
| [`player-server/`](player-server/overview.md) | HTTP + WebSocket server that hosts the player screen and serves vault assets | `websocket-protocol.md`, `vault-routing.md` |
| [`image-layers/`](image-layers/overview.md) | Multi-image overlay system pushed to player screens | `layer-controls.md`, `persistence.md` |
| [`fog-of-war/`](fog-of-war/overview.md) | Per-layer fog drawing with reveal/fog tools | `drawing-tools.md` |
| [`background-media/`](background-media/overview.md) | Full-screen image or video background on the player screen | — |
| [`combat-tracker/`](combat-tracker/overview.md) | Three-source initiative tracker (manual, Initiative Tracker plugin, D&D Beyond) | `manual-mode.md`, `initiative-tracker-sync.md`, `round-1-reveal.md` |
| [`dm-preview/`](dm-preview/overview.md) | Local preview of the player screen with independent pan and zoom | `pan-zoom.md`, `viewport-indicator.md` |
| [`multi-screen/`](multi-screen/overview.md) | Tracking and resolution selection across connected player screens | — |
| [`hydrus-integration/`](hydrus-integration/overview.md) | Browse a Hydrus library and use files as backgrounds or layers | `connection-and-services.md`, `explorer.md`, `search.md`, `tag-suggester.md`, `cache.md`, `note-references.md` |
| [`dndbeyond-integration/`](dndbeyond-integration/overview.md) | Poll a D&D Beyond encounter for live combat sync | `auth.md`, `poller.md`, `encounters-and-tracking.md`, `monster-images.md` |
| [`statblock-display/`](statblock-display/overview.md) | Inline 5e statblock panel in the DM view | — |
| [`webhook-send/`](webhook-send/overview.md) | Send an image layer to a configured webhook (Telegram, Discord, generic multipart) | `send-modal.md`, `webhook-config.md` |

## Adding a new feature

1. Copy `_template.md` to `<new-feature>/overview.md`.
2. Fill in all mandatory sections (see `../conventions.md`).
3. Add a row to this table.
4. Cross-link from any related feature whose `Non-goals` should reference the new one.
