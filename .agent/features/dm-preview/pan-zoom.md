# DM Preview Pan & Zoom

> Local-only navigation of the DM preview canvas. Middle-click drag = pan, slider + Reset View button drive the zoom. Not broadcast to players.

## Source files

- `src/views/DmControlPanel.ts` — `setupPreviewPanZoom`, `resetDmView`, the zoom slider and Reset View button in `dm-preview-view-controls`

## Settings used

- `none` (DM zoom/pan are not persisted)

## Requirements

1. The preview area shall NOT bind the mouse wheel: scrolling over it propagates so the surrounding panel can scroll normally. Zoom is driven exclusively by the zoom slider and the Reset View button.
2. When the user mousedown-middle-clicks the preview area, the panel shall start a pan: subsequent mousemove events (anywhere on the document) shall update `dmPanX` and `dmPanY` proportionally to the cursor delta over the preview's bounds.
3. When the middle mouse button is released, the panel shall stop the pan.
4. The Reset View button shall set `dmZoom = 1`, `dmPanX = 0`, `dmPanY = 0`, and re-render.
5. The zoom slider shall have range `10`–`500` and step `1`; changing it shall set `dmZoom = value / 100` and re-apply the inner transform without re-rendering the full panel.
6. The zoom label shall display the current zoom as `Math.round(dmZoom * 100)%`.

## Non-goals

- Wheel-driven zoom. Removed because it swallowed page scroll whenever the cursor was over the preview.
- Touch / trackpad pinch zoom.
- Left-click drag pan (left click is reserved for layer drag).
- Persisting DM pan/zoom across opens.
- Animating to the new zoom (snap immediately).
- Broadcasting DM pan/zoom to players. The player has its own `viewport-update` mechanism, but it is not driven from this control.
