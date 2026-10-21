# Native Windows Widgets Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Pin Projects, Issues and Pull Requests (GitHub) as native Windows 11 Widgets Board widgets, fed by a snapshot file the IDE writes and rendered by a dumb C++/WinRT provider that null-setup registers as an opt-in sparse package.

**Architecture:** Three independent tracks that meet at one file contract (`%LOCALAPPDATA%\Null\widgets\snapshot.json`, schema 1). (A) `shell-ext/widgets/`: a C++/WinRT out-of-proc COM provider `null_widgets.exe` packed as the sparse APPX `NullIDE.Widgets`. (B) `extensions/null-tools/src/widgets/`: the only fetcher/filter/writer. (C) `setup/core`: a new opt-in `Feature::Widgets` (register / update / remove next to `NullIDE.ExplorerCommand`). Task 1 is a hard gate: if it fails, nothing after it is built.

**Tech Stack:** C++/WinRT (cppwinrt.exe from the Windows SDK) + `Microsoft.WindowsAppSDK.Widgets` 2.0.5 (one 2.4 MB DLL and a winmd — not the 200 MB metapackage), CMake + MSVC, CTest; TypeScript (`node --test`); Rust (`cargo test -p null-setup-core`); PowerShell for packing/checks.

**Spec:** [docs/specs/native-windows-widgets-design.md](../specs/native-windows-widgets-design.md) (issue #141). Task 1 writes its findings to `docs/specs/native-windows-widgets-gate.md`.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

Copied from the spec; every task includes them.

- First release = Projects, Issues and Pull Requests widgets for **GitHub** only. No GitLab, no Build & Test widget, no Windows 10.
- **Cache only.** The provider never fetches, holds no token, has no settings UI. Tokens stay in null-accounts' `SecretStorage`.
- The IDE (`null-tools`) is the only fetcher, filter and writer, gated by `null.widgets.enabled`; with it off the IDE behaves identically to a build without the widget package.
- Provider = **separate** sparse package `NullIDE.Widgets` (never an addition to `NullIDE.ExplorerCommand`), exe `null_widgets.exe`, signed with the existing `CN=Null IDE` certificate (no new trust prompt). Card JSON is built with `Windows.Data.Json`.
- The provider treats `snapshot.json` as **untrusted input**: `Action.OpenUrl` only for `https://` URLs on host `github.com`; snapshot text only into Adaptive Card text elements (never markup or URLs) and length-capped; a malformed file keeps the last good render.
- Settings: exactly two, `null.widgets.enabled` and `null.widgets.repos` (`[{ repo, account }]`). Row maxima are constants: **8 projects, 10 issues, 10 PRs**. No filter or row-count settings.
- Actions: issue/PR rows `Action.OpenUrl`; "Open project" / "Open in new window" are `Action.Execute`, launched through the explorer-marshalled `LaunchViaExplorer`. `null.exe` location comes from the package install location, never from the snapshot; a project `path` must be absolute and is passed after a `--` separator, never through a shell.
- null-setup owns the lifecycle: opt-in "Windows widgets" option (default **off**), hidden when the host check fails (Windows build ≥ the confirmed floor, believed **22621**, and package `MicrosoftWindows.Client.WebExperience` present), CurrentUser-first trust with elevated `LocalMachine\TrustedPeople` only on an untrusted-root answer, stop `null_widgets.exe` (scoped to the install path) before the swap. Any widgets failure is logged and ignored; it never fails the IDE install or update. The uninstaller removes both packages and `%LOCALAPPDATA%\Null\widgets\`.
- Snapshot writes are atomic (`snapshot.json.tmp`, then rename). No secrets in the snapshot or logs. One writer window via the `PresenceOwnership` pattern with claim file `widgets-owner.json`.
- Turning widgets off deletes `snapshot.json`; signing out does **not** delete rows (they stay dimmed as `signed_out`).
- Nothing is enabled implicitly: snapshot writing starts only after `Null: Set Up Widgets` ran. Before that the empty card reads "Open Null IDE to set up widgets".
- Stale footer is muted after 6 hours (one constant in the card builder).
- Repo conventions: `out/` of an extension is tracked — after editing `src/` run `npm run compile` and commit the refreshed `out/` as `chore: refresh null-tools compiled output`; never hand-edit `out/`. New TS test files must be added to **both** the `test` script in `package.json` and `tsconfig.json`'s `include`. Run `graphify update .` after code changes. Commit style: Conventional Commits with `(#141)`.

**Interpretation notes (spec silent or ambiguous; flagged for review):**
1. "Nothing is enabled implicitly … stored at least one repo *or enabled projects*": `Null: Set Up Widgets` sets `null.widgets.enabled = true` and stores the picked repos (possibly none). With zero repos only the Projects widget has data. There is no third setting.
2. GitHub search queries are limited to 256 characters, so "one GraphQL request per account" is one request **per chunk of repos** that fits (`chunkRepos`), which is one request per account in the common case.
3. Snapshot rows additionally carry `updatedAt` (spec example omits it; "timestamps" are allowed content). Schema stays 1; the provider ignores unknown fields.
4. The spec's "card builder … no COM activation" is read as "no widget-provider/COM-server activation"; the builder uses `Windows.Data.Json`, whose tests call `winrt::init_apartment()`.

## Review Focus

Failure modes the spec implies that no happy-path task exercises. Each has a test in the owning task.

1. **Hostile snapshot** (a `file:`/`javascript:`/look-alike-host URL, a `--flag` or relative project path, a 10 000-char title, a title containing `${...}` Adaptive-Card template syntax): must never produce an action or template text; it renders inert text. → Tasks 3, 4, 5.
2. **Torn, empty, or garbage `snapshot.json`** while pinned: keep the last good card, never crash/blank the widget. → Tasks 3, 5.
3. **Malformed `null.widgets.repos` settings** (a repo like `a/b is:private`, `../x`, non-array, duplicate entries) must never reach a search string. → Task 7.
4. **Token expiry / offline / rate limit mid-session**: rows stay (dimmed), sections carry the reason, nothing is wiped, fetching suspends instead of hammering. → Tasks 8, 11.
5. **Update/uninstall while a widget is pinned** (provider process alive and holding the install dir): must be stopped before the swap, and a provider that cannot be stopped must not fail the update. → Tasks 15, 16.

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/fetch-widgets-deps.ps1` | Downloads the pinned Widgets nupkg (SHA256-checked) into `shell-ext/deps/widgets/` (gitignored, like wil) |
| `scripts/pack-widgets.ps1` | Stages exe + DLL + assets, `makeappx pack`, `signtool sign`, verifies the signer. Shared by CI, `build-local.ps1` and the gate |
| `scripts/check-widgets.ps1` | Windows 11 manual-check driver (gate + final checklist), in the style of `check-cold-start-aumid.ps1` |
| `shell-ext/CMakeLists.txt` | Adds `add_subdirectory(widgets)` and `enable_testing()` |
| `shell-ext/src/launch_via_explorer.{h,cc}` | `QuoteForCommandLineArg` + `LaunchViaExplorer`, extracted from `explorer_command.cc`, shared by both targets |
| `shell-ext/widgets/CMakeLists.txt` | cppwinrt projection, `null_widgets` exe, `null_widget_core` static lib, `null_widgets_test` (CTest) |
| `shell-ext/widgets/AppxManifest.xml` | Sparse package `NullIDE.Widgets` |
| `shell-ext/widgets/snapshot.{h,cc}` | Parse + validate + sanitize `snapshot.json` (pure, no COM server) |
| `shell-ext/widgets/cards.{h,cc}` | Snapshot → Adaptive Card `{template, data}` per widget/size (pure) |
| `shell-ext/widgets/provider.{h,cc}`, `main.cc` | `IWidgetProvider`, file watch, UpdateWidget, action handling, COM class factory, lifecycle |
| `shell-ext/widgets/widgets_test.cc`, `fixtures/*.json` | CTest executable against fixture snapshots |
| `extensions/null-tools/src/widgets/widgetTypes.ts` | Snapshot types, constants, `parseRepos` |
| `…/widgetQueries.ts` | GraphQL document, search strings, chunking, mappers, ranking (pure) |
| `…/widgetSections.ts` | Section building (partial failure, last-good, status), projects section (pure) |
| `…/widgetStore.ts` | `widgetsDir()`, atomic writer, delete |
| `…/widgetFetch.ts` | Per-account fetch over `requestGraphql`, error classification (no `vscode` import) |
| `…/widgetRefresher.ts` | Refresh state machine with injected deps (ownership, timers, backoff, disable) |
| `…/widgetSetup.ts` | Pure helpers for `Null: Set Up Widgets` (repo list mapping, settings merge) |
| `…/widgetIntegration.ts` | The only `vscode` file: settings, commands, focus, wiring |
| `extensions/null-tools/src/presenceOwnership.ts` | Gains an optional `claimFile` parameter |
| `setup/core/src/install_config.rs` | `Feature::Widgets`, `InstallConfig.widgets` |
| `setup/core/src/shell/widgets.rs` | Host check, register / unregister, constants |
| `setup/core/src/shell/{mod,sys,win11}.rs`, `procs.rs`, `registrations.rs`, `update.rs`, `manage.rs` | `System` trait generalised, provider stop, wiring |
| `setup/app/src/wizard.rs`, `setup/ui/wizard*.js` | The opt-in option, hidden when unsupported |

---

### Task 1: Hard gate — minimal provider, signed package, runtime dependencies, minimum build

This task answers the four open questions in the spec ("Not covered by the spike"). **If any gate item fails, stop and tell the user; do not start Task 2.**

**Files:**
- Create: `scripts/fetch-widgets-deps.ps1`
- Create: `scripts/pack-widgets.ps1`
- Create: `scripts/check-widgets.ps1`
- Create: `shell-ext/widgets/CMakeLists.txt`
- Create: `shell-ext/widgets/main.cc` (spike skeleton; Task 5 replaces its body)
- Create: `shell-ext/widgets/AppxManifest.xml`
- Modify: `shell-ext/CMakeLists.txt` (append `add_subdirectory(widgets)`)
- Create: `docs/specs/native-windows-widgets-gate.md` (results)

**Interfaces:**
- Produces: package name `NullIDE.Widgets`; CLSID `1CADFE2C-53CF-4DCC-AAEE-A3139D7EF60E`; exe path inside the install `shell-ext\NullIDE.Widgets\x64\null_widgets.exe`; package file `shell-ext\null-widgets.appx`; widget definition ids `Projects`, `Issues`, `PullRequests`; `scripts/pack-widgets.ps1 -RepoRoot -BuildDir -OutDir -PfxPath -PfxPassword`; `scripts/fetch-widgets-deps.ps1` leaves `shell-ext/deps/widgets/metadata/Microsoft.Windows.Widgets.winmd` and `shell-ext/deps/widgets/runtimes-framework/win-x64/native/Microsoft.Windows.Widgets.dll`.

- [ ] **Step 1: Write the dependency fetcher**

`scripts/fetch-widgets-deps.ps1` (a nupkg is a zip; the hash was measured on 2.0.5):

```powershell
# Fetches the Windows App SDK Widgets component (winmd + one native DLL) into shell-ext/deps/widgets.
# Only this package is needed: the Microsoft.WindowsAppSDK metapackage pulls ONNX Runtime, DirectML and XAML (~200 MB).
param([string]$Dest = (Join-Path $PSScriptRoot '..\shell-ext\deps\widgets'))
$ErrorActionPreference = 'Stop'
$version = '2.0.5'
$sha256  = '7F1B585EF8F012784D2CB91B86E809814CECCAB74183A5979EF45DB141779CB5'
$winmd   = Join-Path $Dest 'metadata\Microsoft.Windows.Widgets.winmd'
if (Test-Path $winmd) { return }

$tmp = Join-Path ([IO.Path]::GetTempPath()) "null-widgets-nupkg-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $pkg = Join-Path $tmp 'widgets.zip'
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.windowsappsdk.widgets/$version/microsoft.windowsappsdk.widgets.$version.nupkg" -OutFile $pkg
    $actual = (Get-FileHash $pkg -Algorithm SHA256).Hash
    if ($actual -ne $sha256) { throw "Widgets package hash mismatch: expected $sha256, got $actual" }
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    Expand-Archive $pkg $Dest -Force
}
finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
if (-not (Test-Path $winmd)) { throw "winmd missing after extracting the Widgets package" }
Write-Host "Widgets package $version ready in $Dest"
```

- [ ] **Step 2: Run it**

Run: `pwsh -File scripts/fetch-widgets-deps.ps1`
Expected: `Widgets package 2.0.5 ready in …\shell-ext\deps\widgets`; `shell-ext/deps/widgets/metadata/Microsoft.Windows.Widgets.winmd` exists. (`shell-ext/deps/` is already gitignored.)

- [ ] **Step 3: Write the CMake for the widgets directory**

`shell-ext/widgets/CMakeLists.txt`. cppwinrt generates the projection of the Widgets winmd into the build dir; the Windows SDK's own `cppwinrt` include dir supplies `winrt/base.h` and the `Windows.*` namespaces.

```cmake
set(WIDGETS_DEPS "${CMAKE_CURRENT_SOURCE_DIR}/../deps/widgets")
set(WIDGETS_WINMD "${WIDGETS_DEPS}/metadata/Microsoft.Windows.Widgets.winmd")
set(WIDGETS_DLL "${WIDGETS_DEPS}/runtimes-framework/win-x64/native/Microsoft.Windows.Widgets.dll")
if(NOT EXISTS "${WIDGETS_WINMD}")
  message(FATAL_ERROR "Widgets package not found. Run scripts/fetch-widgets-deps.ps1")
endif()

# cppwinrt.exe ships with the Windows SDK (same discovery as makeappx in CI).
file(GLOB _cppwinrt_candidates "C:/Program Files (x86)/Windows Kits/10/bin/*/x64/cppwinrt.exe")
list(SORT _cppwinrt_candidates)
list(REVERSE _cppwinrt_candidates)
list(GET _cppwinrt_candidates 0 CPPWINRT_EXE)
if(NOT CPPWINRT_EXE)
  message(FATAL_ERROR "cppwinrt.exe not found (needs the Windows SDK)")
endif()

set(WINRT_GEN "${CMAKE_CURRENT_BINARY_DIR}/winrt-gen")
add_custom_command(
  OUTPUT "${WINRT_GEN}/winrt/Microsoft.Windows.Widgets.Providers.h"
  COMMAND "${CPPWINRT_EXE}" -in "${WIDGETS_WINMD}" -ref sdk -out "${WINRT_GEN}" -verbose
  DEPENDS "${WIDGETS_WINMD}"
  COMMENT "cppwinrt: projecting Microsoft.Windows.Widgets")
add_custom_target(widgets_projection DEPENDS "${WINRT_GEN}/winrt/Microsoft.Windows.Widgets.Providers.h")

add_executable(null_widgets main.cc)
add_dependencies(null_widgets widgets_projection)
target_include_directories(null_widgets PRIVATE "${WINRT_GEN}")
target_compile_definitions(null_widgets PRIVATE WIN32_LEAN_AND_MEAN UNICODE _UNICODE)
set_property(TARGET null_widgets PROPERTY CXX_STANDARD 20)
set_property(TARGET null_widgets PROPERTY CXX_STANDARD_REQUIRED ON)
if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
  target_compile_options(null_widgets PRIVATE /Zc:__cplusplus /EHsc /W4 /Qspectre /guard:cf /Ox /permissive-)
  target_link_options(null_widgets PRIVATE /guard:cf /OPT:REF /OPT:ICF /MACHINE:X64 /SUBSYSTEM:WINDOWS)
endif()
target_link_libraries(null_widgets PRIVATE windowsapp ole32 oleaut32 shell32 shlwapi)
# The Widgets runtime DLL travels next to the exe (staged by scripts/pack-widgets.ps1 from WIDGETS_DLL).
set(NULL_WIDGETS_DLL "${WIDGETS_DLL}" CACHE INTERNAL "")
```

Append to `shell-ext/CMakeLists.txt`:

```cmake
enable_testing()
add_subdirectory(widgets)
```

- [ ] **Step 4: Write the skeleton provider (spike scope: one widget, static card)**

`shell-ext/widgets/main.cc`. It implements `IWidgetProvider` (real members, verified from the package docs: `CreateWidget(WidgetContext)`, `DeleteWidget(hstring widgetId, hstring customState)`, `OnActionInvoked(WidgetActionInvokedArgs)`, `OnWidgetContextChanged(WidgetContextChangedArgs)`, `Activate(WidgetContext)`, `Deactivate(hstring widgetId)`), registers a class factory, and exits when the last widget is deleted.

```cpp
#include <windows.h>
#include <unknwn.h>
#include <mutex>
#include <set>
#include <string>
#include <winrt/Windows.Foundation.h>
#include <winrt/Microsoft.Windows.Widgets.Providers.h>

namespace wp = winrt::Microsoft::Windows::Widgets::Providers;

namespace {
constexpr GUID kProviderClsid = {0x1CADFE2C, 0x53CF, 0x4DCC, {0xAA, 0xEE, 0xA3, 0x13, 0x9D, 0x7E, 0xF6, 0x0E}};
HANDLE g_emptyEvent = nullptr;

void Log(std::wstring const& m) { OutputDebugStringW((L"[null_widgets] " + m + L"\n").c_str()); }

constexpr wchar_t kTemplate[] =
    LR"({"type":"AdaptiveCard","$schema":"http://adaptivecards.io/schemas/adaptive-card.json","version":"1.6",
"body":[{"type":"TextBlock","text":"${msg}"}],
"actions":[{"type":"Action.Execute","title":"Ping","verb":"ping"}]})";

struct Provider : winrt::implements<Provider, wp::IWidgetProvider> {
  std::mutex m;
  std::set<winrt::hstring> ids;
  int pings = 0;

  void Push(winrt::hstring const& id, wchar_t const* msg) {
    wp::WidgetUpdateRequestOptions o{id};
    o.Template(kTemplate);
    o.Data(winrt::hstring{std::wstring(L"{\"msg\":\"") + msg + L"\"}"});
    wp::WidgetManager::GetDefault().UpdateWidget(o);
  }
  void CreateWidget(wp::WidgetContext const& c) {
    { std::lock_guard g{m}; ids.insert(c.Id()); }
    Log(L"CreateWidget " + std::wstring(c.DefinitionId()));
    Push(c.Id(), L"gate: created");
  }
  void DeleteWidget(winrt::hstring const& id, winrt::hstring const&) {
    bool empty;
    { std::lock_guard g{m}; ids.erase(id); empty = ids.empty(); }
    Log(L"DeleteWidget");
    if (empty) SetEvent(g_emptyEvent);
  }
  void OnActionInvoked(wp::WidgetActionInvokedArgs const& a) {
    Log(L"OnActionInvoked " + std::wstring(a.Verb()));
    Push(a.WidgetContext().Id(), (L"gate: ping " + std::to_wstring(++pings)).c_str());
  }
  void OnWidgetContextChanged(wp::WidgetContextChangedArgs const&) { Log(L"OnWidgetContextChanged"); }
  void Activate(wp::WidgetContext const& c) { Log(L"Activate"); Push(c.Id(), L"gate: activated"); }
  void Deactivate(winrt::hstring const&) { Log(L"Deactivate"); }
};

struct Factory : winrt::implements<Factory, IClassFactory> {
  winrt::com_ptr<Provider> provider = winrt::make_self<Provider>();
  HRESULT __stdcall CreateInstance(IUnknown* outer, GUID const& iid, void** result) noexcept final {
    if (!result) return E_POINTER;
    *result = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    return provider->QueryInterface(iid, result);
  }
  HRESULT __stdcall LockServer(BOOL) noexcept final { return S_OK; }
};
}  // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  g_emptyEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  DWORD cookie = 0;
  auto factory = winrt::make<Factory>();
  winrt::check_hresult(CoRegisterClassObject(kProviderClsid, factory.get(), CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE, &cookie));
  Log(L"registered");
  WaitForSingleObject(g_emptyEvent, INFINITE);
  CoRevokeClassObject(cookie);
  return 0;
}
```

Notes for the implementer: if `Provider` does not compile because a member signature differs in the generated header, open `shell-ext/build…/widgets/winrt-gen/winrt/impl/Microsoft.Windows.Widgets.Providers.2.h` and match the exact parameter types — the member *names* above are verified. If the exe exits at once when the Board starts it with widgets already pinned (a restart), that is expected for this spike; Task 5 repopulates from `WidgetManager::GetDefault().GetWidgetInfos()`.

- [ ] **Step 5: Write the manifest**

`shell-ext/widgets/AppxManifest.xml`. The `activatableClass` fragments are copied from the package's own `runtimes-framework/package.appxfragment`, with `Path` rebased to the external location. If registration of the in-process server through a *sparse* package does not work (Step 11 tells), the fallback is in Step 12.

```xml
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:com="http://schemas.microsoft.com/appx/manifest/com/windows10"
  xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 uap10 com desktop6 rescap">

  <!-- Publisher must exactly match the CN of the signing certificate (the same cert as NullIDE.ExplorerCommand).
       Bump Version whenever this file changes: Add-AppxPackage -ForceUpdateFromAnyVersion re-registers by identity. -->
  <Identity Name="NullIDE.Widgets" Publisher="CN=Null IDE" Version="1.0.0.0" ProcessorArchitecture="x64" />

  <Properties>
    <DisplayName>Null IDE Widgets</DisplayName>
    <PublisherDisplayName>Null IDE</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
    <uap10:AllowExternalContent>true</uap10:AllowExternalContent>
    <desktop6:RegistryWriteVirtualization>disabled</desktop6:RegistryWriteVirtualization>
    <desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.22621.0" MaxVersionTested="10.0.65535.0" />
  </Dependencies>

  <Resources><Resource Language="en-us" /></Resources>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
  </Capabilities>

  <Applications>
    <Application Id="NullIDEWidgets"
                 Executable="shell-ext\NullIDE.Widgets\x64\null_widgets.exe"
                 uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App">
      <uap:VisualElements AppListEntry="none" DisplayName="Null IDE Widgets" Description="Null IDE widgets"
                          BackgroundColor="transparent"
                          Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile />
      </uap:VisualElements>

      <Extensions>
        <com:Extension Category="windows.comServer">
          <com:ComServer>
            <com:ExeServer Executable="shell-ext\NullIDE.Widgets\x64\null_widgets.exe" DisplayName="Null IDE Widgets">
              <com:Class Id="1CADFE2C-53CF-4DCC-AAEE-A3139D7EF60E" DisplayName="Null IDE Widget Provider" />
            </com:ExeServer>
          </com:ComServer>
        </com:Extension>

        <uap3:Extension Category="windows.appExtension">
          <uap3:AppExtension Name="com.microsoft.windows.widgets" DisplayName="Null IDE" Id="NullIDE" PublicFolder="Public">
            <uap3:Properties>
              <WidgetProvider>
                <ProviderIcons><Icon Path="ProviderAssets\icon.png" /></ProviderIcons>
                <Activation><CreateInstance ClassId="1CADFE2C-53CF-4DCC-AAEE-A3139D7EF60E" /></Activation>
                <Definitions>
                  <Definition Id="Projects" DisplayName="Projects" Description="Pinned and recent Null IDE projects" AllowMultiple="false">
                    <Capabilities>
                      <Capability><Size Name="small" /></Capability>
                      <Capability><Size Name="medium" /></Capability>
                      <Capability><Size Name="large" /></Capability>
                    </Capabilities>
                    <ThemeResources>
                      <Icons><Icon Path="ProviderAssets\icon.png" /></Icons>
                      <Screenshots><Screenshot Path="ProviderAssets\screenshot-projects.png" DisplayAltText="Projects widget" /></Screenshots>
                      <DarkMode /><LightMode />
                    </ThemeResources>
                  </Definition>
                  <Definition Id="Issues" DisplayName="Issues" Description="GitHub issues assigned to or mentioning you" AllowMultiple="false">
                    <Capabilities>
                      <Capability><Size Name="medium" /></Capability>
                      <Capability><Size Name="large" /></Capability>
                    </Capabilities>
                    <ThemeResources>
                      <Icons><Icon Path="ProviderAssets\icon.png" /></Icons>
                      <Screenshots><Screenshot Path="ProviderAssets\screenshot-issues.png" DisplayAltText="Issues widget" /></Screenshots>
                      <DarkMode /><LightMode />
                    </ThemeResources>
                  </Definition>
                  <Definition Id="PullRequests" DisplayName="Pull Requests" Description="GitHub pull requests that need your attention" AllowMultiple="false">
                    <Capabilities>
                      <Capability><Size Name="medium" /></Capability>
                      <Capability><Size Name="large" /></Capability>
                    </Capabilities>
                    <ThemeResources>
                      <Icons><Icon Path="ProviderAssets\icon.png" /></Icons>
                      <Screenshots><Screenshot Path="ProviderAssets\screenshot-prs.png" DisplayAltText="Pull requests widget" /></Screenshots>
                      <DarkMode /><LightMode />
                    </ThemeResources>
                  </Definition>
                </Definitions>
              </WidgetProvider>
            </uap3:Properties>
          </uap3:AppExtension>
        </uap3:Extension>
      </Extensions>
    </Application>
  </Applications>

  <!-- From Microsoft.WindowsAppSDK.Widgets/runtimes-framework/package.appxfragment, Path rebased to the external location. -->
  <Extensions>
    <Extension Category="windows.activatableClass.inProcessServer">
      <InProcessServer>
        <Path>shell-ext\NullIDE.Widgets\x64\Microsoft.Windows.Widgets.dll</Path>
        <ActivatableClass ActivatableClassId="Microsoft.Windows.Widgets.Providers.WidgetUpdateRequestOptions" ThreadingModel="both" />
        <ActivatableClass ActivatableClassId="Microsoft.Windows.Widgets.Providers.WidgetManager" ThreadingModel="both" />
        <ActivatableClass ActivatableClassId="Microsoft.Windows.Widgets.Providers.WidgetResourceResponse" ThreadingModel="both" />
      </InProcessServer>
    </Extension>
  </Extensions>
