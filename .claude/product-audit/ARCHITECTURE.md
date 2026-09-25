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
- Updater: `null-tools/src/updater.ts` (#12 reports broken, unreproduced).

## Known Architectural Constraints
- MS-licensed extensions (cppvsdbg, Remote-WSL/SSH, Pylance) unusable → use
  CodeLLDB/cppdbg, open-remote-* (#85).
- Compiled JS outputs are generated — edit TS only.
- Extension API limits (e.g. SCM input box has no document URI).
