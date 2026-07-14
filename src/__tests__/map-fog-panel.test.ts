import { describe, expect, it, vi } from "vitest";
import { MapScreenPanel } from "../views/MapScreenPanel";
import { fogSidecarPath } from "../map/fog";

interface Broadcast {
  type: string;
  payload: Record<string, unknown>;
}

const PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function makePanel(files: Record<string, Uint8Array> = {}) {
  const broadcasts: Broadcast[] = [];
  const adapter = {
    exists: (p: string) => Promise.resolve(p in files),
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
    mkdir: () => Promise.resolve(),
    getResourcePath: () => null,
  };
  const plugin = {
    settings: {
      mapConfigs: {} as Record<string, unknown>,
      mapDefaultPxPerSquare: 140,
      mapScreenProfiles: {},
      tvWidth: 1920,
      tvHeight: 1080,
      hydrusDefaultLoop: true,
      hydrusDefaultMuted: true,
      mapFogTvOpacity: 0.9,
    },
    server: { broadcast: (msg: Broadcast) => broadcasts.push(msg) },
    saveSettings: () => Promise.resolve(),
    broadcastMapCalibration: () => {},
    app: { vault: { adapter } },
  };
  const host = { render: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const panel = new MapScreenPanel(plugin as any, host as any);
  return { panel, broadcasts, files };
}

describe("map fog lifecycle", () => {
  it("broadcastFog sends dataUrl and the configured opacity", () => {
    const { panel, broadcasts } = makePanel();
    panel.fogDataUrl = PNG_URL;
    panel.broadcastFog();
    const msg = broadcasts.find((b) => b.type === "map-fog");
    expect(msg?.payload).toEqual({ dataUrl: PNG_URL, opacity: 0.9 });
  });

  it("commitFog writes the sidecar and broadcasts", async () => {
    const { panel, broadcasts, files } = makePanel();
    panel.activeMap = { url: "/vault/maps/a.jpg", mediaType: "image", naturalWidth: 100, naturalHeight: 100 };
    await panel.commitFog(PNG_URL);
    expect(files[fogSidecarPath("/vault/maps/a.jpg")]).toBeDefined();
    expect(broadcasts.some((b) => b.type === "map-fog")).toBe(true);
  });

  it("stopMap clears fog state", () => {
    const { panel } = makePanel();
    panel.activeMap = { url: "/vault/x.png", mediaType: "image", naturalWidth: 10, naturalHeight: 10 };
    panel.fogDataUrl = PNG_URL;
    panel.stopMap();
    expect(panel.fogDataUrl).toBeNull();
  });

  it("restoreFromCache recovers fog from the map-fog slot", () => {
    const { panel } = makePanel();
    const cache = {
      "map-show": JSON.stringify({
        type: "map-show",
        payload: { url: "/vault/m.jpg", mediaType: "image", naturalWidth: 50, naturalHeight: 50 },
      }),
      "map-fog": JSON.stringify({ type: "map-fog", payload: { dataUrl: PNG_URL, opacity: 1 } }),
    };
    panel.restoreFromCache(cache);
    expect(panel.fogDataUrl).toBe(PNG_URL);
  });

  it("republish re-broadcasts fog while a map is active", () => {
    const { panel, broadcasts } = makePanel();
    panel.activeMap = { url: "/vault/m.jpg", mediaType: "image", naturalWidth: 50, naturalHeight: 50 };
    panel.fogDataUrl = PNG_URL;
    panel.republish();
    expect(broadcasts.filter((b) => b.type === "map-fog").length).toBe(1);
  });
});