</Package>
```

- [ ] **Step 6: Write the pack script**

`scripts/pack-widgets.ps1`. It renders the placeholder assets itself (icon scaled; a 600×400 dark "screenshot" with the icon centred) so the repo needs no binary assets.

```powershell
# Packs and signs null-widgets.appx. Used by CI, scripts/build-local.ps1 and the gate.
# -BuildDir is the cmake build dir (holding Release\null_widgets.exe); -OutDir is VSCode-win32-x64.
param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$BuildDir,
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][string]$PfxPath,
    [Parameter(Mandatory)][string]$PfxPassword
)
$ErrorActionPreference = 'Stop'
$pkgDir  = Join-Path $OutDir 'shell-ext'
$exeDir  = Join-Path $pkgDir 'NullIDE.Widgets\x64'
$dll     = Join-Path $RepoRoot 'shell-ext\deps\widgets\runtimes-framework\win-x64\native\Microsoft.Windows.Widgets.dll'
$exe     = Join-Path $BuildDir 'widgets\Release\null_widgets.exe'
foreach ($f in $exe, $dll) { if (-not (Test-Path $f)) { throw "missing $f" } }
New-Item -ItemType Directory -Path $exeDir -Force | Out-Null
Copy-Item $exe, $dll $exeDir -Force

# ── assets (placeholders rendered from the master icon) ──
$stage = Join-Path ([IO.Path]::GetTempPath()) "null-widgets-stage-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path "$stage\Assets", "$stage\Public\ProviderAssets" -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Image]::FromFile((Resolve-Path (Join-Path $RepoRoot 'icons\icon.png')))
function Save-Scaled($dst, $w, $h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($icon, 0, 0, $w, $h)
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
function Save-Screenshot($dst) {
    $bmp = New-Object System.Drawing.Bitmap(600, 400)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(32, 32, 32))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($icon, 220, 120, 160, 160)
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
Save-Scaled "$stage\Assets\Square150x150Logo.png" 150 150
Save-Scaled "$stage\Assets\Square44x44Logo.png" 44 44
Save-Scaled "$stage\Assets\StoreLogo.png" 50 50
Save-Scaled "$stage\Public\ProviderAssets\icon.png" 64 64
foreach ($n in 'projects', 'issues', 'prs') { Save-Screenshot "$stage\Public\ProviderAssets\screenshot-$n.png" }
$icon.Dispose()
Copy-Item (Join-Path $RepoRoot 'shell-ext\widgets\AppxManifest.xml') $stage

# ── pack + sign ──
function Find-SdkTool($name) {
    Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter $name -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'x64' } | Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
$makeappx = Find-SdkTool 'makeappx.exe'; if (-not $makeappx) { throw 'makeappx.exe not found' }
$signtool = Find-SdkTool 'signtool.exe'; if (-not $signtool) { throw 'signtool.exe not found' }
$appx = Join-Path $pkgDir 'null-widgets.appx'
& $makeappx pack /d $stage /p $appx /nv /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed ($LASTEXITCODE)" }
& $signtool sign /fd SHA256 /f $PfxPath /p $PfxPassword $appx
if ($LASTEXITCODE -ne 0) { throw "signtool sign failed ($LASTEXITCODE)" }
Remove-Item $stage -Recurse -Force

$expected = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath, $PfxPassword)).Thumbprint
$sig = Get-AuthenticodeSignature $appx
if (-not $sig.SignerCertificate -or $sig.SignerCertificate.Thumbprint -ne $expected) { throw 'null-widgets.appx is not signed with the expected certificate' }
Write-Host "null-widgets.appx built and signed (thumbprint $expected)"
```

- [ ] **Step 7: Write the check script**

`scripts/check-widgets.ps1` — reports the host check and, in `-Gate` mode, walks the person through the four gate items. Exact text matters less than the data it prints; keep the print format since the results go into the findings doc.

```powershell
# Windows 11 manual-check driver for the Null IDE widgets (cannot run in CI).
#   -Gate    : first-task hard gate (signed package, provider with null.exe closed, build floor, size).
#   -Status  : what is registered / running right now.
# Run in a PLAIN PowerShell window outside Null IDE (closing the IDE is part of the gate).
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Null IDE'),
    [switch]$Gate,
    [switch]$Status
)
$ErrorActionPreference = 'Stop'
function Section($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

Section 'Host'
$build = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber
$web = Get-AppxPackage -Name 'MicrosoftWindows.Client.WebExperience' -ErrorAction SilentlyContinue | Select-Object -First 1
"Windows build            : $build"
"WebExperience package    : $(if ($web) { $web.Version } else { '<none>' })"

Section 'Registration'
$pkg = Get-AppxPackage -Name 'NullIDE.Widgets' -ErrorAction SilentlyContinue | Select-Object -First 1
"NullIDE.Widgets          : $(if ($pkg) { $pkg.PackageFullName } else { '<not registered>' })"
$proc = Get-Process -Name 'null_widgets' -ErrorAction SilentlyContinue
"null_widgets.exe running : $(if ($proc) { ($proc.Id -join ', ') } else { 'no' })"
$ide = Get-Process -Name 'null' -ErrorAction SilentlyContinue
"null.exe running         : $(if ($ide) { ($ide.Id -join ', ') } else { 'no' })"
$exe = Join-Path $InstallDir 'shell-ext\NullIDE.Widgets\x64\null_widgets.exe'
$dll = Join-Path $InstallDir 'shell-ext\NullIDE.Widgets\x64\Microsoft.Windows.Widgets.dll'
if ((Test-Path $exe) -and (Test-Path $dll)) {
    $mb = [math]::Round(((Get-Item $exe).Length + (Get-Item $dll).Length) / 1MB, 2)
    "Provider payload         : $mb MB (budget 5 MB: exe + Widgets DLL)"
}
$appx = Join-Path $InstallDir 'shell-ext\null-widgets.appx'
if (Test-Path $appx) { $s = Get-AuthenticodeSignature $appx; "appx signature           : $($s.SignerCertificate.Subject) / $($s.Status)" }

if ($Status -and -not $Gate) { return }
if (-not $Gate) { return }

Section 'Gate'
@'
1. Register (signed package, developer mode OFF is the point of this gate):
     Add-AppxPackage -Path <install>\shell-ext\null-widgets.appx -ExternalLocation <install> -ForceUpdateFromAnyVersion
   Needs the CN=Null IDE certificate in LocalMachine\TrustedPeople (the installed Null IDE already put it there).
2. Open the Widgets Board (Win+W) -> "+" : "Null IDE" must list Projects / Issues / Pull Requests with an icon.
3. Pin "Projects": the card shows "gate: created". Click "Ping": it must change to "gate: ping 1".
4. QUIT Null IDE completely (no null.exe), then unpin and re-pin the widget and click Ping again.
   Re-run this script with -Status afterwards to prove null.exe was not running.
5. Record: Windows build, whether step 2-4 worked, payload size, and anything the Board complained about.
'@
```

- [ ] **Step 8: Build everything**

Run (from a "Developer PowerShell for VS 2022"):

```powershell
pwsh -File scripts/fetch-widgets-deps.ps1
cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64
cmake --build shell-ext-build --config Release --target null_widgets
```

Expected: `shell-ext-build\widgets\Release\null_widgets.exe` exists. Fix compile errors against the generated header as described in Step 4.

- [ ] **Step 9: Pack with a throwaway signing certificate**

```powershell
$cert = New-SelfSignedCertificate -Subject 'CN=Null IDE' -CertStoreLocation Cert:\CurrentUser\My -Type CodeSigning -KeySpec Signature -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(1)
$pwd = ConvertTo-SecureString 'gate' -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "$env:TEMP\gate.pfx" -Password $pwd | Out-Null
Export-Certificate -Cert $cert -FilePath "$env:TEMP\gate.cer" | Out-Null
pwsh -File scripts/pack-widgets.ps1 -RepoRoot . -BuildDir shell-ext-build -OutDir "$env:TEMP\gate-out" -PfxPath "$env:TEMP\gate.pfx" -PfxPassword gate
```

Expected: `null-widgets.appx built and signed`. Trust the throwaway cert machine-wide once (admin PowerShell): `Import-Certificate -FilePath $env:TEMP\gate.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`. **Remove it again after the gate** (`Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where Thumbprint -eq <thumb> | Remove-Item`). Developer mode must be **off** for this gate.

- [ ] **Step 10: Register with the install layout and run the gate**

```powershell
$ext = "$env:TEMP\gate-install"
New-Item -ItemType Directory -Path $ext -Force | Out-Null
Copy-Item "$env:TEMP\gate-out\shell-ext" $ext -Recurse -Force
Add-AppxPackage -Path "$ext\shell-ext\null-widgets.appx" -ExternalLocation $ext -ForceUpdateFromAnyVersion
pwsh -File scripts/check-widgets.ps1 -Gate -InstallDir $ext
```

Walk the five gate steps printed by the script. Record each result.

- [ ] **Step 11: Decide the runtime-dependency approach**

Expected if the sparse manifest's `activatableClass.inProcessServer` works: the Board's Ping updates the card and `OutputDebugString` (view with DebugView or `dbgview`) shows `registered`, `CreateWidget`, `OnActionInvoked`. If `WidgetManager::GetDefault()` throws `REGDB_E_CLASSNOTREG` (0x80040154), the in-proc registration did not take effect for a sparse package — go to Step 12. Otherwise skip Step 12.

- [ ] **Step 12 (only if Step 11 failed): Activation-factory hook**

Add to the top of `main.cc` (before any winrt include that activates classes), loading the DLL that sits next to the exe, and rebuild/re-pack/re-register:

```cpp
#include <windows.h>
#include <unknwn.h>
#include <winrt/base.h>
namespace {
int32_t __stdcall NullActivation(void* classId, winrt::guid const& iid, void** factory) noexcept {
  static HMODULE dll = [] {
    wchar_t p[MAX_PATH]; GetModuleFileNameW(nullptr, p, MAX_PATH);
    std::wstring s{p}; s.resize(s.find_last_of(L'\\') + 1);
    return LoadLibraryW((s + L"Microsoft.Windows.Widgets.dll").c_str());
  }();
  using Fn = HRESULT(__stdcall*)(void*, void**);
  auto get = dll ? reinterpret_cast<Fn>(GetProcAddress(dll, "DllGetActivationFactory")) : nullptr;
  if (!get) return winrt::impl::error_class_not_available;
  void* raw = nullptr;
  if (HRESULT hr = get(classId, &raw); FAILED(hr)) return hr;
  return static_cast<IUnknown*>(raw)->QueryInterface(reinterpret_cast<GUID const&>(iid), factory);
}
}
// C++/WinRT calls this hook before RoGetActivationFactory when it is defined with this exact name.
int32_t(__stdcall* winrt_activation_handler)(void* classId, winrt::guid const& iid, void** factory) = NullActivation;
```

Re-run Steps 8–10. If neither approach activates `WidgetManager`, that is a gate failure.

- [ ] **Step 13: Determine the minimum Windows build**

On a machine at build 22621 (Windows 11 22H2) if available, repeat Step 10. If none is available, read the Microsoft widget-provider requirements page (use `npx ctx7@latest docs /websites/learn_microsoft_en-us_windows_apps "widget providers minimum Windows version third party widgets"`) and record the stated floor with its source URL. Record whether the floor is *confirmed on hardware* or *documented only*.

- [ ] **Step 14: Write the findings and decide**

Create `docs/specs/native-windows-widgets-gate.md` with exactly these sections, filled from your measurements (no blanks):

```markdown
# Native Windows widgets — gate results (#141, Task 1)

Date, Windows build, machine.

| Gate item | Result | Evidence |
|---|---|---|
| Signed package (developer mode off) | pass / FAIL | … |
| Provider works with null.exe closed | pass / FAIL | … |
| Activation approach | manifest inProcessServer / DllGetActivationFactory hook | … |
| Payload size (exe + Widgets DLL) | X.XX MB (budget 5 MB: met / MISSED) | … |
| Minimum Windows build | NNNNN (confirmed on hardware / documented only) | source |

Decision: proceed / stop. If a size miss: recorded as a finding, not a stop.
```

If any of the first two rows says FAIL: commit this file alone (Step 15), stop, and report to the user. Otherwise continue.

- [ ] **Step 15: Commit**

```bash
git add scripts/fetch-widgets-deps.ps1 scripts/pack-widgets.ps1 scripts/check-widgets.ps1 shell-ext/CMakeLists.txt shell-ext/widgets docs/specs/native-windows-widgets-gate.md
git commit -m "feat(widgets): provider skeleton, pack/check scripts and gate findings (#141)"
```

Also unregister the throwaway package (`Get-AppxPackage NullIDE.Widgets | Remove-AppxPackage`) and remove the throwaway certificate from `LocalMachine\TrustedPeople`.

---

### Task 2: Share `LaunchViaExplorer` between the DLL and the provider

A process the packaged provider starts inherits the package AUMID exactly like the DLL case (`shell-ext/CLAUDE.md`), so the provider must use the same explorer-marshalled launch. Move, do not rewrite.

**Files:**
- Create: `shell-ext/src/launch_via_explorer.h`, `shell-ext/src/launch_via_explorer.cc`
- Modify: `shell-ext/src/explorer_command.cc` (remove the two moved functions, include the header)
- Modify: `shell-ext/CMakeLists.txt` (compile the new .cc into `null_explorer_command`)

**Interfaces:**
- Produces (namespace `null_launch`):
  `std::wstring QuoteForCommandLineArg(const std::wstring& arg);`
  `HRESULT LaunchViaExplorer(const std::filesystem::path& exe, const std::filesystem::path& install_root, const std::wstring& args);`

- [ ] **Step 1: Create the header**

`shell-ext/src/launch_via_explorer.h`:

```cpp
#pragma once
#include <windows.h>
#include <filesystem>
#include <string>

namespace null_launch {
// Chromium's base/command_line.cc quoting.
std::wstring QuoteForCommandLineArg(const std::wstring& arg);

// Asks the already-running, unpackaged explorer.exe to ShellExecute `exe`, so the new process has no package identity.
// See shell-ext/CLAUDE.md "Cold-start identity gotcha".
HRESULT LaunchViaExplorer(const std::filesystem::path& exe, const std::filesystem::path& install_root,
                          const std::wstring& args);
}  // namespace null_launch
```

- [ ] **Step 2: Move the code verbatim**

Create `shell-ext/src/launch_via_explorer.cc`. Cut `QuoteForCommandLineArg` (the function starting at the line `std::wstring QuoteForCommandLineArg` in the anonymous namespace of `explorer_command.cc`) and `LaunchViaExplorer` (including the long comment block above it) out of `explorer_command.cc` and paste them, unchanged, inside `namespace null_launch { … }`. Copy exactly the includes they need: `<windows.h> <shlobj.h> <exdisp.h> <oleauto.h> <shldisp.h> <shobjidl_core.h> <wrl/client.h> "wil/stl.h" "wil/win32_helpers.h"` (keep `<oleauto.h>` **before** the wil includes, as the original comment says) and `using Microsoft::WRL::ComPtr;`.

In `explorer_command.cc`: add `#include "launch_via_explorer.h"`, add `using null_launch::LaunchViaExplorer; using null_launch::QuoteForCommandLineArg;` after the existing `using` lines, and leave `LaunchNullIde` where it is.

- [ ] **Step 3: Add the source to the DLL target**

In `shell-ext/CMakeLists.txt`, add `src/launch_via_explorer.cc` to the `add_library(null_explorer_command SHARED …)` list.

- [ ] **Step 4: Build — behaviour must not change**

Run: `cmake --build shell-ext-build --config Release --target null_explorer_command`
Expected: builds with no new warnings.

- [ ] **Step 5: Regression check on the real behaviour**

Pack a local build per `scripts/build-local.ps1` (or reuse your installed Null IDE and drop the new DLL in), then in a plain terminal outside Null IDE run `scripts/check-cold-start-aumid.ps1` and do the right-click "Open with Null" steps it prints.
Expected: `PackageAUMID=<none>` and `Parent=explorer`. Anything else = the move broke it; revert and investigate.

- [ ] **Step 6: Commit**

```bash
git add shell-ext/src shell-ext/CMakeLists.txt
git commit -m "refactor(shell-ext): share LaunchViaExplorer with the widgets provider (#141)"
```

---

### Task 3: Snapshot parser and validator (provider side)

**Files:**
- Create: `shell-ext/widgets/snapshot.h`, `shell-ext/widgets/snapshot.cc`
- Create: `shell-ext/widgets/widgets_test.cc`
- Create: `shell-ext/widgets/fixtures/ok.json`, `partial.json`, `signed_out.json`, `newer_schema.json`, `hostile.json`, `corrupt.json`
- Modify: `shell-ext/widgets/CMakeLists.txt` (static lib `null_widget_core`, test exe, `add_test`)

**Interfaces:**
- Produces (namespace `null_widgets`):

```cpp
enum class Load { Ok, Missing, Corrupt, NewerSchema };
struct Failed { std::wstring repo, reason; };
struct Section { std::wstring status = L"ok"; std::vector<Failed> failed; };
struct Project { std::wstring name, path, branch, lastOpened; bool dirty = false, pinned = false; };
struct Issue   { std::wstring repo, title, url, attention, localPath, assignee; std::vector<std::wstring> labels; long number = 0; };
struct Pr      { std::wstring repo, title, url, author, review, checks, localPath; bool conflict = false; long number = 0; };
struct Snapshot {
  std::wstring writtenAt;                       // ISO-8601 UTC as written
  Section projectsSection, issuesSection, prsSection;
  std::vector<Project> projects; std::vector<Issue> issues; std::vector<Pr> prs;
};
struct Loaded { Load state = Load::Missing; Snapshot snapshot; };
Loaded ParseSnapshot(std::wstring const& json);                 // never throws
Loaded LoadSnapshotFile(std::wstring const& path);              // Missing if absent, else ParseSnapshot
bool IsSafeGithubUrl(std::wstring const& url);
bool IsAbsoluteLocalPath(std::wstring const& path);
std::wstring CapText(std::wstring const& s, size_t maxLen);     // control chars -> space, truncates with an ellipsis
bool ParseIsoUtc(std::wstring const& iso, long long* epochSeconds);
constexpr int kSchema = 1;
```

- [ ] **Step 1: Write the fixtures**

`fixtures/ok.json`:

```json
{"schema":1,"writtenAt":"2026-10-21T14:03:11Z",
 "projects":{"status":"ok","failed":[],"items":[
   {"name":"null-ide","path":"D:\\Coding\\Apps\\null-ide","branch":"main","dirty":true,"pinned":true,"lastOpened":"2026-10-21T13:00:00Z"},
   {"name":"site","path":"D:\\Coding\\site","branch":"dev","dirty":false,"pinned":false,"lastOpened":"2026-10-20T09:00:00Z"}]},
 "issues":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":7,"title":"Crash on save","url":"https://github.com/o/r/issues/7","state":"open","labels":["bug"],"assignee":"me","attention":"assigned","localPath":"D:\\Coding\\Apps\\null-ide","updatedAt":"2026-10-21T12:00:00Z"}]},
 "prs":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":9,"title":"Add widgets","url":"https://github.com/o/r/pull/9","author":"sam","review":"requested","checks":"failing","conflict":true,"localPath":"","updatedAt":"2026-10-21T12:30:00Z"}]}}
```

`fixtures/partial.json`: same as ok but `"issues":{"status":"ok","failed":[{"repo":"o/gone","reason":"error"},{"repo":"o/two","reason":"offline"}],"items":[ …one issue… ]}`.
`fixtures/signed_out.json`: `"issues":{"status":"signed_out","failed":[{"repo":"o/r","reason":"signed_out"}],"items":[ …one issue… ]}` and `"prs"` likewise, `"projects"` ok.
`fixtures/newer_schema.json`: `{"schema":2,"writtenAt":"2026-10-21T14:03:11Z"}`.
`fixtures/corrupt.json`: the text `{"schema":1,"writtenAt":"2026-10-21T14:0` (truncated on purpose; no trailing newline).
`fixtures/hostile.json`: one project and one issue and one PR each carrying attacks:

```json
{"schema":1,"writtenAt":"2026-10-21T14:03:11Z",
 "projects":{"status":"ok","failed":[],"items":[
   {"name":"flag","path":"--remote=evil","branch":"main","dirty":false,"pinned":false,"lastOpened":"2026-10-21T13:00:00Z"},
   {"name":"rel","path":"..\\..\\x","branch":"main","dirty":false,"pinned":false,"lastOpened":"2026-10-21T13:00:00Z"},
   {"name":"good","path":"C:\\work\\good","branch":"main","dirty":false,"pinned":false,"lastOpened":"2026-10-21T13:00:00Z"}]},
 "issues":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":1,"title":"${$host.widgetSize} {{x}} <b>hi</b>","url":"file:///C:/Windows/System32/calc.exe","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"-n","updatedAt":"2026-10-21T12:00:00Z"},
   {"provider":"github","repo":"o/r","number":2,"title":"look-alike","url":"https://github.com.evil.com/o/r/issues/2","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"},
   {"provider":"github","repo":"o/r","number":3,"title":"userinfo","url":"https://github.com@evil.com/","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"},
   {"provider":"github","repo":"o/r","number":4,"title":"javascript","url":"javascript:alert(1)","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"}]},
 "prs":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":5,"title":"HUGE","url":"https://github.com/o/r/pull/5","author":"a","review":"none","checks":"none","conflict":false,"localPath":"","updatedAt":"2026-10-21T12:00:00Z"}]}}
```
(The oversized-title case is built in the test by string replacement of `HUGE` with 10 000 `A`s — keeps the fixture small.)

- [ ] **Step 2: Write the failing tests**

`shell-ext/widgets/widgets_test.cc` (plain `main`, no framework; later tasks append test functions and call them from `main`):

```cpp
#include <windows.h>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <winrt/base.h>
#include "snapshot.h"

using namespace null_widgets;
static int g_failures = 0;
#define CHECK(c) do { if (!(c)) { ++g_failures; std::wcerr << L"FAIL " << __FILE__ << L":" << __LINE__ << L"  " << L#c << L"\n"; } } while (0)

static std::wstring ReadFixture(char const* name) {
  std::ifstream f(std::string(FIXTURE_DIR) + "/" + name, std::ios::binary);
  std::stringstream ss; ss << f.rdbuf();
  return winrt::to_hstring(ss.str()).c_str();
}

static void TestSnapshot() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  CHECK(ok.state == Load::Ok);
  CHECK(ok.snapshot.projects.size() == 2 && ok.snapshot.projects[0].name == L"null-ide" && ok.snapshot.projects[0].dirty);
  CHECK(ok.snapshot.issues.size() == 1 && ok.snapshot.issues[0].number == 7 && ok.snapshot.issues[0].labels.size() == 1);
  CHECK(ok.snapshot.prs[0].conflict && ok.snapshot.prs[0].review == L"requested");

  auto partial = ParseSnapshot(ReadFixture("partial.json"));
  CHECK(partial.state == Load::Ok && partial.snapshot.issuesSection.status == L"ok" && partial.snapshot.issuesSection.failed.size() == 2);

  auto out = ParseSnapshot(ReadFixture("signed_out.json"));
  CHECK(out.snapshot.issuesSection.status == L"signed_out" && out.snapshot.issues.size() == 1);

  CHECK(ParseSnapshot(ReadFixture("newer_schema.json")).state == Load::NewerSchema);
  CHECK(ParseSnapshot(ReadFixture("corrupt.json")).state == Load::Corrupt);
  CHECK(ParseSnapshot(L"").state == Load::Corrupt);
  CHECK(ParseSnapshot(L"[1,2,3]").state == Load::Corrupt);
  CHECK(LoadSnapshotFile(L"C:\\definitely\\not\\here.json").state == Load::Missing);

  // Unknown section / wrong types must degrade, never throw.
  auto odd = ParseSnapshot(L"{\"schema\":1,\"writtenAt\":5,\"projects\":\"x\",\"issues\":{\"items\":[1,\"a\",{\"number\":\"n\"}]}}");
  CHECK(odd.state == Load::Ok && odd.snapshot.projects.empty());
}

static void TestHostile() {
  auto h = ParseSnapshot(ReadFixture("hostile.json"));
  CHECK(h.state == Load::Ok);
  // Projects: a flag-looking and a relative path are dropped; the absolute one survives.
  CHECK(h.snapshot.projects.size() == 3);
  CHECK(h.snapshot.projects[0].path.empty() && h.snapshot.projects[1].path.empty() && h.snapshot.projects[2].path == L"C:\\work\\good");
  // URLs: only https://github.com/... survives; localPath "-n" is dropped.
  CHECK(h.snapshot.issues.size() == 4);
  for (auto const& i : h.snapshot.issues) CHECK(i.url.empty());
  CHECK(h.snapshot.issues[0].localPath.empty());
  // Text is kept verbatim (it is only ever data), but capped.
  CHECK(h.snapshot.issues[0].title == L"${$host.widgetSize} {{x}} <b>hi</b>");
  std::wstring big = ReadFixture("hostile.json");
  big.replace(big.find(L"HUGE"), 4, std::wstring(10000, L'A'));
  auto capped = ParseSnapshot(big);
  CHECK(capped.snapshot.prs[0].title.size() <= 121);

  CHECK(IsSafeGithubUrl(L"https://github.com/o/r/issues/7"));
  CHECK(!IsSafeGithubUrl(L"http://github.com/o/r"));
  CHECK(!IsSafeGithubUrl(L"https://github.com"));
  CHECK(!IsSafeGithubUrl(L"https://GitHub.com.evil.com/x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/ x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/\"x"));
  CHECK(IsAbsoluteLocalPath(L"C:\\a b\\c"));
  CHECK(!IsAbsoluteLocalPath(L"--flag")); CHECK(!IsAbsoluteLocalPath(L"-n"));
  CHECK(!IsAbsoluteLocalPath(L"C:rel")); CHECK(!IsAbsoluteLocalPath(L"\\\\?\\C:\\x"));
  CHECK(!IsAbsoluteLocalPath(L"C:\\a|b"));
  CHECK(CapText(L"a\nb", 10) == L"a b");
  long long t = 0; CHECK(ParseIsoUtc(L"2026-10-21T14:03:11Z", &t) && t == 1792591391);
  CHECK(!ParseIsoUtc(L"yesterday", &t));
}

int main() {
  winrt::init_apartment();
  TestSnapshot();
  TestHostile();
  if (g_failures) { std::wcerr << g_failures << L" check(s) failed\n"; return 1; }
  std::wcout << L"all widget tests passed\n";
  return 0;
}
```

(`1792591391` is the epoch seconds for 2026-10-21T14:03:11Z; verify with `[DateTimeOffset]::Parse('2026-10-21T14:03:11Z').ToUnixTimeSeconds()` and correct the literal if the executor's value differs.)

Add to `shell-ext/widgets/CMakeLists.txt`:

```cmake
add_library(null_widget_core STATIC snapshot.cc cards.cc)
add_dependencies(null_widget_core widgets_projection)
target_include_directories(null_widget_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}" "${WINRT_GEN}")
target_compile_definitions(null_widget_core PUBLIC WIN32_LEAN_AND_MEAN UNICODE _UNICODE)
set_property(TARGET null_widget_core PROPERTY CXX_STANDARD 20)
if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
  target_compile_options(null_widget_core PUBLIC /Zc:__cplusplus /EHsc /W4 /permissive-)
endif()
target_link_libraries(null_widget_core PUBLIC windowsapp)

add_executable(null_widgets_test widgets_test.cc)
target_link_libraries(null_widgets_test PRIVATE null_widget_core)
target_compile_definitions(null_widgets_test PRIVATE FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")
add_test(NAME null_widgets_test COMMAND null_widgets_test)
```

Until Task 4 exists, create an empty `cards.cc` containing `// filled in Task 4`.

- [ ] **Step 3: Run to verify failure**

Run: `cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64; cmake --build shell-ext-build --config Release --target null_widgets_test`
Expected: FAIL — `snapshot.h` not found.

- [ ] **Step 4: Write the implementation**

`shell-ext/widgets/snapshot.h`: the declarations from **Interfaces** above (with `#include <string> <vector>`).

`shell-ext/widgets/snapshot.cc`:

```cpp
#include "snapshot.h"
#include <winrt/Windows.Data.Json.h>
#include <ctime>
#include <fstream>
#include <sstream>

using namespace winrt::Windows::Data::Json;

namespace null_widgets {

std::wstring CapText(std::wstring const& s, size_t maxLen) {
  std::wstring out = s;
  for (auto& c : out) if (c < 0x20 || c == 0x7f) c = L' ';
  if (out.size() > maxLen) { out.resize(maxLen); out.push_back(L'\u2026'); }
  return out;
}

bool IsSafeGithubUrl(std::wstring const& u) {
  static constexpr wchar_t kPrefix[] = L"https://github.com/";
  if (u.size() <= 19 || u.size() > 300 || u.compare(0, 19, kPrefix) != 0) return false;
  for (size_t i = 19; i < u.size(); ++i) {
    wchar_t c = u[i];
    if (c <= 0x20 || c >= 0x7f || c == L'"' || c == L'\\' || c == L'<' || c == L'>' || c == L'`') return false;
  }
  return true;
}

