use std::{fs, path::Path};

use null_setup_core::shell::{sys::*, System};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/NullIDETestCert.cer");
const FIXTURE_THUMBPRINT: &str = "DEFC3CBFB0BA9450E2AC0568B47871FADD963B9A";

#[test]
fn reads_the_thumbprint_and_subject_of_a_der_certificate() {
    assert_eq!(WinSystem.cert_thumbprint(Path::new(FIXTURE)).unwrap(), FIXTURE_THUMBPRINT);
    assert_eq!(cert_subject(Path::new(FIXTURE)).unwrap(), "Null IDE");
}

#[test]
fn a_certificate_nobody_trusted_is_not_trusted() {
    assert!(!WinSystem.cert_trusted_machine(FIXTURE_THUMBPRINT));
}

fn install(root: &Path, marker: bool, cer: Option<&[u8]>) -> std::path::PathBuf {
    let dir = root.join("Null IDE");
    fs::create_dir_all(dir.join("shell-ext")).unwrap();
    if marker {
        fs::write(dir.join(".null-ide-install.json"), "{}").unwrap();
    }
    if let Some(b) = cer {
        fs::write(dir.join("shell-ext").join("NullIDECert.cer"), b).unwrap();
    }
    dir
}

#[test]
fn trust_target_only_accepts_a_null_install_with_a_null_certificate() {
    let t = tempfile::tempdir().unwrap();
    let good = fs::read(FIXTURE).unwrap();
    assert!(trust_target(&install(t.path(), true, Some(&good))).unwrap().ends_with("NullIDECert.cer"));
    assert!(trust_target(&install(&t.path().join("a"), false, Some(&good))).is_err()); // no marker
    assert!(trust_target(&install(&t.path().join("b"), true, None)).is_err()); // no certificate
    assert!(trust_target(&install(&t.path().join("c"), true, Some(b"not a cert"))).is_err());
}

#[test]
fn trust_der_returns_the_one_buffer_that_was_checked() {
    let t = tempfile::tempdir().unwrap();
    let good = fs::read(FIXTURE).unwrap();
    assert_eq!(trust_der(&install(t.path(), true, Some(&good))).unwrap(), good);
    assert!(trust_der(&install(&t.path().join("a"), false, Some(&good))).is_err());
    assert!(trust_der(&install(&t.path().join("c"), true, Some(b"not a cert"))).is_err());
}

#[test]
fn powershell_quoting_doubles_every_quote_character_powershell_recognises() {
    assert_eq!(quote(Path::new(r"C:\it's")), r"'C:\it''s'");
    assert_eq!(quote(Path::new("C:\\x\u{2019}; calc; \u{2018}")), "'C:\\x\u{2019}\u{2019}; calc; \u{2018}\u{2018}'");
}
