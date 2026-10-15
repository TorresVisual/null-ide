# Null Setup, Sub-project 2a: Installer Engine Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Give `null-setup` the install, modify, repair and uninstall modes (headless, driven by an `install-config.json` and a build-generated `builtins.json`), so that unchecked built-in extensions are left off disk, updates honor the saved choices, and every registration can be switched on and off individually.

**Architecture:** `setup/core` gains `builtins` (manifest, dependency resolution, pruning), `install_config` (the saved choices and the `Feature` list), and `manage` (modify-in-place, uninstall). The existing `update` pipeline becomes `Install | Update | Repair` through an `Opts.kind`, so a fresh install uses the same fetch, verify, stage, journaled swap and rollback as an update. Registrations stay in `install-null-ide.ps1` (still the shipped registration script) but gain a per-feature `-Register` / `-Unregister` interface that `registrations::apply` drives. `setup/app` gets the four new CLI modes; there is no window yet.

**Tech Stack:** Rust (`serde`, `serde_json`, `zip`, `tempfile` — no new crates), Node (`scripts/gen-builtins.mjs`, `node --test`), PowerShell (one new dispatch block), GitHub Actions YAML.

**Spec:** `docs/specs/null-setup-installer-design.md` — this plan is the first of three slices of its "Sub-project 2": **2a engine (this plan)**, **2b** port the registrations from PowerShell to Rust (`shell` module, retire `install-null-ide.ps1`), **2c** wizard UI, `first-run.json` consumer + `Null: Setup` in null-tools, release the stub installer, retire Inno. Each slice ships working, tested software; 2a is reachable from the command line only.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Supported Windows: Windows 11 and Windows 10 22H2. No code signing; SHA256 only guards against corruption.
- "Core" built-ins are locked and cannot be left off: `null-tools`, `null-accounts`, `null-theme`, `null-icons`.
- Unchecked built-ins are left off disk; built-ins are discovered by scanning `resources/app/extensions/`. The installer never writes inside `%APPDATA%\Null\User\` and never touches extension state.
- Only a fresh install or `modify` may elevate; `update` and `repair` never do (`allow_elevate` is false for them).
- `%APPDATA%\Null` (settings, extensions, data) is kept on uninstall unless "delete my settings" was asked for.
- Paths: `<installDir>\.null-ide-install.json` keeps its fields; `<installDir>\install-config.json` and `<installDir>\builtins.json` are new; log `%LOCALAPPDATA%\Null\logs\setup-<timestamp>.log`.
- Installs without an `install-config.json` (everything built before this plan) behave exactly as before: the three registry registrations are re-applied on update, no built-in is removed.
- Not in this plan (deferred on purpose): wizard UI and the stub `NullIDESetup-<version>.exe` (2c), `first-run.json` and `Null: Setup` (2c), the Add/Remove Programs entry and retiring Inno (2c), porting registrations to Rust (2b), the `marketplace` and `settings` tables of `builtins.json` (2c adds them when the wizard reads them).
- Editing rules from `CLAUDE.md`: Rust here was written without a compiler; if a crate API differs in its minor version, adjust the call, keep the behavior and the tests. Do not run `scripts/build-local.ps1`; edit it only. Work only inside `D:\Coding\Apps\null-ide\`.
- Commit per task with the repo style (`feat(setup): …`, `build: …`, `docs: …`). Do not push. End every commit message with the attribution line the harness gives (`Co-Authored-By: …`).

## Review Focus

Most likely first. Each line is pinned by a test in the task named in brackets.

1. `install --install-dir` pointing at a folder that already holds someone's files (or an existing Null install): the swap would rename it aside and delete it on commit. It must refuse and touch nothing. [Task 6]
2. A saved config that names a built-in the new release dropped, a built-in the new release locked, or one a still-included built-in now requires: the update must still succeed (notes in the log), never fail or break a dependency. [Tasks 2, 6]
3. A corrupt `install-config.json`, or one written by a newer `null-setup`: the update/repair stops before extracting anything and the old install is untouched; the file is never silently replaced by defaults. [Tasks 3, 6]
4. `uninstall` on an install with a portable `data\` folder, and on a folder that is not a Null install: `data\` survives unless deletion was requested; a foreign folder is never deleted. [Task 7]
5. `modify` that only toggles registrations must not swap, close the IDE or touch any file except `install-config.json`; `modify` that changes the built-in set must fail cleanly (old install intact) when the new set breaks a dependency. [Tasks 6, 7]

## File Structure

```
setup/
├── builtins.config.json            # NEW hand-maintained: order, locks, defaults, third-party labels
├── core/src/
│   ├── builtins.rs                 # NEW Manifest, parse, resolve (deps, locks), load, prune
│   ├── install_config.rs           # NEW Feature, InstallConfig, read/write/from_json, diffs
│   ├── manage.rs                   # NEW modify_in_place, uninstall
│   ├── registrations.rs            # MODIFY script_args, apply (replaces reapply)
│   ├── update.rs                   # MODIFY Kind, config, prune, register per config
│   └── lib.rs                      # MODIFY module list
├── core/tests/
│   ├── builtins.rs  install_config.rs  manage.rs  registration_args.rs   # NEW
│   └── update.rs                   # MODIFY new tests
└── app/src/
    ├── args.rs                     # MODIFY install/modify/repair/uninstall + flags
    ├── cli.rs                      # NEW headless runner for the four modes
    └── main.rs                     # MODIFY dispatch
scripts/gen-builtins.mjs (+ .test.mjs)   # NEW build-time manifest generator
scripts/install-null-ide.ps1        # MODIFY -Register / -Unregister dispatch
.github/workflows/build.yml, scripts/build-local.ps1   # MODIFY builtins.json into the zip + release
docs/specs/builtin-pruning-check.md                      # Task 1 output
docs/specs/null-setup-installer-engine-test-runbook.md   # Task 9 output
```

---

### Task 1: Prove that removing built-ins from disk works (gate)

The whole design rests on "an unchecked built-in is simply not on disk". VS Code caches its built-in scan and other extensions may assume a sibling exists; nobody has checked on a real build.

**Files:**
- Create: `docs/specs/builtin-pruning-check.md`

**Interfaces:**
- Produces: a verdict, **PASS** (Tasks 2–9 run unchanged) or **FAIL** (stop; the spec's "Built-in selection" decision needs another mechanism, report back to the user).

- [ ] **Step 1: Make a scratch copy and delete every non-locked built-in**

The portable scratch install from the updater runbook keeps user data inside `data\`, so your daily profile is untouched. If `Null IDE.pristine` is gone, copy your installed `Null IDE` folder and create an empty `data\` folder in it.

```powershell
$p = "$env:LOCALAPPDATA\NullTest\Prune"
robocopy "$env:LOCALAPPDATA\NullTest\Null IDE.pristine" $p /MIR /NFL /NDL /NJH /NJS /NP
$ext = "$p\resources\app\extensions"
'null-markdown','null-format','null-cpp','null-actions','null-env','null-sync','null-activity','null-music','null-startup','code-spell-checker','open-remote-wsl','open-remote-ssh' |
  ForEach-Object { Remove-Item "$ext\$_" -Recurse -Force -ErrorAction Stop }
```

- [ ] **Step 2: Launch it twice and look**

Start `$p\null.exe`, then close it and start it again (the second start exercises the scanner cache). Check and record each: no error notification on startup; Extensions view, `@builtin null` lists exactly the four locked ones; Output → "Extension Host" has no errors; the Null Dashboard opens; `Null: Check Environment` is gone from the palette (expected); a `.md` file opens as plain text without errors.

- [ ] **Step 3: Put one back and check the IDE notices**

```powershell
Copy-Item "$env:LOCALAPPDATA\NullTest\Null IDE.pristine\resources\app\extensions\null-music" "$ext\null-music" -Recurse
```
Restart the IDE. `null-music` must appear again (this is what `modify` relies on when a built-in is re-added).

- [ ] **Step 4: Write the verdict and commit**

Write `docs/specs/builtin-pruning-check.md` with the Windows and Null IDE version, the three observations above (PASS/FAIL each, with the error text if any) and the verdict.

```bash
git add docs/specs/builtin-pruning-check.md
git commit -m "docs: record the built-in pruning check for null-setup"
```

---

### Task 2: `builtins` — manifest, dependency resolution, pruning

**Files:**
- Create: `setup/core/src/builtins.rs`
- Create: `setup/core/tests/builtins.rs`
- Modify: `setup/core/src/lib.rs` (add `pub mod builtins;`)

**Interfaces:**
- Consumes: `Error::{Package, Other}`, `IoCtx` from `error.rs`.
- Produces (used by Tasks 6, 8):
  - `builtins::FILE: &str = "builtins.json"`
  - `struct Builtin { id, label, description: String; default, locked: bool; requires: Vec<String> }`, `struct Manifest { schema: u32, builtins: Vec<Builtin> }`
  - `parse(text: &str) -> Result<Manifest>`; `load(root: &Path) -> Result<Option<Manifest>>` (`None` when the file does not exist)
  - `struct Resolution { excluded: Vec<String>, notes: Vec<String> }`; `resolve(m: &Manifest, wanted: &[String]) -> Resolution` (lenient: drops what cannot be honored and says so in `notes`)
  - `prune(extensions_dir: &Path, excluded: &[String]) -> Result<Vec<String>>` (returns the ids actually removed)

- [ ] **Step 1: Write the failing tests** — `setup/core/tests/builtins.rs`

```rust
use std::fs;

use null_setup_core::builtins::{parse, prune, resolve};

const M: &str = r#"{"schema":1,"builtins":[
  {"id":"null-tools","label":"Tools","locked":true,"requires":["null-accounts"]},
  {"id":"null-accounts","label":"Accounts","locked":true},
  {"id":"null-env","label":"Env"},
  {"id":"null-format","label":"Format","requires":["null-env"]},
  {"id":"null-music","label":"Music","default":false}
]}"#;

