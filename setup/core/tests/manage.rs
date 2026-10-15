use std::{fs, path::Path, time::Duration};

use null_setup_core::{
    install_config::{self, InstallConfig},
    manage::{modify_in_place, uninstall, UninstallOpts},
    progress::{Ctx, Logger, NoInteract},
    registrations::Registration,
    swap::Timing,
};

fn run<T>(f: impl FnOnce(&Ctx) -> T) -> T {
    let log = Logger::none();
    let progress = |_| {};
    f(&Ctx { progress: &progress, log: &log, interact: &NoInteract })
}

fn install_in(root: &Path) -> std::path::PathBuf {
    let dir = root.join("Null IDE x");
    fs::create_dir_all(dir.join("data")).unwrap();
    fs::create_dir_all(dir.join("resources").join("app")).unwrap();
    fs::write(dir.join(".null-ide-install.json"), r#"{"repo":"o/r","version":"v1"}"#).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    fs::write(dir.join("data").join("user.txt"), "mine").unwrap();
    dir
}

fn opts(dir: &Path, delete: bool, user_data: &Path) -> UninstallOpts {
    let mut o = UninstallOpts::standard(dir.to_path_buf(), delete, user_data.to_path_buf());
    o.timing = Timing { retries: 2, delay: Duration::from_millis(1) };
    o.close_grace = Duration::from_millis(500);
    o.release_shell_ext = false;
    o
}

#[test]
fn modify_in_place_only_rewrites_the_config() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let new = InstallConfig { desktop_shortcut: true, ..Default::default() };
    let r = run(|c| modify_in_place(&dir, &new, true, c)).unwrap();
    assert_eq!(r, Registration::Skipped); // no registration script in this fake install
    assert_eq!(install_config::read(&dir).unwrap(), new);
    assert!(dir.join("null.exe").exists() && dir.join("data").join("user.txt").exists());
    assert!(!dir.parent().unwrap().join(".null-update-journal.json").exists());
}

#[test]
fn modify_in_place_refuses_a_changed_builtin_set_and_a_foreign_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let changed = InstallConfig { excluded_builtins: vec!["null-music".into()], ..Default::default() };
    let e = run(|c| modify_in_place(&dir, &changed, true, c)).unwrap_err().to_string();
    assert!(e.contains("built-in"), "{e}");
    assert!(!dir.join("install-config.json").exists());

    let foreign = tmp.path().join("Documents");
    fs::create_dir_all(&foreign).unwrap();
    assert!(run(|c| modify_in_place(&foreign, &InstallConfig::default(), true, c)).is_err());
    assert!(!foreign.join("install-config.json").exists());
}

#[test]
fn uninstall_removes_the_app_but_keeps_portable_data_by_default() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let appdata = tmp.path().join("Roaming").join("Null");
    fs::create_dir_all(&appdata).unwrap();
    fs::write(appdata.join("settings.json"), "{}").unwrap();
    run(|c| uninstall(&opts(&dir, false, &appdata), c)).unwrap();
    assert!(!dir.join("null.exe").exists() && !dir.join(".null-ide-install.json").exists());
    assert_eq!(fs::read_to_string(dir.join("data").join("user.txt")).unwrap(), "mine");
    assert!(appdata.join("settings.json").exists());
}

#[test]
fn uninstall_with_delete_removes_everything_including_the_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let appdata = tmp.path().join("Roaming").join("Null");
    fs::create_dir_all(&appdata).unwrap();
    fs::write(appdata.join("settings.json"), "{}").unwrap();
    run(|c| uninstall(&opts(&dir, true, &appdata), c)).unwrap();
    assert!(!dir.exists() && !appdata.exists());
}

#[test]
fn uninstall_never_deletes_a_folder_that_is_not_a_null_install() {
    let tmp = tempfile::tempdir().unwrap();
    let foreign = tmp.path().join("Documents");
    fs::create_dir_all(&foreign).unwrap();
    fs::write(foreign.join("thesis.txt"), "important").unwrap();
    let e = run(|c| uninstall(&opts(&foreign, true, &tmp.path().join("Null")), c)).unwrap_err().to_string();
    assert!(e.contains("not a Null IDE install"), "{e}");
    assert_eq!(fs::read_to_string(foreign.join("thesis.txt")).unwrap(), "important");
}

#[test]
fn deleting_user_data_only_ever_targets_a_folder_named_null() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = install_in(tmp.path());
    let not_null = tmp.path().join("Documents");
    fs::create_dir_all(&not_null).unwrap();
    fs::write(not_null.join("thesis.txt"), "important").unwrap();
    assert!(run(|c| uninstall(&opts(&dir, true, &not_null), c)).is_err());
    assert!(not_null.join("thesis.txt").exists());
    assert!(dir.join("null.exe").exists()); // refused before anything was removed
}
