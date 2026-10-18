mod support;

use std::path::Path;

use null_setup_core::shell::arp::{find, register, unregister};
use support::Hive;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\NullIDE";
const DIR: &str = r"C:\Null IDE ünï";

#[test]
fn register_writes_what_add_remove_programs_shows_and_the_two_commands() {
    let h = Hive::new();
    register(&h.loc, Path::new(DIR), "v1.2.3").unwrap();
    assert_eq!(h.get(KEY, "DisplayName"), "Null IDE");
    assert_eq!(h.get(KEY, "DisplayVersion"), "1.2.3"); // no leading v
    assert_eq!(h.get(KEY, "InstallLocation"), DIR);
    assert_eq!(h.get(KEY, "DisplayIcon"), format!(r"{DIR}\null.exe"));
    let exe = format!(r#""{DIR}\setup\null-setup.exe" wizard --install-dir "{DIR}""#);
    assert_eq!(h.get(KEY, "UninstallString"), format!("{exe} --intent uninstall"));
    assert_eq!(h.get(KEY, "ModifyPath"), format!("{exe} --intent modify"));
}

#[test]
fn registering_again_refreshes_the_version_in_place() {
    let h = Hive::new();
    register(&h.loc, Path::new(DIR), "v1").unwrap();
    register(&h.loc, Path::new(DIR), "v2").unwrap();
    assert_eq!(h.get(KEY, "DisplayVersion"), "2");
}

#[test]
fn find_reads_back_the_entry_and_unregister_removes_it_even_twice() {
    let h = Hive::new();
    assert_eq!(find(&h.loc), None);
    register(&h.loc, Path::new(DIR), "v1.2.3").unwrap();
    let e = find(&h.loc).unwrap();
    assert_eq!((e.install_dir.as_path(), e.version.as_str()), (Path::new(DIR), "1.2.3"));
    unregister(&h.loc).unwrap();
    assert_eq!(find(&h.loc), None);
    unregister(&h.loc).unwrap();
}
