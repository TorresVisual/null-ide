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
