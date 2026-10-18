//! The setup window needs the WebView2 runtime (shipped with Windows 11 and Windows 10 22H2).

use winreg::{enums::*, RegKey};

const CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
pub const DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

/// "0.0.0.0" is what the runtime's updater leaves behind after an uninstall.
pub fn usable_version(pv: &str) -> bool {
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

/// Native dialog (there is no window to show anything else in); Yes opens the download page.
pub fn show_missing() {
    use windows::{
        core::{w, HSTRING},
        Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO},
    };
    let text = HSTRING::from(format!(
        "Null IDE Setup needs the Microsoft Edge WebView2 Runtime, which was not found on this PC.\n\nOpen the download page?\n{DOWNLOAD_URL}"
    ));
    let answer = unsafe { MessageBoxW(None, &text, w!("Null IDE Setup"), MB_YESNO | MB_ICONERROR) };
    if answer == IDYES {
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", DOWNLOAD_URL]).spawn();
    }
}