bool IsAbsoluteLocalPath(std::wstring const& p) {
  if (p.size() < 3 || p.size() > 260) return false;
  if (!((p[0] >= L'A' && p[0] <= L'Z') || (p[0] >= L'a' && p[0] <= L'z')) || p[1] != L':' || p[2] != L'\\') return false;
  for (wchar_t c : p) if (c < 0x20 || c == L'<' || c == L'>' || c == L'"' || c == L'|' || c == L'?' || c == L'*') return false;
  return true;
}

bool ParseIsoUtc(std::wstring const& iso, long long* out) {
  int y, mo, d, h, mi, s;
  if (swscanf_s(iso.c_str(), L"%4d-%2d-%2dT%2d:%2d:%2dZ", &y, &mo, &d, &h, &mi, &s) != 6) return false;
  std::tm tm{}; tm.tm_year = y - 1900; tm.tm_mon = mo - 1; tm.tm_mday = d; tm.tm_hour = h; tm.tm_min = mi; tm.tm_sec = s;
  auto t = _mkgmtime64(&tm);
  if (t < 0) return false;
  *out = t;
  return true;
}

namespace {
std::wstring Str(JsonObject const& o, wchar_t const* k, size_t cap) {
  if (!o.HasKey(k)) return L"";
  auto v = o.GetNamedValue(k);
  return v.ValueType() == JsonValueType::String ? CapText(v.GetString().c_str(), cap) : L"";
}
bool Bool(JsonObject const& o, wchar_t const* k) {
  if (!o.HasKey(k)) return false;
  auto v = o.GetNamedValue(k);
  return v.ValueType() == JsonValueType::Boolean && v.GetBoolean();
}
long Num(JsonObject const& o, wchar_t const* k) {
  if (!o.HasKey(k)) return 0;
  auto v = o.GetNamedValue(k);
  return v.ValueType() == JsonValueType::Number ? static_cast<long>(v.GetNumber()) : 0;
}
std::wstring Url(JsonObject const& o) { auto u = Str(o, L"url", 400); return IsSafeGithubUrl(u) ? u : L""; }
std::wstring Path(JsonObject const& o, wchar_t const* k) { auto p = Str(o, k, 300); return IsAbsoluteLocalPath(p) ? p : L""; }

// Reads {status, failed[], items[]}; calls add() for each object item. Anything of the wrong shape is skipped.
template <class F>
Section ReadSection(JsonObject const& root, wchar_t const* key, F add) {
  Section s;
  if (!root.HasKey(key) || root.GetNamedValue(key).ValueType() != JsonValueType::Object) return s;
  auto sec = root.GetNamedObject(key);
  auto status = Str(sec, L"status", 20);
  if (status == L"signed_out" || status == L"offline" || status == L"error") s.status = status;
  if (sec.HasKey(L"failed") && sec.GetNamedValue(L"failed").ValueType() == JsonValueType::Array) {
    for (auto const& f : sec.GetNamedArray(L"failed")) {
      if (f.ValueType() != JsonValueType::Object) continue;
      auto fo = f.GetObject();
      s.failed.push_back({Str(fo, L"repo", 100), Str(fo, L"reason", 20)});
      if (s.failed.size() >= 50) break;
    }
  }
  if (sec.HasKey(L"items") && sec.GetNamedValue(L"items").ValueType() == JsonValueType::Array) {
    for (auto const& it : sec.GetNamedArray(L"items")) if (it.ValueType() == JsonValueType::Object) add(it.GetObject());
  }
  return s;
}
}  // namespace

Loaded ParseSnapshot(std::wstring const& json) {
  Loaded r;
  try {
    JsonObject root{nullptr};
    if (!JsonObject::TryParse(json, root)) { r.state = Load::Corrupt; return r; }
    if (!root.HasKey(L"schema") || root.GetNamedValue(L"schema").ValueType() != JsonValueType::Number) { r.state = Load::Corrupt; return r; }
    if (static_cast<int>(root.GetNamedNumber(L"schema")) > kSchema) { r.state = Load::NewerSchema; return r; }
    auto& s = r.snapshot;
    s.writtenAt = Str(root, L"writtenAt", 30);
    s.projectsSection = ReadSection(root, L"projects", [&](JsonObject const& o) {
      Project p{Str(o, L"name", 60), Path(o, L"path"), Str(o, L"branch", 60), Str(o, L"lastOpened", 30), Bool(o, L"dirty"), Bool(o, L"pinned")};
      s.projects.push_back(std::move(p));
    });
    s.issuesSection = ReadSection(root, L"issues", [&](JsonObject const& o) {
      Issue i; i.repo = Str(o, L"repo", 100); i.title = Str(o, L"title", 120); i.url = Url(o);
      i.attention = Str(o, L"attention", 20); i.localPath = Path(o, L"localPath"); i.assignee = Str(o, L"assignee", 40);
      i.number = Num(o, L"number");
      if (o.HasKey(L"labels") && o.GetNamedValue(L"labels").ValueType() == JsonValueType::Array)
        for (auto const& l : o.GetNamedArray(L"labels")) {
          if (l.ValueType() == JsonValueType::String && i.labels.size() < 5) i.labels.push_back(CapText(l.GetString().c_str(), 30));
        }
      s.issues.push_back(std::move(i));
    });
    s.prsSection = ReadSection(root, L"prs", [&](JsonObject const& o) {
      Pr p; p.repo = Str(o, L"repo", 100); p.title = Str(o, L"title", 120); p.url = Url(o); p.author = Str(o, L"author", 40);
      p.review = Str(o, L"review", 20); p.checks = Str(o, L"checks", 20); p.conflict = Bool(o, L"conflict");
      p.localPath = Path(o, L"localPath"); p.number = Num(o, L"number");
      s.prs.push_back(std::move(p));
    });
    r.state = Load::Ok;
  } catch (...) {
    r = Loaded{};
    r.state = Load::Corrupt;
  }
  return r;
}

Loaded LoadSnapshotFile(std::wstring const& path) {
  std::ifstream f(std::filesystem::path(path), std::ios::binary);
  if (!f) { Loaded l; l.state = Load::Missing; return l; }
  std::stringstream ss; ss << f.rdbuf();
  auto text = ss.str();
  if (text.size() > 2 * 1024 * 1024) { Loaded l; l.state = Load::Corrupt; return l; }
  return ParseSnapshot(winrt::to_hstring(text).c_str());
}

}  // namespace null_widgets
```

Add `#include <filesystem>` and `#include <cstdlib>` at the top. Item arrays are capped by the card builder (Task 4), but cap the parse too: stop adding after 200 items per section (add `if (list.size() >= 200) return;` guards via a counter in `ReadSection`).

- [ ] **Step 5: Run to verify it passes**

Run: `cmake --build shell-ext-build --config Release --target null_widgets_test; ctest --test-dir shell-ext-build -C Release --output-on-failure -R null_widgets_test`
Expected: `all widget tests passed`, CTest `100% tests passed`.

- [ ] **Step 6: Commit**

```bash
git add shell-ext/widgets
git commit -m "feat(widgets): snapshot parser with untrusted-input validation (#141)"
```

---

### Task 4: Adaptive Card builder

The template is a constant per widget kind; **all** snapshot text goes through `data`. Adaptive Card templating binds values (`${title}`) without re-evaluating them, so a title containing `${…}` stays inert. A test pins the property: the template text is identical for a benign and a hostile snapshot.

**Files:**
- Create: `shell-ext/widgets/cards.h`, fill `shell-ext/widgets/cards.cc`
- Modify: `shell-ext/widgets/widgets_test.cc`

**Interfaces:**
- Consumes: everything in `snapshot.h`.
- Produces (namespace `null_widgets`):

```cpp
enum class Kind { Projects, Issues, Prs };
enum class Size { Small, Medium, Large };
struct Card { std::wstring templateJson, dataJson; };
constexpr long long kStaleAfterSeconds = 6 * 3600;   // footer muted after 6 h
size_t RowLimit(Size s);                              // small 3, medium 4, large 8
Card BuildCard(Loaded const& loaded, Kind kind, Size size, long long nowEpoch);
// Everything an action may target: project paths and localPaths of the current snapshot.
bool IsAllowedProjectPath(Snapshot const& s, std::wstring const& path);
std::wstring RelativeAge(long long seconds);          // "just now", "5 min ago", "3 h ago", "2 d ago"
```

- [ ] **Step 1: Write the failing tests**

Append to `widgets_test.cc` (include `"cards.h"` and `<winrt/Windows.Data.Json.h>`) and call from `main`:

```cpp
using namespace winrt::Windows::Data::Json;

static JsonObject J(std::wstring const& s) { JsonObject o{nullptr}; CHECK(JsonObject::TryParse(s, o)); return o; }

static void TestCards() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  const long long now = 1792591391 + 300;                       // 5 minutes after writtenAt

  // Size limits.
  CHECK(RowLimit(Size::Small) == 3 && RowLimit(Size::Medium) == 4 && RowLimit(Size::Large) == 8);

  // Projects: rows + footer; both are valid JSON.
  auto c = BuildCard(ok, Kind::Projects, Size::Medium, now);
  auto data = J(c.dataJson); J(c.templateJson);
  CHECK(data.GetNamedArray(L"rows").Size() == 2);
  CHECK(std::wstring(data.GetNamedString(L"footer")).find(L"5 min ago") != std::wstring::npos);
  CHECK(!data.GetNamedBoolean(L"footerMuted"));
  auto firstRow = data.GetNamedArray(L"rows").GetObjectAt(0);
  CHECK(firstRow.GetNamedString(L"project") == L"D:\\Coding\\Apps\\null-ide");

  // Stale after 6 hours: muted.
  auto stale = J(BuildCard(ok, Kind::Projects, Size::Medium, 1792591391 + kStaleAfterSeconds + 1).dataJson);
  CHECK(stale.GetNamedBoolean(L"footerMuted"));

  // Trimming per size.
  auto small = J(BuildCard(ok, Kind::Projects, Size::Small, now).dataJson);
  CHECK(small.GetNamedArray(L"rows").Size() == 2);              // only 2 projects exist, <= 3

  // Issues / PRs rows carry url + project only when valid.
  auto iss = J(BuildCard(ok, Kind::Issues, Size::Large, now).dataJson).GetNamedArray(L"rows").GetObjectAt(0);
  CHECK(iss.GetNamedString(L"url") == L"https://github.com/o/r/issues/7" && iss.GetNamedBoolean(L"hasUrl"));
  auto pr = J(BuildCard(ok, Kind::Prs, Size::Large, now).dataJson).GetNamedArray(L"rows").GetObjectAt(0);
  CHECK(std::wstring(pr.GetNamedString(L"sub")).find(L"review requested") != std::wstring::npos);
  CHECK(std::wstring(pr.GetNamedString(L"sub")).find(L"conflict") != std::wstring::npos);
  CHECK(pr.GetNamedString(L"project") == L"");

  // Signed out: rows kept, dimmed, notice present.
  auto so = J(BuildCard(ParseSnapshot(ReadFixture("signed_out.json")), Kind::Issues, Size::Medium, now).dataJson);
  CHECK(so.GetNamedArray(L"rows").Size() == 1 && so.GetNamedArray(L"rows").GetObjectAt(0).GetNamedBoolean(L"dim"));
  CHECK(std::wstring(so.GetNamedString(L"notice")).find(L"Signed out") != std::wstring::npos);

  // Partial failure: footer names the count, rows not dimmed.
  auto pf = J(BuildCard(ParseSnapshot(ReadFixture("partial.json")), Kind::Issues, Size::Medium, now).dataJson);
  CHECK(std::wstring(pf.GetNamedString(L"footer")).find(L"2 repos not updated") != std::wstring::npos);
  CHECK(!pf.GetNamedArray(L"rows").GetObjectAt(0).GetNamedBoolean(L"dim"));

  // Empty / schema / corrupt states render a notice and no rows.
  Loaded missing; missing.state = Load::Missing;
  auto m = J(BuildCard(missing, Kind::Projects, Size::Medium, now).dataJson);
  CHECK(m.GetNamedString(L"notice") == L"Open Null IDE to set up widgets" && m.GetNamedArray(L"rows").Size() == 0);
  auto n = J(BuildCard(ParseSnapshot(ReadFixture("newer_schema.json")), Kind::Prs, Size::Medium, now).dataJson);
  CHECK(n.GetNamedString(L"notice") == L"Update Null IDE" && n.GetNamedArray(L"rows").Size() == 0);

  // Hostile: the template never contains snapshot text; the same template is produced for any snapshot.
  auto hostile = ParseSnapshot(ReadFixture("hostile.json"));
  auto hc = BuildCard(hostile, Kind::Issues, Size::Large, now);
  CHECK(hc.templateJson == BuildCard(ok, Kind::Issues, Size::Large, now).templateJson);
  CHECK(hc.templateJson.find(L"${$host.widgetSize} {{x}}") == std::wstring::npos);
  auto hrows = J(hc.dataJson).GetNamedArray(L"rows");
  for (uint32_t i = 0; i < hrows.Size(); ++i) {
    auto r = hrows.GetObjectAt(i);
    CHECK(!r.GetNamedBoolean(L"hasUrl"));                       // every attack URL was rejected
    CHECK(r.GetNamedString(L"project") == L"");                 // "-n" was rejected
  }
  auto proj = J(BuildCard(hostile, Kind::Projects, Size::Large, now).dataJson).GetNamedArray(L"rows");
  CHECK(proj.GetObjectAt(0).GetNamedString(L"project") == L"" && proj.GetObjectAt(2).GetNamedString(L"project") == L"C:\\work\\good");

  // Allowlist for actions.
  CHECK(IsAllowedProjectPath(ok.snapshot, L"D:\\Coding\\Apps\\null-ide"));
  CHECK(IsAllowedProjectPath(ok.snapshot, L"D:\\Coding\\site"));
  CHECK(!IsAllowedProjectPath(ok.snapshot, L"C:\\Windows\\System32"));
  CHECK(!IsAllowedProjectPath(ok.snapshot, L"--remote=x"));
  CHECK(RelativeAge(10) == L"just now" && RelativeAge(300) == L"5 min ago" && RelativeAge(7200) == L"2 h ago" && RelativeAge(172800) == L"2 d ago");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cmake --build shell-ext-build --config Release --target null_widgets_test`
Expected: FAIL — `cards.h` not found.

- [ ] **Step 3: Write the implementation**

`shell-ext/widgets/cards.h`: the declarations from **Interfaces** (with `#include "snapshot.h"`).

`shell-ext/widgets/cards.cc`:

```cpp
#include "cards.h"
#include <winrt/Windows.Data.Json.h>
#include <algorithm>
#include <set>

using namespace winrt::Windows::Data::Json;

namespace null_widgets {
namespace {

JsonValue S(std::wstring const& s) { return JsonValue::CreateStringValue(s); }
JsonValue B(bool b) { return JsonValue::CreateBooleanValue(b); }

// One constant template per kind. Text elements only ever carry ${binding}s.
std::wstring Template(wchar_t const* title) {
  std::wstring t = LR"({"type":"AdaptiveCard","$schema":"http://adaptivecards.io/schemas/adaptive-card.json","version":"1.6","body":[
{"type":"TextBlock","text":")";
  t += title;
  t += LR"(","weight":"Bolder","size":"Medium"},
{"type":"TextBlock","text":"${notice}","wrap":true,"isSubtle":true,"$when":"${notice != ''}"},
{"type":"ColumnSet","$data":"${rows}","spacing":"Small","columns":[
 {"type":"Column","width":"stretch","items":[
  {"type":"TextBlock","text":"${title}","maxLines":1,"isSubtle":"${dim}"},
  {"type":"TextBlock","text":"${sub}","size":"Small","isSubtle":true,"maxLines":1,"$when":"${$host.widgetSize != 'small'}"}]},
 {"type":"Column","width":"auto","items":[{"type":"ActionSet","actions":[
  {"type":"Action.OpenUrl","title":"GitHub","url":"${url}","$when":"${hasUrl}"},
  {"type":"Action.Execute","title":"Open","verb":"openProject","data":{"path":"${project}"},"$when":"${project != ''}"},
  {"type":"Action.Execute","title":"New window","verb":"openProjectNew","data":{"path":"${project}"},"$when":"${project != '' && newWindow}"}]}]}]},
{"type":"TextBlock","text":"${footer}","size":"Small","isSubtle":"${footerMuted}","$when":"${footer != ''}"}]})";
  return t;
}

std::wstring Notice(Load state, Section const& sec, bool corruptHadNothing) {
  if (state == Load::Missing) return L"Open Null IDE to set up widgets";
  if (state == Load::NewerSchema) return L"Update Null IDE";
  if (state == Load::Corrupt) return corruptHadNothing ? L"Widget data unreadable. Open Null IDE to refresh" : L"";
  if (sec.status == L"signed_out") return L"Signed out. Showing the last data";
  if (sec.status == L"offline") return L"Offline. Showing the last data";
  if (sec.status == L"error") return L"Could not refresh. Showing the last data";
  return L"";
}

JsonObject Row(std::wstring title, std::wstring sub, std::wstring url, std::wstring project, bool dim, bool newWindow) {
  JsonObject r;
  r.SetNamedValue(L"title", S(title));
  r.SetNamedValue(L"sub", S(sub));
  r.SetNamedValue(L"url", S(url));
  r.SetNamedValue(L"hasUrl", B(!url.empty()));
  r.SetNamedValue(L"project", S(project));
  r.SetNamedValue(L"dim", B(dim));
  r.SetNamedValue(L"newWindow", B(newWindow));
  return r;
}

std::wstring Join(std::vector<std::wstring> const& parts) {
  std::wstring out;
  for (auto const& p : parts) if (!p.empty()) { if (!out.empty()) out += L" \u00b7 "; out += p; }
  return out;
}

}  // namespace

size_t RowLimit(Size s) { return s == Size::Small ? 3 : s == Size::Medium ? 4 : 8; }

std::wstring RelativeAge(long long s) {
  if (s < 60) return L"just now";
  if (s < 3600) return std::to_wstring(s / 60) + L" min ago";
  if (s < 86400) return std::to_wstring(s / 3600) + L" h ago";
  return std::to_wstring(s / 86400) + L" d ago";
}

bool IsAllowedProjectPath(Snapshot const& s, std::wstring const& path) {
  if (!IsAbsoluteLocalPath(path)) return false;
  for (auto const& p : s.projects) if (_wcsicmp(p.path.c_str(), path.c_str()) == 0) return true;
  for (auto const& i : s.issues) if (_wcsicmp(i.localPath.c_str(), path.c_str()) == 0) return true;
  for (auto const& p : s.prs) if (_wcsicmp(p.localPath.c_str(), path.c_str()) == 0) return true;
  return false;
}

Card BuildCard(Loaded const& loaded, Kind kind, Size size, long long now) {
  Card card;
  card.templateJson = Template(kind == Kind::Projects ? L"Projects" : kind == Kind::Issues ? L"Issues" : L"Pull requests");

  auto const& snap = loaded.snapshot;
  Section const& sec = kind == Kind::Projects ? snap.projectsSection : kind == Kind::Issues ? snap.issuesSection : snap.prsSection;
  bool shows = loaded.state == Load::Ok;
  bool dim = shows && sec.status != L"ok";
  size_t limit = RowLimit(size);

  JsonArray rows;
  if (shows) {
    if (kind == Kind::Projects) {
      for (auto const& p : snap.projects) {
        if (rows.Size() >= limit) break;
        long long opened = 0; std::wstring when;
        if (ParseIsoUtc(p.lastOpened, &opened)) when = L"opened " + RelativeAge(std::max(0LL, now - opened));
        rows.Append(Row((p.pinned ? L"\u2605 " : L"") + p.name + (p.dirty ? L" \u25cf" : L""), Join({p.branch, when}), L"", p.path, dim, true));
      }
    } else if (kind == Kind::Issues) {
      for (auto const& i : snap.issues) {
        if (rows.Size() >= limit) break;
        std::wstring labels; for (auto const& l : i.labels) { if (!labels.empty()) labels += L", "; labels += l; }
        rows.Append(Row(L"#" + std::to_wstring(i.number) + L" " + i.title,
                        Join({i.repo, i.attention == L"mentioned" ? L"mentioned" : L"assigned", labels}), i.url, i.localPath, dim, false));
      }
    } else {
      for (auto const& p : snap.prs) {
        if (rows.Size() >= limit) break;
        std::vector<std::wstring> marks{p.repo, p.author};
        if (p.review == L"requested") marks.push_back(L"review requested");
        else if (p.review == L"changes") marks.push_back(L"changes requested");
        else if (p.review == L"approved") marks.push_back(L"approved");
        if (p.checks == L"failing") marks.push_back(L"checks failing");
        else if (p.checks == L"pending") marks.push_back(L"checks running");
        if (p.conflict) marks.push_back(L"conflict");
        rows.Append(Row(L"#" + std::to_wstring(p.number) + L" " + p.title, Join(marks), p.url, p.localPath, dim, false));
      }
    }
  }

  std::wstring footer;
  bool muted = false;
  if (shows) {
    long long written = 0;
    if (ParseIsoUtc(snap.writtenAt, &written)) {
      long long age = std::max(0LL, now - written);
      footer = L"Updated " + RelativeAge(age);
      muted = age > kStaleAfterSeconds;
    }
    if (!sec.failed.empty() && sec.status == L"ok")
      footer += (footer.empty() ? L"" : L" \u00b7 ") + std::to_wstring(sec.failed.size()) + L" repos not updated";
  }

  JsonObject data;
  data.SetNamedValue(L"rows", rows);
  data.SetNamedValue(L"notice", S(Notice(loaded.state, sec, true)));
  data.SetNamedValue(L"footer", S(footer));
  data.SetNamedValue(L"footerMuted", B(muted));
  card.dataJson = data.Stringify().c_str();
  return card;
}

}  // namespace null_widgets
```

