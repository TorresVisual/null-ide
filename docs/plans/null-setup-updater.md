# Null Setup, Sub-project 1: Updater Reliability Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the C++ `updater/`, `scripts/update-null-ide.ps1` and the TypeScript staging code with one tested Rust pipeline (`null-setup.exe`: `prefetch`, `update`, `recover`) that verifies, swaps with a journal, and rolls back, and make `null-tools` delegate to it.

**Architecture:** New Rust workspace `setup/` with `core` (library, no UI, `cargo test`) and `app` (Tauri 2 shell: headless `prefetch`/`recover`, a small progress window for `update`). `null-tools` keeps only the release check, spawns `null-setup prefetch` in the background and `null-setup update` on the user's click, and writes a ready marker after an update. Registrations (context menu, file associations, preview handler) still run through the shipped `install-null-ide.ps1 -ReapplyRegistrations` until sub-project 2 ports them to Rust.

**Tech Stack:** Rust (`ureq` 2, `sha2`, `zip` 2, `sysinfo` 0.30, `serde`, `thiserror`, Tauri 2; dev: `tiny_http`, `tempfile`), TypeScript (`null-tools`, `node --test`), PowerShell (one `-NoElevate` switch), GitHub Actions YAML.

**Spec:** `docs/specs/null-setup-installer-design.md` (this plan is its "Sub-project 1: updater reliability"; sub-project 2 gets its own plan)

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

- Supported Windows: Windows 11 and Windows 10 22H2 (both ship WebView2). No WebView2 bootstrapper, no console fallback.
- Nothing is code-signed. SHA256 only guards against corruption or truncation.
- Stable releases only: `releases/latest`, no prerelease channel (`-IncludePrerelease` is dropped).
- `update` and `repair` never elevate. Only a fresh install or `modify` (sub-project 2) may start the elevated certificate import.
- Nothing installs silently: `prefetch` only downloads; `update` starts only from an explicit click.
- The installer never writes inside `%APPDATA%\Null\User\` and never touches extension state.
- Paths: installed copy `<installDir>\setup\null-setup.exe`; cache `%LOCALAPPDATA%\Null\updates\<version>\`; log `%LOCALAPPDATA%\Null\logs\setup-<timestamp>.log`; `<installDir>\.null-ide-install.json` keeps its fields (`version`, `repo`, `installedAt`, `installDir`) so null-tools keeps reading it.
- Network: 3 attempts with backoff; 4xx fails at once and names the status and URL. Checksum or size mismatch: delete the partial file, retry once, then fail with expected and actual hashes in the log.
- Never kill `null.exe` without an explicit button; locked files show a visible wait with the blocking process names.
- Editing rules from `CLAUDE.md`: edit TypeScript sources only, never `out/`; after editing `extensions/null-tools/src/` run `npm run compile` and commit the refreshed `out/` as `chore: refresh null-tools compiled output`; a new `*.test.js` is skipped until added to `package.json`'s `test` script.
- Do not run `scripts/build-local.ps1`; edit it only. Work only inside `D:\Coding\Apps\null-ide\`.
- Commit per task with the repo style (`feat(setup): …`, `fix(null-tools): …`, `chore: …`). Do not push.
- Rust code in this plan was written without a compiler: if a crate's minor-version API differs, adjust the call, keep the behavior and the tests.

## Review Focus

Most likely first. Each line is pinned by a test in the task named in brackets.

1. A zip with `../evil.txt`, an absolute path or backslash entries must be rejected or confined; nothing is written outside the staging dir. [Task 7]
2. GitHub 403/429/404 for the tag, or a 5xx that recovers: the error names status and URL, 4xx is not retried, 5xx/429 are. [Task 4]
3. A `.part` file larger than the asset, a server that ignores `Range`, or answers 416: the download restarts cleanly instead of corrupting the zip. [Task 5]
4. An install directory with spaces and non-ASCII characters (`…\Null IDE ünï`): swap, journal and registration script all work. [Task 10]
5. A second IDE window opening during an update (journal `Started`) must not roll the update back; two concurrent `prefetch`/`update` calls must not delete each other's download. [Tasks 5, 8, 13]

## File Structure

```
setup/
├── Cargo.toml                    # workspace: core, app
├── Cargo.lock                    # committed (CI uses --locked)
├── core/
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs                # module list, local_app_data()
│   │   ├── error.rs              # Error, Result, IoCtx
│   │   ├── progress.rs           # Progress, Logger, Ctx, Interact, logs_dir
│   │   ├── config.rs             # .null-ide-install.json read/write, iso_utc
│   │   ├── http.rs               # Http: retry/backoff, GitHub JSON
│   │   ├── release.rs            # resolve exact tag → zip + sha256 sidecar
│   │   ├── disk.rs               # free-space check
│   │   ├── download.rs           # Cache, Lock, resumable verified fetch
│   │   ├── procs.rs              # running null.exe in a dir, close, is_under
│   │   ├── extract.rs            # zip → staging dir (zip-slip safe)
│   │   ├── swap.rs               # journaled swap, commit, rollback, recover
│   │   ├── shellext.rs           # unload the Explorer-held shell DLL
│   │   ├── registrations.rs      # runs install-null-ide.ps1 -ReapplyRegistrations -NoElevate
│   │   └── update.rs             # prefetch(), update() orchestration
│   └── tests/
│       ├── support/mod.rs        # local HTTP server, zip builder
│       └── {http,release,download,procs,extract,swap,update}.rs
├── app/
│   ├── Cargo.toml  build.rs  tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/icon.ico            # copy of icons/icon.ico
│   └── src/{main,args,headless,relocate,window}.rs
└── ui/{index.html,main.js,style.css}   # no bundler; Tauri global API
scripts/fake-release.mjs          # local GitHub-API stand-in for the manual matrix
extensions/null-tools/src/updateStatus.ts (+ .test.ts)   # pure: parse progress, status text, tag check
extensions/null-tools/src/updater.ts, updaterIntegration.ts   # rewritten thin
docs/specs/updater-root-cause.md  # Task 1 output
```

---

### Task 1: Reproduce the failure and record the root cause (gate)

**Files:**
- Create: `docs/specs/updater-root-cause.md`

**Interfaces:**
- Produces: a written verdict, either **contained bug** (Task 2 runs) or **architecture** (skip Task 2). Tasks 8 and 9 rely on hypothesis H2 (Explorer holds the shell DLL); if the evidence contradicts it, say so in the doc and drop `shellext.rs` (Task 9 step 5–6).

- [ ] **Step 1: Read what the reporters saw**

```bash
gh issue view 12 --comments
gh issue view 120 --comments
```
Copy the reported error text, Windows version and Null IDE version into the doc.

- [ ] **Step 2: Collect evidence on a real install**

On the machine that updates from an old version: open the Output panel → "Null IDE Updates" and copy the last update attempt. Then list leftovers:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Programs" -Force | Where-Object Name -like '*null-ide-*'
Get-ChildItem "$env:TEMP" -Filter 'null-ide-update*' -Force
Get-Content "$env:LOCALAPPDATA\Programs\Null IDE\.null-ide-install.json"
```

- [ ] **Step 3: Test each hypothesis, record result (confirmed / refuted / untested) with the evidence**

- **H1 staging race.** `stageUpdateInBackground` (`extensions/null-tools/src/updater.ts:290-328`) calls `fs.rmSync(stagingRoot())` on every check while another window or check may still be writing the zip. Look for `Background staging failed: EBUSY|EPERM|ENOENT` in the Output log, and for a staged zip that is missing or truncated when "Update Now" ran.
- **H2 Explorer holds the shell DLL.** With the Win11 context menu registered and a folder right-clicked once in Explorer (so Explorer loaded `null_explorer_command.dll` from the install dir), close Null IDE and run:
  ```powershell
  tasklist /m null_explorer_command.dll
  Rename-Item "$env:LOCALAPPDATA\Programs\Null IDE" "Null IDE.test"
  ```
  A rename failure (access denied / in use) while `explorer.exe` is listed confirms H2. Restart Explorer (`Stop-Process -Name explorer -Force`), repeat; success shows Explorer was the blocker. Rename back.
- **H3 version metadata mismatch.** `.null-ide-install.json` `version` vs the latest tag. Check what non-tag CI builds stamp (`steps.tag.outputs.tag` in `.github/workflows/build.yml`) and run:
  ```bash
  node -e "const {compareVersionTags:c}=require('./extensions/null-tools/out/versionComparison');console.log(c('<latest tag>','<installed version>'))"
  ```
  A result `<= 0` while a newer release exists reproduces "never updates".
