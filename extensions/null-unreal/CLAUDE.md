# null-unreal

Unreal Engine project tooling (issue #149, M1). Workspace-side (no `extensionKind`), activated by `workspaceContains:**/*.uproject`. Windows only and labelled experimental; **not in the REH list** in `build.yml` because the engine is Windows-only and remote hosts are Linux.

Pure modules (no `vscode` import), tested with `node --test` and listed explicitly in `package.json`'s `test` script:
- `uproject` resolves the project (walk up, or `--project`); `engine` resolves the engine (override, registry, `LauncherInstalled.dat`, walk-up). All engine paths live here.
- `commandLine` is the only place a command line is built. `logs` opens and rotates `Saved/NullUnreal` logs. `runner` spawns with `shell: false` and kills the whole tree on timeout (`taskkill /T /F`).
- `result` formats the two output lines and maps exit codes; `cli` is the entry point (`out/cli.js`), `main(argv, deps)` returns the exit code.
- `shim` writes the `null-unreal.cmd` and POSIX `null-unreal` launchers that run the CLI with `ELECTRON_RUN_AS_NODE=1`.

Only `extension.ts`, `commands.ts` and `statusBar.ts` import `vscode`. The extension spawns `out/cli.js` on the editor's runtime (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`); it never builds a command line itself. The integration spec (`npm run test:integration`, via `/verify-local null-unreal`) checks activation, the five commands and the shim.

`out/` is tracked. After editing `src/`, run `npm run compile` and commit the refreshed `out/` as `chore: refresh null-unreal compiled output`.

Design `docs/specs/null-unreal-tooling-design.md`; plan `docs/plans/null-unreal-m1-foundation.md`.
