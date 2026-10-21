use std::fs;

use null_setup_core::install_config::{self as ic, Feature, InstallConfig};

#[test]
fn defaults_match_the_inno_task_defaults() {
    let c = InstallConfig::default();
    assert!(!c.desktop_shortcut);
    for f in [Feature::StartMenuShortcut, Feature::SafeModeShortcut, Feature::Path, Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler] {
        assert!(c.has(f), "{f:?}");
    }
    assert!(!c.widgets, "desktop widgets are opt-in");
    assert!(c.excluded_builtins.is_empty());
    assert_eq!(c.schema, ic::SCHEMA);
}

#[test]
fn widgets_round_trip_and_an_older_file_reads_as_off() {
    assert_eq!(Feature::Widgets.name(), "widgets");
    assert_eq!(Feature::ALL.len(), 8);
    assert!(!InstallConfig::default().enabled().contains(&Feature::Widgets));
    assert!(!ic::from_json(r#"{"schema":1,"path":false}"#).unwrap().widgets);
    let on = InstallConfig { widgets: true, ..Default::default() };
    assert_eq!(InstallConfig::default().added_features(&on), vec![Feature::Widgets]);
    assert_eq!(on.removed_features(&InstallConfig::default()), vec![Feature::Widgets]);
    let tmp = tempfile::tempdir().unwrap();
    ic::write(tmp.path(), &on).unwrap();
    assert!(ic::read(tmp.path()).unwrap().widgets);
}

#[test]
fn a_folder_without_a_config_reads_as_the_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    assert_eq!(ic::read(tmp.path()).unwrap(), InstallConfig::default());
}

#[test]
fn write_then_read_round_trips() {
    let tmp = tempfile::tempdir().unwrap();
    let c = InstallConfig { desktop_shortcut: true, path: false, excluded_builtins: vec!["null-music".into()], ..Default::default() };
    ic::write(tmp.path(), &c).unwrap();
    assert_eq!(ic::read(tmp.path()).unwrap(), c);
    assert!(fs::read_to_string(tmp.path().join(ic::FILE)).unwrap().contains("excludedBuiltins"));
}

#[test]
fn a_partial_file_fills_the_rest_with_defaults() {
    let c = ic::from_json(r#"{"schema":1,"path":false}"#).unwrap();
    assert!(!c.path && c.context_menu && c.start_menu_shortcut);
}

#[test]
fn a_newer_schema_or_broken_json_is_an_error_not_defaults() {
    let e = ic::from_json(r#"{"schema":99}"#).unwrap_err().to_string();
    assert!(e.contains("newer"), "{e}");
    assert!(ic::from_json("{nope").is_err());
    let tmp = tempfile::tempdir().unwrap();
    fs::write(tmp.path().join(ic::FILE), "{nope").unwrap();
    assert!(ic::read(tmp.path()).is_err());
}

#[test]
fn enabled_added_and_removed_features_are_listed_in_a_stable_order() {
    let old = InstallConfig::default();
    let new = InstallConfig { desktop_shortcut: true, path: false, preview_handler: false, ..Default::default() };
    assert_eq!(old.added_features(&new), vec![Feature::DesktopShortcut]);
    assert_eq!(old.removed_features(&new), vec![Feature::Path, Feature::PreviewHandler]);
    assert_eq!(old.enabled().len(), 6);
}

#[test]
fn only_the_install_path_bound_features_follow_an_update() {
    let follow: Vec<_> = Feature::ALL.into_iter().filter(|f| f.follows_install()).collect();
    assert_eq!(follow, vec![Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler, Feature::Widgets]);
}

#[test]
fn builtins_changed_ignores_order_and_duplicates() {
    let a = InstallConfig { excluded_builtins: vec!["a".into(), "b".into()], ..Default::default() };
    let b = InstallConfig { excluded_builtins: vec!["b".into(), "a".into(), "a".into()], ..Default::default() };
    let c = InstallConfig { excluded_builtins: vec!["a".into()], ..Default::default() };
    assert!(!ic::builtins_changed(&a, &b));
    assert!(ic::builtins_changed(&a, &c));
}
