# DM Preview

> A scaled, pannable, zoomable canvas in the DM Control Panel that mirrors what the player screen displays. The DM manipulates layers directly on the preview; pan and zoom are local to the DM and are not broadcast to players.

## Source files

- `src/views/DmControlPanel.ts` — `renderPlayerScreenSection` builds the preview area, `setupPreviewPanZoom` binds middle-click pan handlers (no wheel zoom — see `pan-zoom.md`), `resetDmView`, `getEffectiveResolution`, `getPlayerViewport`
- `src/player/player.ts` — `updateViewport` consumes `viewport-update` payloads (the player-side analogue to DM pan/zoom; currently used only via the broadcaster, not bound to a DM control)

## Settings used

- `tvWidth`, `tvHeight` — fallback resolution (1920×1080) used when no client is connected

## Requirements

1. The preview area shall have an aspect ratio equal to the effective resolution's `width / height`.
2. The effective resolution shall be the resolution of the selected connected client (set via the resolution badges in `../multi-screen/overview.md`), or the first connected client's resolution, or `(tvWidth, tvHeight)` as a fallback.
3. The preview's inner container shall apply `transform: translate(<dmPanX>%, <dmPanY>%) scale(<dmZoom>)`, where `dmZoom` defaults to `1`, `dmPanX` to `0`, and `dmPanY` to `0` on every open.
4. The preview shall render every image layer with its percentage geometry, sorted by `zIndex` ascending, with the colour-swatch border and label overlay used for DM affordance (one of eight rotating colours per layer index).
5. When a layer is hidden (`layer.visible === false`), the preview shall render it with `opacity: 0.25` and a dashed border.
6. Pan/zoom controls are specified in `pan-zoom.md`.
7. The green viewport indicator (when exactly one client is connected) is specified in `viewport-indicator.md`.
8. `render()` shall preserve the panel's scroll position across full rebuilds: the container's `scrollTop` is captured before emptying and re-applied after the rebuild (and once more on the next animation frame, since the map pan preview sizes itself a frame later).

## Tests covering this

- `src/__tests__/effective-resolution.test.ts` — `getEffectiveResolution` falls back through selected → first-client → settings
- `src/__tests__/viewport-calc.test.ts` — `getPlayerViewport` math used by fit / align buttons and the indicator

## Non-goals

- Broadcasting DM pan/zoom to players (DM pan/zoom is intentionally local).
- Multi-monitor DM view. Exactly one DM preview canvas.
- Animating DM pan/zoom transitions. Transforms apply immediately on each event.
- Per-layer rotation in the preview interaction. Rotation is handled via the rotation buttons in `../image-layers/layer-controls.md`; the preview just applies the resulting CSS transform.
