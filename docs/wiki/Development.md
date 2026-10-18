# Development

How Null IDE is put together, and how to work on it. For the contribution workflow see [Contributing](Contributing).

## What it is

A repackaging of [VSCodium](https://vscodium.com) with its own branding, built-in extensions, a native Explorer shell extension and an updater/installer written in Rust.

```
extensions/        Built-in extensions (TypeScript in src/, compiled output in out/)
shell-ext/         Win11 IExplorerCommand DLL + sparse APPX manifest (CMake + MSVC)
patches/           Patches against the VS Code source tree
setup/             null-setup: installer, wizard and updater (Rust + Tauri)
scripts/           Local dev helpers and build scripts
workbench/         custom.css and splash.js injected into workbench.html
icons/             Source icons
docs/              GitHub Pages site, roadmap, design specs, wiki source
product.json       Branding/config overlay merged into VS Code's product.json
archive/           Retired code, not built
```

## Prerequisites

| For | You need |
|---|---|
| Extension work | Node.js and npm |
| `setup/` | Rust toolchain (`cargo`) |
| `shell-ext/` | CMake and Visual Studio 2022 (MSVC) |
| Full local build mirror | all of the above, plus tens of minutes |

## The build

Release builds run in GitHub Actions on `windows-2022`. **Do not try to build the full editor locally.** In short, the pipeline:

1. Clones VSCodium and the matching VS Code source at `VSCODIUM_TAG`.
2. Applies VSCodium's patches, then every `patches/*.patch` in name order.
3. Deep-merges the `product.json` overlay.
4. Compiles each TypeScript extension and copies the built-ins into the source tree.
5. Swaps in icons and injects `workbench/custom.css` and `splash.js`.
6. Runs `npx gulp vscode-win32-x64`.
7. Builds and signs the shell extension, stamps version info into `product.json`.
8. Builds `setup/` with cargo, then packages `null-ide-win32-x64.zip` and `NullIDESetup-<version>.exe`.

Releases come from pushing a `v*` tag, or **Actions → Build Null IDE → Run workflow**. The `upstream-check` workflow opens a PR on Mondays when VSCodium ships a new release; to bump by hand edit `VSCODIUM_TAG` and check that each patch still applies.

`scripts/build-local.ps1` mirrors the CI job for iterating on `build.yml`, `shell-ext/`, `setup/` or patches. It is slow and only worth running for those.

## Extensions

Each extension in `extensions/<name>/` has `src/` (edit this) and a **tracked** `out/` (never hand-edit).

```
cd extensions/<name>
npm ci
npm run compile      # then commit the refreshed out/
npm test
```

- `npm test` runs an explicit list of `out/**/*.test.js` files from `package.json`. A new test file is skipped until you add it to that list.
- Several extensions have their own `CLAUDE.md` with architecture notes; read it before changing that extension.
- `null-markdown` is bundled with esbuild (`npm run build`) into a tracked `lib/editor.js`.

## Iterating without a full build

```
scripts/sync-local.ps1     # push compiled extensions + workbench assets into an installed Null IDE
scripts/reload-local.ps1   # reload the window (Developer: Reload Window still serves cached CSS/JS)
```

The `/verify-local` Claude Code skill chains both with the extension's integration specs.

## Patches

Changes that must touch VS Code's own source live in `patches/`. They apply after VSCodium's patches against the VS Code commit at the matching tag. To add one:

```
cd vscode-src
# make the change, commit it
git format-patch HEAD~1 -o ../patches/
```

Pure parts of some patches are covered by `node --test patches/test/*.test.mjs`.

## Installer and updater (`setup/`)

A Rust workspace (`core` + Tauri `app`). `null-setup.exe` is both the updater and the only installer. Logic and tests live in `setup/core`:

```
cargo test -p null-setup-core
```

Run the headless modes from a copy outside the install directory; started from `<install>\setup\null-setup.exe` the process relocates itself and exits at once.

## Shell extension (`shell-ext/`)

A native C++ COM in-process server implementing `IExplorerCommand`, packed as a self-signed sparse APPX. See `shell-ext/CLAUDE.md` in the repo for the build sequence.

## Design docs

Specs and plans are in [`docs/specs/`](https://github.com/TorresVisual/null-ide/tree/main/docs/specs) and [`docs/plans/`](https://github.com/TorresVisual/null-ide/tree/main/docs/plans); the roadmap is [`docs/ROADMAP.md`](https://github.com/TorresVisual/null-ide/blob/main/docs/ROADMAP.md).
