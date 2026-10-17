use std::{fs, path::Path};

use null_setup_core::{
    builtins,
    first_run::{self, FirstRun},
};

const MANIFEST: &str = r#"{"schema":1,"builtins":[],"settings":[
  {"key":"files.autoSave","label":"Auto save","kind":"choice","default":"off",
   "options":[{"value":"off","label":"Off"},{"value":"afterDelay","label":"Delay"}]},
  {"key":"editor.fontSize","label":"Size","kind":"number","default":13,"min":8,"max":40}],
 "marketplace":[{"id":"ms-python.python","label":"Python"}]}"#;

fn manifest() -> builtins::Manifest { builtins::parse(MANIFEST).unwrap() }

fn parse(text: &str) -> FirstRun { first_run::from_json(text).unwrap() }

/// An install folder (with the builtins.json the package ships), a choices file and the folder first-run.json goes to.
fn world(choices: &str) -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE");
    fs::create_dir_all(&install).unwrap();
    fs::write(install.join("builtins.json"), MANIFEST).unwrap();
    let file = tmp.path().join("choices.json");
    fs::write(&file, choices).unwrap();
    let dir = tmp.path().join("appdata").join("Null").join("null-setup");
    (tmp, install, file, dir)
}

#[test]
fn from_json_accepts_a_bom_and_unknown_fields_but_not_another_schema() {
    let f = parse("\u{feff}{\"schema\":1,\"settings\":{\"files.autoSave\":\"off\"},\"extras\":true}");
    assert_eq!(f.settings.len(), 1);
    assert!(first_run::from_json("{\"schema\":2}").is_err());
    assert!(first_run::from_json("{\"settings\":{}}").is_err()); // no schema
    assert!(first_run::from_json("{nope").is_err());
}

#[test]
fn validate_accepts_good_choices() {
    let f = parse(r#"{"schema":1,"settings":{"files.autoSave":"afterDelay","editor.fontSize":15},"extensions":["ms-python.python"]}"#);
    first_run::validate(&manifest(), &f).unwrap();
}

#[test]
fn validate_rejects_what_the_manifest_does_not_offer() {
    let m = manifest();
    let bad = |text: &str| first_run::validate(&m, &parse(text)).unwrap_err().to_string();
    assert!(bad(r#"{"schema":1,"settings":{"terminal.integrated.shell.windows":"x"}}"#).contains("terminal.integrated.shell.windows"));
    assert!(bad(r#"{"schema":1,"settings":{"files.autoSave":"sometimes"}}"#).contains("files.autoSave"));
    assert!(bad(r#"{"schema":1,"settings":{"editor.fontSize":99}}"#).contains("editor.fontSize"));
    assert!(bad(r#"{"schema":1,"settings":{"editor.fontSize":"13"}}"#).contains("editor.fontSize"));
    assert!(bad(r#"{"schema":1,"extensions":["evil.extension"]}"#).contains("evil.extension"));
}

#[test]
fn write_creates_the_folder_and_replaces_an_older_file() {
    let (_t, _i, _f, dir) = world("{}");
    first_run::write(&dir, &parse(r#"{"schema":1,"settings":{"files.autoSave":"off"}}"#)).unwrap();
    first_run::write(&dir, &parse(r#"{"schema":1,"settings":{"files.autoSave":"afterDelay"}}"#)).unwrap();
    let back = parse(&fs::read_to_string(dir.join(first_run::FILE)).unwrap());
    assert_eq!(back.settings["files.autoSave"], "afterDelay");
    assert!(!dir.join("first-run.json.tmp").exists());
}

#[test]
fn save_from_file_validates_against_the_installed_manifest_and_writes() {
    let (_t, install, file, dir) = world(r#"{"schema":1,"settings":{"files.autoSave":"afterDelay"},"extensions":["ms-python.python"]}"#);
    first_run::save_from_file(&install, &file, &dir).unwrap();
    let back = parse(&fs::read_to_string(dir.join(first_run::FILE)).unwrap());
    assert_eq!((back.settings.len(), back.extensions.as_slice()), (1, &["ms-python.python".to_string()][..]));
}

#[test]
fn save_from_file_writes_nothing_for_an_invalid_or_empty_choice_set() {
    let (_t, install, file, dir) = world(r#"{"schema":1,"settings":{"files.autoSave":"sometimes"}}"#);
    assert!(first_run::save_from_file(&install, &file, &dir).is_err());
    assert!(!dir.exists());
    fs::write(&file, r#"{"schema":1,"settings":{},"extensions":[]}"#).unwrap();
    first_run::save_from_file(&install, &file, &dir).unwrap();
    assert!(!dir.join(first_run::FILE).exists());
}

#[test]
fn save_from_file_needs_a_manifest_in_the_install_and_a_readable_file() {
    let (_t, install, file, dir) = world(r#"{"schema":1,"settings":{"files.autoSave":"off"}}"#);
    fs::remove_file(install.join("builtins.json")).unwrap();
    assert!(first_run::save_from_file(&install, &file, &dir).is_err());
    assert!(first_run::save_from_file(&install, Path::new("Z:\\nope\\choices.json"), &dir).is_err());
    assert!(!dir.exists());
}
