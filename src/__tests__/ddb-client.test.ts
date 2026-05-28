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
            { id: "enc-1", name: "Goblin Ambush", inProgress: true, roundNum: 1, turnNum: 0, monsters: [], players: [] },
            { id: "enc-2", name: "Dragon Fight", inProgress: false, roundNum: 0, turnNum: 0, monsters: [], players: [] },
          ],
        },
      };
    });

    const client = new DdbClient("session");
    const encounters = await client.getEncounters();

    expect(encounters).toHaveLength(2);
    expect(encounters[0].name).toBe("Goblin Ambush");
    expect(encounters[0].inProgress).toBe(true);
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
          { id: "enc-1", name: "Fight", inProgress: false, roundNum: 0, turnNum: 0, monsters: [], players: [] },
        ],
      };
    });

    const client = new DdbClient("session");
    const encounters = await client.getEncounters();
    expect(encounters).toHaveLength(1);
    expect(encounters[0].name).toBe("Fight");
  });

  it("filters out abstract preset players", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: [{
            id: "enc-1", name: "Test", inProgress: false, roundNum: 0, turnNum: 0,
            monsters: [],
            players: [
              { id: "preset-player-4-0-1", type: "CHARACTER_TYPE_ABSTRACT", name: null },
              { id: "12345", type: "CHARACTER_TYPE_REAL", name: "Thorin", initiative: 18 },
            ],
          }],
        },
      };
    });

    const client = new DdbClient("session");
    const encounters = await client.getEncounters();
    expect(encounters[0].players).toHaveLength(1);
    expect(encounters[0].players[0].name).toBe("Thorin");
    expect(encounters[0].players[0].id).toBe(12345);
  });

  it("handles null/missing players and monsters gracefully", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: [{ id: "enc-1", name: "Empty", inProgress: false, roundNum: 0, turnNum: 0 }],
        },
      };
    });

    const client = new DdbClient("session");
    const encounters = await client.getEncounters();
    expect(encounters[0].players).toEqual([]);
    expect(encounters[0].monsters).toEqual([]);
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
          players: [{ id: 999, name: "Thorin", initiative: 15, type: "CHARACTER_TYPE_REAL" }],
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

  it("handles data-wrapped response", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: {
            id: "enc-99",
            name: "Wrapped",
            inProgress: false,
            roundNum: 0,
            turnNum: 0,
            monsters: [],
            players: [],
          },
        },
      };
    });

    const client = new DdbClient("session");
    const enc = await client.getEncounter("enc-99");
    expect(enc.name).toBe("Wrapped");
  });
});

describe("DdbClient - getCharacter", () => {
  it("computes HP with CON modifier and hp-per-level bonuses", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: {
            name: "Lostafar",
            baseHitPoints: 93,
            bonusHitPoints: null,
            removedHitPoints: 194,
            temporaryHitPoints: 21,
            overrideHitPoints: null,
            stats: [{ id: 3, value: 14 }],
            bonusStats: [{ id: 3, value: 2 }],
            overrideStats: [{ id: 3, value: null }],
            classes: [{ level: 18 }],
            modifiers: {
              race: [{ subType: "hit-points-per-level", type: "bonus", fixedValue: 1, value: 1 }],
              feat: [{ subType: "hit-points-per-level", type: "bonus", fixedValue: 2, value: 2 }],
            },
          },
        },
      };
    });

    const client = new DdbClient("session");
    const char = await client.getCharacter(12345);

    expect(char.name).toBe("Lostafar");
    // CON = 14 + 2 = 16, mod = +3. HP per level = 1+2 = 3.
    // maxHP = 93 + (3*18) + (3*18) = 93 + 54 + 54 = 201
    expect(char.maxHitPoints).toBe(201);
    // currentHP = max(0, 201 - 194) = 7
    expect(char.currentHitPoints).toBe(7);
    expect(char.temporaryHitPoints).toBe(21);
  });

  it("uses overrideHitPoints when set", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: {
            name: "Morrigan",
            baseHitPoints: 98,
            bonusHitPoints: 0,
            removedHitPoints: 78,
            temporaryHitPoints: 0,
            overrideHitPoints: 192,
            stats: [{ id: 3, value: 14 }],
            bonusStats: [{ id: 3, value: 4 }],
            overrideStats: [],
            classes: [{ level: 19 }],
            modifiers: {},
          },
        },
      };
    });

    const client = new DdbClient("session");
    const char = await client.getCharacter(1);

    expect(char.maxHitPoints).toBe(192);
    expect(char.currentHitPoints).toBe(114); // 192 - 78
  });

  it("clamps currentHitPoints to 0 minimum", async () => {
    mockRequestUrl((call) => {
      if (call.url.includes("cobalt-token")) {
        return { json: { token: "jwt", ttl: 3600 } };
      }
      return {
        json: {
          data: {
            name: "Downed",
            baseHitPoints: 20,
            bonusHitPoints: null,
            removedHitPoints: 30,
            temporaryHitPoints: 0,
            overrideHitPoints: null,
            stats: [{ id: 3, value: 10 }],
            bonusStats: [],
            overrideStats: [],
            classes: [{ level: 1 }],
            modifiers: {},
          },
        },
      };
    });

    const client = new DdbClient("session");
    const char = await client.getCharacter(1);

    // CON 10 = mod 0. maxHP = 20 + 0 + 0 = 20. current = max(0, 20-30) = 0
    expect(char.maxHitPoints).toBe(20);
    expect(char.currentHitPoints).toBe(0);
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
