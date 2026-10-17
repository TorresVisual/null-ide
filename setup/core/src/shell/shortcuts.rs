use std::{fs, io, path::{Path, PathBuf}};

use super::{Locations, System};
use crate::error::{Error, Result};

pub struct ShortcutSpec { pub path: PathBuf, pub target: PathBuf, pub working_dir: PathBuf, pub args: String }

fn spec(path: PathBuf, exe: &Path, install: &Path, args: &str) -> ShortcutSpec {
    ShortcutSpec { path, target: exe.to_path_buf(), working_dir: install.to_path_buf(), args: args.into() }
}

pub fn desktop(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec {
    spec(loc.desktop.join("Null IDE.lnk"), exe, install, "")
}
pub fn start_menu(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec {
    spec(loc.programs.join("Null IDE").join("Null IDE.lnk"), exe, install, "")
}
pub fn safe_mode(loc: &Locations, exe: &Path, install: &Path) -> ShortcutSpec {
    spec(loc.programs.join("Null IDE").join("Null IDE (Safe Mode).lnk"), exe, install, "--safe-mode")
}

pub fn create(sys: &dyn System, s: &ShortcutSpec) -> Result<()> {
    if let Some(parent) = s.path.parent() {
        fs::create_dir_all(parent).map_err(|e| Error::Io { context: format!("create {}", parent.display()), source: e })?;
    }
    sys.create_shortcut(s)
}

pub fn remove(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::Io { context: format!("remove {}", path.display()), source: e }),
    }
}

/// The folder goes away with its last shortcut. `remove_dir` refuses a non-empty folder, which is the check.
pub fn remove_empty_start_menu(loc: &Locations) {
    let _ = fs::remove_dir(loc.programs.join("Null IDE"));
}
