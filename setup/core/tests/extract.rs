mod support;
use std::fs;

use null_setup_core::{
    extract::extract,
    progress::{Ctx, Logger, NoInteract, Progress},
    Error,
};

fn run<T>(f: impl FnOnce(&Ctx) -> T) -> T {
    let log = Logger::none();
    let progress = |_p: Progress| {};
    f(&Ctx { progress: &progress, log: &log, interact: &NoInteract })
}

#[test]
fn extracts_files_and_folders_including_backslash_entry_names() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("a.zip");
    support::make_zip(&zip, &[("null.exe", b"exe"), ("resources\\app\\x.txt", b"x"), ("setup/null-setup.exe", b"s")]);
    let dest = tmp.path().join("stage");
    run(|c| extract(&zip, &dest, c)).unwrap();
    assert_eq!(fs::read(dest.join("resources").join("app").join("x.txt")).unwrap(), b"x");
    assert_eq!(fs::read(dest.join("setup").join("null-setup.exe")).unwrap(), b"s");
}

#[test]
fn rejects_path_traversal_and_writes_nothing_outside() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("evil.zip");
    support::make_zip(&zip, &[("null.exe", b"exe"), ("../evil.txt", b"x")]);
    let dest = tmp.path().join("stage");
    let err = run(|c| extract(&zip, &dest, c)).unwrap_err();
    assert!(matches!(err, Error::Package(_)));
    assert!(!tmp.path().join("evil.txt").exists());
    assert!(!dest.exists());
}

#[test]
fn rejects_absolute_entry_names() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("abs.zip");
    support::make_zip(&zip, &[("null.exe", b"exe"), ("C:\\Windows\\evil.txt", b"x")]);
    let err = run(|c| extract(&zip, &tmp.path().join("stage"), c)).unwrap_err();
    assert!(matches!(err, Error::Package(_)));
}

#[test]
fn a_package_without_null_exe_is_rejected_and_cleaned_up() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("x.zip");
    support::make_zip(&zip, &[("readme.txt", b"x")]);
    let dest = tmp.path().join("stage");
    assert!(matches!(run(|c| extract(&zip, &dest, c)), Err(Error::Package(_))));
    assert!(!dest.exists());
}

#[test]
fn a_truncated_zip_is_a_package_error() {
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("t.zip");
    support::make_zip(&zip, &[("null.exe", &[1u8; 5000])]);
    let bytes = fs::read(&zip).unwrap();
    fs::write(&zip, &bytes[..bytes.len() / 2]).unwrap();
    assert!(matches!(run(|c| extract(&zip, &tmp.path().join("stage"), c)), Err(Error::Package(_))));
}
