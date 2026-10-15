use std::{fs, path::Path};

use null_setup_core::{
    install_config::Feature,
    progress::{Ctx, Logger, NoInteract},
    registrations::{apply, script_args, Registration},
};

fn strings(a: Vec<std::ffi::OsString>) -> Vec<String> { a.into_iter().map(|s| s.to_string_lossy().into_owned()).collect() }

#[test]
fn builds_register_and_unregister_lists_in_the_given_order() {
    let a = script_args(Path::new(r"C:\Null IDE ünï"), &[Feature::ContextMenu, Feature::Path], &[Feature::PreviewHandler], false);
    assert_eq!(
        strings(a),
        ["-InstallDir", r"C:\Null IDE ünï", "-Register", "contextMenu,path", "-Unregister", "previewHandler", "-NoElevate"]
    );
}

#[test]
fn elevation_is_allowed_only_when_asked_and_empty_lists_are_left_out() {
    let a = strings(script_args(Path::new(r"C:\x"), &[Feature::Path], &[], true));
    assert_eq!(a, ["-InstallDir", r"C:\x", "-Register", "path"]);
}

#[test]
fn every_feature_name_is_known_to_the_script() {
    let ps1 = include_str!("../../../scripts/install-null-ide.ps1");
    for f in Feature::ALL {
        assert!(ps1.contains(&format!("'{}'", f.script_name())), "{} is not handled by install-null-ide.ps1", f.script_name());
    }
}

#[test]
fn apply_runs_the_installs_script_with_the_wanted_arguments() {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE x");
    let dir = install.join("resources").join("app").join("null-updater");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("install-null-ide.ps1"),
        "Set-Content -LiteralPath \"$PSScriptRoot\\args.txt\" -Encoding ASCII -Value ($args -join '|')\r\nWrite-Host 'Done.'\r\n",
    )
    .unwrap();
    let log = Logger::none();
    let progress = |_| {};
    let ctx = Ctx { progress: &progress, log: &log, interact: &NoInteract };
    let r = apply(&install, &[Feature::Path], &[Feature::DesktopShortcut], false, &ctx);
    assert_eq!(r, Registration::Done);
    let got = fs::read_to_string(dir.join("args.txt")).unwrap();
    assert_eq!(got.trim(), format!("-InstallDir|{}|-Register|path|-Unregister|desktopShortcut|-NoElevate", install.display()));
}

#[test]
fn nothing_to_do_is_skipped() {
    let log = Logger::none();
    let progress = |_| {};
    let ctx = Ctx { progress: &progress, log: &log, interact: &NoInteract };
    assert_eq!(apply(Path::new(r"C:\does\not\exist"), &[], &[], false, &ctx), Registration::Skipped);
}

#[test]
fn unregistering_does_not_need_a_working_executable() {
    // A quarantined null.exe must not stop the shortcuts, PATH entry and associations from being removed.
    let tmp = tempfile::tempdir().unwrap();
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/install-null-ide.ps1");
    let o = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-InstallDir"])
        .arg(tmp.path())
        .args(["-Unregister", "bogus", "-NoElevate"])
        .output()
        .unwrap();
    let err = String::from_utf8_lossy(&o.stderr);
    assert!(err.contains("Unknown feature"), "{err}");
}