Two details to check while running the tests: (1) the `Notice` for `Load::Corrupt` is only used when the provider has no last good snapshot (Task 5 passes the *last good* `Loaded` instead of a `Corrupt` one when it has one, so `Corrupt` reaching `BuildCard` always means "nothing to show"); (2) the 'dim' flag for `Row` is computed once per section.

- [ ] **Step 4: Run to verify it passes**

Run: `cmake --build shell-ext-build --config Release --target null_widgets_test; ctest --test-dir shell-ext-build -C Release --output-on-failure`
Expected: PASS. If a JSON-shape check fails, fix the builder, not the test (the shapes are the contract with Task 5's template).

- [ ] **Step 5: Commit**

```bash
git add shell-ext/widgets
git commit -m "feat(widgets): Adaptive Card builder with inert snapshot text (#141)"
```

---

### Task 5: The provider — watch, render, act, exit

**Files:**
- Create: `shell-ext/widgets/provider.h`, `shell-ext/widgets/provider.cc`
- Replace the body of: `shell-ext/widgets/main.cc`
- Modify: `shell-ext/widgets/CMakeLists.txt` (`null_widgets` links `null_widget_core`, `null_launch`; sources `main.cc provider.cc ../src/launch_via_explorer.cc`)
- Modify: `shell-ext/widgets/widgets_test.cc` (pure parts only)

**Interfaces:**
- Consumes: `Loaded`, `LoadSnapshotFile`, `BuildCard`, `IsAllowedProjectPath`, `Kind`, `Size` (Tasks 3–4); `null_launch::LaunchViaExplorer`, `QuoteForCommandLineArg` (Task 2).
- Produces (namespace `null_widgets`, in `provider.h`, pure so they are CTest-able):

```cpp
// Verb + data -> a validated launch request, or nothing.
struct LaunchRequest { std::wstring path; bool newWindow = false; };
std::optional<LaunchRequest> ParseAction(std::wstring const& verb, std::wstring const& dataJson, Snapshot const& current);
// "-n -- <quoted path>" or "-- <quoted path>"
std::wstring BuildLaunchArgs(LaunchRequest const& r);
// <install>\shell-ext\NullIDE.Widgets\x64\null_widgets.exe -> <install>
std::filesystem::path InstallRootFromExe(std::filesystem::path const& exe);
// Last-good policy: a Corrupt reload keeps `lastGood` when it has one.
Loaded Choose(Loaded const& fresh, std::optional<Loaded> const& lastGood);
```

- [ ] **Step 1: Write the failing tests for the pure parts**

Append to `widgets_test.cc` and call from `main` (add `#include "provider.h"`):

```cpp
static void TestProviderRules() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  auto good = ParseAction(L"openProject", L"{\"path\":\"D:\\\\Coding\\\\Apps\\\\null-ide\"}", ok.snapshot);
  CHECK(good && !good->newWindow && good->path == L"D:\\Coding\\Apps\\null-ide");
  auto nw = ParseAction(L"openProjectNew", L"{\"path\":\"D:\\\\Coding\\\\site\"}", ok.snapshot);
  CHECK(nw && nw->newWindow);
  CHECK(!ParseAction(L"openProject", L"{\"path\":\"C:\\\\Windows\\\\System32\"}", ok.snapshot));   // not in the snapshot
  CHECK(!ParseAction(L"openProject", L"{\"path\":\"--remote=x\"}", ok.snapshot));
  CHECK(!ParseAction(L"format", L"{\"path\":\"D:\\\\Coding\\\\site\"}", ok.snapshot));            // unknown verb
  CHECK(!ParseAction(L"openProject", L"garbage", ok.snapshot));
  CHECK(!ParseAction(L"openProject", L"{\"path\":5}", ok.snapshot));

  CHECK(BuildLaunchArgs({L"D:\\a b\\c", false}) == L"-- \"D:\\a b\\c\"");
  CHECK(BuildLaunchArgs({L"D:\\c", true}) == L"-n -- D:\\c");

  CHECK(InstallRootFromExe(L"C:\\Users\\u\\AppData\\Local\\Programs\\Null IDE\\shell-ext\\NullIDE.Widgets\\x64\\null_widgets.exe")
        == std::filesystem::path(L"C:\\Users\\u\\AppData\\Local\\Programs\\Null IDE"));

  auto corrupt = ParseSnapshot(ReadFixture("corrupt.json"));
  CHECK(Choose(corrupt, ok).state == Load::Ok);                                                   // keeps the last good render
  CHECK(Choose(corrupt, std::nullopt).state == Load::Corrupt);
  CHECK(Choose(ok, std::nullopt).state == Load::Ok);
  Loaded missing; missing.state = Load::Missing;
  CHECK(Choose(missing, ok).state == Load::Missing);                                              // deleting the file (widgets off) empties the cards
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cmake --build shell-ext-build --config Release --target null_widgets_test`
Expected: FAIL — `provider.h` not found.

- [ ] **Step 3: Write `provider.h` / the pure functions**

`provider.h`: declarations from **Interfaces** plus `#include "cards.h" <optional> <filesystem>`.

In `provider.cc` (pure section first):

```cpp
#include "provider.h"
#include <winrt/Windows.Data.Json.h>
#include "launch_via_explorer.h"

using namespace winrt::Windows::Data::Json;
namespace null_widgets {

std::optional<LaunchRequest> ParseAction(std::wstring const& verb, std::wstring const& dataJson, Snapshot const& current) {
  bool isNew;
  if (verb == L"openProject") isNew = false; else if (verb == L"openProjectNew") isNew = true; else return std::nullopt;
  JsonObject o{nullptr};
  if (!JsonObject::TryParse(dataJson, o) || !o.HasKey(L"path") || o.GetNamedValue(L"path").ValueType() != JsonValueType::String) return std::nullopt;
  std::wstring path = o.GetNamedString(L"path").c_str();
  if (!IsAllowedProjectPath(current, path)) return std::nullopt;     // card data is not trusted either
  return LaunchRequest{path, isNew};
}

std::wstring BuildLaunchArgs(LaunchRequest const& r) {
  return std::wstring(r.newWindow ? L"-n " : L"") + L"-- " + null_launch::QuoteForCommandLineArg(r.path);
}

std::filesystem::path InstallRootFromExe(std::filesystem::path const& exe) {
  return exe.parent_path().parent_path().parent_path().parent_path();   // x64 -> NullIDE.Widgets -> shell-ext -> install
}

Loaded Choose(Loaded const& fresh, std::optional<Loaded> const& lastGood) {
  if (fresh.state == Load::Corrupt && lastGood) return *lastGood;
  return fresh;
}
```

Note `"-n -- D:\\c"`: `QuoteForCommandLineArg` only quotes when the path contains a space, backslash or quote — it contains a backslash, so `D:\c` becomes `"D:\c"`. Run the test and **correct the expected literal in the test to match `QuoteForCommandLineArg`'s real output** (the quoting function is Chromium's and is the source of truth; the test exists to pin `--` and `-n` ordering, not the quoting).

- [ ] **Step 4: Run to verify it passes**

Run: `cmake --build shell-ext-build --config Release --target null_widgets_test; ctest --test-dir shell-ext-build -C Release --output-on-failure`
Expected: PASS.

- [ ] **Step 5: Write the COM provider**

Add to `provider.h`:

```cpp
// The COM-facing provider. Not unit-tested (needs the Board); everything it decides is in the pure functions above.
#include <winrt/Microsoft.Windows.Widgets.Providers.h>
struct Provider;
winrt::com_ptr<Provider> MakeProvider(HANDLE emptyEvent);
```

Replace `main.cc` with:

```cpp
#include <windows.h>
#include <unknwn.h>
#include <winrt/Windows.Foundation.h>
#include "provider.h"

namespace {
constexpr GUID kProviderClsid = {0x1CADFE2C, 0x53CF, 0x4DCC, {0xAA, 0xEE, 0xA3, 0x13, 0x9D, 0x7E, 0xF6, 0x0E}};

struct Factory : winrt::implements<Factory, IClassFactory> {
  winrt::com_ptr<IInspectable> provider;
  explicit Factory(winrt::com_ptr<IInspectable> p) : provider(std::move(p)) {}
  HRESULT __stdcall CreateInstance(IUnknown* outer, GUID const& iid, void** result) noexcept final {
    if (!result) return E_POINTER;
    *result = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    return provider->QueryInterface(iid, result);
  }
  HRESULT __stdcall LockServer(BOOL) noexcept final { return S_OK; }
};
}  // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  HANDLE empty = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  auto provider = null_widgets::MakeProvider(empty);
  DWORD cookie = 0;
  auto factory = winrt::make<Factory>(provider.as<IInspectable>());
  winrt::check_hresult(CoRegisterClassObject(kProviderClsid, factory.get(), CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE, &cookie));
  WaitForSingleObject(empty, INFINITE);       // signalled when the Board deletes the last widget
  CoRevokeClassObject(cookie);
  return 0;
}
```

(Keep the Task 1 Step 12 `winrt_activation_handler` block at the top of `main.cc` if Task 1 chose the hook.)

`provider.cc` (COM section appended; `struct Provider` is declared in the .cc and exposed through `MakeProvider`; adapt the forward declaration in the header to `struct Provider;` inside `namespace null_widgets`):

```cpp
#include <winrt/Windows.Foundation.h>
#include <shlobj.h>
#include <mutex>
#include <map>
#include <thread>

namespace wp = winrt::Microsoft::Windows::Widgets::Providers;
namespace null_widgets {
namespace {
std::wstring SnapshotDir() {
  PWSTR p = nullptr;
  SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &p);
  std::wstring d = std::wstring(p ? p : L"") + L"\\Null\\widgets";
  CoTaskMemFree(p);
  return d;
}
Kind KindOf(winrt::hstring const& def) { return def == L"Issues" ? Kind::Issues : def == L"PullRequests" ? Kind::Prs : Kind::Projects; }
Size SizeOf(wp::WidgetContext const& c) {
  auto s = c.Size();
  return s == wp::WidgetSize::Small ? Size::Small : s == wp::WidgetSize::Large ? Size::Large : Size::Medium;
}
long long NowEpoch() { return static_cast<long long>(std::time(nullptr)); }
}  // namespace

struct Provider : winrt::implements<Provider, wp::IWidgetProvider> {
  explicit Provider(HANDLE empty) : empty_(empty), dir_(SnapshotDir()) {
    CreateDirectoryW((dir_.substr(0, dir_.find_last_of(L'\\'))).c_str(), nullptr);
    CreateDirectoryW(dir_.c_str(), nullptr);
    Reload();
    // Re-attach to widgets that stayed pinned while this process was not running.
    try { for (auto const& info : wp::WidgetManager::GetDefault().GetWidgetInfos()) Track(info.WidgetContext()); } catch (...) {}
    watcher_ = std::thread([this] { Watch(); });
  }
  ~Provider() { stop_ = true; SetEvent(wake_); if (watcher_.joinable()) watcher_.join(); }

  void CreateWidget(wp::WidgetContext const& c) { Track(c); Push(c.Id()); }
  void DeleteWidget(winrt::hstring const& id, winrt::hstring const&) {
    bool none;
    { std::lock_guard g{m_}; widgets_.erase(id); none = widgets_.empty(); }
    if (none) SetEvent(empty_);
  }
  void Activate(wp::WidgetContext const& c) { Track(c); Reload(); Push(c.Id()); }       // re-read on Activate
  void Deactivate(winrt::hstring const&) {}
  void OnWidgetContextChanged(wp::WidgetContextChangedArgs const& a) { Track(a.WidgetContext()); Push(a.WidgetContext().Id()); }

  void OnActionInvoked(wp::WidgetActionInvokedArgs const& a) {
    Snapshot snap;
    { std::lock_guard g{m_}; if (shown_) snap = shown_->snapshot; }
    auto req = ParseAction(a.Verb().c_str(), a.Data().c_str(), snap);
    if (!req) return;
    wchar_t exe[MAX_PATH]; GetModuleFileNameW(nullptr, exe, MAX_PATH);
    auto root = InstallRootFromExe(exe);
    auto nullExe = root / L"null.exe";
    if (!std::filesystem::is_regular_file(nullExe)) return;
    null_launch::LaunchViaExplorer(nullExe, root, BuildLaunchArgs(*req));
  }

 private:
  void Track(wp::WidgetContext const& c) { std::lock_guard g{m_}; widgets_[c.Id()] = {KindOf(c.DefinitionId()), SizeOf(c)}; }

  void Reload() {
    auto fresh = LoadSnapshotFile(dir_ + L"\\snapshot.json");
    std::lock_guard g{m_};
    shown_ = Choose(fresh, shown_);         // Ok/Missing/NewerSchema replace what is shown; Corrupt keeps the last good one
  }

  void Push(winrt::hstring const& id) {
    Kind kind; Size size; Loaded loaded;
    { std::lock_guard g{m_}; auto it = widgets_.find(id); if (it == widgets_.end()) return; kind = it->second.first; size = it->second.second;
      loaded = shown_ ? *shown_ : Loaded{}; }
    auto card = BuildCard(loaded, kind, size, NowEpoch());
    wp::WidgetUpdateRequestOptions o{id};
    o.Template(card.templateJson);
    o.Data(card.dataJson);
    try { wp::WidgetManager::GetDefault().UpdateWidget(o); } catch (...) {}
  }
  void PushAll() {
    std::vector<winrt::hstring> ids;
    { std::lock_guard g{m_}; for (auto const& [id, _] : widgets_) ids.push_back(id); }
    for (auto const& id : ids) Push(id);
  }

  void Watch() {
    HANDLE change = FindFirstChangeNotificationW(dir_.c_str(), FALSE, FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE);
    if (change == INVALID_HANDLE_VALUE) return;
    HANDLE h[2] = {wake_, change};
    while (!stop_) {
      // Also re-render every minute so the "updated N min ago" footer moves without a file change.
      DWORD r = WaitForMultipleObjects(2, h, FALSE, 60'000);
      if (stop_) break;
      if (r == WAIT_OBJECT_0 + 1) { Sleep(200); FindNextChangeNotification(change); }   // debounce the rename burst
      Reload();
      PushAll();
    }
    FindCloseChangeNotification(change);
  }

  HANDLE empty_;
  std::wstring dir_;
  std::mutex m_;
  std::map<winrt::hstring, std::pair<Kind, Size>> widgets_;
  std::optional<Loaded> shown_;
  HANDLE wake_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  std::atomic<bool> stop_{false};
  std::thread watcher_;
};

winrt::com_ptr<Provider> MakeProvider(HANDLE emptyEvent) { return winrt::make_self<Provider>(emptyEvent); }
}  // namespace null_widgets
```

`Choose` is the whole policy: a `Missing` file (widgets turned off) *replaces* the shown state so cards fall back to the empty state (spec decision 16), while a `Corrupt` one keeps the last good render. Add `#include <atomic> <ctime> <vector>`.

Update `shell-ext/widgets/CMakeLists.txt`: `add_executable(null_widgets main.cc provider.cc ../src/launch_via_explorer.cc)`, `target_link_libraries(null_widgets PRIVATE null_widget_core windowsapp ole32 oleaut32 shell32 shlwapi)`, and add `${WIL_INCLUDE}` (`"${CMAKE_CURRENT_SOURCE_DIR}/../deps/wil/include"`) to the include dirs because `launch_via_explorer.cc` uses wil.

- [ ] **Step 6: Build and run the unit tests**

Run: `cmake --build shell-ext-build --config Release; ctest --test-dir shell-ext-build -C Release --output-on-failure`
Expected: everything builds, CTest passes.

- [ ] **Step 7: Windows 11 smoke (manual)**

Re-pack with `scripts/pack-widgets.ps1` as in Task 1 Step 9–10, hand-write `%LOCALAPPDATA%\Null\widgets\snapshot.json` from `fixtures/ok.json` (project paths that exist on your machine), pin all three widgets, then verify with `scripts/check-widgets.ps1 -Status`:
- Projects/Issues/PR cards render; footer reads "Updated …".
- Edit the file (change a title) → the card updates within ~1 s without re-pinning.
- Overwrite it with `fixtures/corrupt.json` → card unchanged. Delete it → cards show "Open Null IDE to set up widgets".
- Click **Open** on a project → Null IDE opens that folder; `scripts/check-cold-start-aumid.ps1`-style check: the new `null.exe` has no package AUMID.
- Put `fixtures/hostile.json` in place → no crash, no clickable action on attack rows.
Record anything the Board rejected (e.g. a template construct) and fix the template in `cards.cc` + its tests.

- [ ] **Step 8: Commit**

```bash
git add shell-ext/widgets
git commit -m "feat(widgets): provider renders snapshot cards and launches projects (#141)"
```

---

### Task 6: Build, test and ship the provider in CI and `build-local.ps1`

**Files:**
- Modify: `.github/workflows/build.yml` (step "Build Win11 shell extension", before "Test null-setup")
- Modify: `scripts/build-local.ps1` (the `-SkipShellExt` block)
- Modify: `shell-ext/CLAUDE.md` (note the widgets directory)

**Interfaces:**
- Consumes: `scripts/fetch-widgets-deps.ps1`, `scripts/pack-widgets.ps1` (Task 1); target names `null_widgets`, `null_widgets_test`.
- Produces: `VSCode-win32-x64/shell-ext/null-widgets.appx` and `VSCode-win32-x64/shell-ext/NullIDE.Widgets/x64/{null_widgets.exe,Microsoft.Windows.Widgets.dll}` in the zip.

- [ ] **Step 1: Edit `build.yml`**

In the "Build Win11 shell extension" step (paths are relative to the repo root, where the checkout lives in `ide-overlay`):

1. After the wil fetch block (`# ── 1. Fetch wil …`), add:

```powershell
          # ── 1b. Widgets component (winmd + native DLL; checksum-pinned) ─────
          & "ide-overlay/scripts/fetch-widgets-deps.ps1"
```

2. After `cmake --build shell-ext-build --config Release` and the identity-stub copy, add:

```powershell
          # ── 2b. Widget provider unit tests (card builder, snapshot validation) ──
          ctest --test-dir shell-ext-build -C Release --output-on-failure
          if ($LASTEXITCODE -ne 0) { Write-Error "widget provider tests failed"; exit $LASTEXITCODE }
```

3. After the shell-ext appx signature verification (`Write-Host "Shell extension package built and signed …"`) and **before** `Remove-Item NullIDECert.pfx -Force` — the pfx is deleted at "Sign .appx"; move that single `Remove-Item NullIDECert.pfx -Force` line to after the new block:

```powershell
          # ── 8. Widgets package (same certificate, so no extra trust prompt) ──
          & "ide-overlay/scripts/pack-widgets.ps1" -RepoRoot "ide-overlay" -BuildDir "shell-ext-build" -OutDir $outDir -PfxPath "NullIDECert.pfx" -PfxPassword "nullbuild"
          Remove-Item NullIDECert.pfx -Force
```

- [ ] **Step 2: Mirror it in `scripts/build-local.ps1`**

In the shell-ext block: after the wil fetch add `& (Join-Path $RepoRoot "scripts/fetch-widgets-deps.ps1")`; after `cmake --build` add `Invoke-Native "ctest (widgets)" { ctest --test-dir $shellExtBuild -C Release --output-on-failure }`; replace the `Remove-Item $pfxPath -Force` line after `signtool sign` with:

```powershell
    & (Join-Path $RepoRoot "scripts/pack-widgets.ps1") -RepoRoot $RepoRoot -BuildDir $shellExtBuild -OutDir $OutDir -PfxPath $pfxPath -PfxPassword "nullbuild"
    Remove-Item $pfxPath -Force
```

- [ ] **Step 3: Verify locally**

Run the shell-ext part of `scripts/build-local.ps1` (it takes a while; do not run the whole script unless asked — run only this block, or temporarily pass `-SkipShellExt:$false` with your usual switches). Expected: `VSCode-win32-x64\shell-ext\null-widgets.appx` and `…\NullIDE.Widgets\x64\null_widgets.exe` exist; `Get-AuthenticodeSignature` on the appx shows `CN=Null IDE`. In CI the proof is the next tagged/dispatched build: the "Build Win11 shell extension" step is green and its layout listing shows both appx files.

- [ ] **Step 4: Note it in `shell-ext/CLAUDE.md`**

Append a short section "## Widgets provider (`widgets/`)": what it is, that it is a *second* package `NullIDE.Widgets` built by the same CMake run, packed by `scripts/pack-widgets.ps1`, tested by CTest (`ctest --test-dir shell-ext-build -C Release`), bump the manifest `Version` whenever `widgets/AppxManifest.xml` changes, and a pointer to `docs/specs/native-windows-widgets-design.md` and `…-gate.md`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/build.yml scripts/build-local.ps1 shell-ext/CLAUDE.md
git commit -m "ci(widgets): build, test and package the widgets provider (#141)"
```

---

### Task 7: GraphQL queries, search strings and row mappers (null-tools)

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetTypes.ts`
- Create: `extensions/null-tools/src/widgets/widgetQueries.ts`
- Create: `extensions/null-tools/src/widgets/widgetQueries.test.ts`
- Modify: `extensions/null-tools/src/pulls/pullModel.ts` (export `REVIEWS`)
- Modify: `extensions/null-tools/package.json` (add `out/widgets/widgetQueries.test.js` to `test`) and `tsconfig.json` (add `"src/widgets/widgetQueries.test.ts"` to `include`)

**Interfaces:**
- Consumes: `checkStateOf`, `REVIEWS`, `CheckState`, `ReviewState` from `../pulls/pullModel`.
- Produces (`widgetTypes.ts`):

```ts
export const SCHEMA = 1;
export const MAX_PROJECTS = 8, MAX_ISSUES = 10, MAX_PRS = 10;
export type Reason = 'signed_out' | 'offline' | 'error';
export type Status = 'ok' | Reason;
export interface Failed { repo: string; reason: Reason }
export interface Section<T> { status: Status; failed: Failed[]; items: T[] }
export interface ProjectRow { name: string; path: string; branch: string | null; dirty: boolean; pinned: boolean; lastOpened: string | null }
export interface IssueRow { provider: 'github'; repo: string; number: number; title: string; url: string; state: 'open'; labels: string[]; assignee: string | null; attention: 'assigned' | 'mentioned'; localPath: string | null; updatedAt: string }
export interface PrRow { provider: 'github'; repo: string; number: number; title: string; url: string; author: string; review: 'requested' | 'approved' | 'changes' | 'none'; checks: 'passing' | 'failing' | 'pending' | 'none'; conflict: boolean; localPath: string | null; updatedAt: string }
export interface Snapshot { schema: 1; writtenAt: string; projects: Section<ProjectRow>; issues: Section<IssueRow>; prs: Section<PrRow> }
export interface WidgetRepo { repo: string; account: string }
export const REPO_RE: RegExp;                    // /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
export function parseRepos(raw: unknown): WidgetRepo[];   // drops malformed, de-duplicates (case-insensitive repo+account)
```

`widgetQueries.ts`:

```ts
export const WIDGET_QUERY: string;
export interface SearchStrings { assigned: string; mentioned: string; authored: string; reviewReq: string }
export function searchStrings(repos: string[]): SearchStrings;
export function chunkRepos(repos: string[], maxScopeChars?: number): string[][];     // default 150
export type LocalPaths = ReadonlyMap<string, string>;                                  // lowercase "owner/repo" -> checkout path
export interface WidgetData { assigned: Nodes; mentioned: Nodes; authored: Nodes; reviewReq: Nodes }
export function mapIssues(data: WidgetData, local: LocalPaths): IssueRow[];
export function mapPrs(data: WidgetData, local: LocalPaths): PrRow[];
export function rankIssues(rows: IssueRow[]): IssueRow[];
export function rankPrs(rows: PrRow[]): PrRow[];
```

- [ ] **Step 1: Write the failing tests**

`extensions/null-tools/src/widgets/widgetQueries.test.ts`:

