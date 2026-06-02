import type { DdbClient } from "./client";
import type { DdbEncounter, DdbCharacterSummary } from "./types";
import { debug, debugWarn } from "../debug";

export interface DdbPolledState {
  encounter: DdbEncounter;
  characters: Map<number, DdbCharacterSummary>;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_PAUSE_MS = 30000;
const CIRCUIT_BREAKER_JITTER_RATIO = 0.2;
export const CYCLE_PAUSE_MIN_MS = 2000;
export const CYCLE_PAUSE_MAX_MS = 8000;

export class DdbEncounterPoller {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;

  constructor(
    private client: DdbClient,
    private encounterId: string,
    private onUpdate: (state: DdbPolledState) => void,
    private onError?: (error: Error) => void
  ) {}

  start(): void {
    if (this.running) return;
    debug("DDB Poller: starting for encounter", this.encounterId);
    this.running = true;
    this.consecutiveFailures = 0;
    this.schedulePoll(0);
  }

  stop(): void {
    debug("DDB Poller: stopping");
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedulePoll(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const encounter = await this.client.getEncounter(this.encounterId);
      const playerIds = (encounter.players ?? [])
        .map((p) => p.id)
        .filter((id): id is number => typeof id === "number" && id !== 0);

      const characters = new Map<number, DdbCharacterSummary>();
      const results = await Promise.allSettled(
        playerIds.map((id) => this.client.getCharacter(id))
      );
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          characters.set(playerIds[idx], r.value);
        } else {
          debugWarn(
            "DDB Poller: character fetch failed for player",
            playerIds[idx],
            (r.reason as Error)?.message
          );
        }
      });

      if (!this.running) return;
      debug(
        "DDB Poller: cycle done. Players:",
        encounter.players?.length ?? 0,
        "Monsters:",
        encounter.monsters.length
      );
      this.consecutiveFailures = 0;
      this.onUpdate({ encounter, characters });
    } catch (e) {
      this.consecutiveFailures++;
      debugWarn(
        "DDB Poller: poll failed (",
        this.consecutiveFailures,
        "/",
        CIRCUIT_BREAKER_THRESHOLD,
        "):",
        (e as Error).message
      );
      if (this.onError) this.onError(e instanceof Error ? e : new Error(String(e)));

      if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        const breaker = jitter(CIRCUIT_BREAKER_PAUSE_MS, CIRCUIT_BREAKER_JITTER_RATIO);
        debug("DDB Poller: circuit breaker open, pausing", breaker, "ms");
        this.schedulePoll(breaker);
        return;
      }
    }

    if (!this.running) return;
    const next = randomCyclePause();
    debug("DDB Poller: next cycle in", next, "ms");
    this.schedulePoll(next);
  }
}

function randomCyclePause(): number {
  return (
    CYCLE_PAUSE_MIN_MS +
    Math.floor(Math.random() * (CYCLE_PAUSE_MAX_MS - CYCLE_PAUSE_MIN_MS + 1))
  );
}

function jitter(baseMs: number, ratio: number): number {
  const spread = baseMs * ratio;
  return Math.round(baseMs - spread + Math.random() * (2 * spread));
}
