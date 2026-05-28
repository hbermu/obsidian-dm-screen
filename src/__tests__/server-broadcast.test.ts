import { describe, expect, it, vi, beforeEach } from "vitest";
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

function makeWsStub() {
  const sent: string[] = [];
  return {
    readyState: 1,
    send: (data: string) => sent.push(data),
    close: vi.fn(),
    on: vi.fn(),
    _sent: sent,
  };
}

describe("PlayerScreenServer.broadcast", () => {
  let server: PlayerScreenServer;

  beforeEach(() => {
    server = new PlayerScreenServer(makePlugin());
  });

  it("caches the last broadcast per message type", () => {
    server.broadcast({ type: "show-background-media", payload: { url: "/vault/a.png" } });
    server.broadcast({ type: "sync-image-layers", payload: { layers: [] } });

    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.size).toBe(2);
    expect(JSON.parse(cache.get("show-background-media")!).payload.url).toBe("/vault/a.png");
    expect(cache.has("sync-image-layers")).toBe(true);
  });

  it("overwrites previous state of the same type", () => {
    server.broadcast({ type: "show-background-media", payload: { url: "/vault/a.png" } });
    server.broadcast({ type: "show-background-media", payload: { url: "/vault/b.png" } });

    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.size).toBe(1);
    expect(JSON.parse(cache.get("show-background-media")!).payload.url).toBe("/vault/b.png");
  });

  it("clear message wipes all cached state", () => {
    server.broadcast({ type: "show-background-media", payload: { url: "/vault/a.png" } });
    server.broadcast({ type: "sync-image-layers", payload: { layers: [] } });
    server.broadcast({ type: "clear", payload: {} });

    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.size).toBe(0);
  });

  it("sends to all connected clients", () => {
    const ws1 = makeWsStub();
    const ws2 = makeWsStub();
    (server as any).clients.add(ws1);
    (server as any).clients.add(ws2);

    server.broadcast({ type: "test", payload: { x: 1 } });

    expect(ws1._sent).toHaveLength(1);
    expect(ws2._sent).toHaveLength(1);
    expect(JSON.parse(ws1._sent[0])).toEqual({ type: "test", payload: { x: 1 } });
  });

  it("skips clients with readyState != 1 (OPEN)", () => {
    const open = makeWsStub();
    const closed = makeWsStub();
    closed.readyState = 3; // CLOSED
    (server as any).clients.add(open);
    (server as any).clients.add(closed);

    server.broadcast({ type: "test", payload: {} });

    expect(open._sent).toHaveLength(1);
    expect(closed._sent).toHaveLength(0);
  });

  it("clientCount reflects the number of connected clients", () => {
    expect(server.clientCount).toBe(0);
    const ws = makeWsStub();
    (server as any).clients.add(ws);
    expect(server.clientCount).toBe(1);
  });

  it("getConnectedClients returns per-client info", () => {
    const ws1 = makeWsStub();
    const ws2 = makeWsStub();
    (server as any).clients.add(ws1);
    (server as any).clients.add(ws2);
    (server as any).clientInfoMap.set(ws1, { width: 1920, height: 1080, devicePixelRatio: 1 });
    (server as any).clientInfoMap.set(ws2, { width: 1280, height: 800, devicePixelRatio: 2 });

    const clients = server.getConnectedClients();
    expect(clients).toHaveLength(2);
    expect(clients).toContainEqual({ width: 1920, height: 1080, devicePixelRatio: 1 });
    expect(clients).toContainEqual({ width: 1280, height: 800, devicePixelRatio: 2 });
  });

  it("getConnectedClients returns empty when no clients", () => {
    expect(server.getConnectedClients()).toEqual([]);
  });
});
