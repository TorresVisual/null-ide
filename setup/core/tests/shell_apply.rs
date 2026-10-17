mod support;

use std::fs;

use null_setup_core::{
    install_config::Feature,
    registrations::Registration,
    shell::apply_with,
};
use support::{FakeSystem, Hive};

fn install(h: &Hive) -> std::path::PathBuf {
    let dir = h.tmp.path().join("Null IDE ünï");
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    dir
}

fn apply(h: &Hive, sys: &FakeSystem, dir: &std::path::Path, reg: &[Feature], unreg: &[Feature], elevate: bool) -> Registration {
    apply_with(&h.loc, sys, dir, reg, unreg, elevate, &|_| {})
}

#[test]
fn nothing_to_do_is_skipped() {
    let h = Hive::new();
    assert_eq!(apply(&h, &FakeSystem::default(), &install(&h), &[], &[], false), Registration::Skipped);
}

#[test]
fn registers_every_feature_into_the_scratch_locations() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    let r = apply(&h, &sys, &dir, &Feature::ALL, &[], false);
    // The sparse APPX is not in this fake install, so the context menu reports it missing but the verbs are written.
    assert_eq!(r, Registration::Done);
    assert_eq!(sys.count("shortcut:Null IDE (Safe Mode).lnk"), 1);
    assert_eq!(sys.count("shortcut:Null IDE.lnk"), 2); // desktop + start menu share the file name
    assert!(h.exists(r"Software\Classes\Directory\shell\NullIDE"));
    assert!(h.exists(r"Software\Classes\NullIDE.AssocFile.rust"));
    assert!(h.exists(&format!(r"Software\Classes\CLSID\{}", null_setup_core::shell::classes::PREVIEW_CLSID)));
    assert_eq!(h.get("Environment", "Path"), dir.join("bin").display().to_string());
}

#[test]
fn unregistering_works_when_null_exe_is_gone_and_removes_both_path_forms() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    apply(&h, &sys, &dir, &Feature::ALL, &[], false);
    h.set_text("Environment", "Path", &format!(r"C:\a;{};{}", dir.display(), dir.join("bin").display()));
    fs::remove_file(dir.join("null.exe")).unwrap();
    assert_eq!(apply(&h, &sys, &dir, &[], &Feature::ALL, false), Registration::Done);
    assert_eq!(h.get("Environment", "Path"), r"C:\a");
    assert!(!h.exists(r"Software\Classes\NullIDE.AssocFile.rust") && !h.exists(r"Software\Classes\Directory\shell\NullIDE"));
}

#[test]
fn registering_without_null_exe_is_a_warning_not_a_panic() {
    let h = Hive::new();
    let dir = install(&h);
    fs::remove_file(dir.join("null.exe")).unwrap();
    let r = apply(&h, &FakeSystem::default(), &dir, &[Feature::Path], &[], false);
    assert!(matches!(r, Registration::Warning(w) if w.contains("null.exe")));
}

#[test]
fn one_failing_feature_does_not_stop_the_others() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    fs::write(dir.join("shell-ext").join("null-shell-ext.appx"), "x").unwrap();
    fs::write(dir.join("shell-ext").join("NullIDECert.cer"), "x").unwrap();
    *sys.adds.borrow_mut() = vec![null_setup_core::shell::AppxAdd::Failed("boom".into())];
    sys.machine_trusted.set(true);
    let r = apply(&h, &sys, &dir, &[Feature::ContextMenu, Feature::FileAssociations], &[], true);
    assert!(matches!(&r, Registration::Warning(w) if w.contains("contextMenu") && w.contains("boom")), "{r:?}");
    assert!(h.exists(r"Software\Classes\NullIDE.AssocFile.rust")); // still registered
}

#[test]
fn needs_reapproval_wins_and_a_missing_package_is_only_logged() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h);
    fs::write(dir.join("shell-ext").join("null-shell-ext.appx"), "x").unwrap();
    fs::write(dir.join("shell-ext").join("NullIDECert.cer"), "x").unwrap();
    assert_eq!(apply(&h, &sys, &dir, &[Feature::ContextMenu], &[], false), Registration::NeedsReapproval);
}
