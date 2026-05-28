import { describe, expect, it } from "vitest";

/**
 * Duplicates the getPlayerViewport logic from DmControlPanel for unit testing.
 * The original is a private method tied to Obsidian's ItemView; testing the
 * math independently ensures correctness without mocking the full plugin.
 */
function getPlayerViewport(params: {
  playerScreenWidth: number;
  playerScreenHeight: number;
  tvWidth: number;
  tvHeight: number;
  playerZoom: number;
  playerPanX: number;
  playerPanY: number;
}): { vpW: number; vpH: number; vpX: number; vpY: number } | null {
  const { playerScreenWidth, playerScreenHeight, tvWidth, tvHeight, playerZoom, playerPanX, playerPanY } = params;
  if (playerScreenWidth <= 0) return null;

  const browserAspect = playerScreenWidth / playerScreenHeight;
  const previewAspect = tvWidth / tvHeight;
  let vpW: number, vpH: number;
  if (browserAspect > previewAspect) {
    vpW = 100 / playerZoom;
    vpH = (100 / playerZoom) * (previewAspect / browserAspect);
  } else {
    vpW = (100 / playerZoom) * (browserAspect / previewAspect);
    vpH = 100 / playerZoom;
  }
  const vpX = -playerPanX + (100 - vpW) / 2;
  const vpY = -playerPanY + (100 - vpH) / 2;
  return { vpW, vpH, vpX, vpY };
}

describe("getPlayerViewport", () => {
  const base = {
    playerScreenWidth: 1920,
    playerScreenHeight: 1080,
    tvWidth: 1920,
    tvHeight: 1080,
    playerZoom: 1,
    playerPanX: 0,
    playerPanY: 0,
  };

  it("returns null when player width is 0", () => {
    expect(getPlayerViewport({ ...base, playerScreenWidth: 0 })).toBeNull();
  });

  it("16:9 TV with 16:9 player at zoom 1 covers the full 100%", () => {
    const vp = getPlayerViewport(base)!;
    expect(vp.vpW).toBeCloseTo(100);
    expect(vp.vpH).toBeCloseTo(100);
    expect(vp.vpX).toBeCloseTo(0);
    expect(vp.vpY).toBeCloseTo(0);
  });

  it("zoom 2 halves the viewport dimensions", () => {
    const vp = getPlayerViewport({ ...base, playerZoom: 2 })!;
    expect(vp.vpW).toBeCloseTo(50);
    expect(vp.vpH).toBeCloseTo(50);
    expect(vp.vpX).toBeCloseTo(25);
    expect(vp.vpY).toBeCloseTo(25);
  });

  it("panning shifts the viewport origin", () => {
    const vp = getPlayerViewport({ ...base, playerPanX: 10, playerPanY: 5 })!;
    expect(vp.vpX).toBeCloseTo(-10);
    expect(vp.vpY).toBeCloseTo(-5);
  });

  it("wider browser (21:9) on 16:9 TV: full width, reduced height", () => {
    const vp = getPlayerViewport({
      ...base,
      playerScreenWidth: 2560,
      playerScreenHeight: 1080,
    })!;
    // Browser is wider: vpW = 100, vpH < 100
    expect(vp.vpW).toBeCloseTo(100);
    expect(vp.vpH).toBeLessThan(100);
    // 16:9 / 21:9 = (16/9) / (2560/1080) = 1.778 / 2.370 ≈ 0.75
    expect(vp.vpH).toBeCloseTo(100 * (1920 / 1080) / (2560 / 1080));
  });

  it("taller browser (4:3) on 16:9 TV: full height, reduced width", () => {
    const vp = getPlayerViewport({
      ...base,
      playerScreenWidth: 1024,
      playerScreenHeight: 768,
    })!;
    // Browser is taller: vpH = 100, vpW < 100
    expect(vp.vpH).toBeCloseTo(100);
    expect(vp.vpW).toBeLessThan(100);
    // (4/3) / (16/9) = 1.333 / 1.778 ≈ 0.75
    expect(vp.vpW).toBeCloseTo(100 * (1024 / 768) / (1920 / 1080));
  });

  it("zoom + pan combines correctly", () => {
    const vp = getPlayerViewport({
      ...base,
      playerZoom: 2,
      playerPanX: 10,
      playerPanY: -5,
    })!;
    expect(vp.vpW).toBeCloseTo(50);
    expect(vp.vpH).toBeCloseTo(50);
    // vpX = -panX + (100 - vpW) / 2 = -10 + 25 = 15
    expect(vp.vpX).toBeCloseTo(15);
    // vpY = -panY + (100 - vpH) / 2 = 5 + 25 = 30
    expect(vp.vpY).toBeCloseTo(30);
  });

  it("non-standard TV resolution (2560x1440) with matching browser", () => {
    const vp = getPlayerViewport({
      ...base,
      tvWidth: 2560,
      tvHeight: 1440,
      playerScreenWidth: 2560,
      playerScreenHeight: 1440,
    })!;
    expect(vp.vpW).toBeCloseTo(100);
    expect(vp.vpH).toBeCloseTo(100);
  });
});
