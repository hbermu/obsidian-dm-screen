import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "net";
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
    settings: { serverPort: 0 },
  } as any;
}

async function startServer(): Promise<{ server: PlayerScreenServer; port: number }> {
  const server = new PlayerScreenServer(makePlugin());
  server.start(0);
  const httpServer = (server as any).httpServer as { address(): AddressInfo | string | null; once(event: string, cb: () => void): void };
  await new Promise<void>((resolveListening) => {
    const addr = httpServer.address();
    if (addr && typeof addr === "object") {
      resolveListening();
    } else {
      httpServer.once("listening", () => resolveListening());
    }
  });
  const addr = httpServer.address() as AddressInfo;
  return { server, port: addr.port };
}

interface Connected {
  ws: WebSocket;
  next(timeoutMs?: number): Promise<unknown>;
}

function connectClient(port: number): Promise<Connected> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const buffered: unknown[] = [];
    let pending: ((msg: unknown) => void) | null = null;

    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (pending) {
        const cb = pending;
        pending = null;
        cb(msg);
      } else {
        buffered.push(msg);
      }
    });

    ws.once("open", () => {
      const next = (timeoutMs = 1000): Promise<unknown> =>
        new Promise((res, rej) => {
          if (buffered.length > 0) {
            res(buffered.shift());
            return;
          }
          const timer = setTimeout(() => {
            pending = null;
            rej(new Error("timeout waiting for ws message"));
          }, timeoutMs);
          pending = (msg) => {
            clearTimeout(timer);
            res(msg);
          };
        });
      resolve({ ws, next });
    });
    ws.once("error", reject);
  });
}

describe("PlayerScreenServer integration - real ws round-trip", () => {
  let server: PlayerScreenServer;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = await startServer());
  });

  afterEach(() => {
    server.stop();
  });

  it("delivers a broadcast to a connected real ws client", async () => {
    const client = await connectClient(port);

    server.broadcast({ type: "initiative-update", payload: { combatants: [], round: 0 } });

    const msg = await client.next();
    expect(msg).toEqual({ type: "initiative-update", payload: { combatants: [], round: 0 } });

    client.ws.close();
    await new Promise((r) => client.ws.once("close", r));
  });

  it("replays cached state to a late-joining client", async () => {
    server.broadcast({
      type: "initiative-update",
      payload: { combatants: [{ name: "Aria", initiative: 28 }], round: 1 },
    });

    const lateClient = await connectClient(port);
    const msg = await lateClient.next();

    expect(msg).toEqual({
      type: "initiative-update",
      payload: { combatants: [{ name: "Aria", initiative: 28 }], round: 1 },
    });

    lateClient.ws.close();
    await new Promise((r) => lateClient.ws.once("close", r));
  });

  it("delivers a broadcast to multiple clients", async () => {
    const c1 = await connectClient(port);
    const c2 = await connectClient(port);

    const m1 = c1.next();
    const m2 = c2.next();

    server.broadcast({ type: "ping", payload: { n: 7 } });

    const [r1, r2] = await Promise.all([m1, m2]);
    expect(r1).toEqual({ type: "ping", payload: { n: 7 } });
    expect(r2).toEqual({ type: "ping", payload: { n: 7 } });

    c1.ws.close();
    c2.ws.close();
    await Promise.all([
      new Promise((r) => c1.ws.once("close", r)),
      new Promise((r) => c2.ws.once("close", r)),
    ]);
  });
});
