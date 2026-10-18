# Null Setup, Sub-project 2c-2: Wizard and Stub Installer Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** `NullIDESetup-<version>.exe` becomes the new `null-setup.exe` stub: double-clicked it shows the install wizard (options, built-ins, settings, summary, progress, finish); started again on a machine that has Null IDE it shows Modify / Repair / Uninstall; Windows' Add/Remove Programs gets an entry that opens the same window on its Modify and Uninstall pages.

**Architecture:** No new install logic. The wizard window only collects choices and then runs the existing, tested pipeline through `cli::dispatch` (the code behind `null-setup install|modify|repair|uninstall`), handing it the choices as temp files exactly as the headless CLI takes them. New code is (a) core rules that are testable without a window — latest-release lookup, "what does the window show", the Add/Remove Programs key, the WebView2 check; (b) a thin Tauri layer (`app/src/wizard.rs`) reusing the update window's event/locked-prompt plumbing; (c) a plain-script UI whose rules (dependency-aware built-in checklist, job building) live in one pure file tested through `node:vm`, the repo's existing pattern for webview code.

**Tech Stack:** Rust (core + Tauri 2.12 app, no new crates; `serde` and `tempfile` added to `app` only, both already in `Cargo.lock`), plain JS/CSS/HTML under `setup/ui/` (no framework, no build step), Node ≥ 18 `node --test`, GitHub Actions (`build.yml`), PowerShell (`build-local.ps1`), Inno Setup (renamed, not removed).

**Spec:** `docs/specs/null-setup-installer-design.md` — "Wizard flow", "Uninstall", "Release pipeline changes", "Error handling" (missing WebView2), sequencing entry **2c-2**. Predecessors: `docs/plans/null-setup-installer-engine.md` (2a), `docs/plans/null-setup-registrations.md` (2b), `docs/plans/null-setup-first-run.md` (2c-1, provides `builtins.json` `settings`/`marketplace`, `first_run::*`). Visual language: `DESIGN.md` (near-black, Signal Blue only for the primary action).

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

- Supported Windows: Windows 11 and Windows 10 22H2 (both ship WebView2). No code signing; the README's SmartScreen note stays (2c-3 owns README edits).
- UAC (spec): "Only a fresh install or `modify` may elevate; `update` and `repair` never do." The wizard therefore sets `allow_elevate` only through `cli::dispatch`, which already applies that rule.
- Non-goals (spec): offline installer, delta updates, a prerelease channel, a WebView2 bootstrapper or console fallback.
- Missing WebView2 (spec): "a native error dialog with the download link. No bootstrapper and no console fallback."
- Registration failures are "non-fatal, reported on the final page and in the log, and repairable with `modify` or `repair`" (spec).
- Uninstall keeps `%APPDATA%\Null` unless the unchecked box "Also delete my settings, extensions and data" is ticked (spec). The core already refuses unsafe paths (`manage::uninstall`); the UI must not weaken that.
- Marketplace page is hidden when the manifest's `marketplace` table is empty (it is today); the settings page lists exactly the manifest's `settings` and nothing else.
- `install-null-ide.ps1`, `updater/`, `scripts/update-null-ide.ps1`, README and `Null: Setup` are **2c-3**. This plan renames the Inno output so the stub can own `NullIDESetup-<version>.exe`, and leaves Inno otherwise untouched.
- Conventions: Rust tests next to the existing ones (`setup/core/tests/*.rs`, `#[cfg(test)]` in `app/src/*.rs`); registry tests use `support::Hive`, never the real HKCU; UI webview code is plain scripts (no `import`/`export`), pure rules in `wizard-model.js` with top-level `function` declarations only; every DOM string from the manifest goes through `textContent`/`append`, never `innerHTML`.
- Commit style: `feat(setup): …`, `ci: …`, `docs: …`; end messages with the attribution trailer the harness specifies. Do not push.
- Run Cargo from `setup/`: `cd setup && cargo test -p null-setup-core --test <name>`.

## Review Focus

Input classes the spec implies but the happy path never exercises, most likely first. Each has a test in the task named in brackets.

1. **Install folder** — spaces/umlauts, trailing `\`, `;` or `%` in the path, a drive root, a relative path, a non-empty folder that is not Null IDE, a folder that already holds an install. Rejected on "Next" with a sentence, before any download. [Task 4 args tests, Task 5 `check_target_dir`]
2. **Built-in dependency chains** — ticking `null-format` must tick `null-env` (and anything that one needs, transitively); unticking `null-env` while `null-format` is on is refused with the dependent's name; "Core" rows cannot change; a default-off built-in that a default-on one requires is not left off. [Task 6]
3. **Network and release shape** — offline / rate-limited / HTTP 5xx on the latest release or on `builtins.json` shows an error page with Retry, not a half-empty wizard; a latest release that simply has no `builtins.json` asset (pre-2a release) hides the built-in and settings pages but still installs. The two must not be confused. [Task 1, Task 3]
4. **Stub started on a machine that already has Null IDE** — shows Maintenance, not a second install into the default folder; an Add/Remove Programs entry whose folder is gone does *not* block a fresh install, and "Uninstall" on it removes only the stale entry. [Task 3]
5. **Double submit and closing mid-install** — a second `wizard_start` while one runs is refused; the window cannot be closed from "Installing" until the job ends; after a failure the same window can retry. [Task 5 `claim`, `guard_close`]

Also covered: missing WebView2 version strings (`""`, `"0.0.0.0"`) are "not installed" [Task 3]; untouched settings page writes no `first-run.json` entries [Task 6]; ARP entry is written after a successful install/update, refreshed with the new version, and removed only after the files are gone [Task 2].

Known gap kept from 2a (not fixed here): when registration fails during `install`, `cli::dispatch` returns before saving `first-run.json`, so the wizard's presets are lost in that case. The wizard shows the warning and offers Launch; the user re-applies presets in Settings. Revisit in 2c-3 with `Null: Setup`.

---

## File Structure

```
setup/
├── core/src/
│   ├── release.rs                 # MODIFY Latest, resolve_latest, latest_from_json
│   ├── update.rs                  # MODIFY api_base(); is_empty_target pub; finish() writes the ARP entry
│   ├── manage.rs                  # MODIFY uninstall removes the ARP entry last
│   ├── registrations.rs           # MODIFY Registrar::arp (default no-op), ShellRegistrar override
│   ├── builtins.rs                # MODIFY Serialize on the manifest types (sent to the UI)
│   ├── first_run.rs               # MODIFY save(manifest, choices, dir); save_from_file uses it
│   ├── shell/arp.rs               # NEW   Add/Remove Programs entry: register / find / unregister
│   ├── shell/mod.rs               # MODIFY pub mod arp;
│   ├── wizard.rs                  # NEW   Intent, Page, decide(), fetch_install()
│   ├── webview2.rs                # NEW   installed(), usable_version(), show_missing()
│   └── lib.rs                     # MODIFY pub mod wizard; pub mod webview2;
├── core/tests/
│   ├── release.rs                 # MODIFY latest tests
│   ├── shell_arp.rs               # NEW
│   ├── wizard.rs                  # NEW   decide + fetch_install
│   ├── webview2.rs                # NEW
│   ├── builtins.rs                # MODIFY serialization test
│   ├── first_run.rs               # MODIFY save() test
│   ├── update.rs, manage.rs       # MODIFY ARP call tests
│   └── support/mod.rs             # MODIFY Recorder records arp calls
├── app/
│   ├── Cargo.toml                 # MODIFY serde, tempfile (dev)
│   └── src/
│       ├── args.rs                # MODIFY Mode::Wizard, --intent, check_install_dir(), install_dir_given
│       ├── cli.rs                 # MODIFY dispatch pub(crate), is_partial()
│       ├── window.rs              # MODIFY share Action/Channel/UiInteract/commands, guard_close()
│       ├── wizard.rs              # NEW   Tauri side of the wizard
│       └── main.rs                # MODIFY Mode::Wizard arm, WebView2 check
├── ui/
│   ├── wizard.html                # NEW
│   ├── wizard.css                 # NEW
│   ├── wizard-model.js            # NEW   pure rules (vm-tested)
│   └── wizard.js                  # NEW   DOM + Tauri events
└── ui-tests/wizard-model.test.mjs # NEW   (outside frontendDist so it is not embedded)
scripts/fake-release.mjs           # MODIFY /releases/latest + builtins.json asset
installer/null-ide.iss             # MODIFY OutputBaseFilename → NullIDEInno-…
.github/workflows/build.yml        # MODIFY stage the stub as NullIDESetup-<v>.exe, rename Inno, UI test step
scripts/build-local.ps1            # MODIFY mirror
docs/specs/null-setup-wizard-runbook.md   # NEW  manual matrix
CLAUDE.md, docs/specs/null-setup-installer-design.md   # MODIFY
```

**Decisions made here (flag if you disagree):**

| Decision | Choice | Why |
|---|---|---|
| Which version the stub installs | Newest stable (`/releases/latest`) at the time it runs, not the version baked into its file name | The stub is a bootstrapper; an old download should not install an old IDE. |
| No arguments | `Mode::Wizard`, `Intent::Auto` | Spec: "default (no install found) → wizard". |
| How the wizard installs | `cli::dispatch` with temp config / first-run files | One code path, already covered by the 2a/2b manual runbooks. |
| Add/Remove Programs | One HKCU key `…\Uninstall\NullIDE`, written by `finish()` of install/repair/update, removed last by uninstall | Per-user, no elevation; follows the install through updates. |
| Folder picker | Text field only | A native dialog needs a new crate or a plugin; `ponytail:` add Browse when someone asks. |
| Pages in `modify` | Options + built-ins + summary only | First-run presets only apply on the very first start; `Null: Setup` (2c-3) edits them later. |
| Inno during the transition | Output renamed `NullIDEInno-<v>.exe` and still published | Spec risk: keep a fallback until the wizard is proven; 2c-3 deletes it. |

---

### Task 1: Resolve the latest release and its `builtins.json`

**Files:**
- Modify: `setup/core/src/release.rs`
- Modify: `setup/core/src/update.rs` (add `api_base()`)
- Test: `setup/core/tests/release.rs`

**Interfaces:**
- Consumes: `release::from_json(&Value, &str) -> Result<Release>`, `update::safe_tag`.
- Produces: `release::Latest { release: Release, builtins_url: Option<String> }`, `release::latest_from_json(&Value) -> Result<Latest>`, `release::resolve_latest(&Http, &str, &str) -> Result<Latest>`, `update::api_base() -> String`. (`Release` itself is unchanged — `tests/download.rs` builds it with a struct literal.)

- [ ] **Step 1: Write the failing tests** — in `setup/core/tests/release.rs`, change the import line to `use null_setup_core::{http::Http, release::{from_json, latest_from_json, parse_sha256, resolve, resolve_latest}, Error};` and append:

```rust
#[test]
fn latest_reads_the_tag_and_the_optional_builtins_asset() {
    let mut v = release_json("http://h");
    v["tag_name"] = json!("v3");
    assert_eq!(latest_from_json(&v).unwrap().builtins_url, None); // a release from before builtins.json
    v["assets"].as_array_mut().unwrap().push(json!({ "name": "builtins.json", "browser_download_url": "http://h/b", "size": 9 }));
    let l = latest_from_json(&v).unwrap();
    assert_eq!((l.release.tag.as_str(), l.builtins_url.as_deref()), ("v3", Some("http://h/b")));
}

#[test]
fn latest_refuses_a_tag_that_could_not_be_a_folder_name() {
    for bad in ["..\\x", "a/b", ""] {
        let mut v = release_json("http://h");
        v["tag_name"] = json!(bad);
        assert!(matches!(latest_from_json(&v), Err(Error::Package(_))), "{bad:?}");
    }
    let mut none = release_json("http://h");
    none.as_object_mut().unwrap().remove("tag_name");
    assert!(latest_from_json(&none).is_err());
}

#[test]
fn resolve_latest_asks_the_latest_endpoint_and_reports_a_missing_release() {
    let srv = support::serve(|req| {
        if req.url == "/repos/o/r/releases/latest" {
            (200, release_json(&req.base).to_string().into_bytes(), vec![("Content-Type", "application/json".into())])
        } else {
            (404, vec![], vec![])
        }
    });
    let http = Http::with_delay(Duration::from_millis(1));
    assert_eq!(resolve_latest(&http, &srv.base, "o/r").unwrap().release.tag, "v2");
    assert!(matches!(resolve_latest(&http, &srv.base, "o/other"), Err(Error::Http { status: 404, .. })));
}
```

- [ ] **Step 2: Run to verify failure** — `cd setup && cargo test -p null-setup-core --test release` → compile error: unresolved `latest_from_json`.

- [ ] **Step 3: Implement** — in `release.rs` after `from_json`:

```rust
/// The newest stable release plus its `builtins.json` asset (releases from before 2a have none).
#[derive(Clone, Debug, PartialEq)]
pub struct Latest {
    pub release: Release,
    pub builtins_url: Option<String>,
}

pub fn resolve_latest(http: &Http, api_base: &str, repo: &str) -> Result<Latest> {
    let v = http.get_json(&format!("{api_base}/repos/{repo}/releases/latest"))?;
    latest_from_json(&v)
}

