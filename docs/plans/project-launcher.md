# Project Launcher Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the jump list's "More Recent Projects..." dashboard tab with a standalone `null_launcher.exe` that lists every tracked project and opens the chosen one without touching any open window.

**Architecture:** A new top-level `launcher/` Rust package (own workspace, not part of `setup/`): a library holding all pure logic (store, fuzzy search, branch/type detection, URI building, fallback log) and a thin Tauri binary that serves a plain HTML/CSS/JS page. The page's rules live in a plain script (`launcher-model.js`) tested with `node --test`, loaded through `node:vm` exactly like `setup/ui/wizard-model.js`. Patch 001 launches the exe from the jump list and falls back to today's URI task when the exe is absent.

**Tech Stack:** Rust 2021, Tauri 2 (`custom-protocol` feature, as `setup/app`), `serde`/`serde_json`, `winreg` (WebView2 probe) and `windows` (mutex, foreground window) on Windows only, `tempfile` (dev). Plain JS UI, `node:test`. A git patch against the VS Code tree.

**Spec:** `docs/specs/project-launcher-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Store file is `null-recent-projects.json` in the user-data folder: `<install>\data\user-data` when `<install>\data` is a directory (portable), else `%APPDATA%\Null`. `<install>` is the folder holding `null_launcher.exe`. The entry format is unchanged and unknown fields survive a write.
- Missing, corrupt, non-array or unreadable store → empty list. Entries that fail the same validity rules as `readEntry` in `extensions/null-tools/src/recentProjects.ts` (string `path`/`label`, boolean `isWorkspaceFile`, numeric `timestamp`, `pinned` absent or boolean) are skipped.
- Writes are atomic: sibling temp file `<file>.<pid>.tmp`, then rename; remove the temp file after a failed write. Every pin/remove re-reads the file first and changes only the one entry. The launcher never prunes (Null prunes on its next open) and never writes on open.
- Display order: pinned entries first, then unpinned; each group by `timestamp` descending, stable.
- Search: case-insensitive; name (`label`) is a subsequence match, path is a plain substring match; name matches rank above path-only matches regardless of recency; a blank query returns everything in display order.
- Opening runs `null.exe` from the launcher's folder with `--folder-uri <uri>` (or `--file-uri <uri>` for `isWorkspaceFile`) as separate arguments, never `--reuse-window`, detached, working directory the temp folder; the launcher then exits. The webview sends only a `path`; the host re-reads the store and acts on the matching stored entry, never on the path as given.
- Pinned entries ignore Delete. A missing folder is never opened. Relocation stays in the dashboard.
- Window: frameless, 640 px wide, always on top, no taskbar button, hidden until the page calls `ready`, closes on Esc or on losing focus — but never on a blur that happens before the window has been focused once. Window title `Null Launcher`. Text is at least 11 px; colours follow `prefers-color-scheme`.
- Failure to start (WebView2 missing, the Tauri run returning an error) runs `null.exe --open-url -- null://null.null-tools/recent-projects` silently and appends the reason to `launcher.log` in the user-data folder; the log is rewritten to just the new line once it exceeds 65 536 bytes.
- Only one launcher: a second start brings the first one forward and exits 0 (named mutex `Local\NullLauncher`).
- `null.recentProjects.maxItems` default is `50` everywhere it appears (was `20`).
- No crates beyond those listed in Tech Stack. Windows-only code is behind `cfg(windows)` so `cargo test` for the library logic needs nothing else.
- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never hand-edit `extensions/null-tools/out/`.

## Review Focus