fn ids(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

#[test]
fn parse_reads_fields_and_defaults() {
    let m = parse(M).unwrap();
    let env = m.builtins.iter().find(|b| b.id == "null-env").unwrap();
    assert!(env.default && !env.locked && env.requires.is_empty());
    assert!(!m.builtins.iter().find(|b| b.id == "null-music").unwrap().default);
    assert!(m.builtins[0].locked);
}

#[test]
fn parse_rejects_bad_manifests() {
    assert!(parse("{nope").is_err());
    assert!(parse(r#"{"schema":2,"builtins":[]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"../x","label":"x"}]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"a\\b","label":"x"}]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"a","label":"x"},{"id":"a","label":"y"}]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"a","label":"x","requires":["missing"]}]}"#).is_err());
}

#[test]
fn resolve_excludes_unlocked_builtins() {
    let r = resolve(&parse(M).unwrap(), &ids(&["null-music"]));
    assert_eq!(r.excluded, ids(&["null-music"]));
    assert!(r.notes.is_empty());
}

#[test]
fn resolve_drops_unknown_and_locked_entries_with_a_note() {
    let r = resolve(&parse(M).unwrap(), &ids(&["null-gone", "null-tools", "null-music"]));
    assert_eq!(r.excluded, ids(&["null-music"]));
    assert_eq!(r.notes.len(), 2);
    assert!(r.notes.iter().any(|n| n.contains("null-gone")));
    assert!(r.notes.iter().any(|n| n.contains("null-tools")));
}

#[test]
fn resolve_keeps_what_an_included_builtin_requires() {
    let m = parse(M).unwrap();
    let r = resolve(&m, &ids(&["null-env"]));
    assert!(r.excluded.is_empty());
    assert!(r.notes.iter().any(|n| n.contains("null-env") && n.contains("null-format")));
    // Excluding both is fine.
    let r = resolve(&m, &ids(&["null-env", "null-format"]));
    assert_eq!(r.excluded, ids(&["null-env", "null-format"]));
    assert!(r.notes.is_empty());
}

#[test]
fn prune_removes_only_listed_existing_folders() {
    let tmp = tempfile::tempdir().unwrap();
    for d in ["null-music", "null-env", "other"] {
        fs::create_dir_all(tmp.path().join(d)).unwrap();
        fs::write(tmp.path().join(d).join("package.json"), "{}").unwrap();
    }
    let removed = prune(tmp.path(), &ids(&["null-music", "not-there", "../other", "a/b"])).unwrap();
    assert_eq!(removed, ids(&["null-music"]));
    assert!(!tmp.path().join("null-music").exists());
    assert!(tmp.path().join("null-env").exists() && tmp.path().join("other").exists());
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test builtins` (in `setup/`)
Expected: FAIL — `unresolved import null_setup_core::builtins`.

- [ ] **Step 3: Implement** — `setup/core/src/builtins.rs`

```rust
use std::{collections::HashSet, fs, io, path::Path};

use serde::Deserialize;

use crate::error::{Error, IoCtx, Result};

pub const FILE: &str = "builtins.json";

fn yes() -> bool { true }

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Builtin {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "yes")]
    pub default: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub requires: Vec<String>,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct Manifest {
    pub schema: u32,
    pub builtins: Vec<Builtin>,
}

/// Ids are folder names under `resources/app/extensions/`, so only a conservative character set is accepted.
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

pub fn parse(text: &str) -> Result<Manifest> {
    let m: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Package(format!("invalid {FILE}: {e}")))?;
    if m.schema != 1 {
        return Err(Error::Package(format!("{FILE} has schema {}; this null-setup understands 1", m.schema)));
    }
    let mut seen = HashSet::new();
    for b in &m.builtins {
        if !safe_id(&b.id) {
            return Err(Error::Package(format!("{FILE}: unsafe id {:?}", b.id)));
        }
        if !seen.insert(b.id.as_str()) {
            return Err(Error::Package(format!("{FILE}: duplicate id {}", b.id)));
        }
    }
    for b in &m.builtins {
        if let Some(r) = b.requires.iter().find(|r| !seen.contains(r.as_str())) {
            return Err(Error::Package(format!("{FILE}: {} requires unknown {r}", b.id)));
        }
    }
    Ok(m)
}

/// `None` when the package predates `builtins.json`.
pub fn load(root: &Path) -> Result<Option<Manifest>> {
    match fs::read_to_string(root.join(FILE)) {
        Ok(text) => parse(&text).map(Some),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Io { context: format!("read {FILE}"), source: e }),
    }
}

pub struct Resolution {
    /// What will really be left off disk, in manifest order.
    pub excluded: Vec<String>,
    /// Every request that could not be honored, as sentences for the log or an error message.
    pub notes: Vec<String>,
}

/// Turns the wanted exclusions into the ones this release can honor: unknown ids and locked built-ins are
/// dropped, and a built-in that an included one requires stays. Never fails, so an update cannot be blocked
/// by a stale saved choice; callers that take the choice from a person treat any note as an error.
pub fn resolve(m: &Manifest, wanted: &[String]) -> Resolution {
    let mut notes = Vec::new();
    let mut ex: HashSet<&str> = HashSet::new();
    for id in wanted {
        match m.builtins.iter().find(|b| &b.id == id) {
            None => notes.push(format!("{id} is not a built-in of this version")),
            Some(b) if b.locked => notes.push(format!("{id} is part of the core and cannot be left out")),
            Some(b) => {
                ex.insert(b.id.as_str());
            }
        }
    }
    loop {
        let included: Vec<&Builtin> = m.builtins.iter().filter(|b| !ex.contains(b.id.as_str())).collect();
        let mut changed = false;
        for b in included {
            for r in &b.requires {
                if ex.remove(r.as_str()) {
                    notes.push(format!("{r} stays installed because {} needs it", b.id));
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    let excluded = m.builtins.iter().filter(|b| ex.contains(b.id.as_str())).map(|b| b.id.clone()).collect();
    Resolution { excluded, notes }
}

/// Deletes the listed built-in folders. Callers pass `Resolution::excluded`; anything that is not a plain id is skipped anyway.
pub fn prune(extensions_dir: &Path, excluded: &[String]) -> Result<Vec<String>> {
    let mut removed = Vec::new();
    for id in excluded {
        let dir = extensions_dir.join(id);
        if safe_id(id) && dir.is_dir() {
            fs::remove_dir_all(&dir).ctx(format!("remove built-in {id}"))?;
            removed.push(id.clone());
        }
    }
    Ok(removed)
}
```

Add to `setup/core/src/lib.rs` (keep alphabetical): `pub mod builtins;`

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p null-setup-core --test builtins`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add setup/core/src/builtins.rs setup/core/src/lib.rs setup/core/tests/builtins.rs
git commit -m "feat(setup): built-in manifest with dependency-aware exclusion and pruning"
```

---

### Task 3: `install_config` — the saved choices

**Files:**
- Create: `setup/core/src/install_config.rs`
- Create: `setup/core/tests/install_config.rs`
- Modify: `setup/core/src/lib.rs` (add `pub mod install_config;`)

**Interfaces:**
- Produces (used by Tasks 5–8):
  - `install_config::{FILE = "install-config.json", SCHEMA = 1}`
  - `enum Feature { DesktopShortcut, StartMenuShortcut, SafeModeShortcut, Path, ContextMenu, FileAssociations, PreviewHandler }` with `Feature::ALL: [Feature; 7]`, `script_name(self) -> &'static str`, `follows_install(self) -> bool`
  - `struct InstallConfig` (camelCase JSON; `Default` = the Inno defaults: desktop shortcut off, everything else on, nothing excluded) with `has(Feature)`, `enabled() -> Vec<Feature>`, `added_features(&self, new) -> Vec<Feature>`, `removed_features(&self, new) -> Vec<Feature>`
  - `from_json(&str) -> Result<InstallConfig>`, `read_file(&Path)`, `read(dir) -> Result<InstallConfig>` (missing file → default), `write(dir, &InstallConfig)`, `builtins_changed(&old, &new) -> bool`

- [ ] **Step 1: Write the failing tests** — `setup/core/tests/install_config.rs`

```rust
use std::fs;

use null_setup_core::install_config::{self as ic, Feature, InstallConfig};

#[test]
fn defaults_match_the_inno_task_defaults() {
    let c = InstallConfig::default();
    assert!(!c.desktop_shortcut);
    for f in [Feature::StartMenuShortcut, Feature::SafeModeShortcut, Feature::Path, Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler] {
        assert!(c.has(f), "{f:?}");
    }
    assert!(c.excluded_builtins.is_empty());
    assert_eq!(c.schema, ic::SCHEMA);
}

#[test]
fn a_folder_without_a_config_reads_as_the_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    assert_eq!(ic::read(tmp.path()).unwrap(), InstallConfig::default());
}

#[test]
fn write_then_read_round_trips() {
    let tmp = tempfile::tempdir().unwrap();
    let c = InstallConfig { desktop_shortcut: true, path: false, excluded_builtins: vec!["null-music".into()], ..Default::default() };
    ic::write(tmp.path(), &c).unwrap();
    assert_eq!(ic::read(tmp.path()).unwrap(), c);
    assert!(fs::read_to_string(tmp.path().join(ic::FILE)).unwrap().contains("excludedBuiltins"));
}

#[test]
fn a_partial_file_fills_the_rest_with_defaults() {
    let c = ic::from_json(r#"{"schema":1,"path":false}"#).unwrap();
    assert!(!c.path && c.context_menu && c.start_menu_shortcut);
}

#[test]
fn a_newer_schema_or_broken_json_is_an_error_not_defaults() {
    let e = ic::from_json(r#"{"schema":99}"#).unwrap_err().to_string();
    assert!(e.contains("newer"), "{e}");
    assert!(ic::from_json("{nope").is_err());
    let tmp = tempfile::tempdir().unwrap();
    fs::write(tmp.path().join(ic::FILE), "{nope").unwrap();
    assert!(ic::read(tmp.path()).is_err());
}

#[test]
fn enabled_added_and_removed_features_are_listed_in_a_stable_order() {
    let old = InstallConfig::default();
    let new = InstallConfig { desktop_shortcut: true, path: false, preview_handler: false, ..Default::default() };
    assert_eq!(old.added_features(&new), vec![Feature::DesktopShortcut]);
    assert_eq!(old.removed_features(&new), vec![Feature::Path, Feature::PreviewHandler]);
    assert_eq!(old.enabled().len(), 6);
}

#[test]
fn only_the_install_path_bound_features_follow_an_update() {
    let follow: Vec<_> = Feature::ALL.into_iter().filter(|f| f.follows_install()).collect();
    assert_eq!(follow, vec![Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler]);
}

#[test]
fn builtins_changed_ignores_order_and_duplicates() {
    let a = InstallConfig { excluded_builtins: vec!["a".into(), "b".into()], ..Default::default() };
    let b = InstallConfig { excluded_builtins: vec!["b".into(), "a".into(), "a".into()], ..Default::default() };
    let c = InstallConfig { excluded_builtins: vec!["a".into()], ..Default::default() };
    assert!(!ic::builtins_changed(&a, &b));
    assert!(ic::builtins_changed(&a, &c));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test install_config`
Expected: FAIL — unresolved import `install_config`.

- [ ] **Step 3: Implement** — `setup/core/src/install_config.rs`

```rust
use std::{collections::HashSet, fs, io, path::Path};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoCtx, Result};

pub const FILE: &str = "install-config.json";
pub const SCHEMA: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feature { DesktopShortcut, StartMenuShortcut, SafeModeShortcut, Path, ContextMenu, FileAssociations, PreviewHandler }

impl Feature {
    pub const ALL: [Feature; 7] = [
        Feature::DesktopShortcut,
        Feature::StartMenuShortcut,
        Feature::SafeModeShortcut,
        Feature::Path,
        Feature::ContextMenu,
        Feature::FileAssociations,
        Feature::PreviewHandler,
    ];

    /// The name `install-null-ide.ps1 -Register/-Unregister` understands.
    pub fn script_name(self) -> &'static str {
        match self {
            Feature::DesktopShortcut => "desktopShortcut",
            Feature::StartMenuShortcut => "startMenuShortcut",
            Feature::SafeModeShortcut => "safeModeShortcut",
            Feature::Path => "path",
            Feature::ContextMenu => "contextMenu",
            Feature::FileAssociations => "fileAssociations",
            Feature::PreviewHandler => "previewHandler",
        }
    }

    /// Registered against the install folder (registry, Explorer), so an update must re-point them.
    /// Shortcuts and PATH point at paths that survive the swap.
    pub fn follows_install(self) -> bool {
        matches!(self, Feature::ContextMenu | Feature::FileAssociations | Feature::PreviewHandler)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct InstallConfig {
    pub schema: u32,
    pub desktop_shortcut: bool,
    pub start_menu_shortcut: bool,
    pub safe_mode_shortcut: bool,
    pub path: bool,
    pub context_menu: bool,
    pub file_associations: bool,
    pub preview_handler: bool,
    /// Built-ins the user left off. Stored as exclusions so a built-in added by a later release is on by default.
    pub excluded_builtins: Vec<String>,
}

impl Default for InstallConfig {
    fn default() -> Self {
        InstallConfig {
            schema: SCHEMA,
            desktop_shortcut: false,
            start_menu_shortcut: true,
            safe_mode_shortcut: true,
            path: true,
            context_menu: true,
            file_associations: true,
            preview_handler: true,
            excluded_builtins: Vec::new(),
        }
    }
}

impl InstallConfig {
    pub fn has(&self, f: Feature) -> bool {
        match f {
            Feature::DesktopShortcut => self.desktop_shortcut,
            Feature::StartMenuShortcut => self.start_menu_shortcut,
            Feature::SafeModeShortcut => self.safe_mode_shortcut,
            Feature::Path => self.path,
            Feature::ContextMenu => self.context_menu,
            Feature::FileAssociations => self.file_associations,
            Feature::PreviewHandler => self.preview_handler,
        }
    }

    pub fn enabled(&self) -> Vec<Feature> {
        Feature::ALL.into_iter().filter(|f| self.has(*f)).collect()
    }

    /// On in `new` but not in `self`.
    pub fn added_features(&self, new: &InstallConfig) -> Vec<Feature> {
        Feature::ALL.into_iter().filter(|f| !self.has(*f) && new.has(*f)).collect()
    }

    /// On in `self` but not in `new`.
    pub fn removed_features(&self, new: &InstallConfig) -> Vec<Feature> {
        Feature::ALL.into_iter().filter(|f| self.has(*f) && !new.has(*f)).collect()
    }
}

pub fn builtins_changed(old: &InstallConfig, new: &InstallConfig) -> bool {
    let set = |c: &InstallConfig| c.excluded_builtins.iter().cloned().collect::<HashSet<String>>();
    set(old) != set(new)
}

pub fn from_json(text: &str) -> Result<InstallConfig> {
    let cfg: InstallConfig = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))?;
    if cfg.schema > SCHEMA {
        return Err(Error::Other(format!(
            "{FILE} was written by a newer null-setup (schema {}); update null-setup first",
            cfg.schema
        )));
    }
    Ok(cfg)
}

pub fn read_file(path: &Path) -> Result<InstallConfig> {
    from_json(&fs::read_to_string(path).ctx(format!("read {}", path.display()))?)
}

/// A folder without the file (an install from before this existed) reads as the defaults.
pub fn read(install_dir: &Path) -> Result<InstallConfig> {
    match fs::read_to_string(install_dir.join(FILE)) {
        Ok(text) => from_json(&text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(InstallConfig::default()),
        Err(e) => Err(Error::Io { context: format!("read {FILE}"), source: e }),
    }
}

pub fn write(install_dir: &Path, cfg: &InstallConfig) -> Result<()> {
    let text = serde_json::to_string_pretty(cfg).map_err(|e| Error::Other(e.to_string()))?;
    let tmp = install_dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, text).ctx("write install config")?;
    fs::rename(&tmp, install_dir.join(FILE)).ctx("replace install config")
}
```

Add to `setup/core/src/lib.rs`: `pub mod install_config;`

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p null-setup-core --test install_config`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add setup/core/src/install_config.rs setup/core/src/lib.rs setup/core/tests/install_config.rs
git commit -m "feat(setup): install-config.json with the shell-integration features and built-in exclusions"
```

---

### Task 4: Generate `builtins.json` at build time

**Files:**
- Create: `setup/builtins.config.json`
- Create: `scripts/gen-builtins.mjs`
- Create: `scripts/gen-builtins.test.mjs`
- Modify: `.github/workflows/build.yml` (step "Prepare installer payload", and the two file lists at the end)
- Modify: `scripts/build-local.ps1` (around line 812, and `$releaseFiles` around line 861)

**Interfaces:**
- Produces: `builtins.json` at the zip root and as a release asset, in the schema `builtins::parse` (Task 2) accepts. `gen-builtins.mjs` exports `build(config, readPackage, repoExtensionIds)` and `main(outPath?)`.

- [ ] **Step 1: Write the config table** — `setup/builtins.config.json`

Order is the order the wizard will show. Labels/descriptions come from each extension's `package.json` unless given here; third-party built-ins have no `package.json` in this repo, so they carry their own.

```json
{
  "builtins": [
    { "id": "null-tools", "locked": true },
    { "id": "null-accounts", "locked": true },
    { "id": "null-theme", "label": "Null Dark theme", "locked": true },
    { "id": "null-icons", "label": "Null file icons", "locked": true },
    { "id": "null-markdown" },
    { "id": "null-format" },
    { "id": "null-cpp" },
    { "id": "null-actions" },
    { "id": "null-env" },
    { "id": "null-sync" },
    { "id": "null-activity" },
    { "id": "null-music" },
    { "id": "null-startup" },
    { "id": "code-spell-checker", "label": "Code Spell Checker", "description": "Spell checking for code, comments and documents (streetsidesoftware.code-spell-checker)." },
    { "id": "open-remote-wsl", "label": "Remote - WSL", "description": "Open folders inside WSL (jeanp413.open-remote-wsl)." },
    { "id": "open-remote-ssh", "label": "Remote - SSH", "description": "Open folders on SSH hosts (jeanp413.open-remote-ssh)." }
  ]
}
```

- [ ] **Step 2: Write the failing test** — `scripts/gen-builtins.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, main } from './gen-builtins.mjs';

const pkgs = {
  'null-a': { displayName: 'A', description: 'a desc' },
  'null-b': { displayName: 'B', description: 'b desc', extensionDependencies: ['null.null-a', 'ms-vscode.cpptools'] },
};
const read = (id) => pkgs[id];

test('requires come from Null extensionDependencies only', () => {
  const m = build({ builtins: [{ id: 'null-a' }, { id: 'null-b' }] }, read, ['null-a', 'null-b']);
  assert.deepEqual(m.builtins[1].requires, ['null-a']);
  assert.equal(m.schema, 1);
});

test('defaults are on and unlocked; config can override them and add requires', () => {
  const m = build({ builtins: [{ id: 'null-a', default: false, locked: true }, { id: 'null-b', requires: ['null-a'] }] }, read, []);
  assert.deepEqual([m.builtins[0].default, m.builtins[0].locked], [false, true]);
  assert.deepEqual(m.builtins[1].requires, ['null-a']);
  assert.deepEqual([m.builtins[1].default, m.builtins[1].locked], [true, false]);
});

test('an extension folder missing from the config fails the build', () => {
  assert.throws(() => build({ builtins: [{ id: 'null-a' }] }, read, ['null-a', 'null-b']), /null-b is not listed/);
});

test('a third-party entry needs its own label and description', () => {
  assert.throws(() => build({ builtins: [{ id: 'x-ext' }] }, read, []), /x-ext/);
  const m = build({ builtins: [{ id: 'x-ext', label: 'X', description: 'x' }] }, read, []);
  assert.equal(m.builtins[0].label, 'X');
});

test('the real repo config is consistent', () => {
  const m = main();
  const ids = new Set(m.builtins.map((b) => b.id));
  assert.equal(ids.size, m.builtins.length);
  assert.deepEqual(m.builtins.filter((b) => b.locked).map((b) => b.id).sort(), ['null-accounts', 'null-icons', 'null-theme', 'null-tools']);
  for (const b of m.builtins) for (const r of b.requires) assert.ok(ids.has(r), `${b.id} requires unknown ${r}`);
  assert.ok(m.builtins.find((b) => b.id === 'null-format').requires.includes('null-env'));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test scripts/gen-builtins.test.mjs`
Expected: FAIL — cannot find `./gen-builtins.mjs`.

- [ ] **Step 4: Implement** — `scripts/gen-builtins.mjs`

```js
// Generates builtins.json: the built-in extensions null-setup may leave off disk.
// Usage: node scripts/gen-builtins.mjs <out.json>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NULL_PUBLISHER = 'null.';

/**
 * @param config  parsed setup/builtins.config.json
 * @param readPackage  (id) => package.json object, or undefined for a built-in that is not an extension of this repo
 * @param repoExtensionIds  every extensions/<id> folder that has a package.json
 */
export function build(config, readPackage, repoExtensionIds) {
  const listed = new Set(config.builtins.map((b) => b.id));
  for (const id of repoExtensionIds) {
    if (!listed.has(id)) throw new Error(`extensions/${id} is not listed in setup/builtins.config.json`);
  }
  const builtins = config.builtins.map((c) => {
    const pkg = readPackage(c.id);
    const label = c.label ?? pkg?.displayName;
    const description = c.description ?? pkg?.description;
    if (!label || !description) throw new Error(`${c.id}: needs a label and a description (config or package.json)`);
    const fromPackage = (pkg?.extensionDependencies ?? [])
      .filter((d) => d.startsWith(NULL_PUBLISHER))
      .map((d) => d.slice(NULL_PUBLISHER.length));
    return {
      id: c.id,
      label,
      description,
      default: c.default ?? true,
      locked: c.locked ?? false,
      requires: [...new Set([...(c.requires ?? []), ...fromPackage])],
    };
  });
  return { schema: 1, builtins };
}

export function main(out) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(root, 'setup', 'builtins.config.json'), 'utf8'));
  const extDir = join(root, 'extensions');
  const ids = readdirSync(extDir).filter((d) => existsSync(join(extDir, d, 'package.json')));
  const read = (id) => {
    const p = join(extDir, id, 'package.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
  };
  const manifest = build(config, read, ids);
  if (out) writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: node gen-builtins.mjs <out.json>');
    process.exit(2);
  }
  main(process.argv[2]);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/gen-builtins.test.mjs`
Expected: PASS (5 tests). Then `node scripts/gen-builtins.mjs "$env:TEMP\b.json"` and check `null-sync` lists `null-accounts` under `requires`.

- [ ] **Step 6: Wire it into the build**

In `.github/workflows/build.yml`, step "Prepare installer payload", directly after `Copy-Item ide-overlay/scripts/install-null-ide.ps1 $payloadDir -Force`, add:

```powershell
          node ide-overlay/scripts/gen-builtins.mjs (Join-Path $outDir "builtins.json")
          if ($LASTEXITCODE -ne 0) { Write-Error "gen-builtins failed"; exit 1 }
          Copy-Item (Join-Path $outDir "builtins.json") builtins.json -Force
```

and add `builtins.json` to the `files:` list of "Publish release asset" and the `path:` list of "Upload artifact" (next to `null-ide-win32-x64.zip.sha256`).

In `scripts/build-local.ps1`, read lines 805-865 first. After the line that copies `install-null-ide.ps1` into `$payloadDir` add the same `node` call (`(Join-Path $RepoRoot "scripts/gen-builtins.mjs") (Join-Path $OutDir "builtins.json")`, throw on `$LASTEXITCODE -ne 0`), and add `(Join-Path $OutDir "builtins.json")` to `$releaseFiles`.

Validate both files parse: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build.yml'))"` (or any YAML check you have) and `powershell -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('scripts/build-local.ps1',[ref]$null,[ref]$e); $e"` (must print nothing).

- [ ] **Step 7: Commit**

```bash
git add setup/builtins.config.json scripts/gen-builtins.mjs scripts/gen-builtins.test.mjs .github/workflows/build.yml scripts/build-local.ps1
git commit -m "build: generate builtins.json and ship it in the zip and as a release asset"
```

---

### Task 5: Per-feature registrations (`-Register` / `-Unregister`)

**Files:**
- Modify: `scripts/install-null-ide.ps1` (params at top; new dispatch block before `if ($ReapplyRegistrations)`, currently line 970)
- Modify: `setup/core/src/registrations.rs`
- Create: `setup/core/tests/registration_args.rs`

**Interfaces:**
- Consumes: `install_config::Feature` (Task 3).
- Produces (used by Tasks 6, 7): `registrations::script_args(install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool) -> Vec<OsString>`; `registrations::apply(install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration` (returns `Skipped` when both lists are empty or the script is missing). `registrations::reapply` is **removed**; `classify` and `Registration` stay.
- PowerShell contract: `-Register <csv>` / `-Unregister <csv>` take the `Feature::script_name` values; unregistering runs first; `-NoElevate` is honoured by the existing `Register-Win11ContextMenu`.

- [ ] **Step 1: Write the failing tests** — `setup/core/tests/registration_args.rs`

```rust
use std::{fs, path::Path};

use null_setup_core::{
    install_config::Feature,
    progress::{Ctx, Logger, NoInteract},
    registrations::{apply, script_args, Registration},
};

fn strings(a: Vec<std::ffi::OsString>) -> Vec<String> { a.into_iter().map(|s| s.to_string_lossy().into_owned()).collect() }

#[test]
fn builds_register_and_unregister_lists_in_the_given_order() {
    let a = script_args(Path::new(r"C:\Null IDE ünï"), &[Feature::ContextMenu, Feature::Path], &[Feature::PreviewHandler], false);
    assert_eq!(
        strings(a),
        ["-InstallDir", r"C:\Null IDE ünï", "-Register", "contextMenu,path", "-Unregister", "previewHandler", "-NoElevate"]
    );
}

#[test]
fn elevation_is_allowed_only_when_asked_and_empty_lists_are_left_out() {
    let a = strings(script_args(Path::new(r"C:\x"), &[Feature::Path], &[], true));
    assert_eq!(a, ["-InstallDir", r"C:\x", "-Register", "path"]);
}

#[test]
fn every_feature_name_is_known_to_the_script() {
    let ps1 = include_str!("../../../scripts/install-null-ide.ps1");
    for f in Feature::ALL {
        assert!(ps1.contains(&format!("'{}'", f.script_name())), "{} is not handled by install-null-ide.ps1", f.script_name());
    }
}

#[test]
fn apply_runs_the_installs_script_with_the_wanted_arguments() {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE x");
    let dir = install.join("resources").join("app").join("null-updater");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("install-null-ide.ps1"),
        "Set-Content -LiteralPath \"$PSScriptRoot\\args.txt\" -Encoding ASCII -Value ($args -join '|')\r\nWrite-Host 'Done.'\r\n",
    )
    .unwrap();
    let log = Logger::none();
    let progress = |_| {};
    let ctx = Ctx { progress: &progress, log: &log, interact: &NoInteract };
    let r = apply(&install, &[Feature::Path], &[Feature::DesktopShortcut], false, &ctx);
    assert_eq!(r, Registration::Done);
    let got = fs::read_to_string(dir.join("args.txt")).unwrap();
    assert_eq!(got.trim(), format!("-InstallDir|{}|-Register|path|-Unregister|desktopShortcut|-NoElevate", install.display()));
}

#[test]
fn nothing_to_do_is_skipped() {
    let log = Logger::none();
    let progress = |_| {};
    let ctx = Ctx { progress: &progress, log: &log, interact: &NoInteract };
    assert_eq!(apply(Path::new(r"C:\does\not\exist"), &[], &[], false, &ctx), Registration::Skipped);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test registration_args`
Expected: FAIL — `script_args`/`apply` not found.

- [ ] **Step 3: Add the dispatch block to the script**

In `scripts/install-null-ide.ps1`: add two parameters to the `param(...)` block (after `[switch]$NoElevate,`):

```powershell
    [string]$Register,
    [string]$Unregister,
```

and insert this block directly before `if ($ReapplyRegistrations) {`:

```powershell
if ($Register -or $Unregister) {
    $dir = [System.IO.Path]::GetFullPath($InstallDir)
    $target = Get-NullIdeExecutable -Dir $dir
    $binDir = Join-Path $dir 'bin'
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Null IDE'
    $desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Null IDE.lnk'
    foreach ($f in @($Unregister -split ',' | Where-Object { $_ })) {
        switch ($f) {
            'desktopShortcut'   { Remove-Item -LiteralPath $desktopLnk -Force -ErrorAction SilentlyContinue }
            'startMenuShortcut' { Remove-Item -LiteralPath (Join-Path $startMenu 'Null IDE.lnk') -Force -ErrorAction SilentlyContinue }
            'safeModeShortcut'  { Remove-Item -LiteralPath (Join-Path $startMenu 'Null IDE (Safe Mode).lnk') -Force -ErrorAction SilentlyContinue }
            'path'              { Unregister-Path -Dir $binDir; Unregister-Path -Dir $dir }
            'contextMenu'       { Unregister-ContextMenu; Unregister-Win11ContextMenu }
            'fileAssociations'  { Unregister-FileAssociations }
            'previewHandler'    { Unregister-PreviewHandler }
            default             { throw "Unknown feature: $f" }
        }
    }
    foreach ($f in @($Register -split ',' | Where-Object { $_ })) {
        switch ($f) {
            'desktopShortcut'   { New-Shortcut -ShortcutPath $desktopLnk -TargetPath $target -WorkingDirectory $dir }
            'startMenuShortcut' { New-Shortcut -ShortcutPath (Join-Path $startMenu 'Null IDE.lnk') -TargetPath $target -WorkingDirectory $dir }
            'safeModeShortcut'  { New-Shortcut -ShortcutPath (Join-Path $startMenu 'Null IDE (Safe Mode).lnk') -TargetPath $target -WorkingDirectory $dir -Arguments '--safe-mode' }
            'path'              { Unregister-Path -Dir $dir; Register-Path -Dir $binDir }
            'contextMenu'       { Register-ContextMenu -ExePath $target; Register-Win11ContextMenu -InstallDir $dir }
            'fileAssociations'  { Register-FileAssociations -InstallDir $dir }
            'previewHandler'    { Register-PreviewHandler -InstallDir $dir }
            default             { throw "Unknown feature: $f" }
        }
    }
    # The Start Menu folder goes away with its last shortcut.
    if ((Test-Path -LiteralPath $startMenu) -and -not (Get-ChildItem -LiteralPath $startMenu -Force)) {
        Remove-Item -LiteralPath $startMenu -Force
    }
    Write-Host 'Done.'
    return
}

```

Check the script parses: `powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('scripts/install-null-ide.ps1',[ref]$null,[ref]$e); $e"` prints nothing.

- [ ] **Step 4: Implement `script_args` and `apply`** — replace `reapply` in `setup/core/src/registrations.rs`

Replace the imports at the top with:

```rust
use std::{
    ffi::OsString,
    os::windows::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::{install_config::Feature, progress::Ctx};
```

and replace the whole `reapply` function (and its doc comment) with:

```rust
/// Arguments after `-File <script>`. Pure, so the wiring between features and the script is testable without PowerShell.
pub fn script_args(install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool) -> Vec<OsString> {
    let csv = |fs: &[Feature]| fs.iter().map(|f| f.script_name()).collect::<Vec<_>>().join(",");
    let mut a: Vec<OsString> = vec!["-InstallDir".into(), install.into()];
    if !register.is_empty() {
        a.extend(["-Register".into(), csv(register).into()]);
    }
    if !unregister.is_empty() {
        a.extend(["-Unregister".into(), csv(unregister).into()]);
    }
    if !allow_elevate {
        a.push("-NoElevate".into());
    }
    a
}

/// Until sub-project 2b ports the registrations to Rust, the script shipped inside the install does the work.
/// Unregistering runs before registering.
pub fn apply(install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration {
    if register.is_empty() && unregister.is_empty() {
        return Registration::Skipped;
    }
    let script = install.join("resources").join("app").join("null-updater").join("install-null-ide.ps1");
    if !script.exists() {
        ctx.log.line("registration script not found; skipping");
        return Registration::Skipped;
    }
    let spawned = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .args(script_args(install, register, unregister, allow_elevate))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(NO_WINDOW)
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return Registration::Warning(format!("could not start PowerShell: {e}")),
    };
    // A UAC prompt (certificate approval) waits for a person; everything else finishes in seconds.
    let limit = Duration::from_secs(if allow_elevate { 600 } else { 120 });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < limit => thread::sleep(Duration::from_millis(200)),
            _ => {
                let _ = child.kill();
                return Registration::Warning("registration script timed out".into());
            }
        }
    }
    // ponytail: output is read after exit; fine for this script's few lines, switch to a log file if it ever exceeds the pipe buffer.
    match child.wait_with_output() {
        Ok(o) => {
            let (out, err) = (String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            ctx.log.line(&format!("registrations: {out} {err}"));
            classify(&out, o.status.success(), &err)
        }
        Err(e) => Registration::Warning(e.to_string()),
    }
}
```

Note: `update.rs` still calls the removed `reapply`; the workspace does not compile until Task 6 step 3. To keep this task's test run green, temporarily change that one line (`update.rs:157`) to `registrations::apply(&o.install_dir, &[Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler], &[], false, ctx)` and add `install_config::Feature` to its imports; Task 6 replaces it properly.

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test -p null-setup-core`
Expected: PASS, including the 5 new tests and all existing ones (the fake-script test needs `powershell.exe`, present on Windows and on the `windows-2022` runner).

- [ ] **Step 6: Check the real script by hand (scratch HKCU only)**

In a scratch install (`%LOCALAPPDATA%\NullTest\Null IDE`): `powershell -NoProfile -ExecutionPolicy Bypass -File <install>\resources\app\null-updater\install-null-ide.ps1 -InstallDir <install> -Register fileAssociations,startMenuShortcut -NoElevate`, verify the `Null IDE.lnk` appears in the Start Menu and `HKCU:\Software\Classes\NullIDE.js` (or the first key `Register-FileAssociations` writes) exists; then the same with `-Unregister` for both and verify both are gone. Use the scratch install's folder only; note that this touches your real HKCU, so do it after the daily install is re-registered if it matters.

- [ ] **Step 7: Commit**

```bash
git add scripts/install-null-ide.ps1 setup/core/src/registrations.rs setup/core/src/update.rs setup/core/tests/registration_args.rs
git commit -m "feat(setup): register and unregister each shell feature on its own"
```

---

### Task 6: One pipeline for install, update and repair

**Files:**
- Modify: `setup/core/src/update.rs`
- Modify: `setup/core/tests/update.rs` (append tests; add imports)

**Interfaces:**
- Consumes: `builtins::{load, resolve, prune}` (Task 2), `install_config::{InstallConfig, Feature, read, write}` (Task 3), `registrations::apply` (Task 5).
- Produces (used by Tasks 7–8):
  - `update::Kind { Install, Update, Repair }`
  - `Opts` gains `kind: Kind` (default `Update`), `config: Option<InstallConfig>` (`None` keeps the saved choices and lets exclusions that no longer fit lapse; `Some` means "a person chose this", any unmet exclusion is an error) and `allow_elevate: bool` (default `false`)
  - `update::update(o, ctx)` runs whichever `kind` says (kept as the entry point); `pub(crate) fn report` for Task 7

- [ ] **Step 1: Write the failing tests** — append to `setup/core/tests/update.rs`

Extend the imports at the top: add `install_config::{self, InstallConfig}` to the `null_setup_core::{…}` list and `Kind` to `update::{…}`. Then append:

```rust
const MANIFEST: &str = r#"{"schema":1,"builtins":[
  {"id":"null-env","label":"Env"},
  {"id":"null-format","label":"Format","requires":["null-env"]},
  {"id":"null-music","label":"Music"}]}"#;

fn with_builtins() -> World {
    world(&[
        ("builtins.json", MANIFEST.as_bytes()),
        ("resources/app/extensions/null-env/package.json", b"{}"),
        ("resources/app/extensions/null-format/package.json", b"{}"),
        ("resources/app/extensions/null-music/package.json", b"{}"),
    ])
}

fn ext(install: &Path, id: &str) -> PathBuf { install.join("resources").join("app").join("extensions").join(id) }

fn excluding(ids: &[&str]) -> InstallConfig {
    InstallConfig { excluded_builtins: ids.iter().map(|s| s.to_string()).collect(), ..Default::default() }
}

fn fresh_target(w: &World) -> PathBuf { w.install.parent().unwrap().join("Fresh Null ünï") }

fn install_opts(w: &World, base: &str, cfg: InstallConfig) -> Opts {
    let mut o = opts(w, base);
    o.install_dir = fresh_target(w);
    o.kind = Kind::Install;
    o.config = Some(cfg);
    o
}

#[test]
fn install_into_a_new_folder_applies_the_choices_and_leaves_excluded_builtins_off_disk() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let o = install_opts(&w, &srv.base, excluding(&["null-music"]));
    run(|c| update(&o, c)).0.unwrap();
    let t = fresh_target(&w);
    assert!(t.join("new.txt").exists() && ext(&t, "null-env").exists() && ext(&t, "null-format").exists());
    assert!(!ext(&t, "null-music").exists());
    assert_eq!(install_config::read(&t).unwrap(), excluding(&["null-music"]));
    assert_eq!(config::read(&t).unwrap().version, "v2");
    assert!(!journal_path(&t).exists());
    assert_old(&w.install); // the other install is not involved
}

#[test]
fn install_refuses_a_folder_that_is_not_empty_and_not_ours() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let o = install_opts(&w, &srv.base, InstallConfig::default());
    let t = fresh_target(&w);
    fs::create_dir_all(&t).unwrap();
    fs::write(t.join("precious.txt"), "mine").unwrap();
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("not empty"), "{e}");
    assert_eq!(fs::read_to_string(t.join("precious.txt")).unwrap(), "mine");
    assert!(!t.join("new.txt").exists() && !journal_path(&t).exists());
}

