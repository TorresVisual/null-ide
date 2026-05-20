# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **forked VSCodium distribution** with a custom binary name, Null-aesthetic workbench UI, bundled built-in extensions, and stripped Microsoft code. Built via a repeatable GitHub Actions pipeline that tracks upstream VSCodium releases.

The build does **not** run on Windows — patches are authored locally, CI builds on `ubuntu-latest`, and the resulting portable `.zip` artifact is downloaded for Windows use.

## Repository Layout

```
├── patches/                   # Git-format patches applied on top of VSCodium source
│   ├── 001-binary-rename.patch
│   ├── 002-workbench-ui.patch
│   ├── 003-strip-telemetry.patch
│   └── 004-builtin-extensions.patch
├── icons/                     # Source icons: icon.ico, icon.png, icon.icns, icon.svg
├── extensions/
│   └── null-theme/     # Bundled as a built-in extension (ships in the binary)
│       ├── package.json
│       └── themes/null-dark.json
├── workbench/                 # Assets injected into the workbench at build time
│   └── custom.css             # Injected via workbench.html patch
├── product.json               # Merged into vscode/product.json before build
├── build.sh                   # CI build script (runs on ubuntu-latest)
├── .github/workflows/
│   └── build.yml              # Triggered on VSCodium release tag or manual dispatch
└── README.md
```

## How the Build Works

1. **`build.yml`** checks out the VSCodium repo at the target tag, then overlays this repo's files on top.
2. **Patches** in `patches/` are applied via `git am` in numerical order against the checked-out vscode source.
3. **`product.json`** is deep-merged (our values win) into `vscode/product.json`.
4. **`extensions/null-theme/`** is copied into `vscode/extensions/` so it ships as a built-in.
5. **`icons/`** replaces the upstream icon files before packaging.
6. Build runs `yarn && yarn gulp vscode-linux-x64 vscode-win32-x64` (or the VSCodium equivalent build targets).
7. Artifact is uploaded to the GitHub release.

## Patches

The `patches/` directory holds git-format patches for vscode source changes that cannot be done via file copy. Currently empty — the workbench.html injection is handled by the "Inject custom assets into workbench.html" step in `build.yml` (PowerShell string replacement on the anchor line), which is more robust across VS Code version bumps than a patch.

The CSS and JS files are copied into the source tree before the gulp build by the "Copy workbench assets" step, so editing `workbench/custom.css` or `workbench/splash.js` never requires touching the CI workflow.

```bash
# Test locally (with VSCODE_SRC pointing to a checked-out tree):
bash build.sh --css-only       # copies workbench/custom.css + splash.js into vscode source
bash build.sh --patches-only   # applies patches/*.patch via git apply (if any exist)

# Create an additional patch:
cd vscode-src
git add -p && git commit -m "feat: describe change"
git format-patch HEAD~1 -o ../patches/
```

Patches apply against the vscode commit at `MS_TAG` (read from `vscodium-src/MS_TAG`) **after** VSCodium's own patches are applied. When the upstream version changes, rebase the patch series with `git rebase --onto <new-ms-tag> <old-ms-tag> HEAD` and re-export.

## Updating Upstream Version

1. Change `VSCODIUM_TAG` in `.github/workflows/build.yml`.
2. Check out the new vscode tag locally and rebase the patch series: `git rebase --onto <new-tag> <old-tag> patch-branch`.
3. Re-export patches with `git format-patch`.
4. Push and verify CI passes.

## Built-in Theme Extension

`extensions/null-theme/` is a standard VS Code color theme extension. It is set as the default theme in `product.json` via `"defaultColorTheme": "Null Dark"`.

Palette:
- Background: `#0d0d1a` – `#1a1a2e`
- Accent teal: `#00b4d8` / `#0077b6`
- Accent indigo: `#4361ee` / `#3a0ca3`
- Font: Geist Mono, JetBrains Mono (fallback: Cascadia Code)

## Key Build Variables (build.yml)

| Variable | Purpose |
|---|---|
| `VSCODIUM_TAG` | Upstream VSCodium release tag to build against |
| `APP_NAME` | Binary and window title name |
| `APP_ID` | Reverse-domain app identifier |
| `PUBLISHER` | Extension publisher name for built-ins |

## Telemetry / Microsoft Code Removal

VSCodium already strips the bulk of Microsoft telemetry. `003-strip-telemetry.patch` handles anything that remains: crash reporter endpoints, update-check URLs, and any residual `vscode-telemetry` calls introduced in newer upstream versions. When rebasing to a new upstream, audit `grep -r "telemetry\|crashReporter\|updateUrl" vscode/src/` against the previous version's output.

## CI Pipeline Triggers

```yaml
on:
  workflow_dispatch:            # Manual run
  push:
    tags: ['v*']               # Tag a release in this repo
  schedule:
    - cron: '0 6 * * 1'        # Weekly check for new VSCodium upstream tags
```

The scheduled run compares the latest VSCodium GitHub release tag against `VSCODIUM_TAG` and opens a PR if they differ.

## Extension IDs (Open VSX, installed post-build via settings)

These are not bundled — they are listed in `product.json` under `"extensionRecommendations"` and installed by the user or via a first-launch script:

| Purpose | ID |
|---|---|
| C/C++ (clangd) | `llvm-vs-code-extensions.vscode-clangd` |
| CMake Tools | `twxs.cmake` |
| Python | `ms-python.python` |
| GitLens | `eamodio.gitlens` |

## Scope Constraints

- Work only inside `D:\Coding\Apps\ide\` and its subdirectories.
- Do not touch system PATH, registry, or any existing VS Code/VSCodium installation.
- Do not run CI or build scripts locally — patches are authored here, builds run in GitHub Actions.
- Do not set the Microsoft extension gallery env var silently; document it in README only.