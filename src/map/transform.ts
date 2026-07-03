import type { MapGridConfig, MapView, ScreenProfile, StoredMapState } from "./types";

// CSS reference DPI — browsers cannot report the true physical DPI of a
// display, so this is the only honest fallback when no screen profile exists.
export const FALLBACK_PPI = 96;
export const DEFAULT_PX_PER_SQUARE = 70;

export const DEFAULT_GRID_CONFIG: MapGridConfig = {
  pxPerSquare: DEFAULT_PX_PER_SQUARE,
  gridOffsetX: 0,
  gridOffsetY: 0,
  showGrid: false,
  gridColor: "#000000",
  gridOpacity: 0.35,
};

export function defaultMapState(naturalWidth: number, naturalHeight: number): StoredMapState {
  return {
    ...DEFAULT_GRID_CONFIG,
    mode: "fit",
    panX: naturalWidth / 2,
    panY: naturalHeight / 2,
  };
}

export function profileKey(width: number, height: number, devicePixelRatio: number): string {
  return `${width}x${height}@${devicePixelRatio}`;
}

export function cssPixelsPerInch(
  width: number,
  height: number,
  profile: ScreenProfile | null | undefined
): number {
  if (!profile || !(profile.diagonalInches > 0)) return FALLBACK_PPI;
  const fineTune = profile.fineTune > 0 ? profile.fineTune : 1;
  return (Math.hypot(width, height) / profile.diagonalInches) * fineTune;
}

export function mapScale(
  view: MapView,
  ppi: number,
  pxPerSquare: number,
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number
): number {
  if (view.mode === "fit") {
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) return 1;
    return Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  }
  return ppi / (pxPerSquare > 0 ? pxPerSquare : DEFAULT_PX_PER_SQUARE);
}

export function mapTranslation(
  view: MapView,
  scale: number,
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { tx: number; ty: number } {
  if (view.mode === "fit") {
    return {
      tx: (viewportWidth - naturalWidth * scale) / 2,
      ty: (viewportHeight - naturalHeight * scale) / 2,
    };
  }
  return {
    tx: viewportWidth / 2 - view.panX * scale,
    ty: viewportHeight / 2 - view.panY * scale,
  };
}

export function clampPan(
  panX: number,
  panY: number,
  naturalWidth: number,
  naturalHeight: number
): { panX: number; panY: number } {
  return {
    panX: Math.min(Math.max(panX, 0), Math.max(naturalWidth, 0)),
    panY: Math.min(Math.max(panY, 0), Math.max(naturalHeight, 0)),
  };
}

// Screen-space positions of grid lines along one axis. `mapOriginOnScreen` is
// the translation of the map's 0 coordinate; the grid lattice starts at
// `gridOffsetMapPx` in map pixels. Pitches at or below 1 screen px would paint
// a solid fill, so nothing is returned for them.
export function gridLinePositions(
  mapOriginOnScreen: number,
  gridOffsetMapPx: number,
  pxPerSquare: number,
  scale: number,
  viewportExtent: number
): number[] {
  const pitch = pxPerSquare * scale;
  if (!(pitch > 1)) return [];
  const origin = mapOriginOnScreen + gridOffsetMapPx * scale;
  const first = origin - Math.floor(origin / pitch) * pitch;
  const positions: number[] = [];
  for (let p = first; p <= viewportExtent; p += pitch) positions.push(p);
  return positions;
}
