# Linux build and release (#119)

Status: design, awaiting review. Issue: https://github.com/TorresVisual/null-ide/issues/119

## Goal

Null IDE ships an officially supported Linux x64 build next to the Windows one. Tag builds publish the Linux artifacts to the same GitHub Release. A broken Linux build is visible in CI. Existing Windows builds keep working.

## Decisions

- **Formats:** `tar.gz` (any distro) and `.deb` (Debian/Ubuntu), x64 only. No `.rpm`, AppImage, Flatpak, Snap, apt repository or arm64 until requested.
- **CI shape:** a new `build-linux` job in `.github/workflows/build.yml` on `ubuntu-22.04`, parallel to `build-windows`. Shared steps are copied and keep `shell: pwsh` (Ubuntu runners ship PowerShell); Linux-only steps are bash. Extracting shared steps into a composite action is a later, separate cleanup. The `build-windows` job's steps are not changed except for the asset rename below.
- **Independence:** a Linux failure never blocks the Windows release. The run shows red and Linux files attach whenever that job finishes.
- **Manual runs:** `workflow_dispatch` gets a `build_linux` boolean input (default true). Tag pushes always build both.
- **Reuse upstream:** packaging comes from VS Code/VSCodium's Linux support (`patches/linux/`, `patches/linux/client/`, `build/azure-pipelines/linux/setup-env.sh`, the `vscode-linux-x64*` and `*-deb` gulp tasks). Exact task names are confirmed against the pinned tag when the plan is written.
- **Package name:** the `.deb` package is `null-ide` (binary and install dir stay `null`: `/usr/bin/null`, `/usr/share/null`). Removal is `apt remove null-ide`.
- **Updates on Linux:** no self-update. The updater offers "Open release page". Installing is the user's job.
- **Discord Rich Presence:** a clean no-op on Linux (no error, no status item). Real Linux support is a follow-up issue.
- **Branch workflow:** work happens on a `linux-build` branch in small commits; the user pushes and dispatches the workflow on that branch; failures are read with `gh run view --log-failed`. Nothing merges to `main` before a green run.

## Release assets

All assets follow `null-ide-<platform>-x64-<tag>.<ext>`. `<tag>` is the release tag on tag builds (e.g. `v1.0.21`) and the VSCodium tag on manual runs, the rule the `NullIDESetup-<version>.exe` stub already uses.

| Platform | Assets |
|---|---|
| Windows | `null-ide-win32-x64-<tag>.zip`, `.zip.sha256` (was unversioned) |
| Linux | `null-ide-linux-x64-<tag>.tar.gz`, `.tar.gz.sha256`, `null-ide-linux-x64-<tag>.deb` |

The Windows rename is a separate commit so it can be reverted alone. Installed clients already accept it: `setup/core/src/release.rs` matches `starts_with("null-ide-win32-x64") && ends_with(".zip")` and finds the sidecar as `<zip name>.sha256`; `null-tools` `hasWindowsPackage` allows a `-suffix`. No updater code changes. Touched by the rename: `build.yml` (Windows job), `scripts/build-local.ps1`, `scripts/fake-release.mjs`, README, wiki (Getting-Started, Development), CLAUDE.md. The `.deb`'s internal package version stays the VSCodium version (as the app's `product.json` version does); only the file name carries the Null tag, via a `mv` after `dpkg-deb`.

The `null-reh-linux-*.tar.gz` remote servers stay in the Windows job. `builtins.json` stays Windows-only so the two jobs never upload the same name.

## `build-linux` job

Shared with Windows (copied): resolve the VSCodium tag, clone VSCodium and VS Code, node cache, apply VSCodium patches (`patches/` + `patches/linux/` + `patches/linux/client/`), apply overlay patches (fail on reject), merge `product.json`, compile the ten TS extensions and the null-markdown bundle, copy the built-ins, bundle Code Spell Checker and open-remote, the agentHost cleanup, `npm ci`.

