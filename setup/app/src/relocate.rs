use std::{env, fs, path::Path, process::Command};

use null_setup_core::{local_app_data, procs::is_under};

use crate::args::Args;

const FLAG: &str = "NULL_SETUP_RELOCATED";

pub fn needs_relocation(exe: &Path, install_dir: &Path, already: bool) -> bool {
    !already && is_under(exe, install_dir)
}

/// The install directory is about to be renamed, so the running exe must not live in it.
pub fn maybe_relocate(a: &Args) {
    let Ok(exe) = env::current_exe() else { return };
    if !needs_relocation(&exe, &a.install_dir, env::var_os(FLAG).is_some()) {
        return;
    }
    let dir = local_app_data().join("Null").join("updates").join("run");
    let _ = fs::create_dir_all(&dir);
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = fs::remove_file(e.path()); // copies from earlier updates; a running one stays locked
        }
    }
    let copy = dir.join(format!("null-setup-{}.exe", std::process::id()));
    if fs::copy(&exe, &copy).is_err() {
        return; // run in place; the swap reports a clear error if the exe is locked
    }
    if Command::new(&copy).args(env::args().skip(1)).env(FLAG, "1").spawn().is_ok() {
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn relocates_only_from_inside_the_install_dir_and_only_once() {
        let install = Path::new(r"C:\Programs\Null IDE");
        assert!(needs_relocation(Path::new(r"C:\Programs\Null IDE\setup\null-setup.exe"), install, false));
        assert!(!needs_relocation(Path::new(r"C:\Programs\Null IDE\setup\null-setup.exe"), install, true));
        assert!(!needs_relocation(Path::new(r"C:\Temp\null-setup.exe"), install, false));
    }
}