#[test]
fn install_refuses_an_existing_install() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = install_opts(&w, &srv.base, InstallConfig::default());
    o.install_dir = w.install.clone();
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("already installed"), "{e}");
    assert_old(&w.install);
}

#[test]
fn an_update_keeps_the_saved_exclusions() {
    let w = with_builtins();
    install_config::write(&w.install, &excluding(&["null-music"])).unwrap();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    run(|c| update(&opts(&w, &srv.base), c)).0.unwrap();
    assert!(!ext(&w.install, "null-music").exists() && ext(&w.install, "null-env").exists());
    assert_eq!(install_config::read(&w.install).unwrap(), excluding(&["null-music"]));
}

#[test]
fn an_update_survives_saved_choices_the_new_release_cannot_honor() {
    let w = with_builtins();
    // null-gone no longer exists; null-env is needed by the still-included null-format.
    install_config::write(&w.install, &excluding(&["null-gone", "null-env"])).unwrap();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    run(|c| update(&opts(&w, &srv.base), c)).0.unwrap();
    assert!(ext(&w.install, "null-env").exists());
    assert_eq!(install_config::read(&w.install).unwrap(), excluding(&["null-gone", "null-env"])); // the file is not rewritten
}

#[test]
fn a_corrupt_config_stops_the_update_before_anything_changes() {
    let w = with_builtins();
    fs::write(w.install.join("install-config.json"), "{nope").unwrap();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let e = run(|c| update(&opts(&w, &srv.base), c)).0.unwrap_err().to_string();
    assert!(e.contains("install-config.json"), "{e}");
    assert_old(&w.install);
    assert!(!journal_path(&w.install).exists());
}

