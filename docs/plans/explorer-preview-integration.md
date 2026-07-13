# Explorer Preview Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Make Windows Explorer's Preview Pane (Alt+P) show plain-text content for the curated set of code/text extensions Null IDE already recognizes, instead of "No preview available".

**Architecture:** A second COM class (`IPreviewHandler` + `IPreviewHandlerVisuals` + `IObjectWithSite` + `IOleWindow` + `IInitializeWithFile`) is added to the existing `null_explorer_command.dll` in `shell-ext/`, alongside the current `IExplorerCommand` class — same DLL, same CMake target, no new build artifact. Unlike the context-menu feature, this does **not** use the AppX sparse-package/COM-surrogate path: preview handlers are resolved by Explorer via classic per-user registry lookups (`HKCU\Software\Classes\CLSID\...`, `HKCU\...\PreviewHandlers` allow-list, `HKCU\Software\Classes\<ext>\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}`), all achievable without admin elevation. `scripts/install-null-ide.ps1` gains `Register-PreviewHandler`/`Unregister-PreviewHandler`, reusing the existing `$FileAssocMap` extension list, wired into `Install-Zip` and `installer/null-ide.iss` following the exact pattern already used for `Register-FileAssociations`/`Unregister-FileAssociations`.

**Tech Stack:** C++17 (WRL/COM, `shell-ext/`), CMake + MSVC (existing `shell-ext/CMakeLists.txt` target, no new target), PowerShell 5.1 (`scripts/install-null-ide.ps1`), Inno Setup (Pascal script).

## Global Constraints

