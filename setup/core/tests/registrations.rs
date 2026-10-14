use null_setup_core::{
    registrations::{classify, Registration},
    shellext::explorer_loads_dll,
};

#[test]
fn needs_reapproval_marker_wins_even_on_exit_zero() {
    assert_eq!(classify("==> x\nNULL-SETUP: needs-reapproval\nDone.", true, ""), Registration::NeedsReapproval);
}

#[test]
fn clean_run_is_done() {
    assert_eq!(classify("Done.", true, ""), Registration::Done);
}

#[test]
fn failure_reports_the_first_stderr_line() {
    assert_eq!(classify("", false, "\nboom\nmore"), Registration::Warning("boom".into()));
    assert_eq!(classify("", false, ""), Registration::Warning("registration script failed".into()));
}

#[test]
fn recognises_explorer_in_tasklist_output() {
    assert!(explorer_loads_dll("\"explorer.exe\",\"1234\",\"null_explorer_command.dll\"\r\n"));
    assert!(!explorer_loads_dll("INFO: No tasks are running which match the specified criteria.\r\n"));
    assert!(!explorer_loads_dll("\"notexplorer.exe\",\"1\",\"x\"\r\n"));
}