#[test]
fn repair_with_a_new_choice_reinstalls_and_prunes_the_newly_excluded_builtin() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.kind = Kind::Repair;
    o.config = Some(excluding(&["null-music"]));
    run(|c| update(&o, c)).0.unwrap();
    assert!(!ext(&w.install, "null-music").exists() && w.install.join("new.txt").exists());
    assert_eq!(fs::read_to_string(w.install.join("data").join("user.txt")).unwrap(), "mine");
}

#[test]
fn a_chosen_set_that_breaks_a_dependency_fails_and_leaves_the_old_install() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.kind = Kind::Repair;
    o.config = Some(excluding(&["null-env"])); // null-format stays and needs it
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("null-env") && e.contains("null-format"), "{e}");
    assert_old(&w.install);
    assert!(!journal_path(&w.install).exists());
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test update`
Expected: FAIL to compile — `Kind`, `Opts::kind`, `Opts::config` not found.

- [ ] **Step 3: Implement** — `setup/core/src/update.rs`

Imports: replace the `use crate::{…}` block with

```rust
use crate::{
    builtins,
    config::{self, InstallMeta},
    disk,
    download::{self, Cache},
    error::{Error, IoCtx, Result},
    extract,
    http::Http,
    install_config::{self, InstallConfig},
    procs, registrations,
    progress::{Ctx, Progress},
    registrations::Registration,
    release::{self, Release},
    shellext,
    swap::{self, Hook, Plan, Timing},
};
```

Add above `pub struct Opts`:

```rust
/// What `update` does with the folder. `Install` needs an empty or missing folder, the others an existing install.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind { Install, Update, Repair }
```

Add three fields to `Opts` (after `close_grace`) and their values to `standard`:

```rust
    pub kind: Kind,
    /// `None`: keep the choices saved in the install (exclusions that no longer fit lapse with a log note).
    /// `Some`: a person chose these; any exclusion that cannot be honored is an error.
    pub config: Option<InstallConfig>,
    /// Only a fresh install or `modify` may start the elevated certificate import.
    pub allow_elevate: bool,
