use std::{
    os::windows::process::CommandExt,
    path::Path,
    process::Command,
    thread,
    time::{Duration, Instant},
};

use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

use crate::{
    progress::{Ctx, LockedChoice, Progress},
    Error, Result,
};

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, PartialEq)]
pub struct Running { pub pid: u32, pub name: String }

fn processes() -> System {
    System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::everything()))
}

pub fn pid_alive(pid: u32) -> bool {
    processes().process(Pid::from_u32(pid)).is_some()
}

fn norm(p: &Path) -> String {
    p.to_string_lossy().to_lowercase().replace('/', "\\")
}

pub fn is_under(exe: &Path, dir: &Path) -> bool {
    let mut d = norm(dir);
    if !d.ends_with('\\') { d.push('\\'); }
    norm(exe).starts_with(&d)
}

pub fn running_in(dir: &Path) -> Vec<Running> {
    let me = std::process::id();
    let sys = processes();
    sys.processes()
        .values()
        .filter(|p| p.pid().as_u32() != me)
        .filter(|p| p.exe().is_some_and(|e| is_under(e, dir)))
        .map(|p| Running { pid: p.pid().as_u32(), name: p.name().to_string() })
        .collect()
}

fn taskkill(pids: &[u32], force: bool) {
    for pid in pids {
        let mut c = Command::new("taskkill");
        c.arg("/PID").arg(pid.to_string());
        if force { c.args(["/F", "/T"]); }
        let _ = c.creation_flags(NO_WINDOW).status();
    }
}

/// Without `/F` taskkill posts WM_CLOSE, so the IDE can run its hot-exit backup.
pub fn request_close(pids: &[u32]) { taskkill(pids, false) }
pub fn force_close(pids: &[u32]) { taskkill(pids, true) }

pub fn close_all(dir: &Path, ctx: &Ctx, grace: Duration) -> Result<()> {
    loop {
        let mut running = running_in(dir);
        if running.is_empty() { return Ok(()); }
        request_close(&running.iter().map(|r| r.pid).collect::<Vec<_>>());
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            thread::sleep(Duration::from_millis(500));
            running = running_in(dir);
            if running.is_empty() { return Ok(()); }
            ctx.emit(Progress::WaitingForClose { processes: running.iter().map(|r| r.name.clone()).collect() });
        }
        match ctx.interact.locked(&running) {
            LockedChoice::Retry => continue,
            LockedChoice::ForceClose => {
                force_close(&running.iter().map(|r| r.pid).collect::<Vec<_>>());
                thread::sleep(Duration::from_secs(1));
            }
            LockedChoice::Cancel => return Err(Error::Locked(running.into_iter().map(|r| r.name).collect())),
        }
    }
}
