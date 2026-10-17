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