```
```rust
            kind: Kind::Update,
            config: None,
            allow_elevate: false,
```

Make `report` visible to `manage.rs`: change `fn report<T>` to `pub(crate) fn report<T>`.

Replace `run_update`, `prepare_swap` stays, and `finish` with:

```rust
fn has_entries(dir: &Path) -> bool {
    fs::read_dir(dir).map(|mut r| r.next().is_some()).unwrap_or(false)
}

/// Refuses to touch a folder that is not what the kind expects, then returns the choices saved in it.
/// The swap renames the whole folder aside and deletes it on commit, so this is what protects someone else's files.
fn check_target(o: &Opts) -> Result<InstallConfig> {
    let dir = o.install_dir.display();
    let ours = o.install_dir.join(".null-ide-install.json").is_file();
    match o.kind {
        Kind::Install if ours => Err(Error::Other(format!("Null IDE is already installed in {dir}; use repair or update"))),
        Kind::Install if has_entries(&o.install_dir) => {
            Err(Error::Other(format!("{dir} is not empty and is not a Null IDE install; pick an empty folder")))
        }
        Kind::Install => Ok(InstallConfig::default()),
        Kind::Update | Kind::Repair if !ours => Err(Error::Other(format!("no Null IDE install found in {dir}"))),
        Kind::Update | Kind::Repair => install_config::read(&o.install_dir),
    }
}

