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
