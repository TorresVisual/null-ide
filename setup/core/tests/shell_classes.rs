mod support;

use std::path::Path;

use null_setup_core::shell::classes::*;
use support::Hive;

const EXE: &str = r"C:\Null IDE ünï\null.exe";

#[test]
fn writes_three_verbs_and_the_enable_key() {
    let h = Hive::new();
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    assert_eq!(h.get(r"Software\Classes\*\shell\NullIDE", ""), "Open in Null");
    assert_eq!(h.get(r"Software\Classes\*\shell\NullIDE", "Icon"), format!("{EXE},0"));
    assert_eq!(h.get(r"Software\Classes\*\shell\NullIDE\command", ""), format!("\"{EXE}\" \"%1\""));
    assert_eq!(h.get(r"Software\Classes\Directory\shell\NullIDE", ""), "Open Folder in Null");
    assert_eq!(h.get(r"Software\Classes\Directory\Background\shell\NullIDE\command", ""), format!("\"{EXE}\" \"%V\""));
    assert_eq!(h.get(r"Software\Classes\NullIDEContextMenu", "Title"), "Open with Null");
    assert_eq!(h.get(r"Software\Classes\NullIDEContextMenu", "InstallDir"), r"C:\Null IDE ünï");
}

#[test]
fn registering_twice_changes_nothing_and_unregistering_twice_is_fine() {
    let h = Hive::new();
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    assert_eq!(h.get(r"Software\Classes\Directory\shell\NullIDE\command", ""), format!("\"{EXE}\" \"%1\""));
    unregister_context_menu(&h.loc).unwrap();
    unregister_context_menu(&h.loc).unwrap();
    assert!(!h.exists(r"Software\Classes\*\shell\NullIDE") && !h.exists(r"Software\Classes\NullIDEContextMenu"));
}

#[test]
fn unregistering_leaves_other_apps_verbs_alone() {
    let h = Hive::new();
    h.set_text(r"Software\Classes\Directory\shell\Other", "", "Open in Other");
    register_context_menu(&h.loc, Path::new(EXE)).unwrap();
    unregister_context_menu(&h.loc).unwrap();
    assert_eq!(h.get(r"Software\Classes\Directory\shell\Other", ""), "Open in Other");
}
