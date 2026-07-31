# TODO List for NULL IDE

* [x] Restricted mode is annoying!!
* [x] better window information need to see instantly which project

## AI Features

* [x] AI Agents panel fixes (History/Rendering (Width bug))
* [x] AI chat history persistence
* [x] Prompt templates
* [x] AI context & workspace awareness
* [x] AI quick-fix/code actions
* [x] Local Ollama integration
* [X] Proper plan integration to Claude Code similar to Antigravity (Open plan after creating it and reviewing)
* [ ] Open and approve changes on edits (terminal mode) (this open after i approve in terminal fix) (only works when edited file is open in editor)
* [x] Show ai title
* [ ] Copy from terminal not working
* [x] Init new tabs not working anymore

---

## Git Features

* [ ] Fallback for git commit gen (usage/rate limit)
* [ ] Commit templates per repo
* [ ] Interactive staging UI
* [ ] Workspace dirty-state overview
* [ ] Auto conventional commit validation

---

## NULL-Specific Features

* [x] Jump list recent projects
* [x] Explorer preview integration
* [x] Better file association management and icons
  Covers 52 extensions across 32 icon keys now (see docs/specs/file-association-design.md).
  Known gap: extensionless filenames (bare Makefile, CMakeLists.txt) aren't
  supported — the registration mechanism is extension-keyed, not filename-keyed.
* [ ] Distraction-free / minimal coding mode
* [ ] Integrated scratchpad/temp files
* [ ] Built-in quick notes panel
* [ ] Floating terminal mode
* [ ] Fix broken updater
* [x] The command null . needs to have a open powershell if i close the shell the ide closes this is unconvenient


---

## Windows Packaging

* [ ] Winget package
* [ ] Scoop package
* [ ] Chocolatey package

---

## Markdown System

* [x] Export to PDF
* [x] Wiki links
* [x] Presentation/slides mode

---

## Performance / Engineering

* [ ] Lazy-load AI panel
* [ ] Crash recovery
* [ ] Safe mode (disable all extensions)
* [ ] Startup profiler
* [ ] Extension performance monitor
* [ ] Memory diagnostics panel
* [ ] Large file optimizations

---

## Someday / Future

These need external infrastructure, significant effort, or are low priority.

* [ ] Settings sync
* [ ] Built-in feedback system
* [ ] Theme marketplace
* [ ] Community extensions list
* [ ] Roadmap page
* [ ] Linux support
* [ ] NULL file explorer redesign
* [ ] Reduced RAM mode
* [ ] Workspace mood/theme auto-switching
