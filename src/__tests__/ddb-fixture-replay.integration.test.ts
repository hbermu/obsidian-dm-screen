import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { DdbClient } from "../dndbeyond/client";

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../test/fixtures/ddb/encounter-kokoro.json"),
    "utf8",
  ),
);

afterEach(() => {
  vi.restoreAllMocks();
});

function mockEncounterResponse(payload: unknown) {
  return vi.spyOn(obsidian, "requestUrl").mockImplementation(((param: unknown) => {
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
      json: payload,
      text: "",
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    });
  }) as never);
}

describe("DDB fixture replay - encounter-kokoro.json", () => {
  it("parses a real sanitized encounter and drops the hidden player", async () => {
    mockEncounterResponse(fixture);

    const client = new DdbClient("session");
    const encounter = await client.getEncounter("encounter-fixture");

    const playerNames = encounter.players.map((p) => p.name);
    expect(playerNames).not.toContain("Kokoro");
    expect(encounter.players).toHaveLength(4);

    expect(playerNames).toEqual(
      expect.arrayContaining(["Aria the Wizard", "Borin the Bard", "Cael the Monk", "Dorin the Warlock"]),
    );

    expect(encounter.monsters.map((m) => m.name)).toEqual([
      "Adult Red Dragon",
      "Young Red Dragon (A)",
      "Young Red Dragon (B)",
    ]);

    expect(encounter.roundNum).toBe(1);
    expect(encounter.turnNum).toBe(1);
    expect(encounter.inProgress).toBe(true);
  });

  it("handles an encounter that is not in progress (roundNum stays 0, no active turn)", async () => {
    const idle = {
      data: {
        ...fixture.data,
        inProgress: false,
        roundNum: 0,
        turnNum: 0,
      },
    };
    mockEncounterResponse(idle);

    const client = new DdbClient("session");
    const encounter = await client.getEncounter("encounter-fixture");

    expect(encounter.inProgress).toBe(false);
    expect(encounter.roundNum).toBe(0);
    expect(encounter.turnNum).toBe(0);
    // The roster still parses end-to-end even when combat hasn't started.
    expect(encounter.players.length).toBeGreaterThan(0);
    expect(encounter.monsters.length).toBeGreaterThan(0);
  });

  it("parses manualEntries alongside players and monsters", async () => {
    const withManual = {
      data: {
        ...fixture.data,
        manualEntries: [
          {
            id: "manual-1",
            name: "Town Guard",
            initiative: 11,
            currentHitPoints: 18,
            maximumHitPoints: 22,
          },
          {
            id: "manual-2",
            name: "Innkeeper",
            initiative: 4,
            currentHitPoints: 9,
            maximumHitPoints: 9,
          },
        ],
      },
    };
    mockEncounterResponse(withManual);

    const client = new DdbClient("session");
    const encounter = await client.getEncounter("encounter-fixture");

    expect(encounter.manualEntries).toHaveLength(2);
    const guard = encounter.manualEntries.find((e) => e.name === "Town Guard")!;
    expect(guard.initiative).toBe(11);
    expect(guard.currentHitPoints).toBe(18);
    expect(guard.maximumHitPoints).toBe(22);
    expect(guard.id).toBe("manual-1");
  });
});
