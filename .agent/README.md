# `.agent/`

This directory is the contract between the AI and the codebase. Everything in here is canonical: when behaviour and the spec disagree, treat the spec as authoritative until the inconsistency is resolved (either by fixing the code or by updating the spec in the same commit).

## What is here

- `conventions.md` — How specs are written. Defines EARS notation, the spec template, naming, and the update / deletion rules.
- `features/` — One subdirectory per user-facing feature. Each subdirectory contains an `overview.md` plus zero or more sub-spec files for finer sub-functionalities (e.g. `hydrus-integration/cache.md`).

## Priority and ownership

- `.agent/features/**` is the source of truth for observable behaviour.
- `AGENTS.md` defines repository-wide implementation workflow and guardrails.
- `CLAUDE.md` carries only agent-specific additions and must never contradict the two sources above.
- If any one of these files is updated with globally applicable guidance, update the other affected files in the same PR to keep one coherent IA/AI docs set.

## What is not here

- Architectural diagrams, design rationale, or "how we got here" prose. The architecture is the source code; the spec describes the observable contract, not the implementation strategy.
- Tasks, TODOs, planning notes, or change logs. Tasks belong to a session, not to the docs.
- Tombstone files for removed features. Deleted features are deleted, not deprecated.
- External references: no URLs, no third-party docs, no service links. The repo `README.md` is the only place those belong.

## How to use it

1. Before changing code in a subsystem, read the matching `features/<feature>/overview.md` and any sub-spec files relevant to your change.
2. Implement the change.
3. Update the affected spec file(s) in the same commit. Use the template at `features/_template.md`.
4. If you remove a feature entirely, delete its spec directory in the same commit.
5. Run `make typecheck && make test` before committing.
