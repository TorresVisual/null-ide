mod support;

use std::{path::{Path, PathBuf}, time::Duration};

use null_setup_core::{
    http::Http,
    wizard::{decide, fetch_install, Intent, Page},
    Error,
};
use serde_json::json;

const DEFAULT: &str = r"C:\Users\x\AppData\Local\Programs\Null IDE";
const MANIFEST: &str = r#"{"schema":1,"builtins":[{"id":"null-tools","label":"Tools","locked":true}]}"#;

fn p(s: &str) -> PathBuf { PathBuf::from(s) }
fn ours(set: &'static [&'static str]) -> impl Fn(&Path) -> bool { move |d| set.iter().any(|s| Path::new(s) == d) }

#[test]
fn nothing_installed_means_the_install_wizard_in_the_default_folder() {
    let plan = decide(Intent::Auto, None, None, &ours(&[]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Install, p(DEFAULT)));
}

#[test]
fn an_existing_install_shows_maintenance_instead_of_a_second_install() {
    let plan = decide(Intent::Auto, None, Some(p(r"D:\Null")), &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Maintenance, p(r"D:\Null")));
}

#[test]
fn a_stale_registration_does_not_block_a_fresh_install() {
    let plan = decide(Intent::Auto, None, Some(p(r"D:\Gone")), &ours(&[]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Install, p(DEFAULT)));
}

#[test]
fn a_given_folder_wins_over_the_registered_one() {
    let a = decide(Intent::Auto, Some(p(r"E:\New")), Some(p(r"D:\Null")), &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!((a.page, a.install_dir), (Page::Install, p(r"E:\New")));
}

#[test]
fn modify_and_uninstall_need_an_install() {
    let ok = decide(Intent::Modify, Some(p(r"D:\Null")), None, &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!(ok.page, Page::Modify);
    let ok = decide(Intent::Uninstall, None, Some(p(r"D:\Null")), &ours(&[r"D:\Null"]), p(DEFAULT)).unwrap();
    assert_eq!((ok.page, ok.install_dir), (Page::Uninstall, p(r"D:\Null")));
    assert!(decide(Intent::Modify, Some(p(r"D:\Other")), None, &ours(&[]), p(DEFAULT)).is_err());
    assert!(decide(Intent::Uninstall, None, None, &ours(&[]), p(DEFAULT)).is_err());
}

#[test]
fn uninstalling_a_registration_whose_folder_is_gone_offers_to_remove_just_the_entry() {
    let plan = decide(Intent::Uninstall, Some(p(r"D:\Gone")), Some(p(r"d:\gone\")), &ours(&[]), p(DEFAULT)).unwrap();
    assert_eq!(plan.page, Page::Stale); // case and trailing backslash do not matter
    // a folder that was never registered is an error, not something to "clean up"
    assert!(decide(Intent::Uninstall, Some(p(r"D:\Elsewhere")), Some(p(r"D:\Gone")), &ours(&[]), p(DEFAULT)).is_err());
}

#[test]
fn page_names_are_what_the_ui_switches_on() {
    let names: Vec<_> = [Page::Install, Page::Maintenance, Page::Modify, Page::Uninstall, Page::Stale].iter().map(Page::name).collect();
    assert_eq!(names, ["install", "maintenance", "modify", "uninstall", "stale"]);
}

fn release(base: &str, with_builtins: bool) -> Vec<u8> {
    let mut assets = vec![
        json!({ "name": "null-ide-win32-x64.zip", "browser_download_url": format!("{base}/zip"), "size": 5 }),
        json!({ "name": "null-ide-win32-x64.zip.sha256", "browser_download_url": format!("{base}/sha"), "size": 64 }),
    ];
    if with_builtins {
        assets.push(json!({ "name": "builtins.json", "browser_download_url": format!("{base}/builtins.json"), "size": 9 }));
    }
    json!({ "tag_name": "v3", "assets": assets }).to_string().into_bytes()
}

fn http() -> Http { Http::with_delay(Duration::from_millis(1)) }

#[test]
fn fetch_install_returns_the_tag_and_the_manifest_of_that_release() {
    let srv = support::serve(|req| match req.url.as_str() {
        "/repos/o/r/releases/latest" => (200, release(&req.base, true), vec![]),
        "/builtins.json" => (200, MANIFEST.as_bytes().to_vec(), vec![]),
        _ => (404, vec![], vec![]),
    });
    let v = fetch_install(&http(), &srv.base, "o/r").unwrap();
    assert_eq!(v.tag, "v3");
    assert_eq!(v.manifest.unwrap().builtins[0].id, "null-tools");
}

#[test]
fn a_release_without_builtins_json_still_installs_just_without_choices() {
    let srv = support::serve(|req| match req.url.as_str() {
        "/repos/o/r/releases/latest" => (200, release(&req.base, false), vec![]),
        _ => (404, vec![], vec![]),
    });
    let v = fetch_install(&http(), &srv.base, "o/r").unwrap();
    assert_eq!((v.tag.as_str(), v.manifest), ("v3", None));
}

#[test]
fn a_failing_manifest_download_is_an_error_not_a_silent_downgrade() {
    let srv = support::serve(|req| match req.url.as_str() {
        "/repos/o/r/releases/latest" => (200, release(&req.base, true), vec![]),
        _ => (500, vec![], vec![]),
    });
    assert!(matches!(fetch_install(&http(), &srv.base, "o/r"), Err(Error::Http { status: 500, .. })));
    let down = support::serve(|_| (404, vec![], vec![]));
    assert!(matches!(fetch_install(&http(), &down.base, "o/r"), Err(Error::Http { status: 404, .. })));
}

#[test]
fn an_install_in_the_default_folder_without_an_add_remove_entry_still_shows_maintenance() {
    // installs from before the entry existed (and ones updated by the old updater) have no registration
    let plan = decide(Intent::Auto, None, None, &ours(&[DEFAULT]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Maintenance, p(DEFAULT)));
    let plan = decide(Intent::Uninstall, None, None, &ours(&[DEFAULT]), p(DEFAULT)).unwrap();
    assert_eq!((plan.page, plan.install_dir), (Page::Uninstall, p(DEFAULT)));
    // a registered install elsewhere still wins over the default folder
    let plan = decide(Intent::Auto, None, Some(p(r"D:\Null")), &ours(&[r"D:\Null", DEFAULT]), p(DEFAULT)).unwrap();
    assert_eq!(plan.install_dir, p(r"D:\Null"));
}