- **H4 updater exe gives up.** `updater/src/main.cpp:383-397` waits only 15 s for the IDE to exit, then the rename retries (10 × 500 ms) run against a still-locked directory. Check whether the failure dialog from `null-updater.exe` appeared (reporters' words).

- [ ] **Step 4: Write the verdict**

Create `docs/specs/updater-root-cause.md` with: reported symptoms, evidence per hypothesis, the confirmed cause(s), and one line: `Verdict: contained bug (hotfix Task 2)` or `Verdict: architecture (skip Task 2)`. If H2 is refuted, also write `shellext.rs not needed`.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/updater-root-cause.md
git commit -m "docs: record root cause of the updater failures (#12, #120)"
```

---

### Task 2: Hotfix on the current path (only if Task 1 says "contained bug" and H1 is confirmed)

Skip this task if the verdict is "architecture", or if the confirmed cause is not H1; in the latter case write the one-line fix for the confirmed cause into the root-cause doc, apply it the same way (smallest change in `updater.ts`), and continue.

**Files:**
- Modify: `extensions/null-tools/src/updater.ts:286-328`
- Modify (generated): `extensions/null-tools/out/updater.js` via compile

**Interfaces:**
- Consumes: nothing. This code is deleted in Task 14; keep the change minimal.

- [ ] **Step 1: Stop deleting the shared staging root and guard re-entry**

In `stageUpdateInBackground`, add a module-level guard and a per-process directory. Replace the body from `try {` through the `fs.mkdirSync` line:

```ts
let stagingVersion: string | undefined;   // version being downloaded in this extension host

async function stageUpdateInBackground(context: vscode.ExtensionContext, update: AvailableUpdate): Promise<void> {
  if (!update.assetUrl || !update.assetName) return;
  if (stagingVersion === update.latest) return;   // a download for this version is already running

  const existing = context.globalState.get<StagedUpdate>('null.stagedUpdate');
  if (existing?.version === update.latest && existing.verified && fs.existsSync(existing.zipPath)) {
    return; // already staged and verified
  }

  stagingVersion = update.latest;
  try {
    // Per-process directory: another window's download must never be deleted from under it.
    const versionDir = path.join(stagingRoot(), `${update.latest}-${process.pid}`);
    fs.rmSync(versionDir, { recursive: true, force: true });
    fs.mkdirSync(versionDir, { recursive: true });
```
and at the end of the function replace the final `catch` block with:

```ts
  } catch (err) {
    output.appendLine(`Background staging failed: ${(err as Error).message}`);
  } finally {
    stagingVersion = undefined;
  }
```

- [ ] **Step 2: Compile and run the existing tests**

Run: `cd extensions/null-tools && npm run compile && npm test`
Expected: compile succeeds, all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/updater.ts
git commit -m "fix(null-tools): stop deleting a download in progress when another update check runs (#12)"
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

---

### Task 3: Workspace scaffold and foundations (`error`, `progress`, `config`)

**Files:**
- Create: `setup/Cargo.toml`, `setup/core/Cargo.toml`, `setup/core/src/{lib,error,progress,config}.rs`
- Test: `setup/core/tests/config.rs`
- Modify: `.gitignore` (add `setup/target/`)

**Interfaces:**
- Produces (used by every later task):
  - `crate::{Error, Result}`; `trait IoCtx<T> { fn ctx(self, what: impl Into<String>) -> Result<T>; }` for `std::io::Result`.
  - `Error` variants: `Http{status:u16,url:String}`, `Network(String)`, `Io{context:String,source:io::Error}`, `Checksum{expected:String,actual:String}`, `Size{expected:u64,actual:u64}`, `Package(String)`, `Disk{need:u64,have:u64}`, `Busy`, `Locked(Vec<String>)`, `Cancelled`, `Crashed`, `Other(String)`.
  - `progress::Progress` (serde, `tag="state"`, camelCase): `Checking, Downloading{bytes,total,bytes_per_sec}, Verifying, Preparing, WaitingForClose{processes:Vec<String>}, Installing, Restarting, UpToDate, Ready, Busy, NeedsReapproval, Failed{message:String,log:Option<String>}`.
  - `progress::Logger` (`none()`, `open(&Path)`, `path()->Option<&Path>`, `line(&str)`, `tail(usize)->String`), `progress::logs_dir()`, `progress::LockedChoice{Retry,ForceClose,Cancel}`, `progress::Interact` (`fn locked(&self, running:&[procs::Running]) -> LockedChoice`), `progress::NoInteract`, `progress::Ctx<'a>{progress:&'a dyn Fn(Progress), log:&'a Logger, interact:&'a dyn Interact}` with `fn emit(&self, p: Progress)`.
  - `lib.rs`: `pub fn local_app_data() -> PathBuf`.
  - `config::InstallMeta{repo,version,installed_at:Option<String>,install_dir:Option<String>}`, `config::read(&Path)->Result<InstallMeta>`, `config::write(&Path,&InstallMeta)->Result<()>`, `config::iso_utc(u64)->String`, `config::now_iso()->String`.

- [ ] **Step 1: Write the failing test**

`setup/core/tests/config.rs`:

```rust
use null_setup_core::config::{iso_utc, read, write, InstallMeta};

#[test]
fn iso_utc_formats_known_instants() {
    assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso_utc(1_700_000_000), "2023-11-14T22:13:20Z");
}

#[test]
fn reads_a_bom_prefixed_file_written_by_the_old_installer() {
    let dir = tempfile::tempdir().unwrap();
    let text = "\u{feff}{\"repo\":\"o/r\",\"version\":\"v1\",\"installedAt\":null,\"installDir\":\"C:\\\\x\"}";
    std::fs::write(dir.path().join(".null-ide-install.json"), text).unwrap();
    let m = read(dir.path()).unwrap();
    assert_eq!((m.repo.as_str(), m.version.as_str()), ("o/r", "v1"));
    assert_eq!(m.installed_at, None);
}

#[test]
fn write_then_read_round_trips_without_a_bom() {
    let dir = tempfile::tempdir().unwrap();
    let m = InstallMeta { repo: "o/r".into(), version: "v2".into(), installed_at: Some(iso_utc(0)), install_dir: Some("D:\\Null IDE".into()) };
    write(dir.path(), &m).unwrap();
    let raw = std::fs::read(dir.path().join(".null-ide-install.json")).unwrap();
    assert_ne!(&raw[..3], b"\xEF\xBB\xBF");
    assert_eq!(read(dir.path()).unwrap(), m);
}
```

- [ ] **Step 2: Create the crates, run the test, see it fail**

`setup/Cargo.toml`:

```toml
[workspace]
members = ["core", "app"]
resolver = "2"

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = true
```

`setup/core/Cargo.toml`:

```toml
[package]
name = "null-setup-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
thiserror = "1"
ureq = "2"
zip = { version = "2", default-features = false, features = ["deflate"] }
sysinfo = "0.30"

[dev-dependencies]
tempfile = "3"
tiny_http = "0.12"
```

`app` is created in Task 11; until then create `setup/app/Cargo.toml` stub so the workspace resolves:

```toml
[package]
name = "null-setup"
version = "0.1.0"
edition = "2021"
```
and `setup/app/src/main.rs` containing `fn main() {}`. Append `setup/target/` to `.gitignore`.

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test config`
Expected: FAIL to compile (`unresolved import null_setup_core::config`).

- [ ] **Step 3: Implement**

`setup/core/src/lib.rs`:

```rust
use std::path::PathBuf;

pub mod config;
pub mod error;
pub mod progress;

pub use error::{Error, Result};

pub fn local_app_data() -> PathBuf {
    PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
}
```
(Later tasks add their `pub mod` lines here; each task's step 3 says so.)

`setup/core/src/error.rs`:

```rust
use std::io;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("HTTP {status} from {url}")]
    Http { status: u16, url: String },
    #[error("network error: {0}")]
    Network(String),
    #[error("{context}: {source}")]
    Io { context: String, #[source] source: io::Error },
    #[error("checksum mismatch: expected {expected}, got {actual}")]
    Checksum { expected: String, actual: String },
    #[error("size mismatch: expected {expected} bytes, got {actual}")]
    Size { expected: u64, actual: u64 },
    #[error("invalid package: {0}")]
    Package(String),
    #[error("not enough disk space: need {need} MB, have {have} MB")]
    Disk { need: u64, have: u64 },
    #[error("another download is in progress")]
    Busy,
    #[error("Null IDE is still running: {}", .0.join(", "))]
    Locked(Vec<String>),
    #[error("cancelled")]
    Cancelled,
    /// Test seam: `swap` hooks return `Hook::Crash` to simulate a killed process.
    #[error("simulated crash")]
    Crashed,
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

pub trait IoCtx<T> {
    fn ctx(self, what: impl Into<String>) -> Result<T>;
}

impl<T> IoCtx<T> for io::Result<T> {
    fn ctx(self, what: impl Into<String>) -> Result<T> {
        self.map_err(|source| Error::Io { context: what.into(), source })
    }
}
```

`setup/core/src/progress.rs`:

```rust
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{local_app_data, procs::Running};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Progress {
    Checking,
    Downloading { bytes: u64, total: u64, bytes_per_sec: u64 },
    Verifying,
    Preparing,
    WaitingForClose { processes: Vec<String> },
    Installing,
    Restarting,
    UpToDate,
    Ready,
    Busy,
    NeedsReapproval,
    Failed { message: String, log: Option<String> },
}

pub enum LockedChoice { Retry, ForceClose, Cancel }

pub trait Interact {
    fn locked(&self, running: &[Running]) -> LockedChoice;
}

pub struct NoInteract;
impl Interact for NoInteract {
    fn locked(&self, _: &[Running]) -> LockedChoice { LockedChoice::Cancel }
}

pub struct Ctx<'a> {
    pub progress: &'a dyn Fn(Progress),
    pub log: &'a Logger,
    pub interact: &'a dyn Interact,
}

impl Ctx<'_> {
    pub fn emit(&self, p: Progress) {
        if !matches!(p, Progress::Downloading { .. }) {
            self.log.line(&format!("{p:?}"));
        }
        (self.progress)(p);
    }
}

pub struct Logger { file: Mutex<Option<File>>, path: Option<PathBuf> }

fn unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn logs_dir() -> PathBuf { local_app_data().join("Null").join("logs") }

impl Logger {
    pub fn none() -> Logger { Logger { file: Mutex::new(None), path: None } }

    pub fn open(dir: &Path) -> Logger {
        let _ = fs::create_dir_all(dir);
        let path = dir.join(format!("setup-{}.log", unix_secs()));
        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(f) => Logger { file: Mutex::new(Some(f)), path: Some(path) },
            Err(_) => Logger::none(),
        }
    }

    pub fn path(&self) -> Option<&Path> { self.path.as_deref() }

    pub fn line(&self, s: &str) {
        if let Ok(mut g) = self.file.lock() {
            if let Some(f) = g.as_mut() {
                let _ = writeln!(f, "{} {s}", unix_secs());
            }
        }
    }

    pub fn tail(&self, n: usize) -> String {
        let Some(p) = &self.path else { return String::new() };
        let text = fs::read_to_string(p).unwrap_or_default();
        let lines: Vec<&str> = text.lines().collect();
        lines[lines.len().saturating_sub(n)..].join("\n")
    }
}
```
`progress.rs` refers to `procs::Running`; add a temporary `procs.rs` now with only the type, so the crate compiles (Task 6 fills it in):

```rust
#[derive(Clone, Debug, PartialEq)]
pub struct Running { pub pid: u32, pub name: String }
```
and `pub mod procs;` in `lib.rs`.

`setup/core/src/config.rs`:

```rust
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoCtx, Result};

const FILE: &str = ".null-ide-install.json";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallMeta {
    pub repo: String,
    pub version: String,
    #[serde(default)]
    pub installed_at: Option<String>,
    #[serde(default)]
    pub install_dir: Option<String>,
}

pub fn read(install_dir: &Path) -> Result<InstallMeta> {
    let raw = fs::read_to_string(install_dir.join(FILE)).ctx("read install metadata")?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))
}

pub fn write(install_dir: &Path, meta: &InstallMeta) -> Result<()> {
    let text = serde_json::to_string_pretty(meta).map_err(|e| Error::Other(e.to_string()))?;
    let tmp = install_dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, text).ctx("write install metadata")?;
    fs::rename(&tmp, install_dir.join(FILE)).ctx("replace install metadata")
}

pub fn now_iso() -> String {
    iso_utc(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
}

/// Howard Hinnant's civil-from-days; avoids a date crate for one timestamp.
pub fn iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test config`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add setup .gitignore
git commit -m "feat(setup): scaffold the null-setup workspace with error, progress and install metadata"
```

---

### Task 4: `http` and `release`

**Files:**
- Create: `setup/core/src/{http,release}.rs`, `setup/core/tests/support/mod.rs`, `setup/core/tests/{http,release}.rs`
- Modify: `setup/core/src/lib.rs` (add `pub mod http; pub mod release;`)

**Interfaces:**
- Consumes: `Error`, `Result` (Task 3).
- Produces:
  - `http::Http` with `Http::standard()`, `Http::with_delay(Duration)`, `pub retry_delay: Duration`, `get(&self,url:&str,range_from:Option<u64>)->Result<ureq::Response>`, `get_json(&self,url:&str)->Result<serde_json::Value>`, `get_text(&self,url:&str)->Result<String>`.
  - `release::Release{tag,zip_name,zip_url,zip_size:u64,sha256_url}` (all `String` except size), `release::resolve(&Http, api_base:&str, repo:&str, tag:&str)->Result<Release>`, `release::from_json(&serde_json::Value, tag:&str)->Result<Release>`, `release::parse_sha256(&str)->Result<String>`.
  - Test support: `support::{serve, Server, Req, Reply, make_zip}`; `Req{base:String,url:String,range:Option<u64>}`; `Reply = (u16, Vec<u8>, Vec<(&'static str, String)>)`; `Server{pub base:String}`; `make_zip(path:&Path, entries:&[(&str,&[u8])])`.

- [ ] **Step 1: Write the support module and failing tests**

`setup/core/tests/support/mod.rs`:

```rust
#![allow(dead_code)]
use std::{fs::File, io::Write, path::Path, sync::Arc, thread};

use tiny_http::{Header, Response, Server as Tiny};

pub struct Req { pub base: String, pub url: String, pub range: Option<u64> }
pub type Reply = (u16, Vec<u8>, Vec<(&'static str, String)>);

pub struct Server { pub base: String, tiny: Arc<Tiny> }

pub fn serve<F>(handler: F) -> Server
where
    F: Fn(&Req) -> Reply + Send + 'static,
{
    let tiny = Arc::new(Tiny::http("127.0.0.1:0").unwrap());
    let base = format!("http://{}", tiny.server_addr().to_ip().unwrap());
    let (t, b) = (tiny.clone(), base.clone());
    thread::spawn(move || {
        for request in t.incoming_requests() {
            let range = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Range"))
                .and_then(|h| h.value.as_str().strip_prefix("bytes=")?.strip_suffix('-')?.parse().ok());
            let req = Req { base: b.clone(), url: request.url().to_string(), range };
            let (code, body, headers) = handler(&req);
            let mut resp = Response::from_data(body).with_status_code(code);
            for (k, v) in headers {
                resp = resp.with_header(Header::from_bytes(k, v).unwrap());
            }
            let _ = request.respond(resp);
        }
    });
    Server { base, tiny }
}

impl Drop for Server {
    fn drop(&mut self) { self.tiny.unblock(); }
}

pub fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let mut w = zip::ZipWriter::new(File::create(path).unwrap());
    let opts = zip::write::SimpleFileOptions::default();
    for (name, data) in entries {
        w.start_file(*name, opts).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap();
}
```

`setup/core/tests/http.rs`:

```rust
mod support;
use std::{sync::{atomic::{AtomicUsize, Ordering}, Arc}, time::Duration};

use null_setup_core::{http::Http, Error};

fn http() -> Http { Http::with_delay(Duration::from_millis(1)) }

#[test]
fn a_404_fails_at_once_and_names_status_and_url() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (404, b"{}".to_vec(), vec![]) });
    let url = format!("{}/x", srv.base);
    match http().get(&url, None) {
        Err(Error::Http { status: 404, url: u }) => assert_eq!(u, url),
        other => panic!("unexpected: {other:?}", other = other.map(|_| ())),
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[test]
fn a_503_is_retried_until_it_recovers() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| {
        if h.fetch_add(1, Ordering::SeqCst) == 0 { (503, vec![], vec![]) } else { (200, b"ok".to_vec(), vec![]) }
    });
    assert_eq!(http().get_text(&format!("{}/x", srv.base)).unwrap(), "ok");
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

#[test]
fn a_429_is_retried_three_times_then_reported() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (429, vec![], vec![]) });
    assert!(matches!(http().get(&format!("{}/x", srv.base), None), Err(Error::Http { status: 429, .. })));
    assert_eq!(hits.load(Ordering::SeqCst), 3);
}
```

`setup/core/tests/release.rs`:

```rust
mod support;
use std::time::Duration;

use null_setup_core::{http::Http, release::{from_json, parse_sha256, resolve}, Error};
use serde_json::json;

fn release_json(base: &str) -> serde_json::Value {
    json!({ "tag_name": "v2", "assets": [
        { "name": "NullIDESetup-v2.exe", "browser_download_url": format!("{base}/setup"), "size": 5 },
        { "name": "null-ide-win32-x64.zip", "browser_download_url": format!("{base}/zip"), "size": 1234 },
        { "name": "null-ide-win32-x64.zip.sha256", "browser_download_url": format!("{base}/zip.sha256"), "size": 90 }
    ]})
}

#[test]
fn picks_the_zip_and_its_sidecar_and_ignores_the_exe() {
    let r = from_json(&release_json("http://h"), "v2").unwrap();
    assert_eq!((r.zip_name.as_str(), r.zip_size), ("null-ide-win32-x64.zip", 1234));
    assert_eq!(r.zip_url, "http://h/zip");
    assert_eq!(r.sha256_url, "http://h/zip.sha256");
}

#[test]
fn a_release_without_a_sidecar_is_rejected() {
    let mut v = release_json("http://h");
    v["assets"].as_array_mut().unwrap().pop();
    assert!(matches!(from_json(&v, "v2"), Err(Error::Package(_))));
}

#[test]
fn a_release_without_a_zip_is_rejected() {
    assert!(matches!(from_json(&json!({ "assets": [] }), "v2"), Err(Error::Package(_))));
}

#[test]
fn parses_sha256_sidecars_in_both_common_formats() {
    let h = "a".repeat(64);
    assert_eq!(parse_sha256(&format!("{h}  null-ide-win32-x64.zip")).unwrap(), h);
    assert_eq!(parse_sha256(&format!("{}\n", h.to_uppercase())).unwrap(), h);
    assert!(parse_sha256("not a hash").is_err());
}

#[test]
fn resolve_asks_for_the_exact_tag() {
    let srv = support::serve(|req| {
        if req.url == "/repos/o/r/releases/tags/v2" {
            (200, release_json(&req.base).to_string().into_bytes(), vec![("Content-Type", "application/json".into())])
        } else {
            (404, vec![], vec![])
        }
    });
    let r = resolve(&Http::with_delay(Duration::from_millis(1)), &srv.base, "o/r", "v2").unwrap();
    assert_eq!(r.tag, "v2");
    assert!(matches!(
        resolve(&Http::with_delay(Duration::from_millis(1)), &srv.base, "o/r", "v3"),
        Err(Error::Http { status: 404, .. })
    ));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test http --test release`
Expected: FAIL to compile (`unresolved import null_setup_core::http`).

- [ ] **Step 3: Implement**

Add `pub mod http; pub mod release;` to `lib.rs`.

`setup/core/src/http.rs`:

```rust
use std::{thread, time::Duration};

use crate::{Error, Result};

pub struct Http {
    agent: ureq::Agent,
    pub retry_delay: Duration,
}

impl Http {
    pub fn standard() -> Http { Http::with_delay(Duration::from_secs(1)) }

    pub fn with_delay(retry_delay: Duration) -> Http {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(30))
            .user_agent("Null-IDE-Setup")
            .build();
        Http { agent, retry_delay }
    }

    pub fn get(&self, url: &str, range_from: Option<u64>) -> Result<ureq::Response> {
        self.send(url, range_from, false)
    }

    pub fn get_json(&self, url: &str) -> Result<serde_json::Value> {
        let body = self.send(url, None, true)?.into_string().map_err(|e| Error::Network(e.to_string()))?;
        serde_json::from_str(&body).map_err(|e| Error::Other(format!("invalid JSON from {url}: {e}")))
    }

    pub fn get_text(&self, url: &str) -> Result<String> {
        self.send(url, None, false)?.into_string().map_err(|e| Error::Network(e.to_string()))
    }

    /// 3 attempts. 4xx (except 429) is final; 5xx, 429 and transport errors are retried with backoff.
    fn send(&self, url: &str, range_from: Option<u64>, github_api: bool) -> Result<ureq::Response> {
        let mut last = Error::Network("no attempt made".into());
        for attempt in 0..3u32 {
            if attempt > 0 {
                thread::sleep(self.retry_delay * attempt);
            }
            let mut req = self.agent.get(url);
            if github_api {
                req = req.set("Accept", "application/vnd.github+json").set("X-GitHub-Api-Version", "2022-11-28");
                // Only the API call carries the token, never the asset download.
                if let Ok(t) = std::env::var("GITHUB_TOKEN") {
                    req = req.set("Authorization", &format!("Bearer {t}"));
                }
            }
            if let Some(n) = range_from {
                req = req.set("Range", &format!("bytes={n}-"));
            }
            match req.call() {
                Ok(r) => return Ok(r),
                Err(ureq::Error::Status(code, _)) if code < 500 && code != 429 => {
                    return Err(Error::Http { status: code, url: url.into() })
                }
                Err(ureq::Error::Status(code, _)) => last = Error::Http { status: code, url: url.into() },
                Err(ureq::Error::Transport(t)) => last = Error::Network(format!("{url}: {t}")),
            }
        }
        Err(last)
    }
}
```

`setup/core/src/release.rs`:

```rust
use serde_json::Value;

use crate::{http::Http, Error, Result};

#[derive(Clone, Debug, PartialEq)]
pub struct Release {
    pub tag: String,
    pub zip_name: String,
    pub zip_url: String,
    pub zip_size: u64,
    pub sha256_url: String,
}

pub fn resolve(http: &Http, api_base: &str, repo: &str, tag: &str) -> Result<Release> {
    let v = http.get_json(&format!("{api_base}/repos/{repo}/releases/tags/{tag}"))?;
    from_json(&v, tag)
}

fn is_zip_name(n: &str) -> bool {
    let l = n.to_ascii_lowercase();
    l.starts_with("null-ide-win32-x64") && l.ends_with(".zip")
}

pub fn from_json(v: &Value, tag: &str) -> Result<Release> {
    let assets = v["assets"].as_array().ok_or_else(|| Error::Package("release has no assets".into()))?;
    let zip = assets
        .iter()
        .find(|a| a["name"].as_str().is_some_and(is_zip_name))
        .ok_or_else(|| Error::Package("release has no Windows zip".into()))?;
    let zip_name = zip["name"].as_str().unwrap_or_default().to_string();
    let sidecar_name = format!("{zip_name}.sha256");
    let sidecar = assets
        .iter()
        .find(|a| a["name"].as_str() == Some(sidecar_name.as_str()))
        .ok_or_else(|| Error::Package(format!("release has no {sidecar_name}")))?;
    let url = |a: &Value| {
        a["browser_download_url"].as_str().map(str::to_string).ok_or_else(|| Error::Package("asset without a URL".into()))
    };
    Ok(Release {
        tag: tag.to_string(),
        zip_url: url(zip)?,
        zip_size: zip["size"].as_u64().ok_or_else(|| Error::Package("zip asset without a size".into()))?,
        sha256_url: url(sidecar)?,
        zip_name,
    })
}

pub fn parse_sha256(text: &str) -> Result<String> {
    let token = text.split_whitespace().next().unwrap_or_default().to_ascii_lowercase();
    if token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(token)
    } else {
        Err(Error::Package("the .sha256 sidecar does not contain a SHA256 hash".into()))
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test http --test release`
Expected: all PASS (3 + 5).

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): HTTP client with retries and exact-tag release resolution"
```

---

### Task 5: `disk` and `download` (cache, lock, resumable verified fetch)

**Files:**
- Create: `setup/core/src/{disk,download}.rs`, `setup/core/tests/download.rs`
- Modify: `setup/core/src/lib.rs` (`pub mod disk; pub mod download;`), `setup/core/src/procs.rs` (add `pid_alive`)

**Interfaces:**
- Consumes: `Http`, `Release` (Task 4), `Ctx`, `Progress`, `Error` (Task 3), test support (Task 4).
- Produces:
  - `procs::pid_alive(pid: u32) -> bool`.
  - `disk::check(available: u64, needed: u64) -> Result<()>`, `disk::ensure(path: &Path, needed: u64) -> Result<()>`.
  - `download::Cache{pub root: PathBuf}` with `Cache::standard()`, `dir(&self, tag:&str)->PathBuf`, `prune_except(&self, keep:&str)`.
  - `download::Lock` with `Lock::acquire(root:&Path, wait:Duration)->Result<Lock>` (drop releases; `Err(Error::Busy)` after `wait`).
  - `download::fetch(http:&Http, cache:&Cache, rel:&Release, expected_sha:&str, wait:Duration, ctx:&Ctx) -> Result<PathBuf>` returns the verified zip path.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/download.rs`:

```rust
mod support;
use std::{
    fs,
    sync::{atomic::{AtomicUsize, Ordering}, Arc, Mutex},
    time::Duration,
};

use null_setup_core::{
    disk,
    download::{fetch, Cache, Lock},
    http::Http,
    progress::{Ctx, Logger, NoInteract, Progress},
    release::Release,
    Error,
};
use sha2::{Digest, Sha256};

const NAME: &str = "null-ide-win32-x64.zip";

fn body() -> Vec<u8> { (0..300_000u32).map(|i| (i % 251) as u8).collect() }
fn sha(b: &[u8]) -> String { format!("{:x}", Sha256::digest(b)) }
fn release(base: &str, size: usize) -> Release {
    Release { tag: "v2".into(), zip_name: NAME.into(), zip_url: format!("{base}/zip"), zip_size: size as u64, sha256_url: String::new() }
}
fn run<T>(f: impl FnOnce(&Ctx) -> T) -> T {
    let log = Logger::none();
    let progress = |_p: Progress| {};
    f(&Ctx { progress: &progress, log: &log, interact: &NoInteract })
}
fn http() -> Http { Http::with_delay(Duration::from_millis(1)) }

#[test]
fn downloads_and_verifies() {
    let data = body();
    let d = data.clone();
    let srv = support::serve(move |_| (200, d.clone(), vec![]));
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    let path = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(fs::read(path).unwrap(), data);
}

#[test]
fn resumes_from_a_partial_file() {
    let data = body();
    let d = data.clone();
    let ranges = Arc::new(Mutex::new(vec![]));
    let r = ranges.clone();
    let srv = support::serve(move |req| {
        r.lock().unwrap().push(req.range);
        match req.range {
            Some(n) => (206, d[n as usize..].to_vec(), vec![]),
            None => (200, d.clone(), vec![]),
        }
    });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), &data[..100_000]).unwrap();
    let path = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(fs::read(path).unwrap(), data);
    assert_eq!(*ranges.lock().unwrap(), vec![Some(100_000)]);
}

#[test]
fn restarts_when_the_server_ignores_range() {
    let data = body();
    let d = data.clone();
    let srv = support::serve(move |_| (200, d.clone(), vec![]));
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), &data[..100_000]).unwrap();
    let path = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(fs::read(path).unwrap(), data);
}

#[test]
fn restarts_on_416_and_on_an_oversized_part_file() {
    let data = body();
    let d = data.clone();
    let srv = support::serve(move |req| match req.range {
        Some(_) => (416, vec![], vec![]),
        None => (200, d.clone(), vec![]),
    });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    // 416 path: a short, wrong part file
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), b"garbage").unwrap();
    let rel = release(&srv.base, data.len());
    assert_eq!(fs::read(run(|c| fetch(&http(), &cache, &rel, &sha(&data), Duration::ZERO, c)).unwrap()).unwrap(), data);
    // oversized path: part larger than the asset
    fs::remove_file(cache.dir("v2").join(NAME)).unwrap();
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), vec![0u8; data.len() + 10]).unwrap();
    assert_eq!(fs::read(run(|c| fetch(&http(), &cache, &rel, &sha(&data), Duration::ZERO, c)).unwrap()).unwrap(), data);
}

#[test]
fn checksum_mismatch_retries_once_then_fails_and_leaves_no_files() {
    let data = body();
    let wrong = vec![7u8; data.len()];
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (200, wrong.clone(), vec![]) });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    let err = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap_err();
    assert!(matches!(err, Error::Checksum { .. }));
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert!(!cache.dir("v2").join(NAME).exists());
    assert!(!cache.dir("v2").join(format!("{NAME}.part")).exists());
}

#[test]
fn a_404_is_reported_with_its_status() {
    let srv = support::serve(|_| (404, vec![], vec![]));
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    let err = run(|c| fetch(&http(), &cache, &release(&srv.base, 10), &"0".repeat(64), Duration::ZERO, c)).unwrap_err();
    assert!(matches!(err, Error::Http { status: 404, .. }));
}

#[test]
fn a_verified_cached_zip_is_reused_without_a_request() {
    let data = body();
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (200, vec![], vec![]) });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    fs::write(cache.dir("v2").join(NAME), &data).unwrap();
    run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[test]
fn a_second_writer_is_refused_and_a_dead_holders_lock_is_stolen() {
    let tmp = tempfile::tempdir().unwrap();
    let first = Lock::acquire(tmp.path(), Duration::ZERO).unwrap();
    assert!(matches!(Lock::acquire(tmp.path(), Duration::ZERO), Err(Error::Busy)));
    drop(first);
    assert!(Lock::acquire(tmp.path(), Duration::ZERO).is_ok());
    // a lock file left by a process that no longer exists
    fs::write(tmp.path().join(".lock"), "4294967290").unwrap();
    assert!(Lock::acquire(tmp.path(), Duration::ZERO).is_ok());
}

#[test]
fn prune_removes_other_versions_but_not_the_run_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    for d in ["v1", "v2", "run"] { fs::create_dir_all(tmp.path().join(d)).unwrap(); }
    cache.prune_except("v2");
    assert!(!tmp.path().join("v1").exists());
    assert!(tmp.path().join("v2").exists() && tmp.path().join("run").exists());
}

#[test]
fn disk_check_compares_available_and_needed() {
    assert!(disk::check(10_000_000, 1_000_000).is_ok());
    assert!(matches!(disk::check(1_000_000, 10_000_000), Err(Error::Disk { .. })));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test download`
Expected: FAIL to compile (`unresolved import null_setup_core::download`).

- [ ] **Step 3: Implement**

Add `pub mod disk; pub mod download;` to `lib.rs`. Append to `setup/core/src/procs.rs`:

```rust
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

fn processes() -> System {
    System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::everything()))
}

pub fn pid_alive(pid: u32) -> bool {
    processes().process(Pid::from_u32(pid)).is_some()
}
```

`setup/core/src/disk.rs`:

```rust
use std::path::Path;

use sysinfo::Disks;

use crate::{Error, Result};

pub fn check(available: u64, needed: u64) -> Result<()> {
    if available >= needed { Ok(()) } else { Err(Error::Disk { need: needed >> 20, have: available >> 20 }) }
}

fn available_space(path: &Path) -> Option<u64> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

/// Unknown free space (odd mount, UNC path) is not an error: the write itself will fail loudly.
pub fn ensure(path: &Path, needed: u64) -> Result<()> {
    match available_space(path) {
        Some(a) => check(a, needed),
        None => Ok(()),
    }
}
```

`setup/core/src/download.rs`:

```rust
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};

use crate::{
    error::{Error, IoCtx, Result},
    http::Http,
    local_app_data, procs,
    progress::{Ctx, Progress},
    release::Release,
};

pub struct Cache { pub root: PathBuf }

impl Cache {
    pub fn standard() -> Cache { Cache { root: local_app_data().join("Null").join("updates") } }
    pub fn dir(&self, tag: &str) -> PathBuf { self.root.join(tag) }

    /// Best effort and only when nobody is downloading: `run/` holds the relocated updater itself.
    pub fn prune_except(&self, keep: &str) {
        let Ok(_lock) = Lock::acquire(&self.root, Duration::ZERO) else { return };
        let Ok(rd) = fs::read_dir(&self.root) else { return };
        for e in rd.flatten() {
            if e.path().is_dir() && e.file_name() != keep && e.file_name() != "run" {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
}

/// Single-writer lock over the whole cache, so a `prefetch` and an `update` cannot delete each other's download.
pub struct Lock { path: PathBuf }

impl Lock {
    pub fn acquire(root: &Path, wait: Duration) -> Result<Lock> {
        fs::create_dir_all(root).ctx("create cache directory")?;
        let path = root.join(".lock");
        let start = Instant::now();
        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut f) => {
                    let _ = write!(f, "{}", std::process::id());
                    return Ok(Lock { path });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if holder_is_dead(&path) {
                        let _ = fs::remove_file(&path);
                        continue;
                    }
                    if start.elapsed() >= wait {
                        return Err(Error::Busy);
                    }
                    thread::sleep(Duration::from_millis(200));
                }
                Err(e) => return Err(Error::Io { context: "create download lock".into(), source: e }),
            }
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) { let _ = fs::remove_file(&self.path); }
}

/// An unreadable pid (the holder is between create and write) counts as alive.
fn holder_is_dead(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .is_some_and(|pid| !procs::pid_alive(pid))
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path).ctx("open file to hash")?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).ctx("read file to hash")?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

pub fn fetch(http: &Http, cache: &Cache, rel: &Release, expected_sha: &str, wait: Duration, ctx: &Ctx) -> Result<PathBuf> {
    let dir = cache.dir(&rel.tag);
    fs::create_dir_all(&dir).ctx("create cache directory")?;
    let _lock = Lock::acquire(&cache.root, wait)?;
    let done = dir.join(&rel.zip_name);
    let part = dir.join(format!("{}.part", rel.zip_name));

    if done.exists() {
        ctx.emit(Progress::Verifying);
        if sha256_file(&done)? == expected_sha {
            return Ok(done);
        }
        let _ = fs::remove_file(&done);
    }

    let (mut net_failures, mut sha_failures) = (0u32, 0u32);
    loop {
        match download_into(http, rel, &part, ctx) {
            Ok(()) => {}
            Err(e @ (Error::Size { .. } | Error::Network(_))) if net_failures < 2 => {
                net_failures += 1;
                ctx.log.line(&format!("download interrupted ({e}); resuming"));
                thread::sleep(http.retry_delay * net_failures);
                continue;
            }
            Err(e) => return Err(e),
        }
        ctx.emit(Progress::Verifying);
        let actual = sha256_file(&part)?;
        if actual == expected_sha {
            fs::rename(&part, &done).ctx("finish download")?;
            return Ok(done);
        }
        ctx.log.line(&format!("checksum mismatch: expected {expected_sha}, got {actual}"));
        let _ = fs::remove_file(&part);
        sha_failures += 1;
        if sha_failures > 1 {
            return Err(Error::Checksum { expected: expected_sha.into(), actual });
        }
    }
}

fn download_into(http: &Http, rel: &Release, part: &Path, ctx: &Ctx) -> Result<()> {
    let mut have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if have > rel.zip_size {
        let _ = fs::remove_file(part);
        have = 0;
    }
    if have == rel.zip_size {
        return Ok(()); // complete; the hash check decides
    }
    let resp = match http.get(&rel.zip_url, (have > 0).then_some(have)) {
        Err(Error::Http { status: 416, .. }) => {
            let _ = fs::remove_file(part);
            have = 0;
            http.get(&rel.zip_url, None)?
        }
        other => other?,
    };
    let resumed = resp.status() == 206 && have > 0;
    let mut file = if resumed {
        OpenOptions::new().append(true).open(part).ctx("open partial download")?
    } else {
        have = 0;
        File::create(part).ctx("create download file")?
    };

    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; 64 * 1024];
    let mut written = have;
    let (mut window_start, mut window_bytes) = (Instant::now(), written);
    loop {
        let n = reader.read(&mut buf).map_err(|e| Error::Network(e.to_string()))?;
        if n == 0 { break; }
        file.write_all(&buf[..n]).ctx("write download")?;
        written += n as u64;
        let elapsed = window_start.elapsed();
        if elapsed >= Duration::from_millis(250) {
            let per_sec = ((written - window_bytes) as f64 / elapsed.as_secs_f64()) as u64;
            ctx.emit(Progress::Downloading { bytes: written, total: rel.zip_size, bytes_per_sec: per_sec });
            window_start = Instant::now();
            window_bytes = written;
        }
    }
    file.flush().ctx("flush download")?;
    if written != rel.zip_size {
        return Err(Error::Size { expected: rel.zip_size, actual: written }); // keep the .part for resuming
    }
    Ok(())
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test download`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): resumable, verified downloads with a single-writer cache lock"
```

---

### Task 6: `procs` (find, close, wait for the IDE)

**Files:**
- Modify: `setup/core/src/procs.rs`
- Test: `setup/core/tests/procs.rs`

**Interfaces:**
- Consumes: `Ctx`, `Interact`, `LockedChoice`, `Progress` (Task 3); `pid_alive` (Task 5).
- Produces:
  - `procs::Running{pid:u32,name:String}` (already defined).
  - `procs::is_under(exe:&Path, dir:&Path) -> bool` (case-insensitive, `/` and `\`, directory-boundary aware).
  - `procs::running_in(dir:&Path) -> Vec<Running>` (excludes the current process).
  - `procs::request_close(pids:&[u32])`, `procs::force_close(pids:&[u32])`.
  - `procs::close_all(dir:&Path, ctx:&Ctx, grace:Duration) -> Result<()>`: sends close requests, waits up to `grace` emitting `WaitingForClose`, then asks `ctx.interact.locked(..)`: Retry loops, ForceClose calls `force_close` then loops, Cancel returns `Err(Error::Locked(names))`.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/procs.rs`:

```rust
use std::{fs, path::Path, process::Command, thread, time::{Duration, Instant}};

use null_setup_core::{
    procs::{close_all, is_under, running_in},
    progress::{Ctx, Logger, NoInteract, Progress},
    Error,
};

#[test]
fn is_under_is_case_insensitive_and_respects_directory_boundaries() {
    let dir = Path::new(r"C:\Users\Me\AppData\Local\Programs\Null IDE");
    assert!(is_under(Path::new(r"c:\users\me\appdata\local\programs\null ide\null.exe"), dir));
    assert!(is_under(Path::new("C:/Users/Me/AppData/Local/Programs/Null IDE/bin/x.exe"), dir));
    assert!(!is_under(Path::new(r"C:\Users\Me\AppData\Local\Programs\Null IDE 2\null.exe"), dir));
    assert!(!is_under(Path::new(r"C:\Windows\explorer.exe"), dir));
}

fn ping_copy(dir: &Path) -> std::path::PathBuf {
    let exe = dir.join("null.exe");
    fs::copy(r"C:\Windows\System32\PING.EXE", &exe).unwrap();
    exe
}

#[test]
fn finds_a_process_running_from_the_directory_and_none_after_it_exits() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = ping_copy(tmp.path());
    let mut child = Command::new(&exe).args(["-n", "30", "127.0.0.1"]).spawn().unwrap();
    thread::sleep(Duration::from_millis(500));
    assert_eq!(running_in(tmp.path()).iter().filter(|r| r.pid == child.id()).count(), 1);
    child.kill().unwrap();
    child.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !running_in(tmp.path()).is_empty() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
    }
    assert!(running_in(tmp.path()).is_empty());
}

#[test]
fn close_all_without_a_choice_reports_the_blocking_process_names() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = ping_copy(tmp.path());
    let mut child = Command::new(&exe).args(["-n", "30", "127.0.0.1"]).spawn().unwrap();
    thread::sleep(Duration::from_millis(500));
    let log = Logger::none();
    let seen = std::sync::Mutex::new(vec![]);
    let progress = |p: Progress| seen.lock().unwrap().push(p);
    let ctx = Ctx { progress: &progress, log: &log, interact: &NoInteract };
    // ping is a console app without a window: WM_CLOSE does nothing, so it stays "locking".
    let err = close_all(tmp.path(), &ctx, Duration::from_millis(800)).unwrap_err();
    child.kill().unwrap();
    child.wait().unwrap();
    match err {
        Error::Locked(names) => assert!(names.iter().any(|n| n.eq_ignore_ascii_case("null.exe"))),
        other => panic!("unexpected: {other}"),
    }
    assert!(seen.lock().unwrap().iter().any(|p| matches!(p, Progress::WaitingForClose { .. })));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test procs`
Expected: FAIL to compile (`is_under`, `running_in`, `close_all` not found).

- [ ] **Step 3: Implement**

Replace `setup/core/src/procs.rs` with:

```rust
use std::{
    os::windows::process::CommandExt,
    path::Path,
    process::Command,
    thread,
    time::{Duration, Instant},
};

use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

use crate::{
    progress::{Ctx, LockedChoice, Progress},
    Error, Result,
};

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, PartialEq)]
pub struct Running { pub pid: u32, pub name: String }

fn processes() -> System {
    System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::everything()))
}

pub fn pid_alive(pid: u32) -> bool {
    processes().process(Pid::from_u32(pid)).is_some()
}

fn norm(p: &Path) -> String {
    p.to_string_lossy().to_lowercase().replace('/', "\\")
}

pub fn is_under(exe: &Path, dir: &Path) -> bool {
    let mut d = norm(dir);
    if !d.ends_with('\\') { d.push('\\'); }
    norm(exe).starts_with(&d)
}

pub fn running_in(dir: &Path) -> Vec<Running> {
    let me = std::process::id();
    let sys = processes();
    sys.processes()
        .values()
        .filter(|p| p.pid().as_u32() != me)
        .filter(|p| p.exe().is_some_and(|e| is_under(e, dir)))
        .map(|p| Running { pid: p.pid().as_u32(), name: p.name().to_string() })
        .collect()
}

fn taskkill(pids: &[u32], force: bool) {
    for pid in pids {
        let mut c = Command::new("taskkill");
        c.arg("/PID").arg(pid.to_string());
        if force { c.args(["/F", "/T"]); }
        let _ = c.creation_flags(NO_WINDOW).status();
    }
}

/// Without `/F` taskkill posts WM_CLOSE, so the IDE can run its hot-exit backup.
pub fn request_close(pids: &[u32]) { taskkill(pids, false) }
pub fn force_close(pids: &[u32]) { taskkill(pids, true) }

pub fn close_all(dir: &Path, ctx: &Ctx, grace: Duration) -> Result<()> {
    loop {
        let mut running = running_in(dir);
        if running.is_empty() { return Ok(()); }
        request_close(&running.iter().map(|r| r.pid).collect::<Vec<_>>());
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            thread::sleep(Duration::from_millis(500));
            running = running_in(dir);
            if running.is_empty() { return Ok(()); }
            ctx.emit(Progress::WaitingForClose { processes: running.iter().map(|r| r.name.clone()).collect() });
        }
        match ctx.interact.locked(&running) {
            LockedChoice::Retry => continue,
            LockedChoice::ForceClose => {
                force_close(&running.iter().map(|r| r.pid).collect::<Vec<_>>());
                thread::sleep(Duration::from_secs(1));
            }
            LockedChoice::Cancel => return Err(Error::Locked(running.into_iter().map(|r| r.name).collect())),
        }
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test procs --test download`
Expected: all PASS (download tests still compile against the moved `pid_alive`).

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): find and close the running IDE, report what still locks files"
```

---

### Task 7: `extract` (zip → staging, zip-slip safe)

**Files:**
- Create: `setup/core/src/extract.rs`, `setup/core/tests/extract.rs`
- Modify: `setup/core/src/lib.rs` (`pub mod extract;`)

**Interfaces:**
- Consumes: `Ctx`, `Progress`, `Error`, test `support::make_zip`.
- Produces: `extract::extract(zip_path:&Path, dest:&Path, ctx:&Ctx) -> Result<()>`. Emits `Preparing`. Requires `null.exe` at the zip root; otherwise `Err(Error::Package)` and `dest` is removed.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/extract.rs`:

```rust
mod support;
use std::fs;

use null_setup_core::{
    extract::extract,
    progress::{Ctx, Logger, NoInteract, Progress},
    Error,
};

fn run<T>(f: impl FnOnce(&Ctx) -> T) -> T {
    let log = Logger::none();
    let progress = |_p: Progress| {};
    f(&Ctx { progress: &progress, log: &log, interact: &NoInteract })
}

#[test]
fn extracts_files_and_folders_including_backslash_entry_names() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("a.zip");
    support::make_zip(&zip, &[("null.exe", b"exe"), ("resources\\app\\x.txt", b"x"), ("setup/null-setup.exe", b"s")]);
    let dest = tmp.path().join("stage");
    run(|c| extract(&zip, &dest, c)).unwrap();
    assert_eq!(fs::read(dest.join("resources").join("app").join("x.txt")).unwrap(), b"x");
    assert_eq!(fs::read(dest.join("setup").join("null-setup.exe")).unwrap(), b"s");
}

#[test]
fn rejects_path_traversal_and_writes_nothing_outside() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("evil.zip");
    support::make_zip(&zip, &[("null.exe", b"exe"), ("../evil.txt", b"x")]);
    let dest = tmp.path().join("stage");
    let err = run(|c| extract(&zip, &dest, c)).unwrap_err();
    assert!(matches!(err, Error::Package(_)));
    assert!(!tmp.path().join("evil.txt").exists());
    assert!(!dest.exists());
}

#[test]
fn rejects_absolute_entry_names() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("abs.zip");
    support::make_zip(&zip, &[("null.exe", b"exe"), ("C:\\Windows\\evil.txt", b"x")]);
    let err = run(|c| extract(&zip, &tmp.path().join("stage"), c)).unwrap_err();
    assert!(matches!(err, Error::Package(_)));
}

#[test]
fn a_package_without_null_exe_is_rejected_and_cleaned_up() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("x.zip");
    support::make_zip(&zip, &[("readme.txt", b"x")]);
    let dest = tmp.path().join("stage");
    assert!(matches!(run(|c| extract(&zip, &dest, c)), Err(Error::Package(_))));
    assert!(!dest.exists());
}

#[test]
fn a_truncated_zip_is_a_package_error() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("t.zip");
    support::make_zip(&zip, &[("null.exe", &[1u8; 5000])]);
    let bytes = fs::read(&zip).unwrap();
    fs::write(&zip, &bytes[..bytes.len() / 2]).unwrap();
    assert!(matches!(run(|c| extract(&zip, &tmp.path().join("stage"), c)), Err(Error::Package(_))));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test extract`
Expected: FAIL to compile (`extract` not found).

- [ ] **Step 3: Implement**

`setup/core/src/extract.rs`:

```rust
use std::{fs, io, path::Path};

use crate::{
    error::{Error, IoCtx, Result},
    progress::{Ctx, Progress},
};

pub fn extract(zip_path: &Path, dest: &Path, ctx: &Ctx) -> Result<()> {
    ctx.emit(Progress::Preparing);
    let result = extract_inner(zip_path, dest);
    if result.is_err() {
        let _ = fs::remove_dir_all(dest);
    }
    result
}

fn extract_inner(zip_path: &Path, dest: &Path) -> Result<()> {
    let file = fs::File::open(zip_path).ctx("open update package")?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| Error::Package(e.to_string()))?;
    fs::create_dir_all(dest).ctx("create staging directory")?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| Error::Package(e.to_string()))?;
        let Some(rel) = entry.enclosed_name() else {
            return Err(Error::Package(format!("unsafe path in package: {}", entry.name())));
        };
        let out = dest.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).ctx("create directory")?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).ctx("create directory")?;
        }
        let mut f = fs::File::create(&out).ctx(format!("create {}", out.display()))?;
        io::copy(&mut entry, &mut f).map_err(|e| Error::Package(format!("{}: {e}", entry.name())))?;
    }
    if !dest.join("null.exe").is_file() {
        return Err(Error::Package("null.exe is missing from the package root".into()));
    }
    Ok(())
}
```
Add `pub mod extract;` to `lib.rs`.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test extract`
Expected: 5 passed. If `enclosed_name` accepts the absolute/`..` names in this `zip` version, add an explicit check on `entry.name()` (`contains("..")`, starts with `/` or `\`, second char `:`) before using it, until the tests pass.

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): extract update packages without trusting entry paths"
```

---

### Task 8: `swap` (journal, commit, rollback, recovery)

**Files:**
- Create: `setup/core/src/swap.rs`, `setup/core/tests/swap.rs`
- Modify: `setup/core/src/lib.rs` (`pub mod swap;`)

**Interfaces:**
- Consumes: `Error`, `IoCtx`, `Result` (Task 3).
- Produces:
  - `swap::Plan{install,staged,aside: PathBuf}` (serde), `swap::Step{Started,AsideDone,MovedIn}` (serde), `swap::Timing{retries:u32,delay:Duration}` with `Timing::STANDARD` (10 × 500 ms), `swap::Hook{Continue,Fail,Crash}`, `swap::Recovered{Nothing,RolledBack,Committed}`.
  - `swap::plan_for(install:&Path, tag:&str) -> Plan` (names `.null-ide-stage-<tag>` / `.null-ide-bak-<tag>` beside the install dir), `swap::journal_path(install:&Path) -> PathBuf` (`<parent>/.null-update-journal.json`), `swap::ready_marker(install:&Path) -> PathBuf` (`<install>/.null-ready`).
  - `swap::swap(plan:&Plan, t:&Timing, hook:&mut dyn FnMut(Step)->Hook) -> Result<()>`: on a non-crash error it rolls back; `Hook::Crash` returns `Err(Error::Crashed)` with no cleanup (simulates a killed process).
  - `swap::commit(plan:&Plan) -> Result<()>`, `swap::rollback(plan:&Plan, t:&Timing) -> Result<()>`, `swap::recover(install:&Path, t:&Timing) -> Result<Recovered>`.
- Rules: portable `data\` moves from the old install into the new one and back on rollback; `recover` rolls back unless the journal says `MovedIn` **and** the ready marker exists in the install (then it commits). A stale `aside` directory is removed before the journal is written.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/swap.rs`:

```rust
use std::{fs, path::{Path, PathBuf}, process::Command, thread, time::Duration};

use null_setup_core::{
    swap::{commit, journal_path, plan_for, ready_marker, recover, rollback, swap, Hook, Plan, Recovered, Step, Timing},
    Error,
};

const T: Timing = Timing { retries: 2, delay: Duration::from_millis(1) };

struct Fx { _tmp: tempfile::TempDir, plan: Plan }

fn fixture() -> Fx {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE ünï");
    fs::create_dir_all(install.join("data")).unwrap();
    fs::write(install.join("old.txt"), "old").unwrap();
    fs::write(install.join("data").join("user.txt"), "mine").unwrap();
    let plan = plan_for(&install, "v2");
    fs::create_dir_all(&plan.staged).unwrap();
    fs::write(plan.staged.join("new.txt"), "new").unwrap();
    Fx { _tmp: tmp, plan }
}

fn is_old(install: &Path) -> bool {
    install.join("old.txt").exists() && !install.join("new.txt").exists()
        && fs::read_to_string(install.join("data").join("user.txt")).unwrap() == "mine"
}

fn crash_at(step: Step) -> impl FnMut(Step) -> Hook { move |s| if s == step { Hook::Crash } else { Hook::Continue } }
fn fail_at(step: Step) -> impl FnMut(Step) -> Hook { move |s| if s == step { Hook::Fail } else { Hook::Continue } }

#[test]
fn happy_path_moves_the_new_install_in_keeps_data_and_commit_cleans_up() {
    let f = fixture();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    assert!(f.plan.install.join("new.txt").exists() && !f.plan.install.join("old.txt").exists());
    assert_eq!(fs::read_to_string(f.plan.install.join("data").join("user.txt")).unwrap(), "mine");
    assert!(f.plan.aside.join("old.txt").exists());
    assert!(journal_path(&f.plan.install).exists());
    commit(&f.plan).unwrap();
    assert!(!f.plan.aside.exists() && !journal_path(&f.plan.install).exists());
}

#[test]
fn a_failure_at_each_step_rolls_back_to_the_untouched_old_install() {
    for step in [Step::Started, Step::AsideDone, Step::MovedIn] {
        let f = fixture();
        assert!(swap(&f.plan, &T, &mut fail_at(step)).is_err(), "{step:?}");
        assert!(is_old(&f.plan.install), "{step:?}");
        assert!(!f.plan.staged.exists() && !f.plan.aside.exists(), "{step:?}");
        assert!(!journal_path(&f.plan.install).exists(), "{step:?}");
    }
}

#[test]
fn a_crash_at_each_step_is_undone_by_recover() {
    for step in [Step::Started, Step::AsideDone, Step::MovedIn] {
        let f = fixture();
        assert!(matches!(swap(&f.plan, &T, &mut crash_at(step)), Err(Error::Crashed)));
        assert_eq!(recover(&f.plan.install, &T).unwrap(), Recovered::RolledBack, "{step:?}");
        assert!(is_old(&f.plan.install), "{step:?}");
        assert_eq!(recover(&f.plan.install, &T).unwrap(), Recovered::Nothing, "second recover is a no-op");
    }
}

#[test]
fn recover_commits_when_the_new_ide_wrote_its_ready_marker() {
    let f = fixture();
    assert!(matches!(swap(&f.plan, &T, &mut crash_at(Step::MovedIn)), Err(Error::Crashed)));
    fs::write(ready_marker(&f.plan.install), "1").unwrap();
    assert_eq!(recover(&f.plan.install, &T).unwrap(), Recovered::Committed);
    assert!(f.plan.install.join("new.txt").exists());
    assert!(!f.plan.aside.exists() && !journal_path(&f.plan.install).exists() && !ready_marker(&f.plan.install).exists());
}

#[test]
fn a_stale_backup_directory_does_not_make_a_fresh_swap_restore_old_files() {
    let f = fixture();
    fs::create_dir_all(&f.plan.aside).unwrap();
    fs::write(f.plan.aside.join("stale.txt"), "stale").unwrap();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    assert!(f.plan.install.join("new.txt").exists());
    assert!(!f.plan.aside.join("stale.txt").exists());
}

#[test]
fn rollback_after_move_in_hands_the_data_dir_back() {
    let f = fixture();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    fs::write(f.plan.install.join("data").join("created-by-new.txt"), "n").unwrap();
    rollback(&f.plan, &T).unwrap();
    assert!(f.plan.install.join("old.txt").exists());
    assert!(f.plan.install.join("data").join("created-by-new.txt").exists());
}

#[test]
fn a_locked_install_directory_fails_the_swap_and_leaves_it_intact() {
    let f = fixture();
    let exe: PathBuf = f.plan.install.join("hold.exe");
    fs::copy(r"C:\Windows\System32\PING.EXE", &exe).unwrap();
    // a process whose working directory is the install dir blocks renaming it
    let mut child = Command::new(&exe).args(["-n", "30", "127.0.0.1"]).current_dir(&f.plan.install).spawn().unwrap();
    thread::sleep(Duration::from_millis(300));
    let r = swap(&f.plan, &T, &mut |_| Hook::Continue);
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(matches!(r, Err(Error::Io { .. })));
    assert!(f.plan.install.join("old.txt").exists() && !f.plan.install.join("new.txt").exists());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test swap`
Expected: FAIL to compile (`unresolved import null_setup_core::swap`).

- [ ] **Step 3: Implement**

Add `pub mod swap;` to `lib.rs`. `setup/core/src/swap.rs`:

```rust
use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoCtx, Result};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum Step { Started, AsideDone, MovedIn }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Plan { pub install: PathBuf, pub staged: PathBuf, pub aside: PathBuf }

#[derive(Serialize, Deserialize)]
struct Journal { plan: Plan, step: Step }

#[derive(Clone, Copy)]
pub struct Timing { pub retries: u32, pub delay: Duration }

impl Timing {
    pub const STANDARD: Timing = Timing { retries: 10, delay: Duration::from_millis(500) };
}

pub enum Hook { Continue, Fail, Crash }

#[derive(Debug, PartialEq)]
pub enum Recovered { Nothing, RolledBack, Committed }

fn parent_of(install: &Path) -> &Path { install.parent().unwrap_or(Path::new(".")) }

pub fn journal_path(install: &Path) -> PathBuf { parent_of(install).join(".null-update-journal.json") }
pub fn ready_marker(install: &Path) -> PathBuf { install.join(".null-ready") }

pub fn plan_for(install: &Path, tag: &str) -> Plan {
    let parent = parent_of(install);
    Plan {
        install: install.to_path_buf(),
        staged: parent.join(format!(".null-ide-stage-{tag}")),
        aside: parent.join(format!(".null-ide-bak-{tag}")),
    }
}

fn write_journal(plan: &Plan, step: Step) -> Result<()> {
    let path = journal_path(&plan.install);
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&Journal { plan: plan.clone(), step }).map_err(|e| Error::Other(e.to_string()))?;
    fs::write(&tmp, text).ctx("write update journal")?;
    fs::rename(&tmp, &path).ctx("commit update journal")
}

fn read_journal(install: &Path) -> Option<Journal> {
    serde_json::from_str(&fs::read_to_string(journal_path(install)).ok()?).ok()
}

fn rename_retry(from: &Path, to: &Path, t: &Timing) -> Result<()> {
    let mut last = None;
    for i in 0..t.retries.max(1) {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        if i + 1 < t.retries {
            thread::sleep(t.delay);
        }
    }
    Err(Error::Io { context: format!("rename {} -> {}", from.display(), to.display()), source: last.unwrap() })
}

fn fire(hook: &mut dyn FnMut(Step) -> Hook, step: Step) -> Result<()> {
    match hook(step) {
        Hook::Continue => Ok(()),
        Hook::Fail => Err(Error::Other(format!("injected failure after {step:?}"))),
        Hook::Crash => Err(Error::Crashed),
    }
}

pub fn swap(plan: &Plan, t: &Timing, hook: &mut dyn FnMut(Step) -> Hook) -> Result<()> {
    match run_swap(plan, t, hook) {
        Ok(()) => Ok(()),
        Err(Error::Crashed) => Err(Error::Crashed),
        Err(e) => match rollback(plan, t) {
            Ok(()) => Err(e),
            Err(r) => Err(Error::Other(format!("{e}; rollback also failed: {r}"))),
        },
    }
}

fn run_swap(plan: &Plan, t: &Timing, hook: &mut dyn FnMut(Step) -> Hook) -> Result<()> {
    // A leftover backup would be mistaken for ours by rollback. Recovery has already run, so it is garbage.
    if plan.aside.exists() {
        fs::remove_dir_all(&plan.aside).ctx("remove stale backup")?;
    }
    write_journal(plan, Step::Started)?;
    fire(hook, Step::Started)?;
    if plan.install.exists() {
        rename_retry(&plan.install, &plan.aside, t)?;
        write_journal(plan, Step::AsideDone)?;
        fire(hook, Step::AsideDone)?;
        let data = plan.aside.join("data");
        if data.exists() {
            rename_retry(&data, &plan.staged.join("data"), t)?;
        }
    }
    rename_retry(&plan.staged, &plan.install, t)?;
    // ponytail: if this journal write fails the new install stays in place with a backup beside it; harmless, cleaned by the next update.
    write_journal(plan, Step::MovedIn)?;
    fire(hook, Step::MovedIn)
}

pub fn commit(plan: &Plan) -> Result<()> {
    if plan.aside.exists() {
        fs::remove_dir_all(&plan.aside).ctx("remove the old install")?;
    }
    let _ = fs::remove_file(ready_marker(&plan.install));
    let _ = fs::remove_file(journal_path(&plan.install));
    Ok(())
}

/// Idempotent. Restores the old install when the journal (or a missing install) says it was moved aside.
pub fn rollback(plan: &Plan, t: &Timing) -> Result<()> {
    let step = read_journal(&plan.install).map(|j| j.step);
    let swapped = matches!(step, Some(Step::AsideDone | Step::MovedIn)) || !plan.install.exists();
    if plan.aside.exists() && swapped {
        let aside_data = plan.aside.join("data");
        if plan.install.exists() {
            let d = plan.install.join("data");
            if d.exists() && !aside_data.exists() {
                rename_retry(&d, &aside_data, t)?;
            }
            fs::remove_dir_all(&plan.install).ctx("remove the failed install")?;
        } else {
            let d = plan.staged.join("data");
            if d.exists() && !aside_data.exists() {
                rename_retry(&d, &aside_data, t)?;
            }
        }
        rename_retry(&plan.aside, &plan.install, t)?;
    }
    if plan.staged.exists() {
        let _ = fs::remove_dir_all(&plan.staged);
    }
    let _ = fs::remove_file(journal_path(&plan.install));
    Ok(())
}

pub fn recover(install: &Path, t: &Timing) -> Result<Recovered> {
    let Some(j) = read_journal(install) else { return Ok(Recovered::Nothing) };
    if j.step == Step::MovedIn && ready_marker(&j.plan.install).exists() {
        commit(&j.plan)?;
        Ok(Recovered::Committed)
    } else {
        rollback(&j.plan, t)?;
        Ok(Recovered::RolledBack)
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test swap`
Expected: 7 passed. (The directory name `Null IDE ünï` also covers Review Focus 4 for the swap.)

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): journaled directory swap with rollback and crash recovery"
```

---

### Task 9: `shellext`, `registrations` and the `-NoElevate` switch

**Files:**
- Create: `setup/core/src/shellext.rs`, `setup/core/src/registrations.rs`, `setup/core/tests/registrations.rs`
- Modify: `setup/core/src/lib.rs`, `scripts/install-null-ide.ps1` (param block near line 21; `Register-Win11ContextMenu` near lines 358-422)

**Interfaces:**
- Consumes: `Ctx` (Task 3).
- Produces:
  - `shellext::explorer_loads_dll(tasklist_csv:&str)->bool` (pure), `shellext::release(ctx:&Ctx)`: if Explorer has `null_explorer_command.dll` loaded, kills Explorer (Windows restarts it) and waits until the DLL is released, up to 10 s. **Only if Task 1 confirmed H2**; if refuted, skip steps 5-6 and `release` is not called from Task 10.
  - `registrations::Registration{Done,NeedsReapproval,Warning(String),Skipped}` (`Clone, Debug, PartialEq`), `registrations::classify(stdout:&str, exit_ok:bool, stderr:&str)->Registration` (pure), `registrations::reapply(install:&Path, ctx:&Ctx)->Registration` (runs `<install>\resources\app\null-updater\install-null-ide.ps1 -ReapplyRegistrations -NoElevate -InstallDir <install>` hidden, 120 s timeout, never errors).
  - Script contract: with `-NoElevate`, when the shell-extension certificate is not trusted in `Cert:\LocalMachine\TrustedPeople`, `Register-Win11ContextMenu` prints `NULL-SETUP: needs-reapproval`, returns, and leaves any existing package registered.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/registrations.rs`:

