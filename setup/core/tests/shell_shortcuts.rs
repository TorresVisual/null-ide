mod support;

use std::{fs, path::Path};

use null_setup_core::shell::{shortcuts::*, sys::{read_shortcut, WinSystem}};
use support::{FakeSystem, Hive};

const INSTALL: &str = r"C:\Null IDE ünï";

#[test]
fn the_three_shortcuts_land_where_the_script_put_them() {
    let h = Hive::new();
    let exe = Path::new(r"C:\Null IDE ünï\null.exe");
    let install = Path::new(INSTALL);
    let d = desktop(&h.loc, exe, install);
    assert_eq!(d.path, h.loc.desktop.join("Null IDE.lnk"));
    let s = start_menu(&h.loc, exe, install);
    assert_eq!(s.path, h.loc.programs.join("Null IDE").join("Null IDE.lnk"));
    assert_eq!(s.args, "");
    let m = safe_mode(&h.loc, exe, install);
    assert_eq!(m.path, h.loc.programs.join("Null IDE").join("Null IDE (Safe Mode).lnk"));
    assert_eq!((m.args.as_str(), m.target.as_path(), m.working_dir.as_path()), ("--safe-mode", exe, install));
}

#[test]
fn create_makes_the_folder_first_and_hands_the_spec_to_the_system() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let spec = start_menu(&h.loc, Path::new(r"C:\x\null.exe"), Path::new(r"C:\x"));
    create(&sys, &spec).unwrap();
    assert!(spec.path.parent().unwrap().is_dir());
    assert_eq!(sys.count("shortcut:Null IDE.lnk"), 1);
}

#[test]
fn removing_the_last_shortcut_removes_the_start_menu_folder() {
    let h = Hive::new();
    let dir = h.loc.programs.join("Null IDE");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Null IDE.lnk"), "x").unwrap();
    fs::write(dir.join("Null IDE (Safe Mode).lnk"), "x").unwrap();
    remove(&dir.join("Null IDE.lnk")).unwrap();
    remove_empty_start_menu(&h.loc);
    assert!(dir.is_dir()); // the Safe Mode shortcut is still in it
    remove(&dir.join("Null IDE (Safe Mode).lnk")).unwrap();
    remove(&dir.join("Null IDE (Safe Mode).lnk")).unwrap(); // already gone
    remove_empty_start_menu(&h.loc);
    assert!(!dir.exists());
    remove_empty_start_menu(&h.loc); // nothing to do
}

#[test]
fn a_real_lnk_round_trips_target_arguments_and_working_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE ünï");
    fs::create_dir_all(&install).unwrap();
    let exe = install.join("null.exe");
    fs::write(&exe, "MZ").unwrap();
    let lnk = tmp.path().join("out").join("Null IDE (Safe Mode).lnk");
    let spec = ShortcutSpec { path: lnk.clone(), target: exe.clone(), working_dir: install.clone(), args: "--safe-mode".into() };
    create(&WinSystem, &spec).unwrap();
    let (target, args, wd) = read_shortcut(&lnk).unwrap();
    assert_eq!((target, args.as_str(), wd), (exe, "--safe-mode", install));
}
