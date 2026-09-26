# Audit State

Last audit:
2026-09-26 (incremental — AI subsystem only)

Repository state:
main @ e3301b1 (only app change since 289f023: AI Agents panel removal)

Last inspected areas:
- 2026-09-26: e3301b1 diff stat, null-tools src/ + package.json commands/
  views, stale-reference grep (ollama/agents/claude-code) across repo,
  product.json extensionRecommendations
- 2026-09-25 (still valid, unchanged since): all 8 extensions, product.json
  overlay, installer settings seeding, patches/, docs/ROADMAP.md + specs,
  null-cpp dependency handling, updater/

Last GitHub issue audit:
2026-09-26 (#1–#100 via `gh issue list --state all`; 10 closures, 3 new
maintainer-filed issues #98–#100)

Architecture confidence:
high

Feature inventory confidence:
medium (built from package.json + file listings, not every source file)

Known areas requiring re-audit:
- performance (#19–#22, #30 not runtime-inspected; needs a live install)
- when #98–#100 land: re-check the AI section of ARCHITECTURE/FEATURES

Corrections this run:
- AI architecture: panel/Ollama/sound/history/"Fix with AI" gone; Claude Code
  extension is the only AI path; native agent UI not planned (#41).
- CLAUDE.md now lists patches/ (815ac3c) — removed that stale-doc note.

Corrections to project docs noticed (outside this skill's scope):
- docs/index.html (public homepage) still has an "Ollama" feature card
  (~line 577) though Ollama was removed in e3301b1.
- PRODUCT.md lines ~19/32 still describe the AI Agents panel, agent
  terminals (claude/agy/codex/ollama), session history, Ollama chat, and
  node-pty/setup.ps1.
- docs/ROADMAP.md Phase 4 says null-cpp declares extensionDependencies —
  removed in 1f7c00b.
- CLAUDE.md doesn't mention `updater/` (native updater EXE) or its CI step.
- docs/plans/* and docs/specs/* reference agentsPanel/null-agents — historical
  plans, fine to leave.

Last created issues:
- #94–#97 — 2026-09-26 (none this run; #98–#100 were filed by the maintainer)

Note: repo has no `security` label; #97 filed as `enhancement` only.