fn run_update(o: &Opts, ctx: &Ctx) -> Result<Outcome> {
    let parent = o.install_dir.parent().unwrap_or(Path::new("."));
    if o.kind == Kind::Install {
        fs::create_dir_all(parent).ctx("create the install location")?;
    }
    // One update at a time per install: a second one must not touch the first one's staging, backup or journal.
    let _lock = swap::lock_install(&o.install_dir, Duration::ZERO)?;
    swap::recover_unlocked(&o.install_dir, &o.timing)?;
    let before = check_target(o)?;
    let cfg = o.config.clone().unwrap_or_else(|| before.clone());
    // A zip that `prefetch` verified needs no network, so "Restart to update" also works offline.
    let zip = match download::cached(&o.cache, &o.tag) {
        Some(z) => z,
        None => fetch_verified(o, Duration::from_secs(600), ctx)?.1,
    };
    let zip_size = fs::metadata(&zip).map(|m| m.len()).unwrap_or(0);

    let plan = swap::plan_for(&o.install_dir, &o.tag);
    disk::ensure(parent, zip_size.saturating_mul(3))?;
    if plan.staged.exists() {
        fs::remove_dir_all(&plan.staged).ctx("remove stale staging directory")?;
    }
    extract::extract(&zip, &plan.staged, ctx)?;

    if let Err(e) = stage(o, &plan, &cfg, ctx).and_then(|_| prepare_swap(o, ctx)) {
        let _ = fs::remove_dir_all(&plan.staged);
        return Err(e);
    }

    ctx.emit(Progress::Installing);
    swap::swap(&plan, &o.timing, &mut |_| Hook::Continue)?;

    match finish(o, &plan, &before, &cfg, ctx) {
        Ok(outcome) => {
            o.cache.prune_except("");
            Ok(outcome)
        }
        Err(e) => {
            ctx.log.line(&format!("rolling back: {e}"));
            match procs::close_all(&o.install_dir, ctx, o.close_grace).and_then(|_| swap::rollback(&plan, &o.timing)) {
                Ok(()) => Err(e),
                Err(r) => Err(Error::Other(format!("{e}; rollback also failed: {r}"))),
            }
        }
    }
}

/// Everything that goes into the new tree before it replaces the old one.
fn stage(o: &Opts, plan: &Plan, cfg: &InstallConfig, ctx: &Ctx) -> Result<()> {
    config::write(
        &plan.staged,
        &InstallMeta {
            repo: o.repo.clone(),
            version: o.tag.clone(),
            installed_at: Some(config::now_iso()),
            install_dir: Some(o.install_dir.display().to_string()),
        },
    )?;
    install_config::write(&plan.staged, cfg)?;
    prune_builtins(&plan.staged, cfg, o.config.is_some(), ctx)
}

fn prune_builtins(staged: &Path, cfg: &InstallConfig, strict: bool, ctx: &Ctx) -> Result<()> {
    let Some(m) = builtins::load(staged)? else {
        if strict && !cfg.excluded_builtins.is_empty() {
            return Err(Error::Other("this release has no builtins.json, so built-ins cannot be left out".into()));
        }
        return Ok(());
    };
    let r = builtins::resolve(&m, &cfg.excluded_builtins);
    for n in &r.notes {
        ctx.log.line(&format!("built-ins: {n}"));
    }
    if strict && !r.notes.is_empty() {
        return Err(Error::Other(r.notes.join("; ")));
    }
    let removed = builtins::prune(&staged.join("resources").join("app").join("extensions"), &r.excluded)?;
    ctx.log.line(&format!("built-ins left off disk: {}", removed.join(", ")));
    Ok(())
}
```

Keep `prepare_swap` unchanged. Replace `finish` and add `register`:

```rust
fn register(o: &Opts, before: &InstallConfig, cfg: &InstallConfig, ctx: &Ctx) -> Registration {
    let mut wanted = cfg.enabled();
    // An update only re-points what is tied to the install folder; shortcuts and PATH survive the swap.
    if o.kind == Kind::Update {
        wanted.retain(|f| f.follows_install());
    }
    let dropped = if o.kind == Kind::Install { Vec::new() } else { before.removed_features(cfg) };
    registrations::apply(&o.install_dir, &wanted, &dropped, o.allow_elevate, ctx)
}

fn finish(o: &Opts, plan: &Plan, before: &InstallConfig, cfg: &InstallConfig, ctx: &Ctx) -> Result<Outcome> {
    let registration = if o.reapply { register(o, before, cfg, ctx) } else { Registration::Skipped };
    if o.launch {
        ctx.emit(Progress::Restarting);
        let mut child = launch_ide(&o.install_dir)?;
        wait_ready(&mut child, &swap::ready_marker(&o.install_dir), o.ready_timeout)?;
    }
    // A commit that cannot delete the backup (locked) is not a failed update: the journal stays and the next start retries.
    if let Err(e) = swap::commit(plan) {
        ctx.log.line(&format!("commit incomplete, will retry later: {e}"));
    }
    if registration == Registration::NeedsReapproval {
        ctx.emit(Progress::NeedsReapproval);
    }
    Ok(Outcome { registration })
}
```

Remove the temporary `Feature` import and line from Task 5 if still present (the old `finish` is being replaced).

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p null-setup-core`
Expected: PASS — the 8 new update tests and every existing one (existing worlds already contain `.null-ide-install.json`, so `check_target` accepts them).

- [ ] **Step 5: Commit**

```bash
git add setup/core/src/update.rs setup/core/tests/update.rs
git commit -m "feat(setup): install and repair through the update pipeline, honoring saved built-in choices"
```

---

### Task 7: `manage` — modify in place and uninstall

**Files:**
- Create: `setup/core/src/manage.rs`
- Create: `setup/core/tests/manage.rs`
- Modify: `setup/core/src/lib.rs` (add `pub mod manage;`)

**Interfaces:**
- Consumes: `install_config`, `registrations::apply`, `swap::{lock_install, recover_unlocked, Timing}`, `procs`, `shellext`, `update::report`.
- Produces (used by Task 8):
  - `manage::modify_in_place(install: &Path, new: &InstallConfig, allow_elevate: bool, ctx: &Ctx) -> Result<Registration>` — applies only registration changes and rewrites `install-config.json`; errors if the built-in set differs (that needs `Kind::Repair`)
  - `struct UninstallOpts { install_dir, delete_user_data: bool, user_data_dir: PathBuf, timing: Timing, close_grace: Duration, release_shell_ext: bool }` with `UninstallOpts::standard(install_dir, delete_user_data, user_data_dir)`
  - `manage::uninstall(o: &UninstallOpts, ctx: &Ctx) -> Result<()>`

- [ ] **Step 1: Write the failing tests** — `setup/core/tests/manage.rs`

```rust
use std::{fs, path::Path, time::Duration};

use null_setup_core::{
    install_config::{self, InstallConfig},
    manage::{modify_in_place, uninstall, UninstallOpts},
    progress::{Ctx, Logger, NoInteract},
    registrations::Registration,
    swap::Timing,
};

fn run<T>(f: impl FnOnce(&Ctx) -> T) -> T {
    let log = Logger::none();
    let progress = |_| {};
    f(&Ctx { progress: &progress, log: &log, interact: &NoInteract })
}

fn install_in(root: &Path) -> std::path::PathBuf {
    let dir = root.join("Null IDE x");
    fs::create_dir_all(dir.join("data")).unwrap();
    fs::create_dir_all(dir.join("resources").join("app")).unwrap();
    fs::write(dir.join(".null-ide-install.json"), r#"{"repo":"o/r","version":"v1"}"#).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    fs::write(dir.join("data").join("user.txt"), "mine").unwrap();
    dir
}

fn opts(dir: &Path, delete: bool, user_data: &Path) -> UninstallOpts {
    let mut o = UninstallOpts::standard(dir.to_path_buf(), delete, user_data.to_path_buf());
    o.timing = Timing { retries: 2, delay: Duration::from_millis(1) };
    o.close_grace = Duration::from_millis(500);
    o.release_shell_ext = false;
    o
}

#[test]
fn modify_in_place_only_rewrites_the_config() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let new = InstallConfig { desktop_shortcut: true, ..Default::default() };
    let r = run(|c| modify_in_place(&dir, &new, true, c)).unwrap();
    assert_eq!(r, Registration::Skipped); // no registration script in this fake install
    assert_eq!(install_config::read(&dir).unwrap(), new);
    assert!(dir.join("null.exe").exists() && dir.join("data").join("user.txt").exists());
    assert!(!dir.parent().unwrap().join(".null-update-journal.json").exists());
}

#[test]
fn modify_in_place_refuses_a_changed_builtin_set_and_a_foreign_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let changed = InstallConfig { excluded_builtins: vec!["null-music".into()], ..Default::default() };
    let e = run(|c| modify_in_place(&dir, &changed, true, c)).unwrap_err().to_string();
    assert!(e.contains("built-in"), "{e}");
    assert!(!dir.join("install-config.json").exists());

    let foreign = tmp.path().join("Documents");
    fs::create_dir_all(&foreign).unwrap();
    assert!(run(|c| modify_in_place(&foreign, &InstallConfig::default(), true, c)).is_err());
    assert!(!foreign.join("install-config.json").exists());
}

#[test]
fn uninstall_removes_the_app_but_keeps_portable_data_by_default() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let appdata = tmp.path().join("Roaming").join("Null");
    fs::create_dir_all(&appdata).unwrap();
    fs::write(appdata.join("settings.json"), "{}").unwrap();
    run(|c| uninstall(&opts(&dir, false, &appdata), c)).unwrap();
    assert!(!dir.join("null.exe").exists() && !dir.join(".null-ide-install.json").exists());
    assert_eq!(fs::read_to_string(dir.join("data").join("user.txt")).unwrap(), "mine");
    assert!(appdata.join("settings.json").exists());
}

#[test]
fn uninstall_with_delete_removes_everything_including_the_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let appdata = tmp.path().join("Roaming").join("Null");
    fs::create_dir_all(&appdata).unwrap();
    fs::write(appdata.join("settings.json"), "{}").unwrap();
    run(|c| uninstall(&opts(&dir, true, &appdata), c)).unwrap();
    assert!(!dir.exists() && !appdata.exists());
}

#[test]
fn uninstall_never_deletes_a_folder_that_is_not_a_null_install() {
    let tmp = tempfile::tempdir().unwrap();
    let foreign = tmp.path().join("Documents");
    fs::create_dir_all(&foreign).unwrap();
    fs::write(foreign.join("thesis.txt"), "important").unwrap();
    let e = run(|c| uninstall(&opts(&foreign, true, &tmp.path().join("Null")), c)).unwrap_err().to_string();
    assert!(e.contains("not a Null IDE install"), "{e}");
    assert_eq!(fs::read_to_string(foreign.join("thesis.txt")).unwrap(), "important");
}

#[test]
fn deleting_user_data_only_ever_targets_a_folder_named_null() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let not_null = tmp.path().join("Documents");
    fs::create_dir_all(&not_null).unwrap();
    fs::write(not_null.join("thesis.txt"), "important").unwrap();
    assert!(run(|c| uninstall(&opts(&dir, true, &not_null), c)).is_err());
    assert!(not_null.join("thesis.txt").exists());
    assert!(dir.join("null.exe").exists()); // refused before anything was removed
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test manage`
Expected: FAIL — unresolved import `manage`.

- [ ] **Step 3: Implement** — `setup/core/src/manage.rs`

