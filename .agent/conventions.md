# Conventions for `.agent/` specs

## EARS notation

All requirements are written using EARS (Easy Approach to Requirements Syntax). EARS constrains free-form text into four patterns; together they express almost everything a feature can require. Use one pattern per requirement; do not combine sentences. Requirements are numbered within their section.

The four patterns:

1. **Ubiquitous** — Always active.
   - Form: `The <subsystem> shall <response>.`
   - Example: `The player-screen server shall listen on the port stored in settings.serverPort.`

2. **Event-driven** — Triggered by a specific event.
   - Form: `When <trigger>, the <subsystem> shall <response>.`
   - Example: `When a WebSocket client sends a client-info message, the server shall record the client's resolution.`

3. **State-driven** — Active while a condition holds.
   - Form: `While <state>, the <subsystem> shall <response>.`
   - Example: `While no player is connected, the DM panel shall show "Stopped" in the server status.`

4. **Conditional / optional** — Active when a condition is true.
   - Form: `If <condition>, then the <subsystem> shall <response>.`
   - Example: `If the connected client count equals one, then the DM preview shall show a green viewport indicator.`

Combinations are allowed when the meaning is clearer that way, e.g. `While combat is broadcasting, when the round is 1, the server shall hide combatants whose turn has not happened yet.`

Use the word `shall` for every requirement. Do not use "should", "may", or "will" — those are non-requirements.

## Spec format

Every feature spec uses the structure in `features/_template.md`. Mandatory sections, in order:

1. **Title** (`# <Feature Name>`)
2. **Purpose** — one paragraph, no more
3. **Source files** — file paths under `src/` with a short note on what each contributes
4. **Settings used** — keys from `DmScreenSettings` the feature reads or writes; "none" if it doesn't touch settings
5. **Requirements** — numbered EARS list
6. **Broadcast / IPC** — only if the feature sends or receives WebSocket messages or workspace events; otherwise omit the section
7. **Tests covering this** — paths under `src/__tests__/` and one-line summaries
8. **Non-goals** — explicit list of things this feature does not do (guards against scope creep)

## Naming

- File names are `kebab-case.md`.
- Use plural for collections (`monster-images.md` not `monster-image.md`).
- Directories match the feature dir under `features/` (e.g. `hydrus-integration/`).

## Update rule

Behaviour change → spec change, same commit. This is non-negotiable. Drift between code and spec is treated as a bug.

If a code change merely refactors without altering observable behaviour, no spec change is required — but adding source-file paths to the spec is encouraged when files are renamed or split.

## Deletion rule

When a feature is removed, delete its spec directory in the same commit. Never leave tombstone files, `(removed)` markers, or commented-out spec sections. The history of the repo is the history of the spec; old commits document old behaviour.

## No-external-references rule

Specs reference only:
- Files in this repo (paths relative to repo root).
- Identifiers defined in this repo.
- Settings keys defined in `src/settings.ts`.
- Other specs under `.agent/features/`.

Specs MUST NOT contain:
- URLs to external sites, documentation, or services.
- Links to third-party plugins or repos.
- References to external standards documents (including this one — EARS is summarised above, not linked).

External services (Hydrus Network, D&D Beyond, the Initiative Tracker plugin, Fantasy Statblocks) may be **named** when the spec describes integrating with them, but never linked.
