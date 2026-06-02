# Background Media

> Full-screen image or looping video rendered behind the image layers on the player screen. Sourced from the active note's frontmatter or note body (images only) via the DM panel's Add BG button, or from the Hydrus library (image or video) via the BG from Hydrus modal.

## Source files

- `src/views/DmControlPanel.ts` — Add BG / Stop BG button, `showBackgroundPicker`, `setImageAsBackground`, `getImagesFromNote`, `activeBackgroundUrl`, `activeVideoPath`
- `src/views/HydrusExplorerModal.ts` — `handleSetBackground` broadcasts the Hydrus-cached file as the background; loop and mute come from settings
- `src/player/player.ts` — `showBackgroundMedia` and `hideBackgroundMedia` handle the `<video>` and `<img>` elements
- `src/player/player.css` — `#video-background`, `#image-background` styling
- `src/server.ts` — `buildPlayerHtml` includes `<video id="video-background">` and `<img id="image-background">`

## Settings used

- `hydrusDefaultLoop` — default `loop` flag for the `show-background-media` payload when pushed from the Hydrus modal
- `hydrusDefaultMuted` — default `muted` flag (videos autoplay only when muted)
- `cacheBaseFolder` — Hydrus-sourced backgrounds are persisted by `HydrusCache` at `<cacheBaseFolder>/hydrus/<hash>.<ext>` and served back over `/vault/`

## Requirements

1. The DM panel shall expose an Add BG button that opens the background picker, sourcing images from the active note.
2. When the active note has no image in its frontmatter or body, the Add BG button shall show a `No images found in note` Notice and do nothing.
3. When the active note has a single image, the Add BG button shall set that image as the background directly.
4. When the active note has multiple images, the Add BG button shall open a context menu listing them and apply the selected one.
5. The image picker shall recognise the `image` and `portrait` frontmatter keys (resolved as wikilinks) and `![[...]]` embedded images of types png, jpg, jpeg, webp, gif.
6. When an image is selected as background, the DM panel shall set `activeBackgroundUrl` to `/vault/<encoded-path>`, clear `activeVideoPath`, and broadcast `show-background-media` with `mediaType: "image"`.
7. When the Hydrus modal pushes a file as background, it shall set `activeBackgroundUrl` on the open DM panel and broadcast `show-background-media` with `mediaType` derived from MIME (`video/*` → `"video"`, otherwise `"image"`) and `loop` / `muted` from settings.
8. While `activeBackgroundUrl` is non-null, the Add BG button shall render as Stop BG.
9. When the Stop BG button is clicked, the DM panel shall clear `activeBackgroundUrl` and `activeVideoPath`, broadcast `hide-background-media`, and re-render.
10. When the player receives `show-background-media` with `mediaType: "video"`, it shall set `<video>.loop = payload.loop ?? true`, `<video>.muted = payload.muted ?? true`, set the `src`, show the video, hide the image, and call `play()`.
11. When the player receives `show-background-media` with `mediaType: "image"`, it shall pause and clear the video, hide it, set the image `src`, and show the image.
12. When the player receives `hide-background-media`, it shall pause and clear both `<video>` and `<img>` and hide both.
13. When the player receives `clear`, it shall additionally hide background media (the broader clear sequence is in `../player-server/websocket-protocol.md`).

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `show-background-media` | DM → player | `{ url: string, mediaType: "image" \| "video", loop?: boolean, muted?: boolean }` | Add BG selects an image; Hydrus modal sets a file |
| `hide-background-media` | DM → player | `{}` | Stop BG button |

## Tests covering this

- `src/__tests__/server-broadcast.test.ts` — `show-background-media` is cached and replayed
- `src/__tests__/server-bootstrap.integration.test.ts` — wires the DM → player flow

## Non-goals

- Mixing multiple background tracks. There is exactly one active background at a time.
- Setting video as background from the active note. Notes contribute images only; videos require the Hydrus path.
- Per-broadcast loop/mute toggles in the DM UI. These are configured once via Hydrus defaults; the Add BG button does not expose them.
- Cross-fade / transition effects between backgrounds. Swap is instantaneous.
- Sourcing backgrounds from the D&D Beyond integration. Monster avatars from D&D Beyond become image **layers**, not backgrounds (see `../dndbeyond-integration/monster-images.md`).