- No administrator elevation anywhere — all registry writes are `HKCU`. (spec: Constraints)
- Preview fidelity is plain monospace text only — no syntax highlighting, no theming of the preview pane background/text colors. (spec: Preview fidelity)
- Extension scope is exactly `$FileAssocMap` (`scripts/install-null-ide.ps1`) — no new curation, no extensions added or removed. (spec: Scope)
- `Unregister-PreviewHandler` must only delete a given extension's `shellex` registration if it still points at Null IDE's own CLSID — never blindly delete, in case another app re-registered over it later. (spec: Constraints)
- This feature does **not** touch `shell-ext/AppxManifest.xml` — preview handler registration is classic registry-based, independent of the sparse-package/COM-surrogate mechanism used for the Win11 context menu. Do not add a `com:Extension`/`windows.previewHandler`-style entry; no such AppX extension category exists for preview handlers. (spec: Component 2)
- New COM class implements `IInitializeWithFile` only (not `IPersistFile`/`IInitializeWithStream`) — sufficient for Explorer's Preview Pane host on this app's Windows 10 19041+/Windows 11 baseline. (design decision made during planning, recorded here since the spec doesn't call it out explicitly)
- Size/binary guards: 256 KB or ~5,000 lines cap (whichever comes first), NUL-byte sniff over the first 8 KB to detect binary content. (spec: Component 1)
- This repo has no automated test framework for PowerShell, Inno, or the `shell-ext` C++ code. Verification in this plan is: (a) for the native COM class, a real local CMake/MSVC build plus a registry-free COM smoke test that loads the built DLL directly and exercises `DllGetClassObject`/`IClassFactory::CreateInstance`/`QueryInterface`; (b) for the PowerShell functions, real local invocation against `HKCU` with `Get-ItemProperty`/`Test-Path` assertions, always immediately unregistered afterward; (c) for the Inno Setup script, structural review (no local Inno toolchain, and the full CI build is required for compilation per `CLAUDE.md`).
- Do not run the CI build (`npx gulp ...`) locally (CLAUDE.md: Scope Constraints). `install-null-ide.ps1` and the `shell-ext` CMake build are both fine to run locally — installer/build-verification scripts, not "the build" the constraint refers to.
- Work only inside `D:\Coding\Apps\null-ide\` (CLAUDE.md: Scope Constraints).

---

### Task 1: Add the native `IPreviewHandler` COM class to `shell-ext`

**Files:**
- Create: `shell-ext/src/preview_handler.cc`
- Modify: `shell-ext/CMakeLists.txt`

**Interfaces:**
- Produces: a COM class `__declspec(uuid(PREVIEW_HANDLER_UUID)) PreviewHandler`, CLSID `{58F3B583-5D67-489A-9069-97FD45B2569B}` (compile-time constant `PREVIEW_HANDLER_UUID`, mirroring the existing `DLL_UUID` pattern), implementing `IPreviewHandler`, `IPreviewHandlerVisuals`, `IObjectWithSite`, `IOleWindow`, `IInitializeWithFile`. Registered into the same WRL creator map as the existing `ExplorerCommandHandler` class (both live in `null_explorer_command.dll`; `DllGetClassObject`/`DllCanUnloadNow` in `explorer_command.cc` already dispatch generically across all `CoCreatableClass`-registered classes — no changes needed there). Task 2 consumes this CLSID string as `$PreviewHandlerClsid`.

- [ ] **Step 1: Write the COM class implementation**

Create `shell-ext/src/preview_handler.cc`:

```cpp
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
//
// IPreviewHandler implementation for Null IDE's curated code/text file
// types. Renders plain monospace text in Windows Explorer's Preview Pane.

#include <windows.h>
#include <shobjidl_core.h>
#include <ocidl.h>
#include <oleidl.h>

#include <algorithm>
#include <string>
#include <vector>

#include <wrl/module.h>
#include <wrl/implements.h>
#include <wrl/client.h>
#include "wil/resource.h"
#include "wil/win32_helpers.h"

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::InhibitRoOriginateError;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

constexpr size_t kMaxPreviewBytes = 256 * 1024;  // 256 KB cap
constexpr size_t kMaxPreviewLines = 5000;
constexpr wchar_t kTruncationNotice[] =
    L"\r\n\r\n\x2026 truncated \x2014 open in Null IDE to view the full file";
constexpr wchar_t kNoPreviewNotice[] = L"No preview available for this file.";
constexpr wchar_t kPreviewWindowClass[] = L"NullIdePreviewHandlerHost";

// Reads up to kMaxPreviewBytes of |path| and decodes it as UTF-16LE/UTF-8.
// Sets |isBinary| when the first 8 KB sampled contains a NUL byte.
std::wstring LoadPreviewText(const std::wstring& path, bool* isBinary) {
  *isBinary = false;

  wil::unique_hfile file(CreateFileW(path.c_str(), GENERIC_READ,
                                     FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                     FILE_ATTRIBUTE_NORMAL, nullptr));
  if (!file) {
    return L"";
  }

  std::vector<unsigned char> buffer(kMaxPreviewBytes);
  DWORD bytesRead = 0;
  if (!ReadFile(file.get(), buffer.data(),
               static_cast<DWORD>(buffer.size()), &bytesRead, nullptr)) {
    return L"";
  }
  buffer.resize(bytesRead);

  const size_t sampleSize = (std::min)(static_cast<size_t>(bytesRead), static_cast<size_t>(8192));
  for (size_t i = 0; i < sampleSize; ++i) {
    if (buffer[i] == 0) {
      *isBinary = true;
      return L"";
    }
  }

  std::wstring text;
  if (bytesRead >= 2 && buffer[0] == 0xFF && buffer[1] == 0xFE) {
    // UTF-16 LE BOM.
    const wchar_t* wideStart = reinterpret_cast<const wchar_t*>(buffer.data() + 2);
    const size_t wideLen = (bytesRead - 2) / sizeof(wchar_t);
    text.assign(wideStart, wideLen);
  } else {
    size_t skip = 0;
    if (bytesRead >= 3 && buffer[0] == 0xEF && buffer[1] == 0xBB && buffer[2] == 0xBF) {
      skip = 3;  // UTF-8 BOM.
    }
    const char* utf8Start = reinterpret_cast<const char*>(buffer.data() + skip);
    const int utf8Len = static_cast<int>(bytesRead - skip);
    const int wideLen = MultiByteToWideChar(CP_UTF8, 0, utf8Start, utf8Len, nullptr, 0);
    if (wideLen > 0) {
      text.resize(wideLen);
      MultiByteToWideChar(CP_UTF8, 0, utf8Start, utf8Len, text.data(), wideLen);
    }
  }

  size_t lineCount = 0;
  size_t cutAt = text.size();
  for (size_t i = 0; i < text.size(); ++i) {
    if (text[i] == L'\n') {
      if (++lineCount >= kMaxPreviewLines) {
        cutAt = i;
        break;
      }
    }
  }

  const bool truncated = (cutAt < text.size()) || (bytesRead == kMaxPreviewBytes);
  if (truncated) {
    text.resize(cutAt);
    text += kTruncationNotice;
  }

  return text;
}

LRESULT CALLBACK PreviewWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

void EnsureWindowClassRegistered(HINSTANCE instance) {
  static bool registered = false;
  if (registered) {
    return;
  }
  WNDCLASSW wc{};
  wc.lpfnWndProc = PreviewWndProc;
  wc.hInstance = instance;
  wc.lpszClassName = kPreviewWindowClass;
  wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  RegisterClassW(&wc);
  registered = true;
}

}  // namespace

