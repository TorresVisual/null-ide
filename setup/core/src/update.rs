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
    install_config::Feature,
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
    // One update at a time per install: a second one must not touch the first one's staging, backup or journal.
    let _lock = swap::lock_install(&o.install_dir, Duration::ZERO)?;
    swap::recover_unlocked(&o.install_dir, &o.timing)?;
    // A zip that `prefetch` verified needs no network, so "Restart to update" also works offline.
    let zip = match download::cached(&o.cache, &o.tag) {
        Some(z) => z,
        None => fetch_verified(o, Duration::from_secs(600), ctx)?.1,
    };
    let zip_size = fs::metadata(&zip).map(|m| m.len()).unwrap_or(0);

    let plan = swap::plan_for(&o.install_dir, &o.tag);
    let parent = o.install_dir.parent().unwrap_or(Path::new("."));
    disk::ensure(parent, zip_size.saturating_mul(3))?;
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
    procs::release_inherited_handles(&o.install_dir, ctx);
    if o.release_shell_ext {
        shellext::release(ctx);
    }
    Ok(())
}

fn finish(o: &Opts, plan: &Plan, ctx: &Ctx) -> Result<Outcome> {
    let registration = if o.reapply { registrations::apply(&o.install_dir, &[Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler], &[], false, ctx) } else { Registration::Skipped };
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