```ts
import assert from 'node:assert';
import test from 'node:test';
import { parseRepos, REPO_RE } from './widgetTypes';
import { WIDGET_QUERY, WidgetData, chunkRepos, mapIssues, mapPrs, rankIssues, rankPrs, searchStrings } from './widgetQueries';

const pr = (over: Record<string, unknown>) => ({
  number: 1, title: 't', url: 'https://github.com/o/r/pull/1', updatedAt: '2026-10-21T10:00:00Z', isDraft: false,
  mergeable: 'MERGEABLE', reviewDecision: null, repository: { nameWithOwner: 'o/r' }, author: { login: 'me' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...over,
});
const issue = (over: Record<string, unknown>) => ({
  number: 1, title: 'i', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-10-21T10:00:00Z',
  repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ name: 'bug' }] }, assignees: { nodes: [{ login: 'me' }] }, ...over,
});
const data = (d: Partial<Record<keyof WidgetData, unknown[]>>): WidgetData => ({
  assigned: { nodes: d.assigned ?? [] }, mentioned: { nodes: d.mentioned ?? [] },
  authored: { nodes: d.authored ?? [] }, reviewReq: { nodes: d.reviewReq ?? [] },
}) as unknown as WidgetData;

test('parseRepos keeps only well-formed owner/name entries and de-duplicates', () => {
  const out = parseRepos([
    { repo: 'a/b', account: 'x' }, { repo: 'A/B', account: 'x' },          // duplicate, different case
    { repo: 'a/b is:private', account: 'x' }, { repo: '../x', account: 'x' }, { repo: 'a/b', account: '' },
    { repo: 5, account: 'x' }, null, 'a/b', { repo: 'c/d', account: 'y' },
  ]);
  assert.deepStrictEqual(out, [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'y' }]);
  assert.deepStrictEqual(parseRepos('nope'), []);
  assert.ok(REPO_RE.test('o/r.js-x_1') && !REPO_RE.test('o/r/x') && !REPO_RE.test('o /r'));
});

test('search strings scope to the repos and use the viewer qualifiers from the spec', () => {
  const s = searchStrings(['a/b', 'c/d']);
  assert.strictEqual(s.assigned, 'repo:a/b repo:c/d is:issue is:open assignee:@me sort:updated-desc');
  assert.ok(s.mentioned.includes('mentions:@me') && s.authored.includes('is:pr is:open author:@me') && s.reviewReq.includes('review-requested:@me'));
  assert.ok(WIDGET_QUERY.includes('mergeable') && WIDGET_QUERY.includes('reviewDecision'));
});

test('chunking keeps every search under GitHub\'s 256 character limit', () => {
  const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
  const chunks = chunkRepos(repos);
  assert.deepStrictEqual(chunks.flat(), repos);
  for (const c of chunks) for (const q of Object.values(searchStrings(c))) assert.ok(q.length <= 256, `${q.length}`);
  const longest = `${'o'.repeat(100)}/${'r'.repeat(100)}`;
  assert.deepStrictEqual(chunkRepos([longest, 'a/b']), [[longest], ['a/b']]);   // an over-budget repo gets a chunk of its own
});

test('issues: assigned wins over mentioned, duplicates collapse, local checkout is attached', () => {
  const rows = mapIssues(data({ assigned: [issue({ number: 1 })], mentioned: [issue({ number: 1 }), issue({ number: 2, assignees: { nodes: [] } })] }),
    new Map([['o/r', 'D:\\code\\r']]));
  assert.deepStrictEqual(rows.map(r => [r.number, r.attention, r.assignee, r.localPath]), [[1, 'assigned', 'me', 'D:\\code\\r'], [2, 'mentioned', null, 'D:\\code\\r']]);
  assert.deepStrictEqual(rows[0].labels, ['bug']);
  assert.strictEqual(mapIssues(data({ assigned: [{}] }), new Map()).length, 0);              // search noise ({}) is skipped
});

test('PRs: review requested of the viewer, drafts of others dropped, checks and conflicts mapped', () => {
  const rows = mapPrs(data({
    authored: [pr({ number: 1, isDraft: true, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })],
    reviewReq: [pr({ number: 2, author: { login: 'sam' } }), pr({ number: 3, isDraft: true, author: { login: 'sam' } }), pr({ number: 1 })],
  }), new Map());
  assert.deepStrictEqual(rows.map(r => r.number), [1, 2]);                                   // own draft kept, sam's draft dropped, #1 once
  const p1 = rows.find(r => r.number === 1)!, p2 = rows.find(r => r.number === 2)!;
  assert.deepStrictEqual([p1.review, p1.checks, p1.conflict], ['requested', 'failing', true]);   // requested overrides CHANGES_REQUESTED
  assert.deepStrictEqual([p2.review, p2.checks, p2.conflict, p2.author], ['requested', 'passing', false, 'sam']);
  const own = mapPrs(data({ authored: [pr({ reviewDecision: 'APPROVED' })] }), new Map())[0];
  assert.strictEqual(own.review, 'approved');
  assert.strictEqual(mapPrs(data({ authored: [pr({ reviewDecision: 'REVIEW_REQUIRED', commits: { nodes: [] } })] }), new Map())[0].review, 'none');
});

test('PR ranking: review requested, then changes requested, failing checks, conflicts, then recency', () => {
  const mk = (n: number, o: Partial<ReturnType<typeof mapPrs>[number]>) => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', author: 'me', review: 'none',
    checks: 'passing', conflict: false, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z`, ...o }) as ReturnType<typeof mapPrs>[number];
  const ranked = rankPrs([mk(1, {}), mk(2, { conflict: true }), mk(3, { checks: 'failing' }), mk(4, { review: 'changes' }), mk(5, { review: 'requested' }), mk(6, {})]);
  assert.deepStrictEqual(ranked.map(r => r.number), [5, 4, 3, 2, 6, 1]);
});

test('issue ranking: assigned before mentioned, newest first inside each', () => {
  const mk = (n: number, a: 'assigned' | 'mentioned') => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', state: 'open', labels: [], assignee: null,
    attention: a, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z` }) as ReturnType<typeof mapIssues>[number];
  assert.deepStrictEqual(rankIssues([mk(1, 'mentioned'), mk(2, 'assigned'), mk(3, 'mentioned'), mk(4, 'assigned')]).map(r => r.number), [4, 2, 3, 1]);
});
```

Register the test: add `out/widgets/widgetQueries.test.js` to the `test` script's `node --test` list and `"src/widgets/widgetQueries.test.ts"` to `tsconfig.json`'s `include`.

- [ ] **Step 2: Run to verify failure**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL — `Cannot find module './widgetTypes'` (tsc error).

- [ ] **Step 3: Implement**

In `pulls/pullModel.ts` change `const REVIEWS` to `export const REVIEWS`.

`widgetTypes.ts` — the types above plus:

```ts
'use strict';

export const SCHEMA = 1;
export const MAX_PROJECTS = 8;
export const MAX_ISSUES = 10;
export const MAX_PRS = 10;
// … interfaces exactly as listed under Interfaces …

export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** The only gate between a settings value and a GitHub search string. */
export function parseRepos(raw: unknown): WidgetRepo[] {
  if (!Array.isArray(raw)) { return []; }
  const seen = new Set<string>();
  const out: WidgetRepo[] = [];
  for (const e of raw) {
    const repo = (e as WidgetRepo | null)?.repo, account = (e as WidgetRepo | null)?.account;
    if (typeof repo !== 'string' || typeof account !== 'string' || !account || !REPO_RE.test(repo)) { continue; }
    const key = `${account}\n${repo.toLowerCase()}`;
    if (seen.has(key)) { continue; }
    seen.add(key);
    out.push({ repo, account });
  }
  return out;
}
```

`widgetQueries.ts`:

```ts
'use strict';

import { CheckState, checkStateOf, REVIEWS } from '../pulls/pullModel';
import { IssueRow, PrRow } from './widgetTypes';

export const WIDGET_QUERY = `
query WidgetItems($assigned: String!, $mentioned: String!, $authored: String!, $reviewReq: String!, $n: Int!) {
  assigned: search(query: $assigned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  mentioned: search(query: $mentioned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  authored: search(query: $authored, type: ISSUE, first: $n) { nodes { ...PrFields } }
  reviewReq: search(query: $reviewReq, type: ISSUE, first: $n) { nodes { ...PrFields } }
}
fragment IssueFields on Issue {
  number title url updatedAt repository { nameWithOwner }
  labels(first: 5) { nodes { name } } assignees(first: 1) { nodes { login } }
}
fragment PrFields on PullRequest {
  number title url updatedAt isDraft mergeable reviewDecision repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

export interface SearchStrings { assigned: string; mentioned: string; authored: string; reviewReq: string }

export function searchStrings(repos: string[]): SearchStrings {
  const scope = repos.map(r => `repo:${r}`).join(' ');
  const q = (rest: string): string => `${scope} ${rest} sort:updated-desc`;
  return {
    assigned: q('is:issue is:open assignee:@me'),
    mentioned: q('is:issue is:open mentions:@me'),
    authored: q('is:pr is:open author:@me'),
    reviewReq: q('is:pr is:open review-requested:@me'),
  };
}

/** GitHub rejects search queries over 256 characters; the longest suffix above is under 50, so the `repo:` scope gets 150. */
export function chunkRepos(repos: string[], maxScopeChars = 150): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [], len = 0;
  for (const r of repos) {
    const add = r.length + 6;                                   // "repo:" + space
    if (cur.length && len + add > maxScopeChars) { chunks.push(cur); cur = []; len = 0; }
    cur.push(r); len += add;
  }
  if (cur.length) { chunks.push(cur); }
  return chunks;
}

export type LocalPaths = ReadonlyMap<string, string>;
interface Nodes { nodes: Array<Record<string, unknown>> }
export interface WidgetData { assigned: Nodes; mentioned: Nodes; authored: Nodes; reviewReq: Nodes }

interface GqlIssue { number: number; title: string; url: string; updatedAt: string; repository: { nameWithOwner: string };
  labels: { nodes: Array<{ name: string }> }; assignees: { nodes: Array<{ login: string }> } }
interface GqlPr { number: number; title: string; url: string; updatedAt: string; isDraft: boolean; mergeable: string; reviewDecision: string | null;
  repository: { nameWithOwner: string }; author: { login: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> } }

const isNode = (n: Record<string, unknown>): boolean => typeof n.number === 'number';
const CHECKS: Record<CheckState, PrRow['checks']> = { success: 'passing', failure: 'failing', pending: 'pending', none: 'none' };

export function mapIssues(data: WidgetData, local: LocalPaths): IssueRow[] {
  const out = new Map<string, IssueRow>();
  const add = (nodes: Nodes['nodes'], attention: IssueRow['attention']): void => {
    for (const raw of nodes) {
      if (!isNode(raw)) { continue; }
      const n = raw as unknown as GqlIssue;
      const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
      if (out.has(key)) { continue; }
      out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, state: 'open',
        labels: n.labels.nodes.map(l => l.name), assignee: n.assignees.nodes[0]?.login ?? null, attention,
        localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
    }
  };
  add(data.assigned.nodes, 'assigned');
  add(data.mentioned.nodes, 'mentioned');
  return [...out.values()];
}

export function mapPrs(data: WidgetData, local: LocalPaths): PrRow[] {
  const requested = new Set<string>();
  for (const raw of data.reviewReq.nodes) {
    if (!isNode(raw)) { continue; }
    const n = raw as unknown as GqlPr;
    if (!n.isDraft) { requested.add(`${n.repository.nameWithOwner.toLowerCase()}#${n.number}`); }   // others' drafts are not asked of anyone yet
  }
  const out = new Map<string, PrRow>();
  const add = (nodes: Nodes['nodes'], ownSet: boolean): void => {
    for (const raw of nodes) {
      if (!isNode(raw)) { continue; }
      const n = raw as unknown as GqlPr;
      const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
      if (out.has(key) || (!ownSet && n.isDraft)) { continue; }
      const decision = REVIEWS[n.reviewDecision ?? ''] ?? 'none';
      out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, author: n.author?.login ?? 'ghost',
        review: requested.has(key) ? 'requested' : decision === 'required' ? 'none' : decision,
        checks: CHECKS[checkStateOf(n.commits.nodes[0]?.commit.statusCheckRollup?.state)], conflict: n.mergeable === 'CONFLICTING',
        localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
    }
  };
  add(data.authored.nodes, true);
  add(data.reviewReq.nodes, false);
  return [...out.values()];
}

const newest = (a: { updatedAt: string }, b: { updatedAt: string }): number => b.updatedAt.localeCompare(a.updatedAt);

export function rankIssues(rows: IssueRow[]): IssueRow[] {
  const w = (r: IssueRow): number => (r.attention === 'assigned' ? 0 : 1);
  return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}

export function rankPrs(rows: PrRow[]): PrRow[] {
  const w = (r: PrRow): number => r.review === 'requested' ? 0 : r.review === 'changes' ? 1 : r.checks === 'failing' ? 2 : r.conflict ? 3 : 4;
  return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}
```

Note the draft rule: the reviewReq pass skips drafts (`!ownSet && n.isDraft`), but a draft the viewer authored arrives through the `authored` pass first and is kept.

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS, including the existing suites.

- [ ] **Step 5: Verify the query against real GitHub**

```bash
gh api graphql -f query="$(node -e "console.log(require('./extensions/null-tools/out/widgets/widgetQueries').WIDGET_QUERY)")" -f assigned='repo:TorresVisual/null-ide is:issue is:open assignee:@me sort:updated-desc' -f mentioned='repo:TorresVisual/null-ide is:issue is:open mentions:@me sort:updated-desc' -f authored='repo:TorresVisual/null-ide is:pr is:open author:@me sort:updated-desc' -f reviewReq='repo:TorresVisual/null-ide is:pr is:open review-requested:@me sort:updated-desc' -F n=5
```

Expected: a JSON `data` object with the four aliases and no `errors`. If `@me` is rejected in any of the four searches, replace it with the account's login in `searchStrings` (add a `login` parameter) and update the test strings — the spec's qualifiers are the intent, the login is equivalent.

- [ ] **Step 6: Compile output and commit**

```bash
cd extensions/null-tools && npm run compile && cd ../..
git add extensions/null-tools
git commit -m "feat(null-tools): widget queries, search strings and row mappers (#141)"
```

(Commit `out/` in the same commit only if the repo's `out/` is tracked for these files; otherwise follow the `chore: refresh null-tools compiled output` convention in a separate commit.)

---

### Task 8: Sections — partial failure, last-good rows, projects (pure)

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetSections.ts`
- Create: `extensions/null-tools/src/widgets/widgetSections.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include

**Interfaces:**
- Consumes: `Section`, `Reason`, `Failed`, `ProjectRow`, `MAX_PROJECTS` (Task 7); `RecentProjectEntry` from `../recentProjects`; `GitStatus` from `../dashboardGitStatus`.
- Produces:

```ts
export interface RepoOutcome<T> { repo: string; rows: T[] | null; reason?: Reason }   // rows === null: this repo failed this cycle
export function buildSection<T>(
  outcomes: RepoOutcome<T>[],
  previous: ReadonlyMap<string, T[]>,                    // last good rows per lowercase repo
  rank: (rows: T[]) => T[], max: number,
): { section: Section<T>; kept: Map<string, T[]> };      // kept = rows to remember per lowercase repo
export function buildProjects(
  entries: RecentProjectEntry[],
  statuses: ReadonlyMap<string, GitStatus | null>,        // key: entry.path
): Section<ProjectRow>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { buildProjects, buildSection } from './widgetSections';

const rank = (rows: number[]) => [...rows].sort((a, b) => a - b);

test('all repos ok: status ok, rows merged and ranked, capped', () => {
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [5, 1] }, { repo: 'c/d', rows: [3] }], new Map(), rank, 2);
  assert.deepStrictEqual(section, { status: 'ok', failed: [], items: [1, 3] });
  assert.deepStrictEqual([...kept.keys()].sort(), ['a/b', 'c/d']);
});

test('partial failure: status stays ok, the failed repo keeps its last good rows and is listed', () => {
  const previous = new Map([['c/d', [9]]]);
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [1] }, { repo: 'C/D', rows: null, reason: 'offline' }], previous, rank, 10);
  assert.deepStrictEqual(section, { status: 'ok', failed: [{ repo: 'C/D', reason: 'offline' }], items: [1, 9] });
  assert.deepStrictEqual(kept.get('c/d'), [9]);
});

test('every repo failed with the same reason: the section takes that reason and keeps all rows', () => {
  const previous = new Map([['a/b', [2]], ['c/d', [4]]]);
  const { section } = buildSection([{ repo: 'a/b', rows: null, reason: 'signed_out' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], previous, rank, 10);
  assert.strictEqual(section.status, 'signed_out');
  assert.deepStrictEqual(section.items, [2, 4]);
  assert.strictEqual(section.failed.length, 2);
});

test('every repo failed for different reasons: status is error', () => {
  const { section } = buildSection([{ repo: 'a/b', rows: null, reason: 'offline' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], new Map(), rank, 10);
  assert.strictEqual(section.status, 'error');
});

test('a repo that is no longer configured drops its remembered rows', () => {
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [1] }], new Map([['gone/x', [7]]]), rank, 10);
  assert.deepStrictEqual(section.items, [1]);
  assert.ok(!kept.has('gone/x'));
});

test('no repos configured is an empty ok section, not an error', () => {
  assert.deepStrictEqual(buildSection([], new Map(), rank, 10).section, { status: 'ok', failed: [], items: [] });
});

test('projects: pinned first, then newest, capped at 8, git status attached, ISO timestamps', () => {
  const e = (n: number, pinned = false) => ({ path: `D:\\p${n}`, label: `p${n}`, isWorkspaceFile: false, timestamp: Date.UTC(2026, 9, 21, n), pinned });
  const entries = [e(1), e(9), e(2, true), e(3), e(4), e(5), e(6), e(7), e(8)];
  const { items, status } = buildProjects(entries, new Map([['D:\\p2', { branch: 'main', dirty: true }], ['D:\\p9', null]]));
  assert.strictEqual(status, 'ok');
  assert.strictEqual(items.length, 8);
  assert.deepStrictEqual(items.slice(0, 3).map(p => p.name), ['p2', 'p9', 'p8']);
  assert.deepStrictEqual([items[0].branch, items[0].dirty, items[0].pinned, items[0].lastOpened], ['main', true, true, '2026-10-21T02:00:00.000Z']);
  assert.deepStrictEqual([items[1].branch, items[1].dirty], [null, false]);       // git failed: no branch, not dirty
});
```

Register in `package.json`/`tsconfig.json`.

- [ ] **Step 2: Run to verify failure**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL — cannot find `./widgetSections`.

- [ ] **Step 3: Implement**

```ts
'use strict';

import type { GitStatus } from '../dashboardGitStatus';
import type { RecentProjectEntry } from '../recentProjects';
import { Failed, MAX_PROJECTS, ProjectRow, Reason, Section } from './widgetTypes';

export interface RepoOutcome<T> { repo: string; rows: T[] | null; reason?: Reason }

export function buildSection<T>(
  outcomes: RepoOutcome<T>[], previous: ReadonlyMap<string, T[]>, rank: (rows: T[]) => T[], max: number,
): { section: Section<T>; kept: Map<string, T[]> } {
  const kept = new Map<string, T[]>();
  const failed: Failed[] = [];
  for (const o of outcomes) {
    const key = o.repo.toLowerCase();
    if (o.rows) { kept.set(key, o.rows); continue; }
    kept.set(key, previous.get(key) ?? []);                               // keep the last good rows
    failed.push({ repo: o.repo, reason: o.reason ?? 'error' });
  }
  const items = rank([...kept.values()].flat()).slice(0, max);
  let status: Section<T>['status'] = 'ok';
  if (outcomes.length > 0 && failed.length === outcomes.length) {
    const reasons = new Set(failed.map(f => f.reason));
    status = reasons.size === 1 ? failed[0].reason : 'error';
  }
  return { section: { status, failed, items }, kept };
}

export function buildProjects(entries: RecentProjectEntry[], statuses: ReadonlyMap<string, GitStatus | null>): Section<ProjectRow> {
  const ordered = [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp).slice(0, MAX_PROJECTS);
  const items = ordered.map((e): ProjectRow => {
    const git = statuses.get(e.path) ?? null;
    return { name: e.label, path: e.path, branch: git?.branch ?? null, dirty: git?.dirty ?? false, pinned: e.pinned, lastOpened: new Date(e.timestamp).toISOString() };
  });
  return { status: 'ok', failed: [], items };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): widget section building with last-good rows (#141)"
```

---

### Task 9: Atomic snapshot store and per-feature ownership claim

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetStore.ts`, `widgetStore.test.ts`
- Modify: `extensions/null-tools/src/presenceOwnership.ts` (optional `claimFile`)
- Create: `extensions/null-tools/src/presenceOwnership.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include (both new test files)

**Interfaces:**
- Produces:

```ts
// widgetStore.ts
export function widgetsDir(env?: NodeJS.ProcessEnv): string;               // %LOCALAPPDATA%\Null\widgets; throws without LOCALAPPDATA
export class SnapshotStore {
  constructor(dir: string);
  readonly file: string;                                                     // <dir>\snapshot.json
  write(snapshot: Snapshot): void;                                           // snapshot.json.tmp then rename; throws on failure
  remove(): void;                                                            // deletes snapshot.json and a leftover .tmp; ignores missing
}
// presenceOwnership.ts
constructor(storageDir: string | undefined, log?: LogFn, claimFile?: string)   // default 'discord-presence-owner.json'
```

- [ ] **Step 1: Write the failing tests**

`widgetStore.test.ts`:

```ts
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { SnapshotStore, widgetsDir } from './widgetStore';
import { Snapshot } from './widgetTypes';

const snap = (writtenAt: string): Snapshot => ({ schema: 1, writtenAt,
  projects: { status: 'ok', failed: [], items: [] }, issues: { status: 'ok', failed: [], items: [] }, prs: { status: 'ok', failed: [], items: [] } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-widgets-'));

test('write creates the folder, leaves no .tmp behind and round-trips', () => {
  const dir = path.join(tmp(), 'Null', 'widgets');
  const store = new SnapshotStore(dir);
  store.write(snap('2026-10-21T14:00:00Z'));
  assert.deepStrictEqual(fs.readdirSync(dir), ['snapshot.json']);
  assert.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, '2026-10-21T14:00:00Z');
});

test('a second write replaces the first atomically (same file name, no partial state visible)', () => {
  const store = new SnapshotStore(tmp());
  store.write(snap('a')); store.write(snap('b'));
  assert.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, 'b');
});

test('remove deletes the snapshot and a stale .tmp, and is fine when nothing exists', () => {
  const dir = tmp();
  const store = new SnapshotStore(dir);
  store.remove();
  fs.writeFileSync(path.join(dir, 'snapshot.json'), '{}');
  fs.writeFileSync(path.join(dir, 'snapshot.json.tmp'), '{');
  store.remove();
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('widgetsDir needs LOCALAPPDATA', () => {
  assert.strictEqual(widgetsDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } as NodeJS.ProcessEnv), path.win32.join('C:\\Users\\u\\AppData\\Local', 'Null', 'widgets'));
  assert.throws(() => widgetsDir({} as NodeJS.ProcessEnv));
});
```

`presenceOwnership.test.ts` (uses a real child process for a live foreign pid and a finished one for a dead pid):

```ts
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { PresenceOwnership } from './presenceOwnership';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-own-'));
const claim = (dir: string, file: string, pid: number) => fs.writeFileSync(path.join(dir, file), JSON.stringify({ pid, focusedAt: Date.now() }));

test('the default claim file name is unchanged (Discord presence keeps working)', () => {
  const dir = tmp();
  new PresenceOwnership(dir).claim();
  assert.ok(fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
});

test('a custom claim file is used and is independent of the Discord claim', () => {
  const dir = tmp();
  const widgets = new PresenceOwnership(dir, undefined, 'widgets-owner.json');
  widgets.claim();
  assert.ok(fs.existsSync(path.join(dir, 'widgets-owner.json')) && !fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
  widgets.release();
  assert.ok(!fs.existsSync(path.join(dir, 'widgets-owner.json')));
});

test('a live foreign owner keeps ownership; a dead owner is taken over', async () => {
  const dir = tmp();
  const live = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { stdio: 'ignore' });
  try {
    claim(dir, 'widgets-owner.json', live.pid!);
    assert.strictEqual(new PresenceOwnership(dir, undefined, 'widgets-owner.json').isOwner(), false);
  } finally { live.kill(); }
  const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(r => dead.on('exit', r));
  claim(dir, 'widgets-owner.json', dead.pid!);
  const mine = new PresenceOwnership(dir, undefined, 'widgets-owner.json');
  assert.strictEqual(mine.isOwner(), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'widgets-owner.json'), 'utf8')).pid, process.pid);
});
```

Register both (`out/widgets/widgetStore.test.js`, `out/presenceOwnership.test.js`) in `package.json` and `tsconfig.json`.

- [ ] **Step 2: Run to verify failure**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL — `./widgetStore` missing; and a TS error for the 3-argument `PresenceOwnership` constructor.

- [ ] **Step 3: Implement**

`presenceOwnership.ts`: rename the constant to `DEFAULT_CLAIM_FILE`, change the constructor to
`constructor(storageDir: string | undefined, private readonly log: LogFn = () => undefined, claimFile: string = DEFAULT_CLAIM_FILE)` and use `claimFile` where `CLAIM_FILE` was (`this.file = path.join(storageDir, claimFile)`). Nothing else changes.

`widgetStore.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { Snapshot } from './widgetTypes';