class __declspec(uuid(PREVIEW_HANDLER_UUID)) PreviewHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom | InhibitRoOriginateError>,
                          IPreviewHandler, IPreviewHandlerVisuals,
                          IObjectWithSite, IOleWindow, IInitializeWithFile> {
 public:
  // IInitializeWithFile
  IFACEMETHODIMP Initialize(LPCWSTR filePath, DWORD grfMode) {
    UNREFERENCED_PARAMETER(grfMode);
    filePath_ = filePath;
    return S_OK;
  }

  // IPreviewHandler
  IFACEMETHODIMP SetWindow(HWND hwnd, const RECT* rect) {
    parentWindow_ = hwnd;
    if (rect) {
      rect_ = *rect;
    }
    if (previewWindow_) {
      SetParent(previewWindow_, parentWindow_);
      MoveWindow(previewWindow_, rect_.left, rect_.top,
                rect_.right - rect_.left, rect_.bottom - rect_.top, TRUE);
    }
    return S_OK;
  }

  IFACEMETHODIMP SetRect(const RECT* rect) {
    if (!rect) {
      return E_POINTER;
    }
    rect_ = *rect;
    if (previewWindow_) {
      MoveWindow(previewWindow_, rect_.left, rect_.top,
                rect_.right - rect_.left, rect_.bottom - rect_.top, TRUE);
    }
    return S_OK;
  }

  IFACEMETHODIMP DoPreview() {
    if (!parentWindow_ || filePath_.empty()) {
      return E_UNEXPECTED;
    }

    const HINSTANCE instance = wil::GetModuleInstanceHandle();
    EnsureWindowClassRegistered(instance);

    if (previewWindow_) {
      DestroyWindow(previewWindow_);
      previewWindow_ = nullptr;
      textControl_ = nullptr;
    }

    previewWindow_ = CreateWindowExW(
        0, kPreviewWindowClass, L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
        rect_.left, rect_.top, rect_.right - rect_.left,
        rect_.bottom - rect_.top, parentWindow_, nullptr, instance, nullptr);
    if (!previewWindow_) {
      return HRESULT_FROM_WIN32(GetLastError());
    }

    textControl_ = CreateWindowExW(
        0, L"EDIT", L"",
        WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY |
            ES_AUTOVSCROLL,
        0, 0, rect_.right - rect_.left, rect_.bottom - rect_.top,
        previewWindow_, nullptr, instance, nullptr);
    if (!textControl_) {
      return HRESULT_FROM_WIN32(GetLastError());
    }

    NONCLIENTMETRICSW metrics{sizeof(metrics)};
    if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof(metrics), &metrics, 0)) {
      metrics.lfMessageFont.lfPitchAndFamily = FIXED_PITCH | FF_MODERN;
      wcsncpy_s(metrics.lfMessageFont.lfFaceName, L"Cascadia Mono", _TRUNCATE);
      font_.reset(CreateFontIndirectW(&metrics.lfMessageFont));
      if (!font_) {
        wcsncpy_s(metrics.lfMessageFont.lfFaceName, L"Consolas", _TRUNCATE);
        font_.reset(CreateFontIndirectW(&metrics.lfMessageFont));
      }
      if (font_) {
        SendMessageW(textControl_, WM_SETFONT, reinterpret_cast<WPARAM>(font_.get()), TRUE);
      }
    }

    bool isBinary = false;
    const std::wstring text = LoadPreviewText(filePath_, &isBinary);
    SetWindowTextW(textControl_, isBinary ? kNoPreviewNotice : text.c_str());

    return S_OK;
  }

  IFACEMETHODIMP Unload() {
    if (previewWindow_) {
      DestroyWindow(previewWindow_);
      previewWindow_ = nullptr;
      textControl_ = nullptr;
    }
    font_.reset();
    filePath_.clear();
    return S_OK;
  }

  IFACEMETHODIMP SetFocus() {
    if (textControl_) {
      ::SetFocus(textControl_);
      return S_OK;
    }
    return S_FALSE;
  }

  IFACEMETHODIMP QueryFocus(HWND* focusedWindow) {
    if (!focusedWindow) {
      return E_POINTER;
    }
    *focusedWindow = GetFocus();
    return *focusedWindow ? S_OK : E_FAIL;
  }

  IFACEMETHODIMP TranslateAccelerator(MSG* msg) {
    UNREFERENCED_PARAMETER(msg);
    return S_FALSE;
  }

  // IPreviewHandlerVisuals
  IFACEMETHODIMP SetBackgroundColor(COLORREF color) {
    UNREFERENCED_PARAMETER(color);
    return S_OK;
  }
  IFACEMETHODIMP SetFont(const LOGFONTW* font) {
    UNREFERENCED_PARAMETER(font);
    return S_OK;
  }
  IFACEMETHODIMP SetTextColor(COLORREF color) {
    UNREFERENCED_PARAMETER(color);
    return S_OK;
  }

  // IObjectWithSite
  IFACEMETHODIMP SetSite(IUnknown* site) {
    site_ = site;
    return S_OK;
  }

  IFACEMETHODIMP GetSite(REFIID riid, void** site) {
    if (!site) {
      return E_POINTER;
    }
    *site = nullptr;
    return site_ ? site_.CopyTo(riid, site) : E_FAIL;
  }

  // IOleWindow
  IFACEMETHODIMP GetWindow(HWND* hwnd) {
    if (!hwnd) {
      return E_POINTER;
    }
    *hwnd = previewWindow_;
    return previewWindow_ ? S_OK : E_FAIL;
  }

  IFACEMETHODIMP ContextSensitiveHelp(BOOL enterMode) {
    UNREFERENCED_PARAMETER(enterMode);
    return E_NOTIMPL;
  }

 private:
  std::wstring filePath_;
  HWND parentWindow_ = nullptr;
  HWND previewWindow_ = nullptr;
  HWND textControl_ = nullptr;
  RECT rect_{};
  wil::unique_hfont font_;
  ComPtr<IUnknown> site_;
};

