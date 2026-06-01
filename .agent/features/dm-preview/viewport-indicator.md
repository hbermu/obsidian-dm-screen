# Viewport Indicator

> A green rectangle drawn on top of the DM preview to show the DM what region of the layered scene is visible on the player screen. Only shown when exactly one player client is connected; with zero or multiple clients the indicator is hidden.

## Source files

- `src/views/DmControlPanel.ts` — viewport rect element built inside `renderPlayerScreenSection`, math drawn from `getPlayerViewport` and the connected-client's aspect ratio

## Settings used

- `none`

## Requirements

1. If the connected-client count is not exactly one, then the DM panel shall not render the viewport indicator.
2. While exactly one client is connected and its `width > 0` and `height > 0`, the DM panel shall render a `.dm-player-viewport-rect` div inside the preview's inner container.
3. The indicator's width and height shall be computed from the ratio of `clientAspect = clientWidth / clientHeight` to `previewAspect = effectiveWidth / effectiveHeight`, scaled by `1 / playerZoom`:
   - If `clientAspect > previewAspect`: `vpW = 100 / playerZoom`, `vpH = (100 / playerZoom) * (previewAspect / clientAspect)`.
   - Otherwise: `vpW = (100 / playerZoom) * (clientAspect / previewAspect)`, `vpH = 100 / playerZoom`.
4. The indicator's position shall be `vpX = -playerPanX + (100 - vpW) / 2`, `vpY = -playerPanY + (100 - vpH) / 2`.
5. The indicator's border width shall scale with the DM zoom so it stays visually prominent at low zoom: `borderWidth = (2 + 4 * (1 - dmZoom)) / dmZoom` pixels, clamped via the `1 - dmZoom` factor to `[0, 1]`.
6. The indicator's background opacity shall scale similarly: `rgba(0, 255, 0, 0.02 + 0.2 * (1 - dmZoom))`.

## Tests covering this

- `src/__tests__/viewport-calc.test.ts` — the geometry math used here is the same `getPlayerViewport` helper exercised in that test

## Non-goals

- Drawing per-client viewport indicators when multiple clients are connected (they may all have different aspect ratios; the visual would be confusing).
- Click-to-pan on the indicator. The indicator is purely visual; player pan/zoom is currently set programmatically via `broadcastPlayerViewport` and not from a DM control.
