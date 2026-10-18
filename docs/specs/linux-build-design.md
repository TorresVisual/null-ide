# Linux build and release (#119)

Status: design, awaiting review. Issue: https://github.com/TorresVisual/null-ide/issues/119

## Goal

Null IDE ships an officially supported Linux x64 build next to the Windows one. Tag builds publish the Linux artifacts to the same GitHub Release. A broken Linux build is visible in CI. The Windows job and its release flow are unchanged.

## Decisions

- **Formats:** `null-ide-linux-x64.tar.gz` (any distro) and `null-ide-linux-x64.deb` (Debian/Ubuntu). No `.rpm`, AppImage, Flatpak or arm64 until requested.
- **CI shape:** a new `build-linux` job in `.github/workflows/build.yml` on `ubuntu-22.04`, running in parallel with `build-windows`. The Windows job is not edited. Shared steps are copied and keep `shell: pwsh` (Ubuntu runners ship PowerShell); Linux-only steps are bash. Extracting shared steps into a composite action is a later, separate cleanup.
- **Reuse upstream:** packaging comes from VSCodium/VS Code's own Linux support (`patches/linux/`, `patches/linux/client/`, `build/azure-pipelines/linux/setup-env.sh`, the `vscode-linux-x64*` and `*-deb` gulp tasks). No custom packaging code. Exact task names are confirmed against the pinned tag when the plan is written.
- **Updates on Linux:** no self-update. The updater shows "Update available" with an "Open release page" action. `.deb` and tarball are installed by the user.
- **Testing:** a CI smoke test under `xvfb` plus a manual checklist for what CI cannot cover.

## `build-linux` job

Shared with Windows (copied): resolve the VSCodium tag, clone VSCodium and VS Code at the pinned tags, node cache, apply VSCodium patches (`patches/` + `patches/linux/` + `patches/linux/client/`), apply overlay patches (fail on reject), merge `product.json`, compile the ten TS extensions and the null-markdown bundle, copy the built-ins, bundle Code Spell Checker and open-remote, the agentHost cleanup, `npm ci`.

Linux-only: sysroot/env setup, `gulp vscode-linux-x64-min-packing`, then the deb prepare/build tasks; copy `icons/icon.png` as the `null` icon (`linuxIconName`); letterpress SVG swap and `null-custom.css` / `null-splash.js` into the output (same as Windows); stamp `version` / `commit` / `release` into the output `product.json`.

Not run on Linux: `win32` icon replacement, rcedit, `shell-ext/`, `setup/` (cargo), `builtins.json` generation (published by the Windows job only, so the two jobs never upload the same file name).

## Release

Both jobs upload to the same release with `softprops/action-gh-release`. Only the Windows job passes `body_path` (release notes); the Linux job uploads files only, so the two never race on the release body. Linux files: `null-ide-linux-x64.tar.gz`, `.tar.gz.sha256`, `null-ide-linux-x64.deb`. `fail_on_unmatched_files` stays on. The existing `null-reh-linux-*.tar.gz` remote servers stay in the Windows job.

## Runtime behaviour

- **Updater (`null-tools`):** `hasWindowsPackage` and the `null-setup.exe` prefetch/install path are guarded by `process.platform === 'win32'`. On Linux the check looks for the Linux asset and offers the release page.
- **Windows-only features** (first-run file under `%APPDATA%`, Discord IPC path, jump list, Explorer menu) are audited with a grep over every extension for `win32`/`APPDATA`/backslash paths; each is gated or given a Linux path. Activation must not throw on Linux.
- **Remote:** unaffected. The REH tarball for Linux is already published.

## Tests and docs

- **CI smoke test:** unpack the tarball, run `xvfb-run null --version`, `--list-extensions`; fail if any built-in is missing. Install the `.deb` in the runner and check `dpkg -L`, the desktop entry, icon and `/usr/bin/null`.
- **Unit tests:** the updater's platform branching is pure and gets `node --test` coverage in `null-tools`.
- **Manual checklist** (`docs/linux-verification.md`): terminal, extension install, settings, `null .`, desktop entry, uninstall. Run once on a real distro; this is what satisfies "tested on Linux".
- **Docs:** wiki page (install, launch, uninstall, runtime dependencies such as GTK3, libsecret, libnotify, libnss3), README, CLAUDE.md (new job, Linux-only exceptions).

## Risks

- Linux gulp/sysroot/deb steps are slow and may need patch tweaks; expect several CI iterations, and `build-local.ps1` cannot validate them.
- `.deb` metadata (package name `null`, maintainer, depends) comes from upstream templates and may need a small overlay.
- Windows-only code paths may exist that the grep misses; the smoke test catches activation failures only.

## Out of scope

arm64, `.rpm`, AppImage, Flatpak/Snap, apt repository, Linux auto-update.
