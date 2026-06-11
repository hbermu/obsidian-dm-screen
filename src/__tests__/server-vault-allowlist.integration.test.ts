import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "http";
import type { AddressInfo } from "net";
import { PlayerScreenServer } from "../server";

interface Spies {
  getAbstractFileByPath: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
  readBinary: ReturnType<typeof vi.fn>;
}

function makePlugin(spies: Spies, bytes: ArrayBuffer) {
  return {
    app: {
      vault: {
        getAbstractFileByPath: spies.getAbstractFileByPath,
        readBinary: async () => bytes,
        adapter: {
          exists: spies.exists,
          readBinary: spies.readBinary,
        },
      },
    },
    settings: { serverPort: 0 },
  } as any;
}

async function startServer(spies: Spies, bytes: ArrayBuffer): Promise<{
  server: PlayerScreenServer;
  port: number;
}> {
  const server = new PlayerScreenServer(makePlugin(spies, bytes));
  server.start(0);
  const httpServer = (server as any).httpServer as {
    address(): AddressInfo | string | null;
    once(event: string, cb: () => void): void;
  };
  await new Promise<void>((resolveListening) => {
    const addr = httpServer.address();
    if (addr && typeof addr === "object") resolveListening();
    else httpServer.once("listening", () => resolveListening());
  });
  return { server, port: (httpServer.address() as AddressInfo).port };
}

interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function fetch(port: number, path: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      );
    });
    req.on("error", reject);
  });
}

describe("PlayerScreenServer /vault/ display allowlist", () => {
  let server: PlayerScreenServer;
  let port: number;
  let spies: Spies;
  const payloadBytes = new TextEncoder().encode("BACKGROUND-VIDEO").buffer;

  beforeEach(async () => {
    spies = {
      getAbstractFileByPath: vi.fn(() => null),
      exists: vi.fn(async () => true),
      readBinary: vi.fn(async () => payloadBytes),
    };
    ({ server, port } = await startServer(spies, payloadBytes));
  });

  afterEach(() => {
    server.stop();
  });

  it("refuses to read plugin data.json without a matching broadcast (404, no disk read)", async () => {
    const res = await fetch(port, "/vault/.obsidian/plugins/dm-screen/data.json");
    expect(res.status).toBe(404);
    expect(spies.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(spies.exists).not.toHaveBeenCalled();
    expect(spies.readBinary).not.toHaveBeenCalled();
  });

  it("refuses to read an undisplayed note (404, no disk read)", async () => {
    const res = await fetch(port, "/vault/notes/secret.md");
    expect(res.status).toBe(404);
    expect(spies.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(spies.exists).not.toHaveBeenCalled();
    expect(spies.readBinary).not.toHaveBeenCalled();
  });

  it("serves a vault background after show-background-media", async () => {
    server.broadcast({
      type: "show-background-media",
      payload: { url: "/vault/bg.webm", mediaType: "video" },
    });
    const res = await fetch(port, "/vault/bg.webm");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("video/webm");
    expect(res.body.toString()).toBe("BACKGROUND-VIDEO");
  });

  it("revokes the background on hide-background-media (404, no disk read)", async () => {
    server.broadcast({
      type: "show-background-media",
      payload: { url: "/vault/bg.webm", mediaType: "video" },
    });
    server.broadcast({ type: "hide-background-media", payload: {} });
    spies.readBinary.mockClear();
    spies.getAbstractFileByPath.mockClear();
    spies.exists.mockClear();

    const res = await fetch(port, "/vault/bg.webm");
    expect(res.status).toBe(404);
    expect(spies.readBinary).not.toHaveBeenCalled();
    expect(spies.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(spies.exists).not.toHaveBeenCalled();
  });

  it("revokes everything on clear", async () => {
    server.broadcast({
      type: "show-background-media",
      payload: { url: "/vault/bg.webm", mediaType: "video" },
    });
    server.broadcast({ type: "clear", payload: {} });
    spies.readBinary.mockClear();

    const res = await fetch(port, "/vault/bg.webm");
    expect(res.status).toBe(404);
    expect(spies.readBinary).not.toHaveBeenCalled();
  });

  it("still returns 400 for traversal attempts before consulting the allowlist", async () => {
    const res = await fetch(port, "/vault/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
    expect(spies.readBinary).not.toHaveBeenCalled();
    expect(spies.getAbstractFileByPath).not.toHaveBeenCalled();
  });

  it("admits vault-backed layer paths from image-layers-sync", async () => {
    server.broadcast({
      type: "image-layers-sync",
      payload: {
        layers: [
          {
            id: "layer-1",
            label: "Dungeon Map",
            dataUrl: "/vault/maps/dungeon.png",
            fogDataUrl: "data:image/png;base64,AAAA",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            zIndex: 0,
            rotation: 0,
            visible: true,
            fogEnabled: true,
            bordered: false,
          },
        ],
      },
    });
    const res = await fetch(port, "/vault/maps/dungeon.png");
    expect(res.status).toBe(200);
  });

  it("serves background and layer paths as a union (hiding background leaves layers)", async () => {
    server.broadcast({
      type: "show-background-media",
      payload: { url: "/vault/bg.webm", mediaType: "video" },
    });
    server.broadcast({
      type: "image-layers-sync",
      payload: {
        layers: [
          {
            id: "layer-1",
            label: "Map",
            dataUrl: "/vault/maps/a.png",
            fogDataUrl: "data:",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            zIndex: 0,
            rotation: 0,
            visible: true,
            fogEnabled: false,
            bordered: false,
          },
        ],
      },
    });
    server.broadcast({ type: "hide-background-media", payload: {} });

    const layer = await fetch(port, "/vault/maps/a.png");
    expect(layer.status).toBe(200);

    spies.readBinary.mockClear();
    const bg = await fetch(port, "/vault/bg.webm");
    expect(bg.status).toBe(404);
    expect(spies.readBinary).not.toHaveBeenCalled();
  });
});
