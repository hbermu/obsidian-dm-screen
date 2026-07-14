import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlayerScreenServer, VaultServeAllowlist, messageChannel } from "../server";

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

function addClient(server: PlayerScreenServer, ws: any, channel: "player" | "map") {
  (server as any).clients.add(ws);
  (server as any).clientChannels.set(ws, channel);
}

describe("messageChannel", () => {
  it("routes map-prefixed types to the map channel and the rest to players", () => {
    expect(messageChannel("map-show")).toBe("map");
    expect(messageChannel("map-clear")).toBe("map");
    expect(messageChannel("show-background-media")).toBe("player");
    expect(messageChannel("clear")).toBe("player");
  });
});

describe("channel-filtered broadcast", () => {
  let server: PlayerScreenServer;

  beforeEach(() => {
    server = new PlayerScreenServer(makePlugin());
  });

  it("sends map-* messages only to map clients", () => {
    const player = makeWsStub();
    const map = makeWsStub();
    addClient(server, player, "player");
    addClient(server, map, "map");

    server.broadcast({ type: "map-show", payload: { url: "/vault/m.jpg", mediaType: "image" } });

    expect(player._sent).toHaveLength(0);
    expect(map._sent).toHaveLength(1);
    expect(JSON.parse(map._sent[0]).type).toBe("map-show");
  });

  it("sends player messages only to player clients", () => {
    const player = makeWsStub();
    const map = makeWsStub();
    addClient(server, player, "player");
    addClient(server, map, "map");

    server.broadcast({ type: "show-background-media", payload: { url: "/vault/a.png" } });

    expect(map._sent).toHaveLength(0);
    expect(player._sent).toHaveLength(1);
  });

  it("treats clients without a channel tag as players", () => {
    const untagged = makeWsStub();
    (server as any).clients.add(untagged);

    server.broadcast({ type: "waiting-screen", payload: { title: "t", subtitle: "s" } });
    server.broadcast({ type: "map-view", payload: { mode: "fit", panX: 0, panY: 0 } });

    expect(untagged._sent).toHaveLength(1);
    expect(JSON.parse(untagged._sent[0]).type).toBe("waiting-screen");
  });
});

describe("channel-scoped cache purge", () => {
  let server: PlayerScreenServer;

  beforeEach(() => {
    server = new PlayerScreenServer(makePlugin());
  });

  it("clear purges only player-channel entries", () => {
    server.broadcast({ type: "show-background-media", payload: { url: "/vault/a.png" } });
    server.broadcast({ type: "map-show", payload: { url: "/vault/m.jpg", mediaType: "image" } });
    server.broadcast({ type: "map-view", payload: { mode: "physical", panX: 1, panY: 2 } });
    server.broadcast({ type: "clear", payload: {} });

    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.has("show-background-media")).toBe(false);
    expect(cache.has("map-show")).toBe(true);
    expect(cache.has("map-view")).toBe(true);
  });

  it("map-clear purges only map-channel entries and is not cached", () => {
    server.broadcast({ type: "show-background-media", payload: { url: "/vault/a.png" } });
    server.broadcast({ type: "map-show", payload: { url: "/vault/m.jpg", mediaType: "image" } });
    server.broadcast({ type: "map-config", payload: { pxPerSquare: 70 } });
    server.broadcast({ type: "map-fog", payload: { dataUrl: "data:image/png;base64,AAAA", opacity: 1 } });
    server.broadcast({ type: "map-clear", payload: {} });

    const cache = (server as any).lastState as Map<string, string>;
    expect(cache.has("map-show")).toBe(false);
    expect(cache.has("map-config")).toBe(false);
    expect(cache.has("map-fog")).toBe(false);
    expect(cache.has("map-clear")).toBe(false);
    expect(cache.has("show-background-media")).toBe(true);
  });
});

describe("channel-filtered late-joiner replay", () => {
  it("replays only the joining client's channel", () => {
    const server = new PlayerScreenServer(makePlugin());
    server.broadcast({ type: "show-background-media", payload: { url: "/vault/a.png" } });
    server.broadcast({ type: "map-show", payload: { url: "/vault/m.jpg", mediaType: "image" } });
    server.broadcast({ type: "map-view", payload: { mode: "fit", panX: 0, panY: 0 } });
    server.broadcast({ type: "map-fog", payload: { dataUrl: "data:image/png;base64,AAAA", opacity: 1 } });

    const mapJoiner = makeWsStub();
    (server as any).replayCachedState(mapJoiner, "map");
    expect(mapJoiner._sent.map((d: string) => JSON.parse(d).type).sort()).toEqual(["map-fog", "map-show", "map-view"]);

    const playerJoiner = makeWsStub();
    (server as any).replayCachedState(playerJoiner, "player");
    expect(playerJoiner._sent.map((d: string) => JSON.parse(d).type)).toEqual(["show-background-media"]);
  });
});

describe("VaultServeAllowlist map slot", () => {
  it("admits the map-show path and revokes it on map-clear", () => {
    const allowlist = new VaultServeAllowlist();
    allowlist.observe({ type: "map-show", payload: { url: "/vault/maps%2Fexec.jpg" } });
    expect(allowlist.isAllowed("maps/exec.jpg")).toBe(true);

    allowlist.observe({ type: "map-clear", payload: {} });
    expect(allowlist.isAllowed("maps/exec.jpg")).toBe(false);
  });

  it("keeps the map path independent of background and clear", () => {
    const allowlist = new VaultServeAllowlist();
    allowlist.observe({ type: "map-show", payload: { url: "/vault/m.jpg" } });
    allowlist.observe({ type: "show-background-media", payload: { url: "/vault/bg.png" } });

    allowlist.observe({ type: "clear", payload: {} });
    expect(allowlist.isAllowed("bg.png")).toBe(false);
    expect(allowlist.isAllowed("m.jpg")).toBe(true);

    allowlist.observe({ type: "map-clear", payload: {} });
    expect(allowlist.isAllowed("m.jpg")).toBe(false);
  });

  it("ignores non-vault map URLs", () => {
    const allowlist = new VaultServeAllowlist();
    allowlist.observe({ type: "map-show", payload: { url: "data:image/png;base64,x" } });
    expect(allowlist.snapshot().map).toBeNull();
  });
});
