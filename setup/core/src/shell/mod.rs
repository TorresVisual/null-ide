use std::{io, path::{Path, PathBuf}};

use winreg::{enums::*, RegKey};

use crate::{
    error::{Error, Result},
    install_config::Feature,
    registrations::Registration,
};

pub mod arp;
pub mod assoc;
pub mod classes;
pub mod path;
pub mod shortcuts;
pub mod sys;
pub mod win11;

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
    fn env_changed(&self);
    fn create_shortcut(&self, s: &shortcuts::ShortcutSpec) -> Result<()>;
    fn restart_explorer(&self);
    /// PackageFullName of NullIDE.ExplorerCommand, if registered.
    fn appx_installed(&self) -> Result<Option<String>>;
    fn appx_remove(&self, full_name: &str) -> Result<()>;
    fn appx_add(&self, appx: &Path, external: &Path) -> AppxAdd;
    /// Uppercase hex SHA-1.
    fn cert_thumbprint(&self, cer: &Path) -> Result<String>;
    /// Is the thumbprint in LocalMachine\TrustedPeople?
    fn cert_trusted_machine(&self, thumbprint: &str) -> bool;
    /// CurrentUser\TrustedPeople.
    fn cert_add_current_user(&self, cer: &Path) -> Result<()>;
    /// UAC prompt; Err when declined or failed.
    fn cert_add_machine_elevated(&self, install: &Path) -> Result<()>;
}

#[derive(Clone, Debug, PartialEq)]
pub enum AppxAdd { Added, UntrustedRoot, Failed(String) }

impl Locations {
    pub fn real() -> Result<Locations> {
        Ok(Locations {
            hkcu: String::new(),
            desktop: sys::known_folder(sys::KnownFolder::Desktop)?,
            programs: sys::known_folder(sys::KnownFolder::Programs)?,
        })
    }
}

fn exe_of(install: &Path) -> std::result::Result<PathBuf, String> {
    let exe = install.join("null.exe");
    exe.is_file().then_some(exe).ok_or_else(|| format!("null.exe not found in {}", install.display()))
}

/// `Ok(true)`: the Win11 context menu needs the user's approval again.
fn register_one(
    f: Feature,
    loc: &Locations,
    sys: &dyn System,
    install: &Path,
    exe: &Path,
    allow_elevate: bool,
    log: &dyn Fn(&str),
) -> Result<bool> {
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