Linux-only: sysroot/env setup, `gulp vscode-linux-x64-min-packing`, the deb prepare/build tasks, tarball creation; install `icons/icon.png` as the `null` icon (`linuxIconName`); letterpress SVG swap and `null-custom.css` / `null-splash.js` into the output; stamp `version` / `commit` / `release` into the output `product.json`.

Not run on Linux: win32 icon replacement, rcedit, `shell-ext/`, `setup/` (cargo), `builtins.json`.

## `.deb` metadata patch (`patches/012-linux-deb-metadata.patch`)

The stock templates in `resources/linux/debian/` are Microsoft's. For any app name other than `code-oss`, `postinst` registers Microsoft's apt repository (`packages.microsoft.com/repos/code`) and trusts `microsoft.gpg`, and by default does so in non-interactive installs. `control` names Microsoft as maintainer with VS Code's description. VSCodium has no patch against these templates, so Null's `.deb` would inherit this. The overlay patch:

- removes the Microsoft repository and key logic and the debconf prompt from `postinst`, `postrm` and `templates`;
- sets `Package: null-ide`, drops the `visual-studio-null` Provides/Conflicts/Replaces lines;
- sets `Maintainer: Null IDE <TorresVisual@users.noreply.github.com>` (a public, non-personal address), and Null IDE's Description and Homepage;
- leaves everything else upstream: `/usr/bin/null` symlink, desktop and URL-handler entries, MIME type, bash/zsh completions, `update-alternatives` editor registration (priority 0).

`012` is a patch against VS Code's own source, so it belongs in `patches/` per the repo's patch rules, applied by the Linux job (the Windows job applies every `patches/*.patch` too; it must apply cleanly there or be skipped by name, decided in the plan).

## Runtime behaviour

- **Updater (`null-tools`):** `hasWindowsPackage` and the `null-setup.exe` prefetch/install path are guarded by `process.platform === 'win32'`. On Linux the check looks for the `null-ide-linux-x64-*.tar.gz` asset and offers the release page.
- **Discord:** `discordRpcClient` / presence activation returns early on non-Windows.
- **Other Windows-only code** (first-run file under `%APPDATA%`, jump list, Explorer menu) is found by a grep over every extension for `win32`/`APPDATA`/backslash paths; each is gated or given a Linux path. Activation must not throw on Linux.
- **Remote:** unaffected; the Linux REH tarball is already published.

## Tests and docs

- **CI smoke test (hard-fail, no upload from a build that fails it):** unpack the tarball and run `xvfb-run null --version` and `--list-extensions`, failing if any built-in is missing; install the `.deb` and check `dpkg -L`, desktop entry, icon, `/usr/bin/null`; inspect it with `dpkg-deb -I` / `-e` and fail if "microsoft" appears in any control file. xvfb steps retry once before any relaxation.
- **Unit tests:** the updater's platform branching is pure and gets `node --test` coverage in `null-tools`.
- **Manual checklist** (`docs/linux-verification.md`): terminal, extension install, settings, `null .`, desktop entry, uninstall, `apt remove null-ide`. The user runs it once on a real distro (WSL2 with WSLg covers terminal and extensions but not the desktop entry). This satisfies "tested on Linux".
- **Docs:** wiki page (install, launch, uninstall incl. leftover `~/.config/Null`, runtime dependencies such as GTK3, libsecret, libnotify, libnss3; glibc baseline from the VS Code sysroot), README, CLAUDE.md (new job, Linux-only exceptions, asset names).

## Risks

- Linux gulp/sysroot/deb steps are slow and may need patch tweaks; expect several CI iterations, and `build-local.ps1` cannot validate them.
- Patch `012` is against templates that change between VS Code releases; the existing "fail when an overlay patch does not apply" step catches drift.
- Windows-only code paths may exist that the grep misses; the smoke test catches activation failures only.

## Out of scope

arm64, `.rpm`, AppImage, Flatpak/Snap, apt repository, Linux auto-update, Discord on Linux.
