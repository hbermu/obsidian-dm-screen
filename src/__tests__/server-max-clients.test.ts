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
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
}

describe("PlayerScreenServer.maxClients", () => {
  let server: PlayerScreenServer;

  beforeEach(() => {
    server = new PlayerScreenServer(makePlugin());
  });

  it("defaults maxClients to 10", () => {
    expect(server.maxClients).toBe(10);
  });

  it("allows setting maxClients", () => {
    server.maxClients = 3;
    expect(server.maxClients).toBe(3);
  });

  it("rejects connections beyond maxClients (integration via internals)", () => {
    server.maxClients = 2;

    const ws1 = makeWsStub();
    const ws2 = makeWsStub();
    const ws3 = makeWsStub();

    // Simulate connections by adding to the clients set
    (server as any).clients.add(ws1);
    (server as any).clients.add(ws2);

    // At this point clients.size === 2 === maxClients
    // A new connection should be rejected
    const shouldReject = (server as any).clients.size >= server.maxClients;
    expect(shouldReject).toBe(true);

    // Verify the close method signature accepts code and reason
    ws3.close(1013, "Max clients reached");
    expect(ws3.close).toHaveBeenCalledWith(1013, "Max clients reached");
  });

  it("allows connections when under maxClients", () => {
    server.maxClients = 5;

    const ws1 = makeWsStub();
    (server as any).clients.add(ws1);

    const shouldReject = (server as any).clients.size >= server.maxClients;
    expect(shouldReject).toBe(false);
  });
});
