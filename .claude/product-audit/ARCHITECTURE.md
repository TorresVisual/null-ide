# NULL IDE Architecture

VSCodium fork, Windows (win32-x64) plus Linux x64 (tar.gz/deb, #119). Built entirely in GitHub Actions
(`.github/workflows/build.yml`); `scripts/build-local.ps1` mirrors it locally.

## Workbench
- Upstream VS Code workbench. Customised by injection, not source edits:
  `workbench/custom.css` + `workbench/splash.js` injected into `workbench.html`.
- Core patches (listed in CLAUDE.md and `patches/README.md`): `001` jumplist,
  `002` copilotApi types, `003`/`004` dashboard startup + Help > Welcome,
  `005` Claude Code command-center split button (#98), `006` Settings TOC
  splits Extensions into Null / Installed / Built-in (#108), `007` Accounts
  menu lists null-accounts accounts + avatar on the activity-bar button,
  `008` commit-message check hook, `009` safe mode, `010` startup snapshot,
  `011` compile-cache rm retries.
- Upstream: root `VSCODIUM_TAG` file (1.135.06055 as of 2026-10-11);
  `.github/workflows/upstream-check.yml` opens a bump PR weekly and dry-runs
  the patches (#115 asks for a process on top of this: feature parity review).
- Native project dashboard (`null.dashboard` custom editor in null-tools)
  replaces the Welcome page on startup and for Help > Welcome. Redesigned
  2026-10 (d2d516c) as a keyboard-first project launcher with Start/Home rail,
  search/grouping of recent projects, per-card null-accounts account.
- `product.json` overlay deep-merged: branding, VS Marketplace gallery,
  `configurationDefaults` (Null Dark, null-icons, telemetry off, update.mode none,
  **workspace trust fully disabled**, formatter defaults → null-format).

## Editor
- Inherited VS Code editor. Formatting via null-format (Prettier in-process,
  rustfmt, clang-format; project config wins over `null-format.*.defaultConfig`).
- Code Spell Checker bundled as a built-in (pinned `CSPELL_TAG`).
- Markdown: null-markdown (GFM, Mermaid, KaTeX, alerts, PDF export, slides).

## Terminal
- Inherited integrated terminal. null-actions owns one terminal per button
  (keyed by button id). null-tools has a "Null Ports" tree (listening ports,
  open/kill). No process/resource view (#37).

## Source Control
- Inherited Git SCM. null-tools adds: commit-message generation via
  `claude --print`, issue reference insertion, "closes via unpushed commit".
- GitHub Issues panel v2 (null-tools: `issuesPanel.ts`, `issueDetailPanel.ts`,
  `issuesListController.ts`, `github/`): github.com-style list/search, detail
  tab, composer, New-issue form with templates, image upload to an orphan
  `null-issue-assets` branch, branch→issue prompt. GitHub.com only (token via
  null-accounts); pull requests (list, review, merge, checks) and a GitHub Actions view added
  2026-10 (#92/#117/#132); **no GitLab issues/MRs** (design Phase 6).
- Git worktree manager (null-tools `worktrees*.ts`, #88) for parallel agent
  sessions.

## Extensions (built-in, `extensions/`)
- Thirteen built-ins + cspell + open-remote-*: null-theme, null-icons, null-markdown,
  null-format, null-tools, null-cpp, null-actions, null-accounts, null-activity,
  null-music, null-env (env check), null-startup (profiler), null-sync (Gist sync). `wooting-analog` moved to `archive/` (ee50b16), not built.
- null-accounts (#102): GitHub (wraps VS Code's session) + GitLab (device-flow
  OAuth or PAT) + SSH-only accounts; folder→account binding wired into git
  (user.name/email, credential store, core.sshCommand), SSH key
  generate/upload/sign-commits, default account, Accounts menu (patch 007).
  null-tools' Issues panel depends on it for tokens. API exported for others.
- null-activity (#113): local-only WakaTime replacement — append-only JSONL
  interval log per window, dashboard webview, git stats, gist badges,
  WakaTime import. No network except opt-in badge publishing.
- null-music (#112): local-file player (own tag reader, library cache,
  queue, `<audio>` in a sidebar webview). Streaming providers were dropped.
- null-cpp: full CMake/Make layer (toolchain registry MSVC/clang/WSL,
  presets, File API codemodel, build diagnostics, run, debug config synth,
  scaffolding). Phases 1–6 of docs/ROADMAP.md complete.
  Relies on clangd, cpptools, CodeLLDB being **manually installed** —
  `extensionDependencies` removed in 1f7c00b so it activates standalone.
- null-actions: status-bar command buttons, project-type suggestions
  (Cargo.toml, CMakeLists.txt, *.csproj, npm scripts).
- null-tools: dashboard, issues panel, scratch/notes, ports, updater,
  Discord RPC, commit-message generation. Views: `null-workspace`,
  `null-issues`. (AI Agents panel, Ollama, sound design, Claude history,
  "Fix with AI" code action, xterm/node-pty all removed in e3301b1.)

## AI
The official Claude Code extension (`anthropic.claude-code`), used in the
editor, is the only AI workflow. Decided 2026-09-26: no native agent UI (#41
closed not-planned), AI Agents panel deleted (#84, e3301b1).
- Only in-repo AI code left: `null-tools/src/commitMessage.ts` → `claude --print`.
- Editor-first integration now shipped on top of the extension, reading its
  session transcripts (`~/.claude/projects/<encoded-workspace>/<sessionId>.jsonl`)
  instead of hooks: `followAlong.ts` (#99), `whyIsThisHere.ts` (#100),
  `claudeTabIntegration.ts`, and patch 005 (#98 command-center button).
- #111 "Continue" button shipped.
- Blocked by the extension: submitting prompts programmatically and
  surfacing its permission prompts (per #41 closing comment).
- Claude Code is neither bundled nor in `extensionRecommendations` (scope
  added to #89).

## Security posture
Workspace trust handling was reworked (#97 closed 2026-10-14); not re-read this run.

## Important Entry Points
- `extensions/*/src/extension.ts` (activate), mostly `onStartupFinished`.
- `extensions/null-tools/src/*Integration.ts` — per-feature wiring.
- `setup/` — `null-setup` (Rust + Tauri): installer wizard, repair/modify/uninstall, updater.

## Important Services
- Project detection: `null-cpp/src/projectDetection*.ts`,
  `null-actions/src/projectDetector.ts` (duplicated heuristics; #39).
- Toolchain discovery: `null-cpp/src/toolchainRegistry.ts`,
  `null-format/src/toolchainDiscovery.ts`.
- Updater: two-part, native EXE + TS orchestration (corrected 2026-09-25 —
  previously undocumented). See "Updater" section below. The update check
  runs **once at startup only** and swallows errors silently (found
  2026-10-11, commented on #120).

## Updater (`null-setup` + TS orchestration)
The C++ `updater/` and the PowerShell launchers are gone; `null-setup` (`setup/`, Rust) does everything natively:
- `null-setup prefetch` downloads the release zip and verifies its `.sha256` sidecar into `%LOCALAPPDATA%\Null\updates\<tag>\`.
- `null-setup update` relocates itself out of the install dir, closes the IDE, swaps the install with a journal and rollback, re-applies the shell registrations natively (`setup/core/src/shell/`), and waits for the new IDE's `.null-ready` marker.
- `null-tools/src/updater.ts` finds `setup\null-setup.exe` and spawns those two modes; `versionComparison.ts` (unit-tested) handles prerelease suffixes.
- `updaterIntegration.ts` status bar distinguishes "downloading" vs
  "restart to update" (staged + verified) states.
- `build.yml` publishes a `.sha256` sidecar alongside the release zip.
- Issue #12 ("Fix broken updater") was filed as an unreproduced report and
  the prior audit run never looked at `updater/` or `docs/plans/`/`docs/specs/`
  — the fix appears to already be complete. Commented on #12 with this
  finding (2026-09-25); not closed, since the native-EXE/registry paths are
  only realistically testable against a live Windows install.

## Known Architectural Constraints
- MS-licensed extensions (cppvsdbg, Remote-WSL/SSH, Pylance) unusable → use
  CodeLLDB/cppdbg, open-remote-* (#85).
- Compiled JS outputs are generated — edit TS only.
- Extension API limits (e.g. SCM input box has no document URI).
