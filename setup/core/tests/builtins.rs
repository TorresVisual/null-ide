use std::fs;

use null_setup_core::builtins::{parse, prune, resolve};

const M: &str = r#"{"schema":1,"builtins":[
  {"id":"null-tools","label":"Tools","locked":true,"requires":["null-accounts"]},
  {"id":"null-accounts","label":"Accounts","locked":true},
  {"id":"null-env","label":"Env"},
  {"id":"null-format","label":"Format","requires":["null-env"]},
  {"id":"null-music","label":"Music","default":false}
]}"#;

fn ids(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

#[test]
fn parse_reads_fields_and_defaults() {
    let m = parse(M).unwrap();
    let env = m.builtins.iter().find(|b| b.id == "null-env").unwrap();
    assert!(env.default && !env.locked && env.requires.is_empty());
    assert!(!m.builtins.iter().find(|b| b.id == "null-music").unwrap().default);
    assert!(m.builtins[0].locked);
}

#[test]
fn parse_rejects_bad_manifests() {
    assert!(parse("{nope").is_err());
    assert!(parse(r#"{"schema":2,"builtins":[]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"../x","label":"x"}]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"a\\b","label":"x"}]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"a","label":"x"},{"id":"a","label":"y"}]}"#).is_err());
    assert!(parse(r#"{"schema":1,"builtins":[{"id":"a","label":"x","requires":["missing"]}]}"#).is_err());
}

#[test]
fn resolve_excludes_unlocked_builtins() {
    let r = resolve(&parse(M).unwrap(), &ids(&["null-music"]));
    assert_eq!(r.excluded, ids(&["null-music"]));
    assert!(r.notes.is_empty());
}

#[test]
fn resolve_drops_unknown_and_locked_entries_with_a_note() {
    let r = resolve(&parse(M).unwrap(), &ids(&["null-gone", "null-tools", "null-music"]));
    assert_eq!(r.excluded, ids(&["null-music"]));
    assert_eq!(r.notes.len(), 2);
    assert!(r.notes.iter().any(|n| n.contains("null-gone")));
    assert!(r.notes.iter().any(|n| n.contains("null-tools")));
}

#[test]
fn resolve_keeps_what_an_included_builtin_requires() {
    let m = parse(M).unwrap();
    let r = resolve(&m, &ids(&["null-env"]));
    assert!(r.excluded.is_empty());
    assert!(r.notes.iter().any(|n| n.contains("null-env") && n.contains("null-format")));
    // Excluding both is fine.
    let r = resolve(&m, &ids(&["null-env", "null-format"]));
    assert_eq!(r.excluded, ids(&["null-env", "null-format"]));
    assert!(r.notes.is_empty());
}

#[test]
fn prune_removes_only_listed_existing_folders() {
    let tmp = tempfile::tempdir().unwrap();
    for d in ["null-music", "null-env", "other"] {
        fs::create_dir_all(tmp.path().join(d)).unwrap();
        fs::write(tmp.path().join(d).join("package.json"), "{}").unwrap();
    }
    let removed = prune(tmp.path(), &ids(&["null-music", "not-there", "../other", "a/b"])).unwrap();
    assert_eq!(removed, ids(&["null-music"]));
    assert!(!tmp.path().join("null-music").exists());
    assert!(tmp.path().join("null-env").exists() && tmp.path().join("other").exists());
}

use null_setup_core::builtins::{valid_extension_id, SettingKind};
use serde_json::json;

const S: &str = r#"{"schema":1,"builtins":[],"settings":[
  {"key":"workbench.colorTheme","label":"Theme","kind":"choice","default":"Null Dark",
   "options":[{"value":"Null Dark","label":"Dark"},{"value":"Null Light","label":"Light"}]},
  {"key":"editor.fontSize","label":"Size","kind":"number","default":13,"min":8,"max":40},
  {"key":"editor.formatOnSave","label":"Format","kind":"bool","default":false},
  {"key":"editor.fontFamily","label":"Font","kind":"text","default":"Geist Mono"}],
 "marketplace":[{"id":"ms-python.python","label":"Python"}]}"#;

#[test]
fn a_manifest_without_the_new_tables_still_parses() {
    let m = parse(M).unwrap();
    assert!(m.settings.is_empty() && m.marketplace.is_empty());
}

#[test]
fn settings_and_marketplace_are_read() {
    let m = parse(S).unwrap();
    assert_eq!(m.settings.len(), 4);
    assert_eq!(m.settings[0].kind, SettingKind::Choice);
    assert_eq!(m.settings[1].min, Some(8.0));
    assert_eq!(m.marketplace[0].id, "ms-python.python");
}

#[test]
fn accepts_checks_each_kind() {
    let m = parse(S).unwrap();
    let (theme, size, fmt, font) = (&m.settings[0], &m.settings[1], &m.settings[2], &m.settings[3]);
    assert!(theme.accepts(&json!("Null Light")) && !theme.accepts(&json!("Solarized")) && !theme.accepts(&json!(1)));
    assert!(size.accepts(&json!(8)) && size.accepts(&json!(40)) && size.accepts(&json!(13.5)));
    assert!(!size.accepts(&json!(7)) && !size.accepts(&json!(41)) && !size.accepts(&json!("13")));
    assert!(fmt.accepts(&json!(true)) && !fmt.accepts(&json!("true")) && !fmt.accepts(&json!(0)));
    assert!(font.accepts(&json!("Cascadia Code, monospace")));
    assert!(!font.accepts(&json!("")) && !font.accepts(&json!("a\nb")) && !font.accepts(&json!("x".repeat(201))));
}

#[test]
fn parse_rejects_bad_settings_and_marketplace_tables() {
    let with = |settings: &str, market: &str| format!(r#"{{"schema":1,"builtins":[],"settings":{settings},"marketplace":{market}}}"#);
    let bool_setting = |key: &str| format!(r#"{{"key":"{key}","label":"x","kind":"bool","default":true}}"#);
    // duplicate and empty keys
    assert!(parse(&with(&format!("[{0},{0}]", bool_setting("a.b")), "[]")).is_err());
    assert!(parse(&with(&format!("[{}]", bool_setting("")), "[]")).is_err());
    // a choice without options, a default outside the options, a default out of range, a wrongly typed default
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"choice","default":"x"}]"#, "[]")).is_err());
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"choice","default":"z","options":[{"value":"x","label":"x"}]}]"#, "[]")).is_err());
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"number","default":50,"min":1,"max":10}]"#, "[]")).is_err());
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"bool","default":"yes"}]"#, "[]")).is_err());
    // marketplace ids are passed to the extension installer
    for bad in ["../x", "a", "a.b.c", ".b", "a.", "a b.c", ""] {
        assert!(parse(&with("[]", &format!(r#"[{{"id":"{bad}","label":"x"}}]"#))).is_err(), "{bad:?}");
    }
}

#[test]
fn extension_ids_are_publisher_dot_name() {
    assert!(valid_extension_id("ms-python.python") && valid_extension_id("A1.b-2"));
    assert!(!valid_extension_id("python") && !valid_extension_id("a.b.c") && !valid_extension_id("-a.b") && !valid_extension_id("a.b/"));
}

#[test]
fn the_real_repo_settings_table_parses() {
    // setup/core/ -> setup/builtins.config.json; built-ins are generated at build time, so only the new tables are checked here.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("builtins.config.json");
    let cfg: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let text = json!({ "schema": 1, "builtins": [], "settings": cfg["settings"], "marketplace": cfg["marketplace"] }).to_string();
    assert_eq!(parse(&text).unwrap().settings.len(), 7);
}
