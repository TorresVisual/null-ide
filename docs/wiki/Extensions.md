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
| Code Spell Checker | `streetsidesoftware.code-spell-checker`, bundled |

Remote development (`open-remote-wsl`, `open-remote-ssh`) is bundled as well. A few extensions depend on others: `null-format`, `null-actions` and `null-cpp` need `null-env`, and `null-tools` needs `null-accounts`. Keeping one without its dependency will break it.

See [Features](Features) for what each does day to day.

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
