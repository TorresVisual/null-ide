# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary and effectively only user is the developer building it (git identity: TorresVisual, junk@rohsmann.at) — a Windows developer who wants their own daily-driver editor configured exactly to their taste. The project is distributed publicly (GitHub Releases, installer, PowerShell one-liner, a GitHub Pages site), but that distribution is a byproduct of building in the open, not a product-market goal. Design and product decisions should optimize for what the author personally wants from their own tool, not for onboarding or converting strangers.

## Product Purpose

Null IDE is a custom Windows desktop code editor built on VSCodium (itself a fork of VS Code with Microsoft telemetry removed). It exists so the author has one opinionated, pre-configured editor — a dark theme, a matching icon pack, an embedded AI agents panel, native Windows shell integration, and zero telemetry — without reassembling that setup from marketplace extensions on every machine. Success is a daily-driver editor that stays current with upstream VSCodium via an automated release pipeline and self-updates without friction.

## Positioning

Unlike vanilla VS Code or VSCodium, Null IDE ships fully assembled: AI agent terminals (Claude, Codex, Ollama), commit-message generation, session history browsing, a native Win11 "Open in Null" context menu, and a curated dark theme + icon pack are built in from first launch, not installed piecemeal. Unlike telemetry-enabled editors, Null IDE has `enableTelemetry: false` baked into `product.json` — the only network calls are user-initiated marketplace lookups and a periodic GitHub Releases update check.

## Operating Context

- Windows-only; built and released as `null.exe`, invoked from the terminal as `null .`.
- Per-user install to `%LOCALAPPDATA%\Programs\Null IDE` — no administrator elevation required.
- Full builds run only in GitHub Actions on `windows-2022`; there is no supported local full-build workflow (`scripts/build-local.ps1` exists only for iterating on the build pipeline itself, not for day-to-day feature work).
- Extension development loop: edit TypeScript source in `extensions/*/src/`, compile, then copy into a local install or reload the window to preview (theme/CSS changes copy directly; `null-tools`' native `node-pty` needs `setup.ps1` after an Electron version bump).
- The in-app updater checks GitHub Releases on startup and can self-update via a detached PowerShell script.

## Capabilities and Constraints

- Eight (soon nine, with Code Spell Checker) built-in extensions bundled at build time: `null-theme`, `null-icons`, `null-tools`, `null-markdown`, `null-cpp`, `null-actions`, `null-format`, `wooting-analog`.
- AI Agents panel (`null-tools`) embeds terminals for `claude`, `agy`, `codex`, `ollama`; also provides session history browsing, Claude-generated commit messages, Ollama inline chat/review, Discord Rich Presence, and an in-app updater.
- `null-cpp` provides symbol-aware C/C++ header/source switching and scaffolding on top of `clangd`; a full CMake/toolchain/build/debug layer is roadmapped but not built.
- `null-actions` provides configurable status-bar buttons that run shell commands or VS Code API commands.
- `null-format` provides in-box Prettier/rustfmt/clang-format formatting, with project-level config files taking precedence over built-in defaults.
- A native Win11 IExplorerCommand COM DLL, packaged as a self-signed sparse APPX, provides the Explorer context menu (registry-based HKCU entries are a fallback path referenced but superseded on Win11+).
- Telemetry is fully disabled; this is a binding constraint, not a default to be revisited casually.

## Brand Commitments

- Name and mark: "Null IDE" / `null`, using the ∅ (null) symbol as the logo.
- Null Dark theme: deep navy backgrounds (`#0d0d1a`–`#1a1a2e`) with teal (`#00b4d8`/`#0077b6`) and indigo (`#4361ee`/`#3a0ca3`) accents.
- Typography: Geist Mono / JetBrains Mono, falling back to Cascadia Code.
- Voice (per the GitHub Pages site): terse, technical, unadorned — "A minimal code editor. No telemetry. No noise." "Everything you need. Nothing you don't."
- MIT licensed; positioned explicitly against telemetry-heavy editors.

## Evidence on Hand

- Working README.md and GitHub Pages site (`docs/index.html`) with real install instructions, feature copy, and the actual color/type tokens in use — treat both as live brand and copy reference, not placeholder content.
- No testimonials, customer logos, case studies, or usage metrics exist and none should be fabricated; this is a solo-built tool, not a company with proof points to show.

## Product Principles

- Optimize for the author's own daily use, not for stranger onboarding or growth metrics — this is a personal tool that happens to be public.
- Ship fully assembled: prefer built-in, pre-configured capability over "install this extension yourself" instructions.
- No telemetry, ever — this is load-bearing, not a configurable default.
- Stay close to upstream VSCodium/VS Code conventions so the editor remains familiar and low-maintenance to keep in sync.
- Windows-first and Windows-only; do not design around cross-platform compromises.
