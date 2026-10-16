use std::{io, path::PathBuf};

use winreg::{enums::*, RegKey};

use crate::error::{Error, Result};

pub mod assoc;
pub mod classes;

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

/// Everything with a side effect outside the registry and the file system, so decisions can be tested with a fake.
pub trait System {
    fn assoc_changed(&self);
}
