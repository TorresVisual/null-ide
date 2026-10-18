use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

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
    registrations::{Registrar, Registration},
    release::{self, Release},
    shellext,
    swap::{self, Hook, Plan, Timing},
};

/// What `update` does with the folder. `Install` needs an empty or missing folder, the others an existing install.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind { Install, Update, Repair }

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
    pub kind: Kind,
    /// `None`: keep the choices saved in the install (exclusions that no longer fit lapse with a log note).
    /// `Some`: a person chose these; any exclusion that cannot be honored is an error.
    pub config: Option<InstallConfig>,
    /// Only a fresh install or `modify` may start the elevated certificate import.
    pub allow_elevate: bool,
    pub registrar: Arc<dyn Registrar>,
}

/// Test seam for scripts/fake-release.mjs; a local attacker who controls the environment already owns the user.
pub fn api_base() -> String {
    std::env::var("NULL_SETUP_API_BASE").unwrap_or_else(|_| "https://api.github.com".into())
}

impl Opts {
    pub fn standard(repo: String, tag: String, install_dir: PathBuf) -> Opts {
        Opts {
            repo,
            tag,
            install_dir,
            api_base: api_base(),
            cache: Cache::standard(),
            http: Http::standard(),
            timing: Timing::STANDARD,
            launch: true,
            reapply: true,
            release_shell_ext: true,
            ready_timeout: Duration::from_secs(30),
            close_grace: Duration::from_secs(15),
            kind: Kind::Update,
            config: None,
            allow_elevate: false,
            registrar: registrations::standard(),
        }
    }
}

#[derive(Debug)]
pub struct Outcome { pub registration: Registration }

pub(crate) fn report<T>(r: Result<T>, ctx: &Ctx) -> Result<T> {
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
    let r = check_tag(&o.tag).and_then(|_| fetch_verified(o, Duration::ZERO, ctx)).map(|(_, zip)| zip);
    if r.is_ok() {
        ctx.emit(Progress::Ready);
    }
    report(r, ctx)
}

pub fn update(o: &Opts, ctx: &Ctx) -> Result<Outcome> {
    report(run_update(o, ctx), ctx)
}

/// Tags become directory names (`.null-ide-stage-<tag>`), so only a conservative character set is accepted.
pub fn safe_tag(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) && !t.contains("..")
}

fn check_tag(tag: &str) -> Result<()> {
    if safe_tag(tag) {
        Ok(())
    } else {
        Err(Error::Other(format!("refusing version {tag:?}: it may only contain letters, digits, '.', '-' and '_'")))
    }
}

/// Only a missing folder or a listable empty one counts as empty; anything unreadable must not look empty,
/// because the swap would rename it aside and delete it.
fn is_empty_target(dir: &Path) -> Result<bool> {
    match fs::read_dir(dir) {
        Ok(mut r) => Ok(r.next().is_none()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) if dir.exists() && !dir.is_dir() => {
            Err(Error::Other(format!("{} is not a folder ({e})", dir.display())))
        }
        Err(e) => Err(Error::Io { context: format!("read {}", dir.display()), source: e }),
    }
}

/// Refuses to touch a folder that is not what the kind expects, then returns the choices saved in it.
/// The swap renames the whole folder aside and deletes it on commit, so this is what protects someone else's files.
fn check_target(o: &Opts) -> Result<InstallConfig> {
    let dir = o.install_dir.display();
    let ours = o.install_dir.join(".null-ide-install.json").is_file();
    match o.kind {
        Kind::Install if ours => Err(Error::Other(format!("Null IDE is already installed in {dir}; use repair or update"))),
        Kind::Install if !is_empty_target(&o.install_dir)? => {
            Err(Error::Other(format!("{dir} is not empty and is not a Null IDE install; pick an empty folder")))
        }
        Kind::Install => Ok(InstallConfig::default()),
        Kind::Update | Kind::Repair if !ours => Err(Error::Other(format!("no Null IDE install found in {dir}"))),
        Kind::Update | Kind::Repair => install_config::read(&o.install_dir),
    }
}

fn run_update(o: &Opts, ctx: &Ctx) -> Result<Outcome> {
    check_tag(&o.tag)?;
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

fn prepare_swap(o: &Opts, ctx: &Ctx) -> Result<()> {
    procs::close_all(&o.install_dir, ctx, o.close_grace)?;
    procs::release_inherited_handles(&o.install_dir, ctx);
    if o.release_shell_ext {
        shellext::release(ctx);
    }
    Ok(())
}

fn register(o: &Opts, before: &InstallConfig, cfg: &InstallConfig, ctx: &Ctx) -> Registration {
    let mut wanted = cfg.enabled();
    // An update only re-points what is tied to the install folder; shortcuts and PATH survive the swap.
    if o.kind == Kind::Update {
        wanted.retain(|f| f.follows_install());
    }
    let dropped = if o.kind == Kind::Install { Vec::new() } else { before.removed_features(cfg) };
    o.registrar.apply(&o.install_dir, &wanted, &dropped, o.allow_elevate, ctx)
}

fn finish(o: &Opts, plan: &Plan, before: &InstallConfig, cfg: &InstallConfig, ctx: &Ctx) -> Result<Outcome> {
    let registration = if o.reapply { register(o, before, cfg, ctx) } else { Registration::Skipped };
    if o.launch {
        ctx.emit(Progress::Restarting);
        let started = launch_ide(&o.install_dir)
            .and_then(|mut child| wait_ready(&mut child, &swap::ready_marker(&o.install_dir), o.ready_timeout));
        match started {
            Ok(()) => {}
            // A fresh install has no previous version to roll back to; undoing it would leave its registrations pointing nowhere.
            // The IDE may also have handed off to a running instance and exited, which is not a failure of the install.
            Err(e) if o.kind == Kind::Install => ctx.log.line(&format!("installed, but the first start did not confirm: {e}")),
            Err(e) => return Err(e),
        }
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

/// The IDE is started from the extension host's environment, which would make `null.exe` run as plain Node
/// (`ELECTRON_RUN_AS_NODE`) or attach to the old window's `VSCODE_*` state, so none of that is passed on.
pub fn launch_command(install: &Path) -> Command {
    let mut c = Command::new(install.join("null.exe"));
    c.current_dir(install).env_remove("NULL_SETUP_RELOCATED").env_remove("ELECTRON_RUN_AS_NODE");
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_ascii_uppercase().starts_with("VSCODE_") {
            c.env_remove(&k);
        }
    }
    c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    c
}

pub fn launch_ide(install: &Path) -> Result<Child> {
    launch_command(install).spawn().ctx("start Null IDE")
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
