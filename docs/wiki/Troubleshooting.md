# Troubleshooting

Before filing a bug, check the [FAQ](FAQ) and the open [issues](https://github.com/TorresVisual/null-ide/issues). To report one, see [Contributing](Contributing#reporting-issues).

## Installing

### SmartScreen warns about the installer

The installer is not code-signed. Choose **More info → Run anyway**. The SHA256 check only guards against a corrupted download, not a compromised release, so download from the [official release page](https://github.com/TorresVisual/null-ide/releases/latest).

### The installer refuses my folder

It refuses a folder that is not empty. Pick an empty folder, or reinstall into the folder that already holds your Null IDE install (Modify / Repair).

### The installer window will not open or is blank

It needs the WebView2 runtime. It ships with Windows 11 and Windows 10 22H2. On older Windows 10, install the Evergreen WebView2 runtime from Microsoft.

### I have the old Inno Setup version (1.0.17 or earlier)

Those versions cannot update to the current one. Uninstall the old copy from Settings → Apps → Null IDE, then run the new installer. Your `%APPDATA%\Null` data is kept.

### The Windows 11 "Open in Null" menu entry is missing

The entry comes from a sparse package that needs a certificate approval. It is optional during install; re-run **Null: Setup** (Modify) and enable the Explorer context menu. Windows 10 shows only the classic entries.

## Starting and updating

### `null` is not recognised in the terminal

Open a **new** terminal after installing so the `PATH` change applies. If it still fails, check that the **PATH entry** option is ticked under **Null: Setup**.

### The update button never appears

Updates are checked on startup and at most every 6 hours, and only if `null.updates.check` is on. Run **Null: Check for Updates** to check now.

### The IDE misbehaves after an extension change

Start with `null --safe-mode` (or Start Menu → Null IDE (Safe Mode)). Safe Mode disables installed and Null-owned extensions without changing them. If the problem disappears, re-enable extensions one by one. Use **Restart Normally** to leave Safe Mode. After three failed starts in a row, Null IDE offers Safe Mode itself.

### The editor looks stale after an update

Run **Null: Clear Webview Cache and Reload**.

## Features

### Commit message generation does nothing

It uses the `claude` CLI, which must be installed separately and on `PATH`. Without it, set `null.commitMessage.useClaude` to `false` for a basic message built from the diff.

### C/C++ features are missing

null-cpp layers on the clangd extension (`llvm-vs-code-extensions.vscode-clangd`). Install it, and check `null-cpp.projectDetection.override` if features do not turn on for your workspace. The Null environment check lists missing companion extensions and tools per project.

### Formatting ignores my settings

A project's own `.prettierrc`, `rustfmt.toml` or `.clang-format` always wins over `null-format.*.defaultConfig`. Check for a stray config file in a parent folder. Rustfmt and clang-format must be installed or on `PATH` (or set `null-format.*.path`).

### Discord Rich Presence does not show

Set `null.discord.clientId` to the Application ID from the Discord Developer Portal, keep the Discord desktop app running, and try `null.discord.transport` = `ipc` or `websocket`. **Null: Test Discord Rich Presence** helps narrow it down.

### GitHub Issues view asks me to sign in

Sign-in is required for the Issues and Pull Requests views; use **Null: Sign in to GitHub**. Nothing is sent to GitHub before you sign in.

### A sideloaded extension stopped updating

Extensions installed from a local `.vsix` are pinned. Reinstall from the Marketplace to unpin.

### I lost my sync passphrase

It cannot be recovered. Turn sync off, then set it up again with a new passphrase; the old Gist data is unreadable.

## Remote development

The remote connects to a Null-repacked server published on the release. The remote caches one server per VSCodium commit, so after a built-in change that did not bump VSCodium, delete `~/.null-server/bin/<commit>` on the remote and reconnect. Remote support is new and not yet verified end to end in every CI-built package.

## Known limitations

- Windows x64 and Linux x64 only; Linux has [known limitations](Linux#known-limitations).
- The installer is not code-signed.
- The full editor build only runs in CI, not locally.
- Not every VS Code feature newer than the pinned VSCodium release is available.
