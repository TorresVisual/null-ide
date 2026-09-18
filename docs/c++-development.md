# VSCodium C++ Development Layer — Roadmap

The goal is **not** to turn Null IDe into Visual Studio. The goal is to build a **first-class C++ development experience on top of VSCodium**, while keeping the rest of the editor language-agnostic.

## 1. Core Architecture

```text
VSCodium
│
├── Core IDE
│   ├── Editor
│   ├── Explorer
│   ├── Search
│   ├── Git
│   ├── Terminal
│   └── Extensions
│
└── C++ Workspace
    │
    ├── clangd
    │   ├── IntelliSense
    │   ├── Diagnostics
    │   ├── Navigation
    │   ├── Refactoring
    │   └── Symbol indexing
    │
    ├── CMake
    │   ├── Project detection
    │   ├── Targets
    │   ├── Presets
    │   └── Configuration
    │
    ├── Toolchains
    │   ├── MSVC
    │   ├── Clang / clang-cl
    │   ├── GCC
    │   └── MinGW
    │
    ├── Build
    ├── Run
    ├── Debug
    ├── Diagnostics
    ├── Sanitizers
    └── Profiling
```

### Fundamental principle

**clangd handles C++ language intelligence.**

Your fork handles:

**project → CMake → toolchain → build → executable → debugger**

Don't build your own C++ language server.

---

# 2. C++ Project Detection

The C++ layer should activate automatically when a workspace appears to be a C++ project.

Detect:

```text
CMakeLists.txt
CMakePresets.json
compile_commands.json
*.cpp
*.cc
*.cxx
*.hpp
*.hh
*.hxx
*.h
```

Prefer stronger signals:

```text
CMakeLists.txt
CMakePresets.json
compile_commands.json
Makefile
```

over simply finding a `.cpp` file.

### Non-C++ projects

Should remain completely unaffected.

For example:

```text
TypeScript project
├── Explorer
├── Search
├── Git
└── Terminal
```

C++ project:

```text
C++ project
├── Explorer
├── Search
├── Git
├── CMake
├── C++ Symbols
└── Debug
```

---

# 3. CMake as the Central Project Model (use Makefile through wsl)

Do **not** make your own project abstraction the source of truth.

Use:

```text
CMake
  ↓
Targets
  ↓
Configurations
  ↓
Toolchain
  ↓
Build
```

Example:

```text
CMake
│
├── MiniGit
├── MiniGitTests
└── MiniGitBenchmarks
```

The UI should discover targets from CMake instead of requiring the user to manually configure them.

---

# 4. CMake Presets

Make `CMakePresets.json` a first-class citizen.

Example:

```text
CMAKE PRESETS

Windows
├── MSVC Debug
├── MSVC Release
├── Clang Debug
├── Clang Release
└── Clang ASan
```

The user shouldn't have to understand the underlying commands.

Selecting:

```text
Clang Debug
```

should automatically establish:

```text
Compiler: clang-cl
Architecture: x64
Configuration: Debug
Build directory: build/clang-debug
Compilation database: build/clang-debug/compile_commands.json
```

---

# 5. Toolchain System

Toolchain and configuration should be separate.

### Toolchains

```text
MSVC
Clang
GCC
MinGW
```

### Configurations

```text
Debug
Release
RelWithDebInfo
ASan
UBSan
TSan
```

Therefore:

```text
MSVC + Debug
MSVC + Release

Clang + Debug
Clang + Release
Clang + ASan

GCC + Debug
GCC + Release
```

This should be represented internally as something like:

```text
C++ Configuration
├── Toolchain
├── Compiler
├── Architecture
├── CMake preset
├── Build directory
├── Environment
└── Debugger
```

---

# 6. Compiler Support

Initial priority:

### 1. MSVC

```text
cl.exe
link.exe
```

### 2. Clang

```text
clang-cl.exe
lld-link.exe
```

### 3. GCC / MinGW

Later.

The system should automatically detect installed toolchains where possible.

Example:

```text
TOOLCHAINS

✓ MSVC 2026
  x64
  C:\...\cl.exe

✓ LLVM 22
  clang-cl
  C:\...\clang-cl.exe

✓ MinGW-w64
  GCC 15
```

---

# 7. clangd Integration

clangd remains the primary C++ language server.

Your fork should manage its configuration rather than replacing it.

Important flow:

```text
CMake Configure
       ↓
compile_commands.json
       ↓
clangd
       ↓
C++ Intelligence
```

clangd provides:

* autocomplete
* diagnostics
* semantic highlighting
* go to definition
* go to declaration
* references
* rename
* code actions
* symbol indexing
* refactoring

---

# 8. Configuration Switching

This is important.

If the user switches:

```text
MSVC Debug
```

to:

```text
Clang Debug
```

your fork should:

1. Configure CMake.
2. Generate/update `compile_commands.json`.
3. Update clangd's compilation context.
4. Update build commands.
5. Update debugger configuration.
6. Update environment variables.

The user should simply see:

