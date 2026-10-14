mod support;
use std::time::Duration;

use null_setup_core::{http::Http, release::{from_json, parse_sha256, resolve}, Error};
use serde_json::json;

fn release_json(base: &str) -> serde_json::Value {
    json!({ "tag_name": "v2", "assets": [
        { "name": "NullIDESetup-v2.exe", "browser_download_url": format!("{base}/setup"), "size": 5 },
        { "name": "null-ide-win32-x64.zip", "browser_download_url": format!("{base}/zip"), "size": 1234 },
        { "name": "null-ide-win32-x64.zip.sha256", "browser_download_url": format!("{base}/zip.sha256"), "size": 90 }
    ]})
}

#[test]
fn picks_the_zip_and_its_sidecar_and_ignores_the_exe() {
    let r = from_json(&release_json("http://h"), "v2").unwrap();
    assert_eq!((r.zip_name.as_str(), r.zip_size), ("null-ide-win32-x64.zip", 1234));
    assert_eq!(r.zip_url, "http://h/zip");
    assert_eq!(r.sha256_url, "http://h/zip.sha256");
}

#[test]
fn a_release_without_a_sidecar_is_rejected() {
    let mut v = release_json("http://h");
    v["assets"].as_array_mut().unwrap().pop();
    assert!(matches!(from_json(&v, "v2"), Err(Error::Package(_))));
}

#[test]
fn a_release_without_a_zip_is_rejected() {
    assert!(matches!(from_json(&json!({ "assets": [] }), "v2"), Err(Error::Package(_))));
}

#[test]
fn parses_sha256_sidecars_in_both_common_formats() {
    let h = "a".repeat(64);
    assert_eq!(parse_sha256(&format!("{h}  null-ide-win32-x64.zip")).unwrap(), h);
    assert_eq!(parse_sha256(&format!("{}\n", h.to_uppercase())).unwrap(), h);
    assert!(parse_sha256("not a hash").is_err());
}

#[test]
fn resolve_asks_for_the_exact_tag() {
    let srv = support::serve(|req| {
        if req.url == "/repos/o/r/releases/tags/v2" {
            (200, release_json(&req.base).to_string().into_bytes(), vec![("Content-Type", "application/json".into())])
        } else {
            (404, vec![], vec![])
        }
    });
    let r = resolve(&Http::with_delay(Duration::from_millis(1)), &srv.base, "o/r", "v2").unwrap();
    assert_eq!(r.tag, "v2");
    assert!(matches!(
        resolve(&Http::with_delay(Duration::from_millis(1)), &srv.base, "o/r", "v3"),
        Err(Error::Http { status: 404, .. })
    ));
}
