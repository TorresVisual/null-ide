mod support;

use std::fs;

use null_setup_core::shell::widgets::*;
use support::{FakeSystem, Hive};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

fn install(h: &Hive, with_exe: bool) -> std::path::PathBuf {
    let dir = h.tmp.path().join("Null IDE ünï");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    if with_exe {
        fs::write(dir.join(EXE), "MZ").unwrap();
    }
    dir
}

fn quiet() -> impl Fn(&str) {
    |_: &str| {}
}

#[test]
fn registering_writes_the_quoted_run_entry_and_starts_the_exe() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h, true);
    register(&h.loc, &sys, &dir, &quiet()).unwrap();
    assert_eq!(h.get(RUN, "NullWidgets"), format!("\"{}\"", dir.join(EXE).display()));
    assert_eq!(*sys.calls.borrow(), ["start_widgets:null_widgets.exe"]);
}

#[test]
fn a_build_without_the_exe_registers_nothing_and_says_so() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let logged = std::cell::RefCell::new(String::new());
    register(&h.loc, &sys, &install(&h, false), &|m: &str| logged.borrow_mut().push_str(m)).unwrap();
    assert!(!h.exists(RUN) || h.try_get(RUN, "NullWidgets").is_none());
    assert!(sys.calls.borrow().is_empty());
    assert!(logged.borrow().contains(EXE), "{}", logged.borrow());
}

#[test]
fn registering_again_after_an_update_points_the_entry_at_the_new_folder() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_text(RUN, "NullWidgets", r#""C:\old\null_widgets.exe""#);
    let dir = install(&h, true);
    register(&h.loc, &sys, &dir, &quiet()).unwrap();
    assert_eq!(h.get(RUN, "NullWidgets"), format!("\"{}\"", dir.join(EXE).display()));
}

#[test]
fn unregistering_stops_the_exe_removes_only_its_run_entry_and_deletes_the_data_folder() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_text(RUN, "NullWidgets", r#""C:\x\null_widgets.exe""#);
    h.set_text(RUN, "SomethingElse", "keep");
    let data = h.loc.local_data.join("Null").join("widgets");
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join("snapshot.json"), "{}").unwrap();
    unregister(&h.loc, &sys, &install(&h, true)).unwrap();
    assert_eq!(*sys.calls.borrow(), ["stop_widgets"]);
    assert!(h.try_get(RUN, "NullWidgets").is_none());
    assert_eq!(h.get(RUN, "SomethingElse"), "keep");
    assert!(!data.exists());
}

#[test]
fn unregistering_a_machine_that_never_had_widgets_is_fine_even_without_null_exe() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h, false);
    fs::remove_file(dir.join("null.exe")).unwrap();
    unregister(&h.loc, &sys, &dir).unwrap();
    unregister(&h.loc, &sys, &dir).unwrap();
}
