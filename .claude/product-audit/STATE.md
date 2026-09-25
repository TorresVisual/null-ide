# Audit State

Last audit:
2026-09-25 (no-op check — no repo or issue changes since first run)

Repository state:
main @ 289f023 (497e048 + 2 docs-only commits: CLAUDE.md sync, this
knowledge base's own initial commit — no application code changed)

Last inspected areas:
- extensions (all 8: package.json contributions, src listing)
- product.json overlay + extensionRecommendations
- installer settings seeding
- patches/
- docs/ROADMAP.md (C++ layer, phases 1–6 complete), docs/specs listing
- null-cpp dependency handling (clangdBridge, debugConfigSynth)

Last GitHub issue audit:
2026-09-25 (#1–#90, re-verified via `gh issue list --state all` — states/
timestamps match ISSUES.md exactly, no changes)

Architecture confidence:
high

Feature inventory confidence:
medium (built from package.json + file listings, not every source file)

Known areas requiring re-audit:
- performance (#16–#22 still not runtime-inspected, only architecture-checked)

Re-audited 2026-09-25 (deep-dive, no repo changes since first run):
- Updater: MAJOR correction — `updater/` (native C++ EXE, CMake, WinHTTP,
  BCrypt, miniz) plus `docs/specs/native-updater-design.md` and
  `docs/plans/native-updater-fix.md` were entirely missed by the first-run
  audit. The fix plan (native EXE wiring, checksum verify, rollback,
  reapply-registrations, Retry/Close UX) is fully implemented in code
  (commits `ff51581`..`ac4b54e`, 2026-09-19, predates the first audit).
  Commented on #12 recommending closure pending a real-install smoke test.
  ARCHITECTURE.md and FEATURES.md updated.
- Testing: confirmed no extension registers a VS Code `TestController`
  anywhere (`createTestController` grep across all extensions/ is empty,
  excluding vendored @types/vscode) — matches existing #82 tracking, no
  correction needed. (Node's built-in `node --test` unit-test suites exist
  across null-actions/null-cpp/null-format/null-tools — ~35 test files —
  but that's null-ide's own dev tooling, not a user-facing IDE feature, so
  out of scope for FEATURES.md.)
- Performance: confirmed all 6 TS-based extensions still activate via
  `onStartupFinished` (matches #16 lazy-load-AI-panel still being valid);
  did not runtime-profile startup or memory — that requires a live install,
  not static inspection.

Corrections to project docs noticed:
- CLAUDE.md says patches/ is empty — 4 patches exist.
- docs/ROADMAP.md Phase 4 says null-cpp declares extensionDependencies — removed in 1f7c00b.
- CLAUDE.md's repository layout and "How the Build Works" don't mention
  `updater/` (native updater EXE) or its CI build step at all — worth a
  CLAUDE.md sync pass, though that's outside this skill's scope (docs
  only, not application code — but CLAUDE.md itself is a candidate for
  `sync-agent-docs`).

Last created issues:
- #89
- #90
