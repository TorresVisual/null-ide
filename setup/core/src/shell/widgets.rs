//! Desktop widgets (`null_widgets.exe`, issue #141): an opt-in HKCU Run entry plus start/stop of the process.
//! The exe is a plain Win32 program in the install root: no package, no signing, no elevation.

use std::{fs, io, path::Path};

use super::{create, open_write, set, Locations, System};
use crate::error::{Error, Result};

pub const EXE: &str = "null_widgets.exe";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "NullWidgets";

/// Writes the Run entry (so the widgets come back at every login) and starts the exe now. A second start of a running exe only
/// asks it to show hidden widgets again.
pub fn register(loc: &Locations, sys: &dyn System, install: &Path, log: &dyn Fn(&str)) -> Result<()> {
    let exe = install.join(EXE);
    if !exe.is_file() {
        log(&format!("widgets not registered: {} not found", exe.display()));
        return Ok(());
    }
    set(&create(loc, RUN_KEY)?, RUN_VALUE, &format!("\"{}\"", exe.display()))?;
    sys.start_widgets(&exe);
    Ok(())
}

/// Ends the process, removes the Run entry and deletes the snapshot/layout folder. Works without `null.exe` and on machines that never
/// had the feature.
pub fn unregister(loc: &Locations, sys: &dyn System, install: &Path) -> Result<()> {
    sys.stop_widgets(install);
    if let Some(k) = open_write(loc, RUN_KEY) {
        match k.delete_value(RUN_VALUE) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(Error::Io { context: "remove the widgets Run entry".into(), source: e }),
        }
    }
    match fs::remove_dir_all(loc.local_data.join("Null").join("widgets")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::Io { context: "remove the widgets data folder".into(), source: e }),
    }
}
