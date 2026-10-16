use std::path::Path;

use super::{assoc, create, open, open_write, remove_tree, set, Locations, System};
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

pub const PREVIEW_CLSID: &str = "{58F3B583-5D67-489A-9069-97FD45B2569B}";
const PREVIEW_SHELLEX: &str = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";
const PREVIEW_APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers";
const REGISTERED_APPS: &str = r"Software\RegisteredApplications";

pub fn register_file_associations(loc: &Locations, sys: &dyn System, install: &Path) -> Result<usize> {
    let exe = install.join("null.exe").display().to_string();
    let icons = install.join("resources").join("file-assoc-icons");
    let open_cmd = format!("\"{exe}\" \"%1\"");
    for a in assoc::TABLE {
        let id = assoc::prog_id(a);
        let prog = format!(r"Software\Classes\{id}");
        let k = create(loc, &prog)?;
        set(&k, "", a.description)?;
        set(&k, "FriendlyTypeName", a.description)?;
        let icon = icons.join(format!("{}.ico", a.icon.unwrap_or(a.key)));
        set(&create(loc, &format!(r"{prog}\DefaultIcon"))?, "", &format!("{},0", icon.display()))?;
        set(&create(loc, &format!(r"{prog}\shell\open\command"))?, "", &open_cmd)?;
        for ext in a.extensions {
            set(&create(loc, &format!(r"Software\Classes\{ext}\OpenWithProgids"))?, &id, "")?;
        }
    }
    let all = assoc::all_extensions();
    let app = create(loc, r"Software\Classes\Applications\null.exe")?;
    set(&app, "FriendlyAppName", "Null IDE")?;
    app.set_value("SupportedTypes", &all.iter().map(|s| s.to_string()).collect::<Vec<String>>())
        .map_err(|e| crate::error::Error::Io { context: "write SupportedTypes".into(), source: e })?;
    set(&create(loc, r"Software\Classes\Applications\null.exe\shell\open\command")?, "", &open_cmd)?;

    let cap = create(loc, r"Software\Classes\NullIDE\Capabilities")?;
    set(&cap, "ApplicationName", "Null IDE")?;
    set(&cap, "ApplicationDescription", "A custom Windows code editor built on VSCodium.")?;
    let fa = create(loc, r"Software\Classes\NullIDE\Capabilities\FileAssociations")?;
    for a in assoc::TABLE {
        for ext in a.extensions {
            set(&fa, ext, &assoc::prog_id(a))?;
        }
    }
    set(&create(loc, REGISTERED_APPS)?, "Null IDE", r"Software\Classes\NullIDE\Capabilities")?;
    sys.assoc_changed();
    Ok(all.len())
}

pub fn unregister_file_associations(loc: &Locations, sys: &dyn System) -> Result<()> {
    for a in assoc::TABLE {
        let id = assoc::prog_id(a);
        remove_tree(loc, &format!(r"Software\Classes\{id}"))?;
        for ext in a.extensions {
            if let Some(k) = open_write(loc, &format!(r"Software\Classes\{ext}\OpenWithProgids")) {
                let _ = k.delete_value(&id); // missing value: nothing to do
            }
        }
    }
    remove_tree(loc, r"Software\Classes\Applications\null.exe")?;
    remove_tree(loc, r"Software\Classes\NullIDE")?;
    if let Some(k) = open_write(loc, REGISTERED_APPS) {
        let _ = k.delete_value("Null IDE");
    }
    sys.assoc_changed();
    Ok(())
}

pub fn register_preview_handler(loc: &Locations, sys: &dyn System, install: &Path) -> Result<(usize, usize)> {
    let dll = install.join("shell-ext").join("NullIDE.ExplorerCommand").join("x64").join("null_explorer_command.dll");
    let clsid = format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}");
    set(&create(loc, &clsid)?, "", "Null IDE Preview Handler")?;
    let inproc = create(loc, &format!(r"{clsid}\InprocServer32"))?;
    set(&inproc, "", &dll.display().to_string())?;
    set(&inproc, "ThreadingModel", "Apartment")?;
    set(&create(loc, PREVIEW_APPROVED)?, PREVIEW_CLSID, "Null IDE Preview Handler")?;

    let (mut claimed, mut skipped) = (0, 0);
    for ext in assoc::all_extensions() {
        let key = format!(r"Software\Classes\{ext}\shellex\{PREVIEW_SHELLEX}");
        // Another app (PowerToys' preview handlers, for instance) already owns this extension: do not take it over.
        let owner: Option<String> = open(loc, &key).and_then(|k| k.get_value("").ok());
        if owner.as_deref().is_some_and(|o| !o.is_empty() && !o.eq_ignore_ascii_case(PREVIEW_CLSID)) {
            skipped += 1;
            continue;
        }
        set(&create(loc, &key)?, "", PREVIEW_CLSID)?;
        claimed += 1;
    }
    sys.assoc_changed();
    Ok((claimed, skipped))
}

pub fn unregister_preview_handler(loc: &Locations, sys: &dyn System) -> Result<()> {
    for ext in assoc::all_extensions() {
        let key = format!(r"Software\Classes\{ext}\shellex\{PREVIEW_SHELLEX}");
        let owner: Option<String> = open(loc, &key).and_then(|k| k.get_value("").ok());
        if owner.is_some_and(|o| o.eq_ignore_ascii_case(PREVIEW_CLSID)) {
            remove_tree(loc, &key)?;
        }
    }
    remove_tree(loc, &format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}"))?;
    if let Some(k) = open_write(loc, PREVIEW_APPROVED) {
        let _ = k.delete_value(PREVIEW_CLSID);
    }
    sys.assoc_changed();
    Ok(())
}