```rust
use null_setup_core::{
    registrations::{classify, Registration},
    shellext::explorer_loads_dll,
};

#[test]
fn needs_reapproval_marker_wins_even_on_exit_zero() {
    assert_eq!(classify("==> x\nNULL-SETUP: needs-reapproval\nDone.", true, ""), Registration::NeedsReapproval);
}

#[test]
fn clean_run_is_done() {
    assert_eq!(classify("Done.", true, ""), Registration::Done);
}

#[test]
fn failure_reports_the_first_stderr_line() {
    assert_eq!(classify("", false, "\nboom\nmore"), Registration::Warning("boom".into()));
    assert_eq!(classify("", false, ""), Registration::Warning("registration script failed".into()));
}

#[test]
fn recognises_explorer_in_tasklist_output() {
    assert!(explorer_loads_dll("\"explorer.exe\",\"1234\",\"null_explorer_command.dll\"\r\n"));
    assert!(!explorer_loads_dll("INFO: No tasks are running which match the specified criteria.\r\n"));
    assert!(!explorer_loads_dll("\"notexplorer.exe\",\"1\",\"x\"\r\n"));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test registrations`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

Add `pub mod registrations; pub mod shellext;` to `lib.rs`.

`setup/core/src/registrations.rs`:

```rust
use std::{
    os::windows::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::progress::Ctx;

const NO_WINDOW: u32 = 0x0800_0000;
const MARKER: &str = "NULL-SETUP: needs-reapproval";

#[derive(Clone, Debug, PartialEq)]
pub enum Registration { Done, NeedsReapproval, Warning(String), Skipped }

pub fn classify(stdout: &str, exit_ok: bool, stderr: &str) -> Registration {
    if stdout.contains(MARKER) {
        Registration::NeedsReapproval
    } else if exit_ok {
        Registration::Done
    } else {
        let first = stderr.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("registration script failed");
        Registration::Warning(first.to_string())
    }
}

/// Until sub-project 2 ports the registrations to Rust, the script shipped inside the new install does the work.
pub fn reapply(install: &Path, ctx: &Ctx) -> Registration {
    let script = install.join("resources").join("app").join("null-updater").join("install-null-ide.ps1");
    if !script.exists() {
        ctx.log.line("registration script not found; skipping");
        return Registration::Skipped;
    }
    let spawned = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .args(["-ReapplyRegistrations", "-NoElevate", "-InstallDir"])
        .arg(install)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(NO_WINDOW)
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return Registration::Warning(format!("could not start PowerShell: {e}")),
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < Duration::from_secs(120) => thread::sleep(Duration::from_millis(200)),
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

`setup/core/src/shellext.rs`:

```rust
use std::{os::windows::process::CommandExt, process::Command, thread, time::Duration};

