# Null Setup, Sub-project 2b: Registrations in Rust Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the `-Register` / `-Unregister` half of `scripts/install-null-ide.ps1` with a tested `shell` module in `setup/core`, so `null-setup` registers and removes shortcuts, the user PATH entry, the context menu (HKCU verbs and the Win11 sparse APPX), file associations and the preview handler without starting PowerShell for anything except the three `*-AppxPackage` cmdlets.

**Architecture:** `registrations.rs` gets a `Registrar` trait; `Opts`, `UninstallOpts` and `modify_in_place` carry one, so no test ever touches the real registry. The real one, `ShellRegistrar`, drives `shell::apply_with(loc, sys, …)`. `shell` is split by registration kind (`classes`, `path`, `shortcuts`, `win11`), each function taking a `Locations` (an HKCU prefix plus the Desktop/Programs folders, so tests write into a scratch hive) and a `System` trait (Explorer restart, change notifications, `.lnk` creation, certificate store, APPX cmdlets; faked in tests, `WinSystem` in production). The elevated certificate import re-runs `null-setup` itself through `ShellExecuteExW "runas"` as a new `trust-cert` mode that takes only an install folder, never a free path.

**Tech Stack:** Rust (`winreg` 0.56 and `windows` 0.62 — both already in `Cargo.lock` through Tauri, now direct dependencies of `core`), PowerShell only for `Get-AppxPackage` / `Add-AppxPackage` / `Remove-AppxPackage`, Markdown runbook.

