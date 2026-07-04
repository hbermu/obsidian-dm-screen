export interface MapMediaPayload {
  url: string;
  mediaType: "image" | "video";
  naturalWidth: number;
  naturalHeight: number;
  loop?: boolean;
  muted?: boolean;
}

export type MapRotation = 0 | 90 | 180 | 270;

export interface MapView {
  mode: "physical" | "fit";
  panX: number;
  panY: number;
  // Optional so cached pre-rotation payloads stay valid; absent means 0.
  rotation?: MapRotation;
}

export interface MapGridConfig {
  pxPerSquare: number;
  gridOffsetX: number;
  gridOffsetY: number;
  showGrid: boolean;
  gridColor: string;
  gridOpacity: number;
}

export interface ScreenProfile {
  diagonalInches: number;
  fineTune: number;
}

export interface StoredMapState extends MapGridConfig, MapView {}

export type AoeShape = "circle" | "square" | "cone" | "line";

export interface MapAoe {
  id: string;
  shape: AoeShape;
  sizeFt: number;
  widthFt: number;
  color: string;
  opacity: number;
  rotation: number;
  x: number;
  y: number;
}

export interface AoePreset {
  name: string;
  shape: AoeShape;
  sizeFt: number;
  widthFt: number;
  color: string;
  opacity: number;
}

export const AOE_PRESETS: AoePreset[] = [
  { name: "Fireball", shape: "circle", sizeFt: 20, widthFt: 5, color: "#ff4400", opacity: 0.3 },
  { name: "Spirit Guardians", shape: "circle", sizeFt: 15, widthFt: 5, color: "#44aaff", opacity: 0.25 },
];
