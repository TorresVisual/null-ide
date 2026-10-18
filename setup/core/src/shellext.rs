use std::{os::windows::process::CommandExt, process::Command, thread, time::Duration};

use crate::progress::Ctx;

const NO_WINDOW: u32 = 0x0800_0000;
const DLL: &str = "null_explorer_command.dll";

pub fn explorer_loads_dll(tasklist_csv: &str) -> bool {
    tasklist_csv.to_ascii_lowercase().contains("\"explorer.exe\"")
}

fn holds_dll() -> bool {
    Command::new("tasklist")
        .args(["/m", DLL, "/fo", "csv", "/nh"])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| explorer_loads_dll(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or(false)
}

fn explorer_running() -> bool {
    Command::new("tasklist")
        .args(["/fi", "imagename eq explorer.exe", "/fo", "csv", "/nh"])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| explorer_loads_dll(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or(false)
}

/// Kills Explorer and brings it back. Windows 10/11 often leave the shell dead after `taskkill /F`, so
/// give the automatic restart a few seconds and start `explorer.exe` ourselves if it did not come.
pub fn restart_explorer() {
    let _ = Command::new("taskkill").args(["/F", "/IM", "explorer.exe"]).creation_flags(NO_WINDOW).status();
    for _ in 0..6 {
        thread::sleep(Duration::from_millis(500));
        if explorer_running() {
            return;
        }
    }
    // Started from a non-elevated process this becomes the user's shell; with no shell running it does not open a window.
    let _ = Command::new("explorer.exe").creation_flags(NO_WINDOW).spawn();
}

/// Explorer keeps the shell extension DLL loaded from the install directory, which blocks renaming it.
/// Killing Explorer is what the old installer already did; it reloads the DLL lazily after the restart.
pub fn release(ctx: &Ctx) {
    if !holds_dll() {
        return;
    }
    ctx.log.line("Explorer holds the shell extension; restarting Explorer so the install directory can be renamed");
    restart_explorer();
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(500));
        if !holds_dll() {
            break;
        }
    }
}
