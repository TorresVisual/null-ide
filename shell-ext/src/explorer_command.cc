// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
//
// Adapted from https://github.com/microsoft/vscode-explorer-command
// for Null IDE.

#include <windows.h>
#include <shellapi.h>

#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include <shlwapi.h>
#include <shobjidl_core.h>
#include <userenv.h>
#include <wrl/module.h>
#include <wrl/implements.h>
#include <wrl/client.h>
#include "resource.h"
#include "wil/stl.h"
#include "wil/filesystem.h"
#include "wil/win32_helpers.h"

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::InhibitRoOriginateError;
using Microsoft::WRL::Module;
using Microsoft::WRL::ModuleType;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

extern "C" BOOL WINAPI DllMain(HINSTANCE instance,
                               DWORD reason,
                               LPVOID reserved) {
  switch (reason) {
    case DLL_PROCESS_ATTACH:
    case DLL_PROCESS_DETACH:
    case DLL_THREAD_ATTACH:
    case DLL_THREAD_DETACH:
      break;
  }

  return true;
}

namespace {
// Extracted from
// https://source.chromium.org/chromium/chromium/src/+/main:base/command_line.cc;l=109-159
std::wstring QuoteForCommandLineArg(const std::wstring& arg) {
  std::wstring quotable_chars(L" \\\"");
  if (arg.find_first_of(quotable_chars) == std::wstring::npos) {
    return arg;
  }

  std::wstring out;
  out.push_back('"');
  for (size_t i = 0; i < arg.size(); ++i) {
    if (arg[i] == '\\') {
      size_t start = i, end = start + 1;
      for (; end < arg.size() && arg[end] == '\\'; ++end) {}
      size_t backslash_count = end - start;
      if (end == arg.size() || arg[end] == '"') {
        backslash_count *= 2;
      }
      for (size_t j = 0; j < backslash_count; ++j)
        out.push_back('\\');
      i = end - 1;
    } else if (arg[i] == '"') {
      out.push_back('\\');
      out.push_back('"');
    } else {
      out.push_back(arg[i]);
    }
  }
  out.push_back('"');
  return out;
}

// Registry key written by the Null IDE installer under HKCU.
// IsContextMenuEnabled() returns 0 (hidden) when the key is absent — i.e.
// the user unchecked the context-menu option during install.
static const wchar_t kTitleRegkey[] = L"Software\\Classes\\NullIDEContextMenu";

static int IsContextMenuEnabled() {
  static int enabled = -1;
  HKEY subhkey;
  int err;

  if (enabled != -1)
    return enabled;

  err = RegOpenKeyExW(HKEY_LOCAL_MACHINE,
                      kTitleRegkey,
                      0,
                      KEY_QUERY_VALUE | KEY_WOW64_64KEY,
                      &subhkey);
  if (err != ERROR_SUCCESS) {
    err = RegOpenKeyExW(HKEY_CURRENT_USER,
                        kTitleRegkey,
                        0,
                        KEY_QUERY_VALUE | KEY_WOW64_64KEY,
                        &subhkey);
  }

  if (err != ERROR_SUCCESS) {
    enabled = 0;
  } else {
    enabled = 1;
    RegCloseKey(subhkey);
  }

  return enabled;
}

bool IsNullIdeInstallRoot(const std::filesystem::path& root) {
  if (root.empty()) {
    return false;
  }
  if (std::filesystem::exists(root / L"resources" / L"app" / L"product.json")) {
    return true;
  }
  return std::filesystem::exists(root / L".null-ide-install.json");
}

std::filesystem::path GetInstallRootFromModule() {
  std::filesystem::path module_path{
      wil::GetModuleFileNameW<std::wstring>(wil::GetModuleInstanceHandle())};
  // DLL path: {ExternalLocation}\shell-ext\NullIDE.ExplorerCommand\x64\*.dll
  return module_path.remove_filename()
      .parent_path()
      .parent_path()
      .parent_path();
}

std::filesystem::path GetInstallRootFromRegistry() {
  wchar_t value[MAX_PATH]{};
  DWORD value_size = sizeof(value);
  DWORD type = REG_SZ;

  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kTitleRegkey, 0,
                    KEY_QUERY_VALUE | KEY_WOW64_64KEY, &key) != ERROR_SUCCESS) {
    return {};
  }

  if (RegQueryValueExW(key, L"InstallDir", nullptr, &type,
                       reinterpret_cast<LPBYTE>(value),
                       &value_size) != ERROR_SUCCESS ||
      type != REG_SZ || value[0] == L'\0') {
    RegCloseKey(key);
    return {};
  }

  RegCloseKey(key);
  return value;
}

