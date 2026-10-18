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

pub(crate) fn dispatch(a: &Args, ctx: &Ctx) -> Result<()> {
    match a.mode {
        Mode::Install => {
            let cfg = load_config(a)?.unwrap_or_default();
            deploy(a, Kind::Install, a.tag.clone(), Some(cfg), ctx)?;
            // ponytail: a registration warning from deploy() returns before this, so a partly-registered install loses its first-run choices; re-run install after `repair` if that matters.
            if let Some(f) = &a.first_run {
                first_run::save_from_file(&a.install_dir, f, &first_run::dir()?)
                    .map_err(|e| Error::Other(format!("installed, but the first-run choices were not saved: {e}")))?;
            }
            Ok(())
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
}