/** %LOCALAPPDATA%\Null\widgets. Local (not roaming): the file is derived data and the provider is per machine. */
export function widgetsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.LOCALAPPDATA) { throw new Error('Cannot locate %LOCALAPPDATA%.'); }
  return path.win32.join(env.LOCALAPPDATA, 'Null', 'widgets');
}

export class SnapshotStore {
  readonly file: string;
  private readonly tmp: string;
  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'snapshot.json');
    this.tmp = `${this.file}.tmp`;
  }

  /** Write-then-rename, so the provider never reads a torn file. Only the owning window writes, so one fixed .tmp name is enough. */
  write(snapshot: Snapshot): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.tmp, JSON.stringify(snapshot), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }

  remove(): void {
    for (const f of [this.file, this.tmp]) {
      try { fs.unlinkSync(f); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; } }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): atomic widget snapshot store and ownership claim file (#141)"
```

---

### Task 10: Fetching per account (no `vscode` import)

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetFetch.ts`, `widgetFetch.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include

**Interfaces:**
- Consumes: `WIDGET_QUERY`, `searchStrings`, `chunkRepos`, `mapIssues`, `mapPrs`, `WidgetData`, `LocalPaths` (Task 7); `ApiError` from `../github/githubApi`; `IssueRow`, `PrRow`, `Reason`.
- Produces:

```ts
export type RepoResult =
  | { repo: string; issues: IssueRow[]; prs: PrRow[] }
  | { repo: string; reason: Reason; retryAt?: number | null };
export interface FetchDeps {
  /** Silent token for an account id, undefined when signed out. Never prompts. */
  token(accountId: string): Promise<string | undefined>;
  graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T>;
  localPaths(): LocalPaths;
}
export function classifyError(err: unknown): { reason: Reason; retryAt: number | null };
export async function fetchRepos(deps: FetchDeps, accountId: string, repos: string[]): Promise<RepoResult[]>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import { classifyError, fetchRepos, FetchDeps } from './widgetFetch';

const issue = (repo: string, n: number) => ({ number: n, title: 't', url: `https://github.com/${repo}/issues/${n}`, updatedAt: '2026-10-21T10:00:00Z',
  repository: { nameWithOwner: repo }, labels: { nodes: [] }, assignees: { nodes: [] } });
const empty = { nodes: [] };

function deps(over: Partial<FetchDeps> = {}): FetchDeps & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, token: async () => 'tok', localPaths: () => new Map(),
    graphql: (async (_q: string, vars: Record<string, unknown>) => { calls.push(vars);
      return { assigned: { nodes: [issue('a/b', 1), issue('c/d', 2)] }, mentioned: empty, authored: empty, reviewReq: empty }; }) as FetchDeps['graphql'], ...over };
}

test('no token means every repo is signed_out and nothing is requested', async () => {
  const d = deps({ token: async () => undefined });
  assert.deepStrictEqual(await fetchRepos(d, 'acc', ['a/b', 'c/d']), [{ repo: 'a/b', reason: 'signed_out' }, { repo: 'c/d', reason: 'signed_out' }]);
  assert.strictEqual(d.calls.length, 0);
});

test('one request covers the repos and rows are split back per repo (case-insensitive)', async () => {
  const d = deps();
  const out = await fetchRepos(d, 'acc', ['A/b', 'c/d', 'e/f']);
  assert.strictEqual(d.calls.length, 1);
  assert.strictEqual(d.calls[0].n, 20);
  assert.ok(String(d.calls[0].assigned).startsWith('repo:A/b repo:c/d repo:e/f '));
  assert.deepStrictEqual(out.map(r => [r.repo, 'issues' in r ? r.issues.length : -1]), [['A/b', 1], ['c/d', 1], ['e/f', 0]]);
});

test('a failing chunk marks only its repos; other chunks still succeed', async () => {
  const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
  let n = 0;
  const d = deps({ graphql: (async () => { if (n++ === 0) throw new ApiError('boom', 500); return { assigned: empty, mentioned: empty, authored: empty, reviewReq: empty }; }) as FetchDeps['graphql'] });
  const out = await fetchRepos(d, 'acc', repos);
  assert.ok(out.some(r => 'reason' in r && r.reason === 'error') && out.some(r => 'issues' in r));
  assert.strictEqual(out.length, 12);
});

test('error classification', () => {
  assert.deepStrictEqual(classifyError(new ApiError('Bad credentials', 401)), { reason: 'signed_out', retryAt: null });
  assert.deepStrictEqual(classifyError(new ApiError('rate', 403, 1234)), { reason: 'error', retryAt: 1234 });
  assert.deepStrictEqual(classifyError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), { reason: 'offline', retryAt: null });
  assert.deepStrictEqual(classifyError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), { reason: 'offline', retryAt: null });
  assert.deepStrictEqual(classifyError(new Error('whatever')), { reason: 'error', retryAt: null });
});
```

Register in `package.json`/`tsconfig.json`.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`./widgetFetch` missing).

- [ ] **Step 3: Implement**

```ts
'use strict';

import { ApiError } from '../github/githubApi';
import { WIDGET_QUERY, WidgetData, LocalPaths, chunkRepos, mapIssues, mapPrs, searchStrings } from './widgetQueries';
import { IssueRow, PrRow, Reason } from './widgetTypes';

export type RepoResult =
  | { repo: string; issues: IssueRow[]; prs: PrRow[] }
  | { repo: string; reason: Reason; retryAt?: number | null };

export interface FetchDeps {
  token(accountId: string): Promise<string | undefined>;
  graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T>;
  localPaths(): LocalPaths;
}

const OFFLINE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const PER_SEARCH = 20;                                    // comfortably above the row maxima after merging and de-duplicating

export function classifyError(err: unknown): { reason: Reason; retryAt: number | null } {
  if (err instanceof ApiError) {
    if (err.retryAt !== null) { return { reason: 'error', retryAt: err.retryAt }; }
    return { reason: err.status === 401 ? 'signed_out' : 'error', retryAt: null };
  }
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return { reason: code && OFFLINE.has(code) ? 'offline' : 'error', retryAt: null };
}

export async function fetchRepos(deps: FetchDeps, accountId: string, repos: string[]): Promise<RepoResult[]> {
  const token = await deps.token(accountId);
  if (!token) { return repos.map(repo => ({ repo, reason: 'signed_out' as const })); }
  const local = deps.localPaths();
  const results: RepoResult[] = [];
  for (const chunk of chunkRepos(repos)) {
    try {
      const data = await deps.graphql<WidgetData>(WIDGET_QUERY, { ...searchStrings(chunk), n: PER_SEARCH }, token);
      const issues = mapIssues(data, local), prs = mapPrs(data, local);
      for (const repo of chunk) {
        const key = repo.toLowerCase();
        results.push({ repo, issues: issues.filter(i => i.repo.toLowerCase() === key), prs: prs.filter(p => p.repo.toLowerCase() === key) });
      }
    } catch (err) {
      const { reason, retryAt } = classifyError(err);
      for (const repo of chunk) { results.push({ repo, reason, retryAt }); }
    }
  }
  return results;
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): per-account widget fetch with error classification (#141)"
```

---

### Task 11: The refresher — ownership, timers, backoff, disable

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetRefresher.ts`, `widgetRefresher.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include

**Interfaces:**
- Consumes: `RepoResult`, `RepoOutcome`/`buildSection`, `rankIssues`, `rankPrs`, `Snapshot`, `Section`, `ProjectRow`, `IssueRow`, `PrRow`, `WidgetRepo`, `MAX_ISSUES`, `MAX_PRS`.
- Produces:

```ts
export const REFRESH_MS = 10 * 60_000;
export const TICK_MS = 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;
export const FOCUS_REFRESH_MIN_MS = 60_000;
export interface RefresherDeps {
  now(): number;
  settings(): { enabled: boolean; repos: WidgetRepo[] };
  ownership: { isOwner(): boolean; claim(): void; release(): void };
  fetch(accountId: string, repos: string[]): Promise<RepoResult[]>;
  projects(): Promise<Section<ProjectRow>>;
  store: { write(s: Snapshot): void; remove(): void };
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  log(message: string): void;
}
export class WidgetRefresher {
  constructor(deps: RefresherDeps);
  start(): void;                       // schedules the 60 s tick
  setFocused(focused: boolean): void;  // focus: claim + refresh (throttled by FOCUS_REFRESH_MIN_MS)
  refresh(): Promise<void>;            // manual / due refresh; disabled => removes the file
  onConfigChanged(): void;             // rewrites immediately from remembered rows (no fetch), then refreshes in the background
  dispose(): void;                     // final write if this window owns the snapshot, release ownership
}
```

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import { WidgetRefresher, RefresherDeps, REFRESH_MS, TICK_MS } from './widgetRefresher';
import { IssueRow, Snapshot, WidgetRepo } from './widgetTypes';
import { RepoResult } from './widgetFetch';

const row = (repo: string, n: number): IssueRow => ({ provider: 'github', repo, number: n, title: 't', url: '', state: 'open', labels: [], assignee: null, attention: 'assigned', localPath: null, updatedAt: '2026-10-21T10:00:00Z' });

function harness(over: { enabled?: boolean; repos?: WidgetRepo[]; owner?: boolean; fetch?: RefresherDeps['fetch'] } = {}) {
  let clock = Date.parse('2026-10-21T10:00:00Z');
  const writes: Snapshot[] = [];
  const state = { enabled: over.enabled ?? true, repos: over.repos ?? [{ repo: 'a/b', account: 'x' }], owner: over.owner ?? true, removed: 0, released: 0, claimed: 0, fetches: 0 };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const deps: RefresherDeps = {
    now: () => clock,
    settings: () => ({ enabled: state.enabled, repos: state.repos }),
    ownership: { isOwner: () => state.owner, claim: () => { state.claimed++; }, release: () => { state.released++; } },
    fetch: over.fetch ?? (async (_a, repos) => { state.fetches++; return repos.map((repo): RepoResult => ({ repo, issues: [row(repo, 1)], prs: [] })); }),
    projects: async () => ({ status: 'ok', failed: [], items: [] }),
    store: { write: s => writes.push(s), remove: () => { state.removed++; } },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: () => undefined, log: () => undefined,
  };
  return { r: new WidgetRefresher(deps), writes, state, timers, advance: (ms: number) => { clock += ms; } };
}

test('disabled: removes the snapshot, never fetches or writes', async () => {
  const h = harness({ enabled: false });
  await h.r.refresh();
  assert.strictEqual(h.state.removed, 1); assert.strictEqual(h.writes.length, 0); assert.strictEqual(h.state.fetches, 0);
});

test('a non-owner window does not fetch or write', async () => {
  const h = harness({ owner: false });
  await h.r.refresh();
  assert.strictEqual(h.state.fetches, 0); assert.strictEqual(h.writes.length, 0);
});

test('an owner cycle writes ok sections with the fetched rows and an ISO timestamp', async () => {
  const h = harness();
  await h.r.refresh();
  assert.strictEqual(h.writes.length, 1);
  const s = h.writes[0];
  assert.deepStrictEqual([s.schema, s.issues.status, s.issues.items.length, s.writtenAt], [1, 'ok', 1, '2026-10-21T10:00:00.000Z']);
});

test('partial failure keeps the failed repo\'s previous rows and lists it', async () => {
  const repos = [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }];
  let call = 0;
  const h = harness({ repos, fetch: async (_a, rs) => rs.map((repo): RepoResult =>
    (call++ >= 2 && repo === 'c/d') ? { repo, reason: 'error' } : { repo, issues: [row(repo, 1)], prs: [] }) });
  await h.r.refresh(); h.advance(REFRESH_MS); await h.r.refresh();
  const s = h.writes[1];
  assert.strictEqual(s.issues.status, 'ok');
  assert.deepStrictEqual(s.issues.failed, [{ repo: 'c/d', reason: 'error' }]);
  assert.strictEqual(s.issues.items.length, 2);                                   // c/d's old row survived
});

test('signed out: rows stay, status signed_out, nothing deleted', async () => {
  let ok = true;
  const h = harness({ fetch: async (_a, rs) => rs.map((repo): RepoResult => ok ? { repo, issues: [row(repo, 1)], prs: [] } : { repo, reason: 'signed_out' }) });
  await h.r.refresh(); ok = false; h.advance(REFRESH_MS); await h.r.refresh();
  assert.deepStrictEqual([h.writes[1].issues.status, h.writes[1].issues.items.length], ['signed_out', 1]);
  assert.strictEqual(h.state.removed, 0);
});

test('a rate limit suspends fetching until retryAt', async () => {
  let fetches = 0;
  const h = harness({ fetch: async (_a, rs) => { fetches++; return rs.map((repo): RepoResult => ({ repo, reason: 'error', retryAt: Date.parse('2026-10-21T10:30:00Z') })); } });
  await h.r.refresh();
  h.advance(REFRESH_MS); await h.r.refresh();                                      // 10:10, still suspended
  assert.strictEqual(fetches, 1);
  h.advance(25 * 60_000); await h.r.refresh();                                     // 10:35
  assert.strictEqual(fetches, 2);
});

test('removing a repo rewrites at once from remembered rows, without fetching', async () => {
  const h = harness({ repos: [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }] });
  await h.r.refresh();
  const fetched = h.state.fetches;
  h.state.repos = [{ repo: 'a/b', account: 'x' }];
  h.r.onConfigChanged();
  assert.strictEqual(h.writes.at(-1)!.issues.items.length, 1);
  assert.strictEqual(h.state.fetches, fetched);
});

test('turning widgets off through a settings change deletes the file', async () => {
  const h = harness();
  await h.r.refresh();
  h.state.enabled = false;
  h.r.onConfigChanged();
  assert.strictEqual(h.state.removed, 1);
});

test('focus claims ownership and refreshes, but not more than once a minute', async () => {
  const h = harness();
  h.r.setFocused(true); await Promise.resolve(); await new Promise(r => setImmediate(r));
  assert.strictEqual(h.state.claimed, 1); const first = h.state.fetches;
  h.r.setFocused(false); h.advance(10_000); h.r.setFocused(true); await new Promise(r => setImmediate(r));
  assert.strictEqual(h.state.fetches, first);
});

test('the tick refreshes a focused owner when due and a window that just became owner', async () => {
  const h = harness({ owner: false });
  h.r.start(); h.r.setFocused(true);
  h.state.owner = true;
  h.timers.at(-1)!.fn(); await new Promise(r => setImmediate(r));
  assert.ok(h.state.fetches >= 1);
  assert.strictEqual(h.timers.at(-1)!.ms, TICK_MS);
});

test('dispose writes once more as owner and releases ownership', async () => {
  const h = harness();
  await h.r.refresh();
  h.advance(5 * 60_000);
  h.r.dispose();
  assert.strictEqual(h.writes.length, 2);
  assert.strictEqual(h.writes[1].writtenAt, '2026-10-21T10:05:00.000Z');
  assert.strictEqual(h.state.released, 1);
});

test('a fetch that throws unexpectedly does not wipe rows or crash the cycle', async () => {
  let boom = false;
  const h = harness({ fetch: async (_a, rs) => { if (boom) { throw new ApiError('x', 500); } return rs.map((repo): RepoResult => ({ repo, issues: [row(repo, 1)], prs: [] })); } });
  await h.r.refresh(); boom = true; h.advance(REFRESH_MS);
  await assert.doesNotReject(h.r.refresh());
  assert.strictEqual(h.writes.at(-1)!.issues.items.length, 1);
});
```

Register in `package.json`/`tsconfig.json`.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`./widgetRefresher` missing).

- [ ] **Step 3: Implement**

```ts
'use strict';

import { classifyError, RepoResult } from './widgetFetch';
import { RepoOutcome, buildSection } from './widgetSections';
import { rankIssues, rankPrs } from './widgetQueries';
import { IssueRow, MAX_ISSUES, MAX_PRS, PrRow, ProjectRow, SCHEMA, Section, Snapshot, WidgetRepo } from './widgetTypes';

export const REFRESH_MS = 10 * 60_000;
export const TICK_MS = 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;
export const FOCUS_REFRESH_MIN_MS = 60_000;

export interface RefresherDeps { /* exactly as listed under Interfaces */
  now(): number;
  settings(): { enabled: boolean; repos: WidgetRepo[] };
  ownership: { isOwner(): boolean; claim(): void; release(): void };
  fetch(accountId: string, repos: string[]): Promise<RepoResult[]>;
  projects(): Promise<Section<ProjectRow>>;
  store: { write(s: Snapshot): void; remove(): void };
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  log(message: string): void;
}

const empty = <T>(): Section<T> => ({ status: 'ok', failed: [], items: [] });

export class WidgetRefresher {
  private issueRows = new Map<string, IssueRow[]>();
  private prRows = new Map<string, PrRow[]>();
  private sections = { projects: empty<ProjectRow>(), issues: empty<IssueRow>(), prs: empty<PrRow>() };
  private wrote = false;
  private owner = false;
  private focused = false;
  private running = false;
  private failures = 0;
  private lastFetch = 0;
  private suspendedUntil = 0;
  private timer: unknown;

  constructor(private readonly d: RefresherDeps) {}

  start(): void { this.schedule(); }

  setFocused(focused: boolean): void {
    this.focused = focused;
    if (!focused || !this.d.settings().enabled) { return; }
    this.d.ownership.claim();
    this.owner = true;
    if (this.d.now() - this.lastFetch >= FOCUS_REFRESH_MIN_MS) { void this.refresh(); }
  }

  async refresh(): Promise<void> {
    const cfg = this.d.settings();
    if (!cfg.enabled) { this.disable(); return; }
    if (!this.d.ownership.isOwner()) { this.owner = false; return; }
    this.owner = true;
    if (this.running || this.d.now() < this.suspendedUntil) { return; }
    this.running = true;
    try {
      this.lastFetch = this.d.now();
      const byAccount = new Map<string, string[]>();
      for (const { repo, account } of cfg.repos) { byAccount.set(account, [...(byAccount.get(account) ?? []), repo]); }
      const results: RepoResult[] = [];
      for (const [account, repos] of byAccount) {
        try { results.push(...await this.d.fetch(account, repos)); }
        catch (err) { const c = classifyError(err); results.push(...repos.map(repo => ({ repo, reason: c.reason, retryAt: c.retryAt }))); }
      }
      const issues: RepoOutcome<IssueRow>[] = [], prs: RepoOutcome<PrRow>[] = [];
      let retryAt = 0;
      for (const r of results) {
        if ('reason' in r) {
          issues.push({ repo: r.repo, rows: null, reason: r.reason }); prs.push({ repo: r.repo, rows: null, reason: r.reason });
          retryAt = Math.max(retryAt, r.retryAt ?? 0);
        } else {
          issues.push({ repo: r.repo, rows: r.issues }); prs.push({ repo: r.repo, rows: r.prs });
        }
      }
      const i = buildSection(issues, this.issueRows, rankIssues, MAX_ISSUES), p = buildSection(prs, this.prRows, rankPrs, MAX_PRS);
      this.issueRows = i.kept; this.prRows = p.kept;
      this.sections.issues = i.section; this.sections.prs = p.section;
      const allFailed = results.length > 0 && results.every(r => 'reason' in r);
      this.failures = allFailed ? this.failures + 1 : 0;
      if (retryAt > 0) { this.suspendedUntil = retryAt; }
      try { this.sections.projects = await this.d.projects(); } catch (err) { this.d.log(`projects: ${(err as Error).message}`); }
      this.write();
    } finally { this.running = false; }
  }

  onConfigChanged(): void {
    const cfg = this.d.settings();
    if (!cfg.enabled) { this.disable(); return; }
    const keep = new Set(cfg.repos.map(r => r.repo.toLowerCase()));
    for (const k of [...this.issueRows.keys()]) { if (!keep.has(k)) { this.issueRows.delete(k); } }
    for (const k of [...this.prRows.keys()]) { if (!keep.has(k)) { this.prRows.delete(k); } }
    this.sections.issues = { ...this.sections.issues, items: rankIssues([...this.issueRows.values()].flat()).slice(0, MAX_ISSUES), failed: this.sections.issues.failed.filter(f => keep.has(f.repo.toLowerCase())) };
    this.sections.prs = { ...this.sections.prs, items: rankPrs([...this.prRows.values()].flat()).slice(0, MAX_PRS), failed: this.sections.prs.failed.filter(f => keep.has(f.repo.toLowerCase())) };
    if (this.wrote && this.d.ownership.isOwner()) { this.write(); }
    void this.refresh();
  }

  dispose(): void {
    if (this.timer) { this.d.clearTimeout(this.timer); this.timer = undefined; }
    if (this.owner && this.wrote && this.d.settings().enabled) { try { this.write(); } catch (err) { this.d.log(`final write: ${(err as Error).message}`); } }
    this.d.ownership.release();
  }

  private disable(): void {
    this.d.store.remove();
    this.wrote = false;
    this.d.ownership.release();
    this.owner = false;
  }

  private write(): void {
    this.d.store.write({ schema: SCHEMA, writtenAt: new Date(this.d.now()).toISOString(), ...this.sections });
    this.wrote = true;
  }

  private nextDelay(): number {
    const base = this.failures > 0 ? Math.min(REFRESH_MS * 2 ** this.failures, MAX_BACKOFF_MS) : REFRESH_MS;
    return Math.max(base, this.suspendedUntil - this.d.now());
  }

  private schedule(): void {
    this.timer = this.d.setTimeout(() => void this.tick(), TICK_MS);
  }

  private async tick(): Promise<void> {
    try {
      if (this.d.settings().enabled) {
        const was = this.owner;
        this.owner = this.d.ownership.isOwner();
        const due = this.d.now() - this.lastFetch >= this.nextDelay();
        if (this.owner && (!was || (this.focused && due))) { await this.refresh(); }
      }
    } catch (err) { this.d.log(`tick: ${(err as Error).message}`); }
    this.schedule();
  }
}
```

Run the tests; adjust only implementation details that the test names require (e.g. the focus throttle compares against `lastFetch`, which starts at 0, so the first focus always refreshes).

- [ ] **Step 4: Run to verify it passes** — `cd extensions/null-tools && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): widget refresher with ownership, backoff and disable (#141)"
```

---

### Task 12: VS Code glue — settings, setup flow, commands, Features entry

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetSetup.ts`, `widgetSetup.test.ts` (pure)
- Create: `extensions/null-tools/src/widgets/widgetIntegration.ts` (the only `vscode` file)
- Modify: `extensions/null-tools/src/extension.ts` (import + `registerWidgetsFeature(context);` next to `registerWorkflowsFeature`)
- Modify: `extensions/null-tools/package.json` (settings, commands, `nullWorkspace.features` entry, test list), `tsconfig.json`
- Modify: `extensions/null-tools/src/featureManifests.test.ts` (expected `setup` list)
- Modify: `extensions/null-tools/CLAUDE.md` (a new table row)

**Interfaces:**
- Consumes: everything from Tasks 7–11; `computeGitStatuses` (`../dashboardGitStatus`), `readRecentProjects`/`getRecentProjectsFilePath` (`../recentProjects`), `parseGithubRemote` (`../github/githubRemote`), `requestGraphql`/`requestJson` (`../github/githubApi`), `PresenceOwnership` (Task 9).
- Produces (`widgetSetup.ts`, pure):

```ts
export function mergeRepos(existing: WidgetRepo[], accountId: string, picked: string[]): WidgetRepo[];  // replaces only that account's entries
export function repoChoices(raw: unknown): string[];                      // GET /user/repos JSON -> valid "owner/name" list (REPO_RE-checked)
export function localPathsFrom(remotes: ReadonlyMap<string, string | null>): Map<string, string>;       // path -> "owner/repo" remote map => lowercase repo -> path (first wins)
```

- [ ] **Step 1: Write the failing tests for the pure helpers**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { localPathsFrom, mergeRepos, repoChoices } from './widgetSetup';

test('mergeRepos replaces only the chosen account\'s entries and keeps order stable', () => {
  const existing = [{ repo: 'a/b', account: 'x' }, { repo: 'k/l', account: 'y' }];
  assert.deepStrictEqual(mergeRepos(existing, 'x', ['c/d', 'a/b']), [{ repo: 'k/l', account: 'y' }, { repo: 'c/d', account: 'x' }, { repo: 'a/b', account: 'x' }]);
  assert.deepStrictEqual(mergeRepos(existing, 'x', []), [{ repo: 'k/l', account: 'y' }]);
  assert.deepStrictEqual(mergeRepos(existing, 'x', ['bad repo', '../x', 'ok/ok']), [{ repo: 'k/l', account: 'y' }, { repo: 'ok/ok', account: 'x' }]);
});

test('repoChoices reads full_name and ignores everything unusable', () => {
  assert.deepStrictEqual(repoChoices([{ full_name: 'o/r' }, { full_name: 'x y/z' }, {}, null, 'nope', { full_name: 'o/r2' }]), ['o/r', 'o/r2']);
  assert.deepStrictEqual(repoChoices({}), []);
});

test('localPathsFrom maps a remote repo to the first checkout, case-insensitively', () => {
  const m = localPathsFrom(new Map([['D:\\one', 'Owner/Repo'], ['D:\\two', 'owner/repo'], ['D:\\three', null]]));
  assert.deepStrictEqual([...m], [['owner/repo', 'D:\\one']]);
});
```