```text
MSVC Debug → Clang Debug
```

and everything follows automatically.

---

# 9. C++ Toolbar

A dedicated C++ toolbar should appear only for C++ projects.

Something like:

```text
┌──────────────────────────────────────────────────────────┐
│ MiniGit │ MSVC Debug │ x64 │ ▶ Build │ ▶ Run │ 🐞 Debug │
└──────────────────────────────────────────────────────────┘
```

### Target selector

```text
MiniGit ▼
```

### Configuration selector

```text
MSVC Debug ▼
```

### Actions

```text
▶ Build
▶ Run
🐞 Debug
```

Eventually:

```text
🧪 ASan
📊 Profile
```

---

# 10. Build System

Build actions:

```text
Build
Rebuild
Clean
Build Target
Build All
Cancel
```

Example:

```text
MiniGit ▼
  Build
  Rebuild
  Clean
```

The UI should understand build targets.

---

# 11. Build Diagnostics

Don't simply dump compiler output into the terminal.

Create a structured build view:

```text
BUILD FAILED

❌ 3 errors
⚠ 12 warnings

Blob.cpp
  ❌ 2 errors
  ⚠ 4 warnings

Repository.cpp
  ❌ 1 error
  ⚠ 8 warnings
```

Clicking an error should jump directly to the source.

Eventually:

```text
Error
Why it happened
Candidates
Suggested fix
```

---

# 12. C++ Code Actions

Add C++-specific actions on top of clangd.

Examples:

```text
Generate Definition
Generate Constructor
Generate Getter
Generate Setter
Generate Operator
Generate Destructor

Make const
Make static
Add noexcept
Add [[nodiscard]]

Convert to std::string_view
Convert to auto

Remove unused include
Sort includes
Forward declare
```

---

# 13. Navigation

Add a dedicated C++ navigation layer.

### Peek Definition

Inline definition without leaving the current file.

### Peek References

```text
calculateId()

7 references
```

### Call Hierarchy

```text
ObjectStore::store()
│
├── calculatePath()
│   └── Blob::id()
│
└── writeObject()
```

Reverse:

```text
Who calls ObjectStore::store()?

Repository::writeBlob()
└── ObjectStore::store()
```

---

# 14. C++ Debugger

The debugger should be selected automatically based on the toolchain.

Conceptually:

```text
MSVC
  ↓
cppvsdbg / appropriate Microsoft debugger

Clang / GCC
  ↓
LLDB / GDB
```

The user only sees:

```text
🐞 Debug
```

---

# 15. C++ Debugger Features

Priority features:

### Locals

```text
blob
├── content_
├── id_
├── serialized_
└── repository_
```

### Inline values

```cpp
auto hash = calculateHash();
               // "74a8c1..."
```

### Call stack

```text
ObjectStore::store()
Blob::id()
Repository::writeBlob()
main()
```

### Watch

```text
blob.id()
repository_.getPath()
```

### Threads

```text
Thread 1824   main
Thread 9320   Worker
Thread 10444  Worker
```

### Breakpoints

Support:

* conditional breakpoints
* hit counts
* logpoints
* breakpoint groups
* enable/disable
* temporary breakpoints

### Run to Click

Click a line while paused → continue until that line.

---

# 16. STL Visualizers

One of the highest-value C++ features.

Instead of internal implementation details:

```text
std::vector
└── _Mypair
    └── ...
```

show:

```text
vector<int>

size: 4
capacity: 8

[0] 10
[1] 20
[2] 30
[3] 40
```

Implement visualizers for:

```text
std::vector
std::array
std::string
std::string_view
std::map
std::unordered_map
std::optional
std::variant
std::unique_ptr
std::shared_ptr
std::filesystem::path
std::span
std::tuple
```

This could become one of the defining features of your fork.

---

# 17. Memory Viewer

Dedicated debugger panel:

```text
MEMORY

Address          +0 +1 +2 +3 +4 +5 +6 +7
──────────────────────────────────────────
000001F4A81200   48 65 6C 6C 6F 00 ...
000001F4A81208   74 65 73 74 00 ...
```

Views:

```text
Hex
ASCII
Integer
Float
Pointer
```

Actions:

```text
Follow pointer
Follow address
Watch memory
```

---

# 18. Sanitizers

Make sanitizers selectable like build configurations.

```text
Debug
Release
RelWithDebInfo
ASan
UBSan
TSan
```

Eventually allow:

```text
🧪 Run with ASan
```

without the user manually editing CMake flags.

---

# 19. Profiling

Later-stage feature.

Provide:

```text
PROFILE

CPU
Memory
Allocations
Threads
File I/O
```

Example:

```text
CPU PROFILE

SHA256::digest       41.2%
ObjectStore::store   22.8%
filesystem::exists   14.3%
ofstream::write       8.1%
```

---

# 20. Build Performance Analysis

Eventually:

```text
BUILD ANALYSIS

Total: 12.43s

Blob.cpp              1.82s
Repository.cpp        1.44s
SHA256.cpp             .91s
ObjectStore.cpp        .83s
```

