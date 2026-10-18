# null-cpp

Symbol-aware C/C++ header/source switching, auto-paired split editors with scroll sync, and `.hpp`/`.cpp` class scaffolding, layered on top of the (separately installed) `llvm-vs-code-extensions.vscode-clangd` extension. Activated on `onStartupFinished`; features gate on `null-cpp.isCppProject`, set by scanning for `CMakeLists.txt`, `compile_commands.json`, `.clangd`, or C/C++ source files (`null-cpp.projectDetection.override` can force this). `Alt+O` triggers symbol-aware header/source switching. See `docs/specs/null-cpp-extension-design.md`.

The CMake/Make layer (`cmakeToolbar.ts`, `makeToolbar.ts`: preset/target pickers, build/run, `debugConfigSynth.ts` debug launch) is built; `docs/ROADMAP.md` still holds the phase plan.
