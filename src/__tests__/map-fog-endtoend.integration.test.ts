import { describe, expect, it } from "vitest";
import { PlayerScreenServer } from "../server";
import { MapScreenPanel } from "../views/MapScreenPanel";
import { fogSidecarPath, loadFogSidecar } from "../map/fog";
import { loadWallsSidecar } from "../map/walls";
import type { MapVision, MapWall } from "../map/types";

const PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const MAP_URL = "/vault/maps/dungeon.jpg";
const MAP_WALL: MapWall = { x1: 0, y1: 0, x2: 100, y2: 0 };
const MAP_DOOR: MapWall = { x1: 50, y1: 0, x2: 50, y2: 100, door: true, open: false };
const VISION: MapVision = { id: "v1", shape: "circle", x: 250, y: 250, sizeFt: 30, featherFt: 5 };

function makeAdapter(files: Record<string, Uint8Array> = {}) {
  const dirs = new Set<string>();
  return {
    exists: (p: string) => Promise.resolve(p in files || dirs.has(p)),
    readBinary: (p: string) => {
      const b = files[p];
      const buf = new ArrayBuffer(b.length);
      new Uint8Array(buf).set(b);
      return Promise.resolve(buf);
    },
    writeBinary: (p: string, data: ArrayBuffer) => {
      files[p] = new Uint8Array(data);
      return Promise.resolve();
    },
    mkdir: (p: string) => {
      dirs.add(p);
      return Promise.resolve();
    },
    getResourcePath: () => null as unknown as string,
  };
}

function makeServer() {
  const plugin = {
    app: { vault: { getAbstractFileByPath: () => null, readBinary: async () => new ArrayBuffer(0), adapter: {} } },
    settings: { serverPort: 3000 },
  } as any;
  return new PlayerScreenServer(plugin);
}

function makePanel(server: PlayerScreenServer, files: Record<string, Uint8Array> = {}) {
  const adapter = makeAdapter(files);
  const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const plugin = {
    settings: {
      mapConfigs: {} as Record<string, unknown>,
      mapDefaultPxPerSquare: 140,
      mapScreenProfiles: {},
      tvWidth: 1920,
      tvHeight: 1080,
      hydrusDefaultLoop: true,
      hydrusDefaultMuted: true,
      mapFogTvOpacity: 0.8,
    },
    server: {
      broadcast: (msg: { type: string; payload: Record<string, unknown> }) => {
        broadcasts.push(msg);
        server.broadcast(msg);
      },
    },
    saveSettings: () => Promise.resolve(),
    broadcastMapCalibration: () => {},
    app: { vault: { adapter } },
  };
  const host = { render: () => {} };
  const panel = new MapScreenPanel(plugin as any, host as any);
  return { panel, broadcasts, files, adapter };
}

function makeWsStub(channel: "player" | "map") {
  const sent: string[] = [];
  const ws = { readyState: 1, send: (d: string) => sent.push(d), close: () => {}, on: () => {}, _sent: sent };
  return { ws, sent, channel };
}

function addClient(server: PlayerScreenServer, ws: any, channel: "player" | "map") {
  (server as any).clients.add(ws);
  (server as any).clientChannels.set(ws, channel);
}

function replayFor(server: PlayerScreenServer, ws: any, channel: "player" | "map"): string[] {
  (server as any).replayCachedState(ws, channel);
  return ws._sent.map((d: string) => JSON.parse(d).type as string);
}

