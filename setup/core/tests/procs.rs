use std::{fs, path::Path, process::Command, thread, time::{Duration, Instant}};

use null_setup_core::{
    procs::{close_all, is_under, running_in},
    progress::{Ctx, Logger, NoInteract, Progress},
    Error,
};

#[test]
fn stop_named_under_ends_only_the_named_process_inside_the_folder() {
    let dir = tempfile::tempdir().unwrap();
    // PING.EXE is a long-running console program that does not depend on where it lives.
    let ping = r"C:\Windows\System32\PING.EXE";
    let (target, other) = (dir.path().join("null_widgets.exe"), dir.path().join("other.exe"));
    fs::copy(ping, &target).unwrap();
    fs::copy(ping, &other).unwrap();
    let start = |exe: &Path| Command::new(exe).args(["-n", "60", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
    let (mut a, mut b) = (start(&target), start(&other));
    thread::sleep(Duration::from_millis(300));

    assert!(null_setup_core::procs::stop_named_under(dir.path(), "null_widgets.exe"));
    assert!(a.try_wait().unwrap().is_some(), "the named process is gone");
    assert!(b.try_wait().unwrap().is_none(), "the other process in the same folder is untouched");
    let _ = b.kill();
    assert!(null_setup_core::procs::stop_named_under(dir.path(), "null_widgets.exe"), "nothing to stop is success");
}

#[test]
fn is_under_is_case_insensitive_and_respects_directory_boundaries() {
    let dir = Path::new(r"C:\Users\Me\AppData\Local\Programs\Null IDE");
    assert!(is_under(Path::new(r"c:\users\me\appdata\local\programs\null ide\null.exe"), dir));
    assert!(is_under(Path::new("C:/Users/Me/AppData/Local/Programs/Null IDE/bin/x.exe"), dir));
    assert!(!is_under(Path::new(r"C:\Users\Me\AppData\Local\Programs\Null IDE 2\null.exe"), dir));
    assert!(!is_under(Path::new(r"C:\Windows\explorer.exe"), dir));
}

fn ping_copy(dir: &Path) -> std::path::PathBuf {
    let exe = dir.join("null.exe");
    fs::copy(r"C:\Windows\System32\PING.EXE", &exe).unwrap();
    exe
}

#[test]
fn finds_a_process_running_from_the_directory_and_none_after_it_exits() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = ping_copy(tmp.path());
    let mut child = Command::new(&exe).args(["-n", "30", "127.0.0.1"]).spawn().unwrap();
    thread::sleep(Duration::from_millis(500));
    assert_eq!(running_in(tmp.path()).iter().filter(|r| r.pid == child.id()).count(), 1);
    child.kill().unwrap();
    child.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !running_in(tmp.path()).is_empty() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
    }
    assert!(running_in(tmp.path()).is_empty());
}

#[test]
fn finds_a_process_whose_working_directory_is_inside_the_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let sub = tmp.path().join("bin");
    fs::create_dir(&sub).unwrap();
    for cwd in [tmp.path(), sub.as_path()] {
        let mut child = Command::new(r"C:\Windows\System32\PING.EXE")
            .args(["-n", "30", "127.0.0.1"])
            .current_dir(cwd)
            .spawn()
            .unwrap();
        thread::sleep(Duration::from_millis(500));
        let found = running_in(tmp.path()).iter().any(|r| r.pid == child.id());
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(found, "cwd {} not detected", cwd.display());
    }
}

#[test]
fn close_all_without_a_choice_reports_the_blocking_process_names() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = ping_copy(tmp.path());
    let mut child = Command::new(&exe).args(["-n", "30", "127.0.0.1"]).spawn().unwrap();
    thread::sleep(Duration::from_millis(500));
    let log = Logger::none();
    let seen = std::sync::Mutex::new(vec![]);
    let progress = |p: Progress| seen.lock().unwrap().push(p);
    let ctx = Ctx { progress: &progress, log: &log, interact: &NoInteract };
    // ping is a console app without a window: WM_CLOSE does nothing, so it stays "locking".
    let err = close_all(tmp.path(), &ctx, Duration::from_millis(800)).unwrap_err();
    child.kill().unwrap();
    child.wait().unwrap();
    match err {
        Error::Locked(names) => assert!(names.iter().any(|n| n.eq_ignore_ascii_case("null.exe"))),
        other => panic!("unexpected: {other}"),
    }
    assert!(seen.lock().unwrap().iter().any(|p| matches!(p, Progress::WaitingForClose { .. })));
}

#[test]
fn stop_named_under_leaves_the_processes_the_target_started() {
    // An IDE window opened from a widget is a child of null_widgets.exe; ending the widgets must not end it (no /T).
    let dir = tempfile::tempdir().unwrap();
    let (host, child) = (dir.path().join("null_widgets.exe"), dir.path().join("started_by_widgets.exe"));
    fs::copy(r"C:\Windows\System32\cmd.exe", &host).unwrap();
    fs::copy(r"C:\Windows\System32\PING.EXE", &child).unwrap();
    use std::os::windows::process::CommandExt;
    let mut parent = Command::new(&host).raw_arg(format!("/c \"\"{}\" -n 60 127.0.0.1 >nul\"", child.display())).spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !running_in(dir.path()).iter().any(|r| r.name.eq_ignore_ascii_case("started_by_widgets.exe")) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
    }
    assert!(running_in(dir.path()).iter().any(|r| r.name.eq_ignore_ascii_case("started_by_widgets.exe")), "the child is running");

    assert!(null_setup_core::procs::stop_named_under(dir.path(), "null_widgets.exe"));
    let _ = parent.wait();
    let survivors: Vec<_> = running_in(dir.path()).into_iter().filter(|r| r.name.eq_ignore_ascii_case("started_by_widgets.exe")).collect();
    for s in &survivors { null_setup_core::procs::force_close(&[s.pid]); }
    assert_eq!(survivors.len(), 1, "the process the widgets started survives");
}
