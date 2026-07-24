# Background Media

> Full-screen image or looping video rendered behind the image layers on the player screen. Sourced from the active note's frontmatter or note body (images only) and its `hydrus://` references (image or video) via the DM panel's Add BG button, or from the Hydrus library (image or video) via the BG from Hydrus modal.

## Source files

- `src/views/DmControlPanel.ts` — Add BG / Stop BG button, `showBackgroundPicker`, `setImageAsBackground`, `getImagesFromNote`, `collectHydrusRefEntries`, `applyHydrusRef`, `activeBackgroundUrl`, `activeVideoPath`, DM-side preview overlay rendered in `renderPlayerScreenSection`, `resolveBackgroundPreviewUrl`, `isVideoBackgroundUrl`
- `src/views/HydrusExplorerModal.ts` — `handleSetBackground` broadcasts the Hydrus-cached file as the background; loop and mute come from settings
- `src/hydrus/noteRefs.ts` — resolves and downloads the active note's `hydrus://` references for the Add BG picker (see `../hydrus-integration/note-references.md`)
- `src/player/player.ts` — `showBackgroundMedia` and `hideBackgroundMedia` handle the `<video>` and `<img>` elements
- `src/player/player.css` — `#video-background`, `#image-background` styling
- `src/server.ts` — `buildPlayerHtml` includes `<video id="video-background">` and `<img id="image-background">`
- `styles.css` — `.dm-preview-bg` overlay styling for the DM-side preview

## Settings used

- `hydrusDefaultLoop` — default `loop` flag for the `show-background-media` payload when pushed from the Hydrus modal
- `hydrusDefaultMuted` — default `muted` flag (videos autoplay only when muted)
- `cacheBaseFolder` — Hydrus-sourced backgrounds are persisted by `HydrusCache` at `<cacheBaseFolder>/hydrus/<hash>.<ext>` and served back over `/vault/`

## Requirements

1. The DM panel shall expose an Add BG button that opens the background picker, sourcing images from the active note and image/video `hydrus://` references in the active note.
2. When the active note has no image in its frontmatter or body and no Hydrus references, the Add BG button shall show a `No images found in note` Notice and do nothing.
3. When there is exactly one actionable source (one local image, or one available Hydrus reference) and no disabled references, the Add BG button shall apply it directly.
4. When there is more than one actionable source, or any unavailable (offline, uncached) Hydrus reference, the Add BG button shall open a context menu listing them all and apply the selected one.
5. The image picker shall recognise the `image` and `portrait` frontmatter keys (resolved as wikilinks) and `![[...]]` embedded images of types png, jpg, jpeg, webp, gif.
6. When an image is selected as background, the DM panel shall set `activeBackgroundUrl` to `/vault/<encoded-path>`, clear `activeVideoPath`, and broadcast `show-background-media` with `mediaType: "image"`.
7. When the Hydrus modal pushes a file as background, it shall set `activeBackgroundUrl` on the open DM panel and broadcast `show-background-media` with `mediaType` derived from MIME (`video/*` → `"video"`, otherwise `"image"`) and `loop` / `muted` from settings.
7b. When a Hydrus reference is selected as background from the Add BG picker, the DM panel shall download it to the cache if needed, set `activeBackgroundUrl` to `/vault/<encoded vaultPath>`, set `activeVideoPath` to the vault path for videos (else clear it), and broadcast `show-background-media` with the reference's media type and `loop` / `muted` from settings. The reference resolution and download are specified in `../hydrus-integration/note-references.md`.
8. While `activeBackgroundUrl` is non-null, the Add BG button shall render as Stop BG.
9. When the Stop BG button is clicked, the DM panel shall clear `activeBackgroundUrl` and `activeVideoPath`, broadcast `hide-background-media`, and re-render.
9b. When `republishToServer()` is called (on server start) and `activeBackgroundUrl` is non-null, the DM panel shall re-broadcast `show-background-media` so clients connecting after server start receive the current background without the DM re-selecting it.
10. When the player receives `show-background-media` with `mediaType: "video"`, it shall set `<video>.loop = payload.loop ?? true`, `<video>.muted = payload.muted ?? true`, set the `src`, show the video, hide the image, and call `play()`.
11. When the player receives `show-background-media` with `mediaType: "image"`, it shall pause and clear the video, hide it, set the image `src`, and show the image.
12. When the player receives `hide-background-media`, it shall pause and clear both `<video>` and `<img>` and hide both.
13. When the player receives `clear`, it shall additionally hide background media (the broader clear sequence is in `../player-server/websocket-protocol.md`).
14. While `activeBackgroundUrl` is non-null and a currently-connected client's dimensions match the effective resolution (the "selected client"), the DM preview shall render a background overlay inside that client's viewport rect — same geometry as the green `.dm-player-viewport-rect`, behind the image-layer rectangles (`z-index: 0`). The overlay uses `object-fit: cover` so the preview mirrors what the player browser shows.
15. The DM preview overlay shall resolve `/vault/<encoded path>` URLs to an `app://…` local resource via `vault.adapter.getResourcePath()`; non-`/vault/` URLs pass through unchanged; videos (extension `.mp4`, `.webm`, `.mov`, `.ogv`) render as `<video muted loop autoplay playsinline>`; everything else renders as `<img>`.
16. While no client is connected, or no connected client matches the effective resolution, the DM preview shall not render the background overlay.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `show-background-media` | DM → player | `{ url: string, mediaType: "image" \| "video", loop?: boolean, muted?: boolean }` | Add BG selects an image; Hydrus modal sets a file; server start via `republishToServer()` when a background is already loaded |
| `hide-background-media` | DM → player | `{}` | Stop BG button |

## Tests covering this

- `src/__tests__/server-broadcast.test.ts` — `show-background-media` is cached and replayed
- `src/__tests__/server-bootstrap.integration.test.ts` — wires the DM → player flow
- `src/__tests__/dm-preview-bg.test.ts` — `resolveBackgroundPreviewUrl` and `isVideoBackgroundUrl` helpers used by the DM-side preview overlay
- `test/visual/background.spec.ts` — Playwright visual regression: deterministic grid PNG broadcast via `show-background-media` is rendered by the real player bundle on `#image-background`.
- `test/e2e/specs/background.e2e.ts` — real Obsidian: Add BG from a note embed broadcasts `show-background-media`; Stop BG broadcasts `hide-background-media`

## Non-goals

- Mixing multiple background tracks. There is exactly one active background at a time.
- Setting video as background from the active note. Notes contribute images only; videos require the Hydrus path.
- Per-broadcast loop/mute toggles in the DM UI. These are configured once via Hydrus defaults; the Add BG button does not expose them.
- Cross-fade / transition effects between backgrounds. Swap is instantaneous.
- Sourcing backgrounds from the D&D Beyond integration. Monster avatars from D&D Beyond become image **layers**, not backgrounds (see `../dndbeyond-integration/monster-images.md`).
