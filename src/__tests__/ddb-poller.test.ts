import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DdbEncounter, DdbCharacterSummary } from "../dndbeyond/types";
import { DdbEncounterPoller, type DdbPolledState } from "../dndbeyond/poller";

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
    monsters: [{ id: 1, name: "Goblin", initiative: 14, currentHitPoints: 7, maximumHitPoints: 7, uniqueId: "g1" }],
    players: [{ id: 100, name: "Thorin", initiative: 18 }],
    ...opts?.encounter,
  };

  return {
    getEncounter: vi.fn(async () => {
      if (opts?.encounterFails) throw new Error("network error");
      return encounter;
    }),
    getCharacter: vi.fn(async (id: number): Promise<DdbCharacterSummary> => {
      if (opts?.characterFails) throw new Error("char fetch failed");
      return { id, name: `Player-${id}`, currentHitPoints: 30, maxHitPoints: 40, temporaryHitPoints: 0 };
    }),
  } as any;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("DdbEncounterPoller", () => {
  it("calls onUpdate with encounter and character data", async () => {
    const client = createMockClient();
    const updates: DdbPolledState[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", (state) => updates.push(state));

    poller.start();
    await vi.advanceTimersByTimeAsync(100);
    // Allow the delay(500) + poll to complete
    await vi.advanceTimersByTimeAsync(600);

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
    await vi.advanceTimersByTimeAsync(700);
    poller.stop();

    const countAfterStop = updates.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(updates.length).toBe(countAfterStop);
  });

  it("triggers circuit breaker after 3 consecutive failures", async () => {
    const client = createMockClient({ encounterFails: true });
    const errors: Error[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", () => {}, (e) => errors.push(e));

    poller.start();

    // 3 failures with MIN_CYCLE_MS between them
    await vi.advanceTimersByTimeAsync(100); // 1st failure
    await vi.advanceTimersByTimeAsync(2500); // 2nd failure
    await vi.advanceTimersByTimeAsync(2500); // 3rd failure

    expect(errors.length).toBeGreaterThanOrEqual(3);

    // After circuit break (30s), should try again
    const callsBefore = client.getEncounter.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(client.getEncounter.mock.calls.length).toBeGreaterThan(callsBefore);

    poller.stop();
  });

  it("continues polling even if individual character fetch fails", async () => {
    const client = createMockClient({ characterFails: true });
    const updates: DdbPolledState[] = [];
    const poller = new DdbEncounterPoller(client, "enc-1", (state) => updates.push(state));

    poller.start();
    await vi.advanceTimersByTimeAsync(700);

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
    poller.start(); // no-op
    await vi.advanceTimersByTimeAsync(700);

    expect(updates).toHaveLength(1);
    poller.stop();
  });
});