```rust
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::{
    error::{Error, IoCtx, Result},
    install_config::{self, Feature, InstallConfig},
    procs,
    progress::Ctx,
    registrations::{self, Registration},
    shellext,
    swap::{self, Timing},
    update::report,
};

fn is_ours(dir: &Path) -> bool {
    dir.join(".null-ide-install.json").is_file()
}

/// Applies a changed config when the built-in set is the same: only registrations move and the file is rewritten.
/// No swap, the IDE keeps running. A changed built-in set needs `update` with `Kind::Repair` and the new config.
pub fn modify_in_place(install: &Path, new: &InstallConfig, allow_elevate: bool, ctx: &Ctx) -> Result<Registration> {
    report(modify_inner(install, new, allow_elevate, ctx), ctx)
}

fn modify_inner(install: &Path, new: &InstallConfig, allow_elevate: bool, ctx: &Ctx) -> Result<Registration> {
    let _lock = swap::lock_install(install, Duration::ZERO)?;
    if !is_ours(install) {
        return Err(Error::Other(format!("no Null IDE install found in {}", install.display())));
    }
    let old = install_config::read(install)?;
    if install_config::builtins_changed(&old, new) {
        return Err(Error::Other("the built-in selection changed; that needs a repair with the new config".into()));
    }
    let reg = registrations::apply(install, &old.added_features(new), &old.removed_features(new), allow_elevate, ctx);
    install_config::write(install, new)?;
    Ok(reg)
}

pub struct UninstallOpts {
    pub install_dir: PathBuf,
    pub delete_user_data: bool,
    /// `%APPDATA%\Null`; only deleted when `delete_user_data` is set and the folder is named `Null`.
    pub user_data_dir: PathBuf,
    pub timing: Timing,
    pub close_grace: Duration,
    pub release_shell_ext: bool,
}

impl UninstallOpts {
    pub fn standard(install_dir: PathBuf, delete_user_data: bool, user_data_dir: PathBuf) -> UninstallOpts {
        UninstallOpts {
            install_dir,
            delete_user_data,
            user_data_dir,
            timing: Timing::STANDARD,
            close_grace: Duration::from_secs(15),
            release_shell_ext: true,
        }
    }
}

/// Removes the app, all registrations and (on request) the user's data. `data\` inside the install is a
/// portable profile: it survives unless deletion was requested. A folder without `.null-ide-install.json` is never touched.
pub fn uninstall(o: &UninstallOpts, ctx: &Ctx) -> Result<()> {
    report(uninstall_inner(o, ctx), ctx)
}

fn uninstall_inner(o: &UninstallOpts, ctx: &Ctx) -> Result<()> {
    if o.delete_user_data && o.user_data_dir.file_name() != Some(std::ffi::OsStr::new("Null")) {
        return Err(Error::Other(format!("refusing to delete {}: not a folder named Null", o.user_data_dir.display())));
    }
    let _lock = swap::lock_install(&o.install_dir, Duration::ZERO)?;
    swap::recover_unlocked(&o.install_dir, &o.timing)?;
    if !is_ours(&o.install_dir) {
        return Err(Error::Other(format!("{} is not a Null IDE install; nothing was removed", o.install_dir.display())));
    }
    procs::close_all(&o.install_dir, ctx, o.close_grace)?;
    procs::release_inherited_handles(&o.install_dir, ctx);
    if o.release_shell_ext {
        shellext::release(ctx);
    }
    // Registrations first: the script that removes them lives inside the folder deleted below.
    if let Registration::Warning(w) = registrations::apply(&o.install_dir, &[], &Feature::ALL, false, ctx) {
        ctx.log.line(&format!("some registrations could not be removed: {w}"));
    }
    remove_install(&o.install_dir, !o.delete_user_data)?;
    if o.delete_user_data && o.user_data_dir.is_dir() {
        fs::remove_dir_all(&o.user_data_dir).ctx("remove user data")?;
    }
    Ok(())
}

fn remove_install(dir: &Path, keep_data: bool) -> Result<()> {
    for entry in fs::read_dir(dir).ctx("list the install folder")? {
        let entry = entry.ctx("list the install folder")?;
        if keep_data && entry.file_name() == "data" {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.file_type().ctx("inspect the install folder")?.is_dir();
        let done = if is_dir { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
        done.ctx(format!("remove {}", path.display()))?;
    }
    let _ = fs::remove_dir(dir); // succeeds only when empty, i.e. when no portable data was kept
    Ok(())
}
```

