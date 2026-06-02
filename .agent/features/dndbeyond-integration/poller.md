# Encounter Poller

> Long-polls the selected encounter the way a human would refresh the page: on each cycle the encounter and all PC characters are fetched in parallel (one F5-equivalent burst), then the poller waits a random human-feeling interval before the next cycle.

## Source files

- `src/dndbeyond/poller.ts` — `DdbEncounterPoller`, `CYCLE_PAUSE_MIN_MS`, `CYCLE_PAUSE_MAX_MS`, `CIRCUIT_BREAKER_THRESHOLD`, `CIRCUIT_BREAKER_PAUSE_MS`, `CIRCUIT_BREAKER_JITTER_RATIO`

## Settings used

- `none`

## Requirements

1. The poller shall expose `start` and `stop`; `start` shall be a no-op if already running, `stop` shall be safe to call when already stopped.
2. Each poll cycle shall:
   - Fetch the encounter via `client.getEncounter(encounterId)`.
   - Fetch every non-zero player character via `client.getCharacter(playerId)` **in parallel** (`Promise.allSettled`), with no inter-request delay inside the cycle. This mirrors a browser refresh loading the encounter subresources in one burst.
   - Invoke `onUpdate({ encounter, characters })` with the partial character map; a rejected character promise is logged via `debugWarn` and skipped.
3. On a successful cycle, the consecutive-failure counter shall reset to `0`.
4. On a failed cycle (the encounter fetch itself failing), the counter shall increment and `onError(err)` shall be invoked.
5. If consecutive failures reach `CIRCUIT_BREAKER_THRESHOLD` (3), the next poll shall be scheduled `CIRCUIT_BREAKER_PAUSE_MS` (30 000 ms) ± `CIRCUIT_BREAKER_JITTER_RATIO` (20 %) in the future, and the failure counter shall be cleared at the next successful cycle.
6. Otherwise, the next poll shall be scheduled after a random delay uniformly distributed in `[CYCLE_PAUSE_MIN_MS, CYCLE_PAUSE_MAX_MS]` (2 000 – 8 000 ms). This emulates a human pressing F5 at irregular intervals; a constant inter-cycle delay would be detectable as a bot.
7. While `running === false`, no new poll shall be scheduled and any in-flight cycle shall stop emitting after its next opportunity.
8. A character fetch failure shall not abort the cycle: other characters continue, and `onUpdate` is still invoked with whatever characters did succeed.

## Tests covering this

- `src/__tests__/ddb-poller.test.ts` — cadence range, parallel intra-cycle fetches, circuit breaker, stop semantics, partial character failure tolerance

## Non-goals

- Adaptive cadence based on encounter state. The range stays the same whether the DM just advanced a turn or the encounter is idle — a real human refreshes irregularly without that signal either.
- Cross-encounter polling. Exactly one encounter at a time.
- Resuming with the previous failure count after stop / start. `start` resets to zero.
- Cancelling in-flight HTTP requests. The poller only checks `running` between awaits.
- Surfacing the cadence range as user-facing settings.
