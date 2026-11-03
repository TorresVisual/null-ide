# null-unreal

Unreal Engine project tooling (issue #149, M1) and the asset core (issue #150). Workspace-side (no `extensionKind`), activated by `workspaceContains:**/*.uproject`. Windows only and labelled experimental; **not in the REH list** in `build.yml` because the engine is Windows-only and remote hosts are Linux.

Pure modules (no `vscode` import), tested with `node --test` and listed explicitly in `package.json`'s `test` script:
- `uproject` resolves the project (walk up, or `--project`); `engine` resolves the engine (override, registry, `LauncherInstalled.dat`, walk-up). All engine paths live here.
- `commandLine` is the only place a command line is built. `logs` opens and rotates `Saved/NullUnreal` logs. `runner` spawns with `shell: false` and kills the whole tree on timeout (`taskkill /T /F`).
- `result` formats the two output lines and maps exit codes; `cli` is the entry point (`out/cli.js`), `main(argv, deps)` returns the exit code.
- `shim` writes the `null-unreal.cmd` and POSIX `null-unreal` launchers that run the CLI with `ELECTRON_RUN_AS_NODE=1`.

Asset core (`null-unreal export`, `Export Asset`, `Clear Asset Cache`):
- `engine/export_asset.py` runs inside `UnrealEditor-Cmd -run=PythonScript` and is the only code that touches the engine's Python API. It reads the request file named by `NULL_UNREAL_REQUEST` and writes one JSON per asset (sidecars PNG/GLB beside it) under `Saved/NullUnreal/assets/<package path>` and a manifest rewritten after every asset. Data travels in files, never stdout. Anything it cannot read is `{"unreadable": reason}`, never omitted. It cannot be unit-tested; `/verify-local null-unreal` and a manual `null-unreal export` against a real project cover it.
- `exportFormat` (request, manifest, export shapes and `summarize`), `packagePath` (`/Game` and plugin mounts), `cache` (a hit needs schema, engine version, source mtime, source size and every sidecar), `lock` (`export.lock`, dead PID taken over), `exporter` (batches of at most 50, timeout 120 s + 2 s/asset, crash keeps what was written) are pure; `assetStore` is the viewers' queue (`peek`, `get`, `getMany`, state events) over a `StoreBackend`. `assets.ts` is the vscode side and spawns the CLI.
- Engine quirks: `get_material_property_input_node` with `MP_MAX` crashes the editor (the script queries a whitelist); a project with an unbuilt module exits 1 with no log line naming it, so a missing manifest is classified from the log as best it can; `PythonScriptPlugin` set to disabled in a `.uproject` still ran in 5.8, so that error path is unverified.
- Adding a field to an export means editing `export_asset.py` and `exportFormat.ts`; changing a field's meaning bumps `SCHEMA` (old entries become stale).

Only `extension.ts`, `commands.ts`, `assets.ts` and `statusBar.ts` import `vscode`. The extension spawns `out/cli.js` on the editor's runtime (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`); it never builds a command line itself. The integration spec (`npm run test:integration`, via `/verify-local null-unreal`) checks activation, the five commands and the shim.

`out/` is tracked. After editing `src/`, run `npm run compile` and commit the refreshed `out/` as `chore: refresh null-unreal compiled output`.

Design `docs/specs/null-unreal-tooling-design.md` and `docs/specs/null-unreal-asset-core-design.md`; plan `docs/plans/null-unreal-m1-foundation.md`.
