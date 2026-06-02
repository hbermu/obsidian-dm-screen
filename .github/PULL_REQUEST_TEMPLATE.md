<!--
**Release type**: by default this PR will trigger a patch release on merge.
Apply one of these labels to override:
  - `release:minor` — bump 0.x.0
  - `release:major` — bump x.0.0
  - `release:skip`  — no release on merge

**Spec update**: if this PR changes `src/` but the change is genuinely
behaviour-free, apply `spec:not-needed` to bypass the spec-update check.
-->

## Summary

<!-- 1–3 bullets describing the change -->

## Type of change

<!-- Tick exactly one. The PR title type and the branch prefix must match the tick. -->

- [ ] feature / feat
- [ ] fix
- [ ] hotfix
- [ ] chore
- [ ] refactor
- [ ] docs
- [ ] test
- [ ] ci
- [ ] release

## Spec updates

<!-- Tick exactly one. The update rule is in .agent/conventions.md. -->

- [ ] Behaviour changed and the matching `.agent/features/<feature>/<file>.md` was updated in this PR
- [ ] No observable behaviour change (pure refactor / docs / ci / chore / test)
- [ ] Feature removed and its spec directory deleted in this PR

## Tests

- [ ] `make test` passes locally
- [ ] `make typecheck` passes locally
- [ ] `make build` passes locally