Register the test file.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`./widgetSetup` missing).

- [ ] **Step 3: Implement `widgetSetup.ts`**

```ts
'use strict';

import { REPO_RE, WidgetRepo, parseRepos } from './widgetTypes';

export function mergeRepos(existing: WidgetRepo[], accountId: string, picked: string[]): WidgetRepo[] {
  const others = existing.filter(e => e.account !== accountId);
  return parseRepos([...others, ...picked.map(repo => ({ repo, account: accountId }))]);
}

export function repoChoices(raw: unknown): string[] {
  if (!Array.isArray(raw)) { return []; }
  return raw.map(r => (r as { full_name?: unknown } | null)?.full_name).filter((n): n is string => typeof n === 'string' && REPO_RE.test(n));
}

export function localPathsFrom(remotes: ReadonlyMap<string, string | null>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [dir, repo] of remotes) { if (repo && !out.has(repo.toLowerCase())) { out.set(repo.toLowerCase(), dir); } }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: `package.json` contributions**

Add under `contributes.commands`:

```json
{ "command": "null.widgets.setup", "title": "Null: Set Up Widgets", "icon": "$(layout)" },
{ "command": "null.widgets.refresh", "title": "Null: Refresh Widgets", "icon": "$(refresh)" }
```

Under `nullWorkspace.features` (category `setup`, sorts after Formatting Settings):

```json
{ "id": "widgets", "label": "Windows Widgets", "category": "setup", "icon": "layout",
  "command": "null.widgets.setup", "description": "Pin Projects, Issues and PRs to the Win11 Widgets Board", "order": 40 }
```

Under `contributes.configuration.properties`:

```json
"null.widgets.enabled": {
  "type": "boolean", "default": false, "scope": "application",
  "description": "Write the data the Windows 11 Widgets Board widgets show (Projects, Issues, Pull Requests) to %LOCALAPPDATA%\\Null\\widgets\\snapshot.json while Null IDE runs. Issue and pull request titles from the repositories you choose, including private ones, appear on the Widgets Board and in that file. Turning this off deletes the file. Use \"Null: Set Up Widgets\" to turn it on."
},
"null.widgets.repos": {
  "type": "array", "default": [], "scope": "application",
  "items": { "type": "object", "properties": { "repo": { "type": "string" }, "account": { "type": "string" } }, "required": ["repo", "account"] },
  "description": "Repositories (owner/name, with the Null account id they were picked under) whose issues and pull requests the widgets show. Written by \"Null: Set Up Widgets\". Private issue and pull request titles appear on the Windows 11 Widgets Board."
}
```

Update `featureManifests.test.ts`: the `setup` entry becomes `['Null Setup', 'Environment Check', 'Actions Settings', 'Formatting Settings', 'Windows Widgets']`.

- [ ] **Step 6: Write `widgetIntegration.ts`**

```ts
'use strict';

import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { nullDataDir } from '../dataDir';
import { computeGitStatuses, GitStatus } from '../dashboardGitStatus';
import { requestGraphql, requestJson } from '../github/githubApi';
import { parseGithubRemote } from '../github/githubRemote';
import { PresenceOwnership } from '../presenceOwnership';
import { getRecentProjectsFilePath, readRecentProjects } from '../recentProjects';
import { fetchRepos } from './widgetFetch';
import { WidgetRefresher } from './widgetRefresher';
import { buildProjects } from './widgetSections';
import { localPathsFrom, mergeRepos, repoChoices } from './widgetSetup';
import { SnapshotStore, widgetsDir } from './widgetStore';
import { WidgetRepo, parseRepos } from './widgetTypes';

/** The slice of null-accounts' API used here (a structural copy, as in githubSession.ts). */
interface AccountsApi {
  getAccounts(): Array<{ id: string; provider: string; username: string; host: string }>;
  getToken(account: { id: string; provider: string; username: string; host: string }, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
}
const accountsApi = (): AccountsApi | undefined => vscode.extensions.getExtension<AccountsApi>('null.null-accounts')?.exports;

const gitRemote = (cwd: string): Promise<string | null> => new Promise(resolve =>
  execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000 }, (err, out) => {
    const ref = err ? null : parseGithubRemote(out);
    resolve(ref ? `${ref.owner}/${ref.repo}` : null);
  }));

const settings = (): { enabled: boolean; repos: WidgetRepo[] } => {
  const c = vscode.workspace.getConfiguration('null.widgets');
  return { enabled: c.get<boolean>('enabled', false), repos: parseRepos(c.get<unknown>('repos', [])) };
};

