use std::{
    os::windows::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::progress::Ctx;

const NO_WINDOW: u32 = 0x0800_0000;
const MARKER: &str = "NULL-SETUP: needs-reapproval";

#[derive(Clone, Debug, PartialEq)]
pub enum Registration { Done, NeedsReapproval, Warning(String), Skipped }

pub fn classify(stdout: &str, exit_ok: bool, stderr: &str) -> Registration {
    if stdout.contains(MARKER) {
        Registration::NeedsReapproval
    } else if exit_ok {
        Registration::Done
    } else {
        let first = stderr.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("registration script failed");
        Registration::Warning(first.to_string())
    }
}

/// Until sub-project 2 ports the registrations to Rust, the script shipped inside the new install does the work.
pub fn reapply(install: &Path, ctx: &Ctx) -> Registration {
    let script = install.join("resources").join("app").join("null-updater").join("install-null-ide.ps1");
    if !script.exists() {
        ctx.log.line("registration script not found; skipping");
        return Registration::Skipped;
    }
    let spawned = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .args(["-ReapplyRegistrations", "-NoElevate", "-InstallDir"])
        .arg(install)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(NO_WINDOW)
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return Registration::Warning(format!("could not start PowerShell: {e}")),
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < Duration::from_secs(120) => thread::sleep(Duration::from_millis(200)),
            _ => {
                let _ = child.kill();
                return Registration::Warning("registration script timed out".into());
            }
        }
    }
    // ponytail: output is read after exit; fine for this script's few lines, switch to a log file if it ever exceeds the pipe buffer.
    match child.wait_with_output() {
        Ok(o) => {
            let (out, err) = (String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            ctx.log.line(&format!("registrations: {out} {err}"));
            classify(&out, o.status.success(), &err)
        }
        Err(e) => Registration::Warning(e.to_string()),
    }
}
