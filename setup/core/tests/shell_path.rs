mod support;

use std::path::Path;

use null_setup_core::shell::path::*;
use support::{FakeSystem, Hive};
use winreg::enums::{REG_EXPAND_SZ, REG_SZ};

#[test]
fn with_dir_appends_once_ignoring_case_and_trailing_backslash() {
    assert_eq!(with_dir(r"C:\a;C:\b", r"C:\x").as_deref(), Some(r"C:\a;C:\b;C:\x"));
    assert_eq!(with_dir(r"C:\a;c:\X\", r"C:\x"), None);
    assert_eq!(with_dir("", r"C:\x").as_deref(), Some(r"C:\x"));
    assert_eq!(with_dir(r"C:\a;;C:\b;", r"C:\x").as_deref(), Some(r"C:\a;C:\b;C:\x")); // empty segments dropped, as before
}

#[test]
fn without_dir_removes_every_match_and_keeps_the_rest_verbatim() {
    assert_eq!(without_dir(r"%USERPROFILE%\bin;C:\x;C:\y", r"C:\x").as_deref(), Some(r"%USERPROFILE%\bin;C:\y"));
    assert_eq!(without_dir(r"C:\a;C:\b", r"C:\x"), None);
}

#[test]
fn add_keeps_the_value_type_and_percent_entries() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_raw("Environment", "Path", REG_EXPAND_SZ, r"%USERPROFILE%\bin;C:\Tools");
    add(&h.loc, &sys, Path::new(r"C:\Null IDE ünï\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), r"%USERPROFILE%\bin;C:\Tools;C:\Null IDE ünï\bin");
    assert_eq!(h.raw_type("Environment", "Path"), REG_EXPAND_SZ);
    assert_eq!(sys.count("env_changed"), 1);
    add(&h.loc, &sys, Path::new(r"C:\Null IDE ünï\bin")).unwrap(); // already there: no write, no broadcast
    assert_eq!(sys.count("env_changed"), 1);
}

#[test]
fn add_creates_the_value_when_the_user_has_no_path_and_keeps_reg_sz() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    add(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), r"C:\n\bin");
    let h2 = Hive::new();
    h2.set_raw("Environment", "Path", REG_SZ, r"C:\a");
    add(&h2.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h2.raw_type("Environment", "Path"), REG_SZ);
}

#[test]
fn a_very_long_path_survives_untouched() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let long = (0..120).map(|i| format!(r"C:\some\long\folder\number\{i}")).collect::<Vec<_>>().join(";");
    assert!(long.len() > 3000);
    h.set_raw("Environment", "Path", REG_EXPAND_SZ, &long);
    add(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), format!(r"{long};C:\n\bin"));
}

#[test]
fn remove_drops_the_entry_and_does_nothing_when_it_is_absent() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_raw("Environment", "Path", REG_EXPAND_SZ, r"C:\a;C:\n\bin;C:\b");
    remove(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(h.get("Environment", "Path"), r"C:\a;C:\b");
    remove(&h.loc, &sys, Path::new(r"C:\n\bin")).unwrap();
    assert_eq!(sys.count("env_changed"), 1);
    remove(&Hive::new().loc, &sys, Path::new(r"C:\n\bin")).unwrap(); // no Path value at all
}