std::filesystem::path GetInstallRoot() {
  // Prefer the sparse package ExternalLocation (where this DLL is installed).
  // Registry InstallDir can be stale after moves or dev installs and would launch the wrong exe.
  const std::filesystem::path from_module = GetInstallRootFromModule();
  if (IsNullIdeInstallRoot(from_module)) {
    return from_module;
  }

  const std::filesystem::path from_registry = GetInstallRootFromRegistry();
  if (IsNullIdeInstallRoot(from_registry)) {
    return from_registry;
  }

  return {};
}

std::filesystem::path GetMainExecutable(const std::filesystem::path& root) {
  for (const wchar_t* name : {L"null.exe", L"Null.exe"}) {
    const std::filesystem::path candidate = root / name;
    if (std::filesystem::exists(candidate)) {
      return candidate;
    }
  }
  return root / L"null.exe";
}

bool LaunchNullIde(const std::filesystem::path& exe,
                   const std::filesystem::path& install_root,
                   const std::wstring& target_path) {
  const std::wstring args = QuoteForCommandLineArg(target_path);
  std::wstring command_line = L"\"" + exe.wstring() + L"\" " + args;
  std::vector<wchar_t> mutable_command(command_line.begin(), command_line.end());
  mutable_command.push_back(L'\0');

  // This DLL runs inside a COM surrogate activated under the sparse APPX
  // identity NullIDE.ExplorerCommand (see AppxManifest.xml). Without
  // detaching, a cold-started null.exe inherits that package identity and
  // gets a different AUMID/icon than one launched from the Start
  // Menu/taskbar shortcut, so it shows the wrong icon and doesn't dock into
  // the pinned taskbar slot (issue #42). Passing an empty
  // PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME detaches the child.
  SIZE_T attr_list_size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attr_list_size);
  std::vector<BYTE> attr_list_buffer(attr_list_size);
  auto* attr_list =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attr_list_buffer.data());
  bool have_attr_list = attr_list_size > 0 &&
      InitializeProcThreadAttributeList(attr_list, 1, 0, &attr_list_size);
  static wchar_t kUnpackaged[] = L"";
  if (have_attr_list &&
      !UpdateProcThreadAttribute(attr_list, 0,
                                 PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME,
                                 kUnpackaged, sizeof(kUnpackaged), nullptr,
                                 nullptr)) {
    DeleteProcThreadAttributeList(attr_list);
    have_attr_list = false;
  }

  STARTUPINFOEXW startup_info{};
  startup_info.StartupInfo.cb = sizeof(startup_info);
  if (have_attr_list) {
    startup_info.lpAttributeList = attr_list;
  }
  PROCESS_INFORMATION process_info{};

  DWORD flags = CREATE_DEFAULT_ERROR_MODE;
  if (have_attr_list) {
    flags |= EXTENDED_STARTUPINFO_PRESENT;
  }

  BOOL created = CreateProcessW(
      nullptr, mutable_command.data(), nullptr, nullptr, FALSE, flags,
      nullptr, install_root.c_str(),
      reinterpret_cast<STARTUPINFOW*>(&startup_info), &process_info);

  if (have_attr_list) {
    DeleteProcThreadAttributeList(attr_list);
  }

  if (created) {
    CloseHandle(process_info.hThread);
    CloseHandle(process_info.hProcess);
    return true;
  }

  // ponytail: fallback path keeps package identity (ShellExecuteEx has no
  // equivalent detach knob); only hit if CreateProcessW itself fails.
  SHELLEXECUTEINFOW execute_info{};
  execute_info.cbSize = sizeof(execute_info);
  execute_info.fMask = SEE_MASK_FLAG_NO_UI;
  execute_info.lpVerb = L"open";
  execute_info.lpFile = exe.c_str();
  execute_info.lpParameters = args.c_str();
  execute_info.lpDirectory = install_root.c_str();
  execute_info.nShow = SW_SHOW;
  return ShellExecuteExW(&execute_info) != FALSE;
}

}  // namespace

