# null-unreal

Unreal Engine project tooling (issue #149, M1). Workspace-side (no `extensionKind`), activated by `workspaceContains:**/*.uproject`. Windows only and labelled experimental; **not in the REH list** in `build.yml` because the engine is Windows-only and remote hosts are Linux.

Pure modules (no `vscode` import) are tested with `node --test`. Only `extension.ts`, `statusBar.ts` and `commands.ts` import `vscode`. `out/cli.js` is the only place a command line is built; the extension spawns it on the editor's runtime (`ELECTRON_RUN_AS_NODE=1`).

Design `docs/specs/null-unreal-tooling-design.md`; plan `docs/plans/null-unreal-m1-foundation.md`.
