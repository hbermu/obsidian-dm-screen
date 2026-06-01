# Encounter Poller

> Long-polls the selected encounter, then fetches each player character's HP, then pushes one `DdbPolledState` per cycle. Self-throttles to be a good citizen of the upstream service.

## Source files

- `src/dndbeyond/poller.ts` — `DdbEncounterPoller`, `MIN_REQUEST_GAP_MS`, `CIRCUIT_BREAKER_THRESHOLD`, `CIRCUIT_BREAKER_PAUSE_MS`, `MIN_CYCLE_PAUSE_MS`

## Settings used

- `none`

## Requirements

1. The poller shall expose `start` and `stop`; `start` shall be a no-op if already running, `stop` shall be safe to call when already stopped.
2. Each poll cycle shall:
   - Fetch the encounter via `client.getEncounter(encounterId)`.
   - For each non-zero player ID in the encounter, wait `MIN_REQUEST_GAP_MS` (1000 ms) then fetch the character via `client.getCharacter(playerId)`.
   - Invoke `onUpdate({ encounter, characters })`.
3. On a successful cycle, the consecutive-failure counter shall reset to `0`.
4. On a failed cycle, the counter shall increment and `onError(err)` shall be invoked.
5. If consecutive failures reach `CIRCUIT_BREAKER_THRESHOLD` (3), the next poll shall be scheduled `CIRCUIT_BREAKER_PAUSE_MS` (30 000 ms) in the future and the failure counter shall be cleared at the next success.
6. Otherwise, the next poll shall be scheduled `MIN_CYCLE_PAUSE_MS` (2000 ms) after the cycle completes.
7. While `running === false`, no new poll shall be scheduled and any in-flight cycle shall stop emitting after its next opportunity.
8. A character fetch failure shall be logged via `debugWarn` and shall not abort the cycle (other characters continue, and `onUpdate` is still invoked with the partial map).

## Tests covering this

- `src/__tests__/ddb-poller.test.ts` — cadence, circuit breaker, stop semantics, partial character failure tolerance

## Non-goals

- Adaptive cadence based on encounter state. Pause times are fixed constants.
- Cross-encounter polling. Exactly one encounter at a time.
- Resuming with the previous failure count after stop / start. `start` resets to zero.
- Cancelling in-flight HTTP requests. The poller only checks `running` between awaits.