pub fn latest_from_json(v: &Value) -> Result<Latest> {
    let tag = v["tag_name"]
        .as_str()
        .filter(|t| crate::update::safe_tag(t))
        .ok_or_else(|| Error::Package("the latest release has no usable tag".into()))?;
    let builtins_url = v["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str() == Some("builtins.json")))
        .and_then(|x| x["browser_download_url"].as_str())
        .map(str::to_string);
    Ok(Latest { release: from_json(v, tag)?, builtins_url })
}
```

In `update.rs` add above `impl Opts`:

```rust
/// Test seam for scripts/fake-release.mjs; a local attacker who controls the environment already owns the user.
pub fn api_base() -> String {
    std::env::var("NULL_SETUP_API_BASE").unwrap_or_else(|_| "https://api.github.com".into())
}
```

and in `Opts::standard` replace the two lines (comment + `api_base: std::env::var(...)…,`) with `api_base: api_base(),`.

- [ ] **Step 4: Run** — `cargo test -p null-setup-core --test release` → all pass; `cargo test -p null-setup-core --test update` still passes.

- [ ] **Step 5: Commit**

```bash
git add setup/core/src/release.rs setup/core/src/update.rs setup/core/tests/release.rs
git commit -m "feat(setup): resolve the latest release and its builtins.json asset"
```

---

### Task 2: Add/Remove Programs entry

**Files:**
- Create: `setup/core/src/shell/arp.rs`
- Modify: `setup/core/src/shell/mod.rs` (`pub mod arp;` next to the other `pub mod` lines)
- Modify: `setup/core/src/registrations.rs`, `setup/core/src/update.rs` (`finish`), `setup/core/src/manage.rs` (`uninstall_inner`)
- Test: `setup/core/tests/shell_arp.rs` (new), `setup/core/tests/support/mod.rs`, `setup/core/tests/update.rs`, `setup/core/tests/manage.rs`

**Interfaces:**
- Consumes: `shell::{create, open, remove_tree, set, Locations}` (crate-private helpers in `shell/mod.rs`).
- Produces: `arp::Entry { install_dir: PathBuf, version: String }`; `arp::register(&Locations, &Path, &str) -> Result<()>`; `arp::find(&Locations) -> Option<Entry>`; `arp::unregister(&Locations) -> Result<()>`; `Registrar::arp(&self, install: &Path, version: Option<&str>, ctx: &Ctx)` (default no-op; `Some` writes/refreshes, `None` removes); `Recorder.arp: Mutex<Vec<Option<String>>>` in test support.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/shell_arp.rs`:

```rust
mod support;

use std::path::Path;

use null_setup_core::shell::arp::{find, register, unregister};
use support::Hive;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\NullIDE";
const DIR: &str = r"C:\Null IDE ünï";

#[test]
fn register_writes_what_add_remove_programs_shows_and_the_two_commands() {
    let h = Hive::new();
    register(&h.loc, Path::new(DIR), "v1.2.3").unwrap();
    assert_eq!(h.get(KEY, "DisplayName"), "Null IDE");
    assert_eq!(h.get(KEY, "DisplayVersion"), "1.2.3"); // no leading v
    assert_eq!(h.get(KEY, "InstallLocation"), DIR);
    assert_eq!(h.get(KEY, "DisplayIcon"), format!(r"{DIR}\null.exe"));
    let exe = format!(r#""{DIR}\setup\null-setup.exe" wizard --install-dir "{DIR}""#);
    assert_eq!(h.get(KEY, "UninstallString"), format!("{exe} --intent uninstall"));
    assert_eq!(h.get(KEY, "ModifyPath"), format!("{exe} --intent modify"));
}

#[test]
fn registering_again_refreshes_the_version_in_place() {
    let h = Hive::new();
    register(&h.loc, Path::new(DIR), "v1").unwrap();
    register(&h.loc, Path::new(DIR), "v2").unwrap();
    assert_eq!(h.get(KEY, "DisplayVersion"), "2");
}

#[test]
fn find_reads_back_the_entry_and_unregister_removes_it_even_twice() {
    let h = Hive::new();
    assert_eq!(find(&h.loc), None);
    register(&h.loc, Path::new(DIR), "v1.2.3").unwrap();
    let e = find(&h.loc).unwrap();
    assert_eq!((e.install_dir.as_path(), e.version.as_str()), (Path::new(DIR), "1.2.3"));
    unregister(&h.loc).unwrap();
    assert_eq!(find(&h.loc), None);
    unregister(&h.loc).unwrap();
}
```

In `tests/support/mod.rs` change `Recorder` to record ARP calls:

```rust
pub struct Recorder { pub calls: Mutex<Vec<Call>>, pub arp: Mutex<Vec<Option<String>>>, pub result: Registration }

impl Recorder {
    pub fn new(result: Registration) -> Arc<Recorder> { Arc::new(Recorder { calls: Mutex::new(vec![]), arp: Mutex::new(vec![]), result }) }
}
```

and inside `impl Registrar for Recorder` add:

```rust
    fn arp(&self, _: &std::path::Path, version: Option<&str>, _: &Ctx) {
        self.arp.lock().unwrap().push(version.map(str::to_string));
    }
```

Append to `tests/update.rs`:

```rust
#[test]
fn an_update_refreshes_the_add_remove_entry_with_the_new_version() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let rec = support::Recorder::new(null_setup_core::registrations::Registration::Done);
    let mut o = opts(&w, &srv.base);
    o.reapply = true;
    o.registrar = rec.clone();
    run(|c| update(&o, c)).0.unwrap();
    assert_eq!(*rec.arp.lock().unwrap(), vec![Some("v2".to_string())]);
}
```

Append to `tests/manage.rs`:

```rust
#[test]
fn uninstall_removes_the_add_remove_entry_after_the_files() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let rec = support::Recorder::new(Registration::Done);
    let mut o = opts(&dir, false, &tmp.path().join("Null"));
    o.registrar = rec.clone();
    run(|c| uninstall(&o, c)).unwrap();
    assert!(!dir.join(".null-ide-install.json").exists());
    assert_eq!(*rec.arp.lock().unwrap(), vec![None]);
}

#[test]
fn a_foreign_folder_keeps_the_add_remove_entry() {
    let tmp = tempfile::tempdir().unwrap();
    let foreign = tmp.path().join("other");
    fs::create_dir_all(&foreign).unwrap();
    let rec = support::Recorder::new(Registration::Done);
    let mut o = opts(&foreign, false, &tmp.path().join("Null"));
    o.registrar = rec.clone();
    assert!(run(|c| uninstall(&o, c)).is_err());
    assert!(rec.arp.lock().unwrap().is_empty());
}
```

- [ ] **Step 2: Run to verify failure** — `cd setup && cargo test -p null-setup-core --test shell_arp` → unresolved module `arp`.

- [ ] **Step 3: Implement**

`setup/core/src/shell/arp.rs`:

```rust
//! The Add/Remove Programs entry (HKCU, so no elevation). Modify and Uninstall open the setup window on that page.

use std::path::{Path, PathBuf};

use super::{create, open, remove_tree, set, Locations};
use crate::error::{Error, Result};

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\NullIDE";

#[derive(Debug, PartialEq)]
pub struct Entry {
    pub install_dir: PathBuf,
    pub version: String,
}

fn command(install: &Path, intent: &str) -> String {
    let exe = install.join("setup").join("null-setup.exe");
    format!("\"{}\" wizard --install-dir \"{}\" --intent {intent}", exe.display(), install.display())
}

pub fn register(loc: &Locations, install: &Path, version: &str) -> Result<()> {
    let k = create(loc, KEY)?;
    set(&k, "DisplayName", "Null IDE")?;
    set(&k, "DisplayVersion", version.trim_start_matches('v'))?;
    set(&k, "Publisher", "Null IDE")?;
    set(&k, "InstallLocation", &install.display().to_string())?;
    set(&k, "DisplayIcon", &install.join("null.exe").display().to_string())?;
    set(&k, "UninstallString", &command(install, "uninstall"))?;
    set(&k, "ModifyPath", &command(install, "modify"))?;
    // Repair lives on the maintenance page; Windows' own Repair button would only repeat it.
    k.set_value("NoRepair", &1u32).map_err(|e| Error::Io { context: "write registry value \"NoRepair\"".into(), source: e })
}

pub fn find(loc: &Locations) -> Option<Entry> {
    let k = open(loc, KEY)?;
    let dir: String = k.get_value("InstallLocation").ok().filter(|d: &String| !d.is_empty())?;
    Some(Entry { install_dir: PathBuf::from(dir), version: k.get_value("DisplayVersion").unwrap_or_default() })
}

pub fn unregister(loc: &Locations) -> Result<()> {
    remove_tree(loc, KEY)
}
```

`registrations.rs`: add to the trait

```rust
    /// Add/Remove Programs entry: `Some(version)` writes or refreshes it, `None` removes it. Never fails the caller.
    fn arp(&self, _install: &Path, _version: Option<&str>, _ctx: &Ctx) {}
```

and to `impl Registrar for ShellRegistrar` (import `shell::arp` in the `use crate::{…}` list):

```rust
    fn arp(&self, install: &Path, version: Option<&str>, ctx: &Ctx) {
        let done = Locations::real().and_then(|loc| match version {
            Some(v) => arp::register(&loc, install, v),
            None => arp::unregister(&loc),
        });
        if let Err(e) = done {
            ctx.log.line(&format!("registrations: Add/Remove Programs entry: {e}"));
        }
    }
```

`update.rs` `finish()`: after the `let registration = …;` line add

```rust
    if o.reapply {
        o.registrar.arp(&o.install_dir, Some(&o.tag), ctx);
    }
```

`manage.rs` `uninstall_inner`: after `remove_install(&o.install_dir, !o.delete_user_data)?;` add

```rust
    // Last on purpose: if a file above could not be removed, the entry must stay so "Uninstall" can be run again.
    o.registrar.arp(&o.install_dir, None, ctx);
```

- [ ] **Step 4: Run** — `cargo test -p null-setup-core` (whole crate; the `Recorder` change touches many test files) → all pass.

- [ ] **Step 5: Commit**

```bash
git add setup/core
git commit -m "feat(setup): register Null IDE in Add/Remove Programs"
```

---

### Task 3: Core rules for the window (decide, fetch_install, WebView2, first-run save)

**Files:**
- Create: `setup/core/src/wizard.rs`, `setup/core/src/webview2.rs`
- Modify: `setup/core/src/lib.rs` (`pub mod wizard; pub mod webview2;`), `setup/core/src/builtins.rs` (Serialize), `setup/core/src/first_run.rs` (`save`), `setup/core/src/update.rs` (`is_empty_target` → `pub`)
- Test: `setup/core/tests/wizard.rs`, `setup/core/tests/webview2.rs` (new); `tests/builtins.rs`, `tests/first_run.rs` (append)

**Interfaces:**
- Consumes: `release::resolve_latest` (Task 1), `builtins::{parse, Manifest}`, `shell::arp::Entry` (only its dir, passed in as `Option<PathBuf>`), `http::Http`.
- Produces:
  - `wizard::Intent { Auto, Modify, Uninstall }` (`Clone, Copy, Debug, PartialEq`)
  - `wizard::Page { Install, Maintenance, Modify, Uninstall, Stale }` with `fn name(&self) -> &'static str` (`"install" | "maintenance" | "modify" | "uninstall" | "stale"`)
  - `wizard::Plan { page: Page, install_dir: PathBuf }`
  - `wizard::decide(intent: Intent, given: Option<PathBuf>, registered: Option<PathBuf>, is_ours: &dyn Fn(&Path) -> bool, default_dir: PathBuf) -> Result<Plan>`
  - `wizard::InstallView { tag: String, manifest: Option<Manifest> }`, `wizard::fetch_install(&Http, &str, &str) -> Result<InstallView>`
  - `webview2::installed() -> bool`, `webview2::usable_version(&str) -> bool`, `webview2::show_missing()`
  - `first_run::save(&Manifest, &FirstRun, &Path) -> Result<()>`
  - `Serialize` on `Builtin, Choice, SettingKind, SettingDef, MarketplaceExt, Manifest`
  - `update::is_empty_target(&Path) -> Result<bool>` public

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/wizard.rs`:

```rust
mod support;

use std::{path::{Path, PathBuf}, time::Duration};

use null_setup_core::{
    http::Http,
    wizard::{decide, fetch_install, Intent, Page},
    Error,
};
use serde_json::json;

const DEFAULT: &str = r"C:\Users\x\AppData\Local\Programs\Null IDE";
const MANIFEST: &str = r#"{"schema":1,"builtins":[{"id":"null-tools","label":"Tools","locked":true}]}"#;

fn p(s: &str) -> PathBuf { PathBuf::from(s) }
fn ours(set: &'static [&'static str]) -> impl Fn(&Path) -> bool { move |d| set.iter().any(|s| Path::new(s) == d) }

#[test]
fn nothing_installed_means_the_install_wizard_in_the_default_folder() {
    let plan = decide(Intent::Auto, None, None, &ours(&[]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Install, p(DEFAULT)));
}

#[test]
fn an_existing_install_shows_maintenance_instead_of_a_second_install() {
    let plan = decide(Intent::Auto, None, Some(p(r"D:\Null")), &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Maintenance, p(r"D:\Null")));
}

#[test]
fn a_stale_registration_does_not_block_a_fresh_install() {
    let plan = decide(Intent::Auto, None, Some(p(r"D:\Gone")), &ours(&[]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Install, p(DEFAULT)));
}

