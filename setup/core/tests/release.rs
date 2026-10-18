mod support;
use std::time::Duration;

use null_setup_core::{http::Http, release::{from_json, latest_from_json, parse_sha256, resolve, resolve_latest}, Error};
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

#[test]
fn latest_reads_the_tag_and_the_optional_builtins_asset() {
    let mut v = release_json("http://h");
    v["tag_name"] = json!("v3");
    assert_eq!(latest_from_json(&v).unwrap().builtins_url, None); // a release from before builtins.json
    v["assets"].as_array_mut().unwrap().push(json!({ "name": "builtins.json", "browser_download_url": "http://h/b", "size": 9 }));
    let l = latest_from_json(&v).unwrap();
    assert_eq!((l.release.tag.as_str(), l.builtins_url.as_deref()), ("v3", Some("http://h/b")));
}

#[test]
fn latest_refuses_a_tag_that_could_not_be_a_folder_name() {
    for bad in ["..\\x", "a/b", ""] {
        let mut v = release_json("http://h");
        v["tag_name"] = json!(bad);
        assert!(matches!(latest_from_json(&v), Err(Error::Package(_))), "{bad:?}");
    }
    let mut none = release_json("http://h");
    none.as_object_mut().unwrap().remove("tag_name");
    assert!(latest_from_json(&none).is_err());
}

#[test]
fn resolve_latest_asks_the_latest_endpoint_and_reports_a_missing_release() {
    let srv = support::serve(|req| {
        if req.url == "/repos/o/r/releases/latest" {
            (200, release_json(&req.base).to_string().into_bytes(), vec![("Content-Type", "application/json".into())])
        } else {
            (404, vec![], vec![])
        }
    });
    let http = Http::with_delay(Duration::from_millis(1));
    assert_eq!(resolve_latest(&http, &srv.base, "o/r").unwrap().release.tag, "v2");
    assert!(matches!(resolve_latest(&http, &srv.base, "o/other"), Err(Error::Http { status: 404, .. })));
}

#[test]
fn a_versioned_windows_zip_is_found_among_the_linux_assets() {
    let v = json!({ "tag_name": "v2", "assets": [
        { "name": "null-ide-linux-x64-v2.tar.gz", "browser_download_url": "http://h/tgz", "size": 9 },
        { "name": "null-ide-linux-x64-v2.tar.gz.sha256", "browser_download_url": "http://h/tgz.sha256", "size": 90 },
        { "name": "null-ide-linux-x64-v2.deb", "browser_download_url": "http://h/deb", "size": 9 },
        { "name": "null-ide-win32-x64-v2.zip", "browser_download_url": "http://h/zip", "size": 1234 },
        { "name": "null-ide-win32-x64-v2.zip.sha256", "browser_download_url": "http://h/zip.sha256", "size": 90 }
    ]});
    let r = from_json(&v, "v2").unwrap();
    assert_eq!((r.zip_name.as_str(), r.zip_size), ("null-ide-win32-x64-v2.zip", 1234));
    assert_eq!(r.zip_url, "http://h/zip");
    assert_eq!(r.sha256_url, "http://h/zip.sha256");
}