CoCreatableClass(PreviewHandler)
CoCreatableClassWrlCreatorMapInclude(PreviewHandler)
```

- [ ] **Step 2: Add the new source file and CLSID to CMakeLists.txt**

In `shell-ext/CMakeLists.txt`, change:

```cmake
add_library(null_explorer_command SHARED
    src/explorer_command.cc
    src/explorer_command.def
    src/explorer_command.rc
)
```

to:

```cmake
add_library(null_explorer_command SHARED
    src/explorer_command.cc
    src/preview_handler.cc
    src/explorer_command.def
    src/explorer_command.rc
)
```

And change:

```cmake
target_compile_definitions(null_explorer_command PRIVATE
    _WINDLL
    WIN32_LEAN_AND_MEAN
    _UNICODE
    UNICODE
    _CRT_SECURE_NO_DEPRECATE
    _CRT_NONSTDC_NO_DEPRECATE
    # COM class GUID — must match AppxManifest.xml <com:Class Id>
    DLL_UUID="A72D088B-AC8B-4AB5-ABFE-49C5CE37A466"
    # Executable name (case-sensitive on some APIs)
    EXE_NAME="null.exe"
)
```

to:

```cmake
target_compile_definitions(null_explorer_command PRIVATE
    _WINDLL
    WIN32_LEAN_AND_MEAN
    _UNICODE
    UNICODE
    _CRT_SECURE_NO_DEPRECATE
    _CRT_NONSTDC_NO_DEPRECATE
    # COM class GUID — must match AppxManifest.xml <com:Class Id>
    DLL_UUID="A72D088B-AC8B-4AB5-ABFE-49C5CE37A466"
    # Preview handler COM class GUID — registered via classic registry
    # (scripts/install-null-ide.ps1), not AppxManifest.xml. See CLAUDE.md-
    # adjacent design doc: docs/specs/explorer-preview-integration-design.md
    PREVIEW_HANDLER_UUID="58F3B583-5D67-489A-9069-97FD45B2569B"
    # Executable name (case-sensitive on some APIs)
    EXE_NAME="null.exe"
)
```

- [ ] **Step 3: Reconfigure and build locally**

A local build directory already exists at `shell-ext-build/` (git-ignored, previously configured with Visual Studio 2026 present on this machine). Reconfigure it to pick up the new source file, then build:

Run:
```powershell
cd d:\Coding\Apps\null-ide
cmake -S shell-ext -B shell-ext-build
cmake --build shell-ext-build --config Release
```

Expected: both commands exit 0. The build output ends with `null_explorer_command.vcxproj -> D:\Coding\Apps\null-ide\shell-ext-build\Release\null_explorer_command.dll` and no `error` lines. If there are compile errors, fix them and re-run `cmake --build shell-ext-build --config Release` until clean — do not proceed to Step 4 with a failing build.

- [ ] **Step 4: Write a registry-free COM smoke test**

This loads the freshly-built DLL directly and calls `DllGetClassObject`/`IClassFactory::CreateInstance`/`QueryInterface` in-process — it proves the class factory and interface implementations are wired correctly without writing anything to the registry.

Create `%TEMP%\verify-shell-ext-com.ps1`:

```powershell
param(
    [string]$DllPath = "d:\Coding\Apps\null-ide\shell-ext-build\Release\null_explorer_command.dll"
)