#[test]
fn a_given_folder_wins_over_the_registered_one() {
    let a = decide(Intent::Auto, Some(p(r"E:\New")), Some(p(r"D:\Null")), &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!((a.page, a.install_dir), (Page::Install, p(r"E:\New")));
}

#[test]
fn modify_and_uninstall_need_an_install() {
    let ok = decide(Intent::Modify, Some(p(r"D:\Null")), None, &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!(ok.page, Page::Modify);
    let ok = decide(Intent::Uninstall, None, Some(p(r"D:\Null")), &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!((ok.page, ok.install_dir), (Page::Uninstall, p(r"D:\Null")));
    assert!(decide(Intent::Modify, Some(p(r"D:\Other")), None, &ours(&[]), p(DEFAULT)).is_err());
    assert!(decide(Intent::Uninstall, None, None, &ours(&[]), p(DEFAULT)).is_err());
}

#[test]
fn uninstalling_a_registration_whose_folder_is_gone_offers_to_remove_just_the_entry() {
    let plan = decide(Intent::Uninstall, Some(p(r"D:\Gone")), Some(p(r"d:\gone\")), &ours(&[]), p(DEFAULT)).unwrap();
    assert_eq!(plan.page, Page::Stale); // case and trailing backslash do not matter
    // a folder that was never registered is an error, not something to "clean up"
    assert!(decide(Intent::Uninstall, Some(p(r"D:\Elsewhere")), Some(p(r"D:\Gone")), &ours(&[]), p(DEFAULT)).is_err());
}

#[test]
fn page_names_are_what_the_ui_switches_on() {
    let names: Vec<_> = [Page::Install, Page::Maintenance, Page::Modify, Page::Uninstall, Page::Stale].iter().map(Page::name).collect();
    assert_eq!(names, ["install", "maintenance", "modify", "uninstall", "stale"]);
}

fn release(base: &str, with_builtins: bool) -> Vec<u8> {
    let mut assets = vec![
        json!({ "name": "null-ide-win32-x64.zip", "browser_download_url": format!("{base}/zip"), "size": 5 }),
        json!({ "name": "null-ide-win32-x64.zip.sha256", "browser_download_url": format!("{base}/sha"), "size": 64 }),
    ];
    if with_builtins {
        assets.push(json!({ "name": "builtins.json", "browser_download_url": format!("{base}/builtins.json"), "size": 9 }));
    }
    json!({ "tag_name": "v3", "assets": assets }).to_string().into_bytes()
}

fn http() -> Http { Http::with_delay(Duration::from_millis(1)) }

#[test]
fn fetch_install_returns_the_tag_and_the_manifest_of_that_release() {
    let srv = support::serve(|req| match req.url.as_str() {
        "/repos/o/r/releases/latest" => (200, release(&req.base, true), vec![]),
        "/builtins.json" => (200, MANIFEST.as_bytes().to_vec(), vec![]),
        _ => (404, vec![], vec![]),
    });
    let v = fetch_install(&http(), &srv.base, "o/r").unwrap();
    assert_eq!(v.tag, "v3");
    assert_eq!(v.manifest.unwrap().builtins[0].id, "null-tools");
}

#[test]
fn a_release_without_builtins_json_still_installs_just_without_choices() {
    let srv = support::serve(|req| match req.url.as_str() {
        "/repos/o/r/releases/latest" => (200, release(&req.base, false), vec![]),
        _ => (404, vec![], vec![]),
    });
    let v = fetch_install(&http(), &srv.base, "o/r").unwrap();
    assert_eq!((v.tag.as_str(), v.manifest), ("v3", None));
}

#[test]
fn a_failing_manifest_download_is_an_error_not_a_silent_downgrade() {
    let srv = support::serve(|req| match req.url.as_str() {
        "/repos/o/r/releases/latest" => (200, release(&req.base, true), vec![]),
        _ => (500, vec![], vec![]),
    });
    assert!(matches!(fetch_install(&http(), &srv.base, "o/r"), Err(Error::Http { status: 500, .. })));
    let down = support::serve(|_| (404, vec![], vec![]));
    assert!(matches!(fetch_install(&http(), &down.base, "o/r"), Err(Error::Http { status: 404, .. })));
}
```

`setup/core/tests/webview2.rs`:

```rust
use null_setup_core::webview2::usable_version;

#[test]
fn only_a_real_version_counts_as_installed() {
    for no in ["", "  ", "0.0.0.0"] {
        assert!(!usable_version(no), "{no:?}");
    }
    assert!(usable_version("126.0.2592.87"));
}
```

Append to `tests/builtins.rs` (it already imports `builtins`; add `use serde_json::json;` if absent):

```rust
#[test]
fn the_manifest_serializes_in_the_shape_the_ui_reads() {
    let m = builtins::parse(r#"{"schema":1,"builtins":[{"id":"a","label":"A","requires":[]}],
        "settings":[{"key":"editor.fontSize","label":"S","kind":"number","default":13,"min":8,"max":40}],
        "marketplace":[]}"#).unwrap();
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(v["builtins"][0]["id"], "a");
    assert_eq!(v["builtins"][0]["default"], true);
    assert_eq!(v["settings"][0]["kind"], "number");
    assert_eq!(v["settings"][0]["min"], 8.0);
}
```

Append to `tests/first_run.rs`:

```rust
#[test]
fn save_validates_then_writes_and_skips_an_empty_set() {
    let m = manifest();
    let dir = tempfile::tempdir().unwrap();
    first_run::save(&m, &parse(r#"{"schema":1,"settings":{"files.autoSave":"off"}}"#), dir.path()).unwrap();
    assert!(dir.path().join(first_run::FILE).is_file());
    let empty = tempfile::tempdir().unwrap();
    first_run::save(&m, &FirstRun::default(), empty.path()).unwrap();
    assert!(!empty.path().join(first_run::FILE).exists());
    let bad = tempfile::tempdir().unwrap();
    assert!(first_run::save(&m, &parse(r#"{"schema":1,"settings":{"not.a.key":1}}"#), bad.path()).is_err());
    assert!(!bad.path().join(first_run::FILE).exists());
}
```

- [ ] **Step 2: Run to verify failure** — `cd setup && cargo test -p null-setup-core --test wizard` → unresolved module `wizard`.

- [ ] **Step 3: Implement**

`setup/core/src/lib.rs`: add `pub mod wizard;` and `pub mod webview2;` to the `pub mod` list.

`setup/core/src/wizard.rs`:

```rust
//! What the setup window shows, decided from the command line and from what is installed. No window code here.

use std::path::{Path, PathBuf};

use crate::{
    builtins::{self, Manifest},
    http::Http,
    release,
    Error, Result,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Intent { Auto, Modify, Uninstall }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Page {
    /// Nothing installed: the full wizard.
    Install,
    /// Installed: Modify / Repair / Uninstall.
    Maintenance,
    Modify,
    Uninstall,
    /// The Add/Remove Programs entry points at a folder that is gone.
    Stale,
}

impl Page {
    pub fn name(&self) -> &'static str {
        match self {
            Page::Install => "install",
            Page::Maintenance => "maintenance",
            Page::Modify => "modify",
            Page::Uninstall => "uninstall",
            Page::Stale => "stale",
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct Plan {
    pub page: Page,
    pub install_dir: PathBuf,
}

fn same(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().trim_end_matches('\\').to_lowercase();
    norm(a) == norm(b)
}

/// `given`: `--install-dir` from the command line. `registered`: the folder in Add/Remove Programs.
pub fn decide(intent: Intent, given: Option<PathBuf>, registered: Option<PathBuf>, is_ours: &dyn Fn(&Path) -> bool, default_dir: PathBuf) -> Result<Plan> {
    if intent == Intent::Auto {
        if let Some(d) = given.as_ref().or(registered.as_ref()).filter(|d| is_ours(d)) {
            return Ok(Plan { page: Page::Maintenance, install_dir: d.clone() });
        }
        return Ok(Plan { page: Page::Install, install_dir: given.unwrap_or(default_dir) });
    }
    let dir = given
        .or_else(|| registered.clone())
        .ok_or_else(|| Error::Other("no Null IDE install found".into()))?;
    if is_ours(&dir) {
        let page = if intent == Intent::Modify { Page::Modify } else { Page::Uninstall };
        return Ok(Plan { page, install_dir: dir });
    }
    if intent == Intent::Uninstall && registered.as_deref().is_some_and(|r| same(r, &dir)) {
        return Ok(Plan { page: Page::Stale, install_dir: dir });
    }
    Err(Error::Other(format!("no Null IDE install found in {}", dir.display())))
}

pub struct InstallView {
    pub tag: String,
    /// `None` only when the release has no `builtins.json` asset at all; a failed download is an `Err`.
    pub manifest: Option<Manifest>,
}

pub fn fetch_install(http: &Http, api_base: &str, repo: &str) -> Result<InstallView> {
    let latest = release::resolve_latest(http, api_base, repo)?;
    let manifest = match &latest.builtins_url {
        Some(url) => Some(builtins::parse(&http.get_text(url)?)?),
        None => None,
    };
    Ok(InstallView { tag: latest.release.tag, manifest })
}
```

`setup/core/src/webview2.rs`:

```rust
//! The setup window needs the WebView2 runtime (shipped with Windows 11 and Windows 10 22H2).

use winreg::{enums::*, RegKey};

const CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
pub const DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

/// "0.0.0.0" is what the runtime's updater leaves behind after an uninstall.
pub fn usable_version(pv: &str) -> bool {
    let v = pv.trim();
    !v.is_empty() && v != "0.0.0.0"
}

pub fn installed() -> bool {
    let probes = [
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{CLIENT}")),
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENT}")),
        (HKEY_CURRENT_USER, format!(r"Software\Microsoft\EdgeUpdate\Clients\{CLIENT}")),
    ];
    probes.iter().any(|(hive, path)| {
        RegKey::predef(*hive)
            .open_subkey(path)
            .and_then(|k| k.get_value::<String, _>("pv"))
            .is_ok_and(|pv| usable_version(&pv))
    })
}

/// Native dialog (there is no window to show anything else in); Yes opens the download page.
pub fn show_missing() {
    use windows::{
        core::{w, HSTRING},
        Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO},
    };
    let text = HSTRING::from(format!(
        "Null IDE Setup needs the Microsoft Edge WebView2 Runtime, which was not found on this PC.\n\nOpen the download page?\n{DOWNLOAD_URL}"
    ));
    let answer = unsafe { MessageBoxW(None, &text, w!("Null IDE Setup"), MB_YESNO | MB_ICONERROR) };
    if answer == IDYES {
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", DOWNLOAD_URL]).spawn();
    }
}
```

(If `MessageBoxW`'s generic parameters reject `&HSTRING` in the pinned `windows 0.62`, pass `PCWSTR(text.as_ptr())` instead — same behavior; `cargo check` in Step 4 tells.)

`builtins.rs`: change `use serde::Deserialize;` to `use serde::{Deserialize, Serialize};` and add `Serialize` to the derive list of `Builtin`, `Choice`, `SettingKind`, `SettingDef`, `MarketplaceExt` and `Manifest`.

`first_run.rs`: replace the tail of `save_from_file` and add `save`:

```rust
/// Checks `f` against the manifest and, when it holds anything, writes it to `dir`. Nothing is written on any error.
pub fn save(m: &Manifest, f: &FirstRun, dir: &Path) -> Result<()> {
    validate(m, f)?;
    if f.is_empty() {
        return Ok(());
    }
    write(dir, f)
}

/// Reads the choices file the caller gave and saves it against the `builtins.json` of the installed package.
pub fn save_from_file(install: &Path, file: &Path, dir: &Path) -> Result<()> {
    let f = from_json(&fs::read_to_string(file).ctx(format!("read {}", file.display()))?)?;
    let m = builtins::load(install)?
        .ok_or_else(|| Error::Other("this package has no builtins.json, so the first-run choices cannot be checked".into()))?;
    save(&m, &f, dir)
}
```

`update.rs`: `fn is_empty_target` → `pub fn is_empty_target`.

- [ ] **Step 4: Run** — `cargo test -p null-setup-core` → all pass (this also type-checks `webview2.rs`).

- [ ] **Step 5: Commit**

```bash
git add setup/core
git commit -m "feat(setup): core rules for the setup window (page decision, latest manifest, WebView2 check)"
```

---

### Task 4: Wizard mode and install-folder validation in the app's arguments

**Files:**
- Modify: `setup/app/src/args.rs`
- Test: same file's `#[cfg(test)]` module

**Interfaces:**
- Consumes: `null_setup_core::wizard::Intent`, `null_setup_core::local_app_data`.
- Produces: `Mode::Wizard`; `Args.intent: Intent`; `Args.install_dir_given: bool`; `pub fn check_install_dir(PathBuf) -> Result<PathBuf, String>` (absolute, not a drive root, no `;`/`%`, trailing `\` dropped). No arguments at all parse to `Mode::Wizard`.

- [ ] **Step 1: Write the failing tests** — append inside `mod tests` in `args.rs`:

```rust
    #[test]
    fn no_arguments_mean_the_wizard_in_the_default_folder() {
        let a = parse(std::iter::empty()).unwrap();
        assert_eq!((a.mode, a.intent, a.install_dir_given), (Mode::Wizard, Intent::Auto, false));
        assert!(a.install_dir.ends_with(r"Programs\Null IDE"));
    }

    #[test]
    fn the_wizard_takes_an_intent_and_an_optional_folder() {
        let a = p("wizard --install-dir C:\\x --intent uninstall").unwrap();
        assert_eq!((a.mode, a.intent, a.install_dir_given), (Mode::Wizard, Intent::Uninstall, true));
        assert_eq!(p("wizard --intent modify").unwrap().intent, Intent::Modify);
        assert!(p("wizard --intent bogus").is_err());
        assert!(p("wizard --install-dir C:\\a;b").is_err()); // a given folder is validated like everywhere else
        assert!(p("repair --install-dir C:\\x --intent modify").is_err()); // wizard only
    }

    #[test]
    fn check_install_dir_is_what_the_wizard_applies_to_a_typed_path() {
        assert_eq!(check_install_dir(PathBuf::from("C:\\Null IDE ünï\\")).unwrap().to_string_lossy(), "C:\\Null IDE ünï");
        for bad in ["Null", "C:\\", "C:\\a;b", "C:\\%TEMP%", ""] {
            assert!(check_install_dir(PathBuf::from(bad)).is_err(), "{bad:?}");
        }
    }
```

Change `use super::*;` is already there; add `Intent` to it by importing in the main module (Step 3).

- [ ] **Step 2: Run to verify failure** — `cd setup && cargo test -p null-setup args` → compile errors (`Mode::Wizard`, `intent`).

- [ ] **Step 3: Implement** in `args.rs`:

1. Imports/types:

```rust
use null_setup_core::wizard::Intent;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Mode { Prefetch, Update, Recover, Install, Modify, Repair, Uninstall, TrustCert, Wizard }
```

add to `Args`: `pub intent: Intent,` and `pub install_dir_given: bool,`.

2. New function above `parse` (moves the existing folder rules out of `parse`):

```rust
/// Rules for a folder Null IDE will be installed into; used for `--install-dir` and for the wizard's text field.
pub fn check_install_dir(install_dir: PathBuf) -> Result<PathBuf, String> {
    let raw = install_dir.to_string_lossy().into_owned();
    // ';' would split the user PATH entry and '%' would be expanded in it (REG_EXPAND_SZ).
    if raw.contains([';', '%']) {
        return Err("the install folder may not contain ';' or '%'".into());
    }
    // A trailing backslash would swallow the closing quote when the path is passed on to the elevated process.
    let install_dir = if install_dir.parent().is_some() { PathBuf::from(raw.trim_end_matches('\\')) } else { install_dir };
    // The working directory is changed before the work starts, so a relative path would mean something else than the caller meant.
    if !install_dir.is_absolute() || install_dir.parent().is_none() {
        return Err("the install folder must be an absolute path to a folder (not a drive root)".into());
    }
    Ok(install_dir)
}
```

3. In `parse`:
   - mode match: replace `Some("trust-cert") => Mode::TrustCert,` followed by the `other =>` arm with
     ```rust
        Some("trust-cert") => Mode::TrustCert,
        None | Some("wizard") => Mode::Wizard,
        other => {
            return Err(format!("unknown mode: {other:?} (expected wizard, prefetch, update, recover, install, modify, repair, uninstall or trust-cert)"))
        }
     ```
   - declare `let mut intent = None;` next to `first_run`, and add the flag arm `"--intent" => intent = Some(value("--intent")?),`
   - replace the block from `let install_dir = install_dir.ok_or("--install-dir is required")?;` through the `if !install_dir.is_absolute() … { return Err("--install-dir must be …") }` check with:
     ```rust
    let (install_dir, install_dir_given) = match (install_dir, mode) {
        (Some(d), _) => (check_install_dir(d).map_err(|e| format!("--install-dir: {e}"))?, true),
        // The wizard asks for the folder itself; the default is trusted, the typed one is checked when the job starts.
        (None, Mode::Wizard) => (null_setup_core::local_app_data().join("Programs").join("Null IDE"), false),
        (None, _) => return Err("--install-dir is required".into()),
    };
    let intent_given = intent.is_some();
    let intent = match intent.as_deref() {
        None | Some("auto") => Intent::Auto,
        Some("modify") => Intent::Modify,
        Some("uninstall") => Intent::Uninstall,
        Some(o) => return Err(format!("--intent must be auto, modify or uninstall, not {o:?}")),
    };
    if intent_given && mode != Mode::Wizard {
        return Err("--intent only applies to wizard".into());
    }
     ```
   - final struct literal: `Ok(Args { …, first_run, intent, install_dir_given })`.

- [ ] **Step 4: Run** — `cargo test -p null-setup args` → all pass, including the old tests (`a_trailing_backslash_is_dropped…`, `install_dirs_with_path_separators_or_percent_are_refused`, `paths_must_be_absolute…`). `main.rs` will not compile until Task 5 adds the `Mode::Wizard` arm — run only `--bin`-less tests? Use `cargo test -p null-setup args` after Task 5 if the compiler complains about the non-exhaustive match; to keep this task green on its own, add the temporary arm `Mode::Wizard => unreachable!("Task 5")` to the `match args.mode` in `main.rs` and to the `unreachable!` arm in `cli.rs::dispatch`.

- [ ] **Step 5: Commit**

```bash
git add setup/app/src
git commit -m "feat(setup): wizard mode and install-folder validation in the arguments"
```

---

### Task 5: The Tauri side of the wizard

**Files:**
- Create: `setup/app/src/wizard.rs`
- Modify: `setup/app/Cargo.toml`, `setup/app/src/cli.rs`, `setup/app/src/window.rs`, `setup/app/src/main.rs`
- Test: `#[cfg(test)]` in `wizard.rs` and `cli.rs`

**Interfaces:**
- Consumes: Task 3/4 items; `cli::dispatch`; `window::{Action, Channel, UiInteract}`.
- Produces (Tauri commands the UI calls): `wizard_load()` → emits `view` (View JSON) or `view-error` (string); `wizard_check_dir(path: String) -> Result<String, String>` (normalized path); `wizard_start(job: Job) -> Result<(), String>` → events `progress`, `locked`, `done {warning: string|null}`; `wizard_launch(dir: String)`; plus the shared `action(name)`, `diagnostics()`, `quit()`. `Job` JSON: `{ kind: "install"|"modify"|"repair"|"uninstall"|"removeEntry", installDir, config?, firstRun?, deleteData? }`. `View` JSON: `{ page, installDir, tag, version, manifest|null, config, userDataDir }`.
- Pure helpers (unit tested): `check_choices(Option<&Manifest>, &InstallConfig, Option<&FirstRun>) -> Result<(), String>`, `check_target_dir(&Path) -> Result<(), String>`, `claim(&AtomicBool) -> bool`; `cli::is_partial(&Error) -> bool`.

- [ ] **Step 1: Write the failing tests**

In `cli.rs`, append at the end:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_installed_but_messages_count_as_partial_success() {
        assert!(is_partial(&Error::Other("installed, but some registrations failed: x".into())));
        assert!(is_partial(&Error::Other("installed, but the first-run choices were not saved: x".into())));
        assert!(!is_partial(&Error::Other("registrations failed, the saved choices were not changed: x".into())));
        assert!(!is_partial(&Error::Busy));
    }
}
```

In the new `wizard.rs`, the test module (written together with the file in Step 3; the failing state is "file does not exist"):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const MANIFEST: &str = r#"{"schema":1,
      "builtins":[{"id":"core","label":"Core","locked":true},{"id":"a","label":"A"},{"id":"b","label":"B","requires":["a"]}],
      "settings":[{"key":"editor.fontSize","label":"Size","kind":"number","default":13,"min":8,"max":40}],
      "marketplace":[]}"#;

    fn m() -> Manifest { builtins::parse(MANIFEST).unwrap() }
    fn cfg(excluded: &[&str]) -> InstallConfig {
        InstallConfig { excluded_builtins: excluded.iter().map(|s| s.to_string()).collect(), ..InstallConfig::default() }
    }
    fn fr(text: &str) -> FirstRun { first_run::from_json(text).unwrap() }

    #[test]
    fn choices_are_checked_against_the_manifest_before_anything_is_downloaded() {
        assert!(check_choices(Some(&m()), &cfg(&[]), None).is_ok());
        assert!(check_choices(Some(&m()), &cfg(&["b"]), None).is_ok());
        assert!(check_choices(Some(&m()), &cfg(&["core"]), None).unwrap_err().contains("core"));       // locked
        assert!(check_choices(Some(&m()), &cfg(&["a"]), None).unwrap_err().contains("stays installed")); // b needs it
        assert!(check_choices(Some(&m()), &cfg(&["ghost"]), None).is_err());
        let bad = fr(r#"{"schema":1,"settings":{"editor.fontSize":99}}"#);
        assert!(check_choices(Some(&m()), &cfg(&[]), Some(&bad)).is_err());
        let good = fr(r#"{"schema":1,"settings":{"editor.fontSize":14}}"#);
        assert!(check_choices(Some(&m()), &cfg(&[]), Some(&good)).is_ok());
    }

    #[test]
    fn a_release_without_a_manifest_cannot_honor_choices_but_installs_with_none() {
        assert!(check_choices(None, &cfg(&[]), None).is_ok());
        assert!(check_choices(None, &cfg(&[]), Some(&FirstRun::default())).is_ok());
        assert!(check_choices(None, &cfg(&["a"]), None).is_err());
        assert!(check_choices(None, &cfg(&[]), Some(&fr(r#"{"schema":1,"settings":{"editor.fontSize":14}}"#))).is_err());
    }

    #[test]
    fn the_install_folder_must_be_empty_or_missing_and_not_already_an_install() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(check_target_dir(&tmp.path().join("new")).is_ok());
        assert!(check_target_dir(tmp.path()).is_ok()); // empty
        fs::write(tmp.path().join("x.txt"), "x").unwrap();
        assert!(check_target_dir(tmp.path()).unwrap_err().contains("not empty"));
        let ours = tmp.path().join("ours");
        fs::create_dir_all(&ours).unwrap();
        fs::write(ours.join(".null-ide-install.json"), "{}").unwrap();
        assert!(check_target_dir(&ours).unwrap_err().contains("already installed"));
    }

    #[test]
    fn a_second_job_cannot_start_while_one_runs() {
        let running = AtomicBool::new(false);
        assert!(claim(&running));
        assert!(!claim(&running));
        running.store(false, Ordering::SeqCst);
        assert!(claim(&running));
    }
}
```

- [ ] **Step 2: Run to verify failure** — `cd setup && cargo test -p null-setup` → `is_partial` not found.

- [ ] **Step 3: Implement**

`setup/app/Cargo.toml`: under `[dependencies]` add `serde = { version = "1", features = ["derive"] }`; add

```toml
[dev-dependencies]
tempfile = "3"
```

`cli.rs`:
- Change `fn dispatch(a: &Args, ctx: &Ctx) -> Result<()>` to `pub(crate) fn dispatch(…)`.
- Add above `pub fn run`:

```rust
/// The install itself worked; only something after it did not (registrations, saving the first-run choices).
/// The wizard reports these on the finish page instead of as a failure.
pub fn is_partial(e: &Error) -> bool {
    matches!(e, Error::Other(m) if m.starts_with("installed, but"))
}
```
- In `dispatch`'s last arm use `Mode::Prefetch | Mode::Update | Mode::Recover | Mode::TrustCert | Mode::Wizard => unreachable!("handled in main")`.

`window.rs` (share the plumbing; behavior of the update window must not change):
- `static FINISHED` / `static SWAPPING` → `pub static`.
- `enum Action { … }` → `pub enum Action`; `struct Channel(Mutex<mpsc::Sender<Action>>);` → `pub struct Channel(pub Mutex<mpsc::Sender<Action>>);`
- `fn action`, `fn diagnostics`, `fn quit` → `pub fn` (keep `#[tauri::command]`).
- `struct UiInteract<'a> { app: &'a AppHandle, rx: &'a mpsc::Receiver<Action> }` → `pub struct UiInteract<'a> { pub app: &'a AppHandle, pub rx: &'a mpsc::Receiver<Action> }`.
- Add:

```rust
/// From "Installing" on, closing the window would leave a half-installed app.
pub fn guard_close(_: &tauri::Window, ev: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
        if SWAPPING.load(Ordering::SeqCst) && !FINISHED.load(Ordering::SeqCst) {
            api.prevent_close();
        }
    }
}
```
- In `run_update` replace the whole `.on_window_event(|_, ev| { … })` call by `.on_window_event(guard_close)`.

`setup/app/src/wizard.rs`:

```rust
//! The setup window's backend. The rules live in `null_setup_core::wizard`; the work itself runs through
//! `cli::dispatch`, the same path as the headless modes, fed with the choices as temp files.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
};

use null_setup_core::{
    builtins::{self, Manifest},
    config, first_run::{self, FirstRun},
    http::Http,
    install_config::{self, InstallConfig},
    local_app_data,
    progress::{logs_dir, Ctx, Logger, Progress},
    shell::{arp, Locations},
    update, wizard as rules, Error,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    args::{check_install_dir, Args, Mode},
    cli,
    window::{self, Action, Channel, UiInteract},
};

const MARKER: &str = ".null-ide-install.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct View {
    page: &'static str,
    install_dir: String,
    /// The version that will be installed, or the installed one.
    tag: String,
    manifest: Option<Manifest>,
    config: InstallConfig,
    user_data_dir: String,
}

/// What `wizard_start` validates the UI's choices against.
struct Loaded {
    tag: String,
    manifest: Option<Manifest>,
}

struct Shared {
    args: Args,
    loaded: Mutex<Option<Loaded>>,
    running: AtomicBool,
    rx: Mutex<mpsc::Receiver<Action>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    kind: String,
    install_dir: String,
    config: Option<InstallConfig>,
    first_run: Option<FirstRun>,
    #[serde(default)]
    delete_data: bool,
}

#[derive(Serialize, Clone)]
struct Done {
    warning: Option<String>,
}

fn is_ours(d: &Path) -> bool { d.join(MARKER).is_file() }

fn claim(flag: &AtomicBool) -> bool { !flag.swap(true, Ordering::SeqCst) }

fn check_target_dir(dir: &Path) -> Result<(), String> {
    if is_ours(dir) {
        return Err(format!("Null IDE is already installed in {}", dir.display()));
    }
    match update::is_empty_target(dir) {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("{} is not empty; pick an empty folder", dir.display())),
        Err(e) => Err(e.to_string()),
    }
}

/// The same rules the install pipeline applies later, so a bad choice fails before the download starts.
fn check_choices(m: Option<&Manifest>, cfg: &InstallConfig, fr: Option<&FirstRun>) -> Result<(), String> {
    let Some(m) = m else {
        let presets = fr.is_some_and(|f| !f.settings.is_empty() || !f.extensions.is_empty());
        return if cfg.excluded_builtins.is_empty() && !presets {
            Ok(())
        } else {
            Err("this release has no builtins.json, so built-ins and settings cannot be chosen".into())
        };
    };
    let r = builtins::resolve(m, &cfg.excluded_builtins);
    if !r.notes.is_empty() {
        return Err(r.notes.join("; "));
    }
    if let Some(f) = fr {
        first_run::validate(m, f).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn load(args: &Args) -> Result<(View, Loaded), String> {
    let registered = Locations::real().ok().and_then(|l| arp::find(&l)).map(|e| e.install_dir);
    let given = args.install_dir_given.then(|| args.install_dir.clone());
    let plan = rules::decide(args.intent, given, registered, &is_ours, args.install_dir.clone()).map_err(|e| e.to_string())?;
    let user_data_dir = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default().join("Null").display().to_string();
    let install_dir = plan.install_dir.display().to_string();
    let page = plan.page.name();
    let (tag, manifest, config) = match plan.page {
        rules::Page::Install => {
            let v = rules::fetch_install(&Http::standard(), &update::api_base(), &args.repo).map_err(|e| e.to_string())?;
            (v.tag, v.manifest, InstallConfig::default())
        }
        rules::Page::Stale => (String::new(), None, InstallConfig::default()),
        rules::Page::Maintenance | rules::Page::Modify | rules::Page::Uninstall => {
            let meta = config::read(&plan.install_dir).map_err(|e| e.to_string())?;
            let manifest = builtins::load(&plan.install_dir).map_err(|e| e.to_string())?;
            let cfg = install_config::read(&plan.install_dir).map_err(|e| e.to_string())?;
            (meta.version, manifest, cfg)
        }
    };
    let loaded = Loaded { tag: tag.clone(), manifest: manifest.clone() };
    Ok((View { page, install_dir, tag, manifest, config, user_data_dir }, loaded))
}

#[tauri::command]
pub fn wizard_load(app: AppHandle, shared: State<Arc<Shared>>) {
    let shared = shared.inner().clone();
    std::thread::spawn(move || match load(&shared.args) {
        Ok((view, loaded)) => {
            *shared.loaded.lock().unwrap() = Some(loaded);
            let _ = app.emit("view", view);
        }
        Err(message) => {
            let _ = app.emit("view-error", message);
        }
    });
}

#[tauri::command]
pub fn wizard_check_dir(path: String) -> Result<String, String> {
    let dir = check_install_dir(PathBuf::from(path))?;
    check_target_dir(&dir)?;
    Ok(dir.display().to_string())
}

#[tauri::command]
pub fn wizard_launch(dir: String) -> Result<(), String> {
    let dir = check_install_dir(PathBuf::from(dir))?;
    if !is_ours(&dir) {
        return Err(format!("no Null IDE install found in {}", dir.display()));
    }
    update::launch_ide(&dir).map(|_| ()).map_err(|e| e.to_string())
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<PathBuf, String> {
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(path.to_path_buf())
}

/// Turns the UI's job into the `Args` the headless modes take, plus the temp folder holding its two files.
fn prepare(job: &Job, shared: &Shared) -> Result<(Args, PathBuf), String> {
    let dir = check_install_dir(PathBuf::from(&job.install_dir))?;
    let loaded = shared.loaded.lock().unwrap();
    let loaded = loaded.as_ref().ok_or("setup has not finished loading")?;
    let (mode, tag) = match job.kind.as_str() {
        "install" => (Mode::Install, loaded.tag.clone()),
        "modify" => (Mode::Modify, String::new()),
        "repair" => (Mode::Repair, String::new()),
        "uninstall" => (Mode::Uninstall, String::new()),
        other => return Err(format!("unknown job {other:?}")),
    };
    if mode == Mode::Install {
        check_target_dir(&dir)?;
    } else if !is_ours(&dir) {
        return Err(format!("no Null IDE install found in {}", dir.display()));
    }
    if matches!(mode, Mode::Install | Mode::Modify) {
        let cfg = job.config.as_ref().ok_or("the job has no choices")?;
        check_choices(loaded.manifest.as_ref(), cfg, job.first_run.as_ref().filter(|_| mode == Mode::Install))?;
    }
    let tmp = local_app_data().join("Null").join("updates").join(format!("wizard-{}", std::process::id()));
    fs::create_dir_all(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    let config = match (&job.config, mode) {
        (Some(c), Mode::Install | Mode::Modify) => Some(write_json(&tmp.join("install-config.json"), c)?),
        _ => None,
    };
    let first_run = match (&job.first_run, mode) {
        (Some(f), Mode::Install) => Some(write_json(&tmp.join("first-run.json"), f)?),
        _ => None,
    };
    let args = Args {
        mode,
        repo: shared.args.repo.clone(),
        tag,
        install_dir: dir,
        launch: false, // the finish page has a "Launch Null IDE" button
        config,
        force_close: false,
        delete_data: job.delete_data && mode == Mode::Uninstall,
        first_run,
        intent: rules::Intent::Auto,
        install_dir_given: true,
    };
    Ok((args, tmp))
}

fn work(app: AppHandle, shared: Arc<Shared>, log: Arc<Logger>, args: Args, tmp: PathBuf) {
    window::SWAPPING.store(false, Ordering::SeqCst);
    window::FINISHED.store(false, Ordering::SeqCst);
    let emit = |p: Progress| {
        if p == Progress::Installing {
            window::SWAPPING.store(true, Ordering::SeqCst);
        }
        let _ = app.emit("progress", &p);
    };
    let result = {
        let rx = shared.rx.lock().unwrap();
        let interact = UiInteract { app: &app, rx: &rx };
        let ctx = Ctx { progress: &emit, log: &log, interact: &interact };
        cli::dispatch(&args, &ctx)
    };
    let _ = fs::remove_dir_all(&tmp);
    match result {
        Ok(()) => {
            let _ = app.emit("done", Done { warning: None });
        }
        Err(e) if cli::is_partial(&e) => {
            log.line(&format!("finished with a warning: {e}"));
            let _ = app.emit("done", Done { warning: Some(e.to_string()) });
        }
        Err(Error::Busy) => {} // `Busy` was already emitted by the core; the page offers Close
        Err(e) => {
            log.line(&format!("failed: {e}"));
            emit(Progress::Failed { message: e.to_string(), log: log.path().map(|p| p.display().to_string()) });
        }
    }
    window::FINISHED.store(true, Ordering::SeqCst);
    shared.running.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn wizard_start(job: Job, app: AppHandle, shared: State<Arc<Shared>>, log: State<Arc<Logger>>) -> Result<(), String> {
    if job.kind == "removeEntry" {
        // Only an entry whose folder is gone; a live install keeps its entry.
        let loc = Locations::real().map_err(|e| e.to_string())?;
        if arp::find(&loc).is_some_and(|e| !is_ours(&e.install_dir)) {
            arp::unregister(&loc).map_err(|e| e.to_string())?;
        }
        let _ = app.emit("done", Done { warning: None });
        return Ok(());
    }
    let shared = shared.inner().clone();
    if !claim(&shared.running) {
        return Err("Setup is already working".into());
    }
    let (args, tmp) = match prepare(&job, &shared) {
        Ok(p) => p,
        Err(e) => {
            shared.running.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    let log = log.inner().clone();
    std::thread::spawn(move || work(app, shared, log, args, tmp));
    Ok(())
}

pub fn run(args: Args) -> i32 {
    let (tx, rx) = mpsc::channel::<Action>();
    let log = Arc::new(Logger::open(&logs_dir()));
    let shared = Arc::new(Shared { args, loaded: Mutex::new(None), running: AtomicBool::new(false), rx: Mutex::new(rx) });
    // The update window is the configured one; the wizard reuses it with its own page and size.
    let mut context = tauri::generate_context!();
    {
        let w = &mut context.config_mut().app.windows[0];
        w.url = tauri::WebviewUrl::App("wizard.html".into());
        w.title = "Null IDE Setup".into();
        w.width = 640.0;
        w.height = 520.0;
    }
    tauri::Builder::default()
        .manage(Channel(Mutex::new(tx)))
        .manage(log)
        .manage(shared)
        .invoke_handler(tauri::generate_handler![
            window::action,
            window::diagnostics,
            window::quit,
            wizard_load,
            wizard_check_dir,
            wizard_start,
            wizard_launch
        ])
        .on_window_event(window::guard_close)
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            Ok(())
        })
        .run(context)
        .expect("failed to start the setup window");
    0
}
```

(Append the `#[cfg(test)] mod tests` block from Step 1 at the end of the file.) `Shared` and `Job` are used as command parameter types, so mark `struct Shared`, `struct Job` `pub` if the compiler requires it for `#[tauri::command] pub fn` (private-type-in-public-interface); keep them module-private otherwise.

`main.rs`: add `mod wizard;`, and replace the temporary Wizard arm from Task 4 with:

```rust
        Mode::Wizard => {
            if !null_setup_core::webview2::installed() {
                null_setup_core::webview2::show_missing();
                std::process::exit(1);
            }
            let _ = std::env::set_current_dir(null_setup_core::local_app_data());
            relocate::maybe_relocate(&args); // started from <install>\setup (Add/Remove Programs): the swap or the deletion would hit our own exe
            wizard::run(args)
        }
```

and in the existing `Mode::Update` arm, before `relocate::maybe_relocate(&args);`, add the same three-line WebView2 check (spec: missing runtime → native dialog for every window mode).

- [ ] **Step 4: Run** — `cd setup && cargo test -p null-setup && cargo build -p null-setup` → unit tests pass, the app compiles. If `config_mut()` or `WebviewUrl::App` differ from the pinned Tauri 2.12 API, fix the type path here (`tauri::utils::config::WebviewUrl`); the fallback is to leave the config alone and call `w.navigate("tauri://localhost/wizard.html".parse().unwrap())` on the window in `setup` plus `set_size`/`set_title` — only fall back if the first form does not compile.

- [ ] **Step 5: Commit**

```bash
git add setup/app setup/Cargo.lock
git commit -m "feat(setup): wizard backend running the install pipeline through cli::dispatch"
```

---

### Task 6: Pure wizard rules (`wizard-model.js`) with tests

**Files:**
- Create: `setup/ui/wizard-model.js`, `setup/ui-tests/wizard-model.test.mjs`

**Interfaces (all top-level functions, global in the page):**
- `setBuiltin(builtins, excluded, id, on) -> { excluded: string[], blockedBy: string[] }`
- `defaultExcluded(builtins) -> string[]`
- `changedSettings(defs, values) -> object`
- `stepsFor(page, manifest) -> string[]`
- `buildJob(kind, s) -> object` where `s = { view, dir, config, excluded, settings, extensions, deleteData }`
- `summaryLines(s) -> string[]`
- `FEATURES` (const array of `[configKey, label, hint|null]`; a `const`, not a function — the test reads it through the context object)

- [ ] **Step 1: Write the failing tests** — `setup/ui-tests/wizard-model.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// wizard-model.js is a plain script; load it the way the page does and read its globals.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../ui/wizard-model.js', import.meta.url), 'utf8') + '\nthis.FEATURES = FEATURES;', ctx);
const plain = (x) => JSON.parse(JSON.stringify(x)); // arrays from the vm realm fail deepStrictEqual's prototype check

const B = (id, extra = {}) => ({ id, label: id.toUpperCase(), description: '', default: true, locked: false, requires: [], ...extra });
const chain = [B('core', { locked: true }), B('env'), B('fmt', { requires: ['env'] }), B('deep', { requires: ['fmt'] }), B('music')];

test('ticking a built-in ticks everything it needs, transitively', () => {
  const r = ctx.setBuiltin(chain, ['env', 'fmt', 'deep'], 'deep', true);
  assert.deepEqual(plain(r), { excluded: [], blockedBy: [] });
});

test('unticking a built-in that an included one needs is refused with the dependent named', () => {
  const r = ctx.setBuiltin(chain, [], 'env', false);
  assert.deepEqual(plain(r), { excluded: [], blockedBy: ['FMT'] });
});

test('unticking works once the dependents are off, and is idempotent', () => {
  let r = ctx.setBuiltin(chain, ['deep', 'fmt'], 'env', false);
  assert.deepEqual(plain(r).excluded, ['deep', 'fmt', 'env']);
  r = ctx.setBuiltin(chain, ['env'], 'env', false);
  assert.deepEqual(plain(r).excluded, ['env']);
});

test('core rows and unknown ids never change', () => {
  assert.deepEqual(plain(ctx.setBuiltin(chain, [], 'core', false)), { excluded: [], blockedBy: [] });
  assert.deepEqual(plain(ctx.setBuiltin(chain, [], 'nope', false)), { excluded: [], blockedBy: [] });
});

test('defaults leave off the default-off built-ins, except those an included one needs', () => {
  const list = [B('core', { locked: true }), B('a', { default: false }), B('b', { default: false }), B('c', { requires: ['b'] })];
  assert.deepEqual(plain(ctx.defaultExcluded(list)), ['a']); // b stays because c (default on) needs it
});

test('only settings that differ from the manifest default are sent', () => {
  const defs = [{ key: 'a', default: 13 }, { key: 'b', default: false }, { key: 'c', default: 'x' }];
  assert.deepEqual(plain(ctx.changedSettings(defs, { a: 13, b: true, d: 1 })), { b: true }); // unchanged and unknown keys dropped
  assert.deepEqual(plain(ctx.changedSettings(defs, {})), {});
  assert.deepEqual(plain(ctx.changedSettings(defs, { b: false })), {}); // a deliberate "false" equal to the default is still the default
});

test('pages with nothing to show are skipped', () => {
  const full = { builtins: [B('x')], settings: [{ key: 'k' }], marketplace: [{ id: 'p.q' }] };
  assert.deepEqual(plain(ctx.stepsFor('install', full)), ['welcome', 'options', 'builtins', 'marketplace', 'settings', 'summary']);
  assert.deepEqual(plain(ctx.stepsFor('install', { builtins: [], settings: [], marketplace: [] })), ['welcome', 'options', 'summary']);
  assert.deepEqual(plain(ctx.stepsFor('install', null)), ['welcome', 'options', 'summary']); // release without builtins.json
  assert.deepEqual(plain(ctx.stepsFor('modify', full)), ['options', 'builtins', 'summary']);
  assert.deepEqual(plain(ctx.stepsFor('maintenance', full)), []);
});

const state = (over = {}) => ({
  view: { manifest: { builtins: chain, settings: [{ key: 'editor.fontSize', label: 'Editor font size', default: 13, kind: 'number' }], marketplace: [] } },
  dir: 'C:\\Null', config: { schema: 1, path: true, contextMenu: false, excludedBuiltins: [] },
  excluded: ['music'], settings: {}, extensions: [], deleteData: false, ...over,
});

test('an install job carries the folder, the exclusions and only changed presets', () => {
  const j = plain(ctx.buildJob('install', state({ settings: { 'editor.fontSize': 16 } })));
  assert.equal(j.kind, 'install');
  assert.equal(j.installDir, 'C:\\Null');
  assert.deepEqual(j.config.excludedBuiltins, ['music']);
  assert.equal(j.config.contextMenu, false);
  assert.deepEqual(j.firstRun, { schema: 1, settings: { 'editor.fontSize': 16 }, extensions: [] });
});

test('an untouched settings page sends an empty preset set', () => {
  const j = plain(ctx.buildJob('install', state()));
  assert.deepEqual(j.firstRun.settings, {});
});

test('repair and uninstall carry no choices; uninstall carries the data flag; modify carries no presets', () => {
  assert.equal(ctx.buildJob('repair', state()).config, null);
  const u = plain(ctx.buildJob('uninstall', state({ deleteData: true })));
  assert.deepEqual([u.config, u.firstRun, u.deleteData], [null, null, true]);
  const m = plain(ctx.buildJob('modify', state()));
  assert.deepEqual([m.config.excludedBuiltins, m.firstRun], [['music'], null]);
});

test('the summary names every choice a person made', () => {
  const lines = plain(ctx.summaryLines(state({ settings: { 'editor.fontSize': 16 } })));
  assert.ok(lines.some((l) => l.includes('C:\\Null')));
  assert.ok(lines.some((l) => l.includes('MUSIC'))); // a left-out built-in is named
  assert.ok(lines.some((l) => l.includes('Editor font size') && l.includes('16')));
  assert.ok(lines.some((l) => l.includes('Explorer context menu') && l.includes('off')));
});

test('every config key the page offers exists on the Rust InstallConfig', () => {
  const rust = fs.readFileSync(new URL('../core/src/install_config.rs', import.meta.url), 'utf8');
  for (const [key] of ctx.FEATURES) {
    const snake = key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    assert.ok(rust.includes(`pub ${snake}: bool`), `${key} is not an InstallConfig field`);
  }
});
```

- [ ] **Step 2: Run to verify failure** — `node --test setup/ui-tests/` → ENOENT `wizard-model.js`.

- [ ] **Step 3: Implement** `setup/ui/wizard-model.js`:

```js
// Pure rules for the wizard. A plain script (no import/export): wizard.html loads it, and
// setup/ui-tests/wizard-model.test.mjs loads it through node:vm. Top-level `function`/`const` declarations only, no DOM.

const FEATURES = [
  ['desktopShortcut', 'Desktop shortcut', null],
  ['startMenuShortcut', 'Start Menu shortcut', null],
  ['safeModeShortcut', 'Start Menu shortcut for Safe Mode', null],
  ['path', 'Add "null" to PATH', 'So "null ." works in a terminal.'],
  ['contextMenu', 'Explorer context menu', 'The Windows 11 menu may ask for administrator approval once.'],
  ['fileAssociations', 'File associations', null],
  ['previewHandler', 'Preview pane in Explorer', null],
];

function builtinById(builtins, id) {
  return builtins.find((b) => b.id === id);
}

/** `id` and everything it needs, following `requires` (cycle-safe). */
function withRequirements(builtins, id) {
  const seen = [];
  const visit = (x) => {
    if (seen.includes(x)) return;
    seen.push(x);
    const b = builtinById(builtins, x);
    if (b) b.requires.forEach(visit);
  };
  visit(id);
  return seen;
}

/** Ticks or unticks one built-in. An untick that an included built-in needs is refused: `blockedBy` names the dependents. */
function setBuiltin(builtins, excluded, id, on) {
  const b = builtinById(builtins, id);
  if (!b || b.locked) return { excluded, blockedBy: [] };
  if (on) {
    const need = withRequirements(builtins, id);
    return { excluded: excluded.filter((x) => !need.includes(x)), blockedBy: [] };
  }
  const by = builtins.filter((o) => !excluded.includes(o.id) && o.requires.includes(id));
  if (by.length) return { excluded, blockedBy: by.map((o) => o.label) };
  return { excluded: excluded.includes(id) ? excluded : [...excluded, id], blockedBy: [] };
}

/** What a person gets with "recommended defaults": default-off built-ins, minus those an included one needs. */
function defaultExcluded(builtins) {
  let ex = builtins.filter((b) => !b.default && !b.locked).map((b) => b.id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of builtins) {
      if (ex.includes(b.id)) continue;
      for (const r of b.requires) {
        if (ex.includes(r)) {
          ex = ex.filter((x) => x !== r);
          changed = true;
        }
      }
    }
  }
  return ex;
}

/** Only values that differ from the manifest default are sent, so an untouched page writes nothing into first-run.json. */
function changedSettings(defs, values) {
  const out = {};
  for (const d of defs) {
    if (d.key in values && values[d.key] !== d.default) out[d.key] = values[d.key];
  }
  return out;
}

function stepsFor(page, manifest) {
  const has = (k) => Boolean(manifest && manifest[k] && manifest[k].length);
  if (page === 'install') {
    return ['welcome', 'options', has('builtins') && 'builtins', has('marketplace') && 'marketplace', has('settings') && 'settings', 'summary'].filter(Boolean);
  }
  if (page === 'modify') return ['options', has('builtins') && 'builtins', 'summary'].filter(Boolean);
  return [];
}

function buildJob(kind, s) {
  const withChoices = kind === 'install' || kind === 'modify';
  const manifest = s.view.manifest;
  return {
    kind,
    installDir: s.dir,
    config: withChoices ? { ...s.config, excludedBuiltins: s.excluded } : null,
    firstRun: kind === 'install' ? { schema: 1, settings: changedSettings(manifest ? manifest.settings : [], s.settings), extensions: s.extensions } : null,
    deleteData: Boolean(s.deleteData),
  };
}

function summaryLines(s) {
  const lines = [`Install folder: ${s.dir}`];
  for (const [key, label] of FEATURES) lines.push(`${label}: ${s.config[key] ? 'on' : 'off'}`);
  const manifest = s.view.manifest;
  if (manifest && manifest.builtins.length) {
    const off = s.excluded.map((id) => (builtinById(manifest.builtins, id) || { label: id }).label);
    lines.push(off.length ? `Built-in extensions left out: ${off.join(', ')}` : 'Built-in extensions: all');
  }
  if (manifest) {
    for (const [key, value] of Object.entries(changedSettings(manifest.settings, s.settings))) {
      const def = manifest.settings.find((d) => d.key === key);
      lines.push(`${def.label}: ${value}`);
    }
  }
  return lines;
}
```

- [ ] **Step 4: Run** — `node --test setup/ui-tests/` → all pass.

- [ ] **Step 5: Commit**

```bash
git add setup/ui/wizard-model.js setup/ui-tests
git commit -m "feat(setup): pure wizard rules (built-in dependencies, presets, job building)"
```

---

### Task 7: The wizard window (HTML, CSS, DOM script)

**Files:**
- Create: `setup/ui/wizard.html`, `setup/ui/wizard.css`, `setup/ui/wizard.js`

**Interfaces:**
- Consumes: Task 5's commands/events and Task 6's globals (`setBuiltin`, `defaultExcluded`, `stepsFor`, `buildJob`, `summaryLines`, `FEATURES`). No new exports; verification is a manual run (the DOM script has no unit tests by design — the logic that can be wrong lives in Task 6).

- [ ] **Step 1: Create `setup/ui/wizard.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Null IDE Setup</title>
  <link rel="stylesheet" href="wizard.css">
</head>
<body>
  <div id="app"></div>
  <script src="wizard-model.js"></script>
  <script src="wizard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `setup/ui/wizard.css`** (tokens from `DESIGN.md`; Signal Blue only on the primary button and focus):

```css
:root {
  --canvas: #181818; --panel: #202020; --control: #313131; --border: #2b2b2b; --border-control: #3c3c3c;
  --text: #cccccc; --text-2: #9d9d9d; --blue: #0078d4; --blue-hover: #026ec1; --error: #f85149; --warn: #cca700;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--canvas); color: var(--text); font: 13px/1.4 "Segoe UI", system-ui, sans-serif; }
#app { height: 100%; display: flex; flex-direction: column; }
header { padding: 20px 24px 12px; border-bottom: 1px solid var(--border); }
header .step { color: var(--text-2); font-size: 12px; }
h1 { margin: 2px 0 0; font-size: 18px; font-weight: 600; color: #fff; outline: none; }
.body { flex: 1; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
footer { display: flex; gap: 8px; align-items: center; padding: 12px 24px; border-top: 1px solid var(--border); background: var(--panel); }
footer .grow { flex: 1; }
p { margin: 0; }
.muted, small { color: var(--text-2); }
small { display: block; font-size: 12px; }
em { color: var(--text-2); font-style: normal; font-size: 12px; }
.note { color: var(--warn); }
.error { color: var(--error); word-break: break-word; }
.field { display: flex; flex-direction: column; gap: 4px; }
.list { display: flex; flex-direction: column; gap: 2px; }
.row { display: flex; gap: 10px; align-items: flex-start; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.row:hover { background: var(--panel); }
.row input { margin-top: 3px; }
input[type="text"], input[type="number"], select {
  background: var(--control); color: var(--text); border: 1px solid var(--border-control); border-radius: 4px; padding: 6px 8px; font: inherit;
}
button { background: var(--control); color: var(--text); border: 1px solid var(--border-control); border-radius: 4px; padding: 6px 14px; font: inherit; cursor: pointer; }
button:hover { background: var(--border-control); }
button.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
button.primary:hover { background: var(--blue-hover); }
button.danger { border-color: var(--error); color: var(--error); }
button.link { background: none; border: none; color: var(--text-2); padding: 6px 0; text-decoration: underline; }
button:disabled { opacity: .5; cursor: default; }
:focus-visible { outline: 1px solid var(--blue); outline-offset: 1px; }
progress { width: 100%; height: 6px; accent-color: var(--blue); }
ul.summary { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
[hidden] { display: none !important; }
```

- [ ] **Step 3: Create `setup/ui/wizard.js`**

```js
const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;
const app = document.getElementById('app');

// Same wording as main.js (the update window); a separate copy so the verified update page stays untouched.
const LABEL = {
  checking: 'Checking the release…',
  downloading: 'Downloading…',
  verifying: 'Verifying the download…',
  preparing: 'Preparing files…',
  waitingForClose: 'Waiting for Null IDE to close…',
  installing: 'Installing…',
  restarting: 'Starting Null IDE…',
  busy: 'Another setup or download is already running. Close it and try again.',
  needsReapproval: 'The Windows 11 context menu needs one-time administrator approval. Run Setup again and choose Modify to enable it.',
};
const mb = (n) => (n / 1048576).toFixed(1);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// phase: loading | error | maintenance | stale | uninstall | wizard | running | failed | done
const S = {
  phase: 'loading', view: null, steps: [], i: 0, kind: 'install', dir: '', config: null, initial: null,
  excluded: [], settings: {}, extensions: [], deleteData: false, note: '', error: '', progress: null, locked: null, done: null,
};

const TITLES = {
  welcome: 'Install Null IDE', options: 'Installation options', builtins: 'Built-in extensions',
  marketplace: 'Extensions from the marketplace', settings: 'A few settings', summary: 'Ready to install',
};

function load() {
  S.phase = 'loading';
  render();
  invoke('wizard_load');
}

listen('view', (e) => {
  const v = e.payload;
  S.view = v; S.dir = v.installDir; S.config = structuredClone(v.config); S.initial = structuredClone(v.config);
  S.excluded = v.page === 'install' && v.manifest ? defaultExcluded(v.manifest.builtins) : [...v.config.excludedBuiltins];
  S.settings = {}; S.extensions = []; S.deleteData = false; S.note = ''; S.i = 0;
  S.kind = v.page === 'modify' ? 'modify' : 'install';
  S.steps = stepsFor(v.page, v.manifest);
  S.phase = v.page === 'install' || v.page === 'modify' ? 'wizard' : v.page;
  render();
});
listen('view-error', (e) => { S.phase = 'error'; S.error = String(e.payload); render(); });
listen('progress', (e) => {
  S.progress = e.payload; S.locked = null;
  const was = S.phase;
  S.phase = e.payload.state === 'failed' ? 'failed' : 'running';
  was === 'running' && S.phase === 'running' ? patchRunning() : render();
});
listen('locked', (e) => { S.locked = e.payload; patchRunning(); });
listen('done', (e) => { S.done = e.payload; S.phase = 'done'; render(); });

function frame(title, sub, body, footer) {
  return [
    h('header', {}, sub ? h('div', { class: 'step' }, sub) : null, h('h1', { id: 'title', tabindex: '-1' }, title)),
    h('div', { class: 'body' }, body),
    h('footer', {}, footer),
  ];
}

function render() {
  const top = document.querySelector('.body')?.scrollTop ?? 0;
  const parts = {
    loading: () => frame('Null IDE Setup', '', h('p', { class: 'muted' }, 'Looking up the latest release…'), []),
    error: () => frame('Setup could not start', '', [h('p', { class: 'error' }, S.error), h('p', { class: 'muted' }, 'Check your internet connection and try again.')],
      [h('span', { class: 'grow' }), button('Close', quit), button('Retry', load, 'primary')]),
    maintenance: pageMaintenance, stale: pageStale, uninstall: pageUninstall, wizard: pageWizard,
    running: pageRunning, failed: pageFailed, done: pageDone,
  };
  app.replaceChildren(...parts[S.phase]());
  const body = document.querySelector('.body');
  if (body) body.scrollTop = top;
  document.getElementById('title')?.focus();
  if (S.phase === 'running') patchRunning();
}

const button = (label, onclick, cls) => h('button', { class: cls || '', onclick }, label);
const quit = () => invoke('quit');
const spacer = () => h('span', { class: 'grow' });

// ---- wizard pages ----

function pageWizard() {
  const step = S.steps[S.i];
  const last = S.i === S.steps.length - 1;
  const installing = S.view.page === 'install';
  const sub = `Step ${S.i + 1} of ${S.steps.length}`;
  const title = step === 'summary' ? (installing ? 'Ready to install' : 'Apply changes') : TITLES[step];
  const pages = { welcome: pageWelcome, options: pageOptions, builtins: pageBuiltins, marketplace: pageMarketplace, settings: pageSettings, summary: pageSummary };
  const footer = [
    installing && !last ? button('Use recommended defaults', useDefaults, 'link') : null,
    spacer(),
    S.i > 0 ? button('Back', () => { S.i--; S.note = ''; render(); }) : button('Cancel', quit),
    button(last ? (installing ? 'Install' : 'Apply') : 'Next', next, 'primary'),
  ];
  return frame(title, sub, [pages[step](), S.note ? h('p', { class: 'note' }, S.note) : null], footer);
}

function pageWelcome() {
  const v = S.view;
  return [
    h('p', {}, `This installs Null IDE ${v.tag} for your user account. No administrator rights are needed.`),
    h('p', { class: 'muted' }, 'Setup downloads the release, checks its SHA256 and installs it. Your settings and extensions are never touched.'),
    v.manifest ? null : h('p', { class: 'note' }, 'This release does not list its built-in extensions, so they cannot be chosen.'),
  ];
}

function pageOptions() {
  const c = S.config;
  const feature = ([key, label, hint]) =>
    h('label', { class: 'row' },
      h('input', { type: 'checkbox', checked: c[key], onchange: (e) => { c[key] = e.target.checked; } }),
      h('span', {}, label, hint ? h('small', {}, hint) : null));
  return [
    S.view.page === 'install'
      ? h('label', { class: 'field' }, 'Install folder',
          h('input', { id: 'dir', type: 'text', value: S.dir, spellcheck: 'false', oninput: (e) => { S.dir = e.target.value; S.note = ''; } }))
      : h('p', { class: 'muted' }, `Installed in ${S.dir}`),
    h('div', { class: 'list' }, FEATURES.map(feature)),
  ];
}

function pageBuiltins() {
  const bs = S.view.manifest.builtins;
  const label = (id) => (bs.find((b) => b.id === id) || { label: id }).label;
  return [
    h('p', { class: 'muted' }, 'Core extensions are always installed. Anything you leave out is not copied to disk; you can add it back later with Modify.'),
    h('div', { class: 'list' }, bs.map((b) =>
      h('label', { class: 'row' },
        h('input', {
          type: 'checkbox', checked: !S.excluded.includes(b.id), disabled: b.locked,
          onchange: (e) => {
            const r = setBuiltin(bs, S.excluded, b.id, e.target.checked);
            S.excluded = r.excluded;
            S.note = r.blockedBy.length ? `${b.label} is needed by ${r.blockedBy.join(', ')}. Turn that off first.` : '';
            render();
          },
        }),
        h('span', {}, b.label, b.locked ? h('em', {}, '  Core') : null,
          h('small', {}, b.description), b.requires.length ? h('small', {}, `Needs ${b.requires.map(label).join(', ')}`) : null)))),
  ];
}

function pageMarketplace() {
  return [
    h('p', { class: 'muted' }, 'Null IDE installs these the first time it starts.'),
    h('div', { class: 'list' }, S.view.manifest.marketplace.map((x) =>
      h('label', { class: 'row' },
        h('input', {
          type: 'checkbox', checked: S.extensions.includes(x.id),
          onchange: (e) => { S.extensions = e.target.checked ? [...S.extensions, x.id] : S.extensions.filter((i) => i !== x.id); },
        }),
        h('span', {}, x.label, h('small', {}, x.description))))),
  ];
}

function settingControl(d) {
  const cur = d.key in S.settings ? S.settings[d.key] : d.default;
  const set = (v) => { S.settings[d.key] = v; };
  if (d.kind === 'choice') {
    return h('select', { id: d.key, onchange: (e) => set(e.target.value) },
      d.options.map((o) => h('option', { value: o.value, selected: o.value === cur }, o.label)));
  }
  if (d.kind === 'bool') return h('input', { id: d.key, type: 'checkbox', checked: cur, onchange: (e) => set(e.target.checked) });
  if (d.kind === 'number') {
    return h('input', { id: d.key, type: 'number', value: cur, min: d.min, max: d.max,
      onchange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set(n); } });
  }
  return h('input', { id: d.key, type: 'text', value: cur, spellcheck: 'false', onchange: (e) => set(e.target.value) });
}

function pageSettings() {
  return [
    h('p', { class: 'muted' }, 'Optional. Anything you do not change keeps Null IDE\'s default, and everything else is in the normal Settings editor.'),
    ...S.view.manifest.settings.map((d) => h('div', { class: 'field' }, h('label', { for: d.key }, d.label), settingControl(d), d.description ? h('small', {}, d.description) : null)),
  ];
}

function pageSummary() {
  return [h('ul', { class: 'summary' }, summaryLines(S).map((l) => h('li', {}, l)))];
}

async function checkDir() {
  try {
    S.dir = await invoke('wizard_check_dir', { path: S.dir });
    S.note = '';
    return true;
  } catch (e) {
    S.note = String(e);
    return false;
  }
}

async function next() {
  if (S.steps[S.i] === 'options' && S.view.page === 'install' && !(await checkDir())) return render();
  if (S.i < S.steps.length - 1) { S.i++; S.note = ''; render(); } else run(S.kind);
}

async function useDefaults() {
  const m = S.view.manifest;
  S.config = structuredClone(S.initial);
  S.excluded = m ? defaultExcluded(m.builtins) : [];
  S.settings = {}; S.extensions = [];
  if (!(await checkDir())) { S.i = S.steps.indexOf('options'); return render(); }
  S.i = S.steps.length - 1;
  render();
}

// ---- maintenance, uninstall, stale ----

function pageMaintenance() {
  return frame('Null IDE is installed', `Version ${S.view.tag}`, [
    h('p', {}, `Installed in ${S.dir}`),
    h('p', { class: 'muted' }, 'Modify changes shortcuts, integrations and built-in extensions. Repair reinstalls this version with your current choices.'),
  ], [
    button('Uninstall…', () => { S.phase = 'uninstall'; render(); }, 'danger'), spacer(),
    button('Close', quit), button('Repair', () => run('repair')),
    button('Modify…', () => { S.kind = 'modify'; S.steps = stepsFor('modify', S.view.manifest); S.view = { ...S.view, page: 'modify' }; S.i = 0; S.phase = 'wizard'; render(); }, 'primary'),
  ]);
}

function pageUninstall() {
  return frame('Uninstall Null IDE', '', [
    h('p', {}, `This removes Null IDE from ${S.dir}, its shortcuts, context menu entries and PATH entry.`),
    h('p', { class: 'muted' }, 'Your settings, extensions and data in the Null user folder are kept, so a later reinstall picks up where you left off.'),
    h('label', { class: 'row' },
      h('input', { type: 'checkbox', checked: S.deleteData, onchange: (e) => { S.deleteData = e.target.checked; } }),
      h('span', {}, 'Also delete my settings, extensions and data', h('small', {}, S.view.userDataDir))),
  ], [spacer(), button('Cancel', quit), button('Uninstall', () => run('uninstall'), 'danger')]);
}

function pageStale() {
  return frame('Null IDE is no longer installed', '', [
    h('p', {}, `Windows still lists Null IDE, but ${S.dir} is gone.`),
    h('p', { class: 'muted' }, 'Remove the leftover entry from Apps & features?'),
  ], [spacer(), button('Cancel', quit), button('Remove entry', () => {
    S.kind = 'removeEntry';
    invoke('wizard_start', { job: { kind: 'removeEntry', installDir: S.dir } }).catch((e) => { S.error = String(e); S.phase = 'error'; render(); });
  }, 'primary')]);
}

// ---- running, failed, done ----

function run(kind) {
  S.kind = kind;
  const job = buildJob(kind, S);
  S.phase = 'running'; S.progress = { state: 'checking' }; S.locked = null;
  render();
  invoke('wizard_start', { job }).catch((e) => {
    S.phase = 'failed'; S.progress = { state: 'failed', message: String(e), log: null };
    render();
  });
}

const VERB = { install: 'Installing Null IDE', modify: 'Applying changes', repair: 'Repairing Null IDE', uninstall: 'Uninstalling Null IDE' };

function pageRunning() {
  return frame(VERB[S.kind] || 'Working', '', [
    h('p', { id: 'run-status' }, 'Starting…'),
    h('progress', { id: 'run-bar', max: '100', hidden: true }),
    h('p', { id: 'run-detail', class: 'muted' }),
    h('div', { id: 'run-locked', hidden: true },
      h('p', { id: 'run-locked-text', class: 'note' }),
      h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        button('Retry', () => answer('retry')), button('Close Null IDE', () => answer('force')), button('Cancel', () => answer('cancel')))),
  ], []);
}

function answer(name) { S.locked = null; patchRunning(); invoke('action', { name }); }

function patchRunning() {
  const status = document.getElementById('run-status');
  if (!status || S.phase !== 'running') return;
  const p = S.progress || { state: 'checking' };
  const bar = document.getElementById('run-bar');
  bar.hidden = p.state !== 'downloading';
  document.getElementById('run-detail').textContent = '';
  if (p.state === 'downloading') {
    bar.value = p.total ? (p.bytes / p.total) * 100 : 0;
    document.getElementById('run-detail').textContent = `${mb(p.bytes)} of ${mb(p.total)} MB (${mb(p.bytesPerSec)} MB/s)`;
  }
  status.textContent = LABEL[p.state] ?? p.state;
  document.getElementById('run-locked').hidden = !S.locked;
  if (S.locked) {
    document.getElementById('run-locked-text').textContent =
      `Null IDE is still running (${S.locked.join(', ')}). Save your work and close it, or use Close Null IDE.`;
  }
}

function pageFailed() {
  const p = S.progress;
  return frame('Setup did not finish', '', [
    h('p', { class: 'error' }, p.message),
    p.log ? h('p', { class: 'muted' }, `Log: ${p.log}`) : null,
  ], [
    spacer(), button('Copy diagnostics', copyDiagnostics), button('Close', quit),
    S.view.page === 'install' || S.view.page === 'modify' || S.kind === 'repair' || S.kind === 'uninstall' ? button('Retry', () => run(S.kind), 'primary') : null,
  ]);
}

async function copyDiagnostics(e) {
  await navigator.clipboard.writeText(await invoke('diagnostics'));
  e.target.textContent = 'Copied';
}

function pageDone() {
  const warning = S.done && S.done.warning;
  const text = {
    install: 'Null IDE is installed.', modify: 'Your changes are applied.', repair: 'Null IDE was repaired.',
    uninstall: 'Null IDE was removed.', removeEntry: 'The leftover entry was removed.',
  }[S.kind];
  const canLaunch = S.kind === 'install' || S.kind === 'repair' || S.kind === 'modify';
  return frame(warning ? 'Finished with a warning' : 'All done', '', [
    h('p', {}, text),
    warning ? h('p', { class: 'note' }, warning) : null,
    warning ? h('p', { class: 'muted' }, 'Run Setup again and choose Repair or Modify to retry the failed part.') : null,
    S.progress && S.progress.state === 'needsReapproval' ? h('p', { class: 'note' }, LABEL.needsReapproval) : null,
  ], [
    spacer(),
    warning ? button('Copy diagnostics', copyDiagnostics) : null,
    button('Close', quit, canLaunch ? '' : 'primary'),
    canLaunch ? button('Launch Null IDE', () => invoke('wizard_launch', { dir: S.dir }).then(quit).catch((e) => { S.note = String(e); }), 'primary') : null,
  ]);
}

load();
```

- [ ] **Step 4: Compile and smoke-test the window** — `cd setup && cargo build -p null-setup`, then run the freshly built exe from a copy outside the repo with a fake release (needs Task 8's `fake-release.mjs` change — do Task 8 Step 3 first, or use the real GitHub release): `.\target\debug\null-setup.exe` → the wizard appears at 640×520, "Looking up the latest release…" then the Welcome page. Click through to the summary without installing; close. Expected: no console errors (open DevTools is not available in release; use `cargo run` + right-click Inspect in debug builds).

- [ ] **Step 5: Commit**

```bash
git add setup/ui
git commit -m "feat(setup): the install / maintenance wizard window"
```

---

### Task 8: Publish the stub, keep Inno as a fallback, extend the fake release

**Files:**
- Modify: `installer/null-ide.iss` (line 22), `.github/workflows/build.yml`, `scripts/build-local.ps1`, `scripts/fake-release.mjs`

**Interfaces:** Release assets after this task: `NullIDESetup-<version>.exe` = the Rust stub (`null-setup.exe` copy), `NullIDEInno-<version>.exe` = the old Inno installer, plus the existing zip, sha256, `builtins.json`, REH tarballs, `install-null-ide.ps1`.

- [ ] **Step 1: Rename the Inno output** — `installer/null-ide.iss` line 22:

```
OutputBaseFilename=NullIDEInno-{#AppVersion}
```

- [ ] **Step 2: `build.yml`**
  - In step "Build Windows installer": replace `$expected = Join-Path $PWD "NullIDESetup-$version.exe"` with `"NullIDEInno-$version.exe"`, `-Filter "NullIDESetup*.exe"` with `-Filter "NullIDEInno*.exe"`, and both messages' `NullIDESetup*.exe` with `NullIDEInno*.exe`.
  - Directly after that step add:

```yaml
      - name: Stage the setup stub
        shell: pwsh
        run: |
          $version = '${{ github.ref_name }}'
          if ('${{ github.ref_type }}' -ne 'tag') {
            $version = '${{ steps.tag.outputs.tag }}'
          }
          # The same binary that ships inside the zip is the downloadable installer: with no install it shows the wizard.
          Copy-Item ide-overlay/setup/target/release/null-setup.exe "NullIDESetup-$version.exe" -Force
          Write-Host "Setup stub: NullIDESetup-$version.exe"
```

  - In both `files:` / `path:` lists (Publish release asset, Upload artifact) keep `NullIDESetup-*.exe` and add the line `NullIDEInno-*.exe` after it.
  - After the "Test null-setup" step add:

```yaml
      - name: Test setup UI rules
        shell: pwsh
        run: node --test ide-overlay/setup/ui-tests/
```

- [ ] **Step 3: `scripts/build-local.ps1`** (≈ line 848): change `-Filter "NullIDESetup*.exe"` to `-Filter "NullIDEInno*.exe"` and both `NullIDESetup*.exe` messages to `NullIDEInno*.exe`. After the `if (-not $SkipInstaller) { … }` block's closing brace of its `else`, add a stub copy so a local build produces the same two files:

```powershell
$stubSource = Join-Path $RepoRoot "setup/target/release/null-setup.exe"
if (Test-Path $stubSource) {
    Copy-Item $stubSource (Join-Path $WorkspaceDir "NullIDESetup-$buildVersion.exe") -Force
    Write-Host "Setup stub: NullIDESetup-$buildVersion.exe"
}
```

- [ ] **Step 4: `scripts/fake-release.mjs`** — support `GET /releases/latest` and an optional `builtins.json` asset so the stub can be exercised offline.
  - Header usage line: add `[--builtins <file>]`; after `let cutAfter` add `const builtinsFile = arg('builtins');`
  - Replace the route test `if (/^\/repos\/[^/]+\/[^/]+\/releases\/tags\//.test(req.url)) { if (!req.url.endsWith(\`/releases/tags/${tag}\`)) { … } …` with:

```js
  const isLatest = /^\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(req.url);
  if (isLatest || /^\/repos\/[^/]+\/[^/]+\/releases\/tags\//.test(req.url)) {
    if (!isLatest && !req.url.endsWith(`/releases/tags/${tag}`)) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    const assets = [
      { name, browser_download_url: `${base}/zip`, size },
      { name: `${name}.sha256`, browser_download_url: `${base}/zip.sha256`, size: 64 },
    ];
    if (builtinsFile) assets.push({ name: 'builtins.json', browser_download_url: `${base}/builtins.json`, size: fs.statSync(builtinsFile).size });
    return res.end(JSON.stringify({ tag_name: tag, html_url: base, body: 'fake release', assets }));
  }
  if (req.url === '/builtins.json' && builtinsFile) return res.end(fs.readFileSync(builtinsFile));
```

  (delete the old inline `res.end(JSON.stringify({ … }))` block that this replaces; keep the `/zip.sha256` and `/zip` routes as they are.)

- [ ] **Step 5: Verify** — `node --check scripts/fake-release.mjs`; `node scripts/gen-builtins.mjs $env:TEMP\b.json` (existing script) then `node scripts/fake-release.mjs --zip <any zip> --tag v9.9.9 --builtins $env:TEMP\b.json` and `curl http://127.0.0.1:8787/repos/o/r/releases/latest` returns JSON with three assets. `node --test scripts/gen-builtins.test.mjs setup/ui-tests/` still passes. Do **not** run `build-local.ps1`.

- [ ] **Step 6: Commit**

```bash
git add installer/null-ide.iss .github/workflows/build.yml scripts/build-local.ps1 scripts/fake-release.mjs
git commit -m "ci: publish the Rust stub as NullIDESetup-<version>.exe and keep Inno as NullIDEInno"
```

---

### Task 9: Runbook, docs and the whole-tree check

**Files:**
- Create: `docs/specs/null-setup-wizard-runbook.md`
- Modify: `CLAUDE.md` (the `### setup/ (null-setup)` section), `docs/specs/null-setup-installer-design.md` (sequencing line for 2c-2)

- [ ] **Step 1: Write the runbook** — `docs/specs/null-setup-wizard-runbook.md`:

```markdown
# Null Setup wizard: manual test runbook (2c-2)

Run on Windows 11 and Windows 10 22H2, from a copy of `null-setup.exe` outside any install (e.g. `C:\Temp\stub\null-setup.exe`). Use `scripts/fake-release.mjs --zip <package.zip> --tag v9.9.9 --builtins <builtins.json>` and start the stub from a terminal with `$env:NULL_SETUP_API_BASE='http://127.0.0.1:8787'`. Record results in the PR.

| # | Scenario | Expected |
|---|---|---|
| 1 | No install; start the stub with no arguments | Wizard, Welcome shows the fake tag |
| 2 | "Use recommended defaults" on page 1 | Jumps to Summary; Install installs with all defaults; Finish offers Launch |
| 3 | Options: untick Start Menu shortcut, folder `C:\Temp\Null IDE ünï` | Folder accepted; no Start Menu shortcut after install |
| 4 | Folder `C:\Windows`, a non-empty folder, `C:\`, `C:\a;b` | Each rejected on Next with a sentence; nothing downloaded |
| 5 | Built-ins: tick Format with Env off; untick Env with Format on | Env ticks itself; the untick is refused naming Format |
| 6 | Built-ins left out | Those folders are absent under `resources\app\extensions` |
| 7 | Settings page: change font size to 16, leave the rest | `%APPDATA%\Null\null-setup\first-run.json` holds only `editor.fontSize`; the IDE applies it once |
| 8 | Settings page untouched | No `first-run.json` |
| 9 | Network off at start | Error page with Retry; Retry works after reconnecting |
| 10 | Release served without `builtins.json` (omit `--builtins`) | Built-ins and Settings pages hidden; install works |
| 11 | Start the stub again with an install present | Maintenance page, not a second install |
| 12 | Maintenance → Modify: change a built-in with the IDE running | "Null IDE is still running" panel with Retry / Close Null IDE / Cancel |
| 13 | Maintenance → Repair | Reinstalls; Finish page |
| 14 | Settings → Apps → Null IDE → Modify, and → Uninstall | Window opens on the Modify / Uninstall page of that install |
| 15 | Uninstall, box unticked | App, shortcuts, PATH entry and Apps entry gone; `%APPDATA%\Null` kept |
| 16 | Uninstall, box ticked | `%APPDATA%\Null` gone too |
| 17 | Delete the install folder by hand, then Apps → Uninstall | "no longer installed" page; Remove entry clears the Apps entry |
| 18 | Kill the window during "Installing" (Task Manager) | Next start: `recover` completes or rolls back (see the engine runbook) |
| 19 | Rename `msedgewebview2` runtime away / machine without WebView2 | Native dialog with the download link, no window |
| 20 | Double-click Install quickly | One job only |
```

- [ ] **Step 2: Update `CLAUDE.md`** — in the `### setup/ (null-setup)` section, after the "First-run hand-over (sub-project 2c-1)" paragraph add:

```markdown
Wizard (sub-project 2c-2): `NullIDESetup-<version>.exe` is a copy of `null-setup.exe`; with no arguments it opens the wizard (`Mode::Wizard`), which installs the newest stable release (`release::resolve_latest`, `builtins.json` asset as the manifest; a release without that asset hides the built-in and settings pages, a failed download shows an error page with Retry). Rules that need no window are in `core` (`wizard::decide` picks Install / Maintenance / Modify / Uninstall / Stale from `--intent` and the Add/Remove Programs entry; `webview2`; `shell::arp`); the window (`app/src/wizard.rs`, `ui/wizard*.{html,css,js}`) only collects choices and runs them through `cli::dispatch`, the same path as the headless modes, with the choices as temp files. `ui/wizard-model.js` holds the testable rules (`node --test setup/ui-tests/`). The Add/Remove Programs key `HKCU\…\Uninstall\NullIDE` is written by every successful install/repair/update (`Registrar::arp`) and removed last by uninstall; its Modify/Uninstall commands are `"<install>\setup\null-setup.exe" wizard --install-dir "<dir>" --intent modify|uninstall`. Missing WebView2 shows a native dialog. The Inno installer is still built, now as `NullIDEInno-<version>.exe`, until 2c-3. Plan `docs/plans/null-setup-wizard.md`; runbook `docs/specs/null-setup-wizard-runbook.md`.
```

and change the earlier sentence "`install-null-ide.ps1` is no longer called by `null-setup` but is still shipped for Inno and the README one-liner until 2c deletes it with Inno." to end "until 2c-3 deletes it with Inno." Also update the "Releases publish a portable ZIP and an Inno Setup installer to GitHub Releases" bullet to "a portable ZIP and the setup stub (`NullIDESetup-<version>.exe`; the Inno installer remains as `NullIDEInno-<version>.exe` until 2c-3)", and build-step 12 likewise.

In `docs/specs/null-setup-installer-design.md` change the 2c-2 bullet to start `- **2c-2 wizard and stub installer** (\`docs/plans/null-setup-wizard.md\`):`.

- [ ] **Step 3: Whole-tree check** — from `setup/`: `cargo test --locked -p null-setup-core -p null-setup` and `cargo build --release --locked -p null-setup` (the two CI commands); from the repo root: `node --test setup/ui-tests/ scripts/gen-builtins.test.mjs`. All green. Then run runbook rows 1–6 and 11 by hand on the release build (the rest are for the release PR); note anything skipped.

- [ ] **Step 4: Refresh the graph and commit**

```bash
graphify update .
git add docs CLAUDE.md
git commit -m "docs: wizard runbook and setup notes for slice 2c-2"
```

---

## Self-review (done while writing)

- **Spec coverage ("Wizard flow" 1–7):** Welcome (T7 `pageWelcome`), options incl. directory/shortcuts/PATH/context menu/associations/preview/Safe Mode (T7 `pageOptions` over `FEATURES`, T6), built-ins with locks/requires/block (T6, T7), marketplace hidden when empty (T6 `stepsFor`), settings page from the manifest (T7), summary + "Use recommended defaults" on every page before the last (T7 `useDefaults`; hidden on the summary page itself because the user is already there), progress + Finish with Launch (T5 `done`, T7). `modify` pre-filled (T5 `load`, T7). Uninstall page with the unchecked delete box (T7). Add/Remove Programs entry (T2). Stub published as `NullIDESetup-<version>.exe` (T8). Missing WebView2 dialog (T3, T5). Disk-space, checksum, locked-file and retry behavior are inherited from the pipeline (`cli::dispatch`) and surface through `progress`/`locked`/`Failed` events.
- **Not in this plan, by the spec's own slicing:** `Null: Setup`, deleting Inno/PowerShell/`updater/`, README, `build-local.ps1` Inno removal, Win10 matrix sign-off → 2c-3. The "Windows 10 22H2" column of the runbook is filled in then.
- **Type consistency:** `Intent`/`Page`/`Plan`/`decide` (T3) are used verbatim in T4/T5; `Args.intent`/`install_dir_given` (T4) are read in `wizard::load` (T5); event names `view`, `view-error`, `progress`, `locked`, `done` and command names are identical in T5 and T7; `Job` JSON keys (`kind`, `installDir`, `config`, `firstRun`, `deleteData`) match `buildJob` (T6); `View` keys (`page`, `installDir`, `tag`, `manifest`, `config`, `userDataDir`) match what `wizard.js` reads (`page` is the `Page::name()` string); `FEATURES` config keys are pinned to `install_config.rs` by a test.
- **Placeholders:** none. Two compile-time API checks are called out where the pinned crate versions decide the exact spelling (`MessageBoxW` text parameter, `config_mut()` window fields), each with the fallback.
