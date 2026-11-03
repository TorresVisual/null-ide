# Extensions

## Built-in extensions

Fourteen extensions are bundled at build time. The installer lets you drop the ones you do not want.

| Extension | Purpose |
|---|---|
| `null-theme` | *Null Dark* color theme (the default) |
| `null-icons` | File and folder icon theme (based on Symbols by Miguel Solorio) |
| `null-tools` | Dashboard, GitHub Issues, pull requests, GitHub Actions, commit messages, worktrees, commit graph, scratch files and notes, ports, Discord, updater, crash recovery |
| `null-markdown` | Markdown Editor and enhanced preview |
| `null-format` | Prettier, rustfmt, clang-format |
| `null-cpp` | C/C++ navigation, scaffolding and CMake toolbar (needs clangd) |
| `null-actions` | Status-bar action buttons |
| `null-accounts` | GitHub, GitLab and SSH account manager |
| `null-env` | Environment check |
| `null-music` | Local music player |
| `null-activity` | Local activity tracking |
| `null-startup` | Startup profiler |
| `null-sync` | Encrypted cross-device sync |
| `null-devcontainer` | Minimal dev containers (`Null: Reopen in Container`) |
| `null-unreal` | Unreal Engine project tooling (Windows, experimental) |
| Code Spell Checker | `streetsidesoftware.code-spell-checker`, bundled |

Remote development (`open-remote-wsl`, `open-remote-ssh`) is bundled as well. A few extensions depend on others: `null-format`, `null-actions` and `null-cpp` need `null-env`, and `null-tools` needs `null-accounts`. Keeping one without its dependency will break it.

See [Features](Features) for what each does day to day.

## Unreal Engine (`null-unreal`)

Experimental and Windows only. It activates in a folder that holds a `.uproject`.

- **Status bar:** a Run button launches the editor. The command palette has `Null Unreal: Run`, `Build`, `Test`, `Smoke`, `Show CLI Path`, `Export Asset` and `Clear Asset Cache`.
- **Settings:** `null-unreal.enginePath` (the engine root, overriding `EngineAssociation`), `null-unreal.project` (picks one `.uproject` when a folder holds several), and `null-unreal.build|test|run|smoke|export.args` (extra engine arguments).
- **Terminal CLI:** `null-unreal` is on the PATH of the integrated terminal. Agents outside it can use `Show CLI Path` to get the absolute shim path.

```
null-unreal <build|test|run|smoke> [--project <file>] [--engine <path>] [--filter <prefix>] [--timeout <s>] [-- <extra engine args>]
```

- `--filter` limits `test` (it defaults to `<ProjectName>.`). `smoke` times out after 120 s and `test` after 600 s. `--timeout` overrides either.
- The output is two lines: the result, then `log: <path>`. Each run keeps its full log in `<project>/Saved/NullUnreal/`, the latest 10 per command.
- M1 prints the result and the log path only, not a summary. Read the log for the details.

| Exit code | Meaning |
|---|---|
| the engine's own code | the process failed; passed through |
| 1 | `export` only: an asset failed or was not exported |
| 2 | usage or resolution error (no engine, no or several `.uproject`) |
| 124 | timed out; the whole process tree was killed |
| 255 | the process was killed without an exit code |

### Reading assets

`null-unreal export <asset.uasset|folder>... [--json] [--force]` has the engine load `.uasset` files and writes what it finds as JSON (plus a PNG for textures and a GLB for skeletal meshes) into `<project>/Saved/NullUnreal/assets/`. Material, material instance, texture, skeletal mesh and skeleton have their own layout; any other class gets a generic property dump and the engine's text export.

- The first export costs a few seconds (the engine starts once for up to 50 assets); an unchanged asset is served from the cache afterwards. The cache is keyed on file modification time, file size and engine version, so it always reflects the **saved** file, never unsaved editor state.
- `--json` prints the export (an object for one asset, an array for several) on stdout, for agents; the report goes to stderr. `--force` ignores the cache.
- Needs the Python plugin enabled in the `.uproject` and the project's editor modules built (run `null-unreal build` on a fresh checkout). `null-unreal` never edits the `.uproject`.
- What Unreal's Python API cannot reach (node sizes, comment boxes, a texture's pixel format and mip count, triangle counts) is recorded as `{"unreadable": "<reason>"}`.
- `Null Unreal: Export Asset` exports the open `.uasset`, the one clicked in the Explorer, or a chosen folder. `Null Unreal: Clear Asset Cache` deletes `Saved/NullUnreal/assets`.
- Exit codes: 0 all exported or cached, 1 an asset failed, 2 the requirements are missing, 124 timed out. Only one export runs per project at a time.

The Null Unreal output channel shows the same output. There is no Problems-panel integration in v1: the summary is not a diagnostics list.

## Installing more

Null IDE uses the VS Marketplace. Install from the Extensions view (`Ctrl+Shift+X`) or the CLI:

```
null --install-extension <publisher.extension-id>
```

Extensions are checked for updates at startup and every few hours, and update automatically (`extensions.autoCheckUpdates`, `extensions.autoUpdate`).

**Local `.vsix` installs are pinned** and never auto-update. Uninstall and reinstall from the Marketplace to unpin.

Suggested on first launch: `llvm-vs-code-extensions.vscode-clangd`, `twxs.cmake`, `ms-python.python`.

## Compatibility

- Null IDE is VSCodium, so the extension API is the VS Code API of the pinned upstream version. An extension that needs a newer VS Code than the one Null IDE currently tracks may refuse to install.
- Microsoft-proprietary extensions (for example the C/C++ extension from Microsoft) may not install or work, because they check that they run in Microsoft's build. Use the open alternative, such as clangd.
- If an extension misbehaves, start with `null --safe-mode` to rule it out. See [Troubleshooting](Troubleshooting).

## Writing an extension for Null IDE

Null IDE's built-in extensions are ordinary VS Code extensions in TypeScript. Look at `extensions/null-actions` for a small example. The rules for working on them are on the [Development](Development#extensions) page.
