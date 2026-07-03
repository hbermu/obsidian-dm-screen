import { describe, expect, it } from "vitest";
import {
  clampPan,
  cssPixelsPerInch,
  defaultMapState,
  gridLinePositions,
  mapScale,
  mapTranslation,
  profileKey,
  DEFAULT_PX_PER_SQUARE,
  FALLBACK_PPI,
} from "../map/transform";

describe("profileKey", () => {
  it("encodes resolution and devicePixelRatio", () => {
    expect(profileKey(1920, 1080, 1)).toBe("1920x1080@1");
    expect(profileKey(3840, 2160, 1.5)).toBe("3840x2160@1.5");
  });
});

describe("cssPixelsPerInch", () => {
  it("computes density from the screen diagonal", () => {
    // 43" 1080p TV: hypot(1920,1080) = 2202.9 px / 43" = 51.23 px/inch
    const ppi = cssPixelsPerInch(1920, 1080, { diagonalInches: 43, fineTune: 1 });
    expect(ppi).toBeCloseTo(51.23, 1);
  });

  it("applies the fine-tune multiplier", () => {
    const base = cssPixelsPerInch(1920, 1080, { diagonalInches: 43, fineTune: 1 });
    const tuned = cssPixelsPerInch(1920, 1080, { diagonalInches: 43, fineTune: 1.02 });
    expect(tuned).toBeCloseTo(base * 1.02, 6);
  });

  it("falls back to 96 without a profile or with a zero diagonal", () => {
    expect(cssPixelsPerInch(1920, 1080, null)).toBe(FALLBACK_PPI);
    expect(cssPixelsPerInch(1920, 1080, undefined)).toBe(FALLBACK_PPI);
    expect(cssPixelsPerInch(1920, 1080, { diagonalInches: 0, fineTune: 1 })).toBe(FALLBACK_PPI);
  });
});

describe("mapScale", () => {
  it("physical mode renders one 70px map square as one screen inch", () => {
    const ppi = cssPixelsPerInch(1920, 1080, { diagonalInches: 43, fineTune: 1 });
    const scale = mapScale({ mode: "physical", panX: 0, panY: 0 }, ppi, 70, 4480, 7000, 1920, 1080);
    // 70 map px × scale must equal ppi screen px (= 1 physical inch)
    expect(70 * scale).toBeCloseTo(ppi, 6);
  });

  it("physical mode guards against a non-positive pxPerSquare", () => {
    const scale = mapScale({ mode: "physical", panX: 0, panY: 0 }, 96, 0, 100, 100, 1920, 1080);
    expect(scale).toBeCloseTo(96 / DEFAULT_PX_PER_SQUARE, 6);
  });

  it("fit mode fits the whole map inside the viewport", () => {
    const scale = mapScale({ mode: "fit", panX: 0, panY: 0 }, 96, 70, 4480, 7000, 1920, 1080);
    expect(scale).toBeCloseTo(1080 / 7000, 6);
    expect(4480 * scale).toBeLessThanOrEqual(1920);
  });
});

describe("mapTranslation", () => {
  it("fit mode centers the map", () => {
    const { tx, ty } = mapTranslation({ mode: "fit", panX: 0, panY: 0 }, 0.1, 4480, 7000, 1920, 1080);
    expect(tx).toBeCloseTo((1920 - 448) / 2, 6);
    expect(ty).toBeCloseTo((1080 - 700) / 2, 6);
  });

  it("physical mode puts the pan point at the viewport center", () => {
    const view = { mode: "physical" as const, panX: 2240, panY: 3500 };
    const { tx, ty } = mapTranslation(view, 0.5, 4480, 7000, 1920, 1080);
    // map point (2240,3500) lands at screen (960,540)
    expect(2240 * 0.5 + tx).toBeCloseTo(960, 6);
    expect(3500 * 0.5 + ty).toBeCloseTo(540, 6);
  });
});

describe("clampPan", () => {
  it("clamps the pan point inside the map bounds", () => {
    expect(clampPan(-50, 8000, 4480, 7000)).toEqual({ panX: 0, panY: 7000 });
    expect(clampPan(100, 200, 4480, 7000)).toEqual({ panX: 100, panY: 200 });
  });
});

describe("defaultMapState", () => {
  it("starts in fit mode centered on the map", () => {
    const state = defaultMapState(4480, 7000);
    expect(state.mode).toBe("fit");
    expect(state.panX).toBe(2240);
    expect(state.panY).toBe(3500);
    expect(state.pxPerSquare).toBe(DEFAULT_PX_PER_SQUARE);
    expect(state.showGrid).toBe(false);
  });
});

describe("gridLinePositions", () => {
  it("emits lines at the scaled pitch covering the viewport", () => {
    const positions = gridLinePositions(0, 0, 70, 1, 210);
    expect(positions).toEqual([0, 70, 140, 210]);
  });

  it("phases lines by the map origin and grid offset", () => {
    const positions = gridLinePositions(-30, 10, 70, 1, 140);
    // origin at -30+10 = -20 → first visible line at 50
    expect(positions).toEqual([50, 120]);
  });

  it("returns nothing for a degenerate pitch", () => {
    expect(gridLinePositions(0, 0, 70, 0.01, 1000)).toEqual([]);
    expect(gridLinePositions(0, 0, 0, 1, 1000)).toEqual([]);
  });
});
