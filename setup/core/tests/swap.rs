use std::{fs, path::{Path, PathBuf}, process::Command, thread, time::Duration};

use null_setup_core::{
    swap::{commit, journal_path, lock_install, plan_for, ready_marker, recover, rollback, swap, Hook, Plan, Recovered, Step, Timing},
    Error,
};

const T: Timing = Timing { retries: 2, delay: Duration::from_millis(1) };

struct Fx { _tmp: tempfile::TempDir, plan: Plan }

fn fixture() -> Fx {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE ünï");
    fs::create_dir_all(install.join("data")).unwrap();
    fs::write(install.join("old.txt"), "old").unwrap();
    fs::write(install.join("data").join("user.txt"), "mine").unwrap();
    let plan = plan_for(&install, "v2");
    fs::create_dir_all(&plan.staged).unwrap();
    fs::write(plan.staged.join("new.txt"), "new").unwrap();
    Fx { _tmp: tmp, plan }
}

fn is_old(install: &Path) -> bool {
    install.join("old.txt").exists() && !install.join("new.txt").exists()
        && fs::read_to_string(install.join("data").join("user.txt")).unwrap() == "mine"
}

fn crash_at(step: Step) -> impl FnMut(Step) -> Hook { move |s| if s == step { Hook::Crash } else { Hook::Continue } }
fn fail_at(step: Step) -> impl FnMut(Step) -> Hook { move |s| if s == step { Hook::Fail } else { Hook::Continue } }

#[test]
fn happy_path_moves_the_new_install_in_keeps_data_and_commit_cleans_up() {
    let f = fixture();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    assert!(f.plan.install.join("new.txt").exists() && !f.plan.install.join("old.txt").exists());
    assert_eq!(fs::read_to_string(f.plan.install.join("data").join("user.txt")).unwrap(), "mine");
    assert!(f.plan.aside.join("old.txt").exists());
    assert!(journal_path(&f.plan.install).exists());
    commit(&f.plan).unwrap();
    assert!(!f.plan.aside.exists() && !journal_path(&f.plan.install).exists());
}

#[test]
fn a_failure_at_each_step_rolls_back_to_the_untouched_old_install() {
    for step in [Step::Started, Step::AsideDone, Step::MovedIn] {
        let f = fixture();
        assert!(swap(&f.plan, &T, &mut fail_at(step)).is_err(), "{step:?}");
        assert!(is_old(&f.plan.install), "{step:?}");
        assert!(!f.plan.staged.exists() && !f.plan.aside.exists(), "{step:?}");
        assert!(!journal_path(&f.plan.install).exists(), "{step:?}");
    }
}

#[test]
fn a_crash_at_each_step_is_undone_by_recover() {
    for step in [Step::Started, Step::AsideDone, Step::MovedIn] {
        let f = fixture();
        assert!(matches!(swap(&f.plan, &T, &mut crash_at(step)), Err(Error::Crashed)));
        assert_eq!(recover(&f.plan.install, &T).unwrap(), Recovered::RolledBack, "{step:?}");
        assert!(is_old(&f.plan.install), "{step:?}");
        assert_eq!(recover(&f.plan.install, &T).unwrap(), Recovered::Nothing, "second recover is a no-op");
    }
}

#[test]
fn recover_commits_when_the_new_ide_wrote_its_ready_marker() {
    let f = fixture();
    assert!(matches!(swap(&f.plan, &T, &mut crash_at(Step::MovedIn)), Err(Error::Crashed)));
    fs::write(ready_marker(&f.plan.install), "1").unwrap();
    assert_eq!(recover(&f.plan.install, &T).unwrap(), Recovered::Committed);
    assert!(f.plan.install.join("new.txt").exists());
    assert!(!f.plan.aside.exists() && !journal_path(&f.plan.install).exists() && !ready_marker(&f.plan.install).exists());
}

#[test]
fn a_stale_backup_directory_does_not_make_a_fresh_swap_restore_old_files() {
    let f = fixture();
    fs::create_dir_all(&f.plan.aside).unwrap();
    fs::write(f.plan.aside.join("stale.txt"), "stale").unwrap();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    assert!(f.plan.install.join("new.txt").exists());
    assert!(!f.plan.aside.join("stale.txt").exists());
}