describe("scene reconstruction for late joiners", () => {
  it("map-channel late joiner receives all committed fog/walls/vision/show/config/view messages", async () => {
    const server = makeServer();
    const { panel } = makePanel(server);

    // Set activeMap directly (skip DOM media measuring)
    panel.activeMap = {
      url: MAP_URL,
      mediaType: "image",
      naturalWidth: 500,
      naturalHeight: 500,
    };
    panel.state = {
      mode: "fit" as const,
      panX: 0,
      panY: 0,
      pxPerSquare: 140,
      gridOffsetX: 0,
      gridOffsetY: 0,
      showGrid: true,
      gridColor: "#ffffff",
      gridOpacity: 0.5,
    };

    await panel.commitFog(PNG_URL);
    await panel.commitWalls([MAP_WALL, MAP_DOOR]);
    panel.visions = [VISION];
    panel.broadcastVisions(true);
    panel.republish();

    const { ws } = makeWsStub("map");
    const types = replayFor(server, ws, "map");

    expect(types).toContain("map-show");
    expect(types).toContain("map-config");
    expect(types).toContain("map-view");
    expect(types).toContain("map-fog");
    expect(types).toContain("map-walls");
    expect(types).toContain("map-vision");

    const fogMsg = ws._sent
      .map((d: string) => JSON.parse(d))
      .find((m: { type: string }) => m.type === "map-fog");
    expect(fogMsg?.payload.dataUrl).toBe(PNG_URL);
    expect(fogMsg?.payload.opacity).toBe(0.8);

    const wallsMsg = ws._sent
      .map((d: string) => JSON.parse(d))
      .find((m: { type: string }) => m.type === "map-walls");
    expect(wallsMsg?.payload.walls).toEqual([MAP_WALL, MAP_DOOR]);
  });

  it("player-channel late joiner receives none of the map-* messages", async () => {
    const server = makeServer();
    const { panel } = makePanel(server);

    panel.activeMap = { url: MAP_URL, mediaType: "image", naturalWidth: 500, naturalHeight: 500 };
    await panel.commitFog(PNG_URL);
    panel.broadcastVisions(true);
    panel.republish();

    const { ws } = makeWsStub("player");
    const types = replayFor(server, ws, "player");

    const mapTypes = types.filter((t) => t.startsWith("map-"));
    expect(mapTypes).toHaveLength(0);
  });
});

describe("map-clear purge", () => {
  it("after stopMap a new map-channel late joiner receives no map-* messages", async () => {
    const server = makeServer();
    const { panel } = makePanel(server);

    panel.activeMap = { url: MAP_URL, mediaType: "image", naturalWidth: 500, naturalHeight: 500 };
    await panel.commitFog(PNG_URL);
    panel.republish();

    panel.stopMap();

    const { ws } = makeWsStub("map");
    const types = replayFor(server, ws, "map");

    const mapTypes = types.filter((t) => t.startsWith("map-"));
    expect(mapTypes).toHaveLength(0);
  });
});

describe("cross-session restore (panel B)", () => {
  it("second panel recovers fogDataUrl, walls, visions, and activeMap.url from the server cache", async () => {
    const server = makeServer();
    const { panel: panelA } = makePanel(server);

    panelA.activeMap = { url: MAP_URL, mediaType: "image", naturalWidth: 500, naturalHeight: 500 };
    panelA.state = {
      mode: "fit" as const,
      panX: 0,
      panY: 0,
      pxPerSquare: 140,
      gridOffsetX: 0,
      gridOffsetY: 0,
      showGrid: true,
      gridColor: "#ffffff",
      gridOpacity: 0.5,
    };
    await panelA.commitFog(PNG_URL);
    await panelA.commitWalls([MAP_WALL]);
    panelA.visions = [VISION];
    panelA.broadcastVisions(true);
    panelA.republish();

    // Serialize the server cache the same way DmControlPanel.saveState does
    const cache: Record<string, string> = {};
    for (const [type, data] of (server as any).lastState.entries()) {
      cache[type] = data;
    }

    const { panel: panelB } = makePanel(server);
    panelB.restoreFromCache(cache);

    expect(panelB.fogDataUrl).toBe(PNG_URL);
    expect(panelB.walls).toEqual([MAP_WALL]);
    expect(panelB.visions).toHaveLength(1);
    expect(panelB.visions[0].id).toBe("v1");
    expect(panelB.activeMap?.url).toBe(MAP_URL);
  });
});

describe("sidecar persistence round-trip across 'sessions' (fog-of-war reqs 7/10)", () => {
  it("re-adding the same map restores fog and walls via sidecar loaders", async () => {
    const files: Record<string, Uint8Array> = {};
    const server = makeServer();
    const { panel: panelA, adapter } = makePanel(server, files);

    panelA.activeMap = { url: MAP_URL, mediaType: "image", naturalWidth: 500, naturalHeight: 500 };
    await panelA.commitFog(PNG_URL);
    await panelA.commitWalls([MAP_WALL, MAP_DOOR]);

    // Panel B gets the same shared files (same vault adapter storage)
    const recoveredFog = await loadFogSidecar(adapter as any, MAP_URL);
    const recoveredWalls = await loadWallsSidecar(adapter as any, MAP_URL);

    expect(recoveredFog).toBe(PNG_URL);
    expect(recoveredWalls).toEqual([MAP_WALL, MAP_DOOR]);
  });
});
