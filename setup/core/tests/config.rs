use null_setup_core::config::{iso_utc, read, write, InstallMeta};

#[test]
fn iso_utc_formats_known_instants() {
    assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso_utc(1_700_000_000), "2023-11-14T22:13:20Z");
}

#[test]
fn reads_a_bom_prefixed_file_written_by_the_old_installer() {
    let dir = tempfile::tempdir().unwrap();
    let text = "\u{feff}{\"repo\":\"o/r\",\"version\":\"v1\",\"installedAt\":null,\"installDir\":\"C:\\\\x\"}";
    std::fs::write(dir.path().join(".null-ide-install.json"), text).unwrap();
    let m = read(dir.path()).unwrap();
    assert_eq!((m.repo.as_str(), m.version.as_str()), ("o/r", "v1"));
    assert_eq!(m.installed_at, None);
}

#[test]
fn write_then_read_round_trips_without_a_bom() {
    let dir = tempfile::tempdir().unwrap();
    let m = InstallMeta { repo: "o/r".into(), version: "v2".into(), installed_at: Some(iso_utc(0)), install_dir: Some(r"D:\Null IDE".into()) };
    write(dir.path(), &m).unwrap();
    let raw = std::fs::read(dir.path().join(".null-ide-install.json")).unwrap();
    assert_ne!(&raw[..3], b"\xEF\xBB\xBF");
    assert_eq!(read(dir.path()).unwrap(), m);
}
