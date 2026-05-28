import type { DdbClient } from "./client";
import type { DdbEncounter, DdbCharacterSummary } from "./types";

export interface DdbPolledState {
  encounter: DdbEncounter;
  characters: Map<number, DdbCharacterSummary>;
}

const MIN_REQUEST_GAP_MS = 1000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_PAUSE_MS = 30000;
const MIN_CYCLE_MS = 5000;

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
    this.running = true;
    this.consecutiveFailures = 0;
    this.schedulePoll(0);
  }

  stop(): void {
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

      for (const player of players) {
        if (!this.running) return;
        if (!player.id || player.id === 0) continue;
        await this.delay(MIN_REQUEST_GAP_MS);
        try {
          const char = await this.client.getCharacter(player.id);
          characters.set(player.id, char);
        } catch {
          // Individual character fetch failure is non-fatal
        }
      }

      this.consecutiveFailures = 0;
      this.onUpdate({ encounter, characters });
    } catch (e) {
      this.consecutiveFailures++;
      if (this.onError) this.onError(e instanceof Error ? e : new Error(String(e)));

      if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        this.schedulePoll(CIRCUIT_BREAKER_PAUSE_MS);
        return;
      }
    }

    if (!this.running) return;
    const elapsed = Date.now() - cycleStart;
    const nextDelay = Math.max(0, MIN_CYCLE_MS - elapsed);
    this.schedulePoll(nextDelay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
