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

/// Processes that run from `dir` or have it (or a subfolder) as their working directory: both make renaming
/// `dir` fail with "Access is denied", e.g. a console someone `cd`'d into the install folder.
pub fn running_in(dir: &Path) -> Vec<Running> {
    let me = std::process::id();
    let sys = processes();
    sys.processes()
        .values()
        .filter(|p| p.pid().as_u32() != me)
        .filter(|p| p.exe().is_some_and(|e| is_under(e, dir)) || p.cwd().is_some_and(|c| is_under(&c.join(""), dir)))
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

/// Force-ends the processes called `name` that run from `dir`; true when none is left. Meant for the widgets exe, which keeps no
/// state in memory (its layout is saved on every drag), and which would otherwise sit in the prompt of `close_all`.
pub fn stop_named_under(dir: &Path, name: &str) -> bool {
    let pids = || -> Vec<u32> { running_in(dir).into_iter().filter(|r| r.name.eq_ignore_ascii_case(name)).map(|r| r.pid).collect() };
    let found = pids();
    if found.is_empty() { return true; }
    force_close(&found);
    for _ in 0..10 {
        thread::sleep(Duration::from_millis(300));
        if pids().is_empty() { return true; }
    }
    false
}

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

mod handles {
    use std::{ffi::c_void, os::windows::ffi::OsStringExt, path::PathBuf};

    type Handle = *mut c_void;
    const FILE_TYPE_DISK: u32 = 1;

    extern "system" {
        fn GetFileType(h: Handle) -> u32;
        fn GetFinalPathNameByHandleW(h: Handle, buf: *mut u16, len: u32, flags: u32) -> u32;
        fn CloseHandle(h: Handle) -> i32;
    }

    /// The file or directory a handle refers to; `None` for an invalid handle or anything but a disk object.
    pub fn path_of(h: Handle) -> Option<PathBuf> {
        // SAFETY: both calls only read the handle value; an invalid value fails and is reported as `None`.
        unsafe {
            if GetFileType(h) != FILE_TYPE_DISK {
                return None;
            }
            let mut buf = [0u16; 1024];
            let n = GetFinalPathNameByHandleW(h, buf.as_mut_ptr(), buf.len() as u32, 0) as usize;
            if n == 0 || n >= buf.len() {
                return None;
            }
            let s = std::ffi::OsString::from_wide(&buf[..n]).to_string_lossy().into_owned();
            Some(PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s)))
        }
    }

    /// Closes every handle value in this process that points inside `dir`; returns the paths it closed.
    pub fn close_under(dir: &std::path::Path) -> Vec<PathBuf> {
        // Handle paths come back in long form; `dir` may be an 8.3 short path (e.g. `RUNNER~1` on CI).
        let long = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        let stripped = long.to_string_lossy().strip_prefix(r"\\?\").map(PathBuf::from);
        let dir = stripped.as_deref().unwrap_or(&long);
        let mut closed = Vec::new();
        for v in (4..0x40000usize).step_by(4) {
            let h = v as Handle;
            if let Some(p) = path_of(h) {
                if super::is_under(&p, dir) {
                    // SAFETY: `h` is a live disk handle of this process that nothing here uses.
                    unsafe { CloseHandle(h) };
                    closed.push(p);
                }
            }
        }
        closed
    }
}

/// A process started by the extension host inherits its open files (Node opens them inheritable), e.g. the
/// session's log files. When user data lives inside the install (portable) those handles make renaming the
/// install fail with "Access is denied", so drop them. The updater itself keeps no file open in the install.
pub fn release_inherited_handles(dir: &Path, ctx: &Ctx) {
    for p in handles::close_under(dir) {
        ctx.log.line(&format!("closed inherited handle on {}", p.display()));
    }
}

#[cfg(test)]
mod handle_tests {
    use super::handles;
    use std::os::windows::io::AsRawHandle;

    #[test]
    fn closes_only_handles_inside_the_directory() {
        let inside = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let a = std::fs::File::create(inside.path().join("a.log")).unwrap();
        let b = std::fs::File::create(outside.path().join("b.log")).unwrap();
        let (ha, hb) = (a.as_raw_handle(), b.as_raw_handle());
        assert!(handles::path_of(ha).is_some());

        let closed = handles::close_under(inside.path());

        assert_eq!(closed.len(), 1);
        assert!(handles::path_of(ha).is_none(), "handle inside the dir is closed");
        assert!(handles::path_of(hb).is_some(), "handle outside the dir stays open");
        std::mem::forget(a); // already closed above; dropping it would close a possibly recycled handle
    }
}