Add to `setup/core/src/lib.rs`: `pub mod manage;`

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p null-setup-core`
Expected: PASS (6 new tests, all earlier ones).

- [ ] **Step 5: Commit**

```bash
git add setup/core/src/manage.rs setup/core/src/lib.rs setup/core/tests/manage.rs
git commit -m "feat(setup): modify in place and uninstall that keep user data and refuse foreign folders"
```

---

### Task 8: CLI modes `install`, `modify`, `repair`, `uninstall`

**Files:**
- Modify: `setup/app/src/args.rs`
- Create: `setup/app/src/cli.rs`
- Modify: `setup/app/src/main.rs`

**Interfaces:**
- Consumes: `update::{update, Opts, Kind}`, `manage::{modify_in_place, uninstall, UninstallOpts}`, `install_config::{read, read_file, builtins_changed}`, `config::read` (Tasks 3, 6, 7).
- Produces: the CLI contract used by Task 9 and by sub-project 2c:
  - `null-setup install --version <tag> --install-dir <dir> [--repo o/r] [--config <install-config.json>] [--launch]`
  - `null-setup repair --install-dir <dir> [--launch] [--force-close]` (version = the installed one)
  - `null-setup modify --install-dir <dir> --config <install-config.json> [--launch] [--force-close]` (no swap when the built-in set is unchanged)
  - `null-setup uninstall --install-dir <dir> [--delete-data] [--force-close]`
  - Progress as JSON lines on stdout (like `prefetch`); exit 0 on success, 1 on failure. `--force-close` ends IDE processes that ignore the close request.

- [ ] **Step 1: Write the failing tests** — append to `mod tests` in `setup/app/src/args.rs`

```rust
    #[test]
    fn parses_the_management_modes() {
        let a = p("install --version v1 --install-dir C:\\x --config C:\\c.json --launch").unwrap();
        assert_eq!(a.mode, Mode::Install);
        assert_eq!(a.config.as_deref(), Some(std::path::Path::new("C:\\c.json")));
        assert!(a.launch);
        assert_eq!(p("repair --install-dir C:\\x --force-close").unwrap().mode, Mode::Repair);
        assert!(p("repair --install-dir C:\\x --force-close").unwrap().force_close);
        let m = p("modify --install-dir C:\\x --config C:\\c.json").unwrap();
        assert_eq!(m.mode, Mode::Modify);
        let u = p("uninstall --install-dir C:\\x --delete-data").unwrap();
        assert_eq!((u.mode, u.delete_data), (Mode::Uninstall, true));
        assert!(!p("uninstall --install-dir C:\\x").unwrap().delete_data);
    }

    #[test]
    fn only_install_needs_a_version_among_the_management_modes() {
        assert!(p("install --install-dir C:\\x").is_err());
        assert!(p("repair --install-dir C:\\x").is_ok());
        assert!(p("modify --install-dir C:\\x --config C:\\c.json").is_ok());
        assert!(p("uninstall --install-dir C:\\x").is_ok());
        assert!(p("uninstall --version ..\\evil --install-dir C:\\x").is_err()); // a given tag is still validated
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup --bin null-setup` (in `setup/`)
Expected: FAIL to compile — no `Mode::Install`, no `config` field.

- [ ] **Step 3: Implement `args.rs`**

Change the `Mode` enum and `Args`, and the parser:

```rust
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Mode { Prefetch, Update, Recover, Install, Modify, Repair, Uninstall }

#[derive(Debug)]
pub struct Args {
    pub mode: Mode,
    pub repo: String,
    pub tag: String,
    pub install_dir: PathBuf,
    pub launch: bool,
    pub config: Option<PathBuf>,
    pub force_close: bool,
    pub delete_data: bool,
}
```

In `parse`: extend the mode match with `Some("install") => Mode::Install, Some("modify") => Mode::Modify, Some("repair") => Mode::Repair, Some("uninstall") => Mode::Uninstall,` and update the error text to list all modes. Replace the flag loop's state and arms:

```rust
    let (mut repo, mut tag, mut install_dir, mut launch) = ("TorresVisual/null-ide".to_string(), String::new(), None, false);
    let (mut config, mut force_close, mut delete_data) = (None, false, false);
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match flag.as_str() {
            "--repo" => repo = value("--repo")?,
            "--version" => tag = value("--version")?,
            "--install-dir" => install_dir = Some(PathBuf::from(value("--install-dir")?)),
            "--config" => config = Some(PathBuf::from(value("--config")?)),
            "--launch" => launch = true,
            "--force-close" => force_close = true,
            "--delete-data" => delete_data = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
```

Replace the version check and the return:

```rust
    // Modes that download for a version need one; the others use the installed version and only validate a given tag.
    let needs_tag = matches!(mode, Mode::Prefetch | Mode::Update | Mode::Install);
    if (needs_tag || !tag.is_empty()) && !safe_tag(&tag) {
        return Err("--version is required and may only contain letters, digits, '.', '-' and '_'".into());
    }
    if mode == Mode::Modify && config.is_none() {
        return Err("modify needs --config <file>".into());
    }
    Ok(Args { mode, repo, tag, install_dir, launch, config, force_close, delete_data })
```

(Remove the old `if mode != Mode::Recover && !safe_tag(&tag)` check. The existing test `recover_needs_no_version` still holds.)

- [ ] **Step 4: Implement `cli.rs`**

```rust
use std::io::Write;

use null_setup_core::{
    config, install_config,
    manage::{self, UninstallOpts},
    procs::Running,
    progress::{logs_dir, Ctx, Interact, LockedChoice, Logger, Progress},
    update::{self, Kind, Opts},
    Error, Result,
};

use crate::args::{Args, Mode};

/// No window yet: a running IDE is closed only when `--force-close` was given.
struct Auto { force: bool }

impl Interact for Auto {
    fn locked(&self, _: &[Running]) -> LockedChoice {
        if self.force { LockedChoice::ForceClose } else { LockedChoice::Cancel }
    }
}

pub fn run(a: &Args) -> i32 {
    let log = Logger::open(&logs_dir());
    let emit = |p: Progress| {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{}", serde_json::to_string(&p).unwrap_or_default());
        let _ = out.flush();
    };
    let interact = Auto { force: a.force_close };
    let ctx = Ctx { progress: &emit, log: &log, interact: &interact };
    match dispatch(a, &ctx) {
        Ok(()) => 0,
        Err(_) => 1, // `Failed` was already emitted and logged by the core
    }
}

fn load_config(a: &Args) -> Result<Option<install_config::InstallConfig>> {
    a.config.as_deref().map(install_config::read_file).transpose()
}

fn installed_tag(a: &Args) -> Result<String> {
    Ok(config::read(&a.install_dir)?.version)
}

fn deploy(a: &Args, kind: Kind, tag: String, cfg: Option<install_config::InstallConfig>, ctx: &Ctx) -> Result<()> {
    let mut o = Opts::standard(a.repo.clone(), tag, a.install_dir.clone());
    o.kind = kind;
    o.config = cfg;
    o.launch = a.launch;
    // Only a fresh install or a modify may start the elevated certificate import.
    o.allow_elevate = kind == Kind::Install || a.mode == Mode::Modify;
    update::update(&o, ctx).map(|_| ())
}

fn dispatch(a: &Args, ctx: &Ctx) -> Result<()> {
    match a.mode {
        Mode::Install => {
            let cfg = load_config(a)?.unwrap_or_default();
            deploy(a, Kind::Install, a.tag.clone(), Some(cfg), ctx)
        }
        Mode::Repair => deploy(a, Kind::Repair, installed_tag(a)?, None, ctx),
        Mode::Modify => {
            let new = load_config(a)?.ok_or_else(|| Error::Other("modify needs --config <file>".into()))?;
            let old = install_config::read(&a.install_dir)?;
            if install_config::builtins_changed(&old, &new) {
                deploy(a, Kind::Repair, installed_tag(a)?, Some(new), ctx)
            } else {
                manage::modify_in_place(&a.install_dir, &new, true, ctx).map(|_| ())
            }
        }
        Mode::Uninstall => {
            let user_data = std::env::var_os("APPDATA").map(std::path::PathBuf::from).unwrap_or_default().join("Null");
            manage::uninstall(&UninstallOpts::standard(a.install_dir.clone(), a.delete_data, user_data), ctx)
        }
        Mode::Prefetch | Mode::Update | Mode::Recover => unreachable!("handled in main"),
    }
}
```

Note: errors from `load_config`/`installed_tag`/`read` happen before the core's `report` runs, so no `Failed` line is printed for them. Emit it in `run`: change the `Err(_) => 1` arm to

```rust
        Err(e) => {
            log.line(&format!("failed: {e}"));
            emit(Progress::Failed { message: e.to_string(), log: log.path().map(|p| p.display().to_string()) });
            1
        }
```
(A second `Failed` line after one the core already printed is harmless to a reader that takes the last line.) Update the comment on the `Ok(())` arm accordingly and delete the now-wrong comment on `Err`.

- [ ] **Step 5: Wire `main.rs`**

Add `mod cli;` and replace the `match args.mode { … }` with:

```rust
    let code = match args.mode {
        Mode::Prefetch => headless::prefetch(&args),
        Mode::Recover => headless::recover(&args),
        Mode::Update => {
            // Never keep a handle on the install dir (inherited cwd): the swap renames it.
            let _ = std::env::set_current_dir(null_setup_core::local_app_data());
            relocate::maybe_relocate(&args);
            window::run_update(args)
        }
        Mode::Install | Mode::Modify | Mode::Repair | Mode::Uninstall => {
            let _ = std::env::set_current_dir(null_setup_core::local_app_data());
            relocate::maybe_relocate(&args); // a copy under <install>\setup would block the swap or the deletion
            cli::run(&args)
        }
    };
```

- [ ] **Step 6: Run to verify it passes, then build**

Run: `cargo test --locked -p null-setup-core -p null-setup` and `cargo build --release --locked -p null-setup` (in `setup/`).
Expected: all tests PASS (the earlier 65 plus the new ones); the release build succeeds. If `--locked` complains, `Cargo.lock` must not have changed (no new crates were added); investigate before committing a lock change.

- [ ] **Step 7: Commit**

```bash
git add setup/app/src/args.rs setup/app/src/cli.rs setup/app/src/main.rs
git commit -m "feat(setup): install, modify, repair and uninstall modes"
```

---

### Task 9: Runbook, manual matrix, docs, security review

**Files:**
- Create: `docs/specs/null-setup-installer-engine-test-runbook.md`
- Modify: `CLAUDE.md` (the `setup/` section), `docs/specs/null-setup-installer-design.md` (Sequencing), `docs/plans/null-setup-updater.md` is **not** touched.

**Interfaces:** none (verification and documentation).

- [ ] **Step 1: Run the full automated suite**

```powershell
cd setup; cargo test --locked -p null-setup-core -p null-setup; cd ..
node --test scripts/gen-builtins.test.mjs
```
Expected: all pass. Record the totals.

- [ ] **Step 2: Prepare a scratch release**

Per `docs/specs/null-setup-updater-test-runbook.md` ("Every row: reset, serve, launch"): take the "new" zip, add `builtins.json` at its root (`node scripts/gen-builtins.mjs <unzipped>\builtins.json`, then re-zip and recompute the `.sha256`), serve it with `scripts/fake-release.mjs --tag <tag>`, and set `NULL_SETUP_API_BASE=http://127.0.0.1:<port>`. Use `Remove-Item -Recurse` to reset a scratch target between rows. Run `null-setup.exe` with its output piped (`… | Out-String`) because it is a GUI-subsystem program and prints nothing to an attached console otherwise.

- [ ] **Step 3: Run the matrix and record each row in the runbook**

| # | Scenario | Expect |
|---|---|---|
| 1 | `install` into a new folder with no `--config` | files, `install-config.json` = defaults, `builtins.json` present, Start Menu shortcut + Safe Mode shortcut exist, file associations registered, `<install>\bin` on the user PATH |
| 2 | `install` with a config excluding `null-music` and `null-activity` | the two folders are absent, IDE starts, they are missing from `@builtin` |
| 3 | `install` with a config excluding `null-env` (null-format needs it) | fails with both names in the message; target folder untouched |
| 4 | `install` into a folder holding a text file | refused ("not empty"); the file is untouched |
| 5 | `install` onto the existing scratch install | refused ("already installed") |
| 6 | Update (fake newer tag) on row 2's install | `null-music`/`null-activity` still absent; `install-config.json` unchanged |
| 7 | `modify` with only `desktopShortcut: true` and the IDE running | desktop shortcut appears; IDE not closed; no `.null-ide-bak-*` folder was created; only `install-config.json` changed |
| 8 | `modify` re-adding `null-music` (exclusions now only `null-activity`) | swap happens; `null-music` is back, data kept |
| 9 | `modify` with `path: false` | `<install>\bin` leaves the user PATH |
| 10 | `repair` after deleting `null.exe` from the install | `null.exe` is back, config kept |
| 11 | `uninstall` of a portable scratch install, no `--delete-data` | app gone, `data\` kept, shortcuts, PATH entry, associations and context menu removed |
| 12 | `uninstall --delete-data` | folder gone, a stand-in `%APPDATA%\Null` is the only user-data target (test with `APPDATA` pointed at a scratch folder: `$env:APPDATA = "$env:TEMP\ApData"`) |
| 13 | `uninstall` pointed at a normal folder | refused; folder untouched |
| 14 | Install dir with spaces and non-ASCII (`Null IDE ünï`) for rows 1, 7, 11 | works |

Set `$env:APPDATA` to a scratch folder for every row so your real profile is never involved.

- [ ] **Step 4: Security review**

Dispatch the `security-reviewer` agent on the diff of this plan (`setup/`, `scripts/install-null-ide.ps1`, `scripts/gen-builtins.mjs`, the `build.yml` change). Points to hand it: the swap deletes the folder it replaces (`check_target` is the guard), `uninstall` deletes a user-supplied path (`.null-ide-install.json` marker and the `Null` folder-name rule), `--config` is read from a user-supplied path, `-Register/-Unregister` values come from `Feature::script_name` only. Fix any Critical/High finding with a test.

- [ ] **Step 5: Update the docs**

- `CLAUDE.md`, `### setup/ (null-setup)` section: add the four modes (`install`, `modify`, `repair`, `uninstall`) with their one-line purposes, `install-config.json` (shell-integration features + `excludedBuiltins`, read by `update` so it honors the choices), `builtins.json` (generated by `scripts/gen-builtins.mjs` from `setup/builtins.config.json`; unchecked built-ins are deleted from the staged tree before the swap), and that registrations still run through `install-null-ide.ps1 -Register/-Unregister` until 2b. Link the plan and the runbook. Keep the section's existing length style.
- `docs/specs/null-setup-installer-design.md`, Sequencing: replace the "Sub-project 2" paragraph with the 2a/2b/2c split from this plan's header and mark 2a with its plan path.

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: installer engine runbook, matrix results and setup notes"
```

---

## Self-Review

**Spec coverage** (sub-project 2 of the design, 2a slice): built-in selection by leaving folders off disk and Core lock → Tasks 1, 2, 4, 6; `builtins.json` with `requires`/`locked`/`default` generated at build and shipped in zip + asset → Tasks 2, 4; `install-config.json` with shell toggles and built-in selection, schema version, re-applied on update → Tasks 3, 6; modes `install`, `modify` (only the changed parts), `repair`, `uninstall` (keeps `%APPDATA%\Null` by default, optional delete) → Tasks 6–8; "only fresh install or modify may elevate" → `allow_elevate` (Tasks 5, 6, 8); individually reversible registrations → Task 5. Deliberately not here, each named in Global Constraints: wizard UI, stub installer, `first-run.json`, `Null: Setup`, ARP entry and Inno retirement (2c); Rust port of the registrations (2b); `marketplace`/`settings` manifest tables (2c).

**Placeholder scan:** no TBD/TODO; every code step has code; the only prose-only steps are manual verification (Tasks 1, 9) and the YAML/PowerShell edits whose anchors are named, plus `build-local.ps1` where the exact anchor lines are named but the file must be read first (stated in the step).

**Type consistency:** `Feature`/`InstallConfig` (Task 3) are used with the same names in Tasks 5–8; `registrations::apply(install, register, unregister, allow_elevate, ctx)` (Task 5) matches its callers in Tasks 6 and 7; `Kind`, `Opts.config`, `Opts.allow_elevate` (Task 6) match Task 8's `deploy`; `update::report` is made `pub(crate)` in Task 6 and used in Task 7; `builtins::{load, resolve, prune}` signatures match Task 6's `prune_builtins`.

**Review Focus coverage:** line 1 → `install_refuses_a_folder_that_is_not_empty_and_not_ours`, `install_refuses_an_existing_install`; 2 → `resolve_*` tests and `an_update_survives_saved_choices_the_new_release_cannot_honor`; 3 → `a_newer_schema_or_broken_json_is_an_error_not_defaults` and `a_corrupt_config_stops_the_update_before_anything_changes`; 4 → the three `uninstall_*` tests and `deleting_user_data_only_ever_targets_a_folder_named_null`; 5 → `modify_in_place_only_rewrites_the_config`, `modify_in_place_refuses_a_changed_builtin_set…`, `a_chosen_set_that_breaks_a_dependency_fails_and_leaves_the_old_install`.

**Known gaps carried forward (not fixed here):** a rolled-back repair/update still leaves HKCU registrations as the failed attempt wrote them (same as the updater's known gap); an install from before this plan has no `install-config.json`, so its update re-registers the three registry features whether or not the user had them (the default config), which is today's behavior.
