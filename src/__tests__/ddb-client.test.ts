import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { DdbClient } from "../dndbeyond/client";

interface MockCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function mockRequestUrl(
  handler: (call: MockCall) => { status?: number; json?: unknown; text?: string }
) {
  return vi.spyOn(obsidian, "requestUrl").mockImplementation(((param: unknown) => {
    const p = typeof param === "string" ? { url: param } : (param as MockCall);
    const out = handler(p);
    return Promise.resolve({
      status: out.status ?? 200,
      json: out.json ?? {},
      text: out.text ?? "",
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    });
  }) as any);
}

afterEach(() => { vi.restoreAllMocks(); });

describe("DdbClient - token exchange", () => {
  it("exchanges CobaltSession for Bearer token", async () => {
    const calls: MockCall[] = [];
    mockRequestUrl((call) => {
      calls.push(call);
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt-abc", ttl: 3600 } };
      }
      return { json: { data: [] } };
    });

    const client = new DdbClient("my-session-cookie");
    await client.getEncounters();

    expect(calls[0].url).toContain("auth-service.dndbeyond.com/v1/cobalt-token");
    expect(calls[0].headers?.Cookie).toBe("CobaltSession=my-session-cookie");
    expect(calls[0].method).toBe("POST");
  });

  it("uses cached token for subsequent requests", async () => {
    let tokenRequests = 0;
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        tokenRequests++;
        return { json: { token: "jwt-abc", ttl: 3600 } };
      }
      return { json: { data: [] } };
    });

    const client = new DdbClient("session");
    await client.getEncounters();
    await client.getEncounters();

    expect(tokenRequests).toBe(1);
  });

  it("validateSession returns true on successful auth", async () => {
    mockRequestUrl(() => ({ json: { token: "jwt", ttl: 3600 } }));
    const client = new DdbClient("valid-session");
    expect(await client.validateSession()).toBe(true);
  });

  it("validateSession returns false on auth failure", async () => {
    mockRequestUrl(() => ({ status: 401, json: {} }));
    const client = new DdbClient("expired-session");
    expect(await client.validateSession()).toBe(false);
  });

  it("throws on missing CobaltSession", () => {
    expect(() => new DdbClient("")).toThrow("CobaltSession cookie is required");
  });
});

describe("DdbClient - getEncounters", () => {
  it("fetches encounter list with auth header", async () => {
    const calls: MockCall[] = [];
    mockRequestUrl((call) => {
      calls.push(call);
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt-123", ttl: 3600 } };
      }
      return {
        json: {
          data: [
            { id: "enc-1", name: "Goblin Ambush", inProgress: true },
            { id: "enc-2", name: "Dragon Fight", inProgress: false },
          ],
        },
      };
    });

    const client = new DdbClient("session");
    const encounters = await client.getEncounters();

    expect(encounters).toHaveLength(2);
    expect(encounters[0]).toEqual({ id: "enc-1", name: "Goblin Ambush", inProgress: true });
    expect(calls[1].headers?.Authorization).toBe("Bearer jwt-123");
    expect(calls[1].url).toContain("encounter-service.dndbeyond.com");
  });

  it("handles array response format", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: [
          { id: "enc-1", name: "Fight", inProgress: false },
        ],
      };
    });

    const client = new DdbClient("session");
    const encounters = await client.getEncounters();
    expect(encounters).toHaveLength(1);
    expect(encounters[0].name).toBe("Fight");
  });
});

describe("DdbClient - getEncounter", () => {
  it("fetches single encounter by id", async () => {
    let capturedUrl = "";
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      capturedUrl = call.url;
      return {
        json: {
          id: "enc-42",
          name: "Boss",
          inProgress: true,
          roundNum: 3,
          turnNum: 1,
          monsters: [{ id: 1, name: "Dragon", initiative: 20, currentHitPoints: 100, maximumHitPoints: 200, uniqueId: "u1" }],
          players: [{ id: 999, name: "Thorin", initiative: 15 }],
        },
      };
    });

    const client = new DdbClient("session");
    const enc = await client.getEncounter("enc-42");

    expect(capturedUrl).toContain("/encounters/enc-42");
    expect(enc.name).toBe("Boss");
    expect(enc.monsters).toHaveLength(1);
    expect(enc.players).toHaveLength(1);
    expect(enc.roundNum).toBe(3);
  });
});

describe("DdbClient - getCharacter", () => {
  it("computes HP from character data", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: {
            name: "Gandalf",
            baseHitPoints: 45,
            bonusHitPoints: 5,
            removedHitPoints: 10,
            temporaryHitPoints: 3,
            overrideHitPoints: null,
          },
        },
      };
    });

    const client = new DdbClient("session");
    const char = await client.getCharacter(12345);

    expect(char.name).toBe("Gandalf");
    expect(char.maxHitPoints).toBe(50); // 45 + 5
    expect(char.currentHitPoints).toBe(40); // 50 - 10
    expect(char.temporaryHitPoints).toBe(3);
  });

  it("uses overrideHitPoints when set", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: {
            name: "Buffed",
            baseHitPoints: 30,
            bonusHitPoints: 0,
            removedHitPoints: 5,
            temporaryHitPoints: 0,
            overrideHitPoints: 100,
          },
        },
      };
    });

    const client = new DdbClient("session");
    const char = await client.getCharacter(1);

    expect(char.maxHitPoints).toBe(100);
    expect(char.currentHitPoints).toBe(95);
  });

  it("invalidates token on 401 and throws", async () => {
    let callCount = 0;
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      callCount++;
      return { status: 401, json: {} };
    });

    const client = new DdbClient("session");
    await expect(client.getCharacter(1)).rejects.toThrow("DDB session expired");
  });
});
