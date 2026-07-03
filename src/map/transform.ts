import type { MapGridConfig, MapRotation, MapView, ScreenProfile, StoredMapState } from "./types";

// CSS reference DPI — browsers cannot report the true physical DPI of a
// display, so this is the only honest fallback when no screen profile exists.
export const FALLBACK_PPI = 96;
export const DEFAULT_PX_PER_SQUARE = 140;

export const DEFAULT_GRID_CONFIG: MapGridConfig = {
  pxPerSquare: DEFAULT_PX_PER_SQUARE,
  gridOffsetX: 0,
  gridOffsetY: 0,
  showGrid: false,
  gridColor: "#000000",
  gridOpacity: 0.35,
};

export function defaultMapState(
  naturalWidth: number,
  naturalHeight: number,
  pxPerSquare: number = DEFAULT_PX_PER_SQUARE
): StoredMapState {
  return {
    ...DEFAULT_GRID_CONFIG,
    pxPerSquare: pxPerSquare > 0 ? pxPerSquare : DEFAULT_PX_PER_SQUARE,
    mode: "fit",
    panX: naturalWidth / 2,
    panY: naturalHeight / 2,
    rotation: 0,
  };
}

// Map point → screen direction under a CSS `rotate(θ)` (clockwise, y-down).
export function rotatePoint(x: number, y: number, rotation: MapRotation): { x: number; y: number } {
  switch (rotation) {
    case 90: return { x: -y, y: x };
    case 180: return { x: -x, y: -y };
    case 270: return { x: y, y: -x };
    default: return { x, y };
  }
}

export function rotatedSize(
  naturalWidth: number,
  naturalHeight: number,
  rotation: MapRotation
): { width: number; height: number } {
  return rotation % 180 === 0
    ? { width: naturalWidth, height: naturalHeight }
    : { width: naturalHeight, height: naturalWidth };
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
    const rotated = rotatedSize(naturalWidth, naturalHeight, view.rotation ?? 0);
    return Math.min(viewportWidth / rotated.width, viewportHeight / rotated.height);
  }
  return ppi / (pxPerSquare > 0 ? pxPerSquare : DEFAULT_PX_PER_SQUARE);
}

// Translation for `translate(tx,ty) rotate(θ) scale(s)` (screen = T + s·R·p):
// the pan point lands at the viewport center. Fit mode pans to the map
// center, which also centers the rotated bounding box.
export function mapTranslation(
  view: MapView,
  scale: number,
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { tx: number; ty: number } {
  const rotation = view.rotation ?? 0;
  const pan =
    view.mode === "fit"
      ? { x: naturalWidth / 2, y: naturalHeight / 2 }
      : { x: view.panX, y: view.panY };
  const r = rotatePoint(pan.x, pan.y, rotation);
  return {
    tx: viewportWidth / 2 - r.x * scale,
    ty: viewportHeight / 2 - r.y * scale,
  };
}

// Which map-axis lattice feeds each screen axis under rotation, as signed
// map-pixel offsets for gridLinePositions (vertical = screen-x lines,
// horizontal = screen-y lines).
export function gridAxisOffsets(
  rotation: MapRotation,
  gridOffsetX: number,
  gridOffsetY: number
): { vertical: number; horizontal: number } {
  switch (rotation) {
    case 90: return { vertical: -gridOffsetY, horizontal: gridOffsetX };
    case 180: return { vertical: -gridOffsetX, horizontal: -gridOffsetY };
    case 270: return { vertical: gridOffsetY, horizontal: -gridOffsetX };
    default: return { vertical: gridOffsetX, horizontal: gridOffsetY };
  }
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
