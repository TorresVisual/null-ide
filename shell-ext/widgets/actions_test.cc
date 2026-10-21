#include <windows.h>

#include "actions.h"
#include "check.h"

using namespace null_widgets;

static void TestCommandLine() {
  CHECK(QuoteArg(L"abc") == L"abc");
  CHECK(QuoteArg(L"a b") == L"\"a b\"");
  CHECK(QuoteArg(L"") == L"\"\"");
  CHECK(QuoteArg(L"C:\\a b\\") == L"\"C:\\a b\\\\\"");  // trailing backslash is doubled so it cannot escape the closing quote
  CHECK(QuoteArg(L"a\"b") == L"\"a\\\"b\"");
  CHECK(NullCommandLine(L"C:\\Null IDE\\null.exe", L"C:\\work dir\\", true) ==
        L"\"C:\\Null IDE\\null.exe\" --new-window -- \"C:\\work dir\\\\\"");
  CHECK(NullCommandLine(L"C:\\n\\null.exe", L"C:\\work", false) == L"C:\\n\\null.exe -- C:\\work");
}

static void TestRefusals() {
  // Nothing hostile reaches ShellExecute or CreateProcess: these all fail before any process is started.
  CHECK(!Run({ActionKind::OpenUrl, L"file:///C:/Windows/System32/calc.exe", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenUrl, L"https://github.com.evil.com/x", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenProject, L"--remote=evil", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenProjectNewWindow, L"..\\..\\x", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenProject, L"C:\\work", L""}, L"C:\\no\\such\\install"));  // no null.exe there
  CHECK(!Run({ActionKind::None, L"", L""}, L"C:\\x"));
}

static void TestScrub() {
  SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1");
  SetEnvironmentVariableW(L"VSCODE_PID", L"5");
  SetEnvironmentVariableW(L"vscode_lower", L"1");
  SetEnvironmentVariableW(L"NULL_WIDGETS_TEST_KEEP", L"1");
  ScrubIdeEnvironment();
  wchar_t buf[8];
  CHECK(GetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", buf, 8) == 0);
  CHECK(GetEnvironmentVariableW(L"VSCODE_PID", buf, 8) == 0);
  CHECK(GetEnvironmentVariableW(L"vscode_lower", buf, 8) == 0);
  CHECK(GetEnvironmentVariableW(L"NULL_WIDGETS_TEST_KEEP", buf, 8) == 1);
}

int main() {
  TestCommandLine();
  TestRefusals();
  TestScrub();
  return Finish("actions_test");
}
