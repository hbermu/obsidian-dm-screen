export interface MapMediaPayload {
  url: string;
  mediaType: "image" | "video";
  naturalWidth: number;
  naturalHeight: number;
  loop?: boolean;
  muted?: boolean;
}

export interface MapView {
  mode: "physical" | "fit";
  panX: number;
  panY: number;
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
