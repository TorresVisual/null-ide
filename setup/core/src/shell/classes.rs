use std::path::Path;

use super::{create, remove_tree, set, Locations};
use crate::error::Result;

const VERB_KEYS: [&str; 3] = [
    r"Software\Classes\*\shell\NullIDE",
    r"Software\Classes\Directory\shell\NullIDE",
    r"Software\Classes\Directory\Background\shell\NullIDE",
];
const CONTEXT_KEY: &str = r"Software\Classes\NullIDEContextMenu";

pub fn register_context_menu(loc: &Locations, exe: &Path) -> Result<()> {
    let exe_s = exe.display().to_string();
    let verbs = [
        (VERB_KEYS[0], "Open in Null", "%1"),
        (VERB_KEYS[1], "Open Folder in Null", "%1"),
        (VERB_KEYS[2], "Open Folder in Null", "%V"),
    ];
    for (key, label, arg) in verbs {
        let k = create(loc, key)?;
        set(&k, "", label)?;
        set(&k, "Icon", &format!("{exe_s},0"))?;
        let cmd = create(loc, &format!(r"{key}\command"))?;
        set(&cmd, "", &format!("\"{exe_s}\" \"{arg}\""))?;
    }
    set_context_menu_key(loc, exe.parent().unwrap_or(exe))
}

/// The Win11 shell-extension DLL reads these two values to decide whether to show itself and what to call itself.
pub fn set_context_menu_key(loc: &Locations, install: &Path) -> Result<()> {
    let k = create(loc, CONTEXT_KEY)?;
    set(&k, "Title", "Open with Null")?;
    set(&k, "InstallDir", &install.display().to_string())
}

pub fn unregister_context_menu(loc: &Locations) -> Result<()> {
    for key in VERB_KEYS.iter().chain(std::iter::once(&CONTEXT_KEY)) {
        remove_tree(loc, key)?;
    }
    Ok(())
}
