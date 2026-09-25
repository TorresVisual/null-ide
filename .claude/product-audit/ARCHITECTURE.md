# NULL IDE Architecture

VSCodium fork, Windows-only (win32-x64). Built entirely in GitHub Actions
(`.github/workflows/build.yml`); `scripts/build-local.ps1` mirrors it locally.

## Workbench
- Upstream VS Code workbench. Customised by injection, not source edits:
  `workbench/custom.css` + `workbench/splash.js` injected into `workbench.html`.
- Core patches DO exist now (CLAUDE.md says `patches/` is empty — stale):
  `001-jumplist-recent-projects`, `002-fix-claude-copilotapi-types`,
  `003-null-dashboard-startup`, `004-null-dashboard-help-welcome`.
- Native project dashboard (`null.dashboard` custom editor in null-tools)
  replaces the Welcome page on startup and for Help > Welcome.
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
- GitHub Issues panel (webview, null-tools/src/issuesPanel.ts,
  issueDetailPanel.ts): list/filter/create/edit/comment, templates, offline
  cache, unread badges. GitHub.com only. **No pull request support.**

## Extensions (built-in, `extensions/`)
- null-theme, null-icons, null-markdown, null-format, null-tools,
  null-cpp, null-actions, wooting-analog (+ cspell).
- null-cpp: full CMake/Make layer (toolchain registry MSVC/clang/WSL,
  presets, File API codemodel, build diagnostics, run, debug config synth,
  scaffolding). Phases 1–6 of docs/ROADMAP.md complete.
  Relies on clangd, cpptools, CodeLLDB being **manually installed** —
  `extensionDependencies` removed in 1f7c00b so it activates standalone.
- null-actions: status-bar command buttons, project-type suggestions
  (Cargo.toml, CMakeLists.txt, *.csproj, npm scripts).
- null-tools: dashboard, issues panel, scratch/notes, ports, updater,
  Discord RPC, sound design, Ollama, legacy AI Agents panel.

## AI
Claude Code extension/chat is the preferred AI workflow.
The existing AI Agents panel is not the primary AI architecture (#84 proposes
removing it; #41 proposes a provider-agnostic native agent UI).

## Important Entry Points
- `extensions/*/src/extension.ts` (activate), mostly `onStartupFinished`.
- `extensions/null-tools/src/*Integration.ts` — per-feature wiring.
- `scripts/install-null-ide.ps1` — install, PATH, shortcuts, file assoc,
  preview handler, seeds `%APPDATA%\Null\User\settings.json`.
- `installer/null-ide.iss` — wraps the PS installer.

## Important Services
- Project detection: `null-cpp/src/projectDetection*.ts`,
  `null-actions/src/projectDetector.ts` (duplicated heuristics; #39).
- Toolchain discovery: `null-cpp/src/toolchainRegistry.ts`,
  `null-format/src/toolchainDiscovery.ts`.
- Updater: two-part, native EXE + TS orchestration (corrected 2026-09-25 —
  previously undocumented). See "Updater" section below.

## Updater (native EXE + TS orchestration)
Previously undocumented — a full rewrite (`docs/specs/native-updater-design.md`,
`docs/plans/native-updater-fix.md`, commits `ff51581`..`ac4b54e`, 2026-09-19)
replaced the old PowerShell-only flow. Confirmed live in code as of this audit:
- `updater/` — standalone CMake C++17 project (`updater/src/main.cpp`, bundled
  `miniz` for zip extraction), built by CI (`build.yml` "Build null-updater")
  into `resources/app/null-updater/null-updater.exe`. WinHTTP download,
  BCrypt SHA256 verification, Win32 TaskDialog progress UI with Retry/Close
  buttons on failure, rollback-to-backup (`.null-ide-bak-*`) if the swap
  fails partway, and a post-swap call into
  `install-null-ide.ps1 -ReapplyRegistrations` to refresh context-menu/
  file-assoc/preview-handler/default-settings.
- `null-tools/src/updater.ts` resolves and invokes the EXE (passing
  `--zip-path`/`--version` when it has already background-downloaded and
  SHA256-verified the release zip via `stageUpdateInBackground`), only
  falling back to the old `update-null-ide.ps1` PowerShell launcher if the
  EXE truly isn't found. `versionComparison.ts` (extracted, unit-tested)
  fixes a prerelease-suffix comparison bug (`v1.2.0-beta` vs `v1.2.0`).
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
