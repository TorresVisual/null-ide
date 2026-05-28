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

#include <shlwapi.h>
#include <shobjidl_core.h>
#include <userenv.h>
#include <wrl/module.h>
#include <wrl/implements.h>
#include <wrl/client.h>
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
      LONG result = RegOpenKeyEx(HKEY_LOCAL_MACHINE, kTitleRegkey, 0, KEY_READ, &subhkey);
      if (result != ERROR_SUCCESS) {
        result = RegOpenKeyEx(HKEY_CURRENT_USER, kTitleRegkey, 0, KEY_READ, &subhkey);
      }

      DWORD type = REG_EXPAND_SZ;
      RegQueryValueEx(subhkey, L"Title", nullptr, &type,
                      reinterpret_cast<LPBYTE>(&value_w), &value_size_w);
      RegCloseKey(subhkey);
      value_size_w = ExpandEnvironmentStrings(value_w, expanded_value_w, kMaxStringLength);

      if (value_size_w && value_size_w < kMaxStringLength) {
        cached_title = expanded_value_w;
      } else {
        cached_title = L"Open in Null";
      }
      title_cached = true;
    }

    return SHStrDup(cached_title.c_str(), name);
  }

  IFACEMETHODIMP GetIcon(IShellItemArray* items, PWSTR* icon) {
    // DLL is at {install}\shell-ext\NullIDE.ExplorerCommand\x64\DLL.dll
    // remove_filename() + 3x parent_path() navigates back to {install}
    std::filesystem::path module_path{
        wil::GetModuleFileNameW<std::wstring>(wil::GetModuleInstanceHandle())};
    module_path = module_path.remove_filename()
                             .parent_path()
                             .parent_path()
                             .parent_path();
    module_path /= EXE_NAME;
    return SHStrDupW(module_path.c_str(), icon);
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
    if (items) {
      std::filesystem::path module_path{
          wil::GetModuleFileNameW<std::wstring>(wil::GetModuleInstanceHandle())};
      module_path = module_path.remove_filename()
                               .parent_path()
                               .parent_path()
                               .parent_path();
      module_path /= EXE_NAME;

      DWORD count;
      RETURN_IF_FAILED(items->GetCount(&count));
      for (DWORD i = 0; i < count; ++i) {
        ComPtr<IShellItem> item;
        auto result = items->GetItemAt(i, &item);
        if (SUCCEEDED(result)) {
          wil::unique_cotaskmem_string path;
          result = item->GetDisplayName(SIGDN_FILESYSPATH, &path);
          if (SUCCEEDED(result)) {
            HINSTANCE ret = ShellExecuteW(
                nullptr, L"open", module_path.c_str(),
                QuoteForCommandLineArg(path.get()).c_str(),
                nullptr, SW_SHOW);
            if ((INT_PTR)ret <= HINSTANCE_ERROR) {
              RETURN_LAST_ERROR();
            }
          }
        }
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
