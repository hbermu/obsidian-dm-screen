# Changelog

Automatically maintained by `.github/workflows/release.yml` after every stable release. Do not edit by hand — changes are overwritten on the next publish.

## v0.18.1 — patch — 2026-06-11

### Features
- feat(webhook-send): share image layers via generic multipart webhooks (#41)
- feat(combat-tracker): D&D Beyond heroic inspiration highlight (#37)
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(player-server): restrict /vault/ to currently-displayed files (#42)
- fix(combat-tracker): wrap long PC names so HP/condition stay in the panel (#39)
- fix(combat-tracker): gold inspired glow that clips to panel (#38)
- fix(repo): DDB cache sweep, Hydrus sweep hardening, DM zoom reset (#32)
- fix(dm-panel): fog of war events, no wheel-zoom, responsive layout polish (#31)
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): add spec verification protocol to AI workflow (#34)
- docs(repo): align specs with implementation (#33)
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- chore(repo): clean up all betas when any stable ships (#40)
- ci(repo): block beta publish when stable of that line exists (#36)
- chore(repo): bump version files to 0.15.2 to stop beta re-trigger (#35)
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.18.1

## v0.18.0 — minor — 2026-06-10

### Features
- feat(webhook-send): share image layers via generic multipart webhooks (#41)
- feat(combat-tracker): D&D Beyond heroic inspiration highlight (#37)
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(combat-tracker): wrap long PC names so HP/condition stay in the panel (#39)
- fix(combat-tracker): gold inspired glow that clips to panel (#38)
- fix(repo): DDB cache sweep, Hydrus sweep hardening, DM zoom reset (#32)
- fix(dm-panel): fog of war events, no wheel-zoom, responsive layout polish (#31)
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): add spec verification protocol to AI workflow (#34)
- docs(repo): align specs with implementation (#33)
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- chore(repo): clean up all betas when any stable ships (#40)
- ci(repo): block beta publish when stable of that line exists (#36)
- chore(repo): bump version files to 0.15.2 to stop beta re-trigger (#35)
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.18.0

## v0.17.0 — minor — 2026-06-08

### Features
- feat(combat-tracker): D&D Beyond heroic inspiration highlight (#37)
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(combat-tracker): wrap long PC names so HP/condition stay in the panel (#39)
- fix(combat-tracker): gold inspired glow that clips to panel (#38)
- fix(repo): DDB cache sweep, Hydrus sweep hardening, DM zoom reset (#32)
- fix(dm-panel): fog of war events, no wheel-zoom, responsive layout polish (#31)
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): add spec verification protocol to AI workflow (#34)
- docs(repo): align specs with implementation (#33)
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(repo): block beta publish when stable of that line exists (#36)
- chore(repo): bump version files to 0.15.2 to stop beta re-trigger (#35)
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.17.0

## v0.16.1 — patch — 2026-06-05

### Features
- feat(combat-tracker): D&D Beyond heroic inspiration highlight (#37)
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(combat-tracker): gold inspired glow that clips to panel (#38)
- fix(repo): DDB cache sweep, Hydrus sweep hardening, DM zoom reset (#32)
- fix(dm-panel): fog of war events, no wheel-zoom, responsive layout polish (#31)
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): add spec verification protocol to AI workflow (#34)
- docs(repo): align specs with implementation (#33)
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(repo): block beta publish when stable of that line exists (#36)
- chore(repo): bump version files to 0.15.2 to stop beta re-trigger (#35)
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.16.1

## v0.16.0 — minor — 2026-06-05

### Features
- feat(combat-tracker): D&D Beyond heroic inspiration highlight (#37)
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(repo): DDB cache sweep, Hydrus sweep hardening, DM zoom reset (#32)
- fix(dm-panel): fog of war events, no wheel-zoom, responsive layout polish (#31)
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): add spec verification protocol to AI workflow (#34)
- docs(repo): align specs with implementation (#33)
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(repo): block beta publish when stable of that line exists (#36)
- chore(repo): bump version files to 0.15.2 to stop beta re-trigger (#35)
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.16.0

## v0.15.2 — patch — 2026-06-05

### Features
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(repo): DDB cache sweep, Hydrus sweep hardening, DM zoom reset (#32)
- fix(dm-panel): fog of war events, no wheel-zoom, responsive layout polish (#31)
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.15.2

## v0.15.1 — patch — 2026-06-05

### Features
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(dm-panel): fog of war events, no wheel-zoom, responsive layout polish (#31)
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.15.1

## v0.15.0 — minor — 2026-06-05

### Features
- feat(combat-tracker): D&D 5e conditions on PC/monster/manual rows (#30)
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.15.0

## v0.14.2 — patch — 2026-06-04

### Features
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(player-server): sanitize payload URLs (closes 8 CodeQL alerts) (#29)
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.14.2

## v0.14.1 — patch — 2026-06-04

### Features
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(image-layers): drag stability, save-state cascade, and DM-preview border alignment (#28)
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.14.1

## v0.14.0 — minor — 2026-06-04

### Features
- feat(dndbeyond): encounter modal, player preview, reveal toggle, Live button, configurable waiting screen (#27)
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.14.0

## v0.13.0 — minor — 2026-06-04

### Features
- feat(background-media): DM preview overlay, server-start republish, and L/C/R vertical centre (#26)
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.13.0

## v0.12.1 — patch — 2026-06-04

### Features
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(release): publish betas from any branch + auto-cleanup on stable (#24)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- refactor(repo): code-quality pass — perf, leaks, debug, tests (#25)
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.12.1

## v0.12.0 — minor — 2026-06-03

### Features
- feat(image-layers): viewport-fit, hidden hydrus adds, resilient sync (#23)
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): clarify IA documentation precedence and ownership (#22)
- docs(repo): rewrite README for user-facing tone and add screenshots (#20)
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

### Other
- test(combat-tracker): integration test for IT + Fantasy Statblocks roundtrip (#21)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.12.0

## v0.11.0 — minor — 2026-06-02

### Features
- feat(hydrus): cache restructure + explorer click defaults rework (#18)
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): complete MIT license and dual copyright attribution (#17)
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.11.0

## v0.10.1 — patch — 2026-06-02

### Features
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.8 (#16)
- ci(repo): make Dependabot PRs pass branch and title lint (#14)
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.10.1

## v0.10.0 — minor — 2026-06-02

### Features
- feat: D&D Beyond human-like poller, translucent + auto-stopping combat tracker (#13)

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.10.0

## v0.9.1 — patch — 2026-06-02

### Fixes
- fix(ci): tag-only release flow so the bot does not need to push main (#12)
- fix(ci): no-op release workflow on release/* branches and relax pr-title for releases (#9)

### Documentation
- docs(repo): link .agent/features/ index in README (#11)

### Build & CI
- ci(repo): add auto-release-on-merge and spec-update sentinel (#10)

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.9.0...v0.9.1

## v0.9.0 — minor — 2026-06-01

## What's Changed
* ci(release): skip workflow when main holds a beta version by @hbermu in https://github.com/hbermu/obsidian-dm-screen/pull/6
* fix(ci): rename lint jobs to unique names so protection can require them by @hbermu in https://github.com/hbermu/obsidian-dm-screen/pull/7
* release: v0.9.0 — protected main, automated releases, .agent specs, drop battlemaps by @hbermu in https://github.com/hbermu/obsidian-dm-screen/pull/8

## New Contributors
* @hbermu made their first contribution in https://github.com/hbermu/obsidian-dm-screen/pull/6

**Full Changelog**: https://github.com/hbermu/obsidian-dm-screen/compare/v0.8.2...v0.9.0

## v0.8.2 — patch — 2026-05-31

Promotes the 0.8.1 beta line to a stable release.

## Combat tracker

- **Hidden DDB players are dropped from the tracker.** Characters marked as hidden in a D&D Beyond encounter no longer appear with initiative 0 in the player screen or in the DM panel.
- **Round 1 reveal.** During the first round of combat, combatants whose turn has not happened yet stay hidden from the player screen until their initiative comes up. Applies to all three sources: D&D Beyond, Initiative Tracker plugin, and manual entries.
- **Monster image dedup.** Adding a D&D Beyond encounter no longer creates duplicate image layers for repeated monsters (case-insensitive label match).

## DM panel polish

- Active combat name moved above the search row.
- New `1×` reset button between `−` and `+` for the tracker scale.
- Removed the redundant Stop Tracking bar (the green tracker button already handles it).

## Architecture

- Dropped the legacy Exploration/Combat mode toggle; the combat section is always available.
- Removed ~310 lines of dead code in `DmControlPanel`.
- Extracted a `broadcastAndRender()` helper to dedupe ~25 broadcast/render call pairs.

## Testing

- Integration test suite that boots a real `PlayerScreenServer`, connects real `ws` clients, replays a sanitized D&D Beyond encounter fixture, and smoke-tests the bundled `main.js`.
- 297 tests passing, including coverage for the hidden-player filter and the round-1 reveal logic.

## README

Refreshed: dropped stale Exploration/Combat mode references, added the `combat-scale` WebSocket message and the late-join state cache note, and added a Tests section.

## v0.8.0 — minor — 2026-05-29

## What's New

- **Per-layer border toggle.** New button in layer controls (square outline icon, next to the fog button) lets you toggle the gold border on/off per image layer on the player screen.
- **Comprehensive debug mode.** When enabled in Settings > Advanced, all key flows log to the dev console: server lifecycle, WebSocket connections, broadcasts, HTTP file serving, initiative integration, Hydrus API calls, D&D Beyond auth/polling, and image cache operations.
- **Unit test coverage for core modules.** 88 new tests covering plugin lifecycle (`main.ts`) and settings validation (`settings.ts`).
- **Updated README.** Full documentation of all features, integrations, and WebSocket protocol.

## Breaking Changes

None. The new `bordered` property on `ImageLayer` defaults to `true` (existing layers keep their gold border).

## Upgrade

Download `main.js`, `manifest.json`, and `styles.css` below, or update via BRAT.

## v0.7.2 — patch — 2026-05-29

## Security

- Bump `ws` to ^8.20.1 (fixes uninitialized memory disclosure)
- Bump `esbuild` to ^0.25.0 (fixes dev server request vulnerability)
- Bump `happy-dom` to ^20.8.9 (fixes RCE, code injection, cookie issues)
- Bump `vitest` to ^3.2.0 (pulls vite >=6.4.2, fixes path traversal)

All 6 Dependabot alerts resolved. No functional changes.

## v0.7.1 — patch — 2026-05-29

## Fixes
- Player screen image layers now re-render on window resize
- Image layers scale up properly beyond natural size
- DM view Reset View button resets pan to origin correctly
- Reset View button text no longer clips

## Improvements
- DM preview zoom controls always visible with slider (10%-500%)

## v0.7.0 — minor — 2026-05-28

## Highlights

### D&D Beyond Monster Images
Selecting an encounter in the D&D Beyond tab now automatically fetches monster avatar images, caches them locally in `.dm-screen/images/`, and adds them as hidden image layers. Position and reveal them as needed during combat.

### Client Resolution Badges
Manual TV/Screen dimension settings are replaced by live resolution badges from connected player screens. Badges are deduplicated with counters and clickable to select which resolution drives the preview.

### Debug Mode
New toggle in Settings → Advanced. Enables verbose logging to the developer console for troubleshooting API calls, image downloads, and layer loading.

## All Changes (since v0.6.0)

- **DDB monster image layers** with local caching and TTL-based sweep (30 days)
- **Client resolution badges** — deduplicated, clickable, replace manual TV dimensions
- **Max connected clients** setting (default 10, rejects with WS close 1013)
- **Debug mode** for verbose console logging
- **Cache consolidation** — all cached assets under `.dm-screen/` (bg + images)
- **Recursive directory creation** for nested cache paths
- **imageToDataUrl fallback** for dotfolders not indexed by Obsidian
- Fixed "No player connected" bug when resolution badges are available
- Uniform 24px layer control buttons
- Redesigned layer controls (3-column grid layout)
- "Add BG" button replaces "Video BG"
- Layer alignment buttons (◀ ◆ ▶)
- Removed maps/push notes/places features

## Upgrade Notes

- If you had a `.hydrus-cache/` folder, the new default is `.dm-screen/bg`. Your existing setting value is preserved — update it in Settings → Hydrus → Cache folder if you want to use the new path.
- Deleting `.dm-screen/` is safe — it only contains re-downloadable cache files.

## v0.6.0 — minor — 2026-05-28

## Highlights

This release adds full D&D Beyond encounter integration, multi-screen tracking, and a fullscreen toggle for tablet use.

## New Features

- **D&D Beyond Integration** — Sync encounters from your DDB account. Polls initiative order, PC HP, monster HP, and manual entries in real time. Broadcasts to the player screen with active turn highlighting.
- **"Show PC HP" toggle** — Control whether PC hit points are visible on the player screen. ON: shows exact HP + condition word (Well, Hurt, Bloodied, Down). OFF: shows condition word only.
- **Manual entries** — Manually-added combatants in DDB encounters appear in the tracker alongside monsters and PCs.
- **Fullscreen button** — Player screen has a ⛶ button in the top-right corner for kiosk-style tablet use.
- **Multi-screen tracking** — DM panel shows all connected screens with their individual resolutions. Viewport indicator only shown with exactly 1 screen connected.
- **Gold-bordered image layers** — All images pushed as layers have a consistent gold rounded frame.
- **Active turn highlight** — Gold border on the current combatant during combat on the player screen.
- **Tab bar** — Combat mode has "Local Track" and "D&D Beyond" tabs.

## Improvements

- Initiative numbers hidden from player screen (combatants are sorted but values not shown)
- Encounter links open browser immediately via Electron shell
- HP calculation uses full formula: CON modifier, hp-per-level bonuses, override stats, item set modifiers
- Rate limited to 1 request/second with circuit breaker (3 failures → 30s pause)
- Abstract preset players filtered from encounters
- README rewritten as user-facing documentation

## Test Coverage

161 tests across 16 test files covering DDB client, poller, server, and UI components.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## v0.5.0 — minor — 2026-05-28

## What's New in v0.5.0

### Hydrus Explorer Enhancements

- **Multi-service tag search.** Settings now discovers available Hydrus tag services dynamically. Select multiple services via checkboxes — searches return the union of all selected.
- **Filetype filter checkboxes.** Toggle Images / Videos in the Hydrus modal to filter results via `system:filetype` queries.
- **Tag filtering in suggestions.** The ignored tag patterns now apply to autocomplete suggestions too, not just the tile context menu.
- **Scrollable suggestion dropdown.** Shows ~5 visible items with a scrollbar instead of 50.
- **Empty input shows cached tags.** On open, displays tags from locally cached files sorted by frequency. Typing queries the API.
- **Thumbnails without server.** Local cache thumbnails use `vault.adapter.getResourcePath()` — no HTTP server needed.

### Player Screen

- **Fit W/H buttons in encounter mode.** Image layer controls in combat mode now have Fit-to-Width and Fit-to-Height buttons (matching exploration mode).
- **"Remove BG" button.** Replaces the broken DM preview background. Disabled when no background is active, enabled when one is set, clears on click.

### Test Suite

- 137 tests across 14 files covering Hydrus client, cache, server, tags, viewport, statblocks, and pagination.

## Upgrade Notes

- The old `hydrusTagService` text setting is auto-migrated on first "Fetch services" click.
- After upgrading, go to Settings → Hydrus Library → click "Fetch services" to populate the service checkboxes.

## v0.3.0 — minor — 2026-05-27

First stable release with the Hydrus library integration.

## What's new since 0.2.0

### BG from Hydrus
Browse a self-hosted [Hydrus Network](https://hydrusnetwork.github.io/hydrus/) instance straight from the DM Control Panel. Useful when your scene library lives outside the vault (Czepeku catalogues, asset packs, anything you'd rather tag than file into folders).

- New **BG from Hydrus** button opens a search modal.
- Tag-based search (`tavern night rain`-style queries), 100 results per page, hard cap of 1000 — refine your tags if a query overflows.
- **Click** a tile → downloads on demand, pushes it as the player background, and the modal closes.
- **Shift+click** → downloads and adds it as an image layer (still images only).
- **⋮ menu** per tile → see tags, copy vault path, evict from cache.
- Tiles are clearly marked: `Local` chip on already-downloaded entries; videos get a red `▶ EXT` pill so you don't mistake them for stills.
- Offline mode: if Hydrus is unreachable when you open the modal, you still get whatever's already cached, with tag search filtering on the cached `knownTags`.

### Cache with TTL
- Downloads land at `<vault>/<cacheFolder>/<sha256>.<ext>` plus a sibling `<sha256>.thumb.jpg` and an `index.json` sidecar (default folder: `.hydrus-cache`, configurable).
- `lastUsedAt` is updated **only** when a file is used as background or as a layer. Just appearing in a search doesn't reset the clock.
- Sweep collects entries unused for `hydrusCacheTtlDays` (default 30) at plugin load and every 24 h. Settings → DM Screen → "Clear Hydrus cache" wipes everything manually.

### Player protocol
- New `show-background-media { url, mediaType: "image" | "video", loop?, muted? }` and matching `hide-background-media`.
- `show-video-bg` / `hide-video-bg` remain as deprecated aliases for compatibility with anything that may still emit them.
- Background URLs are now broadcast as **relative paths** (`/vault/<...>`), so player screens work on any device on your LAN — tablet, TV, laptop — not just on the DM machine.

### Server
- The HTTP `/vault/<path>` route now reads via `DataAdapter` as a fallback when the vault index doesn't surface a path. Dotfolders like `.hydrus-cache/` are served correctly.

### Settings
New section in Settings → DM Screen → **Hydrus Library**:

| Setting | Default | Purpose |
|---|---|---|
| `hydrusEnabled` | `false` | Master switch + gate for the BG from Hydrus button |
| `hydrusApiUrl` | `""` | Base URL of your Hydrus Client API (no trailing slash) |
| `hydrusApiKey` | `""` | 64-hex `Hydrus-Client-API-Access-Key` (stays local) |
| `hydrusTagService` | `A.I. Tags` | Tag service used to populate `knownTags` |
| `hydrusCacheFolder` | `.hydrus-cache` | Vault-relative folder for downloaded media |
| `hydrusCacheTtlDays` | `30` | TTL window before sweep removes unused entries |
| `hydrusDefaultLoop` | `true` | Default `loop` flag for video backgrounds |
| `hydrusDefaultMuted` | `true` | Default `muted` flag (videos only autoplay when muted) |

A "Test connection" button next to the API key verifies access against `/verify_access_key`.

## Install

### BRAT (recommended)
- Add `hbermu/obsidian-dm-screen` as a beta plugin in BRAT, or just bump the version in BRAT if you already had it.
- Tick "Include beta versions" only if you want future betas; this stable release works without it.

### Manual
- Drop `main.js`, `manifest.json` and `styles.css` from this release into `<vault>/.obsidian/plugins/dm-screen/`, replacing whatever was there.
- Reload Obsidian and enable **DM Screen** under Community plugins.

## Compatibility
- Settings persist across upgrades. If your `hydrusApiUrl` is empty after the bump, it's because the previous default was scrubbed in `0.3.0-beta.3`; just paste your URL once.
- Caches built by `0.3.0-beta.{1..5}` keep working — the on-disk layout is unchanged.

## Known limitations
- The Hydrus Client API has to be reachable from Electron (the plugin host) — typically a reverse proxy in front of port `45869`, or `http://localhost:45869` if Hydrus desktop runs on the same machine.
- Streaming: the binary is downloaded entirely before being served. Fine for images and short videos; revisit for very large videos.

## v0.2.0 — initial — 2026-05-26

Per-layer fog of war with 6 drawing tools (circle, rect, eraser/pen for reveal and fog)
DM preview pan/zoom independent of player screen
Player viewport indicator (green rectangle) with dynamic scaling
Player screen sends viewport dimensions back via WebSocket
Server caches state for late-joining clients
Image layers persist across Obsidian reloads
Images sized to natural pixel dimensions (no cropping)
LAN IP address displayed for network TV access
Encounter battlemaps added as hidden layers
Single-image notes auto-add without picker menu