Add-Type -MemberDefinition @"
[DllImport(`"$DllPath`", ExactSpelling = true)]
public static extern int DllGetClassObject(ref Guid rclsid, ref Guid riid, out IntPtr ppv);
"@ -Namespace NullIDE -Name ComProbeNative

Add-Type @"
using System;
using System.Runtime.InteropServices;

namespace NullIDE {
    public static class ComProbe {
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        public delegate int CreateInstanceDelegate(IntPtr self, IntPtr pUnkOuter, ref Guid riid, out IntPtr ppvObject);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        public delegate int QueryInterfaceDelegate(IntPtr self, ref Guid riid, out IntPtr ppvObject);

        public static readonly Guid IID_IClassFactory = new Guid("00000001-0000-0000-C000-000000000046");

        public static int GetClassObject(Guid clsid, out IntPtr factoryPtr) {
            Guid riid = IID_IClassFactory;
            Guid rclsid = clsid;
            return ComProbeNative.DllGetClassObject(ref rclsid, ref riid, out factoryPtr);
        }

        public static int CreateInstance(IntPtr factoryPtr, Guid riid, out IntPtr instancePtr) {
            IntPtr vtbl = Marshal.ReadIntPtr(factoryPtr);
            IntPtr slot = Marshal.ReadIntPtr(vtbl, 3 * IntPtr.Size); // IClassFactory::CreateInstance
            var createInstance = (CreateInstanceDelegate)Marshal.GetDelegateForFunctionPointer(slot, typeof(CreateInstanceDelegate));
            Guid iid = riid;
            return createInstance(factoryPtr, IntPtr.Zero, ref iid, out instancePtr);
        }

        public static int QueryInterface(IntPtr objPtr, Guid riid, out IntPtr resultPtr) {
            IntPtr vtbl = Marshal.ReadIntPtr(objPtr);
            IntPtr slot = Marshal.ReadIntPtr(vtbl, 0); // IUnknown::QueryInterface
            var qi = (QueryInterfaceDelegate)Marshal.GetDelegateForFunctionPointer(slot, typeof(QueryInterfaceDelegate));
            Guid iid = riid;
            return qi(objPtr, ref iid, out resultPtr);
        }
    }
}
"@

$explorerCommandClsid = [guid]"A72D088B-AC8B-4AB5-ABFE-49C5CE37A466"
$previewHandlerClsid  = [guid]"58F3B583-5D67-489A-9069-97FD45B2569B"
$iidIUnknown           = [guid]"00000000-0000-0000-C000-000000000046"
$iidIPreviewHandler    = [guid]"8895b1c6-b41f-4c1c-a562-0d564250836f"
$iidIPreviewHandlerVis = [guid]"196bf9a5-b346-4ef0-aa1e-5dcdb76768b1"

function Assert-Ok($hr, $label) {
    if ($hr -ne 0) {
        throw "FAIL: $label returned HRESULT 0x$($hr.ToString('X8'))"
    }
    Write-Host "OK: $label"
}

# Regression check: existing context-menu class factory still resolves.
$hr = [NullIDE.ComProbe]::GetClassObject($explorerCommandClsid, [ref]$factoryPtr = [IntPtr]::Zero)
Assert-Ok $hr "DllGetClassObject(ExplorerCommandHandler)"

# New preview-handler class factory resolves.
$hr = [NullIDE.ComProbe]::GetClassObject($previewHandlerClsid, [ref]$factoryPtr = [IntPtr]::Zero)
Assert-Ok $hr "DllGetClassObject(PreviewHandler)"

# Instantiate it as IPreviewHandler.
$hr = [NullIDE.ComProbe]::CreateInstance($factoryPtr, $iidIPreviewHandler, [ref]$instPtr = [IntPtr]::Zero)
Assert-Ok $hr "CreateInstance(PreviewHandler) as IPreviewHandler"

# QueryInterface for IPreviewHandlerVisuals from the same instance.
$hr = [NullIDE.ComProbe]::QueryInterface($instPtr, $iidIPreviewHandlerVis, [ref]$visPtr = [IntPtr]::Zero)
Assert-Ok $hr "QueryInterface(PreviewHandler) for IPreviewHandlerVisuals"

Write-Host "`nAll COM smoke tests passed."
```

- [ ] **Step 5: Run the smoke test**

Run:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\verify-shell-ext-com.ps1"
```

Expected output:
```
OK: DllGetClassObject(ExplorerCommandHandler)
OK: DllGetClassObject(PreviewHandler)
OK: CreateInstance(PreviewHandler) as IPreviewHandler
OK: QueryInterface(PreviewHandler) for IPreviewHandlerVisuals

All COM smoke tests passed.
```

If any line throws `FAIL: ...`, fix `preview_handler.cc`, rebuild (Step 3), and re-run this script before proceeding. Once it passes, delete the scratch script: `Remove-Item "$env:TEMP\verify-shell-ext-com.ps1"`.

- [ ] **Step 6: Commit**

```bash
cd d:/Coding/Apps/null-ide
git add shell-ext/src/preview_handler.cc shell-ext/CMakeLists.txt
git commit -m "feat: add IPreviewHandler COM class to shell-ext"
```

---

### Task 2: Add preview-handler registration functions to `install-null-ide.ps1`

**Files:**
- Modify: `scripts/install-null-ide.ps1`

**Interfaces:**
- Consumes: `$FileAssocMap` (existing script-level ordered hashtable), CLSID `58F3B583-5D67-489A-9069-97FD45B2569B` from Task 1, DLL path `shell-ext\NullIDE.ExplorerCommand\x64\null_explorer_command.dll` relative to the install dir (same path the Win11 context-menu AppX package already uses — no new file layout).
- Produces: `Register-PreviewHandler -InstallDir <path>` and `Unregister-PreviewHandler` (no params), plus script-level `$PreviewHandlerClsid`/`$PreviewHandlerShellexGuid` constants. Task 3 calls `Register-PreviewHandler`/`Unregister-PreviewHandler` from `Install-Zip`. New top-level switches `-RegisterPreviewHandler` and `-UnregisterPreviewHandler` (added to the `param()` block, alongside the existing `-RegisterFileAssociations`/`-UnregisterFileAssociations`).

- [ ] **Step 1: Add the constants and registration functions**

In `scripts/install-null-ide.ps1`, insert the following immediately after the `Unregister-FileAssociations` function (after its closing `}`, before `function Register-Path`):

```powershell
$PreviewHandlerClsid = '{58F3B583-5D67-489A-9069-97FD45B2569B}'
$PreviewHandlerShellexGuid = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'

function Register-PreviewHandler {
    param([string]$InstallDir)

    $installDir = [System.IO.Path]::GetFullPath($InstallDir)
    $dllPath    = Join-Path $installDir 'shell-ext\NullIDE.ExplorerCommand\x64\null_explorer_command.dll'

    $clsidKey = "HKCU:\Software\Classes\CLSID\$PreviewHandlerClsid"
    New-Item -Path $clsidKey -Force | Out-Null
    Set-ItemProperty -Path $clsidKey -Name '(default)' -Value 'Null IDE Preview Handler'

    New-Item -Path "$clsidKey\InprocServer32" -Force | Out-Null
    Set-ItemProperty -Path "$clsidKey\InprocServer32" -Name '(default)' -Value $dllPath
    Set-ItemProperty -Path "$clsidKey\InprocServer32" -Name 'ThreadingModel' -Value 'Apartment'

    $approvedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers'
    New-Item -Path $approvedKey -Force | Out-Null
    Set-ItemProperty -Path $approvedKey -Name $PreviewHandlerClsid -Value 'Null IDE Preview Handler'

    $allExtensions = $FileAssocMap.Values | ForEach-Object { $_.Extensions } | Select-Object -Unique
    foreach ($ext in $allExtensions) {
        $shellexKey = "HKCU:\Software\Classes\$ext\shellex\$PreviewHandlerShellexGuid"
        New-Item -Path $shellexKey -Force | Out-Null
        Set-ItemProperty -Path $shellexKey -Name '(default)' -Value $PreviewHandlerClsid
    }

    Send-ShellChangeNotification
    Write-Host "Registered preview handler for $($allExtensions.Count) extensions."
}

function Unregister-PreviewHandler {
    $allExtensions = $FileAssocMap.Values | ForEach-Object { $_.Extensions } | Select-Object -Unique
    foreach ($ext in $allExtensions) {
        $shellexKey = "HKCU:\Software\Classes\$ext\shellex\$PreviewHandlerShellexGuid"
        $existing = Get-Item -Path $shellexKey -ErrorAction SilentlyContinue
        if ($existing -and $existing.GetValue('') -eq $PreviewHandlerClsid) {
            Remove-Item -Path $shellexKey -Force
        }
    }

    $clsidKey = "HKCU:\Software\Classes\CLSID\$PreviewHandlerClsid"
    if (Test-Path $clsidKey) {
        Remove-Item -Path $clsidKey -Recurse -Force
    }

    $approvedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers'
    if (Test-Path $approvedKey) {
        Remove-ItemProperty -Path $approvedKey -Name $PreviewHandlerClsid -ErrorAction SilentlyContinue
    }

    Send-ShellChangeNotification
    Write-Host 'Unregistered preview handler.'
}
```

- [ ] **Step 2: Add the new switches to the param block**

In `scripts/install-null-ide.ps1`, modify the `param()` block to add two new switches after `[switch]$UnregisterFileAssociations,`:

```powershell
    [switch]$RegisterFileAssociations,
    [switch]$UnregisterFileAssociations,
    [switch]$RegisterPreviewHandler,
    [switch]$UnregisterPreviewHandler,
    [switch]$Launch
```

- [ ] **Step 3: Wire the switches into the script's dispatch section**

In `scripts/install-null-ide.ps1`, immediately after the existing `if ($UnregisterFileAssociations) { ... }` block, add:

```powershell
if ($RegisterPreviewHandler) {
    $dir = [System.IO.Path]::GetFullPath($InstallDir)
    Write-Step "Registering preview handler"
    Register-PreviewHandler -InstallDir $dir
    Write-Host "Done."
    return
}

if ($UnregisterPreviewHandler) {
    Write-Step "Unregistering preview handler"
    Unregister-PreviewHandler
    Write-Host "Done."
    return
}
```

- [ ] **Step 4: Verify current state has no Null IDE preview handler registered (pre-check)**

Run:
```powershell
Test-Path 'HKCU:\Software\Classes\CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}'
Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers'
```
Expected: first returns `False`. Second may return `True` if other apps have registered preview handlers — that's fine, this is a shared key we only add one value to.

- [ ] **Step 5: Register against a real local install and verify**

Run:
```powershell
cd d:\Coding\Apps\null-ide\scripts
.\install-null-ide.ps1 -RegisterPreviewHandler -InstallDir "$env:LOCALAPPDATA\Programs\Null IDE"
```
Expected: `Registering preview handler` then `Registered preview handler for 52 extensions.` then `Done.` — no errors. (If no install exists at that path yet, any directory path is acceptable for this step — the function only writes registry keys and does not require the directory to exist.)

Then verify:
```powershell
(Get-Item 'HKCU:\Software\Classes\CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}\InprocServer32').GetValue('ThreadingModel')
(Get-Item 'HKCU:\Software\Classes\.ts\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}').GetValue('')
(Get-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers').GetValue('{58F3B583-5D67-489A-9069-97FD45B2569B}')
```
Expected: first returns `Apartment`, second returns `{58F3B583-5D67-489A-9069-97FD45B2569B}`, third returns `Null IDE Preview Handler`.

- [ ] **Step 6: Unregister and verify cleanup**

Run:
```powershell
.\install-null-ide.ps1 -UnregisterPreviewHandler
```
Expected: `Unregistering preview handler` then `Unregistered preview handler.` then `Done.`

Then verify:
```powershell
Test-Path 'HKCU:\Software\Classes\CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}'
(Get-Item 'HKCU:\Software\Classes\.ts\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}' -ErrorAction SilentlyContinue)
(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' -ErrorAction SilentlyContinue).'{58F3B583-5D67-489A-9069-97FD45B2569B}'
```
Expected: first returns `False`, second returns `$null`, third returns `$null`.

- [ ] **Step 7: Verify the "don't clobber someone else's handler" guard**

Simulate another app owning `.ts`'s preview handler, then confirm `Unregister-PreviewHandler` leaves it alone:
```powershell
New-Item -Path 'HKCU:\Software\Classes\.ts\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\.ts\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}' -Name '(default)' -Value '{00000000-0000-0000-0000-000000000001}'
.\install-null-ide.ps1 -RegisterPreviewHandler -InstallDir "$env:LOCALAPPDATA\Programs\Null IDE"
Set-ItemProperty -Path 'HKCU:\Software\Classes\.ts\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}' -Name '(default)' -Value '{00000000-0000-0000-0000-000000000001}'
.\install-null-ide.ps1 -UnregisterPreviewHandler
(Get-Item 'HKCU:\Software\Classes\.ts\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}').GetValue('')
```
Expected: final line prints `{00000000-0000-0000-0000-000000000001}` — the foreign CLSID was left untouched because it no longer matched Null IDE's CLSID at unregister time.

Clean up the simulated key:
```powershell
Remove-Item 'HKCU:\Software\Classes\.ts\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}' -Force
```

- [ ] **Step 8: Commit**

```bash
cd d:/Coding/Apps/null-ide
git add scripts/install-null-ide.ps1
git commit -m "feat: add Register-PreviewHandler/Unregister-PreviewHandler to installer script"
```

---

### Task 3: Wire automatic registration into `Install-Zip`

**Files:**
- Modify: `scripts/install-null-ide.ps1`

**Interfaces:**
- Consumes: `Register-PreviewHandler -InstallDir <path>` from Task 2.
- Produces: new `-NoPreviewHandler` switch (parallel to the existing `-NoFileAssoc`), which `Install-Zip` respects.

- [ ] **Step 1: Add the `-NoPreviewHandler` switch to the param block**

In `scripts/install-null-ide.ps1`, modify the `param()` block to add `-NoPreviewHandler` next to `-NoFileAssoc`:

```powershell
    [switch]$NoFileAssoc,
    [switch]$NoPreviewHandler,
    [switch]$NoPath,
```

- [ ] **Step 2: Call Register-PreviewHandler from Install-Zip**

In `scripts/install-null-ide.ps1`, in the `Install-Zip` function, immediately after the existing block:

```powershell
        if (-not $NoFileAssoc) {
            Write-Step "Registering file associations"
            Register-FileAssociations -InstallDir $destinationFullPath
        }
```

add:

```powershell
        if (-not $NoPreviewHandler) {
            Write-Step "Registering preview handler"
            Register-PreviewHandler -InstallDir $destinationFullPath
        }
```

- [ ] **Step 3: Verify default behavior registers the preview handler**

Using a scratch install directory so this doesn't disturb a real install:
```powershell
cd d:\Coding\Apps\null-ide\scripts
.\install-null-ide.ps1 -ZipPath <path-to-any-existing-null-ide-zip> -InstallDir "$env:TEMP\null-ide-preview-test" -NoDesktopShortcut -NoStartMenuShortcut -NoPath -Force
Test-Path 'HKCU:\Software\Classes\CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}'
```
Expected: `Test-Path` returns `True` (the preview handler was registered as part of the install, without needing `-RegisterPreviewHandler` explicitly).

If no test ZIP is available, this step may instead be verified by code review of the diff (confirm the added block is a sibling of the existing `if (-not $NoFileAssoc) { ... }` block inside `Install-Zip`) plus re-running Task 2 Step 5's direct-function verification, since `Install-Zip` calls the same `Register-PreviewHandler` function already proven to work.

- [ ] **Step 4: Verify -NoPreviewHandler opts out**

```powershell
.\install-null-ide.ps1 -UnregisterPreviewHandler
.\install-null-ide.ps1 -ZipPath <path-to-any-existing-null-ide-zip> -InstallDir "$env:TEMP\null-ide-preview-test" -NoDesktopShortcut -NoStartMenuShortcut -NoPath -NoPreviewHandler -Force
Test-Path 'HKCU:\Software\Classes\CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}'
```
Expected: `Test-Path` returns `False`.

Clean up:
```powershell
.\install-null-ide.ps1 -UnregisterPreviewHandler
Remove-Item "$env:TEMP\null-ide-preview-test" -Recurse -Force -ErrorAction SilentlyContinue
```

- [ ] **Step 5: Commit**

```bash
cd d:/Coding/Apps/null-ide
git add scripts/install-null-ide.ps1
git commit -m "feat: register preview handler automatically during install/update"
```

---

### Task 4: Wire preview handler registration into the Inno Setup installer

**Files:**
- Modify: `installer/null-ide.iss`

**Interfaces:**
- Consumes: `install-null-ide.ps1 -RegisterPreviewHandler` / `-UnregisterPreviewHandler` from Task 2 (invoked as an external process, same pattern as the existing `fileassoc` `[Run]` entry).

- [ ] **Step 1: Add the `previewhandler` task**

In `installer/null-ide.iss`, in the `[Tasks]` section, add after the `fileassoc` line:

```pascal
Name: "previewhandler"; Description: "Show code file content in the Explorer Preview Pane (Alt+P)"; GroupDescription: "Shell integration:"
```

- [ ] **Step 2: Add the `[Run]` entry to register the preview handler on install**

In `installer/null-ide.iss`, in the `[Run]` section, add a new line after the existing file-association registration line and before the final `null.exe` launch line:

```pascal
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\resources\app\null-updater\install-null-ide.ps1"" -RegisterPreviewHandler -InstallDir ""{app}"""; Flags: runhidden; Tasks: previewhandler; Description: "Registering preview handler"
```

- [ ] **Step 3: Add unregistration on uninstall**

In `installer/null-ide.iss`, in the `[Code]` section's `CurUninstallStepChanged` procedure, add a third `Exec` call inside the `if CurUninstallStep = usPostUninstall then begin ... end;` block, after the existing file-association-unregistration `Exec` call:

```pascal
    Exec('powershell.exe',
         '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\resources\app\null-updater\install-null-ide.ps1') + '" -UnregisterPreviewHandler',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
```

- [ ] **Step 4: Review the full modified sections**

Read back `installer/null-ide.iss` and confirm:
- `[Tasks]` has 5 entries: `desktopicon`, `contextmenu`, `fileassoc`, `previewhandler`, `addtopath`.
- `[Run]` has 4 entries: the Win11-context-menu PowerShell call, the file-association PowerShell call, the new preview-handler PowerShell call, and the final `null.exe` launch line.
- `CurUninstallStepChanged` has 3 `Exec` calls inside the `usPostUninstall` branch.

This cannot be compiled or run locally (no Inno Setup toolchain in this repo, and it depends on a full `VSCode-win32-x64` build output that only exists in CI — see CLAUDE.md Scope Constraints). Correctness is established by this review plus Task 2's proof that the underlying PowerShell commands work; full end-to-end behavior is verified in the next CI release build.

- [ ] **Step 5: Commit**

```bash
cd d:/Coding/Apps/null-ide
git add installer/null-ide.iss
git commit -m "feat: register/unregister preview handler from the Inno Setup installer"
```

---

## Post-plan verification (not a task — do once all 4 tasks are committed)

No CI/`build.yml` changes are needed: the preview handler shares the exact same `null_explorer_command.dll` build target, CMake invocation, and output path (`shell-ext/NullIDE.ExplorerCommand/x64/`) already wired into `.github/workflows/build.yml` for the Win11 context menu — CI picks up `preview_handler.cc` automatically via the `CMakeLists.txt` change in Task 1.

Once a CI release build runs (tag push), confirm on a real Windows machine:
1. Install via the built `NullIDESetup-<version>.exe`, leaving the "Show code file content in the Explorer Preview Pane" task checked.
2. Open File Explorer, select a `.ts`/`.py`/`.json` file, toggle Preview Pane (Alt+P or View → Preview Pane) → expect readable monospace text matching the file's content.
3. Select a file with more than ~5,000 lines or over 256 KB → expect truncated content plus the "open in Null IDE" trailing line.
4. Rename a binary file (e.g. a `.exe` copied to `.log`) → expect the "No preview available for this file." label, not raw/garbled bytes.
5. Uninstall → confirm `HKCU:\Software\Classes\CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}` is gone and Explorer falls back to "No preview available" for the curated extensions.

This is manual/exploratory (requires a real install), not part of the automated task steps above, and is out of scope for this plan's execution — noted here so it isn't forgotten.