- Store file missing, empty, `{}` or half-written JSON must give an empty list and no panic — Task 1.
- A store written by Null while the launcher holds an old copy: pin/remove re-read first and keep other entries and unknown fields — Task 1.
- Paths with spaces, `#`, `%`, non-ASCII or a UNC share must reach `null.exe` as a valid file URI — Task 4.
- A query of `c++`, `[`, `(`, `\` or only spaces is literal text / blank, never an error — Task 2.
- `.git` that is a file pointing at a missing folder, an unreadable or empty `HEAD`, or a folder that no longer exists: no chip, no error — Task 3.
- A blur that arrives before the window ever had focus (Windows refusing the first focus) must not close it — Task 5.
- Double-clicking the jump-list entry must not stack two launchers — Task 6.

---

### Task 1: Package skeleton and store

**Files:**
- Create: `launcher/Cargo.toml`, `launcher/Cargo.lock` (generated), `launcher/src/lib.rs`, `launcher/src/store.rs`
- Modify: `.gitignore` (add `launcher/target/` next to `setup/target/`)

**Interfaces:**
- Produces (`null_launcher::store`):
  - `pub struct Entry { pub path: String, pub label: String, pub is_workspace_file: bool, pub timestamp: serde_json::Number, pub pinned: bool, pub extra: serde_json::Map<String, serde_json::Value> }` — `Serialize`/`Deserialize`, `rename_all = "camelCase"`, `pinned` defaults to `false`, `extra` is `#[serde(flatten)]`.
  - `pub fn user_data_dir(install: &Path, appdata: Option<&Path>) -> Option<PathBuf>`
  - `pub fn store_path(user_data: &Path) -> PathBuf` (`null-recent-projects.json`)
  - `pub fn read(file: &Path) -> Vec<Entry>` (raw file order)
  - `pub fn display_order(entries: Vec<Entry>) -> Vec<Entry>`
  - `pub fn write_atomic(file: &Path, entries: &[Entry]) -> std::io::Result<()>`
  - `pub fn normalize(path: &str) -> String` (lowercase, `/` → `\`, trailing separators trimmed — Windows path identity)
  - `pub fn set_pinned(file: &Path, path: &str, pinned: bool) -> std::io::Result<bool>` and `pub fn remove(file: &Path, path: &str) -> std::io::Result<bool>` — `Ok(false)` when no entry matches; `remove` also returns `Ok(false)` for a pinned entry and leaves the file untouched.

- [ ] **Step 1: Create the package.** `launcher/Cargo.toml`: package `null-launcher` 0.1.0 edition 2021, `[lib] name = "null_launcher"`, an empty `[workspace]` table (keeps it out of `setup/`), dependencies `serde` (derive) and `serde_json`, dev-dependency `tempfile = "3"`, and the same `[profile.release]` block as `setup/Cargo.toml`. `src/lib.rs` is `pub mod store;`. Add the `.gitignore` line.
- [ ] **Step 2: Write the failing tests** in `store.rs` (`#[cfg(test)] mod tests`, using `tempfile`):
  - `read_missing_file_is_empty`, `read_corrupt_json_is_empty`, `read_object_instead_of_array_is_empty`, `read_empty_file_is_empty`.
  - `read_skips_invalid_entries_keeps_valid`: array with one good entry, one with a numeric `path`, one with `"pinned": null`, one that is a string → exactly the good one remains.
  - `legacy_entry_defaults`: four-field entry reads with `pinned == false`.
  - `unknown_fields_survive_a_round_trip`: entry with `"gitBranch":"main"` and `"icon":"x"` → `write_atomic` then `read` keeps both in `extra`.
  - `display_order_pins_first_then_newest`: timestamps 5(unpinned), 3(pinned), 9(unpinned), 1(pinned) → order 3,1,9,5 by timestamp within group → `[pinned 3, pinned 1, unpinned 9, unpinned 5]`.
  - `set_pinned_changes_only_that_entry_and_rereads`: write A,B; call `set_pinned` for `"d:\\CODING\\a"` (case differs from stored `D:\Coding\a`) → only A flips; a third entry C appended to the file by the test *before* the call (simulating Null's write) is still there afterwards.
  - `remove_refuses_pinned_and_removes_unpinned`, `remove_unknown_path_is_false`.
  - `no_temp_file_left_behind`: after a write, the folder contains only the store file.
  - `user_data_dir_portable_when_data_folder_exists` (`install/data` created → `install/data/user-data`), `user_data_dir_falls_back_to_appdata_null`, `user_data_dir_none_without_appdata_or_data`.
- [ ] **Step 3: Run `cargo test --locked` in `launcher/`** (first run without `--locked` to create `Cargo.lock`). Expected: FAIL, functions undefined.
- [ ] **Step 4: Implement** the interfaces. `read` parses a `Vec<serde_json::Value>` and `from_value`s each element (invalid → skipped). `set_pinned`/`remove` compare with `normalize`.
- [ ] **Step 5: Run `cargo test --locked`.** Expected: all pass.
- [ ] **Step 6: Commit** `feat(launcher): store reading and atomic pin/remove` with `launcher/Cargo.toml launcher/Cargo.lock launcher/src .gitignore`.

---

### Task 2: Fuzzy search

**Files:**
- Create: `launcher/src/search.rs`; Modify: `launcher/src/lib.rs` (`pub mod search;`)

**Interfaces:**
- Consumes: `store::Entry` (a slice already in display order).
- Produces: `pub fn search(entries: &[Entry], query: &str) -> Vec<usize>` — indices into `entries`, best first.

- [ ] **Step 1: Write the failing tests** (build entries with a small helper `e(label, path)`):
  - `blank_query_returns_all_in_order` (also `"   "`).
  - `subsequence_matches_name`: `"nide"` finds `null-ide`; `"ntn"` finds `null-notes`; `"xyz"` finds nothing.
  - `case_insensitive`: `"NULL"` finds `null-ide`.
  - `contiguous_beats_scattered`: query `"ide"` over `[zzz-i-d-e, zzz-ide]` → `zzz-ide` first even though listed second.
  - `name_match_beats_path_only_match_regardless_of_order`: entry 0 path `D:\ide\other` label `other`; entry 1 label `ide-tool` → `[1, 0]`.
  - `ties_keep_input_order`.
  - `path_is_substring_not_fuzzy`: query `"dcn"` does not match path `D:\Coding\null` (but would be a subsequence).
  - `special_characters_are_literal`: `"c++"`, `"["`, `"("`, `"\\"` do not panic; `"c++"` matches label `c++-lib`.
- [ ] **Step 2: Run `cargo test --locked search`.** Expected: FAIL.
- [ ] **Step 3: Implement `search`.** Trim the query; blank → all indices. Score a name match so a lower number is better and contiguous runs and an earlier first match win (for example span length from first to last matched character); sort name matches by (score, index), then append path-substring matches in index order.
- [ ] **Step 4: Run `cargo test --locked`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(launcher): fuzzy project search`.

---

### Task 3: Branch, type and existence

**Files:**
- Create: `launcher/src/meta.rs`; Modify: `launcher/src/lib.rs`

**Interfaces:**
- Consumes: `store::Entry`.
- Produces:
  - `pub fn project_dir(entry: &Entry) -> PathBuf` — the folder, or a workspace file's parent folder.
  - `pub fn exists(entry: &Entry) -> bool` — folder is a dir / workspace file is a file.
  - `pub fn git_branch(dir: &Path) -> Option<String>`
  - `pub fn project_type(dir: &Path) -> Option<&'static str>` — `"Rust"`, `"CMake"`, `".NET"`, `"Node"`.

- [ ] **Step 1: Write the failing tests** (temp dirs):
  - `branch_from_head_ref`: `.git/HEAD` = `ref: refs/heads/feat/nav\n` → `feat/nav`.
  - `detached_head_shows_short_hash`: 40-hex → first 7 characters.
  - `worktree_git_file_is_followed`: `.git` is a file `gitdir: ../real-git` (relative to the project) with a `HEAD` there → branch from it.
  - `no_repo_unreadable_or_empty_head_is_none`: no `.git`; `.git` file pointing nowhere; empty `HEAD`.
  - `type_order_first_marker_wins`: folder with `Cargo.toml` and `package.json` → `Rust`; `CMakeLists.txt` → `CMake`; `x.sln` or `x.csproj` → `.NET`; only `package.json` → `Node`; nothing or unreadable folder → `None`. (Mirrors `MARKERS` in `extensions/null-tools/src/projectType.ts`; leave a comment naming it.)
  - `project_dir_of_workspace_file_is_parent`, `exists_checks_kind`.
- [ ] **Step 2: Run `cargo test --locked meta`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Read `HEAD` once; no `git` process.
- [ ] **Step 4: Run `cargo test --locked`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(launcher): git branch and project type detection`.

---

### Task 4: Opening and the failure fallback

**Files:**
- Create: `launcher/src/open.rs`, `launcher/src/fallback.rs`; Modify: `launcher/src/lib.rs`

**Interfaces:**
- Consumes: `store::Entry`.
- Produces:
  - `open::file_uri(path: &str) -> String`
  - `open::launch_args(entry: &Entry) -> Vec<String>` — `["--folder-uri", uri]` or `["--file-uri", uri]`.
  - `open::spawn_null(null_exe: &Path, args: &[String]) -> std::io::Result<()>` — detached (`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`), cwd `std::env::temp_dir()`, as `start_widgets` does in `setup/core/src/shell/sys.rs`.
  - `fallback::FALLBACK_URL: &str = "null://null.null-tools/recent-projects"`
  - `fallback::fallback_args() -> Vec<String>` = `["--open-url", "--", FALLBACK_URL]`
  - `fallback::log_failure(user_data: &Path, message: &str)` — never fails, never panics.

- [ ] **Step 1: Write the failing tests:**
  - `file_uri`: `D:\Coding\Apps\null-ide` → `file:///D:/Coding/Apps/null-ide`; `D:\My Proj\a#b%c` → `file:///D:/My%20Proj/a%23b%25c`; `D:\Café` → `file:///D:/Caf%C3%A9`; `\\srv\share\x y` → `file://srv/share/x%20y`. Unreserved characters and `/` stay, everything else is percent-encoded as UTF-8 bytes.
  - `launch_args_folder_vs_workspace`: `--folder-uri` for a folder entry, `--file-uri` for `isWorkspaceFile`; the URI is a separate element (no quotes).
  - `fallback_args_match_the_old_jump_list_task`.
  - `log_failure_appends_a_line_with_the_message`, `log_failure_restarts_the_file_past_65536_bytes` (pre-fill 70 000 bytes → afterwards the file holds only the new line), `log_failure_in_missing_folder_does_not_panic`.
- [ ] **Step 2: Run `cargo test --locked open fallback`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `log_failure` writes `<unix seconds> <message>\n` to `launcher.log`.
- [ ] **Step 4: Run `cargo test --locked`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(launcher): file URIs, launch arguments and failure log`.

---

### Task 5: Page rules (JS model)

**Files:**
- Create: `launcher/ui/launcher-model.js`, `launcher/ui-tests/launcher-model.test.mjs`

**Interfaces:**
- Produces (plain-script globals, as `wizard-model.js`):
  - `groupRows(rows) -> [{title: 'Pinned'|'Recent', start: number, rows: object[]}]` — `rows` are in display order with a boolean `pinned`; empty groups omitted; `start` is the flat index of the group's first row.
  - `moveSelection(selected, delta, count) -> number` — wraps; `count === 0` → `0`.
  - `keyAction({key, ctrlKey}, row) -> {type, delta?, preventDefault} | null` — `type` is `'open' | 'pin' | 'remove' | 'close' | 'move'`; `row` may be `undefined` (empty result) and has `pinned` and `missing`.
  - `shouldCloseOnBlur(everFocused) -> boolean`
  - `formatAge(timestampMs, nowMs) -> string`

- [ ] **Step 1: Write the failing tests** (load with `vm.createContext` like `setup/ui-tests/wizard-model.test.mjs`):
  - `groupRows` pinned+recent, only recent, only pinned, empty.
  - `moveSelection` wraps both ways and handles `count` 0.
  - `keyAction`: Enter on a normal row → open; Enter on `missing` → `null`; Enter with no row → `null`; Escape → close; ArrowDown/ArrowUp → move +1/−1 with `preventDefault: true`; `ctrlKey` + `p` (also `P`) → pin with `preventDefault: true` even without a row; Delete on unpinned → remove; Delete on pinned → `null`; Delete on `missing` unpinned → remove; a letter key → `null` with nothing prevented.
  - `shouldCloseOnBlur(false) === false`, `(true) === true`.
  - `formatAge`: 20 s → `just now`; 5 min → `5m ago`; 3 h → `3h ago`; 30 h → `yesterday`; 4 d → `4d ago`; 45 d → `1mo ago`; a future timestamp → `just now`.
- [ ] **Step 2: Run `node --test launcher/ui-tests/launcher-model.test.mjs`.** Expected: FAIL.
- [ ] **Step 3: Implement** the functions in `launcher-model.js`.
- [ ] **Step 4: Run the test again.** Expected: pass.
- [ ] **Step 5: Commit** `feat(launcher): page rules and tests`.

---

### Task 6: Tauri shell and page

**Files:**
- Create: `launcher/src/main.rs`, `launcher/src/webview2.rs`, `launcher/build.rs`, `launcher/tauri.conf.json`, `launcher/capabilities/default.json`, `launcher/icons/icon.ico` (copy `setup/app/icons/icon.ico`), `launcher/ui/index.html`, `launcher/ui/launcher.css`, `launcher/ui/launcher.js`
- Modify: `launcher/Cargo.toml` (add `[[bin]] name = "null_launcher"`, `tauri` 2 with `custom-protocol` default feature as `setup/app/Cargo.toml`, `tauri-build` build-dependency, `[target.'cfg(windows)'.dependencies] winreg` and `windows` with only the features used), `launcher/Cargo.lock`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: Tauri commands (JS names are the camelCase of these, arguments camelCase), all validating against a fresh `store::read`:
  - `search(query: String) -> Vec<Row>` with `Row { path, label, isWorkspaceFile, pinned, timestamp, storedBranch: Option<String>, storedType: Option<String> }` in `display_order`, filtered by `search::search`.
  - `project_meta(path: String) -> Meta { branch: Option<String>, projectType: Option<String>, missing: bool }` (async; runs `meta::*`).
  - `open_project(path: String) -> Result<(), String>`: missing → `Err`; else `open::spawn_null` then exit the app.
  - `toggle_pin(path: String) -> Result<(), String>`, `remove_project(path: String) -> Result<(), String>`, `ready()` (shows and focuses the window), `close_launcher()`.
- Window config in `tauri.conf.json`: label `main`, title `Null Launcher`, 640×460, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, `center: true`, `visible: false`; CSP `default-src 'self'; style-src 'self'`; `withGlobalTauri: true`.
- Test seams: env `NULL_LAUNCHER_USER_DATA` overrides the user-data folder, `NULL_LAUNCHER_NULL_EXE` overrides the `null.exe` path (for `cargo run` against fake data).

- [ ] **Step 1: Write `webview2.rs`** with `pub fn installed() -> bool`, the same registry probes as `setup/core/src/webview2.rs` (copy, with a comment naming the source; the launcher must not depend on `setup/core`).
- [ ] **Step 2: Write `main.rs`.** `#![cfg_attr(windows, windows_subsystem = "windows")]`. Order: take the named mutex `Local\NullLauncher` — if it already exists, find the window titled `Null Launcher`, `SetForegroundWindow` it, exit 0; resolve user-data dir and `null.exe` (sibling of the exe); if `!webview2::installed()` or the Tauri run returns an error → `fallback::log_failure`, `open::spawn_null(null_exe, &fallback::fallback_args())`, exit 0. Register the commands above. In the setup hook, move the window to the monitor under the cursor when Tauri can find one, else leave it centred.
- [ ] **Step 3: Write the page.** `index.html` loads `launcher-model.js` then `launcher.js`. `launcher.js`: on load focus the search box, call `search('')`, render `groupRows` (section headers `Pinned` / `Recent`, selected row highlighted and scrolled into view; row = name, branch chip, type chip, `formatAge` + path right-aligned; `missing` rows greyed with a `missing` chip), then fire `project_meta` for each row without awaiting the others and fill chips / mark `missing` as results arrive (a stored branch/type shows until the live value replaces it), then call `ready`. Input event → `search`; `keydown` → `keyAction` (apply `preventDefault` when it says so) → `open_project` / `toggle_pin` / `remove_project` (re-run `search` after the last two, keeping the selection index) / `close_launcher`; track `everFocused` from the window's focus event and close on blur only when `shouldCloseOnBlur(everFocused)`. `launcher.css`: `prefers-color-scheme` light and dark, monospace stack from the Null theme (`Geist Mono`, `JetBrains Mono`, `Cascadia Code`), nothing below 11 px.
- [ ] **Step 4: Build.** Run `cargo build --release --locked` in `launcher/`. Expected: success; `target/release/null_launcher.exe` exists.
- [ ] **Step 5: Manual run against fake data.** Create a temp folder with a `null-recent-projects.json` of ~6 entries (two pinned, one pointing at a folder that does not exist, one with a space in its path, two with the same folder name under different parents, one a real git repo and one a Cargo project), then `$env:NULL_LAUNCHER_USER_DATA=<temp>; $env:NULL_LAUNCHER_NULL_EXE=<path to any exe that prints its arguments, e.g. a copy of a tiny script wrapper>; launcher\target\release\null_launcher.exe`. Check: window appears centred without a taskbar button, chips fill in, the missing row is greyed and Enter on it does nothing, `nide`-style fuzzy filtering reorders rows, Ctrl+P pins and Delete removes an unpinned row (verify the JSON), Delete on a pinned row does nothing, Enter spawns the stand-in with `--folder-uri file:///…` and the launcher exits, Esc closes, clicking another window closes it, a second start while open raises the first instead of opening another.
- [ ] **Step 6: Commit** `feat(launcher): Tauri shell and project picker page`.

---

### Task 7: Jump-list patch and the 50-item default

**Files:**
- Modify: `patches/001-jumplist-recent-projects.patch`, `extensions/null-tools/package.json` (`null.recentProjects.maxItems.default` → `50`), `extensions/null-tools/src/dashboard.ts:162` (`get<number>('maxItems', 50)`), `docs/wiki/Configuration.md:46`, refreshed `extensions/null-tools/out/`

**Interfaces:**
- Consumes: the exe name `null_launcher.exe` from Task 6.

- [ ] **Step 1: Build a scratch copy to edit the patch against.** In a temp git repo, put `src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts` as it is in `vscode-src` before patch 001 (confirm with `git apply --check patches/001-jumplist-recent-projects.patch` there), apply patch 001, commit.
- [ ] **Step 2: Edit in the scratch copy.** (a) `nullRecentProjectsMaxItems()` fallback `20` → `50`. (b) Before the `// Tasks` array in `updateWindowsJumpList`, compute `const launcherExe = join(process.execPath, '..', 'null_launcher.exe');` and `const hasLauncher = await fsPromises.access(launcherExe).then(() => true, () => false);` (no new imports). (c) The "More Recent Projects..." task uses `program: hasLauncher ? launcherExe : process.execPath` and `args: hasLauncher ? '' : '--open-url -- "null://null.null-tools/recent-projects"'`; update its comment to say the launcher is the primary path and the URI task the fallback.
- [ ] **Step 3: Regenerate patch 001** from the scratch diff, keeping its header and the hunks you did not touch byte-identical. Verify: `git apply --check --ignore-whitespace patches/001-jumplist-recent-projects.patch` against the pristine copy from Step 1 exits 0, and the other patches still apply in order (`git apply --check` each against `vscode-src`'s state, or note that CI's "patches apply" step is the check).
- [ ] **Step 4: Change the default** in `package.json`, `dashboard.ts`, and the wiki table row. Run `npm run compile` and `npm test` in `extensions/null-tools`. Expected: pass.
- [ ] **Step 5: Commit** two commits: `feat(patches): launch the project launcher from the jump list (001)` with the patch, and `feat(null-tools): default recent projects retention to 50` with `package.json`, `dashboard.ts`, the wiki row; then `chore: refresh null-tools compiled output` with `out/`.

---

### Task 8: CI, local build, docs, follow-up issue

**Files:**
- Modify: `.github/workflows/build.yml`, `scripts/build-local.ps1`, `CLAUDE.md` (repository layout and build steps), `docs/specs/project-launcher-design.md`
- Create: `launcher/CLAUDE.md`

- [ ] **Step 1: CI.** In `build-windows`, after "Build null-setup" add steps (working directory `ide-overlay/launcher`): `cargo test --locked`; `node --test ide-overlay/launcher/ui-tests/launcher-model.test.mjs`; `cargo build --release --locked`. In "Prepare release payload" copy `ide-overlay/launcher/target/release/null_launcher.exe` into `$outDir` next to `null.exe`. Mirror the build, the tests and the copy in `scripts/build-local.ps1` beside the `null-setup` step.
- [ ] **Step 2: Docs.** Write `launcher/CLAUDE.md` (what it is, the store contract and display order, that it never prunes or writes on open, the two test seams, the fallback and log, why it is not part of `null-setup.exe`). Add the `launcher/` directory to the layout block and the build step to `CLAUDE.md`. In the design doc's "Build, packaging, lifecycle" replace the paragraph that says the swap must end a running `null_launcher.exe` like `null_widgets.exe`: `procs::close_all` already closes every process under the install folder (WM_CLOSE first, then the locked-files prompt), and the launcher has a real window, so no `stop_widgets`-style change is made. If `docs/wiki/` mentions "More Recent Projects", update that sentence.
- [ ] **Step 3: Verify.** `cargo test --locked` and the node test pass again from a clean checkout state (`git status` clean apart from the commit). The CI run and the jump-list click in a built package cannot be verified locally; record in the commit body that they are untested until a CI build exists, and list the manual checks from the design's Testing section.
- [ ] **Step 4: Commit** `build: build and ship null_launcher.exe` (workflow and script), `docs: document the project launcher` (CLAUDE.md files and spec).
- [ ] **Step 5: File the follow-up.** Run `/file-issue` for "null-tools `nullDataDir()` ignores portable mode, so the dashboard may read a different `null-recent-projects.json` than the one Null writes": the patch uses `environmentMainService.userDataPath` (`<install>\data\user-data` when portable) while `extensions/null-tools/src/dataDir.ts` always returns `%APPDATA%\Null` on Windows.
