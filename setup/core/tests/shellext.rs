use null_setup_core::shellext::explorer_loads_dll;

#[test]
fn recognises_explorer_in_tasklist_output() {
    assert!(explorer_loads_dll("\"explorer.exe\",\"1234\",\"null_explorer_command.dll\"\r\n"));
    assert!(!explorer_loads_dll("INFO: No tasks are running which match the specified criteria.\r\n"));
    assert!(!explorer_loads_dll("\"notexplorer.exe\",\"1\",\"x\"\r\n"));
}
