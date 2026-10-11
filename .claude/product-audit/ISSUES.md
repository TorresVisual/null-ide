# GitHub Issue Audit

Last synchronized:
2026-10-11 (#1–#123 via `gh issue list --state all`)

Closed issues not listed individually unless still relevant; check
`gh issue list --state closed` if needed. Notable closed: #38 dashboard,
#40 null-format, #43 issues panel, #28 Linux support (closed, not doing),
#84 AI Agents panel removed (e3301b1), #41 native agent UI (not planned —
split into #98–#100).

Closed 2026-09-25/26 by the maintainer: #84 (e3301b1), #80 (839f110),
#74 #75 #16 #4 #3 (obsolete once the panel was removed), #41 (not planned),
#29 #10 (closed as completed, no implementing commit found — treat as
dropped, don't re-file).

Closed since 2026-09-26 (verified implemented in code): #98 (patch 005), #99
(followAlong), #100 (whyIsThisHere), #88 (worktrees), #102/#103 accounts,
#106 #107 Issues panel fixes/images, #108 settings, #110 registry, #112 music,
#113 activity, #118 recent projects, #123 activity idle bug, #104 #35.

| Issue | Title | Status | Area | Last Audited |
|---|---|---|---|---|
| #122 | Create a GitHub Wiki | open | docs | 2026-10-11 (maintainer) |
| #121 | Null Accounts UI bug (misaligned buttons) | open | accounts | 2026-10-11 (maintainer) |
| #120 | Automatic updates not working | open | install | 2026-10-11 (commented: startup-only check, silent failure; overlaps #12) |
| #119 | Linux build | open (empty body) | install | 2026-10-11 (maintainer; #28 was closed earlier) |
| #117 | Manage Pull Requests inside Null IDE | open | git | 2026-10-11 (commented: overlaps #92, GitLab precondition) |
| #115 | Keep up with VS Code updates/features | open | process | 2026-10-11 (upstream-check.yml covers bumps only) |
| #114 | Markdown Editor View (hybrid) | open | markdown | 2026-10-11 |
| #111 | Continue button outside Claude Code ext | open | ai | 2026-10-11 |
| #97 | Workspace Trust force-disabled on every startup (security) | open | security | 2026-10-11 (commented: null-activity isTrusted guard is inert) |
| #96 | GitHub Actions CI status for the current branch | open | git/ci | 2026-09-26 |
| #95 | Action-button build output → Problems panel | open | build | 2026-09-26 |
| #94 | New Project templates in the dashboard | open | dashboard | 2026-09-26 |
| #93 | Test Explorer integration for non-C++ projects (npm test, cargo test) | open | testing | 2026-09-25 |
| #92 | GitHub Pull Requests in the Issues panel | open | git/issues | 2026-10-11 (commented: #117 overlap) |
| #91 | Rust development support: LSP recommendation + debug config synthesis | open | rust | 2026-09-25 |
| #90 | Import settings/keybindings/snippets/extensions from VS Code / Cursor | open | configure | 2026-09-25 |
| #89 | Environment check: companion extensions + toolchains | open | configure | 2026-09-26 (commented: add Claude Code ext + `claude` CLI to scope) |
| #87 | Native commit graph and interactive rebase editor | open | git | 2026-09-25 |
| #86 | null-cpp: inline Compiler Explorer | open | cpp | 2026-09-25 |
| #85 | Remote WSL/SSH via open-remote extensions | open | workspace | 2026-09-25 |
| #83 | Dashboard: flag unpushed/no-upstream/stashes | open | dashboard | 2026-09-25 |
| #82 | null-cpp: CTest in Testing view | open | testing | 2026-09-25 |
| #81 | Action buttons run state / busy terminal | open | build | 2026-09-25 |
| #59 #57 #56 #54 | Issues panel: reactions, linked PRs, milestones, branch link | open | issues | 2026-09-25 |
| #39 | .null/ project metadata | open | workspace | 2026-09-25 |
| #37 | Process/resource panel for terminals | open | terminal | 2026-09-25 |
| #36 | Broken wiki-links as diagnostics | open | markdown | 2026-09-25 |
| #34 | Secret scan on staged diff | open | git | 2026-09-25 |
| #33 | Auto-open browser for dev server port | open | run | 2026-09-25 |
| #30 #22 #21 #20 #19 | Performance: RAM mode, large files, memory, ext perf, startup profiler | open | performance | 2026-09-25 |
| #23 | Settings sync | open | configure | 2026-09-25 |
| #18 #17 | Safe mode, crash recovery | open | reliability | 2026-09-25 |
| #15 #14 #13 | Chocolatey, Scoop, Winget | open | install | 2026-09-25 |
| #12 | Fix broken updater (unreproduced) | open; near-duplicate of #120 | install | 2026-10-11 |
| #11 | Floating terminal | open | polish | 2026-09-25 |
| #9 #8 #7 #6 #5 | Conventional commits, dirty overview, hunk staging, commit templates, commit-gen fallback | open | git | 2026-09-25 |
