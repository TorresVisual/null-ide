#pragma once
#include <string>

#include "layout.h"

namespace null_widgets {

// CommandLineToArgvW rules: quotes only when needed, backslashes before a quote doubled.
std::wstring QuoteArg(std::wstring const& arg);
// "<null.exe>" [--new-window] -- "<project>". The `--` keeps a path from ever being read as an option.
std::wstring NullCommandLine(std::wstring const& nullExe, std::wstring const& projectPath, bool newWindow);

// Drops ELECTRON_RUN_AS_NODE and VSCODE_* from this process, so a null.exe started later is the editor and not Node,
// even when the widgets were first started from the extension host.
void ScrubIdeEnvironment();

// Runs one action. URLs and paths are validated again here. `installDir` is the folder of this exe (never from the snapshot).
bool Run(Action const& action, std::wstring const& installDir);

}  // namespace null_widgets
