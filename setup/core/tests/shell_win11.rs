mod support;

use std::fs;

use null_setup_core::shell::{win11::*, AppxAdd};
use support::{FakeSystem, Hive};

fn install(h: &Hive, with_appx: bool) -> std::path::PathBuf {
    let dir = h.tmp.path().join("Null IDE ünï");
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    if with_appx {
        fs::write(dir.join("shell-ext").join("null-shell-ext.appx"), "x").unwrap();
        fs::write(dir.join("shell-ext").join("NullIDECert.cer"), "x").unwrap();
    }
    dir
}

#[test]
fn a_missing_package_is_reported_and_nothing_is_touched() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let r = register(&h.loc, &sys, &install(&h, false), true).unwrap();
    assert!(matches!(r, Win11::Missing(m) if m.contains("null-shell-ext.appx")));
    assert!(sys.calls.borrow().is_empty());
}

#[test]
fn an_update_with_an_untrusted_certificate_keeps_the_existing_package_untouched() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.package.borrow_mut() = Some("NullIDE.ExplorerCommand_1_x64".into());
    let r = register(&h.loc, &sys, &install(&h, true), false).unwrap();
    assert_eq!(r, Win11::Kept);
    assert!(sys.calls.borrow().is_empty(), "{:?}", sys.calls.borrow());
    assert_eq!(sys.package.borrow().as_deref(), Some("NullIDE.ExplorerCommand_1_x64"));
}

#[test]
fn an_update_with_an_untrusted_certificate_and_no_package_asks_for_reapproval() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Win11::NeedsReapproval);
    assert!(sys.calls.borrow().is_empty());
}

#[test]
fn a_trusted_certificate_replaces_the_package_without_elevating() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    sys.machine_trusted.set(true);
    *sys.package.borrow_mut() = Some("OLD".into());
    let dir = install(&h, true);
    assert_eq!(register(&h.loc, &sys, &dir, false).unwrap(), Win11::Registered);
    assert_eq!(*sys.calls.borrow(), ["cert_user", "restart_explorer", "appx_remove:OLD", "appx_add", "restart_explorer"]);
    assert_eq!(h.get(r"Software\Classes\NullIDEContextMenu", "InstallDir"), dir.display().to_string());
}

#[test]
fn a_fresh_install_imports_the_certificate_after_the_first_add_is_refused() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.adds.borrow_mut() = vec![AppxAdd::UntrustedRoot, AppxAdd::Added];
    assert_eq!(register(&h.loc, &sys, &install(&h, true), true).unwrap(), Win11::Registered);
    assert_eq!(*sys.calls.borrow(), ["cert_user", "appx_add", "cert_machine", "appx_add", "restart_explorer"]);
}

#[test]
fn a_declined_uac_prompt_is_an_error_and_leaves_no_half_state_behind() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.adds.borrow_mut() = vec![AppxAdd::UntrustedRoot];
    *sys.elevated.borrow_mut() = Some(Err("Could not install the shell extension certificate (exit 1223)".into()));
    let e = register(&h.loc, &sys, &install(&h, true), true).unwrap_err().to_string();
    assert!(e.contains("certificate"), "{e}");
    assert_eq!(sys.count("appx_add"), 1); // not retried after the refusal
}

#[test]
fn a_declined_uac_prompt_keeps_the_existing_package_when_modify_replaces_it() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.package.borrow_mut() = Some("OLD".into());
    *sys.elevated.borrow_mut() = Some(Err("Could not install the shell extension certificate (exit 1223)".into()));
    assert!(register(&h.loc, &sys, &install(&h, true), true).is_err());
    assert_eq!(sys.package.borrow().as_deref(), Some("OLD"));
    assert_eq!(sys.count("appx_remove:OLD"), 0);
    assert_eq!(sys.count("appx_add"), 0);
}

#[test]
fn the_cmdlet_message_survives_when_adding_fails_for_another_reason() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    *sys.adds.borrow_mut() = vec![AppxAdd::Failed("0x80073CF9 deployment failed".into())];
    let e = register(&h.loc, &sys, &install(&h, true), true).unwrap_err().to_string();
    assert!(e.contains("Win11 context menu registration failed") && e.contains("0x80073CF9"), "{e}");
}

#[test]
fn an_update_whose_add_hits_an_untrusted_root_asks_for_reapproval_instead_of_elevating() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    sys.machine_trusted.set(true); // looked trusted, Windows disagreed
    *sys.adds.borrow_mut() = vec![AppxAdd::UntrustedRoot];
    assert_eq!(register(&h.loc, &sys, &install(&h, true), false).unwrap(), Win11::NeedsReapproval);
    assert_eq!(sys.count("cert_machine"), 0);
}

#[test]
fn unregister_removes_the_package_and_is_fine_without_one() {
    let sys = FakeSystem::default();
    unregister(&sys).unwrap();
    assert!(sys.calls.borrow().is_empty());
    *sys.package.borrow_mut() = Some("P".into());
    unregister(&sys).unwrap();
    assert_eq!(*sys.calls.borrow(), ["appx_remove:P"]);
}
