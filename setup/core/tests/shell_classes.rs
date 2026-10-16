mod support;

use std::path::Path;

use null_setup_core::shell::classes::*;
use null_setup_core::shell::assoc::all_extensions;
use support::{FakeSystem, Hive};

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

const INSTALL: &str = r"C:\Null IDE ünï";

#[test]
fn file_associations_write_progids_openwith_and_capabilities() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let n = register_file_associations(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    assert_eq!(n, all_extensions().len());
    let p = r"Software\Classes\NullIDE.AssocFile.ts";
    assert_eq!(h.get(p, ""), "TypeScript File");
    assert_eq!(h.get(p, "FriendlyTypeName"), "TypeScript File");
    assert_eq!(h.get(&format!(r"{p}\DefaultIcon"), ""), format!(r"{INSTALL}\resources\file-assoc-icons\ts.ico,0"));
    assert_eq!(h.get(&format!(r"{p}\shell\open\command"), ""), format!("\"{INSTALL}\\null.exe\" \"%1\""));
    // keys marked Icon = 'document' use that icon
    assert!(h.get(r"Software\Classes\NullIDE.AssocFile.log\DefaultIcon", "").ends_with(r"document.ico,0"));
    assert!(h.value_names(r"Software\Classes\.tsx\OpenWithProgids").contains(&"NullIDE.AssocFile.ts".to_string()));
    assert_eq!(h.get(r"Software\Classes\Applications\null.exe", "FriendlyAppName"), "Null IDE");
    assert_eq!(h.get(r"Software\Classes\NullIDE\Capabilities", "ApplicationName"), "Null IDE");
    assert_eq!(h.get(r"Software\Classes\NullIDE\Capabilities\FileAssociations", ".tsx"), "NullIDE.AssocFile.ts");
    assert_eq!(h.get(r"Software\RegisteredApplications", "Null IDE"), r"Software\Classes\NullIDE\Capabilities");
    assert_eq!(sys.count("assoc_changed"), 1);
}

#[test]
fn unregistering_file_associations_removes_only_ours() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_text(r"Software\Classes\.js\OpenWithProgids", "Other.App", "");
    h.set_text(r"Software\RegisteredApplications", "Other", r"Software\Other\Capabilities");
    register_file_associations(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    unregister_file_associations(&h.loc, &sys).unwrap();
    unregister_file_associations(&h.loc, &sys).unwrap(); // nothing left: still fine
    assert!(!h.exists(r"Software\Classes\NullIDE.AssocFile.js") && !h.exists(r"Software\Classes\NullIDE"));
    assert!(!h.exists(r"Software\Classes\Applications\null.exe"));
    assert_eq!(h.value_names(r"Software\Classes\.js\OpenWithProgids"), ["Other.App"]);
    assert_eq!(h.value_names(r"Software\RegisteredApplications"), ["Other"]);
}

#[test]
fn preview_handler_claims_free_extensions_and_skips_owned_ones() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let other = r"Software\Classes\.json\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}";
    h.set_text(other, "", "{11111111-2222-3333-4444-555555555555}");
    let (claimed, skipped) = register_preview_handler(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    assert_eq!((claimed, skipped), (all_extensions().len() - 1, 1));
    assert_eq!(h.get(other, ""), "{11111111-2222-3333-4444-555555555555}");
    assert_eq!(h.get(r"Software\Classes\.md\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}", ""), PREVIEW_CLSID);
    assert_eq!(
        h.get(&format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}\InprocServer32"), ""),
        format!(r"{INSTALL}\shell-ext\NullIDE.ExplorerCommand\x64\null_explorer_command.dll")
    );
    assert_eq!(h.get(&format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}\InprocServer32"), "ThreadingModel"), "Apartment");
    assert_eq!(h.get(r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers", PREVIEW_CLSID), "Null IDE Preview Handler");
}

#[test]
fn preview_handler_removal_touches_only_our_claims() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let guid = r"{8895b1c6-b41f-4c1c-a562-0d564250836f}";
    h.set_text(&format!(r"Software\Classes\.json\shellex\{guid}"), "", "{11111111-2222-3333-4444-555555555555}");
    register_preview_handler(&h.loc, &sys, Path::new(INSTALL)).unwrap();
    unregister_preview_handler(&h.loc, &sys).unwrap();
    unregister_preview_handler(&h.loc, &sys).unwrap();
    assert!(!h.exists(&format!(r"Software\Classes\.md\shellex\{guid}")));
    assert_eq!(h.get(&format!(r"Software\Classes\.json\shellex\{guid}"), ""), "{11111111-2222-3333-4444-555555555555}");
    assert!(!h.exists(&format!(r"Software\Classes\CLSID\{PREVIEW_CLSID}")));
    assert!(h.try_get(r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers", PREVIEW_CLSID).is_none());
}
