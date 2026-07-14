/**
 * Spec-conformance suite: each test cites the EARS requirement it verifies.
 * Source: .agent/features/map-screen/fog-of-war.md
 * Source: .agent/features/player-server/websocket-protocol.md
 *
 * Only requirements testable without canvas/DOM rendering are included here
 * (JSDOM has no real 2D context). Requirements 4, 5, 9, 10, 11, 12, 16, 17
 * require canvas/DOM and are covered by visual tests or integration tests.
 */
import { describe, expect, it } from "vitest";
import { fogCanvasSize, fogSidecarPath, FOG_RESOLUTION } from "../map/fog";
import { wallsSidecarPath } from "../map/walls";
import { blocksSight, visibilityPolygon } from "../map/los";
import { messageChannel } from "../server";
import { MapScreenPanel } from "../views/MapScreenPanel";
import { DEFAULT_SETTINGS } from "../settings";
import type { MapVision, MapWall } from "../map/types";

const PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ---------- Shared panel factory (mirrors map-fog-panel.test.ts) ----------

interface Broadcast { type: string; payload: Record<string, unknown> }

function makePanel(fogOpacity = 1) {
  const broadcasts: Broadcast[] = [];
  const plugin = {
    settings: {
      mapConfigs: {} as Record<string, unknown>,
      mapDefaultPxPerSquare: 140,
      mapScreenProfiles: {},
      tvWidth: 1920,
      tvHeight: 1080,
      hydrusDefaultLoop: true,
      hydrusDefaultMuted: true,
      mapFogTvOpacity: fogOpacity,
    },
    server: { broadcast: (msg: Broadcast) => broadcasts.push(msg) },
    saveSettings: () => Promise.resolve(),
    broadcastMapCalibration: () => {},
    app: {
      vault: {
        adapter: {
          exists: () => Promise.resolve(false),
          readBinary: () => Promise.resolve(new ArrayBuffer(0)),
          writeBinary: () => Promise.resolve(),
          mkdir: () => Promise.resolve(),
          getResourcePath: () => null,
        },
      },
    },
  };
  const host = { render: () => {} };
  const panel = new MapScreenPanel(plugin as any, host as any);
  return { panel, broadcasts };
}

// ---------- Req 2: mask geometry ----------

describe("Req 2: fog mask canvas size — 1024 wide, aspect-matched height, minimum 1", () => {
  it("width is always FOG_RESOLUTION (1024)", () => {
    expect(FOG_RESOLUTION).toBe(1024);
    const { width } = fogCanvasSize(1920, 1080);
    expect(width).toBe(1024);
  });

  it("height is round(1024 * naturalHeight / naturalWidth)", () => {
    expect(fogCanvasSize(2048, 1024).height).toBe(512);
    expect(fogCanvasSize(1000, 1500).height).toBe(1536);
  });

  it("height is at least 1 for extreme aspect ratios", () => {
    expect(fogCanvasSize(100000, 1).height).toBeGreaterThanOrEqual(1);
  });
});

// ---------- Req 7: sidecar path derivation ----------

describe("Req 7: sidecar path — deterministic per URL, identical for note and Hydrus maps", () => {
  it("fogSidecarPath is deterministic for the same URL", () => {
    const url = "/vault/maps/room.jpg";
    expect(fogSidecarPath(url)).toBe(fogSidecarPath(url));
  });

  it("fogSidecarPath lives under .dm-screen/fog/ and ends in .png", () => {
    expect(fogSidecarPath("/vault/maps/room.jpg")).toMatch(/^\.dm-screen\/fog\/.+\.png$/);
  });

  it("note-image URL and Hydrus-cached URL with different paths produce different sidecars", () => {
    const noteUrl = "/vault/maps/dungeon.jpg";
    const hydrusUrl = "/vault/.dm-screen/hydrus/abc123def456.jpg";
    expect(fogSidecarPath(noteUrl)).not.toBe(fogSidecarPath(hydrusUrl));
  });

  it("same URL → same sidecar path (no randomness)", () => {
    const url = "/vault/.dm-screen/hydrus/abc123.jpg";
    expect(fogSidecarPath(url)).toBe(fogSidecarPath(url));
  });

  it("wallsSidecarPath shares the tail+hash core with fogSidecarPath for the same URL", () => {
    const url = "/vault/maps/room.png";
    const fogCore = fogSidecarPath(url).replace(/^\.dm-screen\/fog\//, "").replace(/\.png$/, "");
    const wallsCore = wallsSidecarPath(url).replace(/^\.dm-screen\/walls\//, "").replace(/\.json$/, "");
    expect(fogCore).toBe(wallsCore);
  });
});

// ---------- Req 10: blocksSight truth table ----------

describe("Req 10 (via los.ts blocksSight): wall / closed-door / open-door truth table", () => {
  it("plain wall blocks sight", () => {
    expect(blocksSight({ x1: 0, y1: 0, x2: 10, y2: 0 })).toBe(true);
  });

  it("door with open:false blocks sight", () => {
    expect(blocksSight({ x1: 0, y1: 0, x2: 10, y2: 0, door: true, open: false })).toBe(true);
  });

  it("door with open:true does NOT block sight", () => {
    expect(blocksSight({ x1: 0, y1: 0, x2: 10, y2: 0, door: true, open: true })).toBe(false);
  });
});

// ---------- Req 10 + LoS geometry: visibility polygon clips at walls ----------

describe("Req 10 (visibilityPolygon): LoS clipped by walls and restored through open doors", () => {
  const bounds = { x: 0, y: 0, w: 200, h: 200 };

  it("vertical wall to the right of observer — no revealed point extends beyond the wall", () => {
    const wall: MapWall = { x1: 100, y1: 0, x2: 100, y2: 200 };
    const pts = visibilityPolygon(50, 100, [wall], bounds);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.x).toBeLessThanOrEqual(100.5);
    }
  });

  it("open door: sight passes through (polygon has points past the wall x)", () => {
    const wall: MapWall = { x1: 100, y1: 0, x2: 100, y2: 200, door: true, open: true };
    const pts = visibilityPolygon(50, 100, [wall], bounds);
    const seesThrough = pts.some((p) => p.x > 101);
    expect(seesThrough).toBe(true);
  });
});

