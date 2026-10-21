use std::{path::Path, sync::Arc};

use crate::{
    install_config::Feature,
    progress::Ctx,
    shell::{self, arp, sys::WinSystem, Locations, System},
};

#[derive(Clone, Debug, PartialEq)]
pub enum Registration { Done, NeedsReapproval, Warning(String), Skipped }

pub trait Registrar: Send + Sync {
    fn apply(&self, install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration;

    /// Add/Remove Programs entry: `Some(version)` writes or refreshes it, `None` removes it. Never fails the caller.
    fn arp(&self, _install: &Path, _version: Option<&str>, _ctx: &Ctx) {}

    /// Ends `null_widgets.exe` before the install folder is renamed or deleted. Best effort; the locked-files prompt of
    /// `procs::close_all` is the backstop, so the default does nothing.
    fn stop_widgets(&self, _install: &Path, _ctx: &Ctx) {}
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

    fn arp(&self, install: &Path, version: Option<&str>, ctx: &Ctx) {
        let done = Locations::real().and_then(|loc| match version {
            Some(v) => arp::register(&loc, install, v),
            None => arp::unregister(&loc),
        });
        if let Err(e) = done {
            ctx.log.line(&format!("registrations: Add/Remove Programs entry: {e}"));
        }
    }

    fn stop_widgets(&self, install: &Path, ctx: &Ctx) {
        if !WinSystem.stop_widgets(install) {
            ctx.log.line("registrations: null_widgets.exe is still running; it is closed with the other processes");
        }
    }
}

pub fn standard() -> Arc<dyn Registrar> { Arc::new(ShellRegistrar) }
