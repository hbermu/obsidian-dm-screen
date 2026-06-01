# <Feature Name>

> One-paragraph purpose statement. What this feature gives the user.

## Source files

- `src/<path>.ts` — what it contributes to this feature
- `src/<path>.ts` — ...

## Settings used

- `settingKeyA` — short description (or write `none` if the feature does not touch settings)
- `settingKeyB` — ...

## Requirements

EARS patterns:
- Ubiquitous: `The <subsystem> shall <response>.`
- Event-driven: `When <trigger>, the <subsystem> shall <response>.`
- State-driven: `While <state>, the <subsystem> shall <response>.`
- Conditional: `If <condition>, then the <subsystem> shall <response>.`

1. The <subsystem> shall <response>.
2. When <event>, the <subsystem> shall <response>.
3. While <state>, the <subsystem> shall <response>.

## Broadcast / IPC

(Include this section only if the feature sends or receives WebSocket messages or workspace events. Otherwise delete it.)

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `message-name` | DM → player / player → DM / workspace event | `{ field: type }` | Triggering condition |

## Tests covering this

- `src/__tests__/<name>.test.ts` — what it asserts
- `src/__tests__/<name>.test.ts` — ...

## Non-goals

- <Things this feature explicitly does not do — guards against future scope creep>
- <One non-goal per bullet>
