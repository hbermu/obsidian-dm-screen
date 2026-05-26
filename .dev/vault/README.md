# DM Screen — Dev Vault

This vault exists only to load the plugin during development.

## First run

1. `make up` in the parent dir.
2. Open `https://localhost:3001` and accept the self-signed cert.
3. In Obsidian: **Open another vault → Open folder as vault → `/vaults/dm-test`**.
4. If prompted, allow community plugins ("Turn on community plugins").
5. **Settings → Community plugins** should already list `Hot Reload` and `DM Screen`. Toggle them on.
6. Edit anything under `src/` on the host → the watcher rebuilds → Hot Reload swaps the plugin in place.

## Notes

- The DM Screen player server (`http://localhost:3000`) is published to the host.
  Start it from the DM Screen ribbon icon or the command palette inside Obsidian,
  then open `http://localhost:3000` in another browser tab to see the player view.
- Anything you write here is throwaway — `make clean` wipes it.