**Spec:** `docs/specs/null-setup-installer-design.md` — second of the three slices of its "Sub-project 2" (2a engine is done: `docs/plans/null-setup-installer-engine.md`). Spec lines 57 (`shell` module), 115 (retire the script) and 151 (largest-risk piece, "keep behavior identical and test on a clean machine") govern this plan.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Supported Windows: Windows 11 and Windows 10 22H2. No code signing.
- Behavior stays identical to `install-null-ide.ps1 -Register/-Unregister` (the table in "Parity" below is the contract). The only deliberate differences are listed there.
- Registrations write only under `HKCU`, the user's Desktop and Start Menu folders, and (elevated, `trust-cert` only) `LocalMachine\TrustedPeople`. Nothing is written inside `%APPDATA%\Null\User\`.
- Only a fresh install or `modify` may elevate; `update`, `repair` and `uninstall` never do (`allow_elevate` is false for them). Unchanged from 2a.
- `scripts/install-null-ide.ps1` **stays in the repo and in `resources/app/null-updater/`** until 2c: `installer/null-ide.iss` (`[Run]` and `[UninstallRun]`) and the README one-liner (`irm … | iex`) still call it, and an install still running a 2a `null-setup` finds it there when it updates into this release. `null-setup` simply stops calling it. 2c deletes it together with Inno.
- `Set-DefaultSettings` is not ported (the spec removes settings seeding). `Write-NullShim` is not ported either: it belongs to `Install-Zip`, not to `-Register`, and the Rust install path never ran it.
- **No test may touch the real HKCU, the real user PATH, the real Start Menu or Desktop, or the real certificate stores.** Registry tests use `tests/support::Hive` (a scratch key `HKCU\Software\NullSetupTest\<id>\` removed on drop); everything else goes through `System`. The one test that uses the real `WinSystem` writes a `.lnk` into a temp folder.
- Editing rules from `CLAUDE.md`: a crate's minor version may differ from the signatures in this plan — look the call up (the `ctx7` CLI or `~/.cargo/registry/src/*/<crate>/`), adjust the call, keep the behavior and the tests. Do not run `scripts/build-local.ps1`. Work only inside `D:\Coding\Apps\null-ide\`.
- Commit per task with the repo style (`feat(setup): …`, `refactor(setup): …`, `docs: …`). Do not push. End every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run cargo from `setup/`. First `cargo build -p null-setup-core` (no `--locked`) so `Cargo.lock` picks up the new direct dependencies, and commit the lock change with Task 2; afterwards use `--locked` as CI does.

## Parity

What the script does per feature (`-Register`; `-Unregister` is the inverse), and what the Rust port must do. `exe` = `<install>\null.exe`, `bin` = `<install>\bin`.

| Feature | Registers | Unregisters |
|---|---|---|
| `desktopShortcut` | `<Desktop>\Null IDE.lnk` → exe, working dir = install, icon `exe,0` | delete that file |
| `startMenuShortcut` | `<Programs>\Null IDE\Null IDE.lnk` | delete; the `Null IDE` folder goes when it is empty |
| `safeModeShortcut` | `<Programs>\Null IDE\Null IDE (Safe Mode).lnk`, arguments `--safe-mode` | delete; same folder rule |
| `path` | remove `install` from the user PATH, add `bin` | remove `bin` and `install` |
| `contextMenu` | HKCU verbs `*`, `Directory`, `Directory\Background` + `NullIDEContextMenu` key, then the Win11 sparse APPX flow | delete the four keys, remove the APPX package |
| `fileAssociations` | 36 ProgIDs, `OpenWithProgids`, `Applications\null.exe`, `NullIDE\Capabilities`, `RegisteredApplications` value, `SHChangeNotify` | inverse |
| `previewHandler` | CLSID, approved-handlers value, per-extension `shellex` key unless another app owns it, `SHChangeNotify` | remove only keys/values that are ours |

Deliberate differences from the script (all in the direction of safer):
1. A failing feature no longer stops the remaining ones; every failure is collected and returned as one `Registration::Warning("<feature>: <reason>; …")`. The script aborted at the first.
2. PATH comparison ignores case **and** a trailing `\` (the script ignored case only), and the registry value keeps its type (`REG_EXPAND_SZ` stays `REG_EXPAND_SZ`; the script went through .NET, which rewrote it).
3. The elevated certificate import is `null-setup trust-cert --install-dir <dir>` (it derives `<dir>\shell-ext\NullIDECert.cer` itself and checks the subject is `CN=Null IDE`), not `powershell Import-Certificate -FilePath <anything>`.

## Review Focus

Most likely first. Each line is pinned by a test in the task named in brackets.

1. A user PATH that contains `%USERPROFILE%`-style entries (`REG_EXPAND_SZ`), empty segments, a trailing `\`, or is very long must come back byte-identical except for the one added or removed entry, and keep its type. Flattening it to `REG_SZ` silently breaks every `%VAR%` entry for the user. [Task 5]
2. Shared registry keys: removing our registration must leave another app's `OpenWithProgids` values and preview handlers alone; claiming a preview handler must skip an extension another CLSID owns; registering twice and unregistering twice (or with nothing registered) is a no-op, never an error. [Tasks 3, 4]
3. Win11 flow: an update (no elevation) with an untrusted new certificate must keep the existing package untouched and say so; a UAC prompt the user declines must become a `Warning`, not a hang, panic or half-removed package; a failed `Add-AppxPackage` after removing the old package must surface the cmdlet's message. [Tasks 7, 8]
4. Install folder with spaces and non-ASCII (`C:\Null IDE ünï`) in every written command line, shortcut target and registry value; no quoting bug, no lossy conversion. [Tasks 3, 6, 8]
5. The elevated entry point must not accept a free path: `trust-cert` reads only `<install>\shell-ext\NullIDECert.cer`, only in a folder that holds `.null-ide-install.json`, and refuses a certificate whose subject is not `Null IDE`. Unregistering must also work when `null.exe` is gone. [Tasks 8, 9]

## File Structure

```
setup/
├── core/Cargo.toml                      # MODIFY winreg, windows
├── core/src/
│   ├── registrations.rs                 # MODIFY Registrar trait; ScriptRegistrar (T1) → ShellRegistrar (T9)
│   ├── install_config.rs                # MODIFY drop Feature::script_name (T9)
│   ├── manage.rs, update.rs             # MODIFY carry a Registrar
│   ├── lib.rs                           # MODIFY pub mod shell
│   └── shell/
│       ├── mod.rs                       # NEW Locations, hkcu helpers, System trait, apply_with
│       ├── assoc.rs                     # NEW the extension table
│       ├── classes.rs                   # NEW context-menu verbs, file associations, preview handler
│       ├── path.rs                      # NEW user PATH
│       ├── shortcuts.rs                 # NEW .lnk specs and Start Menu folder cleanup
│       ├── win11.rs                     # NEW sparse APPX flow over System
│       └── sys.rs                       # NEW WinSystem (real side effects), trust_cert_machine
├── core/tests/
│   ├── support/mod.rs                   # MODIFY Recorder (registrar), Hive, FakeSystem
│   ├── data/NullIDETestCert.cer         # NEW public test certificate (T8)
│   ├── shell_assoc.rs  shell_classes.rs  shell_path.rs  shell_shortcuts.rs
│   ├── shell_win11.rs  shell_apply.rs  shell_sys.rs                         # NEW
│   ├── registration_args.rs  registrations.rs                               # DELETE (T9)
│   └── manage.rs  update.rs                                                 # MODIFY inject Recorder
└── app/src/args.rs, main.rs, cli.rs, headless.rs                            # MODIFY trust-cert mode
docs/specs/null-setup-registrations-runbook.md                               # NEW (T10)
CLAUDE.md, docs/specs/null-setup-installer-design.md, .claude/agents/security-reviewer.md   # MODIFY (T10)
```

---

### Task 1: The `Registrar` seam (pure refactor, behavior unchanged)

Today `update`/`modify`/`uninstall` stay off the real registry only because the fake installs in their tests contain a stub script. Once registrations are native there is no script to stub, so inject the registrar first, while everything is still green.

**Files:**
- Modify: `setup/core/src/registrations.rs`, `setup/core/src/update.rs`, `setup/core/src/manage.rs`
- Modify: `setup/app/src/cli.rs`, `setup/app/src/window.rs` (only if they construct what changed)
- Modify: `setup/core/tests/support/mod.rs`, `setup/core/tests/manage.rs`, `setup/core/tests/update.rs`

**Interfaces:**
- Produces:
  ```rust
  // registrations.rs
  pub trait Registrar: Send + Sync {
      fn apply(&self, install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration;
  }
  pub struct ScriptRegistrar;                       // today's behavior; replaced in Task 9
  pub fn standard() -> Arc<dyn Registrar>;          // Task 9 changes what this returns
  // update::Opts      gains  pub registrar: Arc<dyn Registrar>
  // manage::UninstallOpts gains pub registrar: Arc<dyn Registrar>
  // manage::modify_in_place(install, new, allow_elevate, registrar: &dyn Registrar, ctx)
  // tests/support:
  pub struct Recorder { pub calls: Mutex<Vec<Call>>, pub result: Registration }
  pub struct Call { pub register: Vec<Feature>, pub unregister: Vec<Feature>, pub allow_elevate: bool }
  impl Recorder { pub fn new(result: Registration) -> Arc<Recorder> }
  ```

- [ ] **Step 1: Add the recorder to the test support and use it in a new failing test**

In `setup/core/tests/support/mod.rs` add (the file already has `#![allow(dead_code)]`):

```rust
use std::sync::{Arc, Mutex};

use null_setup_core::{
    install_config::Feature,
    progress::Ctx,
    registrations::{Registrar, Registration},
};

pub struct Call { pub register: Vec<Feature>, pub unregister: Vec<Feature>, pub allow_elevate: bool }

/// Stands in for the real registrar so no test writes the registry, PATH or Start Menu.
pub struct Recorder { pub calls: Mutex<Vec<Call>>, pub result: Registration }

impl Recorder {
    pub fn new(result: Registration) -> Arc<Recorder> { Arc::new(Recorder { calls: Mutex::new(vec![]), result }) }
}

impl Registrar for Recorder {
    fn apply(&self, _: &std::path::Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, _: &Ctx) -> Registration {
        self.calls.lock().unwrap().push(Call { register: register.to_vec(), unregister: unregister.to_vec(), allow_elevate });
        self.result.clone()
    }
}
```

In `setup/core/tests/manage.rs` add `mod support;` at the top and replace the first modify test and the failing-script test:

```rust
#[test]
fn modify_in_place_only_rewrites_the_config() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let new = InstallConfig { desktop_shortcut: true, ..Default::default() };
    let rec = support::Recorder::new(Registration::Done);
    let r = run(|c| modify_in_place(&dir, &new, true, &*rec, c)).unwrap();
    assert_eq!(r, Registration::Done);
    let calls = rec.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].register, [Feature::DesktopShortcut]);
    assert!(calls[0].unregister.is_empty() && calls[0].allow_elevate);
    assert_eq!(install_config::read(&dir).unwrap(), new);
    assert!(dir.join("null.exe").exists() && dir.join("data").join("user.txt").exists());
    assert!(!dir.parent().unwrap().join(".null-update-journal.json").exists());
}

#[test]
fn modify_in_place_does_not_save_the_config_when_a_registration_fails() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let new = InstallConfig { desktop_shortcut: true, ..Default::default() };
    let rec = support::Recorder::new(Registration::Warning("boom".into()));
    let e = run(|c| modify_in_place(&dir, &new, true, &*rec, c)).unwrap_err().to_string();
    assert!(e.contains("boom"), "{e}");
    assert!(!dir.join("install-config.json").exists());
}
```
Add `install_config::Feature` to the imports. Update the other two `modify_in_place(...)` calls in this file the same way (`&*support::Recorder::new(Registration::Done)`), and in `opts(...)` add `o.registrar = support::Recorder::new(Registration::Done);` so every `uninstall` test is registry-free.

In `setup/core/tests/update.rs`, inside `opts(...)` after `o.reapply = false;` add `o.registrar = support::Recorder::new(null_setup_core::registrations::Registration::Done);`.

- [ ] **Step 2: Run to verify it fails**

Run (from `setup/`): `cargo test -p null-setup-core --test manage`
Expected: compile errors — `Registrar` not found in `registrations`, `registrar` field missing.

- [ ] **Step 3: Introduce the trait and thread it through**

`setup/core/src/registrations.rs`: keep `classify`, `script_args` and the old `apply` body, but make the body a method:

```rust
use std::sync::Arc;

pub trait Registrar: Send + Sync {
    fn apply(&self, install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration;
}

/// Until Task 9 of sub-project 2b: the script shipped inside the install does the work.
pub struct ScriptRegistrar;

impl Registrar for ScriptRegistrar {
    fn apply(&self, install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration {
        apply(install, register, unregister, allow_elevate, ctx)
    }
}

pub fn standard() -> Arc<dyn Registrar> { Arc::new(ScriptRegistrar) }
```
(The free `apply` stays `pub` so `tests/registration_args.rs` keeps compiling until Task 9.)

`update.rs`: add `pub registrar: Arc<dyn Registrar>,` to `Opts` (import `std::sync::Arc` and `registrations::Registrar`), set `registrar: registrations::standard(),` in `Opts::standard`, and in `register(...)` replace `registrations::apply(&o.install_dir, &wanted, &dropped, o.allow_elevate, ctx)` with `o.registrar.apply(&o.install_dir, &wanted, &dropped, o.allow_elevate, ctx)`.

`manage.rs`: add `registrar: &dyn Registrar` before `ctx` in `modify_in_place` and `modify_inner`, call `registrar.apply(install, …)`; add `pub registrar: Arc<dyn Registrar>` to `UninstallOpts` (set to `registrations::standard()` in `standard`) and call `o.registrar.apply(&o.install_dir, &[], &Feature::ALL, false, ctx)` in `uninstall_inner`.

`setup/app/src/cli.rs:80`: pass the real one: `manage::modify_in_place(&a.install_dir, &new, true, &*registrations::standard(), ctx)` (import `registrations`).

- [ ] **Step 4: Run the whole suite**

Run: `cargo test --locked -p null-setup-core -p null-setup`
Expected: PASS. `registration_args.rs` and `registrations.rs` still pass untouched (the free `apply` still exists).

- [ ] **Step 5: Commit**

```bash
git add setup/core setup/app
git commit -m "refactor(setup): inject the registrar so tests never touch the real registry" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `shell` scaffolding — locations, registry helpers, the extension table

**Files:**
- Modify: `setup/core/Cargo.toml`, `setup/core/src/lib.rs`, `setup/Cargo.lock`
- Create: `setup/core/src/shell/mod.rs`, `setup/core/src/shell/assoc.rs`
- Modify: `setup/core/tests/support/mod.rs` (add `Hive`)
- Test: `setup/core/tests/shell_assoc.rs`

**Interfaces:**
- Consumes: `Error::Io`, `IoCtx` from `error.rs`.
- Produces:
  ```rust
  // shell/mod.rs
  pub struct Locations { pub hkcu: String, pub desktop: PathBuf, pub programs: PathBuf }
  impl Locations {
      pub fn real() -> Result<Locations>;             // hkcu = "", folders from SHGetKnownFolderPath (Task 6 supplies sys::known_folder)
      pub fn key(&self, rel: &str) -> String;         // format!("{}{}", self.hkcu, rel)
  }
  pub(crate) fn create(loc: &Locations, rel: &str) -> Result<RegKey>;
  pub(crate) fn open(loc: &Locations, rel: &str) -> Option<RegKey>;                 // read-only
  pub(crate) fn open_write(loc: &Locations, rel: &str) -> Option<RegKey>;
  pub(crate) fn remove_tree(loc: &Locations, rel: &str) -> Result<()>;             // missing key = Ok
  pub(crate) fn set(k: &RegKey, name: &str, value: &str) -> Result<()>;            // name "" = the (default) value
  // shell/assoc.rs
  pub struct Assoc { pub key: &'static str, pub description: &'static str, pub extensions: &'static [&'static str], pub icon: Option<&'static str> }
  pub const TABLE: &[Assoc];
  pub fn all_extensions() -> Vec<&'static str>;     // unique, first-appearance order
  pub fn prog_id(a: &Assoc) -> String;              // "NullIDE.AssocFile.<key>"
  ```
  `Locations::real` returns `Err` until Task 6 — write it as `Ok(Locations { hkcu: String::new(), desktop: sys::known_folder(Desktop)?, programs: … })` in Task 6; in this task leave it out.

- [ ] **Step 1: Write the failing drift test**

`setup/core/tests/shell_assoc.rs` — the table is data copied from the script, so a test parses the script's `$FileAssocMap` and compares (it is deleted together with the script in 2c):

```rust
use null_setup_core::shell::assoc::{all_extensions, prog_id, TABLE};

type Row = (String, String, Vec<String>, Option<String>);

fn script_table() -> Vec<Row> {
    let ps1 = include_str!("../../../scripts/install-null-ide.ps1");
    let start = ps1.find("$FileAssocMap = [ordered]@{").expect("table in script");
    let body = &ps1[start..];
    let end = body.find("\n}\n").expect("end of table");
    body[..end]
        .lines()
        .skip(1)
        .filter(|l| l.contains("Description ="))
        .map(|l| {
            let key = l.split('=').next().unwrap().trim().to_string();
            let between = |from: &str, to: &str| {
                let s = l.find(from).unwrap() + from.len();
                let e = s + l[s..].find(to).unwrap();
                l[s..e].to_string()
            };
            let desc = between("Description = '", "'");
            let exts = between("Extensions = @(", ")").split(',').map(|e| e.trim().trim_matches('\'').to_string()).collect();
            let icon = l.contains("Icon = '").then(|| between("Icon = '", "'"));
            (key, desc, exts, icon)
        })
        .collect()
}

#[test]
fn the_table_matches_the_script() {
    let rust: Vec<Row> = TABLE
        .iter()
        .map(|a| (a.key.to_string(), a.description.to_string(), a.extensions.iter().map(|e| e.to_string()).collect(), a.icon.map(String::from)))
        .collect();
    assert_eq!(rust, script_table());
}

#[test]
fn extensions_are_unique_in_first_appearance_order() {
    let all = all_extensions();
    assert_eq!(all[0], ".js");
    let mut sorted = all.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), all.len());
    assert!(all.contains(&".code-workspace") && all.contains(&".h++"));
}

#[test]
fn prog_ids_are_stable() {
    assert_eq!(prog_id(&TABLE[0]), "NullIDE.AssocFile.js");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_assoc`
Expected: FAIL — `unresolved import null_setup_core::shell`.

- [ ] **Step 3: Add the dependencies, the module and the table**

`setup/core/Cargo.toml` `[dependencies]`:

```toml
winreg = "0.56"
windows = { version = "0.62", features = [
    "Win32_Foundation",
    "Win32_Security_Cryptography",
    "Win32_Storage_FileSystem",
    "Win32_System_Com",
    "Win32_System_Threading",
    "Win32_UI_Shell",
    "Win32_UI_WindowsAndMessaging",
] }
```
`lib.rs`: add `pub mod shell;`. Run `cargo build -p null-setup-core` once (no `--locked`) so the lock updates.

`shell/mod.rs`:

```rust
use std::{io, path::PathBuf};

use winreg::{enums::*, RegKey};

use crate::error::{Error, Result};

pub mod assoc;

/// Where registrations are written. Production: the real HKCU and shell folders. Tests: a scratch key prefix and temp folders.
#[derive(Clone, Debug)]
pub struct Locations {
    /// Prepended to every HKCU path. Empty in production; `Software\NullSetupTest\<id>\` in tests.
    pub hkcu: String,
    pub desktop: PathBuf,
    pub programs: PathBuf,
}

impl Locations {
    pub fn key(&self, rel: &str) -> String { format!("{}{}", self.hkcu, rel) }
}

fn io_err(what: String, source: io::Error) -> Error { Error::Io { context: what, source } }

fn hkcu() -> RegKey { RegKey::predef(HKEY_CURRENT_USER) }

pub(crate) fn create(loc: &Locations, rel: &str) -> Result<RegKey> {
    hkcu().create_subkey(loc.key(rel)).map(|(k, _)| k).map_err(|e| io_err(format!("create HKCU\\{rel}"), e))
}

pub(crate) fn open(loc: &Locations, rel: &str) -> Option<RegKey> { hkcu().open_subkey(loc.key(rel)).ok() }

pub(crate) fn open_write(loc: &Locations, rel: &str) -> Option<RegKey> {
    hkcu().open_subkey_with_flags(loc.key(rel), KEY_READ | KEY_WRITE).ok()
}

pub(crate) fn remove_tree(loc: &Locations, rel: &str) -> Result<()> {
    match hkcu().delete_subkey_all(loc.key(rel)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_err(format!("delete HKCU\\{rel}"), e)),
    }
}

pub(crate) fn set(k: &RegKey, name: &str, value: &str) -> Result<()> {
    k.set_value(name, &value).map_err(|e| io_err(format!("write registry value {name:?}"), e))
}
```

`shell/assoc.rs` — copy every row of `$FileAssocMap` from `scripts/install-null-ide.ps1:458-494` in order (36 rows; `config`, `workspace`, `iss`, `log` carry `icon: Some("document")`):

```rust
pub struct Assoc {
    pub key: &'static str,
    pub description: &'static str,
    pub extensions: &'static [&'static str],
    /// `resources\file-assoc-icons\<icon>.ico`; the key itself when `None`.
    pub icon: Option<&'static str>,
}

macro_rules! a {
    ($k:literal, $d:literal, [$($e:literal),+]) => { Assoc { key: $k, description: $d, extensions: &[$($e),+], icon: None } };
    ($k:literal, $d:literal, [$($e:literal),+], $i:literal) => { Assoc { key: $k, description: $d, extensions: &[$($e),+], icon: Some($i) } };
}

pub const TABLE: &[Assoc] = &[
    a!("js", "JavaScript File", [".js", ".jsx"]),
    a!("ts", "TypeScript File", [".ts", ".tsx"]),
    a!("python", "Python File", [".py"]),
    a!("json", "JSON File", [".json"]),
    a!("markdown", "Markdown File", [".md"]),
    a!("html", "HTML File", [".html", ".htm"]),
    a!("css", "CSS File", [".css"]),
    a!("yaml", "YAML File", [".yml", ".yaml"]),
    a!("text", "Text File", [".txt"]),
    a!("xml", "XML File", [".xml"]),
    a!("c", "C Source File", [".c"]),
    a!("h", "C/C++ Header File", [".h", ".hpp", ".inl"]),
    a!("cplus", "C++ Source File", [".cpp", ".cc", ".cxx", ".c++"]),
    a!("csharp", "C# Source File", [".cs"]),
    a!("go", "Go Source File", [".go"]),
    a!("rust", "Rust Source File", [".rs"]),
    a!("php", "PHP File", [".php"]),
    a!("ruby", "Ruby File", [".rb"]),
    a!("shell", "Shell Script", [".sh", ".bash", ".ps1"]),
    a!("database", "SQL File", [".sql"]),
    a!("git", "Git File", [".gitignore", ".gitattributes", ".gitconfig", ".gitmodules"]),
    a!("patch", "Patch File", [".patch"]),
    a!("cmake", "CMake File", [".cmake"]),
    a!("dart", "Dart File", [".dart"]),
    a!("docker", "Dockerfile", [".dockerfile"]),
    a!("notebook", "Jupyter Notebook", [".ipynb"]),
    a!("csproj", "C# Project File", [".csproj"]),
    a!("hplus", "C/C++ Header File", [".h++"]),
    a!("java", "Java File", [".java", ".jar"]),
    a!("lua", "Lua File", [".lua"]),
    a!("tex", "LaTeX File", [".latex"]),
    a!("config", "Configuration File", [".cfg", ".ini", ".config"], "document"),
    a!("workspace", "VS Code Workspace", [".code-workspace"], "document"),
    a!("iss", "Inno Setup Script", [".iss"], "document"),
    a!("log", "Log File", [".log"], "document"),
];

pub fn all_extensions() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for a in TABLE {
        for e in a.extensions {
            if !out.contains(e) {
                out.push(e);
            }
        }
    }
    out
}

pub fn prog_id(a: &Assoc) -> String { format!("NullIDE.AssocFile.{}", a.key) }
```
(Count the script's rows when copying; the drift test is the judge.)

- [ ] **Step 4: Add the scratch hive to the test support**

Append to `setup/core/tests/support/mod.rs`:

```rust
use std::sync::atomic::{AtomicU32, Ordering};

use null_setup_core::shell::Locations;
use winreg::{enums::*, RegKey, RegValue};

static HIVE_ID: AtomicU32 = AtomicU32::new(0);

/// A scratch copy of the parts of HKCU the registrations write, removed again on drop.
pub struct Hive {
    pub loc: Locations,
    pub tmp: tempfile::TempDir,
    root: String,
}

impl Hive {
    pub fn new() -> Hive {
        let id = format!("{}-{}", std::process::id(), HIVE_ID.fetch_add(1, Ordering::SeqCst));
        let root = format!(r"Software\NullSetupTest\{id}");
        let tmp = tempfile::tempdir().unwrap();
        let (desktop, programs) = (tmp.path().join("Desktop"), tmp.path().join("Programs"));
        std::fs::create_dir_all(&desktop).unwrap();
        std::fs::create_dir_all(&programs).unwrap();
        Hive { loc: Locations { hkcu: format!(r"{root}\"), desktop, programs }, tmp, root }
    }
    fn open(&self, rel: &str) -> Option<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(self.loc.key(rel)).ok()
    }
    pub fn exists(&self, rel: &str) -> bool { self.open(rel).is_some() }
    /// The value as text; "" name is the (default) value. Panics when missing, so a test fails loudly.
    pub fn get(&self, rel: &str, name: &str) -> String {
        self.open(rel).unwrap_or_else(|| panic!("missing key {rel}")).get_value(name).unwrap_or_else(|e| panic!("{rel}[{name}]: {e}"))
    }
    pub fn try_get(&self, rel: &str, name: &str) -> Option<String> { self.open(rel)?.get_value(name).ok() }
    pub fn value_names(&self, rel: &str) -> Vec<String> {
        self.open(rel).map(|k| k.enum_values().filter_map(|v| v.ok()).map(|(n, _)| n).collect()).unwrap_or_default()
    }
    pub fn set_text(&self, rel: &str, name: &str, value: &str) {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(self.loc.key(rel)).unwrap();
        k.set_value(name, &value).unwrap();
    }
    pub fn set_raw(&self, rel: &str, name: &str, vtype: RegType, text: &str) {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(self.loc.key(rel)).unwrap();
        let bytes: Vec<u8> = text.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
        k.set_raw_value(name, &RegValue { bytes: bytes.into(), vtype }).unwrap();
    }
    pub fn raw_type(&self, rel: &str, name: &str) -> RegType { self.open(rel).unwrap().get_raw_value(name).unwrap().vtype }
}

impl Drop for Hive {
    fn drop(&mut self) { let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&self.root); }
}
```
(`winreg` is a regular dependency of `null-setup-core`; integration tests of the same package may use it. Add `mod support;` to each new test file that needs it; the file's `#![allow(dead_code)]` covers unused helpers.)

- [ ] **Step 5: Run, then commit**

Run: `cargo test -p null-setup-core --test shell_assoc` — Expected: PASS (3 tests). Then `cargo test --locked -p null-setup-core -p null-setup` — all green.

```bash
git add setup/Cargo.lock setup/core
git commit -m "feat(setup): shell module scaffolding with the file-association table" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Context-menu registry verbs

**Files:**
- Create: `setup/core/src/shell/classes.rs`
- Modify: `setup/core/src/shell/mod.rs` (`pub mod classes;`)
- Test: `setup/core/tests/shell_classes.rs`

**Interfaces:**
- Consumes: `Locations`, `create`, `set`, `remove_tree` (Task 2).
- Produces:
  ```rust
  pub fn register_context_menu(loc: &Locations, exe: &Path) -> Result<()>;
  pub fn set_context_menu_key(loc: &Locations, install: &Path) -> Result<()>;   // NullIDEContextMenu\{Title,InstallDir}, read by the Win11 DLL
  pub fn unregister_context_menu(loc: &Locations) -> Result<()>;
  ```

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/shell_classes.rs`:

```rust
mod support;

use std::path::Path;

use null_setup_core::shell::classes::*;
use support::Hive;

const EXE: &str = r"C:\Null IDE ünï\null.exe";

#[test]
fn writes_three_verbs_and_the_enable_key() {
    let h = Hive::new();
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    assert_eq!(h.get(r"Software\Classes\*\shell\NullIDE", ""), "Open in Null");
    assert_eq!(h.get(r"Software\Classes\*\shell\NullIDE", "Icon"), format!("{EXE},0"));
    assert_eq!(h.get(r"Software\Classes\*\shell\NullIDE\command", ""), format!("\"{EXE}\" \"%1\""));
    assert_eq!(h.get(r"Software\Classes\Directory\shell\NullIDE", ""), "Open Folder in Null");
    assert_eq!(h.get(r"Software\Classes\Directory\Background\shell\NullIDE\command", ""), format!("\"{EXE}\" \"%V\""));
    assert_eq!(h.get(r"Software\Classes\NullIDEContextMenu", "Title"), "Open with Null");
    assert_eq!(h.get(r"Software\Classes\NullIDEContextMenu", "InstallDir"), r"C:\Null IDE ünï");
}

#[test]
fn registering_twice_changes_nothing_and_unregistering_twice_is_fine() {
    let h = Hive::new();
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    assert_eq!(h.get(r"Software\Classes\Directory\shell\NullIDE\command", ""), format!("\"{EXE}\" \"%1\""));
    unregister_context_menu(&h.loc).unwrap();
    unregister_context_menu(&h.loc).unwrap();
    assert!(!h.exists(r"Software\Classes\*\shell\NullIDE") && !h.exists(r"Software\Classes\NullIDEContextMenu"));
}

#[test]
fn unregistering_leaves_other_apps_verbs_alone() {
    let h = Hive::new();
    h.set_text(r"Software\Classes\Directory\shell\Other", "", "Open in Other");
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    unregister_context_menu(&h.loc).unwrap();
    assert_eq!(h.get(r"Software\Classes\Directory\shell\Other", ""), "Open in Other");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_classes`
Expected: FAIL — unresolved import `shell::classes`.

- [ ] **Step 3: Implement**

`shell/classes.rs`:

```rust
use std::path::Path;

use super::{create, remove_tree, set, Locations};
use crate::error::Result;

const VERB_KEYS: [&str; 3] = [
    r"Software\Classes\*\shell\NullIDE",
    r"Software\Classes\Directory\shell\NullIDE",
    r"Software\Classes\Directory\Background\shell\NullIDE",
];
const CONTEXT_KEY: &str = r"Software\Classes\NullIDEContextMenu";

pub fn register_context_menu(loc: &Locations, exe: &Path) -> Result<()> {
    let exe_s = exe.display().to_string();
    let verbs = [
        (VERB_KEYS[0], "Open in Null", "%1"),
        (VERB_KEYS[1], "Open Folder in Null", "%1"),
        (VERB_KEYS[2], "Open Folder in Null", "%V"),
    ];
    for (key, label, arg) in verbs {
        let k = create(loc, key)?;
        set(&k, "", label)?;
        set(&k, "Icon", &format!("{exe_s},0"))?;
        let cmd = create(loc, &format!(r"{key}\command"))?;
        set(&cmd, "", &format!("\"{exe_s}\" \"{arg}\""))?;
    }
    set_context_menu_key(loc, exe.parent().unwrap_or(exe))
}

/// The Win11 shell-extension DLL reads these two values to decide whether to show itself and what to call itself.
pub fn set_context_menu_key(loc: &Locations, install: &Path) -> Result<()> {
    let k = create(loc, CONTEXT_KEY)?;
    set(&k, "Title", "Open with Null")?;
    set(&k, "InstallDir", &install.display().to_string())
}

pub fn unregister_context_menu(loc: &Locations) -> Result<()> {
    for key in VERB_KEYS.iter().chain(std::iter::once(&CONTEXT_KEY)) {
        remove_tree(loc, key)?;
    }
    Ok(())
}
```

- [ ] **Step 4: Run, then commit**

Run: `cargo test -p null-setup-core --test shell_classes` — Expected: PASS (3 tests).

```bash
git add setup/core
git commit -m "feat(setup): register and remove the HKCU context-menu verbs natively" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: File associations and the preview handler

Introduces the first `System` method (`assoc_changed`) and the fake.

**Files:**
- Modify: `setup/core/src/shell/mod.rs` (`System` trait), `setup/core/src/shell/classes.rs`
- Modify: `setup/core/tests/support/mod.rs` (`FakeSystem`)
- Test: `setup/core/tests/shell_classes.rs` (append)

**Interfaces:**
- Consumes: Task 2 helpers, `assoc::{TABLE, all_extensions, prog_id}`.
- Produces:
  ```rust
  // shell/mod.rs
  pub trait System {
      fn assoc_changed(&self);                // SHChangeNotify(SHCNE_ASSOCCHANGED)
  }
  // shell/classes.rs
  pub const PREVIEW_CLSID: &str = "{58F3B583-5D67-489A-9069-97FD45B2569B}";
  pub fn register_file_associations(loc: &Locations, sys: &dyn System, install: &Path) -> Result<usize>;   // extensions registered
  pub fn unregister_file_associations(loc: &Locations, sys: &dyn System) -> Result<()>;
  pub fn register_preview_handler(loc: &Locations, sys: &dyn System, install: &Path) -> Result<(usize, usize)>; // (claimed, skipped)
  pub fn unregister_preview_handler(loc: &Locations, sys: &dyn System) -> Result<()>;
  // tests/support
  #[derive(Default)] pub struct FakeSystem { pub calls: RefCell<Vec<String>> }   // one string per call, e.g. "assoc_changed"
  ```

- [ ] **Step 1: Write the fake and the failing tests**

`tests/support/mod.rs` (the trait gains methods in later tasks; each task adds the matching fake method):

```rust
use std::cell::RefCell;

use null_setup_core::shell::System;

#[derive(Default)]
pub struct FakeSystem { pub calls: RefCell<Vec<String>> }

impl FakeSystem {
    pub fn count(&self, what: &str) -> usize { self.calls.borrow().iter().filter(|c| c.as_str() == what).count() }
}

impl System for FakeSystem {
    fn assoc_changed(&self) { self.calls.borrow_mut().push("assoc_changed".into()); }
}
```

Append to `tests/shell_classes.rs` (add `use support::FakeSystem; use null_setup_core::shell::assoc::all_extensions;`):

```rust
const INSTALL: &str = r"C:\Null IDE ünï";

#[test]
fn file_associations_write_progids_openwith_and_capabilities() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let n = register_file_associations(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    assert_eq!(n, all_extensions().len());
    let p = r"Software\Classes\NullIDE.AssocFile.ts";
    assert_eq!(h.get(p, ""), "TypeScript File");
    assert_eq!(h.get(p, "FriendlyTypeName"), "TypeScript File");
    assert_eq!(h.get(&format!(r"{p}\DefaultIcon"), ""), format!(r"{INSTALL}\resources\file-assoc-icons\ts.ico,0"));
    assert_eq!(h.get(&format!(r"{p}\shell\open\command"), ""), format!("\"{INSTALL}\\null.exe\" \"%1\""));
    // keys marked Icon = 'document' use that icon
    assert!(h.get(r"Software\Classes\NullIDE.AssocFile.log\DefaultIcon", "").ends_with(r"document.ico,0"));
    assert!(h.value_names(r"Software\Classes\.tsx\OpenWithProgids").contains(&"NullIDE.AssocFile.ts".to_string()));
    assert_eq!(h.get(r"Software\Classes\Applications\null.exe", "FriendlyAppName"), "Null IDE");
    assert_eq!(h.get(r"Software\Classes\NullIDE\Capabilities", "ApplicationName"), "Null IDE");
    assert_eq!(h.get(r"Software\Classes\NullIDE\Capabilities\FileAssociations", ".tsx"), "NullIDE.AssocFile.ts");
    assert_eq!(h.get(r"Software\RegisteredApplications", "Null IDE"), r"Software\Classes\NullIDE\Capabilities");
    assert_eq!(sys.count("assoc_changed"), 1);
}

#[test]
fn unregistering_file_associations_removes_only_ours() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_text(r"Software\Classes\.js\OpenWithProgids", "Other.App", "");
    h.set_text(r"Software\RegisteredApplications", "Other", r"Software\Other\Capabilities");
    register_file_associations(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    unregister_file_associations(&h.loc, &sys).unwrap();
    unregister_file_associations(&h.loc, &sys).unwrap(); // nothing left: still fine
    assert!(!h.exists(r"Software\Classes\NullIDE.AssocFile.js") && !h.exists(r"Software\Classes\NullIDE"));
    assert!(!h.exists(r"Software\Classes\Applications\null.exe"));
    assert_eq!(h.value_names(r"Software\Classes\.js\OpenWithProgids"), ["Other.App"]);
    assert_eq!(h.value_names(r"Software\RegisteredApplications"), ["Other"]);
}

#[test]
fn preview_handler_claims_free_extensions_and_skips_owned_ones() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let other = r"Software\Classes\.json\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}";
    h.set_text(other, "", "{11111111-2222-3333-4444-555555555555}");
    let (claimed, skipped) = register_preview_handler(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    assert_eq!((claimed, skipped), (all_extensions().len() - 1, 1));
    assert_eq!(h.get(other, ""), "{11111111-2222-3333-4444-555555555555}");
    assert_eq!(h.get(r"Software\Classes\.md\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}", ""), PREVIEW_CLSID);
    assert_eq!(
        h.get(&format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}\InprocServer32"), ""),
        format!(r"{INSTALL}\shell-ext\NullIDE.ExplorerCommand\x64\null_explorer_command.dll")
    );
    assert_eq!(h.get(&format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}\InprocServer32"), "ThreadingModel"), "Apartment");
    assert_eq!(h.get(r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers", PREVIEW_CLSID), "Null IDE Preview Handler");
}

#[test]
fn preview_handler_removal_touches_only_our_claims() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let guid = r"{8895b1c6-b41f-4c1c-a562-0d564250836f}";
    h.set_text(&format!(r"Software\Classes\.json\shellex\{guid}"), "", "{11111111-2222-3333-4444-555555555555}");
    register_preview_handler(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    unregister_preview_handler(&h.loc, &sys).unwrap();
    unregister_preview_handler(&h.loc, &sys).unwrap();
    assert!(!h.exists(&format!(r"Software\Classes\.md\shellex\{guid}")));
    assert_eq!(h.get(&format!(r"Software\Classes\.json\shellex\{guid}"), ""), "{11111111-2222-3333-4444-555555555555}");
    assert!(!h.exists(&format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}")));
    assert!(h.try_get(r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers", PREVIEW_CLSID).is_none());
}
```
Add `use null_setup_core::shell::classes::PREVIEW_CLSID;` via the glob import (the const is `pub`).

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_classes`
Expected: FAIL — `System` / `register_file_associations` not found.

- [ ] **Step 3: Implement**

`shell/mod.rs`:

```rust
/// Everything with a side effect outside the registry and the file system, so decisions can be tested with a fake.
pub trait System {
    fn assoc_changed(&self);
}
```

`shell/classes.rs` additions (the `PREVIEW_SHELLEX` GUID is the IPreviewHandler shell-extension id, `{8895b1c6-b41f-4c1c-a562-0d564250836f}`):

```rust
use super::{assoc, open, open_write, System};

pub const PREVIEW_CLSID: &str = "{58F3B583-5D67-489A-9069-97FD45B2569B}";
const PREVIEW_SHELLEX: &str = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";
const PREVIEW_APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers";
const REGISTERED_APPS: &str = r"Software\RegisteredApplications";

pub fn register_file_associations(loc: &Locations, sys: &dyn System, install: &Path) -> Result<usize> {
    let exe = install.join("null.exe").display().to_string();
    let icons = install.join("resources").join("file-assoc-icons");
    let open_cmd = format!("\"{exe}\" \"%1\"");
    for a in assoc::TABLE {
        let id = assoc::prog_id(a);
        let prog = format!(r"Software\Classes\{id}");
        let k = create(loc, &prog)?;
        set(&k, "", a.description)?;
        set(&k, "FriendlyTypeName", a.description)?;
        let icon = icons.join(format!("{}.ico", a.icon.unwrap_or(a.key)));
        set(&create(loc, &format!(r"{prog}\DefaultIcon"))?, "", &format!("{},0", icon.display()))?;
        set(&create(loc, &format!(r"{prog}\shell\open\command"))?, "", &open_cmd)?;
        for ext in a.extensions {
            set(&create(loc, &format!(r"Software\Classes\{ext}\OpenWithProgids"))?, &id, "")?;
        }
    }
    let all = assoc::all_extensions();
    let app = create(loc, r"Software\Classes\Applications\null.exe")?;
    set(&app, "FriendlyAppName", "Null IDE")?;
    app.set_value("SupportedTypes", &all.iter().map(|s| s.to_string()).collect::<Vec<String>>())
        .map_err(|e| crate::error::Error::Io { context: "write SupportedTypes".into(), source: e })?;
    set(&create(loc, r"Software\Classes\Applications\null.exe\shell\open\command")?, "", &open_cmd)?;

    let cap = create(loc, r"Software\Classes\NullIDE\Capabilities")?;
    set(&cap, "ApplicationName", "Null IDE")?;
    set(&cap, "ApplicationDescription", "A custom Windows code editor built on VSCodium.")?;
    let fa = create(loc, r"Software\Classes\NullIDE\Capabilities\FileAssociations")?;
    for a in assoc::TABLE {
        for ext in a.extensions {
            set(&fa, ext, &assoc::prog_id(a))?;
        }
    }
    set(&create(loc, REGISTERED_APPS)?, "Null IDE", r"Software\Classes\NullIDE\Capabilities")?;
    sys.assoc_changed();
    Ok(all.len())
}

pub fn unregister_file_associations(loc: &Locations, sys: &dyn System) -> Result<()> {
    for a in assoc::TABLE {
        let id = assoc::prog_id(a);
        remove_tree(loc, &format!(r"Software\Classes\{id}"))?;
        for ext in a.extensions {
            if let Some(k) = open_write(loc, &format!(r"Software\Classes\{ext}\OpenWithProgids")) {
                let _ = k.delete_value(&id); // missing value: nothing to do
            }
        }
    }
    remove_tree(loc, r"Software\Classes\Applications\null.exe")?;
    remove_tree(loc, r"Software\Classes\NullIDE")?;
    if let Some(k) = open_write(loc, REGISTERED_APPS) {
        let _ = k.delete_value("Null IDE");
    }
    sys.assoc_changed();
    Ok(())
}

pub fn register_preview_handler(loc: &Locations, sys: &dyn System, install: &Path) -> Result<(usize, usize)> {
    let dll = install.join("shell-ext").join("NullIDE.ExplorerCommand").join("x64").join("null_explorer_command.dll");
    let clsid = format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}");
    set(&create(loc, &clsid)?, "", "Null IDE Preview Handler")?;
    let inproc = create(loc, &format!(r"{clsid}\InprocServer32"))?;
    set(&inproc, "", &dll.display().to_string())?;
    set(&inproc, "ThreadingModel", "Apartment")?;
    set(&create(loc, PREVIEW_APPROVED)?, PREVIEW_CLSID, "Null IDE Preview Handler")?;

    let (mut claimed, mut skipped) = (0, 0);
    for ext in assoc::all_extensions() {
        let key = format!(r"Software\Classes\{ext}\shellex\{PREVIEW_SHELLEX}");
        // Another app (PowerToys' preview handlers, for instance) already owns this extension: do not take it over.
        let owner: Option<String> = open(loc, &key).and_then(|k| k.get_value("").ok());
        if owner.as_deref().is_some_and(|o| !o.is_empty() && !o.eq_ignore_ascii_case(PREVIEW_CLSID)) {
            skipped += 1;
            continue;
        }
        set(&create(loc, &key)?, "", PREVIEW_CLSID)?;
        claimed += 1;
    }
    sys.assoc_changed();
    Ok((claimed, skipped))
}

pub fn unregister_preview_handler(loc: &Locations, sys: &dyn System) -> Result<()> {
    for ext in assoc::all_extensions() {
        let key = format!(r"Software\Classes\{ext}\shellex\{PREVIEW_SHELLEX}");
        let owner: Option<String> = open(loc, &key).and_then(|k| k.get_value("").ok());
        if owner.is_some_and(|o| o.eq_ignore_ascii_case(PREVIEW_CLSID)) {
            remove_tree(loc, &key)?;
        }
    }
    remove_tree(loc, &format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}"))?;
    if let Some(k) = open_write(loc, PREVIEW_APPROVED) {
        let _ = k.delete_value(PREVIEW_CLSID);
    }
    sys.assoc_changed();
    Ok(())
}
```

- [ ] **Step 4: Run, then commit**

Run: `cargo test -p null-setup-core --test shell_classes` — Expected: PASS (7 tests).

```bash
git add setup/core
git commit -m "feat(setup): register file associations and the preview handler natively" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The user PATH

**Files:**
- Create: `setup/core/src/shell/path.rs`
- Modify: `setup/core/src/shell/mod.rs` (`pub mod path;`, `env_changed` on `System`), `setup/core/tests/support/mod.rs` (fake `env_changed`)
- Test: `setup/core/tests/shell_path.rs`

**Interfaces:**
- Consumes: `Locations`, `create`, `System`.
- Produces:
  ```rust
  pub fn with_dir(value: &str, dir: &str) -> Option<String>;       // None: already present
  pub fn without_dir(value: &str, dir: &str) -> Option<String>;    // None: not present
  pub fn add(loc: &Locations, sys: &dyn System, dir: &Path) -> Result<()>;
  pub fn remove(loc: &Locations, sys: &dyn System, dir: &Path) -> Result<()>;
  // System gains: fn env_changed(&self);   // broadcast WM_SETTINGCHANGE "Environment"
  ```

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/shell_path.rs`:

```rust
mod support;

use std::path::Path;

use null_setup_core::shell::path::*;
use support::{FakeSystem, Hive};
use winreg::enums::{REG_EXPAND_SZ, REG_SZ};

#[test]
fn with_dir_appends_once_ignoring_case_and_trailing_backslash() {
    assert_eq!(with_dir(r"C:\a;C:\b", r"C:\x").as_deref(), Some(r"C:\a;C:\b;C:\x"));
    assert_eq!(with_dir(r"C:\a;c:\X\", r"C:\x"), None);
    assert_eq!(with_dir("", r"C:\x").as_deref(), Some(r"C:\x"));
    assert_eq!(with_dir(r"C:\a;;C:\b;", r"C:\x").as_deref(), Some(r"C:\a;C:\b;C:\x")); // empty segments dropped, as before
}

#[test]
fn without_dir_removes_every_match_and_keeps_the_rest_verbatim() {
    assert_eq!(without_dir(r"%USERPROFILE%\bin;C:\x;C:\y", r"C:\x").as_deref(), Some(r"%USERPROFILE%\bin;C:\y"));
    assert_eq!(without_dir(r"C:\a;C:\b", r"C:\x"), None);
}

#[test]
fn add_keeps_the_value_type_and_percent_entries() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_raw("Environment", "Path", REG_EXPAND_SZ, r"%USERPROFILE%\bin;C:\Tools");
    add(&h.loc, &sys, Path::new(r"C:\Null IDE ünï\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), r"%USERPROFILE%\bin;C:\Tools;C:\Null IDE ünï\bin");
    assert_eq!(h.raw_type("Environment", "Path"), REG_EXPAND_SZ);
    assert_eq!(sys.count("env_changed"), 1);
    add(&h.loc, &sys, Path::new(r"C:\Null IDE ünï\bin")).unwrap(); // already there: no write, no broadcast
    assert_eq!(sys.count("env_changed"), 1);
}

#[test]
fn add_creates_the_value_when_the_user_has_no_path_and_keeps_reg_sz() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    add(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), r"C:\n\bin");
    let h2 = Hive::new();
    h2.set_raw("Environment", "Path", REG_SZ, r"C:\a");
    add(&h2.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h2.raw_type("Environment", "Path"), REG_SZ);
}

#[test]
fn a_very_long_path_survives_untouched() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let long = (0..120).map(|i| format!(r"C:\some\long\folder\number\{i}")).collect::<Vec<_>>().join(";");
    assert!(long.len() > 3000);
    h.set_raw("Environment", "Path", REG_EXPAND_SZ, &long);
    add(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), format!(r"{long};C:\n\bin"));
}

#[test]
fn remove_drops_the_entry_and_does_nothing_when_it_is_absent() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_raw("Environment", "Path", REG_EXPAND_SZ, r"C:\a;C:\n\bin;C:\b");
    remove(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), r"C:\a;C:\b");
    remove(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(sys.count("env_changed"), 1);
    remove(&Hive::new().loc, &sys, Path::new(r"C:\n\bin")).unwrap(); // no Path value at all
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_path`
Expected: FAIL — unresolved import `shell::path`.

- [ ] **Step 3: Implement**

`System` gains `fn env_changed(&self);` and `FakeSystem` gains `fn env_changed(&self) { self.calls.borrow_mut().push("env_changed".into()); }`.

`shell/path.rs`:

```rust
use std::{borrow::Cow, io, path::Path};

use winreg::{enums::*, RegValue};

use super::{create, open, Locations, System};
use crate::error::{Error, Result};

const KEY: &str = "Environment";

fn same(a: &str, b: &str) -> bool { a.trim_end_matches('\\').eq_ignore_ascii_case(b.trim_end_matches('\\')) }

fn parts(value: &str) -> Vec<&str> { value.split(';').filter(|p| !p.is_empty()).collect() }

pub fn with_dir(value: &str, dir: &str) -> Option<String> {
    let p = parts(value);
    if p.iter().any(|e| same(e, dir)) {
        return None;
    }
    let mut out: Vec<&str> = p;
    out.push(dir);
    Some(out.join(";"))
}

pub fn without_dir(value: &str, dir: &str) -> Option<String> {
    let p = parts(value);
    if !p.iter().any(|e| same(e, dir)) {
        return None;
    }
    Some(p.into_iter().filter(|e| !same(e, dir)).collect::<Vec<_>>().join(";"))
}

fn read(loc: &Locations) -> Result<Option<(String, RegType)>> {
    let Some(k) = open(loc, KEY) else { return Ok(None) };
    match k.get_raw_value("Path") {
        Ok(v) if matches!(v.vtype, REG_SZ | REG_EXPAND_SZ) => {
            let units: Vec<u16> = v.bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let text = String::from_utf16_lossy(&units);
            Ok(Some((text.trim_end_matches('\0').to_string(), v.vtype)))
        }
        Ok(_) => Err(Error::Other("the user PATH is not a text value; leaving it alone".into())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Io { context: "read the user PATH".into(), source: e }),
    }
}

fn write(loc: &Locations, text: &str, vtype: RegType) -> Result<()> {
    let bytes: Vec<u8> = text.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
    create(loc, KEY)?
        .set_raw_value("Path", &RegValue { bytes: Cow::Owned(bytes), vtype })
        .map_err(|e| Error::Io { context: "write the user PATH".into(), source: e })
}

pub fn add(loc: &Locations, sys: &dyn System, dir: &Path) -> Result<()> {
    let dir = dir.display().to_string();
    // A new value is REG_EXPAND_SZ like Windows' own default, so %VAR% entries added later keep working.
    let (current, vtype) = read(loc)?.unwrap_or((String::new(), REG_EXPAND_SZ));
    if let Some(new) = with_dir(&current, &dir) {
        write(loc, &new, vtype)?;
        sys.env_changed();
    }
    Ok(())
}

pub fn remove(loc: &Locations, sys: &dyn System, dir: &Path) -> Result<()> {
    let Some((current, vtype)) = read(loc)? else { return Ok(()) };
    if let Some(new) = without_dir(&current, &dir.display().to_string()) {
        write(loc, &new, vtype)?;
        sys.env_changed();
    }
    Ok(())
}
```

- [ ] **Step 4: Run, then commit**

Run: `cargo test -p null-setup-core --test shell_path` — Expected: PASS (6 tests). `cargo test -p null-setup-core --test shell_classes` still PASS (the fake grew a method).

```bash
git add setup/core
git commit -m "feat(setup): add and remove the user PATH entry without flattening the value type" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shortcuts and the real `.lnk` writer

First method with a real `WinSystem`, so this task also creates `sys.rs`.

**Files:**
- Create: `setup/core/src/shell/shortcuts.rs`, `setup/core/src/shell/sys.rs`
- Modify: `setup/core/src/shell/mod.rs` (`pub mod shortcuts; pub mod sys;`, `Locations::real`, `create_shortcut` on `System`), `setup/core/tests/support/mod.rs`
- Test: `setup/core/tests/shell_shortcuts.rs`

**Interfaces:**
- Consumes: `Locations`, `System`.
- Produces:
  ```rust
  // shortcuts.rs
  pub struct ShortcutSpec { pub path: PathBuf, pub target: PathBuf, pub working_dir: PathBuf, pub args: String }
  pub fn desktop(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec;
  pub fn start_menu(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec;
  pub fn safe_mode(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec;
  pub fn create(sys: &dyn System, spec: &ShortcutSpec) -> Result<()>;      // creates the parent folder first
  pub fn remove(path: &Path) -> Result<()>;                                // missing file = Ok
  pub fn remove_empty_start_menu(loc: &Locations);                         // deletes <Programs>\Null IDE when it holds nothing
  // sys.rs
  pub struct WinSystem;
  pub fn known_folder(id: KnownFolder) -> Result<PathBuf>;                 // enum KnownFolder { Desktop, Programs }
  pub fn read_shortcut(path: &Path) -> Result<(PathBuf, String, PathBuf)>; // target, arguments, working dir — for tests
  // System gains: fn create_shortcut(&self, s: &ShortcutSpec) -> Result<()>;
  // Locations::real() -> Result<Locations>
  ```

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/shell_shortcuts.rs`:

```rust
mod support;

use std::{fs, path::Path};

use null_setup_core::shell::{shortcuts::*, sys::{read_shortcut, WinSystem}};
use support::{FakeSystem, Hive};

const INSTALL: &str = r"C:\Null IDE ünï";

#[test]
fn the_three_shortcuts_land_where_the_script_put_them() {
    let h = Hive::new();
    let exe = Path::new(r"C:\Null IDE ünï\null.exe");
    let install = Path::new(INSTALL);
    let d = desktop(&h.loc, exe, install);
    assert_eq!(d.path, h.loc.desktop.join("Null IDE.lnk"));
    let s = start_menu(&h.loc, exe, install);
    assert_eq!(s.path, h.loc.programs.join("Null IDE").join("Null IDE.lnk"));
    assert_eq!(s.args, "");
    let m = safe_mode(&h.loc, exe, install);
    assert_eq!(m.path, h.loc.programs.join("Null IDE").join("Null IDE (Safe Mode).lnk"));
    assert_eq!((m.args.as_str(), m.target.as_path(), m.working_dir.as_path()), ("--safe-mode", exe, install));
}

#[test]
fn create_makes_the_folder_first_and_hands_the_spec_to_the_system() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let spec = start_menu(&h.loc, Path::new(r"C:\x\null.exe"), Path::new(r"C:\x"));
    create(&sys, &spec).unwrap();
    assert!(spec.path.parent().unwrap().is_dir());
    assert_eq!(sys.count("shortcut:Null IDE.lnk"), 1);
}

#[test]
fn removing_the_last_shortcut_removes_the_start_menu_folder() {
    let h = Hive::new();
    let dir = h.loc.programs.join("Null IDE");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Null IDE.lnk"), "x").unwrap();
    fs::write(dir.join("Null IDE (Safe Mode).lnk"), "x").unwrap();
    remove(&dir.join("Null IDE.lnk")).unwrap();
    remove_empty_start_menu(&h.loc);
    assert!(dir.is_dir()); // the Safe Mode shortcut is still in it
    remove(&dir.join("Null IDE (Safe Mode).lnk")).unwrap();
    remove(&dir.join("Null IDE (Safe Mode).lnk")).unwrap(); // already gone
    remove_empty_start_menu(&h.loc);
    assert!(!dir.exists());
    remove_empty_start_menu(&h.loc); // nothing to do
}

#[test]
fn a_real_lnk_round_trips_target_arguments_and_working_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE ünï");
    fs::create_dir_all(&install).unwrap();
    let exe = install.join("null.exe");
    fs::write(&exe, "MZ").unwrap();
    let lnk = tmp.path().join("out").join("Null IDE (Safe Mode).lnk");
    let spec = ShortcutSpec { path: lnk.clone(), target: exe.clone(), working_dir: install.clone(), args: "--safe-mode".into() };
    create(&WinSystem, &spec).unwrap();
    let (target, args, wd) = read_shortcut(&lnk).unwrap();
    assert_eq!((target, args.as_str(), wd), (exe, "--safe-mode", install));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_shortcuts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement**

`System` gains `fn create_shortcut(&self, s: &shortcuts::ShortcutSpec) -> Result<()>;`. `FakeSystem` gains:

```rust
fn create_shortcut(&self, s: &ShortcutSpec) -> null_setup_core::Result<()> {
    self.calls.borrow_mut().push(format!("shortcut:{}", s.path.file_name().unwrap().to_string_lossy()));
    Ok(())
}
```
(import `null_setup_core::shell::shortcuts::ShortcutSpec` in support).

`shell/shortcuts.rs`:

```rust
use std::{fs, io, path::{Path, PathBuf}};

use super::{Locations, System};
use crate::error::{Error, Result};

pub struct ShortcutSpec { pub path: PathBuf, pub target: PathBuf, pub working_dir: PathBuf, pub args: String }

fn spec(path: PathBuf, exe: &Path, install: &Path, args: &str) -> ShortcutSpec {
    ShortcutSpec { path, target: exe.to_path_buf(), working_dir: install.to_path_buf(), args: args.into() }
}

pub fn desktop(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec {
    spec(loc.desktop.join("Null IDE.lnk"), exe, install, "")
}
pub fn start_menu(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec {
    spec(loc.programs.join("Null IDE").join("Null IDE.lnk"), exe, install, "")
}
pub fn safe_mode(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec {
    spec(loc.programs.join("Null IDE").join("Null IDE (Safe Mode).lnk"), exe, install, "--safe-mode")
}

pub fn create(sys: &dyn System, s: &ShortcutSpec) -> Result<()> {
    if let Some(parent) = s.path.parent() {
        fs::create_dir_all(parent).map_err(|e| Error::Io { context: format!("create {}", parent.display()), source: e })?;
    }
    sys.create_shortcut(s)
}

pub fn remove(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::Io { context: format!("remove {}", path.display()), source: e }),
    }
}

/// The folder goes away with its last shortcut. `remove_dir` refuses a non-empty folder, which is the check.
pub fn remove_empty_start_menu(loc: &Locations) {
    let _ = fs::remove_dir(loc.programs.join("Null IDE"));
}
```
Add `pub mod shortcuts; pub mod sys;` to `shell/mod.rs`, plus:

```rust
impl Locations {
    pub fn real() -> Result<Locations> {
        Ok(Locations {
            hkcu: String::new(),
            desktop: sys::known_folder(sys::KnownFolder::Desktop)?,
            programs: sys::known_folder(sys::KnownFolder::Programs)?,
        })
    }
}
```
Known folders honor OneDrive-redirected Desktops, which a hand-built `%USERPROFILE%\Desktop` would miss; that is why they are looked up.

`shell/sys.rs` (look the exact signatures up if they differ in `windows` 0.62; keep behavior):

```rust
use std::{ffi::OsString, os::windows::ffi::{OsStrExt, OsStringExt}, path::{Path, PathBuf}};

use windows::{
    core::{Interface, HSTRING, PCWSTR},
    Win32::{
        Foundation::MAX_PATH,
        System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ},
        UI::Shell::{FOLDERID_Desktop, FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT},
    },
};

use super::{shortcuts::ShortcutSpec, System};
use crate::error::{Error, Result};

pub enum KnownFolder { Desktop, Programs }

pub fn known_folder(id: KnownFolder) -> Result<PathBuf> {
    let guid = match id { KnownFolder::Desktop => FOLDERID_Desktop, KnownFolder::Programs => FOLDERID_Programs };
    unsafe {
        let p = SHGetKnownFolderPath(&guid, KF_FLAG_DEFAULT, None).map_err(|e| Error::Other(format!("known folder: {e}")))?;
        Ok(PathBuf::from(OsString::from_wide(p.as_wide())))
    }
}

/// COM must be initialised on the calling thread; the guard balances it.
struct Com;
impl Com {
    fn init() -> Com {
        unsafe { let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED); }
        Com
    }
}
impl Drop for Com {
    fn drop(&mut self) { unsafe { CoUninitialize() } }
}

fn com(e: windows::core::Error) -> Error { Error::Other(format!("shortcut: {e}")) }

pub struct WinSystem;

impl System for WinSystem {
    fn assoc_changed(&self) {
        use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) }
    }

    fn env_changed(&self) {
        use windows::Win32::{
            Foundation::{LPARAM, WPARAM},
            UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE},
        };
        let env: Vec<u16> = "Environment".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            // Unanswered windows must not stall setup, hence the 5 s cap per window.
            let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(env.as_ptr() as isize), SMTO_ABORTIFHUNG, 5000, None);
        }
    }

    fn create_shortcut(&self, s: &ShortcutSpec) -> Result<()> {
        let _com = Com::init();
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(com)?;
            link.SetPath(&HSTRING::from(s.target.as_os_str())).map_err(com)?;
            link.SetWorkingDirectory(&HSTRING::from(s.working_dir.as_os_str())).map_err(com)?;
            if !s.args.is_empty() {
                link.SetArguments(&HSTRING::from(s.args.as_str())).map_err(com)?;
            }
            link.SetIconLocation(&HSTRING::from(s.target.as_os_str()), 0).map_err(com)?;
            let file: IPersistFile = link.cast().map_err(com)?;
            file.Save(&HSTRING::from(s.path.as_os_str()), true).map_err(com)
        }
    }
}

/// (target, arguments, working directory) of an existing `.lnk`. Used by the tests to prove the writer above.
pub fn read_shortcut(path: &Path) -> Result<(PathBuf, String, PathBuf)> {
    let _com = Com::init();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(com)?;
        let file: IPersistFile = link.cast().map_err(com)?;
        file.Load(&HSTRING::from(path.as_os_str()), STGM_READ).map_err(com)?;
        let mut buf = [0u16; MAX_PATH as usize * 2];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).map_err(com)?;
        let target = PathBuf::from(OsString::from_wide(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]));
        let mut args = [0u16; 1024];
        link.GetArguments(&mut args).map_err(com)?;
        let args = String::from_utf16_lossy(&args[..args.iter().position(|&c| c == 0).unwrap_or(args.len())]);
        let mut wd = [0u16; MAX_PATH as usize * 2];
        link.GetWorkingDirectory(&mut wd).map_err(com)?;
        let wd = PathBuf::from(OsString::from_wide(&wd[..wd.iter().position(|&c| c == 0).unwrap_or(wd.len())]));
        Ok((target, args, wd))
    }
}
```
(The `System` trait impl must define every method the trait has *at this point*: `assoc_changed`, `env_changed`, `create_shortcut`. The `PCWSTR`/`OsStrExt` imports are only needed if the compiler asks; remove unused ones.)

- [ ] **Step 4: Run, then commit**

Run: `cargo test -p null-setup-core --test shell_shortcuts` — Expected: PASS (4 tests). `cargo test -p null-setup-core --test shell_classes --test shell_path` still PASS.

```bash
git add setup/core
git commit -m "feat(setup): write and remove shortcuts natively with IShellLink" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Win11 sparse-APPX flow, decided over a fake `System`

All the branching of `Register-Win11ContextMenu` (which has caused every updater surprise so far) is tested here against a fake; Task 8 supplies the real side effects.

**Files:**
- Create: `setup/core/src/shell/win11.rs`
- Modify: `setup/core/src/shell/mod.rs` (`pub mod win11;`, trait methods, `AppxAdd`), `setup/core/tests/support/mod.rs`
- Test: `setup/core/tests/shell_win11.rs`

**Interfaces:**
- Consumes: `classes::set_context_menu_key`, `Locations`, `System`.
- Produces:
  ```rust
  // shell/mod.rs
  pub enum AppxAdd { Added, UntrustedRoot, Failed(String) }       // Clone, Debug, PartialEq
  pub trait System {   // gains:
      fn restart_explorer(&self);
      fn appx_installed(&self) -> Result<Option<String>>;                    // PackageFullName of NullIDE.ExplorerCommand
      fn appx_remove(&self, full_name: &str) -> Result<()>;
      fn appx_add(&self, appx: &Path, external: &Path) -> AppxAdd;
      fn cert_thumbprint(&self, cer: &Path) -> Result<String>;               // uppercase hex SHA-1
      fn cert_trusted_machine(&self, thumbprint: &str) -> bool;              // in LocalMachine\TrustedPeople
      fn cert_add_current_user(&self, cer: &Path) -> Result<()>;             // CurrentUser\TrustedPeople
      fn cert_add_machine_elevated(&self, install: &Path) -> Result<()>;     // UAC; Err when declined or failed
  }
  // shell/win11.rs
  #[derive(Debug, PartialEq)] pub enum Win11 { Registered, Kept, NeedsReapproval, Missing(String) }
  pub fn register(loc: &Locations, sys: &dyn System, install: &Path, allow_elevate: bool) -> Result<Win11>;
  pub fn unregister(sys: &dyn System) -> Result<()>;
  ```

- [ ] **Step 1: Extend the fake and write the failing tests**

`FakeSystem` becomes scriptable (add fields; keep `calls`):

```rust
use std::cell::{Cell, RefCell};

use null_setup_core::shell::AppxAdd;

#[derive(Default)]
pub struct FakeSystem {
    pub calls: RefCell<Vec<String>>,
    /// PackageFullName of the registered package, if any.
    pub package: RefCell<Option<String>>,
    /// Results of successive `appx_add` calls; the last one repeats. Empty = Added.
    pub adds: RefCell<Vec<AppxAdd>>,
    pub machine_trusted: Cell<bool>,
    pub elevated: RefCell<Option<Result<(), String>>>,   // None = Ok
}
```
and the new methods:

```rust
fn restart_explorer(&self) { self.calls.borrow_mut().push("restart_explorer".into()); }
fn appx_installed(&self) -> null_setup_core::Result<Option<String>> { Ok(self.package.borrow().clone()) }
fn appx_remove(&self, f: &str) -> null_setup_core::Result<()> {
    self.calls.borrow_mut().push(format!("appx_remove:{f}"));
    *self.package.borrow_mut() = None;
    Ok(())
}
fn appx_add(&self, _: &Path, _: &Path) -> AppxAdd {
    self.calls.borrow_mut().push("appx_add".into());
    let mut q = self.adds.borrow_mut();
    let r = if q.len() > 1 { q.remove(0) } else { q.first().cloned().unwrap_or(AppxAdd::Added) };
    if r == AppxAdd::Added { *self.package.borrow_mut() = Some("NullIDE.ExplorerCommand_1_x64".into()); }
    r
}
fn cert_thumbprint(&self, _: &Path) -> null_setup_core::Result<String> { Ok("AB12".into()) }
fn cert_trusted_machine(&self, _: &str) -> bool { self.machine_trusted.get() }
fn cert_add_current_user(&self, _: &Path) -> null_setup_core::Result<()> { self.calls.borrow_mut().push("cert_user".into()); Ok(()) }
fn cert_add_machine_elevated(&self, _: &Path) -> null_setup_core::Result<()> {
    self.calls.borrow_mut().push("cert_machine".into());
    match self.elevated.borrow().clone() {
        None | Some(Ok(())) => Ok(()),
        Some(Err(m)) => Err(null_setup_core::Error::Other(m)),
    }
}
```
(Add `use std::path::Path;` in support.)

`setup/core/tests/shell_win11.rs`:

```rust
mod support;

use std::fs;

use null_setup_core::shell::{win11::*, AppxAdd};
use support::{FakeSystem, Hive};

fn install(h: &Hive, with_appx: bool) -> std::path::PathBuf {
    let dir = h.tmp.path().join("Null IDE ünï");
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    if with_appx {
        fs::write(dir.join("shell-ext").join("null-shell-ext.appx"), "x").unwrap();
        fs::write(dir.join("shell-ext").join("NullIDECert.cer"), "x").unwrap();
    }
    dir
}

#[test]
fn a_missing_package_is_reported_and_nothing_is_touched() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let r = register(&h.loc, &sys, &install(&h, false), true).unwrap();
    assert!(matches!(r, Win11::Missing(m) if m.contains("null-shell-ext.appx")));
    assert!(sys.calls.borrow().is_empty());
}

#[test]
fn an_update_with_an_untrusted_certificate_keeps_the_existing_package_untouched() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.package.borrow_mut() = Some("NullIDE.ExplorerCommand_1_x64".into());
    let r = register(&h.loc, &sys, &install(&h, true), false).unwrap();
    assert_eq!(r, Win11::Kept);
    assert!(sys.calls.borrow().is_empty(), "{:?}", sys.calls.borrow());
    assert_eq!(sys.package.borrow().as_deref(), Some("NullIDE.ExplorerCommand_1_x64"));
}

#[test]
fn an_update_with_an_untrusted_certificate_and_no_package_asks_for_reapproval() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Win11::NeedsReapproval);
    assert!(sys.calls.borrow().is_empty());
}

#[test]
fn a_trusted_certificate_replaces_the_package_without_elevating() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    sys.machine_trusted.set(true);
    *sys.package.borrow_mut() = Some("OLD".into());
    let dir = install(&h, true);
    assert_eq!(register(&h.loc, &sys, &dir, false).unwrap(), Win11::Registered);
    assert_eq!(*sys.calls.borrow(), ["cert_user", "restart_explorer", "appx_remove:OLD", "appx_add", "restart_explorer"]);
    assert_eq!(h.get(r"Software\Classes\NullIDEContextMenu", "InstallDir"), dir.display().to_string());
}

#[test]
fn a_fresh_install_imports_the_certificate_after_the_first_add_is_refused() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.adds.borrow_mut() = vec![AppxAdd::UntrustedRoot, AppxAdd::Added];
    assert_eq!(register(&h.loc, &sys, &install(&h, true), true).unwrap(), Win11::Registered);
    assert_eq!(*sys.calls.borrow(), ["cert_user", "appx_add", "cert_machine", "appx_add", "restart_explorer"]);
}

#[test]
fn a_declined_uac_prompt_is_an_error_and_leaves_no_half_state_behind() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.adds.borrow_mut() = vec![AppxAdd::UntrustedRoot];
    *sys.elevated.borrow_mut() = Some(Err("Could not install the shell extension certificate (exit 1223)".into()));
    let e = register(&h.loc, &sys, &install(&h, true), true).unwrap_err().to_string();
    assert!(e.contains("certificate"), "{e}");
    assert_eq!(sys.count("appx_add"), 1); // not retried after the refusal
}

#[test]
fn the_cmdlet_message_survives_when_adding_fails_for_another_reason() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.adds.borrow_mut() = vec![AppxAdd::Failed("0x80073CF9 deployment failed".into())];
    let e = register(&h.loc, &sys, &install(&h, true), true).unwrap_err().to_string();
    assert!(e.contains("Win11 context menu registration failed") && e.contains("0x80073CF9"), "{e}");
}

#[test]
fn an_update_whose_add_hits_an_untrusted_root_asks_for_reapproval_instead_of_elevating() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    sys.machine_trusted.set(true); // looked trusted, Windows disagreed
    *sys.adds.borrow_mut() = vec![AppxAdd::UntrustedRoot];
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Win11::NeedsReapproval);
    assert_eq!(sys.count("cert_machine"), 0);
}

#[test]
fn unregister_removes_the_package_and_is_fine_without_one() {
    let sys = FakeSystem::default();
    unregister(&sys).unwrap();
    assert!(sys.calls.borrow().is_empty());
    *sys.package.borrow_mut() = Some("P".into());
    unregister(&sys).unwrap();
    assert_eq!(*sys.calls.borrow(), ["appx_remove:P"]);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_win11`
Expected: FAIL — unresolved import `shell::win11` / `AppxAdd`.

- [ ] **Step 3: Implement**

`shell/mod.rs`: add `pub mod win11;`, the enum and the trait methods exactly as in **Interfaces** (`#[derive(Clone, Debug, PartialEq)] pub enum AppxAdd { Added, UntrustedRoot, Failed(String) }`). `WinSystem` must keep compiling: until Task 8, give the new methods temporary bodies that return `Err(Error::Other("not implemented yet".into()))` / `AppxAdd::Failed(..)` / `false` and are replaced in Task 8 Step 3 (this is scaffolding inside one plan, not a deliverable; Task 8 is the next commit).

`shell/win11.rs` — a line-for-line port of `Register-Win11ContextMenu`:

```rust
use std::path::Path;

use super::{classes::set_context_menu_key, AppxAdd, Locations, System};
use crate::error::{Error, Result};

#[derive(Debug, PartialEq)]
pub enum Win11 {
    Registered,
    /// An update could not trust the new certificate without UAC; the registration from before still points at this folder.
    Kept,
    /// Nothing registered and trust is missing: `modify` has to ask for approval.
    NeedsReapproval,
    /// The package file is not in this build; the HKCU verbs still work.
    Missing(String),
}

pub fn register(loc: &Locations, sys: &dyn System, install: &Path, allow_elevate: bool) -> Result<Win11> {
    let appx = install.join("shell-ext").join("null-shell-ext.appx");
    if !appx.is_file() {
        return Ok(Win11::Missing(format!("shell extension package not found at {}", appx.display())));
    }
    let cer = install.join("shell-ext").join("NullIDECert.cer");
    set_context_menu_key(loc, install)?;

    if !allow_elevate {
        // Updates never elevate. Each build has its own certificate, so the new one is usually not trusted yet:
        // keep the registration that exists (it points at this folder, so Explorer loads the new DLL under it).
        let trusted = cer.is_file() && sys.cert_thumbprint(&cer).map(|t| sys.cert_trusted_machine(&t)).unwrap_or(false);
        if !trusted {
            return Ok(if sys.appx_installed()?.is_some() { Win11::Kept } else { Win11::NeedsReapproval });
        }
    }

    // Best effort: CurrentUser trust is not enough for Add-AppxPackage on its own, but it costs nothing.
    let _ = sys.cert_add_current_user(&cer);

    if let Some(existing) = sys.appx_installed()? {
        // Explorer keeps null_explorer_command.dll loaded while this package is registered; servicing it blocks
        // forever. Restart Explorer first so the file is free.
        sys.restart_explorer();
        let _ = sys.appx_remove(&existing);
    }

    let mut added = sys.appx_add(&appx, install);
    if added == AppxAdd::UntrustedRoot {
        if !allow_elevate {
            return Ok(Win11::NeedsReapproval);
        }
        sys.cert_add_machine_elevated(install)?;
        added = sys.appx_add(&appx, install);
    }
    match added {
        AppxAdd::Added => {}
        AppxAdd::UntrustedRoot => {
            return Err(Error::Other("Win11 context menu registration failed: the certificate is still not trusted".into()))
        }
        AppxAdd::Failed(m) => return Err(Error::Other(format!("Win11 context menu registration failed: {m}"))),
    }
    if sys.appx_installed()?.is_none() {
        return Err(Error::Other("Win11 context menu registration failed: NullIDE.ExplorerCommand package is not registered".into()));
    }
    // Keep the registry InstallDir in step with the ExternalLocation this package was registered with.
    set_context_menu_key(loc, install)?;
    sys.restart_explorer();
    Ok(Win11::Registered)
}

pub fn unregister(sys: &dyn System) -> Result<()> {
    if let Some(existing) = sys.appx_installed()? {
        let _ = sys.appx_remove(&existing);
    }
    Ok(())
}
```

- [ ] **Step 4: Run, then commit**

Run: `cargo test -p null-setup-core --test shell_win11` — Expected: PASS (9 tests). Then `cargo test -p null-setup-core` (everything still compiles with the grown trait).

```bash
git add setup/core
git commit -m "feat(setup): the Win11 sparse-APPX registration flow, tested over a fake system" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Real APPX, certificate and Explorer side effects, and the `trust-cert` mode

**Files:**
- Modify: `setup/core/src/shell/sys.rs`
- Create: `setup/core/tests/data/NullIDETestCert.cer`, `setup/core/tests/shell_sys.rs`
- Modify: `setup/app/src/args.rs`, `setup/app/src/main.rs`, `setup/app/src/headless.rs`

**Interfaces:**
- Consumes: the `System` trait (Task 7).
- Produces:
  ```rust
  // sys.rs
  impl System for WinSystem { … all methods real … }
  pub fn trust_target(install: &Path) -> Result<PathBuf>;       // <install>\shell-ext\NullIDECert.cer, after the checks below
  pub fn trust_cert_machine(install: &Path) -> Result<()>;      // the body of the elevated process
  pub fn cert_subject(cer: &Path) -> Result<String>;            // simple display name of the subject
  // app: Mode::TrustCert  (`null-setup trust-cert --install-dir <dir>`; exit 0 on success, 1 otherwise)
  ```

- [ ] **Step 1: Make the fixture certificate and write the failing tests**

A public-key-only test certificate (no private key is exported):

```powershell
$c = New-SelfSignedCertificate -Subject "CN=Null IDE" -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(30)
Export-Certificate -Cert $c -FilePath setup\core\tests\data\NullIDETestCert.cer -Type CERT | Out-Null
$c.Thumbprint
Remove-Item "Cert:\CurrentUser\My\$($c.Thumbprint)"
```
Note the printed thumbprint (uppercase hex); it goes into the test as `FIXTURE_THUMBPRINT`.

`setup/core/tests/shell_sys.rs`:

```rust
use std::{fs, path::Path};

use null_setup_core::shell::{sys::*, System};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/NullIDETestCert.cer");
const FIXTURE_THUMBPRINT: &str = "<paste the thumbprint printed by the PowerShell above>";

#[test]
fn reads_the_thumbprint_and_subject_of_a_der_certificate() {
    assert_eq!(WinSystem.cert_thumbprint(Path::new(FIXTURE)).unwrap(), FIXTURE_THUMBPRINT);
    assert_eq!(cert_subject(Path::new(FIXTURE)).unwrap(), "Null IDE");
}

#[test]
fn a_certificate_nobody_trusted_is_not_trusted() {
    assert!(!WinSystem.cert_trusted_machine(FIXTURE_THUMBPRINT));
}

fn install(root: &Path, marker: bool, cer: Option<&[u8]>) -> std::path::PathBuf {
    let dir = root.join("Null IDE");
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    if marker {
        fs::write(dir.join(".null-ide-install.json"), "{}").unwrap();
    }
    if let Some(b) = cer {
        fs::write(dir.join("shell-ext").join("NullIDECert.cer"), b).unwrap();
    }
    dir
}

#[test]
fn trust_target_only_accepts_a_null_install_with_a_null_certificate() {
    let t = tempfile::tempdir().unwrap();
    let good = fs::read(FIXTURE).unwrap();
    assert!(trust_target(&install(t.path(), true, Some(&good))).unwrap().ends_with("NullIDECert.cer"));
    assert!(trust_target(&install(&t.path().join("a"), false, Some(&good))).is_err());   // no marker
    assert!(trust_target(&install(&t.path().join("b"), true, None)).is_err());           // no certificate
    assert!(trust_target(&install(&t.path().join("c"), true, Some(b"not a cert"))).is_err());
}
```
Also an `args.rs` unit test (append to its `tests` module):

```rust
#[test]
fn trust_cert_needs_only_an_install_dir() {
    let a = p("trust-cert --install-dir C:\\x").unwrap();
    assert_eq!(a.mode, Mode::TrustCert);
    assert!(p("trust-cert").is_err());
    assert!(p("trust-cert --install-dir C:\\x --version v1").is_ok()); // ignored, not an error
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_sys` and `cargo test -p null-setup args::`
Expected: FAIL — unresolved items / `Mode::TrustCert` missing.

- [ ] **Step 3: Implement the real side effects**

Replace the Task-7 stubs in `WinSystem`. APPX stays on the three PowerShell cmdlets: `Add-AppxPackage` and its siblings are the supported way to register a sparse package with an external location and carry the exact error text (`0x800B0109 / CERT_E_UNTRUSTEDROOT`) that the flow keys on, which keeps behavior identical to the script. `// ponytail: three PowerShell cmdlets for APPX; replace with the WinRT PackageManager if PowerShell startup time ever matters.`

```rust
use std::{os::windows::process::CommandExt, process::Command};

const NO_WINDOW: u32 = 0x0800_0000;
const PACKAGE: &str = "NullIDE.ExplorerCommand";

fn powershell(script: &str) -> std::io::Result<std::process::Output> {
    Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(NO_WINDOW)
        .output()
}

fn quote(p: &Path) -> String { format!("'{}'", p.display().to_string().replace('\'', "''")) }

/// The text the cmdlet fails with when the signing certificate is not trusted.
pub fn is_untrusted_root(message: &str) -> bool {
    ["0x800B0109", "800B0109", "CERT_E_UNTRUSTEDROOT", "not trusted"].iter().any(|m| message.contains(m))
}
```
In `impl System for WinSystem`:

```rust
fn restart_explorer(&self) {
    // Windows starts Explorer again by itself; the install's DLL is released while it is down.
    let _ = Command::new("taskkill").args(["/F", "/IM", "explorer.exe"]).creation_flags(NO_WINDOW).status();
}

fn appx_installed(&self) -> Result<Option<String>> {
    let o = powershell(&format!("(Get-AppxPackage -Name '{PACKAGE}' -ErrorAction SilentlyContinue | Select-Object -First 1).PackageFullName"))
        .map_err(|e| Error::Other(format!("could not start PowerShell: {e}")))?;
    let name = String::from_utf8_lossy(&o.stdout).trim().to_string();
    Ok((!name.is_empty()).then_some(name))
}

fn appx_remove(&self, full_name: &str) -> Result<()> {
    powershell(&format!("Remove-AppxPackage -Package '{}' -ErrorAction SilentlyContinue", full_name.replace('\'', "''")))
        .map(|_| ())
        .map_err(|e| Error::Other(e.to_string()))
}

fn appx_add(&self, appx: &Path, external: &Path) -> AppxAdd {
    let script = format!(
        "$ErrorActionPreference='Stop'; try {{ Add-AppxPackage -Path {} -ExternalLocation {} -ForceUpdateFromAnyVersion }} catch {{ [Console]::Error.WriteLine($_.Exception.Message); exit 1 }}",
        quote(appx),
        quote(external)
    );
    match powershell(&script) {
        Ok(o) if o.status.success() => AppxAdd::Added,
        Ok(o) => {
            let msg = String::from_utf8_lossy(&o.stderr).trim().to_string();
            if is_untrusted_root(&msg) { AppxAdd::UntrustedRoot } else { AppxAdd::Failed(msg) }
        }
        Err(e) => AppxAdd::Failed(format!("could not start PowerShell: {e}")),
    }
}

fn cert_thumbprint(&self, cer: &Path) -> Result<String> { cert::thumbprint(cer) }
fn cert_trusted_machine(&self, thumbprint: &str) -> bool { cert::trusted(CERT_SYSTEM_STORE_LOCAL_MACHINE, thumbprint) }
fn cert_add_current_user(&self, cer: &Path) -> Result<()> { cert::add(CERT_SYSTEM_STORE_CURRENT_USER, cer) }

fn cert_add_machine_elevated(&self, install: &Path) -> Result<()> {
    elevate::run_self(&["trust-cert", "--install-dir", &install.display().to_string()])
        .map_err(|code| Error::Other(format!(
            "Could not install the shell extension certificate (exit {code}). Approve the UAC prompt or run as administrator."
        )))
}
```
Private helper module `cert` in `sys.rs`, using the `windows` crypt32 API (`CertOpenStore` with `CERT_STORE_PROV_SYSTEM_W` and the store name `TrustedPeople`; `CertCreateCertificateContext(X509_ASN_ENCODING, &der)` after reading the `.cer`; `CertGetCertificateContextProperty(ctx, CERT_SHA1_HASH_PROP_ID, …)` for the thumbprint; `CertFindCertificateInStore(.., CERT_FIND_SHA1_HASH, &CRYPT_INTEGER_BLOB { cbData, pbData }, None)` for `trusted`; `CertAddEncodedCertificateToStore(store, X509_ASN_ENCODING, &der, CERT_STORE_ADD_USE_EXISTING, None)` for `add`; `CertGetNameStringW(ctx, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, Some(&mut buf))` for `cert_subject`). Every opened store and context is closed/freed in a small `Drop` guard so an early `?` cannot leak one. `cert::trusted` returns `false` on any error (it is a question, not an operation). Add `Win32_Security_Cryptography` constants as the compiler asks.

`elevate::run_self(args) -> std::result::Result<(), u32>`: build the parameter string with each argument wrapped in `"`…`"`, call `ShellExecuteExW` with `lpVerb = "runas"`, `lpFile = current_exe()`, `nShow = SW_HIDE`, `fMask = SEE_MASK_NOCLOSEPROCESS`; if the call fails (including `ERROR_CANCELLED` 1223 when the user declines) return `Err(GetLastError code)`; otherwise `WaitForSingleObject(hProcess, 600_000)` (a UAC prompt waits for a person, as in `registrations.rs`), read `GetExitCodeProcess`, close the handle, `Ok(())` for 0 else `Err(code)`; a timeout returns `Err(258)`.

The elevated process body:

```rust
/// Runs elevated. Accepts only an install folder, never a path: the certificate is the one shipped in it.
pub fn trust_target(install: &Path) -> Result<PathBuf> {
    if !install.join(".null-ide-install.json").is_file() {
        return Err(Error::Other(format!("{} is not a Null IDE install", install.display())));
    }
    let cer = install.join("shell-ext").join("NullIDECert.cer");
    let subject = cert_subject(&cer)?; // fails for a file that is not a certificate
    if subject != "Null IDE" {
        return Err(Error::Other(format!("refusing a certificate issued to {subject:?}")));
    }
    Ok(cer)
}

pub fn trust_cert_machine(install: &Path) -> Result<()> {
    cert::add(CERT_SYSTEM_STORE_LOCAL_MACHINE, &trust_target(install)?)
}
```
App: `args.rs` — add `Mode::TrustCert`, `Some("trust-cert") => Mode::TrustCert`, add it to the "unknown mode" help text; it needs no tag. `main.rs` — before the other arms:

```rust
Mode::TrustCert => headless::trust_cert(&args),   // no relocation, no log in the install: it is a few lines run elevated
```
`headless.rs`:

```rust
pub fn trust_cert(a: &Args) -> i32 {
    let log = Logger::open(&logs_dir());
    match null_setup_core::shell::sys::trust_cert_machine(&a.install_dir) {
        Ok(()) => 0,
        Err(e) => {
            log.line(&format!("trust-cert failed: {e}"));
            1
        }
    }
}
```
`cli.rs`'s exhaustive `match a.mode` gets `Mode::TrustCert` added to the `unreachable!("handled in main")` arm.

- [ ] **Step 4: Run, then commit**

Run: `cargo test --locked -p null-setup-core -p null-setup`
Expected: PASS (the real certificate-store and ShellExecute paths are exercised only in Task 10's runbook; the tests above cover the fixture parsing and the entry-point checks).

```bash
git add setup/core setup/app
git commit -m "feat(setup): real APPX, certificate and Explorer side effects plus the trust-cert entry point" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `ShellRegistrar` replaces the script

**Files:**
- Modify: `setup/core/src/shell/mod.rs` (`apply_with`), `setup/core/src/registrations.rs`, `setup/core/src/install_config.rs`
- Create: `setup/core/tests/shell_apply.rs`
- Delete: `setup/core/tests/registration_args.rs`, `setup/core/tests/registrations.rs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```rust
  // shell/mod.rs
  pub fn apply_with(loc: &Locations, sys: &dyn System, install: &Path, register: &[Feature], unregister: &[Feature],
                    allow_elevate: bool, log: &dyn Fn(&str)) -> Registration;
  // registrations.rs
  pub struct ShellRegistrar;                  // impl Registrar: apply_with(&Locations::real()?, &WinSystem, …)
  pub fn standard() -> Arc<dyn Registrar>;    // now returns ShellRegistrar
  // removed: ScriptRegistrar, classify, script_args, the free apply, Feature::script_name
  ```

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/shell_apply.rs`:

```rust
mod support;

use std::fs;

use null_setup_core::{
    install_config::Feature,
    registrations::Registration,
    shell::apply_with,
};
use support::{FakeSystem, Hive};

fn install(h: &Hive) -> std::path::PathBuf {
    let dir = h.tmp.path().join("Null IDE ünï");
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    dir
}

fn apply(h: &Hive, sys: &FakeSystem, dir: &std::path::Path, reg: &[Feature], unreg: &[Feature], elevate: bool) -> Registration {
    apply_with(&h.loc, sys, dir, reg, unreg, elevate, &|_| {})
}

#[test]
fn nothing_to_do_is_skipped() {
    let h = Hive::new();
    assert_eq!(apply(&h, &FakeSystem::default(), &install(&h), &[], &[], false), Registration::Skipped);
}

#[test]
fn registers_every_feature_into_the_scratch_locations() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    let r = apply(&h, &sys, &dir, &Feature::ALL, &[], false);
    // The sparse APPX is not in this fake install, so the context menu reports it missing but the verbs are written.
    assert_eq!(r, Registration::Done);
    assert_eq!(sys.count("shortcut:Null IDE (Safe Mode).lnk"), 1);
    assert_eq!(sys.count("shortcut:Null IDE.lnk"), 2); // desktop + start menu share the file name
    assert!(h.exists(r"Software\Classes\Directory\shell\NullIDE"));
    assert!(h.exists(r"Software\Classes\NullIDE.AssocFile.rust"));
    assert!(h.exists(&format!(r"Software\Classes\CLSID\{}", null_setup_core::shell::classes::PREVIEW_CLSID)));
    assert_eq!(h.get("Environment", "Path"), dir.join("bin").display().to_string());
}

#[test]
fn unregistering_works_when_null_exe_is_gone_and_removes_both_path_forms() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    apply(&h, &sys, &dir, &Feature::ALL, &[], false);
    h.set_text("Environment", "Path", &format!(r"C:\a;{};{}", dir.display(), dir.join("bin").display()));
    fs::remove_file(dir.join("null.exe")).unwrap();
    assert_eq!(apply(&h, &sys, &dir, &[], &Feature::ALL, false), Registration::Done);
    assert_eq!(h.get("Environment", "Path"), r"C:\a");
    assert!(!h.exists(r"Software\Classes\NullIDE.AssocFile.rust") && !h.exists(r"Software\Classes\Directory\shell\NullIDE"));
}

#[test]
fn registering_without_null_exe_is_a_warning_not_a_panic() {
    let h = Hive::new();
    let dir = install(&h);
    fs::remove_file(dir.join("null.exe")).unwrap();
    let r = apply(&h, &FakeSystem::default(), &dir, &[Feature::Path], &[], false);
    assert!(matches!(r, Registration::Warning(w) if w.contains("null.exe")));
}

#[test]
fn one_failing_feature_does_not_stop_the_others() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    fs::write(dir.join("shell-ext").join("null-shell-ext.appx"), "x").unwrap();
    *sys.adds.borrow_mut() = vec![null_setup_core::shell::AppxAdd::Failed("boom".into())];
    sys.machine_trusted.set(true);
    fs::write(dir.join("shell-ext").join("NullIDECert.cer"), "x").unwrap();
    let r = apply(&h, &sys, &dir, &[Feature::ContextMenu, Feature::FileAssociations], &[], true);
    assert!(matches!(&r, Registration::Warning(w) if w.contains("contextMenu") && w.contains("boom")), "{r:?}");
    assert!(h.exists(r"Software\Classes\NullIDE.AssocFile.rust")); // still registered
}

#[test]
fn needs_reapproval_wins_and_a_missing_package_is_only_logged() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    fs::write(dir.join("shell-ext").join("null-shell-ext.appx"), "x").unwrap();
    fs::write(dir.join("shell-ext").join("NullIDECert.cer"), "x").unwrap();
    assert_eq!(apply(&h, &sys, &dir, &[Feature::ContextMenu], &[], false), Registration::NeedsReapproval);
}
```
- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p null-setup-core --test shell_apply`
Expected: FAIL — `apply_with` not found.

- [ ] **Step 3: Implement**

`shell/mod.rs`:

```rust
use std::path::Path;

use crate::{install_config::Feature, registrations::Registration};

fn exe_of(install: &Path) -> std::result::Result<PathBuf, String> {
    let exe = install.join("null.exe");
    exe.is_file().then_some(exe).ok_or_else(|| format!("null.exe not found in {}", install.display()))
}

fn register_one(f: Feature, loc: &Locations, sys: &dyn System, install: &Path, exe: &Path, allow_elevate: bool, log: &dyn Fn(&str)) -> Result<bool> {
    use shortcuts::{create, desktop, safe_mode, start_menu};
    match f {
        Feature::DesktopShortcut => create(sys, &desktop(loc, exe, install))?,
        Feature::StartMenuShortcut => create(sys, &start_menu(loc, exe, install))?,
        Feature::SafeModeShortcut => create(sys, &safe_mode(loc, exe, install))?,
        Feature::Path => {
            path::remove(loc, sys, install)?; // an entry from an older install that put the folder itself on PATH
            path::add(loc, sys, &install.join("bin"))?;
        }
        Feature::ContextMenu => {
            classes::register_context_menu(loc, exe)?;
            match win11::register(loc, sys, install, allow_elevate)? {
                win11::Win11::NeedsReapproval => return Ok(true),
                win11::Win11::Missing(m) => log(&m),
                win11::Win11::Kept => log("kept the existing Windows 11 context menu registration"),
                win11::Win11::Registered => {}
            }
        }
        Feature::FileAssociations => {
            classes::register_file_associations(loc, sys, install)?;
        }
        Feature::PreviewHandler => {
            let (claimed, skipped) = classes::register_preview_handler(loc, sys, install)?;
            log(&format!("preview handler: {claimed} extensions claimed, {skipped} already handled by another app"));
        }
    }
    Ok(false)
}

fn unregister_one(f: Feature, loc: &Locations, sys: &dyn System, install: &Path) -> Result<()> {
    match f {
        Feature::DesktopShortcut => shortcuts::remove(&loc.desktop.join("Null IDE.lnk")),
        Feature::StartMenuShortcut => shortcuts::remove(&loc.programs.join("Null IDE").join("Null IDE.lnk")),
        Feature::SafeModeShortcut => shortcuts::remove(&loc.programs.join("Null IDE").join("Null IDE (Safe Mode).lnk")),
        Feature::Path => {
            path::remove(loc, sys, &install.join("bin"))?;
            path::remove(loc, sys, install)
        }
        Feature::ContextMenu => {
            classes::unregister_context_menu(loc)?;
            win11::unregister(sys)
        }
        Feature::FileAssociations => classes::unregister_file_associations(loc, sys),
        Feature::PreviewHandler => classes::unregister_preview_handler(loc, sys),
    }
}

/// Unregistering runs before registering. Every feature is attempted; failures are collected.
pub fn apply_with(
    loc: &Locations,
    sys: &dyn System,
    install: &Path,
    register: &[Feature],
    unregister: &[Feature],
    allow_elevate: bool,
    log: &dyn Fn(&str),
) -> Registration {
    if register.is_empty() && unregister.is_empty() {
        return Registration::Skipped;
    }
    let (mut warnings, mut reapproval) = (Vec::<String>::new(), false);
    for f in unregister {
        if let Err(e) = unregister_one(*f, loc, sys, install) {
            warnings.push(format!("{}: {e}", f.name()));
        }
    }
    if !register.is_empty() {
        // Only registering needs the executable; removing must still work when null.exe is gone (quarantined, half-deleted).
        match exe_of(install) {
            Err(m) => warnings.push(m),
            Ok(exe) => {
                for f in register {
                    match register_one(*f, loc, sys, install, &exe, allow_elevate, log) {
                        Ok(r) => reapproval |= r,
                        Err(e) => warnings.push(format!("{}: {e}", f.name())),
                    }
                }
            }
        }
    }
    shortcuts::remove_empty_start_menu(loc);
    for w in &warnings {
        log(&format!("registration warning: {w}"));
    }
    if reapproval {
        Registration::NeedsReapproval
    } else if warnings.is_empty() {
        Registration::Done
    } else {
        Registration::Warning(warnings.join("; "))
    }
}
```
`Feature::name()` — in `install_config.rs` rename `script_name` to `name` (same strings; the doc comment becomes "Stable id used in logs and messages"). Delete the script-name drift test along with `registration_args.rs`.

`registrations.rs` becomes (keep `Registration` as is):

```rust
use std::{path::Path, sync::Arc};

use crate::{
    install_config::Feature,
    progress::Ctx,
    shell::{self, sys::WinSystem, Locations},
};

#[derive(Clone, Debug, PartialEq)]
pub enum Registration { Done, NeedsReapproval, Warning(String), Skipped }

pub trait Registrar: Send + Sync {
    fn apply(&self, install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration;
}

pub struct ShellRegistrar;

impl Registrar for ShellRegistrar {
    fn apply(&self, install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration {
        if register.is_empty() && unregister.is_empty() {
            return Registration::Skipped;
        }
        let loc = match Locations::real() {
            Ok(l) => l,
            Err(e) => return Registration::Warning(e.to_string()),
        };
        shell::apply_with(&loc, &WinSystem, install, register, unregister, allow_elevate, &|m| ctx.log.line(&format!("registrations: {m}")))
    }
}

pub fn standard() -> Arc<dyn Registrar> { Arc::new(ShellRegistrar) }
```
(`NO_WINDOW`, `MARKER`, `classify`, `script_args`, `apply` and the PowerShell spawn are deleted. The `manage.rs` and `update.rs` call sites already use the trait from Task 1.) `git rm setup/core/tests/registration_args.rs setup/core/tests/registrations.rs`; move the `explorer_loads_dll` test from the deleted `registrations.rs` into `setup/core/tests/shellext.rs`.

- [ ] **Step 4: Run the whole suite**

Run: `cargo test --locked -p null-setup-core -p null-setup`
Expected: PASS. Then `git grep -n "ScriptRegistrar\|script_name\|install-null-ide" -- setup` must print only comments in `tests/shell_assoc.rs` (the drift test reads the script on purpose).

- [ ] **Step 5: Commit**

```bash
git add -A setup
git commit -m "feat(setup): null-setup registers natively; the PowerShell registration path is gone" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Parity check on a real machine, runbook and docs

The automated tests prove each rule in a scratch hive; this task proves that the real registry ends up the same as the script's, and exercises the pieces tests cannot (UAC, Explorer, APPX, shortcuts on the real Desktop).

**Files:**
- Create: `docs/specs/null-setup-registrations-runbook.md`
- Modify: `CLAUDE.md`, `docs/specs/null-setup-installer-design.md`, `.claude/agents/security-reviewer.md`

**Interfaces:**
- Produces: a recorded result per row; a verdict **PASS** (2b ships) or a list of differences (each fixed or accepted in writing).

- [ ] **Step 1: Back up and build**

Back up first (the matrix re-points your real shortcuts, PATH, associations and Win11 package — same warning as the 2a runbook):

```powershell
$bk = "$env:TEMP\null-reg-backup"; New-Item -ItemType Directory $bk -Force | Out-Null
foreach ($k in 'Software\Classes\NullIDE','Software\Classes\NullIDEContextMenu','Software\Classes\Applications\null.exe','Software\RegisteredApplications') { reg export "HKCU\$k" "$bk\$($k -replace '\\','_').reg" /y | Out-Null }
[Environment]::GetEnvironmentVariable('Path','User') | Set-Content "$bk\userpath.txt"
Copy-Item "$([Environment]::GetFolderPath('Programs'))\Null IDE" "$bk\StartMenu" -Recurse -ErrorAction SilentlyContinue
```
Build: `cargo build --release --locked -p null-setup` in `setup/`.

- [ ] **Step 2: Write the dump function and capture both states**

`docs/specs/null-setup-registrations-runbook.md` starts with this function (it prints only what Null owns, one sorted line per value, so shared keys and other apps' entries never enter the comparison):

```powershell
function Dump-Key([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $k = Get-Item -LiteralPath $Path
  foreach ($n in $k.GetValueNames()) {
    '{0}|{1}|{2}|{3}' -f $k.Name, $n, $k.GetValueKind($n), (($k.GetValue($n, $null, 'DoNotExpandEnvironmentNames')) -join ',')
  }
  foreach ($s in $k.GetSubKeyNames()) { Dump-Key "$Path\$s" }
}
function Get-NullRegistrations {
  $c = 'HKCU:\Software\Classes'
  $own = 'NullIDEContextMenu','NullIDE','Applications\null.exe','*\shell\NullIDE','Directory\shell\NullIDE','Directory\Background\shell\NullIDE','CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}'
  $own + (Get-ChildItem $c -Name | Where-Object { $_ -like 'NullIDE.AssocFile.*' }) | ForEach-Object { Dump-Key "$c\$_" }
  foreach ($ext in (Get-ChildItem $c -Name | Where-Object { $_ -like '.*' })) {
    $o = "$c\$ext\OpenWithProgids"
    if (Test-Path -LiteralPath $o) { (Get-Item -LiteralPath $o).GetValueNames() | Where-Object { $_ -like 'NullIDE.*' } | ForEach-Object { "$ext|OpenWithProgids|$_" } }
    $s = "$c\$ext\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}"
    if ((Test-Path -LiteralPath $s) -and ((Get-Item -LiteralPath $s).GetValue('') -eq '{58F3B583-5D67-489A-9069-97FD45B2569B}')) { "$ext|shellex|ours" }
  }
  Dump-Key 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' | Where-Object { $_ -like '*58F3B583*' }
  'HKCU:\Software\RegisteredApplications|Null IDE|' + (Get-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name 'Null IDE' -ErrorAction SilentlyContinue).'Null IDE'
} 
```
Capture (use the install the daily IDE uses, or a copy of it, and `-NoElevate`/`--install-dir` identical in both runs):

```powershell
$I = "$env:LOCALAPPDATA\Programs\Null IDE"; $S = "D:\Coding\Apps\null-ide"
$feat = 'contextMenu,fileAssociations,previewHandler'
# A: the script
& powershell -NoProfile -ExecutionPolicy Bypass -File "$S\scripts\install-null-ide.ps1" -InstallDir $I -Unregister $feat -NoElevate
& powershell -NoProfile -ExecutionPolicy Bypass -File "$S\scripts\install-null-ide.ps1" -InstallDir $I -Register $feat -NoElevate
Get-NullRegistrations | Sort-Object | Set-Content "$env:TEMP\reg-script.txt"
# B: Rust. `modify` with a config that has exactly those three on and the rest as they are
#    (copy <I>\install-config.json, set contextMenu/fileAssociations/previewHandler false, run modify, then true, run modify)
Get-NullRegistrations | Sort-Object | Set-Content "$env:TEMP\reg-rust.txt"
Compare-Object (Get-Content "$env:TEMP\reg-script.txt") (Get-Content "$env:TEMP\reg-rust.txt")
```
Expected: no output. Anything printed is a difference: fix the port, or write it down as accepted (e.g. a key order that does not matter) in the runbook.

- [ ] **Step 3: Run the rest of the matrix and record results**

Add this table to the runbook and fill the Result column. Use a scratch install (`Null IDE ünï`, see the 2a runbook for the scratch setup and `$env:APPDATA`), the release exe, and pipe output through `| Out-String`.

| # | Scenario | Expect | Result |
|---|---|---|---|
| 1 | The parity diff above | empty | |
| 2 | `install --version <tag> --install-dir "…\Null IDE ünï"` with defaults | Start Menu + Safe Mode shortcuts open the IDE (check the Safe Mode one shows `[Safe Mode]`), `bin` on the PATH of a **new** terminal (`null --version` works), file associations and preview handler registered, no PowerShell window flashed | |
| 3 | Row 2 with the user PATH seeded to `%USERPROFILE%\bin;C:\Tools` as `REG_EXPAND_SZ` beforehand | afterwards `reg query HKCU\Environment /v Path` shows `REG_EXPAND_SZ`, `%USERPROFILE%\bin` untouched, our `bin` appended | |
| 4 | `modify` turning `desktopShortcut` on then off | the real Desktop shortcut appears, then disappears; nothing else changes | |
| 5 | Fresh install, Win11 context menu, certificate untrusted | one UAC prompt (title shows `null-setup.exe`), then right-click → "Open with Null" in the **top-level** Win11 menu works; `Get-AppxPackage NullIDE.ExplorerCommand` shows the install folder as `InstallLocation` | |
| 6 | Row 5 but **decline** UAC | `install` finishes with "installed, but some registrations failed: contextMenu: …certificate…"; no hang; the HKCU verbs (classic menu) still exist; file associations still registered | |
| 7 | `update` to a newer fake tag with a new certificate | no UAC; the existing package is kept (log says so); Explorer menu still works; the UI/CLI reports needs-reapproval only when no package existed | |
| 8 | `modify` after row 7 | UAC once, package re-registered against the new certificate | |
| 9 | `uninstall` of row 2's install, `null.exe` deleted first | shortcuts, PATH entries (both `bin` and the folder), associations, preview handler, verbs and the package are gone; `Get-NullRegistrations` prints nothing; `Null IDE` Start Menu folder gone | |
| 10 | Another app owns `.json`'s preview handler (set `HKCU\Software\Classes\.json\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}` default to any other GUID), then row 2 and row 9 | our install leaves it, our uninstall leaves it | |
| 11 | Windows 10 22H2 VM: rows 2, 5, 9 | as above (the Win11 menu rows are N/A; the classic verbs must work) | open until a Win10 machine is available |

- [ ] **Step 4: Restore the daily install and update the docs**

Restore from the backup (re-run `null-setup.exe modify --install-dir … --config …` for the daily install, then re-import `$bk\*.reg` if anything differs from the backup).

`CLAUDE.md` — in the `setup/` section, replace the sentence "Registrations still run through `install-null-ide.ps1 -Register/-Unregister <csv>` (names from `Feature::script_name`) until 2b ports them to Rust; only `install` and `modify` may elevate." with:

> Registrations are native (sub-project 2b, `setup/core/src/shell/`): `Registrar` (injected through `Opts`, `UninstallOpts` and `modify_in_place`, so tests never write the registry) → `shell::apply_with(loc, sys, …)` over a `Locations` (HKCU prefix + Desktop/Programs folders; tests use a scratch hive) and a `System` trait (Explorer, change broadcasts, `.lnk`, certificate store, APPX; faked in tests, `WinSystem` for real). The Win11 sparse APPX still goes through the three `*-AppxPackage` PowerShell cmdlets; the elevated certificate import is `null-setup trust-cert --install-dir <dir>` (reads only `<dir>\shell-ext\NullIDECert.cer`, requires `.null-ide-install.json` and subject `CN=Null IDE`). `install-null-ide.ps1` is no longer called by `null-setup` but is still shipped for Inno and the README one-liner until 2c deletes it with Inno. Only `install` and `modify` may elevate. Plan `docs/plans/null-setup-registrations.md`; runbook `docs/specs/null-setup-registrations-runbook.md`.

Also in `CLAUDE.md` build step 11 change "(the registration script `null-setup` runs after an update)" to "(still shipped for Inno and the README install; `null-setup` registers natively)".

`docs/specs/null-setup-installer-design.md`, "Sequencing": change the 2b bullet to `- **2b registrations in Rust** (`docs/plans/null-setup-registrations.md`, done): …`.

`.claude/agents/security-reviewer.md`: in the list of files to review add `setup/core/src/shell/` (registry writes, `sys.rs` certificate store and ShellExecute) and `trust-cert` as the one elevated entry point; item 3 (the script) now says "the script remains only for Inno/README until 2c".

- [ ] **Step 5: Run the security reviewer and commit**

Run the `security-reviewer` agent on `setup/core/src/shell/sys.rs`, `setup/app/src/headless.rs` and `setup/core/src/shell/win11.rs`; fix what it finds (with a test each) before committing.

```bash
git add docs CLAUDE.md .claude/agents/security-reviewer.md
git commit -m "docs: registrations runbook and results, null-setup registers natively" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** `shell` module with every registration kind (Tasks 3–7, 9), individually reversible and idempotent (tests in 3–5, 9), only the certificate step elevates (Tasks 7–8), registration failures non-fatal and reported (Task 9 `Warning`), "keep behavior identical, test on a clean machine" (Task 10 parity diff + matrix). Deliberately not here: retiring the script/Inno/README (2c), Add/Remove Programs entry (2c), settings seeding (removed by the spec), `Write-NullShim` (not a registration).
- **Open decision for the human partner:** the plan keeps three PowerShell cmdlets for the APPX (identical error text, lowest risk). The WinRT `PackageManager` is the alternative; say so if you want it instead, it only changes `appx_*` in `sys.rs`.
- **Type consistency:** `Registrar::apply`, `Locations`, `System` (methods added in order: `assoc_changed` T4, `env_changed` T5, `create_shortcut` T6, `restart_explorer`/`appx_*`/`cert_*` T7), `AppxAdd`, `Win11`, `Registration` are named identically across tasks; `Feature::name` replaces `script_name` in T9 only.