#[test]
fn rollback_after_move_in_hands_the_data_dir_back() {
    let f = fixture();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    fs::write(f.plan.install.join("data").join("created-by-new.txt"), "n").unwrap();
    rollback(&f.plan, &T).unwrap();
    assert!(f.plan.install.join("old.txt").exists());
    assert!(f.plan.install.join("data").join("created-by-new.txt").exists());
}

#[test]
fn a_locked_install_directory_fails_the_swap_and_leaves_it_intact() {
    let f = fixture();
    let exe: PathBuf = f.plan.install.join("hold.exe");
    fs::copy(r"C:\Windows\System32\PING.EXE", &exe).unwrap();
    // a process whose working directory is the install dir blocks renaming it
    let mut child = Command::new(&exe).args(["-n", "30", "127.0.0.1"]).current_dir(&f.plan.install).spawn().unwrap();
    thread::sleep(Duration::from_millis(300));
    let r = swap(&f.plan, &T, &mut |_| Hook::Continue);
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(matches!(r, Err(Error::Io { .. })));
    assert!(f.plan.install.join("old.txt").exists() && !f.plan.install.join("new.txt").exists());
}

#[test]
fn recover_does_nothing_while_another_live_process_holds_the_update_lock() {
    let f = fixture();
    assert!(matches!(swap(&f.plan, &T, &mut crash_at(Step::AsideDone)), Err(Error::Crashed)));
    let parent = f.plan.install.parent().unwrap().to_path_buf();
    let mut child = Command::new(r"C:\Windows\System32\PING.EXE").args(["-n", "30", "127.0.0.1"]).spawn().unwrap();
    fs::write(parent.join(".null-update.lock"), child.id().to_string()).unwrap();
    let r = recover(&f.plan.install, &T);
    child.kill().unwrap();
    child.wait().unwrap();
    assert_eq!(r.unwrap(), Recovered::Nothing);
    assert!(journal_path(&f.plan.install).exists() && f.plan.aside.exists());
}

#[test]
fn a_second_update_cannot_take_the_install_lock() {
    let f = fixture();
    let _held = lock_install(&f.plan.install, Duration::ZERO).unwrap();
    assert!(matches!(lock_install(&f.plan.install, Duration::ZERO), Err(Error::Busy)));
}

#[test]
fn a_journal_for_another_install_or_with_foreign_paths_is_ignored() {
    let f = fixture();
    assert!(matches!(swap(&f.plan, &T, &mut crash_at(Step::AsideDone)), Err(Error::Crashed)));
    let parent = f.plan.install.parent().unwrap();
    // another install in the same parent folder must not be rolled back by this one's journal
    let other = parent.join("Other IDE");
    fs::create_dir_all(&other).unwrap();
    assert_eq!(recover(&other, &T).unwrap(), Recovered::Nothing);
    assert!(journal_path(&f.plan.install).exists());
    // a journal whose paths do not look like ours is never acted on
    let victim = parent.join("victim");
    fs::create_dir_all(&victim).unwrap();
    fs::write(victim.join("keep.txt"), "x").unwrap();
    let forged = serde_json::json!({ "plan": { "install": f.plan.install, "staged": victim, "aside": f.plan.aside }, "step": "AsideDone" });
    fs::write(journal_path(&f.plan.install), forged.to_string()).unwrap();
    assert_eq!(recover(&f.plan.install, &T).unwrap(), Recovered::Nothing);
    assert!(victim.join("keep.txt").exists());
}

#[test]
fn the_installers_uninstaller_files_survive_a_swap_and_a_rollback() {
    let f = fixture();
    fs::write(f.plan.install.join("unins000.exe"), "u").unwrap();
    fs::write(f.plan.install.join("unins000.dat"), "d").unwrap();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    assert!(f.plan.install.join("unins000.exe").exists() && f.plan.install.join("unins000.dat").exists());
    rollback(&f.plan, &T).unwrap();
    assert!(f.plan.install.join("unins000.exe").exists() && f.plan.install.join("old.txt").exists());
}

#[test]
fn rollback_leaves_no_failed_install_copy_behind() {
    let f = fixture();
    swap(&f.plan, &T, &mut |_| Hook::Continue).unwrap();
    rollback(&f.plan, &T).unwrap();
    let leftovers: Vec<_> = fs::read_dir(f.plan.install.parent().unwrap()).unwrap()
        .flatten().map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(".null-ide-")).collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}
