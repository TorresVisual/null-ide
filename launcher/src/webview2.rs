//! The launcher window needs the WebView2 runtime (shipped with Windows 11 and Windows 10 22H2).
//! Copied from `setup/core/src/webview2.rs` (the launcher must not depend on `setup/core`);
//! without the message box, because a missing runtime falls back to the dashboard instead.

use winreg::{enums::*, RegKey};

const CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/// "0.0.0.0" is what the runtime's updater leaves behind after an uninstall.
fn usable_version(pv: &str) -> bool {
    let v = pv.trim();
    !v.is_empty() && v != "0.0.0.0"
}

pub fn installed() -> bool {
    let probes = [
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{CLIENT}")),
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENT}")),
        (HKEY_CURRENT_USER, format!(r"Software\Microsoft\EdgeUpdate\Clients\{CLIENT}")),
    ];
    probes.iter().any(|(hive, path)| {
        RegKey::predef(*hive)
            .open_subkey(path)
            .and_then(|k| k.get_value::<String, _>("pv"))
            .is_ok_and(|pv| usable_version(&pv))
    })
}