class __declspec(uuid(DLL_UUID)) ExplorerCommandHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom | InhibitRoOriginateError>,
                          IExplorerCommand> {
 public:
  IFACEMETHODIMP GetTitle(IShellItemArray* items, PWSTR* name) {
    static std::wstring cached_title;
    static bool title_cached = false;

    if (!title_cached) {
      const size_t kMaxStringLength = 1024;
      wchar_t value_w[kMaxStringLength];
      wchar_t expanded_value_w[kMaxStringLength];
      DWORD value_size_w = sizeof(value_w);

      HKEY subhkey = nullptr;
      LONG result = RegOpenKeyExW(HKEY_LOCAL_MACHINE, kTitleRegkey, 0,
                                  KEY_QUERY_VALUE | KEY_WOW64_64KEY, &subhkey);
      if (result != ERROR_SUCCESS) {
        result = RegOpenKeyExW(HKEY_CURRENT_USER, kTitleRegkey, 0,
                               KEY_QUERY_VALUE | KEY_WOW64_64KEY, &subhkey);
      }

      if (result == ERROR_SUCCESS) {
        DWORD type = REG_EXPAND_SZ;
        RegQueryValueExW(subhkey, L"Title", nullptr, &type,
                        reinterpret_cast<LPBYTE>(&value_w), &value_size_w);
        RegCloseKey(subhkey);
      }
      value_size_w = ExpandEnvironmentStrings(value_w, expanded_value_w, kMaxStringLength);

      if (value_size_w && value_size_w < kMaxStringLength) {
        cached_title = expanded_value_w;
      } else {
        cached_title = L"Open with Null";
      }
      title_cached = true;
    }

    return SHStrDup(cached_title.c_str(), name);
  }

  IFACEMETHODIMP GetIcon(IShellItemArray* items, PWSTR* icon) {
    UNREFERENCED_PARAMETER(items);
    static std::wstring cached_icon;
    static bool icon_cached = false;

    if (!icon_cached) {
      // Icon resource embedded in this DLL (reliable from dllhost surrogate).
      std::filesystem::path dll_path{
          wil::GetModuleFileNameW<std::wstring>(wil::GetModuleInstanceHandle())};
      cached_icon = dll_path.wstring() + L",-" + std::to_wstring(IDI_NULL_CONTEXT);
      icon_cached = true;
    }

    return SHStrDupW(cached_icon.c_str(), icon);
  }

  IFACEMETHODIMP GetToolTip(IShellItemArray* items, PWSTR* infoTip) {
    *infoTip = nullptr;
    return E_NOTIMPL;
  }

  IFACEMETHODIMP GetCanonicalName(GUID* guidCommandName) {
    *guidCommandName = GUID_NULL;
    return S_OK;
  }

  IFACEMETHODIMP GetState(IShellItemArray* items, BOOL okToBeSlow,
                          EXPCMDSTATE* cmdState) {
    *cmdState = IsContextMenuEnabled() ? ECS_ENABLED : ECS_HIDDEN;
    return S_OK;
  }

  IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags) {
    *flags = ECF_DEFAULT;
    return S_OK;
  }

  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** enumCommands) {
    *enumCommands = nullptr;
    return E_NOTIMPL;
  }

  IFACEMETHODIMP Invoke(IShellItemArray* items, IBindCtx* bindCtx) {
    UNREFERENCED_PARAMETER(bindCtx);
    if (!items) {
      return S_OK;
    }

    const std::filesystem::path install_root = GetInstallRoot();
    if (install_root.empty()) {
      return HRESULT_FROM_WIN32(ERROR_PATH_NOT_FOUND);
    }

    const std::filesystem::path exe_path = GetMainExecutable(install_root);
    if (!std::filesystem::exists(exe_path)) {
      return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
    }

    DWORD count = 0;
    RETURN_IF_FAILED(items->GetCount(&count));

    for (DWORD i = 0; i < count; ++i) {
      ComPtr<IShellItem> item;
      RETURN_IF_FAILED(items->GetItemAt(i, &item));

      wil::unique_cotaskmem_string path;
      RETURN_IF_FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path));

      if (!LaunchNullIde(exe_path, install_root, path.get())) {
        return HRESULT_FROM_WIN32(GetLastError());
      }
    }

    return S_OK;
  }
};

CoCreatableClass(ExplorerCommandHandler)
CoCreatableClassWrlCreatorMapInclude(ExplorerCommandHandler)

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, LPVOID* ppv) {
  if (ppv == nullptr)
    return E_POINTER;
  *ppv = nullptr;
  return Module<ModuleType::InProc>::GetModule().GetClassObject(rclsid, riid, ppv);
}

STDAPI DllCanUnloadNow(void) {
  return Module<ModuleType::InProc>::GetModule().GetObjectCount() == 0 ? S_OK : S_FALSE;
}

STDAPI DllGetActivationFactory(HSTRING activatableClassId,
                               IActivationFactory** factory) {
  return Module<ModuleType::InProc>::GetModule().GetActivationFactory(
      activatableClassId, factory);
}
