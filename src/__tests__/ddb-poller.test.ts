import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DdbEncounter, DdbCharacterSummary } from "../dndbeyond/types";
import {
  DdbEncounterPoller,
  CYCLE_PAUSE_MIN_MS,
  CYCLE_PAUSE_MAX_MS,
  type DdbPolledState,
} from "../dndbeyond/poller";

function createMockClient(opts?: {
  encounterFails?: boolean;
  characterFails?: boolean;
  encounter?: Partial<DdbEncounter>;
}) {
  const encounter: DdbEncounter = {
    id: "enc-1",
    name: "Test Fight",
    inProgress: true,
    roundNum: 2,
    turnNum: 0,
    monsters: [{ id: 1, name: "Goblin", initiative: 14, currentHitPoints: 7, maximumHitPoints: 7, uniqueId: "g1", avatarUrl: "" }],
    players: [{ id: 100, name: "Thorin", initiative: 18 }],
    manualEntries: [],
    ...opts?.encounter,
  };

  return {
    getEncounter: vi.fn(async () => {
      if (opts?.encounterFails) throw new Error("network error");
      return encounter;
    }),
    getCharacter: vi.fn(async (id: number): Promise<DdbCharacterSummary> => {
      if (opts?.characterFails) throw new Error("char fetch failed");
      return { id, name: `Player-${id}`, currentHitPoints: 30, maxHitPoints: 40, temporaryHitPoints: 0, statuses: [], inspired: false };
    }),
  } as any;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DdbEncounterPoller", () => {
  it("calls onUpdate with encounter and character data", async () => {
    const client = createMockClient();
    const updates: DdbPolledState[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", (state) => updates.push(state));

    poller.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(updates).toHaveLength(1);
    expect(updates[0].encounter.name).toBe("Test Fight");
    expect(updates[0].characters.get(100)?.name).toBe("Player-100");
    poller.stop();
  });

  it("stops polling when stop() is called", async () => {
    const client = createMockClient();
    const updates: DdbPolledState[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", (state) => updates.push(state));

    poller.start();
    await vi.advanceTimersByTimeAsync(10);
    poller.stop();

    const countAfterStop = updates.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(updates.length).toBe(countAfterStop);
  });

  it("triggers circuit breaker after 3 consecutive failures", async () => {
    const client = createMockClient({ encounterFails: true });
    const errors: Error[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", () => {}, (e) => errors.push(e));

    poller.start();

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(CYCLE_PAUSE_MAX_MS + 50);
    }
    expect(errors.length).toBeGreaterThanOrEqual(3);

    const callsBefore = client.getEncounter.mock.calls.length;
    await vi.advanceTimersByTimeAsync(Math.ceil(30000 * 1.25));
    expect(client.getEncounter.mock.calls.length).toBeGreaterThan(callsBefore);

    poller.stop();
  });

  it("continues polling even if individual character fetch fails", async () => {
    const client = createMockClient({ characterFails: true });
    const updates: DdbPolledState[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", (state) => updates.push(state));

    poller.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(updates).toHaveLength(1);
    expect(updates[0].encounter.name).toBe("Test Fight");
    expect(updates[0].characters.size).toBe(0);
    poller.stop();
  });

  it("does not start twice", async () => {
    const client = createMockClient();
    const updates: DdbPolledState[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", (state) => updates.push(state));

    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(updates).toHaveLength(1);
    poller.stop();
  });

  it("fetches all PC characters in parallel within a cycle (no intra-cycle delay)", async () => {
    const client = createMockClient({
      encounter: {
        players: [
          { id: 100, name: "A", initiative: 18 },
          { id: 200, name: "B", initiative: 17 },
          { id: 300, name: "C", initiative: 16 },
          { id: 400, name: "D", initiative: 15 },
        ],
      },
    });
    const poller = new DdbEncounterPoller(client, "enc-1", () => {});

    poller.start();
    // 10 ms is enough to fire the start setTimeout(0) and flush microtasks.
    // With the old (sequential, 1 s per character) model only one
    // getCharacter call would have happened; the parallel model fires all four.
    await vi.advanceTimersByTimeAsync(10);
    expect(client.getCharacter).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it("inter-cycle pause respects [CYCLE_PAUSE_MIN_MS, CYCLE_PAUSE_MAX_MS]", async () => {
    const client = createMockClient();
    const poller = new DdbEncounterPoller(client, "enc-1", () => {});

    // Drive Math.random() deterministically: 0 at end of cycle 1 (→ MIN pause),
    // ~1 at end of cycle 2 (→ MAX pause). Anything after we don't care about.
    let randIdx = 0;
    vi.spyOn(Math, "random").mockImplementation(
      () => [0, 0.999999, 0][randIdx++] ?? 0
    );
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    poller.start();
    await vi.advanceTimersByTimeAsync(10); // cycle 1 fires, schedules cycle 2 at MIN
    await vi.advanceTimersByTimeAsync(CYCLE_PAUSE_MIN_MS + 100); // cycle 2 fires, schedules cycle 3 at MAX
    poller.stop();

    const cycleDelays = setTimeoutSpy.mock.calls
      .map((c) => c[1])
      .filter((d): d is number => typeof d === "number" && d > 0);
    expect(cycleDelays).toEqual([CYCLE_PAUSE_MIN_MS, CYCLE_PAUSE_MAX_MS]);
  });
});
