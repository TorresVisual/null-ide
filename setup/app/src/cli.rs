use std::io::Write;

use null_setup_core::{
    config, first_run,
    install_config::{self, InstallConfig},
    manage::{self, UninstallOpts},
    procs::Running,
    progress::{logs_dir, Ctx, Interact, LockedChoice, Logger, Progress},
    registrations::{self, Registration},
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
        Err(e) => {
            // The core already reports its own failures; this covers the ones before it runs (unreadable config, no install).
            // A reader that takes the last line sees one `Failed` either way.
            log.line(&format!("failed: {e}"));
            emit(Progress::Failed { message: e.to_string(), log: log.path().map(|p| p.display().to_string()) });
            1
        }
    }
}

/// The install itself worked; only something after it did not (registrations, saving the first-run choices).
/// The wizard reports these on the finish page instead of as a failure.
pub fn is_partial(e: &Error) -> bool {
    matches!(e, Error::Other(m) if m.starts_with("installed, but"))
}

fn load_config(a: &Args) -> Result<Option<InstallConfig>> {
    a.config.as_deref().map(install_config::read_file).transpose()
}

fn installed_tag(a: &Args) -> Result<String> {
    Ok(config::read(&a.install_dir)?.version)
}

fn deploy(a: &Args, kind: Kind, tag: String, cfg: Option<InstallConfig>, ctx: &Ctx) -> Result<()> {
    let mut o = Opts::standard(a.repo.clone(), tag, a.install_dir.clone());
    o.kind = kind;
    o.config = cfg;
    o.launch = a.launch;
    // Only a fresh install or a modify may start the elevated certificate import.
    o.allow_elevate = kind == Kind::Install || a.mode == Mode::Modify;
    match update::update(&o, ctx)?.registration {
        Registration::Warning(w) => Err(Error::Other(format!("installed, but some registrations failed: {w}"))),
        _ => Ok(()),
    }
}

/// The install result and the hand-over of the first-run choices are separate outcomes; neither may hide the other.
fn merge(deployed: Result<()>, saved: std::result::Result<(), String>) -> Result<()> {
    match (deployed, saved) {
        (Ok(()), Ok(())) => Ok(()),
        (Ok(()), Err(b)) => Err(Error::Other(format!("installed, but the first-run choices were not saved: {b}"))),
        (Err(a), Ok(())) => Err(a),
        (Err(a), Err(b)) => Err(Error::Other(format!("{a}; the first-run choices were not saved: {b}"))),
    }
}

pub(crate) fn dispatch(a: &Args, ctx: &Ctx) -> Result<()> {
    match a.mode {
        Mode::Install => {
            let cfg = load_config(a)?.unwrap_or_default();
            let deployed = deploy(a, Kind::Install, a.tag.clone(), Some(cfg), ctx);
            // A registration warning still means the files are in place, so the choices can be handed over.
            // Anything else failed before or during the swap: nothing is installed, so there is nothing to hand them to.
            if deployed.as_ref().is_err_and(|e| !is_partial(e)) {
                return deployed;
            }
            let saved = match &a.first_run {
                Some(f) => first_run::save_from_file(&a.install_dir, f, &first_run::dir()?).map_err(|e| e.to_string()),
                None => Ok(()),
            };
            merge(deployed, saved)
        }
        Mode::Repair => deploy(a, Kind::Repair, installed_tag(a)?, None, ctx),
        Mode::Modify => {
            let new = load_config(a)?.ok_or_else(|| Error::Other("modify needs --config <file>".into()))?;
            let old = install_config::read(&a.install_dir)?;
            if install_config::builtins_changed(&old, &new) {
                deploy(a, Kind::Repair, installed_tag(a)?, Some(new), ctx)
            } else {
                manage::modify_in_place(&a.install_dir, &new, true, &*registrations::standard(), ctx).map(|_| ())  // Warning is an Err there
            }
        }
        Mode::Uninstall => {
            // Without APPDATA this stays relative, which `uninstall` refuses when deleting user data.
            let user_data = std::env::var_os("APPDATA").map(std::path::PathBuf::from).unwrap_or_default().join("Null");
            manage::uninstall(&UninstallOpts::standard(a.install_dir.clone(), a.delete_data, user_data), ctx)
        }
        Mode::Prefetch | Mode::Update | Mode::Recover | Mode::TrustCert | Mode::Wizard => unreachable!("handled in main"),
    }
}

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

    fn text(r: Result<()>) -> String { r.unwrap_err().to_string() }

    #[test]
    fn merge_reports_each_outcome_and_both_when_both_failed() {
        assert!(merge(Ok(()), Ok(())).is_ok());
        let only_saved = merge(Ok(()), Err("disk full".into()));
        assert_eq!(text(only_saved), "installed, but the first-run choices were not saved: disk full");
        let only_deployed = merge(Err(Error::Other("installed, but some registrations failed: apps".into())), Ok(()));
        assert_eq!(text(only_deployed), "installed, but some registrations failed: apps");
        let both = merge(Err(Error::Other("installed, but some registrations failed: apps".into())), Err("disk full".into()));
        let both = text(both);
        assert!(both.starts_with("installed, but some registrations failed: apps"));
        assert!(both.ends_with("the first-run choices were not saved: disk full"));
        assert!(is_partial(&Error::Other(both)));
    }
}
