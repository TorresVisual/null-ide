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
