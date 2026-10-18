# Getting Started

## Requirements

On Linux, see [Linux](Linux) for the `.deb` and tarball instead.

- Windows 10 22H2 or Windows 11, x64.
- The WebView2 runtime (part of Windows 11; Windows 10 22H2 ships it too). The installer window needs it.
- No administrator rights, apart from one optional approval for the Windows 11 context-menu certificate.

## Install

1. Download `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest) and run it.
2. The installer is not code-signed, so Windows SmartScreen may ask you to confirm. The SHA256 check only guards against a corrupted or truncated download, not against a compromised release.
3. The wizard downloads the newest release and lets you pick:
   - the install folder (default `%LOCALAPPDATA%\Programs\Null IDE`)
   - shortcuts, the `PATH` entry, the Explorer context menu and file associations
   - which built-in extensions to keep
   - a few starting settings: theme, font, auto save, format on save, update check, menu bar

   **Use recommended defaults** skips ahead.

A portable `null-ide-win32-x64-<tag>.zip` (with a `.sha256`) is also attached to each release.

### Modify, repair, uninstall

Run the installer again, or use **Settings → Apps → Null IDE**. Inside the IDE, **Null: Setup** opens the same window on Modify. Uninstall keeps `%APPDATA%\Null` (settings, extensions) unless you tick the box to delete it.

### Coming from the old installer (v1.0.17 and earlier)

Uninstall the old copy first (Settings → Apps → Null IDE); the new installer refuses a folder that is not empty. Your settings and extensions in `%APPDATA%\Null` are not touched by that uninstall. Those older versions cannot update themselves to the current one.

## First launch

The **Null Dashboard** opens on startup. Use it to open a recent project, **Open Folder**, **Clone Repo** or start a **New Project**. Pin the projects you use most.

On first launch Null IDE suggests a few extensions: `llvm-vs-code-extensions.vscode-clangd`, `twxs.cmake` and `ms-python.python`. See [Extensions](Extensions).

## Open things from the terminal

Open a new terminal after installing so the `PATH` change takes effect.

```
null .                      # open the current folder
null C:\path\to\project     # open a specific folder
null README.md              # open a file
null --safe-mode            # start with all extensions disabled
```

In Explorer, right-click a file or folder (or a folder's background) and choose **Open in Null**.

## Updating

A status-bar button appears when a new release is available (checked on startup, at most every 6 hours). Click it and the IDE closes, updates and reopens. You can also run **Null: Check for Updates** from the command palette. To turn the check off, see [Configuration](Configuration#updates).

## Next steps

- [Features](Features) for what is built in
- [Configuration](Configuration) to tune it
- [Troubleshooting](Troubleshooting) if the install did not go smoothly
