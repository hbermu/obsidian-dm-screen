import type { DdbClient } from "./client";
import type { DdbEncounter, DdbCharacterSummary } from "./types";
import { debug, debugWarn } from "../debug";

export interface DdbPolledState {
  encounter: DdbEncounter;
  characters: Map<number, DdbCharacterSummary>;
}

const MIN_REQUEST_GAP_MS = 1000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_PAUSE_MS = 30000;
const MIN_CYCLE_PAUSE_MS = 2000;

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
    const cycleStart = Date.now();

    try {
      const encounter = await this.client.getEncounter(this.encounterId);
      const characters = new Map<number, DdbCharacterSummary>();
      const players = encounter.players ?? [];
      debug("DDB Poller: fetched encounter. Players:", players.length, "Monsters:", encounter.monsters.length);

      for (const player of players) {
        if (!this.running) return;
        if (!player.id || player.id === 0) continue;
        await this.delay(MIN_REQUEST_GAP_MS);
        try {
          const char = await this.client.getCharacter(player.id);
          characters.set(player.id, char);
        } catch (e) {
          debugWarn("DDB Poller: character fetch failed for player", player.id, (e as Error).message);
        }
      }

      this.consecutiveFailures = 0;
      this.onUpdate({ encounter, characters });
    } catch (e) {
      this.consecutiveFailures++;
      debugWarn("DDB Poller: poll failed (", this.consecutiveFailures, "/", CIRCUIT_BREAKER_THRESHOLD, "):", (e as Error).message);
      if (this.onError) this.onError(e instanceof Error ? e : new Error(String(e)));

      if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        debug("DDB Poller: circuit breaker open, pausing", CIRCUIT_BREAKER_PAUSE_MS, "ms");
        this.schedulePoll(CIRCUIT_BREAKER_PAUSE_MS);
        return;
      }
    }

    if (!this.running) return;
    this.schedulePoll(MIN_CYCLE_PAUSE_MS);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
