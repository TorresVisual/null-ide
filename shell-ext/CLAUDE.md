# shell-ext/

Native C++ COM in-process server implementing `IExplorerCommand` for the Win11 Explorer context menu.

## CI build sequence

1. Fetch Microsoft WIL headers into `shell-ext/deps/wil/`.
2. Compile the DLL with CMake + Visual Studio 2022: `null_explorer_command.dll` (x64).
3. Stage the DLL alongside icons and `AppxManifest.xml` under `VSCode-win32-x64/shell-ext/`.
4. Pack a **sparse APPX** (`null-shell-ext.appx`) via `makeappx` — the manifest points `ExternalLocation` at the Null IDE install root, so the DLL and `null.exe` live outside the package.
5. Sign the APPX with a self-signed cert (CN=Null IDE); the installer trusts the cert before calling `Add-AppxPackage`.

The APPX registers three context menu verbs via `IFileExplorerContextMenus`: files (`*`), folders (`Directory`), and folder backgrounds (`Directory\Background`). This replaces the older HKCU registry approach on Windows 11+.

## Cold-start identity gotcha

A process launched by `Invoke()` inherits the sparse package's AUMID from whichever process calls `CreateProcess` — the packaged `dllhost.exe` surrogate hosting the DLL — and no `CreateProcessW`/`STARTUPINFOEX` attribute can strip it after the fact (measured: `PROC_THREAD_ATTRIBUTE_DESKTOP_APP_POLICY` and `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` are both dead ends here).

`LaunchViaExplorer()` in `src/explorer_command.cc` works around this by marshalling the spawn to the already-running (unpackaged) `explorer.exe` via `Shell.Application`, falling back to plain `CreateProcessW` only if Explorer is unavailable.

`src/identity_stub.cc` (built as `null_identity_stub.exe`, never executed) exists solely so the manifest's required `<Application Executable="...">` doesn't point at `null.exe` itself — Windows does *not* fuse package identity onto whatever file that attribute names, but a sparse package still requires the entry to point somewhere other than the real editor binary.

`scripts/check-cold-start-aumid.ps1` diagnoses AUMID regressions here — run it in a plain terminal window outside Null IDE, not a terminal panel inside it.

## Desktop widgets host (`widgets/`)

`null_widgets.exe` (#141) draws Projects, Issues and Pull Requests as borderless layered windows on the desktop from `%LOCALAPPDATA%Nullwidgetssnapshot.json`; the IDE (`null-tools`, `src/widgets/`) is the only writer and the exe never touches the network. It is an ordinary unpackaged exe (no package identity, no signing), so the cold-start AUMID gotcha above does not apply to it.

- `null_widget_core` (snapshot parse and validation, row layout, placement, safe launching) has no window or Direct2D calls and is covered by four CTest executables (`snapshot_test`, `layout_test`, `placement_test`, `actions_test`, fixtures in `widgets/fixtures/`); `app.cc` is the window shell. CI runs `ctest` and copies the exe next to `null.exe`.
- **Windows are layered children of the desktop's icon host (`SHELLDLL_DefView`)**, found through `Progman` (`0x052C` on older builds). A top-level window pinned above `Progman` is hidden by Win+D and `HWND_BOTTOM` hides behind the wallpaper (`docs/specs/native-windows-widgets-gate.md`). Child windows need the embedded manifest (`null_widgets.manifest`: `supportedOS` + PerMonitorV2) and `UpdateLayeredWindow` positions in the parent's client coordinates. Explorer destroys the children when it restarts, so `EnsureWindows` (5 s timer, `TaskbarCreated`) recreates them.
- Child windows get no `WM_DISPLAYCHANGE`/`WM_POWERBROADCAST`/`WM_DPICHANGED`: a hidden top-level control window receives those.
- The snapshot is untrusted input (https://github.com URLs only, absolute project paths only, text capped and drawn as plain text).
- `scripts/check-widgets.ps1` (`-Status`, `-Checklist`) drives the manual run. Windows 10 is untested.