use crate::progress::Ctx;

const NO_WINDOW: u32 = 0x0800_0000;
const DLL: &str = "null_explorer_command.dll";

pub fn explorer_loads_dll(tasklist_csv: &str) -> bool {
    tasklist_csv.to_ascii_lowercase().contains("\"explorer.exe\"")
}

fn holds_dll() -> bool {
    Command::new("tasklist")
        .args(["/m", DLL, "/fo", "csv", "/nh"])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| explorer_loads_dll(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or(false)
}

/// Explorer keeps the shell extension DLL loaded from the install directory, which blocks renaming it.
/// Killing Explorer is what the old installer already did; Windows restarts it and it reloads the DLL lazily.
pub fn release(ctx: &Ctx) {
    if !holds_dll() {
        return;
    }
    ctx.log.line("Explorer holds the shell extension; restarting Explorer so the install directory can be renamed");
    let _ = Command::new("taskkill").args(["/F", "/IM", "explorer.exe"]).creation_flags(NO_WINDOW).status();
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(500));
        if !holds_dll() {
            break;
        }
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test registrations`
Expected: 4 passed.

- [ ] **Step 5: Add `-NoElevate` to `scripts/install-null-ide.ps1`**

In the `param(...)` block add after `[switch]$ReapplyRegistrations,`:

```powershell
    [switch]$NoElevate,
```
In `Register-Win11ContextMenu`, directly after `Ensure-NullIDEContextMenuRegistry -InstallDir $installDir` (the line following `$cerPath = ...`), insert:

```powershell
    if ($NoElevate) {
        # Updates never elevate: if the certificate is not already trusted machine-wide, keep the
        # existing registration untouched and let the caller ask for a one-time approval.
        $thumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cerPath)).Thumbprint
        if (-not (Test-Path "Cert:\LocalMachine\TrustedPeople\$thumb")) {
            Write-Host 'NULL-SETUP: needs-reapproval'
            return
        }
    }
