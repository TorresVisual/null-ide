use null_setup_core::webview2::usable_version;

#[test]
fn only_a_real_version_counts_as_installed() {
    for no in ["", "  ", "0.0.0.0"] {
        assert!(!usable_version(no), "{no:?}");
    }
    assert!(usable_version("126.0.2592.87"));
}
