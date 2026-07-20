# Map Screen Fog of War — Design

**Date:** 2026-07-14
**Status:** Approved (base feature). Dynamic character-vision layer is explicitly deferred to a future iteration (see "Deferred" at the end).

## Goal

Add fog of war to the battlemap screen (`/map`), the second player-facing endpoint used for in-person play on a horizontal table TV. The DM paints a fog mask over the map from the DM Control Panel; players see it baked on top of the map. Fog state persists per map and is restored when the same map is re-added later — for both note-image maps and Hydrus maps (both are served by a deterministic `/vault/` path).

Today `map-screen/overview.md` lists "fog of war" as an explicit non-goal. This design removes that non-goal for the base mask feature.

## Approach (chosen)

**Single PNG mask rendered inside the map stage.**

One offscreen canvas at the map's natural aspect ratio (width `1024`, height `1024 × naturalH/naturalW`, matching the player-screen fog). Black opaque = hidden, transparent = revealed. Both editing tools — freehand brush and grid-cell — paint onto the *same* canvas, so there is a single representation to transmit and persist. The mask is broadcast as a data URL and the map client renders it as an `<img>` sibling of the map media **inside the transformed stage**, so it inherits pan, zoom, rotation, and physical scale automatically. TV-side opacity is applied via CSS from a configurable setting.

This mirrors the existing player-screen fog architecture (`fog-of-war/overview.md`) adapted to the `map` channel.

**Rejected alternative:** structured fog data (a set of revealed grid cells + vectorized freehand strokes) instead of a PNG. Smaller and resolution-independent, but mixing grid cells and freehand strokes in vector form is complex and forces client-side rasterization. The sidecar PNG is tiny when compressed and reuses the existing canvas pipeline.

## Design

### 1. Data model & storage

- **Mask:** offscreen canvas at map-natural aspect (`1024 × 1024·naturalH/naturalW`). Initial state for a brand-new map: **fully transparent (all revealed)** — the DM covers what should be hidden.
- **Sidecar file:** PNG at `.dm-screen/fog/<key>.png`, where `<key>` is a stable, filename-safe hash derived from the map's `/vault/` URL. Works identically for note images and Hydrus files (both resolve to deterministic `/vault/<path>` URLs; Hydrus paths are `.dm-screen/hydrus/<hash>.<ext>`).
- **Settings:** a global `mapFogTvOpacity` (default `1.0`) controls the fog opacity rendered on the table TV, adjustable in the settings UI. No per-map PNG is stored in `data.json`; only the sidecar holds pixels.

### 2. DM modal (`MapFogModal`)

- A **"Fog"** button appears in the Map Screen section of the DM Control Panel, enabled only while a map is active. It opens a large modal showing the map at a comfortable editing size.
- **Toolbar:** mode Reveal / Cover × brush Circle / Rectangle / Grid-cell, plus a brush-size slider and **Reveal All / Cover All** quick actions.
- **Grid-cell mode** uses the map's grid config (`pxPerSquare`, `gridOffsetX/Y`) to snap; click/drag paints whole aligned cells.
- Fog renders semi-transparent inside the modal so the DM sees the map underneath while drawing.
- Every `mouseup` that completes a draw re-encodes the canvas → writes the sidecar → broadcasts `map-fog`. Escape / closing the modal exits edit mode.

### 3. Map-client rendering (`src/map/map.ts`)

- On `map-fog`, validate `dataUrl` with `safePlayerUrl` (reject anything but `/vault/...` or `data:image/...`), then render an absolutely-positioned `<img>` sized 100%/100% as a **sibling of the map media inside the stage**, so it inherits the stage transform. Opacity = the payload's `opacity`.
- `map-clear` also clears the fog img.

### 4. Broadcast / IPC (channel `map`)

| Message | Direction | Payload | When |
|---|---|---|---|
| `map-fog` | DM → map | `{ dataUrl: string \| null, opacity: number }` | On map apply, on every completed edit, and in `republishToServer` |

`dataUrl: null` means "no fog" (clears any rendered fog img).

### 5. Persistence lifecycle

- **On map apply:** attempt to load `.dm-screen/fog/<key>.png` via `adapter.exists` + `adapter.readBinary` (the dotfolder-safe pattern already used by `server.ts` `readVaultBytes`, since Obsidian's vault index skips dotfolders). If present, that becomes the fog; otherwise a transparent canvas. Broadcast `map-fog`.
- **On every edit:** write the sidecar and broadcast.
- **`republishToServer()`:** re-broadcast `map-fog` (alongside the existing `map-show`/`map-config`/`map-view`/`map-aoe-sync`) so map screens connecting after a server restart reconstruct the fog.
- No note-vs-Hydrus branching: the stable `<key>` covers both sources uniformly.

### 6. Edge cases

- **Video maps:** the fog is a static overlay on top of the looping video; natural dimensions come from the video. No special handling.
- **Rotation / scale-mode change:** the fog img lives inside the transformed stage, so it transforms with the map; the mask is never re-encoded on transform changes.
- **Map without a configured grid:** grid-cell mode falls back to `mapDefaultPxPerSquare`.
- **Editing without a connected map screen:** allowed; edits still persist and broadcast (any late-joining screen picks them up via `republishToServer`).

### 7. Testing

- **Unit:** `<key>` derivation from a `/vault/` URL; sidecar load/write against a mocked adapter; grid-cell rect computation from grid config (pure math, no canvas — the JSDOM/vitest env has no real canvas, consistent with existing fog tests).
- **Visual (Playwright):** map-screen fog render (full fog, a revealed hole) under both physical and fit transforms, using deterministic mask PNGs generated in the harness (same technique as `test/visual/layers-fog.spec.ts`).

### 8. Specs to update (in the implementation PR)

- New `.agent/features/map-screen/fog-of-war.md` (EARS spec for the mask, tools, storage, broadcast, lifecycle).
- `.agent/features/map-screen/overview.md`: remove "fog of war" from the non-goals (line ~56), add a requirement pointing to `fog-of-war.md`, and add the `Fog` button to requirement 9's control list.
- `.agent/features/player-server/websocket-protocol.md`: add the `map-fog` message to the channel table.

## Deferred (future iteration — NOT part of this design)

Dynamic character-vision layer: feet-sized reveal shapes with a feathered (gradient-to-black) edge, a live-movable vision layer modeled on the AoE system, a "bake into mask" action, overlapping vision zones, and quick grid-rectangle room reveals. This is a separate feature (`map-vision`) to be brainstormed and specced on its own. The base mask designed here is its foundation.