```
and inside `if (-not $registered) {`, before the `Write-Host 'Windows requires a one-time UAC...` line, insert:

```powershell
        if ($NoElevate) {
            Write-Host 'NULL-SETUP: needs-reapproval'
            return
        }
```

- [ ] **Step 6: Check the script change by hand**

Run (PowerShell, from the repo root, on a machine where the shell extension is registered):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1 -ReapplyRegistrations -NoElevate -InstallDir "$env:LOCALAPPDATA\Programs\Null IDE"
```
Expected: finishes without a UAC prompt. It prints `NULL-SETUP: needs-reapproval` only when the certificate is not in `Cert:\LocalMachine\TrustedPeople` (verify with `Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Subject -like '*Null*'`), and `Get-AppxPackage NullIDE.ExplorerCommand` is still present afterwards.

- [ ] **Step 7: Commit**

```bash
git add setup scripts/install-null-ide.ps1
git commit -m "feat(setup): re-apply registrations without elevating and unload the Explorer-held shell DLL"
```

---

### Task 10: `update` orchestration (`prefetch`, `update`)

**Files:**
- Create: `setup/core/src/update.rs`, `setup/core/tests/update.rs`
- Modify: `setup/core/src/lib.rs` (`pub mod update;`)

**Interfaces:**
- Consumes: every earlier module (names exactly as listed in Tasks 3-9).
- Produces:
  - `update::Opts{repo,tag:String, install_dir:PathBuf, api_base:String, cache:Cache, http:Http, timing:Timing, launch:bool, reapply:bool, release_shell_ext:bool, ready_timeout:Duration, close_grace:Duration}`; `Opts::standard(repo:String, tag:String, install_dir:PathBuf)->Opts` (reads `NULL_SETUP_API_BASE`, default `https://api.github.com`; `launch`, `reapply` and `release_shell_ext` true).
  - `update::Outcome{pub registration: Registration}`.
  - `update::prefetch(o:&Opts, ctx:&Ctx) -> Result<PathBuf>`: emits `Checking`, download progress, `Verifying`, then `Ready`; on `Err(Busy)` emits `Busy`, on other errors emits `Failed{message,log}`; wait for the cache lock is zero.
  - `update::update(o:&Opts, ctx:&Ctx) -> Result<Outcome>`: runs `swap::recover` first, joins an in-flight download (lock wait 10 min), extracts, writes install metadata (`version = tag`), closes the IDE, unloads Explorer's DLL, swaps, re-applies registrations, launches, waits for the ready marker (or `ready_timeout` alive), commits, prunes the cache. Any failure after the swap rolls back (closing the new IDE first). Emits `Failed` on error.
- Behavior notes: `launch=false` skips launching and commits right after the swap; the spawned `null.exe` gets `current_dir = install_dir` and never inherits `NULL_SETUP_RELOCATED`.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/update.rs`:

```rust
mod support;
use std::{fs, path::{Path, PathBuf}, sync::{atomic::{AtomicUsize, Ordering}, Arc}, time::Duration};

use null_setup_core::{
    config,
    download::Cache,
    http::Http,
    progress::{Ctx, Logger, NoInteract, Progress},
    swap::{journal_path, Timing},
    update::{prefetch, update, Opts},
    Error,
};
use sha2::{Digest, Sha256};

struct World { _tmp: tempfile::TempDir, install: PathBuf, cache: PathBuf, zip: Vec<u8> }

fn world(extra: &[(&str, &[u8])]) -> World {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE ünï");
    fs::create_dir_all(install.join("data")).unwrap();
    fs::write(install.join("old.txt"), "old").unwrap();
    fs::write(install.join("data").join("user.txt"), "mine").unwrap();
    config::write(&install, &config::InstallMeta { repo: "o/r".into(), version: "v1".into(), installed_at: None, install_dir: None }).unwrap();
    let zip_path = tmp.path().join("pkg.zip");
    let mut entries: Vec<(&str, &[u8])> = vec![("null.exe", b"MZ"), ("new.txt", b"new")];
    entries.extend_from_slice(extra);
    support::make_zip(&zip_path, &entries);
    let zip = fs::read(&zip_path).unwrap();
    World { cache: tmp.path().join("cache"), install, zip, _tmp: tmp }
}

fn serve_release(zip: Vec<u8>, sha: String, zip_hits: Arc<AtomicUsize>) -> support::Server {
    support::serve(move |req| match req.url.as_str() {
        "/repos/o/r/releases/tags/v2" => (
            200,
            serde_json::json!({ "assets": [
                { "name": "null-ide-win32-x64.zip", "browser_download_url": format!("{}/zip", req.base), "size": zip.len() },
                { "name": "null-ide-win32-x64.zip.sha256", "browser_download_url": format!("{}/sha", req.base), "size": 64 }
            ]}).to_string().into_bytes(),
            vec![],
        ),
        "/sha" => (200, sha.clone().into_bytes(), vec![]),
        "/zip" => { zip_hits.fetch_add(1, Ordering::SeqCst); (200, zip.clone(), vec![]) }
        _ => (404, vec![], vec![]),
    })
}

fn opts(w: &World, base: &str) -> Opts {
    let mut o = Opts::standard("o/r".into(), "v2".into(), w.install.clone());
    o.api_base = base.into();
    o.cache = Cache { root: w.cache.clone() };
    o.http = Http::with_delay(Duration::from_millis(1));
    o.timing = Timing { retries: 2, delay: Duration::from_millis(1) };
    o.launch = false;
    o.reapply = false;
    o.release_shell_ext = false;
    o.close_grace = Duration::from_millis(500);
    o
}

fn run<T>(f: impl FnOnce(&Ctx) -> T) -> (T, Vec<Progress>) {
    let log = Logger::none();
    let seen = std::sync::Mutex::new(vec![]);
    let progress = |p: Progress| seen.lock().unwrap().push(p);
    let r = f(&Ctx { progress: &progress, log: &log, interact: &NoInteract });
    (r, seen.into_inner().unwrap())
}

fn sha(b: &[u8]) -> String { format!("{:x}  null-ide-win32-x64.zip", Sha256::digest(b)) }
fn assert_old(install: &Path) {
    assert!(install.join("old.txt").exists() && !install.join("new.txt").exists());
    assert_eq!(fs::read_to_string(install.join("data").join("user.txt")).unwrap(), "mine");
}

#[test]
fn update_installs_the_new_version_keeps_data_and_prunes_the_cache() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    fs::create_dir_all(w.cache.join("v0-old")).unwrap();
    let (r, seen) = run(|c| update(&opts(&w, &srv.base), c));
    r.unwrap();
    assert!(w.install.join("new.txt").exists() && !w.install.join("old.txt").exists());
    assert_eq!(fs::read_to_string(w.install.join("data").join("user.txt")).unwrap(), "mine");
    let meta = config::read(&w.install).unwrap();
    assert_eq!((meta.version.as_str(), meta.repo.as_str()), ("v2", "o/r"));
    assert!(!journal_path(&w.install).exists());
    assert!(!w.cache.join("v0-old").exists());
    for s in [Progress::Checking, Progress::Preparing, Progress::Installing] { assert!(seen.contains(&s), "{s:?}"); }
}

#[test]
fn prefetch_then_update_downloads_the_zip_only_once() {
    let w = world(&[]);
    let hits = Arc::new(AtomicUsize::new(0));
    let srv = serve_release(w.zip.clone(), sha(&w.zip), hits.clone());
    let o = opts(&w, &srv.base);
    let (r, seen) = run(|c| prefetch(&o, c));
    r.unwrap();
    assert_eq!(seen.last(), Some(&Progress::Ready));
    run(|c| update(&o, c)).0.unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[test]
fn a_bad_checksum_fails_the_update_and_leaves_the_old_install_untouched() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), format!("{}  x", "0".repeat(64)), Arc::new(AtomicUsize::new(0)));
    let (r, seen) = run(|c| update(&opts(&w, &srv.base), c));
    assert!(matches!(r, Err(Error::Checksum { .. })));
    assert_old(&w.install);
    assert!(matches!(seen.last(), Some(Progress::Failed { .. })));
}

#[test]
fn an_unknown_tag_reports_the_http_status() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.tag = "v9".into();
    let (r, _) = run(|c| update(&o, c));
    assert!(matches!(r, Err(Error::Http { status: 404, .. })));
    assert_old(&w.install);
}

