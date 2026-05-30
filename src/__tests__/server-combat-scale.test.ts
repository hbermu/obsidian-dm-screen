import { describe, expect, it, beforeEach } from "vitest";
import { PlayerScreenServer } from "../server";

function makePlugin() {
  return {
    app: {
      vault: {
        getAbstractFileByPath: () => null,
        readBinary: async () => new ArrayBuffer(0),
        adapter: {},
      },
    },
    settings: { serverPort: 3000 },
  } as any;
}

describe("PlayerScreenServer broadcast combat-scale", () => {
  let server: PlayerScreenServer;

  beforeEach(() => {
    server = new PlayerScreenServer(makePlugin());
  });

  it("caches combat-scale broadcasts in lastState for late joiners", () => {
    server.broadcast({ type: "combat-scale", payload: { scale: 1.5 } });
    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.has("combat-scale")).toBe(true);
    expect(JSON.parse(cache.get("combat-scale")!).payload.scale).toBe(1.5);
  });

  it("overwrites previous combat-scale of the same type", () => {
    server.broadcast({ type: "combat-scale", payload: { scale: 1.2 } });
    server.broadcast({ type: "combat-scale", payload: { scale: 2 } });
    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.size).toBe(1);
    expect(JSON.parse(cache.get("combat-scale")!).payload.scale).toBe(2);
  });

  it("clear message wipes combat-scale from cache", () => {
    server.broadcast({ type: "combat-scale", payload: { scale: 1.7 } });
    server.broadcast({ type: "clear", payload: {} });
    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.has("combat-scale")).toBe(false);
  });
});