And eventually header impact:

```text
openssl/sha.h
├── Blob.cpp
├── SHA256.cpp
├── Repository.cpp
└── ...
```

---

# 21. C++-Specific UI

### Sidebar

```text
CMAKE
────────────────
Targets

▾ MiniGit
  MiniGit
  MiniGitTests

Configurations
  MSVC Debug
  MSVC Release
  Clang Debug
  Clang ASan
```

### Bottom panel

C++:

```text
PROBLEMS
BUILD
CMAKE
TERMINAL
DEBUG
MEMORY
```

Non-C++:

```text
PROBLEMS
OUTPUT
TERMINAL
DEBUG CONSOLE
```

The C++ UI should **appear dynamically**, rather than making VSCodium permanently look like a C++ IDE.

---

# 22. Implementation Phases

## Phase 1 — Foundation

**Goal: make C++ projects first-class.**

* [ ] Detect C++ projects
* [ ] Detect CMake
* [ ] Detect `CMakePresets.json`
* [ ] Detect installed toolchains
* [ ] C++ workspace activation
* [ ] C++ toolbar
* [ ] Target selector
* [ ] Configuration selector
* [ ] Basic CMake integration

---

## Phase 2 — Build System

**Goal: make build/run effortless.**

* [ ] CMake configure
* [ ] CMake build
* [ ] Rebuild
* [ ] Clean
* [ ] Target builds
* [ ] Build output parser
* [ ] Structured errors/warnings
* [ ] Build → source navigation
* [ ] Run target
* [ ] Build + Run

---

## Phase 3 — clangd Integration

**Goal: make clangd configuration automatic.**

* [ ] Manage clangd
* [ ] Detect compilation database
* [ ] Connect CMake configuration to clangd
* [ ] Update clangd when configuration changes
* [ ] Toolchain-aware compilation commands
* [ ] C++ symbol panel
* [ ] Call hierarchy
* [ ] Peek definition/references

---

## Phase 4 — Debugging

**Goal: reach Visual Studio-level everyday debugging.**

* [ ] Automatic debugger selection
* [ ] Build + Debug
* [ ] Breakpoints
* [ ] Conditional breakpoints
* [ ] Logpoints
* [ ] Locals
* [ ] Watch
* [ ] Call stack
* [ ] Threads
* [ ] Inline values
* [ ] Run to Click
* [ ] Breakpoint groups

---

## Phase 5 — C++ Native Experience

**Goal: make the fork feel genuinely C++-focused.**

* [ ] STL visualizers
* [ ] `std::optional` visualizer
* [ ] Smart pointer visualizers
* [ ] `std::filesystem` visualizer
* [ ] Memory viewer
* [ ] C++ code actions
* [ ] Generate definitions
* [ ] Include optimization
* [ ] Better template diagnostics

---

## Phase 6 — Advanced Tooling

**Goal: go beyond normal VS Code.**

* [ ] ASan
* [ ] UBSan
* [ ] TSan
* [ ] Profiling
* [ ] Allocation profiling
* [ ] CPU profiling
* [ ] Build performance analysis
* [ ] Header dependency analysis
* [ ] Compile-time analysis

---

# 23. The Core User Experience

The final workflow should basically be:

```text
Open C++ project
       ↓
C++ detected
       ↓
CMake detected
       ↓
Presets detected
       ↓
Toolchains detected
       ↓
Select:
   MiniGit
   MSVC Debug
       ↓
CMake configure
       ↓
compile_commands.json
       ↓
clangd
       ↓
      CODE
       ↓
   ┌───┴────┐
   ↓        ↓
 Build     Debug
   ↓        ↓
Errors    Inspect
   ↓        ↓
 Fix ←─────┘
```

And the user should **rarely need to think about the underlying commands**.

---

# 24. Design Principle

The most important rule for the whole project:

> **Don't replace existing excellent tools. Orchestrate them.**

```text
clangd   → C++ intelligence
CMake    → project/build model
MSVC     → Microsoft compiler
Clang    → LLVM compiler
GCC      → GNU compiler
LLDB     → debugging
GDB      → debugging
Ninja    → building
vcpkg    → dependencies
VSCodium → editor/UI/orchestration
```

Your fork becomes the layer that makes all of these tools feel like **one coherent C++ development environment**.

### Priority

If you come back to this months from now, the short version is:

```text
1. C++ project detection
2. CMake integration
3. CMake Presets
4. Toolchain manager
5. C++ toolbar
6. Build / Run
7. clangd ↔ CMake integration
8. Debugger integration
9. STL visualizers
10. Sanitizers
11. Profiling
12. Build analysis
```

**The first milestone should be:**

> **Open a CMake C++ project → automatically detect MSVC/Clang → select a preset → configure → clangd gets the correct compilation database → Build/Run/Debug all work from one toolbar.**

Once that foundation exists, almost every other feature on this roadmap can build on top of it.