export function registerWidgetsFeature(context: vscode.ExtensionContext): void {
  const supported = process.platform === 'win32';
  const notSupported = (): void => void vscode.window.showInformationMessage('Windows widgets are only available on Windows 11.');
  const out = vscode.window.createOutputChannel('Null Widgets');
  const log = (m: string): void => out.appendLine(m);

  const setup = async (): Promise<void> => {
    if (!supported) { notSupported(); return; }
    const api = accountsApi();
    const accounts = api?.getAccounts().filter(a => a.provider === 'github') ?? [];
    if (!api || accounts.length === 0) {
      void vscode.window.showWarningMessage('Add a GitHub account first (Null: Accounts), then run Set Up Widgets again.');
      return;
    }
    const account = accounts.length === 1 ? accounts[0]
      : (await vscode.window.showQuickPick(accounts.map(a => ({ label: a.username, description: a.host, a })), { title: 'Widgets: pick an account' }))?.a;
    if (!account) { return; }
    const token = await api.getToken(account, ['repo'], { interactive: true });
    if (!token) { return; }
    let names: string[];
    try {
      names = repoChoices(await requestJson<unknown>('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token));
    } catch (err) { void vscode.window.showErrorMessage(`Could not list repositories: ${(err as Error).message}`); return; }
    const chosen = new Set(settings().repos.filter(r => r.account === account.id).map(r => r.repo.toLowerCase()));
    const picked = await vscode.window.showQuickPick(names.map(label => ({ label, picked: chosen.has(label.toLowerCase()) })), {
      canPickMany: true, title: 'Widgets: repositories for Issues and Pull Requests',
      placeHolder: 'Private issue and pull request titles will appear on the Windows Widgets Board. Pick none for Projects only.',
    });
    if (!picked) { return; }
    const cfg = vscode.workspace.getConfiguration('null.widgets');
    await cfg.update('repos', mergeRepos(settings().repos, account.id, picked.map(p => p.label)), vscode.ConfigurationTarget.Global);
    await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage('Widgets are set up. Pin Projects, Issues or Pull Requests from the Windows Widgets Board (Win+W). If they are not listed, enable "Windows widgets" in Null: Setup.');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('null.widgets.setup', setup),
    vscode.commands.registerCommand('null.widgets.refresh', async () => {
      if (!supported) { notSupported(); return; }
      if (!settings().enabled) { void vscode.window.showInformationMessage('Run "Null: Set Up Widgets" first.'); return; }
      await refresher?.refresh();
    }),
    out,
  );
  if (!supported) { return; }

  let dir: string;
  try { dir = widgetsDir(); } catch (err) { log(`disabled: ${(err as Error).message}`); return; }
  const store = new SnapshotStore(dir);
  const ownership = new PresenceOwnership(dir, log, 'widgets-owner.json');
  const api = (): AccountsApi | undefined => accountsApi();

  const refresher: WidgetRefresher | undefined = new WidgetRefresher({
    now: Date.now,
    settings,
    ownership,
    store,
    fetch: async (accountId, repos) => {
      const a = api(); const account = a?.getAccounts().find(x => x.id === accountId);
      return fetchRepos({
        token: async () => (a && account ? a.getToken(account, ['repo'], { interactive: false }) : undefined),
        graphql: requestGraphql as never,
        localPaths: () => cachedLocal,
      }, accountId, repos);
    },
    projects: async () => {
      const entries = readRecentProjects(getRecentProjectsFilePath());
      const dirs = entries.filter(e => !e.isWorkspaceFile).map(e => e.path);
      const statuses = new Map<string, GitStatus | null>();
      await computeGitStatuses(dirs.slice(0, 20), (p, s) => statuses.set(p, s));
      const remotes = new Map<string, string | null>();
      await computeGitStatuses<string>(dirs, (p, r) => remotes.set(p, r), 4, gitRemote);
      cachedLocal = localPathsFrom(remotes);
      return buildProjects(entries, statuses);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as NodeJS.Timeout),
    log,
  });
  let cachedLocal: ReadonlyMap<string, string> = new Map();

  refresher.start();
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(s => refresher.setFocused(s.focused)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('null.widgets')) { refresher.onConfigChanged(); } }),
    { dispose: () => refresher.dispose() },
  );
  if (vscode.window.state.focused) { refresher.setFocused(true); }
  void nullDataDir; // (kept for symmetry with other features; ownership lives next to the snapshot)
}
```

Clean-ups to apply while compiling: `refresher` is used inside the `refresh` command before it is assigned — declare `let refresher: WidgetRefresher | undefined;` above the `context.subscriptions.push(...)` call and assign it later (the optional chaining already handles the unset case); delete the `nullDataDir` import and the `void nullDataDir` line (they were a leftover); `graphql: requestGraphql as never` must be replaced with a correct adapter: `graphql: (q, v, token) => requestGraphql(q, v, token)`.

In `extension.ts`: `import { registerWidgetsFeature } from './widgets/widgetIntegration';` and call `registerWidgetsFeature(context);` after `registerWorkflowsFeature(context);`.

- [ ] **Step 7: Build and run everything**

Run: `cd extensions/null-tools && npm run compile && npm test`
Expected: compiles; all tests pass, including `featureManifests` (new `Windows Widgets` entry, command exists).

- [ ] **Step 8: Verify in a real IDE**

Use the `verify-local` skill (`/verify-local null-tools`) to sync into the installed Null IDE, then on Windows: run **Null: Set Up Widgets** (account → repos), confirm `%LOCALAPPDATA%\Null\widgets\snapshot.json` appears with real issues/PRs and projects; open a second Null IDE window and focus each — only the focused one rewrites the file (`widgets-owner.json` pid changes); set `null.widgets.enabled` to `false` → the file disappears; sign the account out in null-accounts → rows stay with `status: signed_out`.

- [ ] **Step 9: Docs**

Add a row to the table in `extensions/null-tools/CLAUDE.md`: **Windows widgets** — `src/widgets/` (#141): the only fetcher/writer of `%LOCALAPPDATA%\Null\widgets\snapshot.json`; `null.widgets.enabled` (off by default) and `null.widgets.repos`; `Null: Set Up Widgets` / `Null: Refresh Widgets`; one writer window through `PresenceOwnership` with `widgets-owner.json`; pure `widgetQueries` / `widgetSections` / `widgetSetup`, `widgetRefresher` has injected deps, only `widgetIntegration` imports `vscode`; design `docs/specs/native-windows-widgets-design.md`, plan `docs/plans/native-windows-widgets.md`.

- [ ] **Step 10: Commit**

```bash
git add extensions/null-tools
git commit -m "feat(null-tools): Null: Set Up Widgets, refresh command and snapshot writer wiring (#141)"
```

---

### Task 13: null-setup — generalise the `System` trait for a second package

**Files:**
- Modify: `setup/core/src/shell/mod.rs` (trait), `setup/core/src/shell/sys.rs` (`WinSystem`), `setup/core/src/shell/win11.rs`
- Modify: `setup/core/tests/support/mod.rs` (`FakeSystem`)
- Modify: `setup/core/src/procs.rs` (`stop_named_under`) and its test file `setup/core/tests/procs.rs`

**Interfaces:**
- Produces (`System` trait changes):

```rust
fn appx_installed(&self, name: &str) -> Result<Option<String>>;     // was: no parameter (hard-wired to NullIDE.ExplorerCommand)
fn windows_build(&self) -> u32;                                      // 0 when unknown
/// Force-ends null_widgets.exe processes running from `install`; true when none is left.
fn stop_widgets_provider(&self, install: &Path) -> bool;
// win11.rs
pub const PACKAGE: &str = "NullIDE.ExplorerCommand";
// procs.rs
pub fn stop_named_under(dir: &Path, name: &str) -> bool;
```

`FakeSystem` gains `pub widgets_package: RefCell<Option<String>>`, `pub build: Cell<u32>` (default 0 — set it in tests), `pub provider_stuck: Cell<bool>`; `appx_installed(name)` returns `widgets_package` for `"NullIDE.Widgets"`, the web-experience entry for `"MicrosoftWindows.Client.WebExperience"` (new field `pub web_experience: Cell<bool>`) and `package` otherwise; `appx_add(appx, _)` routes to `widgets_package` when `appx.file_name()` is `null-widgets.appx`; `appx_remove` clears whichever slot holds that full name; `stop_widgets_provider` pushes the call `"stop_provider"` and returns `!provider_stuck`.

- [ ] **Step 1: Write the failing test for `stop_named_under`**

Append to `setup/core/tests/procs.rs` (read the file first and match its imports):

```rust
#[test]
fn stop_named_under_ends_only_the_named_process_inside_the_folder() {
    use std::{fs, process::Command, thread, time::Duration};
    let dir = tempfile::tempdir().unwrap();
    // ping.exe is a long-running console program that does not depend on its own location.
    let ping = std::path::Path::new(&std::env::var("SystemRoot").unwrap()).join("System32").join("PING.EXE");
    let target = dir.path().join("null_widgets.exe");
    let other = dir.path().join("other.exe");
    fs::copy(&ping, &target).unwrap();
    fs::copy(&ping, &other).unwrap();
    let mut a = Command::new(&target).args(["-n", "60", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
    let mut b = Command::new(&other).args(["-n", "60", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
    thread::sleep(Duration::from_millis(300));

    assert!(null_setup_core::procs::stop_named_under(dir.path(), "null_widgets.exe"));
    assert!(a.try_wait().unwrap().is_some(), "the named process is gone");
    assert!(b.try_wait().unwrap().is_none(), "the other process in the same folder is untouched");
    let _ = b.kill();
    assert!(null_setup_core::procs::stop_named_under(dir.path(), "null_widgets.exe"), "nothing to stop is success");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd setup && cargo test -p null-setup-core --test procs stop_named_under`
Expected: FAIL — no function `stop_named_under`.

- [ ] **Step 3: Implement `stop_named_under`**

Append to `setup/core/src/procs.rs`:

```rust
/// Force-ends the processes called `name` that run from `dir`. A COM server such as `null_widgets.exe` has no window,
/// so the polite `WM_CLOSE` pass of `close_all` would never end it. Returns true when none is left.
pub fn stop_named_under(dir: &Path, name: &str) -> bool {
    let pids = || -> Vec<u32> {
        running_in(dir).into_iter().filter(|r| r.name.eq_ignore_ascii_case(name)).map(|r| r.pid).collect()
    };
    let found = pids();
    if found.is_empty() {
        return true;
    }
    force_close(&found);
    for _ in 0..10 {
        thread::sleep(Duration::from_millis(300));
        if pids().is_empty() {
            return true;
        }
    }
    false
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd setup && cargo test -p null-setup-core --test procs`
Expected: PASS.

- [ ] **Step 5: Change the trait, `WinSystem`, `win11.rs` and `FakeSystem`**

`shell/mod.rs` trait: replace `fn appx_installed(&self) -> Result<Option<String>>;` with the three signatures above (keep the doc comments).

`shell/sys.rs`: delete `const PACKAGE`; change `appx_installed`:

```rust
fn appx_installed(&self, name: &str) -> Result<Option<String>> {
    let o = powershell(&format!("(Get-AppxPackage -Name '{}' -ErrorAction SilentlyContinue | Select-Object -First 1).PackageFullName", name.replace('\'', "''")))
        .map_err(|e| Error::Other(format!("could not start PowerShell: {e}")))?;
    let full = String::from_utf8_lossy(&o.stdout).trim().to_string();
    Ok((!full.is_empty()).then_some(full))
}

fn windows_build(&self) -> u32 {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

fn stop_widgets_provider(&self, install: &Path) -> bool {
    crate::procs::stop_named_under(install, "null_widgets.exe")
}
```

`shell/win11.rs`: add `pub const PACKAGE: &str = "NullIDE.ExplorerCommand";` and change both `sys.appx_installed()?` calls and the one in `unregister` to `sys.appx_installed(PACKAGE)?`.

`tests/support/mod.rs` `FakeSystem`: add the fields and replace `appx_installed`/`appx_remove`/`appx_add` as described under **Interfaces** (default `build` 0; keep `Default` derive working — `Cell<u32>` and `Cell<bool>` implement `Default`). Concretely:

```rust
pub widgets_package: RefCell<Option<String>>,
pub web_experience: Cell<bool>,
pub build: Cell<u32>,
pub provider_stuck: Cell<bool>,
// …
fn appx_installed(&self, name: &str) -> null_setup_core::Result<Option<String>> {
    Ok(match name {
        "NullIDE.Widgets" => self.widgets_package.borrow().clone(),
        "MicrosoftWindows.Client.WebExperience" => self.web_experience.get().then(|| "MicrosoftWindows.Client.WebExperience_1".to_string()),
        _ => self.package.borrow().clone(),
    })
}
fn appx_remove(&self, f: &str) -> null_setup_core::Result<()> {
    self.calls.borrow_mut().push(format!("appx_remove:{f}"));
    if self.package.borrow().as_deref() == Some(f) { *self.package.borrow_mut() = None; }
    if self.widgets_package.borrow().as_deref() == Some(f) { *self.widgets_package.borrow_mut() = None; }
    Ok(())
}
fn appx_add(&self, appx: &Path, _: &Path) -> AppxAdd {
    let widgets = appx.file_name().is_some_and(|n| n == "null-widgets.appx");
    self.calls.borrow_mut().push(if widgets { "appx_add:widgets".into() } else { "appx_add".into() });
    let mut q = self.adds.borrow_mut();
    let r = if q.len() > 1 { q.remove(0) } else { q.first().cloned().unwrap_or(AppxAdd::Added) };
    if r == AppxAdd::Added {
        if widgets { *self.widgets_package.borrow_mut() = Some("NullIDE.Widgets_1_x64".into()); }
        else { *self.package.borrow_mut() = Some("NullIDE.ExplorerCommand_1_x64".into()); }
    }
    r
}
fn windows_build(&self) -> u32 { self.build.get() }
fn stop_widgets_provider(&self, _: &Path) -> bool { self.calls.borrow_mut().push("stop_provider".into()); !self.provider_stuck.get() }
```

Note the changed call name for the widgets add (`appx_add:widgets`) — the existing win11 tests assert plain `"appx_add"` for the context-menu package, so they stay green.

- [ ] **Step 6: Run the whole suite**

Run: `cd setup && cargo test -p null-setup-core -p null-setup`
Expected: PASS (no behaviour change for the existing package).

- [ ] **Step 7: Commit**

```bash
git add setup
git commit -m "refactor(setup): System trait handles a second package and can stop the provider (#141)"
```

---

### Task 14: null-setup — `Feature::Widgets` and `shell::widgets`

**Files:**
- Modify: `setup/core/src/install_config.rs`, `setup/core/tests/install_config.rs`
- Create: `setup/core/src/shell/widgets.rs`, `setup/core/tests/shell_widgets.rs`
- Modify: `setup/core/src/shell/mod.rs` (module, `Locations.local_data`, `register_one`/`unregister_one` arms)
- Modify: `setup/core/tests/support/mod.rs` (`Hive::new` fills `local_data`)
- Modify: `setup/core/tests/shell_apply.rs` (the `Feature::ALL` tests)

**Interfaces:**
- Produces:

```rust
// install_config.rs
Feature::Widgets;                          // name "widgets", follows_install() == true, Feature::ALL has 8 entries (Widgets last)
InstallConfig.widgets: bool;               // serde "widgets", default false (opt-in)
// shell/mod.rs
Locations.local_data: PathBuf;             // %LOCALAPPDATA% (tests: a temp folder)
sys::KnownFolder::LocalAppData
// shell/widgets.rs
pub const PACKAGE: &str = "NullIDE.Widgets";
pub const WEB_EXPERIENCE: &str = "MicrosoftWindows.Client.WebExperience";
pub const MIN_BUILD: u32 = 22621;          // Task 1's findings doc is the source; change here if it says otherwise
pub enum Widgets { Registered, Kept, NeedsReapproval, Unsupported(String), Missing(String) }
pub fn supported(sys: &dyn System) -> std::result::Result<(), String>;      // Err(reason) when the host cannot show widgets
pub fn register(loc: &Locations, sys: &dyn System, install: &Path, allow_elevate: bool) -> Result<Widgets>;
pub fn unregister(loc: &Locations, sys: &dyn System, install: &Path) -> Result<()>;
```

- [ ] **Step 1: Write the failing tests**

Update `tests/install_config.rs`:
- `defaults_match_the_inno_task_defaults`: add `assert!(!c.widgets, "widgets are opt-in");`.
- `only_the_install_path_bound_features_follow_an_update`: expected becomes `vec![Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler, Feature::Widgets]`.
- Add:

```rust
#[test]
fn widgets_is_opt_in_round_trips_and_an_older_file_reads_as_off() {
    assert_eq!(Feature::Widgets.name(), "widgets");
    assert_eq!(Feature::ALL.len(), 8);
    assert!(!InstallConfig::default().enabled().contains(&Feature::Widgets));
    let c = ic::from_json(r#"{"schema":1,"path":false}"#).unwrap();
    assert!(!c.widgets);
    let on = InstallConfig { widgets: true, ..Default::default() };
    assert_eq!(InstallConfig::default().added_features(&on), vec![Feature::Widgets]);
    assert_eq!(on.removed_features(&InstallConfig::default()), vec![Feature::Widgets]);
    let tmp = tempfile::tempdir().unwrap();
    ic::write(tmp.path(), &on).unwrap();
    assert!(ic::read(tmp.path()).unwrap().widgets);
}
```

Create `tests/shell_widgets.rs`:

```rust
mod support;

use std::fs;

use null_setup_core::shell::{widgets::*, AppxAdd};
use support::{FakeSystem, Hive};

fn install(h: &Hive, with_appx: bool) -> std::path::PathBuf {
    let dir = h.tmp.path().join("Null IDE ünï");
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    if with_appx {
        fs::write(dir.join("shell-ext").join("null-widgets.appx"), "x").unwrap();
        fs::write(dir.join("shell-ext").join("NullIDECert.cer"), "x").unwrap();
    }
    dir
}

fn ready() -> FakeSystem {
    let sys = FakeSystem::default();
    sys.build.set(MIN_BUILD);
    sys.web_experience.set(true);
    sys
}

#[test]
fn the_host_check_needs_the_build_floor_and_the_web_experience_package() {
    let sys = ready();
    assert!(supported(&sys).is_ok());
    sys.build.set(MIN_BUILD - 1);
    assert!(supported(&sys).unwrap_err().contains("build"));
    sys.build.set(MIN_BUILD);
    sys.web_experience.set(false);
    assert!(supported(&sys).unwrap_err().contains("Widgets"));
}

#[test]
fn an_unsupported_host_registers_nothing_and_is_not_an_error() {
    let h = Hive::new();
    let sys = FakeSystem::default(); // build 0, no WebExperience
    let r = register(&h.loc, &sys, &install(&h, true), true).unwrap();
    assert!(matches!(r, Widgets::Unsupported(_)));
    assert!(sys.calls.borrow().is_empty(), "{:?}", sys.calls.borrow());
}

#[test]
fn a_missing_package_file_is_reported_and_nothing_is_touched() {
    let h = Hive::new();
    let sys = ready();
    let r = register(&h.loc, &sys, &install(&h, false), true).unwrap();
    assert!(matches!(r, Widgets::Missing(m) if m.contains("null-widgets.appx")));
    assert!(sys.calls.borrow().is_empty());
}

#[test]
fn a_fresh_install_trusts_the_certificate_after_the_first_add_is_refused() {
    let h = Hive::new();
    let sys = ready();
    *sys.adds.borrow_mut() = vec![AppxAdd::UntrustedRoot, AppxAdd::Added];
    assert_eq!(register(&h.loc, &sys, &install(&h, true), true).unwrap(), Widgets::Registered);
    assert_eq!(*sys.calls.borrow(), ["cert_user", "stop_provider", "appx_add:widgets", "cert_machine", "appx_add:widgets"]);
    assert_eq!(sys.widgets_package.borrow().as_deref(), Some("NullIDE.Widgets_1_x64"));
}

#[test]
fn an_update_with_an_untrusted_certificate_keeps_the_existing_registration() {
    let h = Hive::new();
    let sys = ready();
    *sys.widgets_package.borrow_mut() = Some("NullIDE.Widgets_old".into());
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Widgets::Kept);
    assert!(sys.calls.borrow().is_empty());
    assert_eq!(sys.widgets_package.borrow().as_deref(), Some("NullIDE.Widgets_old"));
}

#[test]
fn an_update_with_an_untrusted_certificate_and_no_package_asks_for_reapproval() {
    let h = Hive::new();
    let sys = ready();
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Widgets::NeedsReapproval);
    assert!(sys.calls.borrow().is_empty());
}

#[test]
fn a_trusted_certificate_replaces_the_package_without_elevating_and_without_touching_explorer() {
    let h = Hive::new();
    let sys = ready();
    sys.machine_trusted.set(true);
    *sys.widgets_package.borrow_mut() = Some("OLD".into());
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Widgets::Registered);
    assert_eq!(*sys.calls.borrow(), ["cert_user", "stop_provider", "appx_remove:OLD", "appx_add:widgets"]);
}

#[test]
fn a_provider_that_cannot_be_stopped_keeps_the_current_registration() {
    let h = Hive::new();
    let sys = ready();
    sys.machine_trusted.set(true);
    sys.provider_stuck.set(true);
    *sys.widgets_package.borrow_mut() = Some("OLD".into());
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Widgets::Kept);
    assert_eq!(sys.count("appx_remove:OLD"), 0);
    assert_eq!(sys.count("appx_add:widgets"), 0);
}

#[test]
fn a_declined_uac_prompt_keeps_the_existing_package() {
    let h = Hive::new();
    let sys = ready();
    *sys.widgets_package.borrow_mut() = Some("OLD".into());
    *sys.elevated.borrow_mut() = Some(Err("Could not install the shell extension certificate (exit 1223)".into()));
    assert!(register(&h.loc, &sys, &install(&h, true), true).is_err());
    assert_eq!(sys.widgets_package.borrow().as_deref(), Some("OLD"));
    assert_eq!(sys.count("appx_add:widgets"), 0);
}

#[test]
fn the_cmdlet_message_survives_when_adding_fails() {
    let h = Hive::new();
    let sys = ready();
    *sys.adds.borrow_mut() = vec![AppxAdd::Failed("0x80073CF9 deployment failed".into())];
    let e = register(&h.loc, &sys, &install(&h, true), true).unwrap_err().to_string();
    assert!(e.contains("Widgets registration failed") && e.contains("0x80073CF9"), "{e}");
}

#[test]
fn unregister_stops_the_provider_removes_the_package_and_deletes_the_snapshot_folder() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.widgets_package.borrow_mut() = Some("P".into());
    let dir = h.loc.local_data.join("Null").join("widgets");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("snapshot.json"), "{}").unwrap();
    unregister(&h.loc, &sys, &install(&h, true)).unwrap();
    assert_eq!(*sys.calls.borrow(), ["stop_provider", "appx_remove:P"]);
    assert!(!dir.exists());
    unregister(&h.loc, &sys, &install(&h, true)).unwrap(); // nothing registered, nothing on disk: fine
}
```

In `tests/shell_apply.rs` the test `registers_every_feature_into_the_scratch_locations` (uses `Feature::ALL` on a `FakeSystem::default()`) must still pass: with build 0 the widgets feature is `Unsupported` and logs only. Add one assertion to it: `assert_eq!(sys.count("appx_add:widgets"), 0);`.

- [ ] **Step 2: Run to verify failure**

Run: `cd setup && cargo test -p null-setup-core`
Expected: FAIL — compile errors (`Feature::Widgets`, `widgets`, `local_data`).

- [ ] **Step 3: Implement `install_config.rs`**

Add `Widgets` to `Feature` (last), to `ALL` (`[Feature; 8]`), `name()` → `"widgets"`, `follows_install()` → add `| Feature::Widgets`, a `pub widgets: bool` field (default `false`, with the other flags in `Default`), and `Feature::Widgets => self.widgets` in `has`.

- [ ] **Step 4: Implement `Locations.local_data` and the known folder**

`shell/mod.rs`: add `pub local_data: PathBuf` to `Locations` (doc: "`%LOCALAPPDATA%`; tests use a scratch folder"), `pub mod widgets;`, and in `Locations::real()` `local_data: sys::known_folder(sys::KnownFolder::LocalAppData)?`. `shell/sys.rs`: add `LocalAppData` to `KnownFolder` and `FOLDERID_LocalAppData` to the `use` and the `match`. `tests/support/mod.rs` `Hive::new`: create `tmp.path().join("LocalAppData")` and set `local_data`. Fix every other `Locations { … }` construction site the compiler reports (grep `Locations {`).

In `register_one` add `Feature::Widgets => match widgets::register(loc, sys, install, allow_elevate)? { widgets::Widgets::NeedsReapproval => return Ok(true), widgets::Widgets::Unsupported(m) | widgets::Widgets::Missing(m) => log(&m), widgets::Widgets::Kept => log("kept the existing widgets registration"), widgets::Widgets::Registered => {} }`; in `unregister_one` add `Feature::Widgets => widgets::unregister(loc, sys, install)`.

- [ ] **Step 5: Implement `shell/widgets.rs`**

```rust
use std::{fs, io, path::Path};

use super::{AppxAdd, Locations, System};
use crate::error::{Error, IoCtx, Result};

pub const PACKAGE: &str = "NullIDE.Widgets";
pub const WEB_EXPERIENCE: &str = "MicrosoftWindows.Client.WebExperience";
/// First Windows 11 build with third-party widget providers; confirmed by the gate, see docs/specs/native-windows-widgets-gate.md.
pub const MIN_BUILD: u32 = 22621;

#[derive(Debug, PartialEq)]
pub enum Widgets {
    Registered,
    /// Left as it was: an update could not trust the new certificate without UAC, or the provider would not stop.
    Kept,
    /// Nothing registered and trust is missing: `modify` has to ask for approval.
    NeedsReapproval,
    /// This machine cannot show widgets; nothing was done.
    Unsupported(String),
    /// The package file is not in this build.
    Missing(String),
}

/// Windows build at or above the floor and the Windows Web Experience pack (it hosts the Widgets Board) installed.
pub fn supported(sys: &dyn System) -> std::result::Result<(), String> {
    let build = sys.windows_build();
    if build < MIN_BUILD {
        return Err(format!("widgets need Windows 11 build {MIN_BUILD} or later (this is build {build})"));
    }
    match sys.appx_installed(WEB_EXPERIENCE) {
        Ok(Some(_)) => Ok(()),
        _ => Err("the Windows Widgets component is not installed".into()),
    }
}

/// Mirrors `win11::register` for the second package. Trust is shared: the widgets package is signed with the same certificate.
pub fn register(_loc: &Locations, sys: &dyn System, install: &Path, allow_elevate: bool) -> Result<Widgets> {
    if let Err(why) = supported(sys) {
        return Ok(Widgets::Unsupported(format!("widgets not registered: {why}")));
    }
    let appx = install.join("shell-ext").join("null-widgets.appx");
    if !appx.is_file() {
        return Ok(Widgets::Missing(format!("widgets package not found at {}", appx.display())));
    }
    let cer = install.join("shell-ext").join("NullIDECert.cer");
    let trusted = cer.is_file() && sys.cert_thumbprint(&cer).map(|t| sys.cert_trusted_machine(&t)).unwrap_or(false);
    let existing = sys.appx_installed(PACKAGE)?;
    if !allow_elevate && !trusted {
        return Ok(if existing.is_some() { Widgets::Kept } else { Widgets::NeedsReapproval });
    }
    let _ = sys.cert_add_current_user(&cer);

    if !sys.stop_widgets_provider(install) {
        return Ok(Widgets::Kept);
    }
    if let Some(old) = existing {
        // Ask for trust before the old package goes: a declined UAC prompt must not leave the user with no package.
        if !trusted {
            sys.cert_add_machine_elevated(install)?;
        }
        let _ = sys.appx_remove(&old);
    }
    let mut added = sys.appx_add(&appx, install);
    if added == AppxAdd::UntrustedRoot {
        if !allow_elevate {
            return Ok(Widgets::NeedsReapproval);
        }
        sys.cert_add_machine_elevated(install)?;
        added = sys.appx_add(&appx, install);
    }
    match added {
        AppxAdd::Added => {}
        AppxAdd::UntrustedRoot => return Err(Error::Other("Widgets registration failed: the certificate is still not trusted".into())),
        AppxAdd::Failed(m) => return Err(Error::Other(format!("Widgets registration failed: {m}"))),
    }
    if sys.appx_installed(PACKAGE)?.is_none() {
        return Err(Error::Other("Widgets registration failed: NullIDE.Widgets package is not registered".into()));
    }
    Ok(Widgets::Registered)
}

/// Removes the package and the snapshot folder. Works without `null.exe` and on machines that never had the package.
pub fn unregister(loc: &Locations, sys: &dyn System, install: &Path) -> Result<()> {
    sys.stop_widgets_provider(install);
    if let Some(existing) = sys.appx_installed(PACKAGE)? {
        let _ = sys.appx_remove(&existing);
    }
    match fs::remove_dir_all(loc.local_data.join("Null").join("widgets")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).ctx("remove the widgets snapshot folder"),
    }
}
```

(`IoCtx` is the extension trait used elsewhere in the crate for `.ctx(...)`; if its signature differs, use `Error::Io { context: …, source: e }` as in `install_config.rs`.)

Expected call sequence in the tests above: `cert_user` → `stop_provider` → (`cert_machine` only if untrusted and a package exists) → `appx_remove` → `appx_add:widgets`. The fresh-install test expects `cert_user, stop_provider, appx_add:widgets, cert_machine, appx_add:widgets`, which this ordering yields.

- [ ] **Step 6: Run to verify it passes**

Run: `cd setup && cargo test -p null-setup-core`
Expected: PASS. If the manage/update tests that count `Feature::ALL` calls break, they assert the unregister list equals `Feature::ALL` — those still hold since `ALL` is the source.

- [ ] **Step 7: Commit**

```bash
git add setup
git commit -m "feat(setup): opt-in Windows widgets feature and package registration (#141)"
```

---

### Task 15: null-setup — stop the provider before an update or uninstall swaps the folder

`close_all` only posts `WM_CLOSE`, which a windowless COM server ignores, so without this a pinned widget turns every update into a "locked files" prompt.

**Files:**
- Modify: `setup/core/src/registrations.rs` (`Registrar::stop_widgets`), `setup/core/src/update.rs` (`prepare_swap`), `setup/core/src/manage.rs` (`uninstall_inner`)
- Modify: `setup/core/tests/support/mod.rs` (`Recorder`), `setup/core/tests/update.rs`, `setup/core/tests/manage.rs`

**Interfaces:**
- Produces:

```rust
// Registrar trait
/// Ends the widgets provider before the folder is renamed. Best effort; the default does nothing.
fn stop_widgets(&self, _install: &Path, _ctx: &Ctx) -> bool { true }
// Recorder: pub stops: Mutex<usize>; records every call.
```

- [ ] **Step 1: Write the failing tests**

`tests/update.rs`:

```rust
#[test]
fn update_stops_the_widgets_provider_before_closing_and_swapping() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let o = opts(&w, &srv.base);
    let rec = support::Recorder::new(null_setup_core::registrations::Registration::Done);
    let mut o = o;
    o.registrar = rec.clone();
    run(|c| update(&o, c)).0.unwrap();
    assert_eq!(*rec.stops.lock().unwrap(), 1);
}
```

`tests/manage.rs`:

```rust
#[test]
fn uninstall_stops_the_widgets_provider_first() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let user = tmp.path().join("Null");
    let rec = support::Recorder::new(Registration::Done);
    let mut o = opts(&dir, false, &user);
    o.registrar = rec.clone();
    run(|c| uninstall(&o, c)).unwrap();
    assert_eq!(*rec.stops.lock().unwrap(), 1);
}
```

In `tests/support/mod.rs`, extend `Recorder` with `pub stops: Mutex<usize>` (initialise to `Mutex::new(0)` in `Recorder::new`) and implement `fn stop_widgets(&self, _: &std::path::Path, _: &Ctx) -> bool { *self.stops.lock().unwrap() += 1; true }`.

- [ ] **Step 2: Run to verify failure**

Run: `cd setup && cargo test -p null-setup-core --test update --test manage`
Expected: FAIL — `stops` is 0 / the trait has no `stop_widgets`.

- [ ] **Step 3: Implement**

`registrations.rs`: add the default method to `Registrar`; implement for `ShellRegistrar`:

```rust
fn stop_widgets(&self, install: &Path, ctx: &Ctx) -> bool {
    let stopped = WinSystem.stop_widgets_provider(install);
    if !stopped {
        ctx.log.line("registrations: the widgets provider is still running; it will be closed with the other processes");
    }
    stopped
}
```

(`use shell::System` is needed for the trait method; `WinSystem` is already imported.)

`update.rs` `prepare_swap` — first line of the function:

```rust
fn prepare_swap(o: &Opts, ctx: &Ctx) -> Result<()> {
    o.registrar.stop_widgets(&o.install_dir, ctx);
    procs::close_all(&o.install_dir, ctx, o.close_grace)?;
```

`manage.rs` `uninstall_inner` — immediately before `procs::close_all(&o.install_dir, …)`: `o.registrar.stop_widgets(&o.install_dir, ctx);`.

The IDE's own failure policy is unchanged: `stop_widgets` returns a bool that is only logged; the swap's existing locked-files flow remains the backstop, and `widgets::register` independently keeps the old registration when the provider is still alive after the swap (Task 14).

- [ ] **Step 4: Run to verify it passes**

Run: `cd setup && cargo test -p null-setup-core -p null-setup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): stop the widgets provider before an update or uninstall swaps the folder (#141)"
```

---

### Task 16: Wizard — the opt-in "Windows widgets" option

**Files:**
- Modify: `setup/app/src/wizard.rs` (`View.widgets_supported`)
- Modify: `setup/ui/wizard-model.js`, `setup/ui/wizard.js`
- Modify: `setup/ui-tests/wizard-model.test.mjs`

**Interfaces:**
- Consumes: `shell::widgets::supported`, `shell::sys::WinSystem` (Task 14).
- Produces: `View` JSON gains `widgetsSupported: bool`; `wizard-model.js` gains `featuresFor(view)` returning the `FEATURES` rows minus `widgets` when `view.widgetsSupported` is falsy.

- [ ] **Step 1: Write the failing tests**

Add to `wizard-model.test.mjs` (the file loads the model with `vm`; also export `featuresFor`: change the `runInContext` suffix to `'\nthis.FEATURES = FEATURES; this.featuresFor = featuresFor;'`):

```js
test('the widgets option is offered only where the host supports it, and is off by default', () => {
  const keys = (view) => ctx.featuresFor(view).map(([k]) => k);
  assert.ok(keys({ widgetsSupported: true }).includes('widgets'));
  assert.ok(!keys({ widgetsSupported: false }).includes('widgets'));
  assert.ok(!keys({}).includes('widgets'));
  assert.deepStrictEqual(keys({ widgetsSupported: true }).slice(0, 7), ctx.FEATURES.filter(([k]) => k !== 'widgets').map(([k]) => k));
});

test('the summary mentions widgets only when the option exists', () => {
  const s = { dir: 'C:\\x', config: { widgets: true }, excluded: [], settings: {}, view: { manifest: null, widgetsSupported: false } };
  assert.ok(!ctx.summaryLines(s).some((l) => l.startsWith('Windows widgets')));
  s.view.widgetsSupported = true;
  assert.ok(ctx.summaryLines(s).includes('Windows widgets: on'));
});
```

(`summaryLines` is not exported to the context today — add it to the same `this.… =` suffix.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test setup/ui-tests/wizard-model.test.mjs`
Expected: FAIL — `featuresFor is not a function`.

- [ ] **Step 3: Implement**

`wizard-model.js`: append to `FEATURES`:
`['widgets', 'Windows widgets', 'Pin Projects, Issues and Pull Requests to the Windows 11 Widgets Board. They show what Null IDE last saw.'],`
and add

```js
/** The option exists only where the host can show widgets; the check runs in null-setup (`shell::widgets::supported`). */
function featuresFor(view) {
  return FEATURES.filter(([key]) => key !== 'widgets' || (view && view.widgetsSupported));
}
```

Change `summaryLines` to iterate `featuresFor(s.view)` instead of `FEATURES`. `wizard.js` `pageOptions`: replace `FEATURES.map(feature)` with `featuresFor(S.view).map(feature)`.

`wizard.rs`: add `widgets_supported: bool` to `View` (it is `#[serde(rename_all = "camelCase")]` like the other fields — check the struct attribute at its definition and add the field in the same style) and compute it in `load`:
`let widgets_supported = shell::widgets::supported(&shell::sys::WinSystem).is_ok();` then pass it into `View { …, widgets_supported }`. (Add the `use` for `shell` if not yet imported there; `Locations`/`arp` already come from it.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test setup/ui-tests/wizard-model.test.mjs; cd setup && cargo test -p null-setup-core -p null-setup`
Expected: PASS (the existing "every config key the page offers exists on the Rust InstallConfig" test now also checks `widgets`).

- [ ] **Step 5: Manual check of the window**

Run the wizard from a copy outside an install: `setup\target\debug\null-setup.exe wizard --install-dir "$env:TEMP\widgets-wizard-test"` (build with `cargo build -p null-setup` first). Expected on Windows 11: the options page lists "Windows widgets", unticked. Tick it and the summary says "Windows widgets: on". On a host where `supported` is false the row is absent.

- [ ] **Step 6: Commit**

```bash
git add setup
git commit -m "feat(setup): Windows widgets option in the install wizard (#141)"
```

---

### Task 17: End-to-end check on Windows 11, docs, and wrap-up

**Files:**
- Modify: `scripts/check-widgets.ps1` (final checklist mode)
- Modify: `setup/CLAUDE.md`, `CLAUDE.md` (root), `docs/ROADMAP.md` (if #141 is listed), `README.md` and `docs/wiki/` (user-facing settings/commands — run the `wiki-sync` skill)
- Modify: `docs/specs/native-windows-widgets-design.md` (status line: implemented; link the gate findings)

- [ ] **Step 1: Add the final checklist to `check-widgets.ps1`**

Add a `-Checklist` switch that prints (after the `-Status` output) the Win11 manual run from the spec's Testing section:

```powershell
if ($Checklist) {
@'
Windows 11 manual run (cannot run in CI). Use a build produced by scripts/build-local.ps1, installed with NullIDESetup.
 1. Setup wizard: "Windows widgets" is offered and OFF. Install without it: -Status shows NullIDE.Widgets "<not registered>".
 2. Null Setup -> Modify -> tick "Windows widgets" -> Apply. -Status shows the package. The Board (Win+W) lists Projects / Issues / Pull Requests.
 3. Null: Set Up Widgets in the IDE. snapshot.json appears; pin all three; data and "Updated <age>" are correct.
 4. Click-through: Issue/PR "GitHub" opens the browser; "Open" opens the project folder in Null IDE with NO package icon/own taskbar slot (scripts/check-cold-start-aumid.ps1 style); "New window" opens a new window.
 5. Quit Null IDE completely. The pinned cards still render the last data, footer ages; after 6 h the footer is muted.
 6. Unpin all widgets: null_widgets.exe exits (-Status: running = no).
 7. Update with a widget pinned: run a headless update (see setup/CLAUDE.md) from a copy outside the install. No "files are locked" prompt; widgets still work afterwards (-Status).
 8. Turn null.widgets.enabled off: snapshot.json disappears and the cards fall back to "Open Null IDE to set up widgets".
 9. Sign the account out in null-accounts: rows stay, dimmed, with the reason.
10. Uninstall: NullIDE.Widgets and %LOCALAPPDATA%\Null\widgets are gone; the Explorer context menu package is also gone.
11. Untick "Windows widgets" in Modify: package and snapshot folder removed, IDE untouched.
'@
}
```

- [ ] **Step 2: Run the checklist**

Execute every item in a real Windows 11 session and write the outcome (pass/fail + notes) under a new heading `## Verification (YYYY-MM-DD)` at the end of `docs/specs/native-windows-widgets-gate.md`. Any failure: fix it in the owning task's files with a test where one is possible, then re-run that item.

- [ ] **Step 3: Documentation**

- `setup/CLAUDE.md`: add to the registrations paragraph that `Feature::Widgets` (opt-in, default off, `widgets` in `install-config.json`) registers the second sparse package `NullIDE.Widgets` through `shell/widgets.rs`, uses the same certificate/trust flow, that `Registrar::stop_widgets` ends `null_widgets.exe` before the swap/uninstall, that the wizard hides the option when `shell::widgets::supported` fails, and where `MIN_BUILD` came from.
- Root `CLAUDE.md`: in the Repository Layout / Win11 Shell Extension sections mention the widgets provider and the new scripts (`fetch-widgets-deps.ps1`, `pack-widgets.ps1`, `check-widgets.ps1`) and add the CTest step to "How the Build Works" step 9.
- Run the `wiki-sync` skill for the new settings (`null.widgets.enabled`, `null.widgets.repos`), commands (`Null: Set Up Widgets`, `Null: Refresh Widgets`) and the privacy note (private titles appear on the Board).
- Update the design doc header: `Status: implemented (see docs/plans/native-windows-widgets.md and docs/specs/native-windows-widgets-gate.md)`.

- [ ] **Step 4: Refresh the knowledge graph and compiled output**

```bash
graphify update .
cd extensions/null-tools && npm run compile && cd ../..
git status --short
```

Expected: only the intended files; refreshed `out/` goes into its own `chore: refresh null-tools compiled output` commit.

- [ ] **Step 5: Final full verification**

```bash
cd extensions/null-tools && npm test
cd ../../setup && cargo test -p null-setup-core -p null-setup && node --test ui-tests/wizard-model.test.mjs
cd .. && ctest --test-dir shell-ext-build -C Release --output-on-failure
node --test scripts/release-notes.test.mjs
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A -- scripts setup/CLAUDE.md CLAUDE.md README.md docs
git commit -m "docs(widgets): final checklist, setup/CLAUDE notes and wiki sync (#141)"
```

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| Gate: signed package, null.exe closed, runtime deps/size, min build | 1 |
| Decision 1 cache only / 6 provider is dumb + untrusted input | 3, 4, 5 |
| Decision 2 `widgetSnapshot` module (issues/PRs GraphQL, projects, gated by `enabled`) | 7, 8, 10, 11, 12 (split into focused files instead of one `widgetSnapshot` module) |
| Decision 3 GitHub first, `provider` field | 7 (rows carry `provider: 'github'`) |
| Decision 4 separate package; 5 C++/WinRT, CMake step, same cert, `Windows.Data.Json` | 1, 4, 6 |
| Decision 7 settings, constants (8/10/10), no extra settings | 7, 12 |
| Decision 8 actions, `LaunchViaExplorer`, `--`, path from package location | 2, 4, 5 |
| Decision 9 lifecycle: opt-in, host check, trust flow, stop before swap, failures never fail install, uninstall removes both | 13–16 |
| Decision 10 demand-driven process | 5 (exits on last DeleteWidget) |
| Decision 11 atomic writes / corrupt keeps last good | 9, 5 |
| Decision 12 no secrets | 7 (rows hold no token), 9 |
| Decision 13 one writer window | 9, 11 |
| Decision 14 accounts non-interactive | 10, 12 |
| Decision 15 refresh cadence, backoff, rate limit, repo removal rewrite | 11 |
| Decision 16 off deletes; signed-out keeps rows | 11, 8 |
| Decision 17 nothing implicit | 12 (`enabled` default false; set only by setup) |
| Snapshot sets, status/failed rules, localPath, schema-newer, PR ordering | 7, 8, 3, 4 |
| Widgets table (sizes/actions) | 1 (manifest sizes), 4 (rows/actions) |
| Errors and staleness incl. 6 h constant | 4 |
| Testing: node tests / CTest fixtures incl. hostile / FakeSystem / Win11 by hand + script | 7–11 / 3–5 / 13–15 / 17 |

Gap found and fixed while writing: spec's FakeSystem test for "provider process cannot be stopped" → Task 14 (`a_provider_that_cannot_be_stopped_keeps_the_current_registration`).

**2. Placeholder scan:** No TBD/TODO. Two honest "measure then decide" points are explicit decision steps, not blanks: the activation approach and minimum Windows build in Task 1 (both end in a recorded finding), and `MIN_BUILD = 22621` is a stated default that Task 1 may change. Task 6 Step 3 and Task 12 Step 6 name the exact edits (including the three known compile clean-ups).

**3. Type consistency:** `IssueRow`/`PrRow`/`Section`/`Snapshot`/`WidgetRepo` defined in Task 7 and used unchanged in Tasks 8–12. `RepoResult` (Task 10) feeds `RefresherDeps.fetch` (Task 11). C++: `Loaded/Snapshot/Section` (Task 3) are consumed by `BuildCard`/`IsAllowedProjectPath` (Task 4) and `ParseAction`/`Choose` (Task 5). Rust: `System::appx_installed(name)` changes in Task 13 and every later caller (`widgets.rs`, `win11.rs`) uses the new signature; `FakeSystem` call names (`appx_add:widgets`, `stop_provider`) are consistent between Tasks 13–15.

**4. Review Focus coverage:** 1 → Tasks 3, 4, 5 (hostile fixture, template-equality, allowlist); 2 → Tasks 3 (corrupt/odd types), 5 (`Choose`); 3 → Task 7 (`parseRepos`); 4 → Tasks 8, 11 (signed_out keeps rows, rate-limit suspend, failing fetch); 5 → Tasks 13–15 (`stop_named_under`, `stop_widgets` in update/uninstall, "cannot be stopped keeps registration").
