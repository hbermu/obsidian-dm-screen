import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "net";
import { PlayerScreenServer } from "../server";

function makePlugin() {
  return {
    app: { vault: { getAbstractFileByPath: () => null, readBinary: async () => new ArrayBuffer(0), adapter: {} } },
    settings: { serverPort: 0 },
  } as any;
}

function startServer(): Promise<{ server: PlayerScreenServer; port: number }> {
  const server = new PlayerScreenServer(makePlugin());
  server.start(0);
  const httpServer = (server as any).httpServer as http.Server;
  return new Promise((resolve) => {
    httpServer.once("listening", () => {
      resolve({ server, port: (httpServer.address() as AddressInfo).port });
    });
  });
}

function keepAliveGet(port: number, agent: http.Agent): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", agent }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve());
    });
    req.on("error", reject);
  });
}

describe("PlayerScreenServer.stop() releases the port despite idle keep-alive sockets", () => {
  let agent: http.Agent | null = null;

  afterEach(() => {
    agent?.destroy();
    agent = null;
  });

  it("destroys lingering keep-alive connections so the port is immediately rebindable", async () => {
    const { server, port } = await startServer();

    // A pooled keep-alive client leaves an idle socket parked on the port —
    // the exact condition that kept the old port bound on Node <19.
    agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    await keepAliveGet(port, agent);

    server.stop();

    // If stop() only called httpServer.close(), the idle keep-alive socket
    // would hold the listener open and this rebind would throw EADDRINUSE.
    const rebound = new PlayerScreenServer(makePlugin());
    await new Promise<void>((resolve, reject) => {
      rebound.start(port);
      const hs = (rebound as any).httpServer as http.Server;
      hs.once("listening", () => resolve());
      hs.once("error", reject);
    });
    rebound.stop();
  });
});
