#include "actions.h"

#include <windows.h>
#include <shellapi.h>

#include <filesystem>
#include <vector>

#include "snapshot.h"

namespace null_widgets {

std::wstring QuoteArg(std::wstring const& arg) {
  if (!arg.empty() && arg.find_first_of(L" \t\n\v\"") == std::wstring::npos) return arg;
  std::wstring out = L"\"";
  size_t backslashes = 0;
  for (wchar_t c : arg) {
    if (c == L'\\') {
      ++backslashes;
      continue;
    }
    if (c == L'"') out.append(backslashes * 2 + 1, L'\\');
    else out.append(backslashes, L'\\');
    backslashes = 0;
    out.push_back(c);
  }
  out.append(backslashes * 2, L'\\');  // the closing quote must not be escaped by a trailing backslash
  out.push_back(L'"');
  return out;
}

std::wstring NullCommandLine(std::wstring const& nullExe, std::wstring const& projectPath, bool newWindow) {
  std::wstring cmd = QuoteArg(nullExe);
  if (newWindow) cmd += L" --new-window";
  cmd += L" -- " + QuoteArg(projectPath);
  return cmd;
}

void ScrubIdeEnvironment() {
  std::vector<std::wstring> names;
  if (wchar_t* block = GetEnvironmentStringsW()) {
    for (wchar_t* p = block; *p; p += wcslen(p) + 1) {
      std::wstring entry = p;
      size_t eq = entry.find(L'=', 1);  // a leading '=' is a drive-cwd entry such as "=C:"
      if (eq == std::wstring::npos) continue;
      std::wstring name = entry.substr(0, eq);
      if (_wcsicmp(name.c_str(), L"ELECTRON_RUN_AS_NODE") == 0 || _wcsnicmp(name.c_str(), L"VSCODE_", 7) == 0) names.push_back(name);
    }
    FreeEnvironmentStringsW(block);
  }
  for (auto const& n : names) SetEnvironmentVariableW(n.c_str(), nullptr);
}

bool Run(Action const& a, std::wstring const& installDir) {
  switch (a.kind) {
    case ActionKind::OpenUrl: {
      if (!IsSafeGithubUrl(a.target)) return false;
      return reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", a.target.c_str(), nullptr, nullptr, SW_SHOWNORMAL)) > 32;
    }
    case ActionKind::OpenProject:
    case ActionKind::OpenProjectNewWindow: {
      if (!IsAbsoluteLocalPath(a.target)) return false;
      std::wstring nullExe = installDir + L"\\null.exe";
      if (!std::filesystem::is_regular_file(nullExe)) return false;
      std::wstring cmd = NullCommandLine(nullExe, a.target, a.kind == ActionKind::OpenProjectNewWindow);
      std::vector<wchar_t> buf(cmd.begin(), cmd.end());
      buf.push_back(L'\0');
      STARTUPINFOW si{sizeof(si)};
      PROCESS_INFORMATION pi{};
      if (!CreateProcessW(nullExe.c_str(), buf.data(), nullptr, nullptr, FALSE, CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr, &si, &pi)) return false;
      CloseHandle(pi.hThread);
      CloseHandle(pi.hProcess);
      return true;
    }
    case ActionKind::None:
      break;
  }
  return false;
}

}  // namespace null_widgets
