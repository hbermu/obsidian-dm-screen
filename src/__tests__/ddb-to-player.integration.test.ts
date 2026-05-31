import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "net";
import * as obsidian from "obsidian";
import { DdbClient } from "../dndbeyond/client";
import { PlayerScreenServer } from "../server";

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../test/fixtures/ddb/encounter-kokoro.json"),
    "utf8",
  ),
);

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
  await new Promise<void>((res) => {
    const addr = httpServer.address();
    if (addr && typeof addr === "object") res();
    else httpServer.once("listening", () => res());
  });
  return { server, port: (httpServer.address() as AddressInfo).port };
}

describe("DDB → Server → Player round-trip", () => {
  let server: PlayerScreenServer;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = await startServer());
  });

  afterEach(() => {
    server.stop();
    vi.restoreAllMocks();
  });

  it("hidden players from the DDB fixture never reach the wire", async () => {
    vi.spyOn(obsidian, "requestUrl").mockImplementation(((param: unknown) => {
      const url = typeof param === "string" ? param : (param as { url: string }).url;
      if (url.includes("cobalt-token")) {
        return Promise.resolve({
          status: 200,
          json: { token: "jwt", ttl: 3600 },
          text: "",
          arrayBuffer: new ArrayBuffer(0),
          headers: {},
        });
      }
      return Promise.resolve({
        status: 200,
        json: fixture,
        text: "",
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
      });
    }) as never);

    const client = new DdbClient("session");
    const encounter = await client.getEncounter("encounter-fixture");

    const combatants = [
      ...encounter.players.map((p) => ({
        name: p.name,
        hp: 0,
        maxHp: 0,
        initiative: p.initiative,
        active: false,
        isPlayer: true,
        hidden: false,
      })),
      ...encounter.monsters.map((m) => ({
        name: m.name,
        hp: m.currentHitPoints,
        maxHp: m.maximumHitPoints,
        initiative: m.initiative,
        active: false,
        isPlayer: false,
        hidden: false,
      })),
    ];

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    const messageReceived = new Promise<{ type: string; payload: { combatants: Array<{ name: string }> ; round: number } }>((res) => {
      ws.once("message", (data) => res(JSON.parse(String(data))));
    });

    server.broadcast({
      type: "initiative-update",
      payload: { combatants, round: encounter.roundNum },
    });

    const msg = await messageReceived;
    const wireNames = msg.payload.combatants.map((c) => c.name);

    expect(msg.type).toBe("initiative-update");
    expect(wireNames).not.toContain("Kokoro");
    expect(wireNames).toContain("Aria the Wizard");
    expect(wireNames).toContain("Adult Red Dragon");
    expect(msg.payload.round).toBe(1);

    ws.close();
    await new Promise((r) => ws.once("close", r));
  });
});