#[test]
fn a_new_ide_that_exits_at_once_is_rolled_back() {
    // PING.EXE as null.exe prints usage and exits immediately, like a broken build.
    let ping = fs::read(r"C:\Windows\System32\PING.EXE").unwrap();
    let w = world(&[]);
    let zip_path = w._tmp.path().join("broken.zip");
    support::make_zip(&zip_path, &[("null.exe", &ping), ("new.txt", b"new")]);
    let zip = fs::read(&zip_path).unwrap();
    let srv = serve_release(zip.clone(), sha(&zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.launch = true;
    o.ready_timeout = Duration::from_secs(5);
    let (r, _) = run(|c| update(&o, c));
    assert!(r.is_err());
    assert_old(&w.install);
    assert!(!journal_path(&w.install).exists());
}

#[test]
fn a_new_ide_that_wrote_its_ready_marker_is_committed() {
    let ping = fs::read(r"C:\Windows\System32\PING.EXE").unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let zip_path = tmp.path().join("ok.zip");
    support::make_zip(&zip_path, &[("null.exe", &ping), ("new.txt", b"new"), (".null-ready", b"1")]);
    let zip = fs::read(&zip_path).unwrap();
    let w = world(&[]);
    let srv = serve_release(zip.clone(), sha(&zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.launch = true;
    o.ready_timeout = Duration::from_secs(5);
    run(|c| update(&o, c)).0.unwrap();
    assert!(w.install.join("new.txt").exists());
    assert!(!journal_path(&w.install).exists());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core --test update`
Expected: FAIL to compile (`update` not found).

- [ ] **Step 3: Implement**

Add `pub mod update;` to `lib.rs`. `setup/core/src/update.rs`:

```rust
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::{
    config::{self, InstallMeta},
    disk,
    download::{self, Cache},
    error::{Error, IoCtx, Result},
    extract,
    http::Http,
    procs, registrations,
    progress::{Ctx, Progress},
    registrations::Registration,
    release::{self, Release},
    shellext,
    swap::{self, Hook, Plan, Timing},
};

pub struct Opts {
    pub repo: String,
    pub tag: String,
    pub install_dir: PathBuf,
    pub api_base: String,
    pub cache: Cache,
    pub http: Http,
    pub timing: Timing,
    pub launch: bool,
    pub reapply: bool,
    pub release_shell_ext: bool,
    pub ready_timeout: Duration,
    pub close_grace: Duration,
}

impl Opts {
    pub fn standard(repo: String, tag: String, install_dir: PathBuf) -> Opts {
        Opts {
            repo,
            tag,
            install_dir,
            // Test seam for scripts/fake-release.mjs; a local attacker who controls the environment already owns the user.
            api_base: std::env::var("NULL_SETUP_API_BASE").unwrap_or_else(|_| "https://api.github.com".into()),
            cache: Cache::standard(),
            http: Http::standard(),
            timing: Timing::STANDARD,
            launch: true,
            reapply: true,
            release_shell_ext: true,
            ready_timeout: Duration::from_secs(30),
            close_grace: Duration::from_secs(15),
        }
    }
}

pub struct Outcome { pub registration: Registration }

fn report<T>(r: Result<T>, ctx: &Ctx) -> Result<T> {
    if let Err(e) = &r {
        ctx.log.line(&format!("failed: {e}"));
        match e {
            Error::Busy => ctx.emit(Progress::Busy),
            _ => ctx.emit(Progress::Failed {
                message: e.to_string(),
                log: ctx.log.path().map(|p| p.display().to_string()),
            }),
        }
    }
    r
}

fn fetch_verified(o: &Opts, wait: Duration, ctx: &Ctx) -> Result<(Release, PathBuf)> {
    ctx.emit(Progress::Checking);
    let rel = release::resolve(&o.http, &o.api_base, &o.repo, &o.tag)?;
    let sha = release::parse_sha256(&o.http.get_text(&rel.sha256_url)?)?;
    disk::ensure(&o.cache.root, rel.zip_size)?;
    let zip = download::fetch(&o.http, &o.cache, &rel, &sha, wait, ctx)?;
    Ok((rel, zip))
}

pub fn prefetch(o: &Opts, ctx: &Ctx) -> Result<PathBuf> {
    let r = fetch_verified(o, Duration::ZERO, ctx).map(|(_, zip)| zip);
    if r.is_ok() {
        ctx.emit(Progress::Ready);
    }
    report(r, ctx)
}

pub fn update(o: &Opts, ctx: &Ctx) -> Result<Outcome> {
    report(run_update(o, ctx), ctx)
}

fn run_update(o: &Opts, ctx: &Ctx) -> Result<Outcome> {
    swap::recover(&o.install_dir, &o.timing)?;
    let (rel, zip) = fetch_verified(o, Duration::from_secs(600), ctx)?;

    let plan = swap::plan_for(&o.install_dir, &o.tag);
    let parent = o.install_dir.parent().unwrap_or(Path::new("."));
    disk::ensure(parent, rel.zip_size * 3)?;
    if plan.staged.exists() {
        fs::remove_dir_all(&plan.staged).ctx("remove stale staging directory")?;
    }
    extract::extract(&zip, &plan.staged, ctx)?;
    config::write(
        &plan.staged,
        &InstallMeta {
            repo: o.repo.clone(),
            version: o.tag.clone(),
            installed_at: Some(config::now_iso()),
            install_dir: Some(o.install_dir.display().to_string()),
        },
    )?;

    if let Err(e) = prepare_swap(o, ctx) {
        let _ = fs::remove_dir_all(&plan.staged);
        return Err(e);
    }

    ctx.emit(Progress::Installing);
    swap::swap(&plan, &o.timing, &mut |_| Hook::Continue)?;

    match finish(o, &plan, ctx) {
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

fn prepare_swap(o: &Opts, ctx: &Ctx) -> Result<()> {
    procs::close_all(&o.install_dir, ctx, o.close_grace)?;
    if o.release_shell_ext {
        shellext::release(ctx);
    }
    Ok(())
}

fn finish(o: &Opts, plan: &Plan, ctx: &Ctx) -> Result<Outcome> {
    let registration = if o.reapply { registrations::reapply(&o.install_dir, ctx) } else { Registration::Skipped };
    if o.launch {
        ctx.emit(Progress::Restarting);
        let mut child = launch(&o.install_dir)?;
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

fn launch(install: &Path) -> Result<Child> {
    Command::new(install.join("null.exe"))
        .current_dir(install)
        .env_remove("NULL_SETUP_RELOCATED")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ctx("start the new Null IDE")
}

fn wait_ready(child: &mut Child, marker: &Path, timeout: Duration) -> Result<()> {
    let start = Instant::now();
    loop {
        if marker.exists() {
            return Ok(());
        }
        if let Some(status) = child.try_wait().ctx("check the new Null IDE")? {
            return Err(Error::Other(format!("the new Null IDE exited right after the update ({status})")));
        }
        if start.elapsed() >= timeout {
            return Ok(()); // still alive after the grace period counts as started
        }
        thread::sleep(Duration::from_millis(250));
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup-core`
Expected: every core test passes (config, http, release, download, procs, extract, swap, registrations, update). If `a_new_ide_that_exits_at_once_is_rolled_back` is flaky because PING.EXE lingers, raise nothing: the test passes when `try_wait` reports an exit before the 250 ms poll finds the marker; if PING takes longer than the first poll, change the stand-in to `cmd.exe /c exit` copy semantics only if needed and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): prefetch and update orchestration with rollback"
```

---

### Task 11: The `null-setup` app (args, headless modes, relocation, progress window)

**Files:**
- Create: `setup/app/{Cargo.toml,build.rs,tauri.conf.json}`, `setup/app/capabilities/default.json`, `setup/app/icons/icon.ico` (copy of `icons/icon.ico`), `setup/app/src/{main,args,headless,relocate,window}.rs`, `setup/ui/{index.html,main.js,style.css}`
- Replace: the stub `setup/app/Cargo.toml` and `setup/app/src/main.rs` from Task 3
- Test: unit tests inside `setup/app/src/args.rs` and `setup/app/src/relocate.rs`

**Interfaces:**
- Consumes: `update::{Opts, prefetch, update, Outcome}`, `swap::{recover, Timing}`, `progress::{Ctx, Interact, LockedChoice, Logger, NoInteract, Progress, logs_dir}`, `procs::{Running, is_under}`, `registrations::Registration`, `local_app_data()`.
- Produces (CLI contract used by null-tools in Task 14):
  - `null-setup prefetch --repo <o/r> --version <tag> --install-dir <dir>`: no window; one JSON `Progress` object per stdout line; exit 0 on success **and** on `busy`, 1 on failure.
  - `null-setup update --repo <o/r> --version <tag> --install-dir <dir> [--launch]`: relocates itself to `%LOCALAPPDATA%\Null\updates\run\` when running from inside the install dir, then shows the progress window.
  - `null-setup recover --install-dir <dir>`: runs `swap::recover`, no window.
  - Tauri commands for the page: `action(name: "retry"|"force"|"cancel")`, `diagnostics() -> String`, `quit()`; events `progress` (payload = `Progress` JSON) and `locked` (payload = process names).
  - Deviation from the spec: no `--wait` flag; `update` always requests the IDE to close and waits.

- [ ] **Step 1: Write the failing tests**

At the bottom of the new `setup/app/src/args.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> std::result::Result<Args, String> { parse(s.split_whitespace().map(String::from)) }

    #[test]
    fn parses_update() {
        let a = p("update --repo o/r --version v1.2.3 --install-dir C:\\x --launch").unwrap();
        assert_eq!(a.mode, Mode::Update);
        assert_eq!((a.repo.as_str(), a.tag.as_str()), ("o/r", "v1.2.3"));
        assert!(a.launch);
    }

    #[test]
    fn repo_defaults_and_launch_is_off_by_default() {
        let a = p("prefetch --version v1 --install-dir C:\\x").unwrap();
        assert_eq!((a.repo.as_str(), a.launch), ("TorresVisual/null-ide", false));
    }

    #[test]
    fn rejects_missing_unknown_and_unsafe_input() {
        assert!(p("update --install-dir C:\\x").is_err());          // no version
        assert!(p("update --version v1").is_err());                 // no install dir
        assert!(p("update --version v1 --install-dir C:\\x --bogus").is_err());
        assert!(p("frobnicate").is_err());
        assert!(p("update --version ..\\evil --install-dir C:\\x").is_err()); // tag becomes a directory name
        assert!(p("update --version a/b --install-dir C:\\x").is_err());
    }

    #[test]
    fn recover_needs_no_version() {
        assert_eq!(p("recover --install-dir C:\\x").unwrap().mode, Mode::Recover);
    }

    #[test]
    fn install_dir_may_contain_spaces_when_passed_as_one_argument() {
        let a = parse(["update", "--version", "v1", "--install-dir", "C:\\Null IDE ünï"].map(String::from)).unwrap();
        assert_eq!(a.install_dir.to_string_lossy(), "C:\\Null IDE ünï");
    }
}
```
At the bottom of `setup/app/src/relocate.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn relocates_only_from_inside_the_install_dir_and_only_once() {
        let install = Path::new(r"C:\Programs\Null IDE");
        assert!(needs_relocation(Path::new(r"C:\Programs\Null IDE\setup\null-setup.exe"), install, false));
        assert!(!needs_relocation(Path::new(r"C:\Programs\Null IDE\setup\null-setup.exe"), install, true));
        assert!(!needs_relocation(Path::new(r"C:\Temp\null-setup.exe"), install, false));
    }
}
```

- [ ] **Step 2: Create the crate files and see the tests fail**

`setup/app/Cargo.toml`:

```toml
[package]
name = "null-setup"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
null-setup-core = { path = "../core" }
tauri = { version = "2", features = [] }
serde_json = "1"

[features]
# Embeds the UI assets instead of looking for a dev server. Needed because CI runs plain `cargo build --release`.
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```
`setup/app/build.rs`: `fn main() { tauri_build::build() }`. Copy `icons/icon.ico` to `setup/app/icons/icon.ico`.

`setup/app/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Null Setup",
  "version": "0.1.0",
  "identifier": "dev.null-ide.setup",
  "build": { "frontendDist": "../ui" },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      { "label": "main", "title": "Null IDE Update", "width": 460, "height": 300, "resizable": false, "visible": false, "center": true }
    ],
    "security": { "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'" }
  },
  "bundle": { "active": false, "icon": ["icons/icon.ico"] }
}
```
`setup/app/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```
Write `args.rs` and `relocate.rs` with only their test modules, a stub `main.rs` (`mod args; mod relocate; fn main() {}`), then run:

Run: `cargo test --manifest-path setup/Cargo.toml -p null-setup`
Expected: FAIL to compile (`parse`, `Mode`, `needs_relocation` not found).

- [ ] **Step 3: Implement**

`setup/app/src/args.rs` (above the test module):

```rust
use std::path::PathBuf;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Mode { Prefetch, Update, Recover }

#[derive(Debug)]
pub struct Args {
    pub mode: Mode,
    pub repo: String,
    pub tag: String,
    pub install_dir: PathBuf,
    pub launch: bool,
}

/// Tags become directory names (`.null-ide-stage-<tag>`), so only a conservative character set is accepted.
fn safe_tag(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) && !t.contains("..")
}

pub fn parse<I: IntoIterator<Item = String>>(it: I) -> Result<Args, String> {
    let mut it = it.into_iter();
    let mode = match it.next().as_deref() {
        Some("prefetch") => Mode::Prefetch,
        Some("update") => Mode::Update,
        Some("recover") => Mode::Recover,
        other => return Err(format!("unknown or missing mode: {other:?} (expected prefetch, update or recover)")),
    };
    let (mut repo, mut tag, mut install_dir, mut launch) = ("TorresVisual/null-ide".to_string(), String::new(), None, false);
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match flag.as_str() {
            "--repo" => repo = value("--repo")?,
            "--version" => tag = value("--version")?,
            "--install-dir" => install_dir = Some(PathBuf::from(value("--install-dir")?)),
            "--launch" => launch = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    let install_dir = install_dir.ok_or("--install-dir is required")?;
    if mode != Mode::Recover && !safe_tag(&tag) {
        return Err("--version is required and may only contain letters, digits, '.', '-' and '_'".into());
    }
    Ok(Args { mode, repo, tag, install_dir, launch })
}
```
`setup/app/src/relocate.rs` (above the test module):

```rust
use std::{env, fs, path::Path, process::Command};

use null_setup_core::{local_app_data, procs::is_under};

use crate::args::Args;

const FLAG: &str = "NULL_SETUP_RELOCATED";

pub fn needs_relocation(exe: &Path, install_dir: &Path, already: bool) -> bool {
    !already && is_under(exe, install_dir)
}

/// The install directory is about to be renamed, so the running exe must not live in it.
pub fn maybe_relocate(a: &Args) {
    let Ok(exe) = env::current_exe() else { return };
    if !needs_relocation(&exe, &a.install_dir, env::var_os(FLAG).is_some()) {
        return;
    }
    let dir = local_app_data().join("Null").join("updates").join("run");
    let _ = fs::create_dir_all(&dir);
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = fs::remove_file(e.path()); // copies from earlier updates; a running one stays locked
        }
    }
    let copy = dir.join(format!("null-setup-{}.exe", std::process::id()));
    if fs::copy(&exe, &copy).is_err() {
        return; // run in place; the swap reports a clear error if the exe is locked
    }
    if Command::new(&copy).args(env::args().skip(1)).env(FLAG, "1").spawn().is_ok() {
        std::process::exit(0);
    }
}
```
`setup/app/src/headless.rs`:

```rust
use std::io::Write;

use null_setup_core::{
    progress::{logs_dir, Ctx, Logger, NoInteract, Progress},
    swap::{self, Timing},
    update::{self, Opts},
    Error,
};

use crate::args::Args;

pub fn prefetch(a: &Args) -> i32 {
    let log = Logger::open(&logs_dir());
    let emit = |p: Progress| {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{}", serde_json::to_string(&p).unwrap_or_default());
        let _ = out.flush();
    };
    let ctx = Ctx { progress: &emit, log: &log, interact: &NoInteract };
    match update::prefetch(&Opts::standard(a.repo.clone(), a.tag.clone(), a.install_dir.clone()), &ctx) {
        Ok(_) | Err(Error::Busy) => 0,
        Err(_) => 1,
    }
}

pub fn recover(a: &Args) -> i32 {
    let log = Logger::open(&logs_dir());
    match swap::recover(&a.install_dir, &Timing::STANDARD) {
        Ok(r) => {
            log.line(&format!("recover: {r:?}"));
            0
        }
        Err(e) => {
            log.line(&format!("recover failed: {e}"));
            1
        }
    }
}
```
`setup/app/src/window.rs`:

```rust
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

use null_setup_core::{
    procs::Running,
    progress::{logs_dir, Ctx, Interact, LockedChoice, Logger, Progress},
    registrations::Registration,
    update::{self, Opts},
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::args::Args;

static FINISHED: AtomicBool = AtomicBool::new(false);

enum Action { Retry, ForceClose, Cancel }
struct Channel(Mutex<mpsc::Sender<Action>>);

#[tauri::command]
fn action(name: String, ch: State<Channel>) {
    let a = match name.as_str() { "retry" => Action::Retry, "force" => Action::ForceClose, _ => Action::Cancel };
    let _ = ch.0.lock().unwrap().send(a);
}

#[tauri::command]
fn diagnostics(log: State<Arc<Logger>>) -> String { log.tail(80) }

#[tauri::command]
fn quit(app: AppHandle) { app.exit(0) }

struct UiInteract<'a> { app: &'a AppHandle, rx: &'a mpsc::Receiver<Action> }

impl Interact for UiInteract<'_> {
    fn locked(&self, running: &[Running]) -> LockedChoice {
        let names: Vec<_> = running.iter().map(|r| r.name.clone()).collect();
        let _ = self.app.emit("locked", names);
        match self.rx.recv() {
            Ok(Action::Retry) => LockedChoice::Retry,
            Ok(Action::ForceClose) => LockedChoice::ForceClose,
            _ => LockedChoice::Cancel,
        }
    }
}

fn worker(app: AppHandle, args: Args, log: Arc<Logger>, rx: mpsc::Receiver<Action>) {
    let emit = |p: Progress| { let _ = app.emit("progress", &p); };
    let interact = UiInteract { app: &app, rx: &rx };
    let ctx = Ctx { progress: &emit, log: &log, interact: &interact };
    let mut opts = Opts::standard(args.repo.clone(), args.tag.clone(), args.install_dir.clone());
    opts.launch = args.launch;
    let result = update::update(&opts, &ctx);
    FINISHED.store(true, Ordering::SeqCst);
    match result {
        Ok(o) if o.registration == Registration::NeedsReapproval => {} // the page stays open with its note
        Ok(_) => {
            std::thread::sleep(Duration::from_secs(2));
            app.exit(0);
        }
        Err(_) => {} // Failed was already emitted; the page offers Copy diagnostics and Close
    }
}

pub fn run_update(args: Args) -> i32 {
    let (tx, rx) = mpsc::channel::<Action>();
    let log = Arc::new(Logger::open(&logs_dir()));
    let worker_log = log.clone();
    let mut slot = Some((args, rx));
    tauri::Builder::default()
        .manage(Channel(Mutex::new(tx)))
        .manage(log)
        .invoke_handler(tauri::generate_handler![action, diagnostics, quit])
        // Closing the window mid-swap would leave a half-installed app.
        .on_window_event(|_, ev| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                if !FINISHED.load(Ordering::SeqCst) {
                    api.prevent_close();
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            if let Some((args, rx)) = slot.take() {
                std::thread::spawn(move || worker(handle, args, worker_log, rx));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the update window");
    0
}
```
`setup/app/src/main.rs`:

```rust
#![cfg_attr(windows, windows_subsystem = "windows")]

mod args;
mod headless;
mod relocate;
mod window;

use args::Mode;

fn main() {
    let args = match args::parse(std::env::args().skip(1)) {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("null-setup: {msg}");
            std::process::exit(2);
        }
    };
    let code = match args.mode {
        Mode::Prefetch => headless::prefetch(&args),
        Mode::Recover => headless::recover(&args),
        Mode::Update => {
            relocate::maybe_relocate(&args);
            window::run_update(args)
        }
    };
    std::process::exit(code);
}
```
UI. `setup/ui/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Null IDE Update</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1 id="title">Updating Null IDE</h1>
    <p id="status">Starting…</p>
    <progress id="bar" max="100" hidden></progress>
    <p id="detail"></p>
    <div id="actions">
      <button id="retry" hidden>Retry</button>
      <button id="force" hidden>Close Null IDE</button>
      <button id="cancel" hidden>Cancel update</button>
      <button id="copy" hidden>Copy diagnostics</button>
      <button id="close" hidden>Close</button>
    </div>
  </main>
  <script src="main.js"></script>
</body>
</html>
```
`setup/ui/main.js`:

```js
const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);
const LABEL = {
  checking: 'Checking for the update…',
  downloading: 'Downloading…',
  verifying: 'Verifying the download…',
  preparing: 'Preparing files…',
  waitingForClose: 'Waiting for Null IDE to close…',
  installing: 'Installing…',
  restarting: 'Starting Null IDE…',
  busy: 'Another download is already running.',
  needsReapproval: 'Updated. The Windows 11 context menu needs one-time administrator approval; run the Null IDE installer to enable it.',
};
const mb = (n) => (n / 1048576).toFixed(1);

function show(...ids) {
  for (const b of document.querySelectorAll('#actions button')) b.hidden = !ids.includes(b.id);
}

function render(p) {
  $('bar').hidden = p.state !== 'downloading';
  $('detail').textContent = '';
  if (p.state === 'downloading') {
    $('bar').value = p.total ? (p.bytes / p.total) * 100 : 0;
    $('detail').textContent = `${mb(p.bytes)} of ${mb(p.total)} MB (${mb(p.bytesPerSec)} MB/s)`;
  }
  if (p.state === 'failed') {
    $('title').textContent = 'Update failed';
    $('status').textContent = p.message;
    $('detail').textContent = p.log ? `Log: ${p.log}` : '';
    return show('copy', 'close');
  }
  $('status').textContent = LABEL[p.state] ?? p.state;
  if (p.state === 'needsReapproval') return show('close');
  show();
}

listen('progress', (e) => render(e.payload));
listen('locked', (e) => {
  $('status').textContent = `Null IDE is still running (${e.payload.join(', ')}). Save your work and close it, or use Close Null IDE.`;
  show('retry', 'force', 'cancel');
});
$('retry').onclick = () => { show(); invoke('action', { name: 'retry' }); };
$('force').onclick = () => { show(); invoke('action', { name: 'force' }); };
$('cancel').onclick = () => { show(); invoke('action', { name: 'cancel' }); };
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(await invoke('diagnostics'));
  $('copy').textContent = 'Copied';
};
$('close').onclick = () => invoke('quit');
```
`setup/ui/style.css`:

```css
html, body { margin: 0; height: 100%; background: #0e0e10; color: #e6e6e6; font: 14px "Segoe UI", sans-serif; }
main { padding: 28px; display: flex; flex-direction: column; gap: 12px; }
h1 { font-size: 18px; margin: 0; font-weight: 600; }
p { margin: 0; line-height: 1.4; word-break: break-word; }
#detail { color: #9a9a9f; font-size: 12px; }
progress { width: 100%; height: 6px; accent-color: #e6e6e6; }
#actions { display: flex; gap: 8px; margin-top: 8px; }
button { background: #26262b; color: inherit; border: 1px solid #3a3a40; padding: 6px 14px; border-radius: 4px; font: inherit; cursor: pointer; }
button:hover { background: #303036; }
```

- [ ] **Step 4: Run to verify tests pass and the app builds**

Run:
```bash
cargo test --manifest-path setup/Cargo.toml -p null-setup
cargo build --manifest-path setup/Cargo.toml --release --locked -p null-setup
```
Expected: 6 tests pass. (`--locked` needs the lockfile from a prior non-locked `cargo build` or `cargo generate-lockfile --manifest-path setup/Cargo.toml`.) Output exists at `setup/target/release/null-setup.exe`.

- [ ] **Step 5: Smoke-test the window and headless mode**

1. Start the fake release server (Task 12 creates it; if running tasks in order, do this step after Task 12 step 3). Otherwise check headless only:
   `setup\target\release\null-setup.exe prefetch --version v0.0.0-nonexistent --install-dir C:\nope` → exits 1, stdout shows one `{"state":"checking"}` line and one `{"state":"failed",...}` line (run it from a console with `| more` to see the output; the exe is a GUI-subsystem binary, so use `cmd /c "setup\target\release\null-setup.exe prefetch ... | more"`).
2. Verify the exe has no side DLL: copy only `null-setup.exe` to an empty temp folder and run `update --version v1 --install-dir C:\nope`; the window must open (WebView2 loader is statically linked). If a loader DLL is required, copy it next to the exe in `relocate.rs` and in CI packaging.

- [ ] **Step 6: Commit**

```bash
git add setup
git commit -m "feat(setup): null-setup app with headless prefetch/recover and a progress window for update"
```

---

### Task 12: CI, local scripts and the fake release server

**Files:**
- Create: `scripts/fake-release.mjs`
- Modify: `.github/workflows/build.yml` (the "Build null-updater" and "Prepare installer and updater payload" steps near lines 710-740; add a test step before the build), `scripts/build-local.ps1` (lines ~802-814), `scripts/sync-local.ps1` (lines ~161 and ~636-669), `.gitignore` (remove `updater/build/`)

**Interfaces:**
- Consumes: `setup/target/release/null-setup.exe` (Task 11).
- Produces: release zip contains `setup/null-setup.exe` and `resources/app/null-updater/install-null-ide.ps1` (no `null-updater.exe`, no `update-null-ide.ps1`); `node scripts/fake-release.mjs --zip <file> --tag <tag> [--port 8787] [--throttle <KB/s>] [--cut-after <bytes>]` serves `/repos/*/*/releases/tags/<tag>`, `/zip` (Range-capable) and `/zip.sha256` for `NULL_SETUP_API_BASE=http://127.0.0.1:<port>`.

- [ ] **Step 1: Create `scripts/fake-release.mjs`**

```js
// Local stand-in for the GitHub Releases API, for the manual update matrix.
//   node scripts/fake-release.mjs --zip <file> --tag v9.9.9 [--port 8787] [--throttle <KB/s>] [--cut-after <bytes>]
// Start Null IDE from a terminal with NULL_SETUP_API_BASE=http://127.0.0.1:<port> to point the updater at it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const zip = arg('zip');
const tag = arg('tag');
const port = Number(arg('port', 8787));
const throttle = Number(arg('throttle', 0));
let cutAfter = Number(arg('cut-after', 0));
if (!zip || !tag) {
  console.error('usage: --zip <file> --tag <tag> [--port n] [--throttle KB/s] [--cut-after bytes]');
  process.exit(2);
}

const name = 'null-ide-win32-x64.zip';
const size = fs.statSync(zip).size;
const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
const base = `http://127.0.0.1:${port}`;

http.createServer((req, res) => {
  console.log(req.method, req.url, req.headers.range ?? '');
  if (/^\/repos\/[^/]+\/[^/]+\/releases\/tags\//.test(req.url)) {
    if (!req.url.endsWith(`/releases/tags/${tag}`)) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({
      tag_name: tag, html_url: base, body: 'fake release',
      assets: [
        { name, browser_download_url: `${base}/zip`, size },
        { name: `${name}.sha256`, browser_download_url: `${base}/zip.sha256`, size: 64 },
      ],
    }));
  }
  if (req.url === '/zip.sha256') return res.end(`${sha}  ${name}`);
  if (req.url === '/zip') {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    res.statusCode = m ? 206 : 200;
    if (m) res.setHeader('content-range', `bytes ${start}-${size - 1}/${size}`);
    res.setHeader('content-length', size - start);
    let sent = 0;
    const stream = fs.createReadStream(zip, { start });
    stream.on('data', (chunk) => {
      if (cutAfter && sent + chunk.length > cutAfter) { // cut the connection once, so the client has to resume
        cutAfter = 0;
        stream.destroy();
        res.destroy();
        return;
      }
      sent += chunk.length;
      res.write(chunk);
      if (throttle) {
        stream.pause();
        setTimeout(() => stream.resume(), (chunk.length / (throttle * 1024)) * 1000);
      }
    });
    stream.on('end', () => res.end());
    return;
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(port, '127.0.0.1', () => console.log(`fake release ${tag} on ${base}`));
```

- [ ] **Step 2: Edit `.github/workflows/build.yml`**

Replace the step `- name: Build null-updater` (the whole step, 4 lines of `run`) with:

```yaml
      - name: Test null-setup
        shell: pwsh
        working-directory: ide-overlay/setup
        run: cargo test --locked -p null-setup-core

      - name: Build null-setup
        shell: pwsh
        working-directory: ide-overlay/setup
        run: cargo build --release --locked -p null-setup
```
Replace the step `Prepare installer and updater payload` header and the three copy lines. The step becomes:

```yaml
      - name: Prepare installer payload
        shell: pwsh
        run: |
          $outDir = "VSCode-win32-x64"
          $version = '${{ github.ref_name }}'
          if ('${{ github.ref_type }}' -ne 'tag') {
            $version = '${{ steps.tag.outputs.tag }}'
          }

          # Registration script, run by null-setup after an update until sub-project 2 ports it to Rust.
          $payloadDir = Join-Path $outDir "resources/app/null-updater"
          New-Item -ItemType Directory -Path $payloadDir -Force | Out-Null
          Copy-Item ide-overlay/scripts/install-null-ide.ps1 $payloadDir -Force

          $setupDir = Join-Path $outDir "setup"
          New-Item -ItemType Directory -Path $setupDir -Force | Out-Null
          Copy-Item ide-overlay/setup/target/release/null-setup.exe $setupDir -Force

          $metadata = [ordered]@{
            repo        = '${{ github.repository }}'
            version     = $version
            installedAt = $null
            installDir  = $null
          }
          $metadata | ConvertTo-Json | Set-Content (Join-Path $outDir ".null-ide-install.json") -Encoding UTF8
          Write-Host "Prepared update metadata for $version"
```
(Keep the metadata block exactly as it was; only the step name and the copy lines change.)

- [ ] **Step 3: Mirror the change in the local scripts**

Open `scripts/build-local.ps1` around lines 802-814: replace the cmake updater build with `cargo build --release --locked -p null-setup` run with `-WorkingDirectory`/`Push-Location (Join-Path $RepoRoot "setup")` (use the script's `Invoke-Native` helper like the neighbouring cmake calls), drop the copies of `update-null-ide.ps1` and `null-updater.exe`, and copy `setup/target/release/null-setup.exe` to `$OutDir/setup/`.

Open `scripts/sync-local.ps1` lines ~161 (path to `null-updater.exe`) and ~636-669 ("Syncing updater"): replace with a step that copies `setup\target\release\null-setup.exe` to `<install dir>\setup\null-setup.exe` (create the folder; warn, do not fail, when the exe is not built) and still syncs `scripts\install-null-ide.ps1` into `resources\app\null-updater\`; delete the `update-null-ide.ps1` and `null-updater.exe` copies. Update the header comment at line 14 ("Null updater scripts + native updater") to "null-setup.exe + registration script".

Remove the `updater/build/` line from `.gitignore`.

- [ ] **Step 4: Check the pieces**

```bash
node scripts/fake-release.mjs --zip nonexistent.zip --tag v1   # expect a stat error: the file check runs first
git diff --stat .github scripts .gitignore
cargo test --manifest-path setup/Cargo.toml -p null-setup-core
```
Expected: the diff touches only the named files; all core tests pass. Review the YAML indentation against the neighbouring steps (two-space steps under `steps:`).

- [ ] **Step 5: Commit**

```bash
git add scripts/fake-release.mjs .github/workflows/build.yml scripts/build-local.ps1 scripts/sync-local.ps1 .gitignore
git commit -m "build(setup): build and ship null-setup instead of the C++ updater; add a fake release server"
```

---

### Task 13: null-tools: pure update-status helpers

**Files:**
- Create: `extensions/null-tools/src/updateStatus.ts`, `extensions/null-tools/src/updateStatus.test.ts`
- Modify: `extensions/null-tools/package.json` (`test` script: add `out/updateStatus.test.js`)

**Interfaces:**
- Consumes: the JSON `Progress` lines printed by `null-setup prefetch` (Task 11; field names are camelCase: `state`, `bytes`, `total`, `bytesPerSec`, `processes`, `message`, `log`).
- Produces (used by Task 14):
  - `type Progress` (union on `state`), `parseProgressLine(line: string): Progress | undefined`.
  - `interface StatusView { text: string; tooltip: string }`, `statusFor(version: string, p: Progress | undefined, ready: boolean): StatusView`, `formatBytes(n: number): string`.
  - `isSafeTag(tag: string): boolean` (same rule as the Rust `--version` check).
  - `shouldAcknowledge(journalText: string | undefined): boolean` (true only when the update journal's step is `MovedIn`).

- [ ] **Step 1: Write the failing test**

`extensions/null-tools/src/updateStatus.test.ts`:

```ts
import assert from 'node:assert';
import test from 'node:test';
import { formatBytes, isSafeTag, parseProgressLine, shouldAcknowledge, statusFor } from './updateStatus';

test('parseProgressLine reads the lines null-setup prints', () => {
  assert.deepStrictEqual(parseProgressLine('{"state":"checking"}'), { state: 'checking' });
  assert.deepStrictEqual(
    parseProgressLine('{"state":"downloading","bytes":50,"total":200,"bytesPerSec":10}'),
    { state: 'downloading', bytes: 50, total: 200, bytesPerSec: 10 },
  );
  assert.deepStrictEqual(
    parseProgressLine('{"state":"failed","message":"HTTP 404 from x","log":null}'),
    { state: 'failed', message: 'HTTP 404 from x', log: undefined },
  );
  assert.deepStrictEqual(parseProgressLine('{"state":"ready"}'), { state: 'ready' });
});

test('parseProgressLine ignores noise and unknown states', () => {
  assert.strictEqual(parseProgressLine('not json'), undefined);
  assert.strictEqual(parseProgressLine('null'), undefined);
  assert.strictEqual(parseProgressLine('{"state":"mystery"}'), undefined);
  assert.strictEqual(parseProgressLine('{"state":"downloading"}'), undefined);
});

test('statusFor maps every state to a status item', () => {
  assert.match(statusFor('v2', undefined, true).text, /Restart to update/);
  assert.match(statusFor('v2', { state: 'downloading', bytes: 50, total: 200, bytesPerSec: 1048576 }, false).text, /v2 25%/);
  assert.match(statusFor('v2', { state: 'downloading', bytes: 50, total: 0, bytesPerSec: 0 }, false).text, /v2 0%/);
  assert.match(statusFor('v2', { state: 'verifying' }, false).text, /Verifying/);
  const failed = statusFor('v2', { state: 'failed', message: 'boom', log: 'C:\\l.log' }, false);
  assert.match(failed.text, /failed/);
  assert.match(failed.tooltip, /boom/);
  assert.match(failed.tooltip, /C:\\l\.log/);
  assert.match(statusFor('v2', undefined, false).text, /v2/);
});

test('ready wins over a stale progress state', () => {
  assert.match(statusFor('v2', { state: 'downloading', bytes: 1, total: 2, bytesPerSec: 0 }, true).text, /Restart to update/);
});

test('formatBytes uses KB below 1 MB and MB above', () => {
  assert.strictEqual(formatBytes(512), '0.5 KB');
  assert.strictEqual(formatBytes(1048576), '1.0 MB');
  assert.strictEqual(formatBytes(83886080), '80.0 MB');
});

test('isSafeTag only allows characters that are safe in a directory name', () => {
  assert.ok(isSafeTag('v1.2.3'));
  assert.ok(isSafeTag('nightly-2026-10-14_1'));
  assert.ok(!isSafeTag(''));
  assert.ok(!isSafeTag('..\\evil'));
  assert.ok(!isSafeTag('a/b'));
  assert.ok(!isSafeTag('v1..2'));
});

test('shouldAcknowledge only fires once the new install is in place', () => {
  assert.ok(shouldAcknowledge('{"plan":{},"step":"MovedIn"}'));
  assert.ok(!shouldAcknowledge('{"plan":{},"step":"Started"}'));
  assert.ok(!shouldAcknowledge('{"plan":{},"step":"AsideDone"}'));
  assert.ok(!shouldAcknowledge(undefined));
  assert.ok(!shouldAcknowledge('garbage'));
  assert.ok(!shouldAcknowledge('null'));
});
```

- [ ] **Step 2: Add the test to the runner list and verify failure**

Edit `extensions/null-tools/package.json`: in the `test` script, change `out/webviewCommitGraph.test.js"` to `out/webviewCommitGraph.test.js out/updateStatus.test.js"`.

Run: `cd extensions/null-tools && npm test`
Expected: FAIL (`Cannot find module './updateStatus'` at compile).

- [ ] **Step 3: Implement**

`extensions/null-tools/src/updateStatus.ts`:

```ts
'use strict';

export type Progress =
  | { state: 'checking' | 'verifying' | 'preparing' | 'installing' | 'restarting' | 'upToDate' | 'ready' | 'busy' | 'needsReapproval' }
  | { state: 'downloading'; bytes: number; total: number; bytesPerSec: number }
  | { state: 'waitingForClose'; processes: string[] }
  | { state: 'failed'; message: string; log?: string };

type PlainState = 'checking' | 'verifying' | 'preparing' | 'installing' | 'restarting' | 'upToDate' | 'ready' | 'busy' | 'needsReapproval';
const PLAIN = new Set<string>(['checking', 'verifying', 'preparing', 'installing', 'restarting', 'upToDate', 'ready', 'busy', 'needsReapproval']);

export function parseProgressLine(line: string): Progress | undefined {
  let v: unknown;
  try { v = JSON.parse(line); } catch { return undefined; }
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  switch (o.state) {
    case 'downloading':
      return typeof o.bytes === 'number' && typeof o.total === 'number'
        ? { state: 'downloading', bytes: o.bytes, total: o.total, bytesPerSec: typeof o.bytesPerSec === 'number' ? o.bytesPerSec : 0 }
        : undefined;
    case 'waitingForClose':
      return { state: 'waitingForClose', processes: Array.isArray(o.processes) ? o.processes.filter((p): p is string => typeof p === 'string') : [] };
    case 'failed':
      return typeof o.message === 'string'
        ? { state: 'failed', message: o.message, log: typeof o.log === 'string' ? o.log : undefined }
        : undefined;
    default:
      return typeof o.state === 'string' && PLAIN.has(o.state) ? { state: o.state as PlainState } : undefined;
  }
}

export interface StatusView { text: string; tooltip: string }

export function formatBytes(n: number): string {
  return n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export function statusFor(version: string, p: Progress | undefined, ready: boolean): StatusView {
  if (ready) {
    return { text: '$(rocket) Restart to update', tooltip: `Null IDE ${version} is downloaded and ready to install` };
  }
  switch (p?.state) {
    case 'downloading': {
      const pct = p.total > 0 ? Math.min(100, Math.floor((p.bytes / p.total) * 100)) : 0;
      return {
        text: `$(cloud-download) ${version} ${pct}%`,
        tooltip: `Downloading Null IDE ${version}: ${formatBytes(p.bytes)} of ${formatBytes(p.total)} (${formatBytes(p.bytesPerSec)}/s)`,
      };
    }
    case 'verifying':
      return { text: `$(sync~spin) Verifying ${version}`, tooltip: `Verifying the Null IDE ${version} download` };
    case 'failed':
      return {
        text: `$(warning) Update ${version} failed`,
        tooltip: `${p.message}${p.log ? `\nLog: ${p.log}` : ''}\nClick to try again.`,
      };
    default:
      return { text: `$(cloud-download) ${version}`, tooltip: `Preparing Null IDE ${version}…` };
  }
}

/** Tags become directory names inside null-setup, so mirror its conservative rule. */
export function isSafeTag(tag: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(tag) && !tag.includes('..');
}

/** Only a journal in step MovedIn means "the new install is in place"; a Started journal belongs to an update still in progress. */
export function shouldAcknowledge(journalText: string | undefined): boolean {
  try { return JSON.parse(journalText ?? '').step === 'MovedIn'; } catch { return false; }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: all tests PASS, including the 7 new ones.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/updateStatus.ts extensions/null-tools/src/updateStatus.test.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): pure helpers for update progress, status text and journal checks"
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

---

### Task 14: null-tools: delegate the update to null-setup

**Files:**
- Modify: `extensions/null-tools/src/updater.ts` (rewrite), `extensions/null-tools/src/updaterIntegration.ts`
- Modify (generated): `extensions/null-tools/out/*`

**Interfaces:**
- Consumes: `updateStatus.ts` (Task 13); the `null-setup` CLI contract (Task 11): `prefetch` prints JSON lines; `update --repo --version --install-dir --launch` is spawned detached; `recover --install-dir` is spawned detached.
- Produces: `updater.ts` exports `AvailableUpdate`, `StagedUpdate` (`{version, verified}`), `onStagedUpdateChanged`, `getUpdateProgress()`, `checkForUpdate`, `promptForUpdate`, `installUpdate`, `acknowledgeUpdate`. Removed: all download/staging code, `getUpdaterExePath`, `getUpdaterScriptPath`, the `cmd.exe` launcher.
- Behavior: a check that finds a newer stable release calls `startPrefetch`; the status item shows progress and "Restart to update" when `ready`; "Update Now" asks for confirmation, spawns `null-setup update`, and quits the IDE only after the process has started; at activation, if a `MovedIn` journal exists beside the install dir, write `.null-ready` and spawn `null-setup recover`.

- [ ] **Step 1: Replace `updater.ts`**

Write `extensions/null-tools/src/updater.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { compareVersionTags } from './versionComparison';
import { Progress, isSafeTag, parseProgressLine, shouldAcknowledge } from './updateStatus';

// Electron adds resourcesPath to the Node process object; @types/node doesn't know about it.
declare global {
  namespace NodeJS {
    interface Process { resourcesPath?: string; }
  }
}

const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');

interface InstallMetadata {
  version: string;
  repo: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body?: string;
  assets: { name: string }[];
}

export interface AvailableUpdate {
  repo: string;
  current: string;
  latest: string;
  url: string;
  checkedAt: string;
  releaseNotes?: string;
}

export interface StagedUpdate {
  version: string;
  verified: boolean;
}

export const onStagedUpdateChanged = new vscode.EventEmitter<void>();

let latestProgress: Progress | undefined;
export function getUpdateProgress(): Progress | undefined { return latestProgress; }

function getInstallDirCandidates(context: vscode.ExtensionContext): string[] {
  const candidates = [path.dirname(process.execPath)];

  if (process.resourcesPath) {
    candidates.push(path.resolve(process.resourcesPath, '..'));
  }

  if (context?.extensionPath) {
    candidates.push(path.resolve(context.extensionPath, '..', '..', '..', '..'));
  }

  return [...new Set(candidates.map(c => path.resolve(c)))];
}

interface Install { installDir: string; setupExe: string }

/** The install that ships `setup\null-setup.exe`; undefined when running from a dev checkout. */
export function findInstall(context: vscode.ExtensionContext): Install | undefined {
  for (const installDir of getInstallDirCandidates(context)) {
    const setupExe = path.join(installDir, 'setup', 'null-setup.exe');
    if (fs.existsSync(setupExe)) return { installDir, setupExe };
  }
  return undefined;
}

function getInstallMetadata(context: vscode.ExtensionContext): InstallMetadata | null {
  const candidates: string[] = [];

  for (const installDir of getInstallDirCandidates(context)) {
    candidates.push(
      path.join(installDir, '.null-ide-install.json'),
      path.join(installDir, 'resources', 'app', '.null-ide-install.json'),
    );
  }

  if (process.resourcesPath) {
    candidates.push(
      path.resolve(process.resourcesPath, '..', '.null-ide-install.json'),
      path.join(process.resourcesPath, 'app', '.null-ide-install.json'),
    );
  }

  for (const metadataPath of [...new Set(candidates)]) {
    try {
      output.appendLine(`Reading install metadata from ${metadataPath}`);
      const raw = fs.readFileSync(metadataPath, 'utf8').replace(/^﻿/, '');
      return JSON.parse(raw) as InstallMetadata;
    } catch (err) {
      output.appendLine(`Could not read install metadata at ${metadataPath}: ${(err as Error).message}`);
    }
  }

  return null;
}

function getCurrentVersion(context: vscode.ExtensionContext): string {
  const metadata = getInstallMetadata(context);
  if (metadata?.version) return String(metadata.version);
  return 'local';
}

function getUpdateRepo(context: vscode.ExtensionContext): string {
  return getInstallMetadata(context)?.repo || UPDATE_REPO;
}

function formatNetworkError(err: Error): Error {
  const msg = err.message || '';
  if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
    return new Error('Unable to resolve api.github.com. Please check your internet connection or proxy settings.');
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) {
    return new Error('Connection to api.github.com timed out.');
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
    return new Error('Connection to api.github.com was refused or reset.');
  }
  return err;
}

async function requestJson<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error = new Error('Unknown network error');

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }

    try {
      return await new Promise<T>((resolve, reject) => {
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Null-IDE',
        };

        if (process.env.GITHUB_TOKEN) {
          headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
        }

        const req = https.get(url, { headers }, res => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => { body += chunk; });
            res.on('end', () => {
              let detail = '';
              try {
                const parsed = JSON.parse(body) as { message?: string };
                detail = parsed?.message ? `: ${parsed.message}` : '';
              } catch (_) {}
              reject(new Error(`GitHub returned ${res.statusCode}${detail}`));
            });
            return;
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(body) as T); }
            catch (err) { reject(err); }
          });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(new Error('GitHub request timed out')); });
      });
    } catch (err) {
      lastError = formatNetworkError(err as Error);
      // Don't retry HTTP 4xx/5xx status errors, only network/connect errors.
      if ((err as Error).message?.startsWith('GitHub returned')) {
        throw lastError;
      }
    }
  }

  throw lastError;
}

async function getLatestRelease(repo: string): Promise<GithubRelease> {
  return requestJson<GithubRelease>(`https://api.github.com/repos/${repo}/releases/latest`);
}

function hasWindowsPackage(release: GithubRelease): boolean {
  return Array.isArray(release.assets) &&
    release.assets.some(a => /^null-ide-win32-x64(-[^/\\]+)?\.zip$/i.test(a.name));
}

let prefetching: string | undefined;   // version being downloaded by this window's null-setup

/** Downloads and verifies the release in the background; installing only ever starts from the user's click. */
function startPrefetch(context: vscode.ExtensionContext, update: AvailableUpdate): void {
  const staged = context.globalState.get<StagedUpdate>('null.stagedUpdate');
  if (prefetching === update.latest || (staged?.version === update.latest && staged.verified)) return;
  if (!isSafeTag(update.latest)) {
    output.appendLine(`Refusing to prefetch unexpected tag "${update.latest}".`);
    return;
  }
  const install = findInstall(context);
  if (!install) {
    output.appendLine('null-setup.exe not found next to this install; skipping the background download.');
    return;
  }

  prefetching = update.latest;
  latestProgress = { state: 'checking' };
  onStagedUpdateChanged.fire();

  const child = spawn(
    install.setupExe,
    ['prefetch', '--repo', update.repo, '--version', update.latest, '--install-dir', install.installDir],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  );
  readline.createInterface({ input: child.stdout! }).on('line', line => {
    const p = parseProgressLine(line);
    if (!p) { output.appendLine(line); return; }
    latestProgress = p;
    if (p.state === 'ready') {
      void context.globalState.update('null.stagedUpdate', { version: update.latest, verified: true } satisfies StagedUpdate);
    }
    if (p.state === 'failed') output.appendLine(`Background download failed: ${p.message}${p.log ? ` (log: ${p.log})` : ''}`);
    onStagedUpdateChanged.fire();
  });
  child.on('error', err => {
    output.appendLine(`Could not start null-setup: ${err.message}`);
    latestProgress = { state: 'failed', message: err.message };
    prefetching = undefined;
    onStagedUpdateChanged.fire();
  });
  child.on('close', () => { prefetching = undefined; });
}

export async function checkForUpdate(
  context: vscode.ExtensionContext,
  silent: boolean,
): Promise<AvailableUpdate | null> {
  const now = Date.now();
  const lastCheck = context.globalState.get<number>('null.lastUpdateCheck', 0);
  if (silent && now - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
    output.appendLine(`Skipping startup update check; last check was ${new Date(lastCheck).toISOString()}.`);
    return null;
  }

  await context.globalState.update('null.lastUpdateCheck', now);

  const current = getCurrentVersion(context);
  const repo    = getUpdateRepo(context);
  output.appendLine(`Checking for updates from ${repo}. Current version: ${current}`);
  const release    = await getLatestRelease(repo);
  const latest     = String(release.tag_name || '');
  const hasPackage = hasWindowsPackage(release);
  output.appendLine(`Latest release: ${latest || '(none)'}. Windows package: ${hasPackage ? 'yes' : 'no'}`);

  if (!latest || !hasPackage || compareVersionTags(latest, current) <= 0) {
    await context.globalState.update('null.availableUpdate', undefined);
    await context.globalState.update('null.stagedUpdate', undefined);
    await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', false);
    latestProgress = undefined;
    onStagedUpdateChanged.fire();
    if (!silent) {
      const packageNote = hasPackage ? '' : ' No Windows package was found on the latest release.';
      vscode.window.showInformationMessage(
        `Null IDE is up to date (${current}; latest ${latest || 'unknown'}).${packageNote}`,
      );
    }
    return null;
  }

  const update: AvailableUpdate = {
    repo, current, latest,
    url: release.html_url,
    checkedAt: new Date().toISOString(),
    releaseNotes: release.body,
  };

  await context.globalState.update('null.availableUpdate', update);
  await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', true);
  output.appendLine(`Update available: ${current} -> ${latest}`);

  startPrefetch(context, update);

  return update;
}

function truncateReleaseNotes(notes: string | undefined): string | undefined {
  if (!notes) return undefined;
  return notes.length > 600 ? notes.slice(0, 600) + '…' : notes;
}

export async function promptForUpdate(update: AvailableUpdate): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    `Null IDE ${update.latest} is available. You are running ${update.current}.`,
    { detail: truncateReleaseNotes(update.releaseNotes) },
    'Update Now', 'Release Notes', 'Later',
  );

  if (action === 'Update Now') {
    await vscode.commands.executeCommand('null.installUpdate');
  } else if (action === 'Release Notes' && update.url) {
    await vscode.env.openExternal(vscode.Uri.parse(update.url));
  }
}

export async function installUpdate(context: vscode.ExtensionContext): Promise<void> {
  const update = context.globalState.get<AvailableUpdate>('null.availableUpdate')
    || await checkForUpdate(context, false);
  if (!update) return;

  const install = findInstall(context);
  if (!install) {
    vscode.window.showErrorMessage('Null IDE: null-setup.exe was not found in this installation, so it cannot update itself. Reinstall from the latest release.');
    return;
  }
  if (!isSafeTag(update.latest)) {
    vscode.window.showErrorMessage(`Null IDE: unexpected release tag "${update.latest}".`);
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Install Null IDE ${update.latest}? The IDE will close, update, and reopen.`,
    { modal: true, detail: truncateReleaseNotes(update.releaseNotes) },
    'Restart and Update',
  );
  if (choice !== 'Restart and Update') return;

  const child = spawn(
    install.setupExe,
    ['update', '--repo', update.repo, '--version', update.latest, '--install-dir', install.installDir, '--launch'],
    { detached: true, stdio: 'ignore' },
  );
  const started = await new Promise<boolean>(resolve => {
    child.once('spawn', () => resolve(true));
    child.once('error', err => {
      vscode.window.showErrorMessage(`Null IDE: could not start the updater: ${err.message}`);
      resolve(false);
    });
  });
  if (!started) return;
  child.unref();

  await context.globalState.update('null.stagedUpdate', undefined);
  latestProgress = undefined;
  onStagedUpdateChanged.fire();

  // null-setup asks every window of this install to close; quitting here just makes that instant.
  setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 1000);
}

/** After an update the new IDE proves it started by writing the marker; null-setup then removes the old copy. */
export function acknowledgeUpdate(context: vscode.ExtensionContext): void {
  const install = findInstall(context);
  if (!install) return;
  const journal = path.join(path.dirname(install.installDir), '.null-update-journal.json');
  let text: string | undefined;
  try { text = fs.readFileSync(journal, 'utf8'); } catch { return; }
  if (!shouldAcknowledge(text)) return;   // a Started journal belongs to an update still in progress
  try {
    fs.writeFileSync(path.join(install.installDir, '.null-ready'), String(Date.now()));
    spawn(install.setupExe, ['recover', '--install-dir', install.installDir], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    output.appendLine('Acknowledged the completed update.');
  } catch (err) {
    output.appendLine(`Could not acknowledge the update: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 2: Update `updaterIntegration.ts`**

Replace the import line and the body of `refreshUpdateButton`, and call `acknowledgeUpdate` first thing in `registerUpdaterFeature`:

```ts
import * as vscode from 'vscode';
import { AvailableUpdate, StagedUpdate, acknowledgeUpdate, checkForUpdate, getUpdateProgress, installUpdate, onStagedUpdateChanged, promptForUpdate } from './updater';
import { statusFor } from './updateStatus';

export function registerUpdaterFeature(context: vscode.ExtensionContext): void {
  acknowledgeUpdate(context);

  const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
  updateBar.command = 'null.installUpdate';
  context.subscriptions.push(updateBar);

  function refreshUpdateButton(): void {
    const update = context.globalState.get<AvailableUpdate>('null.availableUpdate');
    if (!update?.latest) {
      updateBar.hide();
      return;
    }

    const staged = context.globalState.get<StagedUpdate>('null.stagedUpdate');
    const isReady = staged?.version === update.latest && staged.verified;

    const view = statusFor(update.latest, getUpdateProgress(), isReady);
    updateBar.text = view.text;
    updateBar.tooltip = view.tooltip;
    updateBar.show();
  }
```
Leave the rest of the file (event subscription, the two commands, the startup check) unchanged.

- [ ] **Step 3: Check for other consumers of removed items**

```bash
grep -rn "nullUpdateStaged\|getUpdaterExePath\|getUpdaterScriptPath\|null-updater.exe\|update-null-ide" extensions/*/src extensions/*/package.json patches
```
Expected: no matches in `extensions/null-tools/src`. If `nullUpdateStaged` is used in a `package.json` `when` clause, restore `await vscode.commands.executeCommand('setContext', 'nullUpdateStaged', true)` in the `ready` branch of `startPrefetch` and `false` in the up-to-date branch of `checkForUpdate`.

- [ ] **Step 4: Compile and test**

Run: `cd extensions/null-tools && npm run compile && npm test`
Expected: compile succeeds with no errors; all tests PASS.

- [ ] **Step 5: Sync into the local install and exercise it**

With a locally built `null-setup.exe` (Task 11 step 4) run `/verify-local null-tools` (or `scripts/sync-local.ps1` then `scripts/reload-local.ps1`). In the IDE: command palette → `Null: Check for Updates`; the Output channel "Null IDE Updates" must show either "up to date" or the prefetch lines, and the status item must follow the states. Full end-to-end is the manual matrix in Task 16.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/updater.ts extensions/null-tools/src/updaterIntegration.ts
git commit -m "feat(null-tools): delegate update download and install to null-setup"
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

---

### Task 15: Delete the old update path and fix the docs

**Files:**
- Delete: `updater/` (whole directory), `scripts/update-null-ide.ps1`
- Modify: `CLAUDE.md`, `.claude/agents/security-reviewer.md`, `docs/specs/native-updater-design.md`, `docs/plans/native-updater-fix.md`, `README.md` (only if it names the removed files), `docs/ROADMAP.md` (only if it mentions the native updater)

**Interfaces:**
- Consumes: Tasks 12 and 14 (nothing may reference the removed files any more).
- Produces: no dangling references.

- [ ] **Step 1: Prove nothing references the old pieces**

```bash
grep -rIn --exclude-dir=node_modules --exclude-dir=.vscode-test --exclude-dir=graphify-out --exclude-dir=.git --exclude-dir=target \
  -e "null-updater.exe" -e "update-null-ide" -e "updater/build" -e "updater/src" -e "getUpdaterExePath" .
```
Expected: matches only in docs, `CLAUDE.md`, the security agent file and (for `update-null-ide`) `scripts/` comments. Anything in `.github/`, `scripts/*.ps1` code paths or `extensions/*/src` must be fixed before deleting.

- [ ] **Step 2: Delete**

```bash
git rm -r updater scripts/update-null-ide.ps1
```

- [ ] **Step 3: Update `CLAUDE.md`**

Make these edits (use Edit with the exact existing text as `old_string`):
- Repository layout: replace the `updater/` mention (if listed) with
  `├── setup/                    # null-setup (Rust workspace: core + Tauri app); update/prefetch/recover today, installer wizard in sub-project 2`.
- "How the Build Works" step 11: replace "Bundle `install-null-ide.ps1` and `update-null-ide.ps1` into `resources/app/null-updater/`." with "Build `setup/` with cargo (`cargo test`, then `cargo build --release`); ship `null-setup.exe` as `setup/null-setup.exe` and `install-null-ide.ps1` in `resources/app/null-updater/` (the registration script `null-setup` runs after an update)."
- "Installer and Scripts": delete the whole `### scripts/update-null-ide.ps1` subsection and add:

```
### `setup/` (null-setup)
`null-setup.exe` lives at `<installDir>\setup\null-setup.exe`. Modes: `prefetch` (headless download + SHA256 verify into `%LOCALAPPDATA%\Null\updates\<tag>\`, JSON progress lines on stdout), `update` (progress window; relocates itself out of the install dir, closes the IDE, journaled swap with rollback, re-applies registrations through `install-null-ide.ps1 -ReapplyRegistrations -NoElevate`, waits for the new IDE's `.null-ready` marker), `recover` (finishes or rolls back an interrupted swap from `<parent>\.null-update-journal.json`). `update` never elevates. `NULL_SETUP_API_BASE` redirects the GitHub API for tests (`scripts/fake-release.mjs`). Core logic and its tests are in `setup/core` (`cargo test -p null-setup-core`). Design `docs/specs/null-setup-installer-design.md`; plan `docs/plans/null-setup-updater.md`.
```
- null-tools "In-app updater" row: "Checks GitHub Releases on startup; shows status bar button; `null-setup prefetch` downloads in the background, the click runs `null-setup update` (no PowerShell, no staging code in the extension). Pure helpers in `updateStatus.ts`".
- Scope Constraints / Patches: no change.

- [ ] **Step 4: Update the security reviewer and the superseded docs**

In `.claude/agents/security-reviewer.md`: replace the `description` sentence about "stages and launches detached PowerShell scripts" with "the `setup/` Rust updater (`null-setup.exe`: download + SHA256, journaled swap, relocation to `%LOCALAPPDATA%\Null\updates\run\`, `NULL_SETUP_API_BASE` test seam) and the null-tools code that spawns it"; replace items 3 and 4 and the `getUpdaterScriptPath()` bullet with equivalents for `setup/core/src/{extract,download,swap,registrations,update}.rs`, `setup/app/src/{args,relocate}.rs`, and `extensions/null-tools/src/updater.ts` (`installUpdate`, `acknowledgeUpdate`). Keep the shell-ext and APPX items unchanged.

Add as the first line under the title of `docs/specs/native-updater-design.md` and `docs/plans/native-updater-fix.md`:
`> Superseded by docs/specs/null-setup-installer-design.md (sub-project 1). The C++ updater described here was removed.`

- [ ] **Step 5: Verify the tree**

```bash
cargo test --manifest-path setup/Cargo.toml -p null-setup-core
cd extensions/null-tools && npm test
git status --short
```
Expected: tests PASS; status shows only the deletions and doc edits.

- [ ] **Step 6: Commit**

```bash
git add -A updater scripts/update-null-ide.ps1 CLAUDE.md .claude/agents/security-reviewer.md docs README.md
git commit -m "chore: remove the C++ updater and the PowerShell update path"
```
(Stage only files that actually changed; do not `git add` unrelated working-tree changes.)

---

### Task 16: Security review, manual matrix and release notes

**Files:**
- Create: `docs/specs/null-setup-updater-test-record.md` (the recorded matrix)

**Interfaces:**
- Consumes: everything above; two builds that both contain `setup/null-setup.exe`.

- [ ] **Step 1: Security review**

Run the `security-reviewer` agent over `setup/`, `scripts/install-null-ide.ps1` (the `-NoElevate` change), `.github/workflows/build.yml` and `extensions/null-tools/src/updater.ts`. Fix every finding it rates high or medium (re-run the affected task's tests); record the rest with a reason in the test record.

- [ ] **Step 2: Prepare the matrix inputs**

1. Build the exe: `cargo build --release --locked -p null-setup` in `setup/`.
2. Make a "previous" install containing `setup\null-setup.exe`: install the current build with the existing ps1 (`scripts\install-null-ide.ps1 -ZipPath <zip from CI or build-local>`), then `scripts\sync-local.ps1`. Its `.null-ide-install.json` version must be lower than the fake tag.
3. Make the "new" zip: zip the contents of a second copy of that install folder as `null-ide-win32-x64.zip` (null.exe must be at the zip root).
4. Start `node scripts/fake-release.mjs --zip <new zip> --tag v9.9.9`, then start Null IDE from a terminal with `NULL_SETUP_API_BASE=http://127.0.0.1:8787` set. The installed `.null-ide-install.json` `repo` can stay `TorresVisual/null-ide`; the fake server answers any `owner/repo`.

- [ ] **Step 3: Run the update matrix on Windows 11 and Windows 10 22H2, recording pass/fail and the log path for each**

| # | Scenario | How | Expected |
|---|---|---|---|
| 1 | Update with the IDE running | click "Update Now" with two IDE windows open | windows close, new version starts, old folder gone, `data\` (if portable) intact, no journal left |
| 2 | Status item | watch the status bar after the check | `downloading N%` → `Restart to update` |
| 3 | Locked files | keep a console with its working directory inside the install folder, click Update | window says what is still running, Retry works after closing it, "Close Null IDE" forces |
| 4 | Network cut mid-download | restart the fake server with `--cut-after 20000000` | download resumes from the `.part` and completes; log shows the interruption |
| 5 | Slow link | `--throttle 500` | speed and percentage update; closing the check window mid-way and checking again does not delete the download (second `prefetch` reports `busy`) |
| 6 | Killed mid-swap | kill `null-setup.exe` in Task Manager right after "Installing…" appears | on next IDE start (or `null-setup recover --install-dir …`) the old install is restored, or, if the new IDE already wrote `.null-ready`, the update is committed |
| 7 | Certificate untrusted | remove the Null cert from `Cert:\LocalMachine\TrustedPeople`, update | no UAC prompt, update succeeds, final page says the context menu needs approval, existing `NullIDE.ExplorerCommand` package still registered |
| 8 | Explorer holding the DLL | right-click a folder in Explorer first, then update | update succeeds (Explorer restarts once), install folder renamed without error |
| 9 | Broken new build | zip whose `null.exe` exits immediately | update reports failure and the old version is back |
| 10 | Path with spaces/non-ASCII | install under `C:\Users\<you>\Programs\Null IDE ünï` and update | works end to end |
| 11 | Tag check | `node scripts/fake-release.mjs … --tag "a b"` | null-tools refuses to spawn (unexpected tag) |
| 12 | Second window during update | open a new IDE window while the progress window shows "Installing…" | the update is not rolled back |

Record results in `docs/specs/null-setup-updater-test-record.md`.

- [ ] **Step 4: Release hygiene**

1. The first release containing `null-setup.exe` must be installed by hand once (existing installs have no `setup\null-setup.exe`; that is the spec's accepted migration). Say so in the release notes; keep the previous release's `NullIDESetup-*.exe` and zip available for rollback (spec "Open risks").
2. Push nothing; open the PR description with the matrix table and the verdict from `docs/specs/updater-root-cause.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/null-setup-updater-test-record.md
git commit -m "docs: record the null-setup update test matrix"
```

---

## Self-Review

**Spec coverage (sub-project 1):**
- Step 1 reproduce + decide hotfix → Tasks 1-2. ✔
- `core` modules `release`, `download` (resumable, streaming SHA256, size check, single-writer lock, prune after success), `swap` (journal), `procs`, `config` → Tasks 3-8. ✔ `shell` is sub-project 2 (ported registrations); sub-project 1 runs the existing script, so `registrations.rs` + `shellext.rs` stand in → Task 9. ✔
- Modes `prefetch`, `update` (+ `recover` added so a crash journal can be finished without an update) → Tasks 10-11. `--wait` dropped (documented deviation in Task 11). `default/modify/repair/uninstall` are sub-project 2. ✔
- Update safety 1-6: prefetch on detect, update on click (Task 14); verify + extract to staging beside install (Tasks 5, 7, 10); close with visible wait + Retry (Tasks 6, 11); journaled swap + install-config re-apply (the latter is sub-project 2, `install-config.json` does not exist yet); ready marker or 30 s alive, rollback on failure (Tasks 8, 10, 14); journal recovery at next start (Task 8, 10 `recover` first, 14 `acknowledgeUpdate`). ✔
- UAC rule: `-NoElevate` + needs-reapproval reported (Tasks 9, 11 UI note); "a button runs modify" deferred to sub-project 2 (UI says to run the installer). ✔ noted.
- States shown in window and status item → Tasks 11, 13, 14. ✔ "Copy diagnostics" → Task 11.
- Error handling: retries/backoff, 4xx naming status+URL, checksum retry once, locked files, disk space, resumable → Tasks 4, 5, 6. Missing WebView2 native dialog: **not covered** (Tauri aborts); acceptable for the one current user per spec "Supported Windows"; flagged for sub-project 2 where the wizard needs it too.
- Release pipeline: build setup/, ship exe, delete updater pieces → Tasks 12, 15. Inno stays until sub-project 2. ✔
- Testing: core tests with local HTTP server, swap/journal crash tests, null-tools node tests, manual matrix → Tasks 4-10, 13, 16. ✔

**Placeholder scan:** no TBD/TODO; Task 12 step 3 describes two script edits by location because those files were not read in full (the executor reads them); Task 2's non-H1 branch is explicitly "write the one-line fix for the confirmed cause", which depends on Task 1's findings and cannot be pre-written.

**Type consistency:** `Progress` camelCase fields match `updateStatus.ts` (`bytesPerSec`, `waitingForClose`, `needsReapproval`); `Timing::STANDARD`, `Plan`, `Hook`, `Recovered` names are the same in Tasks 8, 10, 11; `Opts` fields in Task 10 tests match the struct (`release_shell_ext` included); `Registration` derives `PartialEq` (used in Task 11); `prune_except("")` in Task 10 matches Task 5's signature; journal JSON `step` strings `MovedIn` match `shouldAcknowledge`; CLI flags in Task 11 match the spawn arguments in Task 14.

**Review Focus coverage:** (1) Task 7 tests; (2) Task 4 tests; (3) Task 5 tests; (4) Tasks 8, 10 use `Null IDE ünï`, Task 11 args test, Task 16 #10; (5) Task 5 lock test, Task 8 stale-backup test, Task 13 `shouldAcknowledge`, Task 16 #5 and #12.
