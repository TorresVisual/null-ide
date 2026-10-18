# Linux verification checklist

Run this once on a real distribution after installing a Linux build. WSL2 with WSLg covers rows 1-9 but not 10-12, which need a desktop session. Record each result in the **Result** column (`pass`, `fail`, or a note). Each failing row becomes a GitHub issue.

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Install the `.deb` with `sudo apt install ./null-ide-linux-x64-<tag>.deb` | Installs with no Microsoft repository added (`ls /etc/apt/sources.list.d` shows none for Microsoft) | |
| 2 | Run `null --version` | Prints the VSCodium version | |
| 3 | Run `null .` | A window opens with the Null Dark theme and the Null Dashboard | |
| 4 | Open a file, edit it, save, undo | Each step behaves as expected and the file on disk matches | |
| 5 | Open the integrated terminal, run `echo $TERM_PROGRAM` and `ls` | The terminal starts `$SHELL` and lists files | |
| 6 | Install an extension from the marketplace (for example clangd) | It installs and activates | |
| 7 | Change a setting, restart, reopen | The setting persists in `~/.config/Null` | |
| 8 | Open a C++ project and press Alt+O | Switches between header and source (null-cpp) | |
| 9 | Run **Null: Check for Updates** | Shows the release-page prompt, with no error | |
| 10 | Look in the application menu | The Null IDE entry and icon are present | |
| 11 | Run `xdg-open` on a `null://` URL | The URL reaches the running app | |
| 12 | Run `sudo apt remove null-ide` | Removes `/usr/bin/null` and the menu entry | |