// ---------- Req 14: republish signals ----------

describe("Req 14 + Req 21 + Req 27: republish sends fog (even null) and walls (even empty), vision only when non-empty", () => {
  it("republish with no visions emits map-fog and map-walls but NOT map-vision", () => {
    const { panel, broadcasts } = makePanel();
    panel.activeMap = { url: "/vault/m.jpg", mediaType: "image", naturalWidth: 50, naturalHeight: 50 };
    panel.fogDataUrl = null;
    panel.walls = [];
    panel.visions = [];
    panel.republish();

    expect(broadcasts.some((b) => b.type === "map-fog")).toBe(true);
    expect(broadcasts.some((b) => b.type === "map-walls")).toBe(true);
    expect(broadcasts.some((b) => b.type === "map-vision")).toBe(false);
  });

  it("republish with visions present emits map-vision", () => {
    const { panel, broadcasts } = makePanel();
    panel.activeMap = { url: "/vault/m.jpg", mediaType: "image", naturalWidth: 50, naturalHeight: 50 };
    const v: MapVision = { id: "v1", shape: "circle", x: 10, y: 10, sizeFt: 30, featherFt: 5 };
    panel.visions = [v];
    panel.republish();
    expect(broadcasts.some((b) => b.type === "map-vision")).toBe(true);
  });

  it("republish emits map-aoe-sync only when aoes are non-empty", () => {
    const { panel, broadcasts } = makePanel();
    panel.activeMap = { url: "/vault/m.jpg", mediaType: "image", naturalWidth: 50, naturalHeight: 50 };
    panel.aoes = [];
    panel.republish();
    expect(broadcasts.some((b) => b.type === "map-aoe-sync")).toBe(false);
  });
});

// ---------- Req 15 / settings: mapFogTvOpacity default and broadcastFog ----------

describe("Req 15 / settings: mapFogTvOpacity default is 1, broadcastFog embeds the current setting value", () => {
  it("DEFAULT_SETTINGS.mapFogTvOpacity is 1", () => {
    expect(DEFAULT_SETTINGS.mapFogTvOpacity).toBe(1);
  });

  it("broadcastFog embeds the configured opacity value in the payload", () => {
    const { panel, broadcasts } = makePanel(0.75);
    panel.fogDataUrl = PNG_URL;
    panel.broadcastFog();
    const msg = broadcasts.find((b) => b.type === "map-fog");
    expect(msg?.payload.opacity).toBe(0.75);
  });

  it("broadcastFog with null dataUrl still includes the opacity", () => {
    const { panel, broadcasts } = makePanel(0.5);
    panel.fogDataUrl = null;
    panel.broadcastFog();
    const msg = broadcasts.find((b) => b.type === "map-fog");
    expect(msg?.payload.dataUrl).toBeNull();
    expect(msg?.payload.opacity).toBe(0.5);
  });
});

// ---------- Websocket-protocol Req 1b: map-* messages route to the map channel ----------

describe("Websocket-protocol Req 1b: map-* message types route to the map channel", () => {
  it("messageChannel('map-fog') === 'map'", () => {
    expect(messageChannel("map-fog")).toBe("map");
  });

  it("messageChannel('map-vision') === 'map'", () => {
    expect(messageChannel("map-vision")).toBe("map");
  });

  it("messageChannel('map-walls') === 'map'", () => {
    expect(messageChannel("map-walls")).toBe("map");
  });

  it("messageChannel('map-show') === 'map'", () => {
    expect(messageChannel("map-show")).toBe("map");
  });

  it("messageChannel('map-clear') === 'map'", () => {
    expect(messageChannel("map-clear")).toBe("map");
  });

  it("non-map-prefixed types route to player channel", () => {
    expect(messageChannel("show-background-media")).toBe("player");
    expect(messageChannel("clear")).toBe("player");
    expect(messageChannel("initiative-update")).toBe("player");
  });
});
