use std::{
    ffi::OsString,
    os::windows::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::{install_config::Feature, progress::Ctx};

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

/// Arguments after `-File <script>`. Pure, so the wiring between features and the script is testable without PowerShell.
pub fn script_args(install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool) -> Vec<OsString> {
    let csv = |fs: &[Feature]| fs.iter().map(|f| f.script_name()).collect::<Vec<_>>().join(",");
    let mut a: Vec<OsString> = vec!["-InstallDir".into(), install.into()];
    if !register.is_empty() {
        a.extend(["-Register".into(), csv(register).into()]);
    }
    if !unregister.is_empty() {
        a.extend(["-Unregister".into(), csv(unregister).into()]);
    }
    if !allow_elevate {
        a.push("-NoElevate".into());
    }
    a
}

/// Until sub-project 2b ports the registrations to Rust, the script shipped inside the install does the work.
/// Unregistering runs before registering.
pub fn apply(install: &Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, ctx: &Ctx) -> Registration {
    if register.is_empty() && unregister.is_empty() {
        return Registration::Skipped;
    }
    let script = install.join("resources").join("app").join("null-updater").join("install-null-ide.ps1");
    if !script.exists() {
        ctx.log.line("registration script not found; skipping");
        return Registration::Skipped;
    }
    let spawned = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .args(script_args(install, register, unregister, allow_elevate))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(NO_WINDOW)
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return Registration::Warning(format!("could not start PowerShell: {e}")),
    };
    // A UAC prompt (certificate approval) waits for a person; everything else finishes in seconds.
    let limit = Duration::from_secs(if allow_elevate { 600 } else { 120 });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < limit => thread::sleep(Duration::from_millis(200)),
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
