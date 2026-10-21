use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use crate::{
    error::{Error, IoCtx, Result},
    install_config::{self, Feature, InstallConfig},
    procs,
    progress::Ctx,
    registrations::{self, Registrar, Registration},
    shellext,
    swap::{self, Timing},
    update::report,
};

const MARKER: &str = ".null-ide-install.json";

fn is_ours(dir: &Path) -> bool {
    dir.join(MARKER).is_file()
}

/// Applies a changed config when the built-in set is the same: only registrations move and the file is rewritten.
/// No swap, the IDE keeps running. A changed built-in set needs `update` with `Kind::Repair` and the new config.
pub fn modify_in_place(install: &Path, new: &InstallConfig, allow_elevate: bool, registrar: &dyn Registrar, ctx: &Ctx) -> Result<Registration> {
    report(modify_inner(install, new, allow_elevate, registrar, ctx), ctx)
}

fn modify_inner(install: &Path, new: &InstallConfig, allow_elevate: bool, registrar: &dyn Registrar, ctx: &Ctx) -> Result<Registration> {
    let _lock = swap::lock_install(install, Duration::ZERO)?;
    if !is_ours(install) {
        return Err(Error::Other(format!("no Null IDE install found in {}", install.display())));
    }
    let old = install_config::read(install)?;
    if install_config::builtins_changed(&old, new) {
        return Err(Error::Other("the built-in selection changed; that needs a repair with the new config".into()));
    }
    let reg = registrar.apply(install, &old.added_features(new), &old.removed_features(new), allow_elevate, ctx);
    // A config that records features which did not get registered would make the next modify see "nothing to do".
    if let Registration::Warning(w) = &reg {
        return Err(Error::Other(format!("registrations failed, the saved choices were not changed: {w}")));
    }
    install_config::write(install, new)?;
    Ok(reg)
}

pub struct UninstallOpts {
    pub install_dir: PathBuf,
    pub delete_user_data: bool,
    /// `%APPDATA%\Null`; only deleted when `delete_user_data` is set and the folder is named `Null`.
    pub user_data_dir: PathBuf,
    pub timing: Timing,
    pub close_grace: Duration,
    pub release_shell_ext: bool,
    pub registrar: Arc<dyn Registrar>,
}

impl UninstallOpts {
    pub fn standard(install_dir: PathBuf, delete_user_data: bool, user_data_dir: PathBuf) -> UninstallOpts {
        UninstallOpts {
            install_dir,
            delete_user_data,
            user_data_dir,
            timing: Timing::STANDARD,
            close_grace: Duration::from_secs(15),
            release_shell_ext: true,
            registrar: registrations::standard(),
        }
    }
}

/// Removes the app, all registrations and (on request) the user's data. `data\` inside the install is a
/// portable profile: it survives unless deletion was requested. A folder without `.null-ide-install.json` is never touched.
pub fn uninstall(o: &UninstallOpts, ctx: &Ctx) -> Result<()> {
    report(uninstall_inner(o, ctx), ctx)
}

fn uninstall_inner(o: &UninstallOpts, ctx: &Ctx) -> Result<()> {
    if o.delete_user_data && o.user_data_dir.file_name() != Some(std::ffi::OsStr::new("Null")) {
        return Err(Error::Other(format!("refusing to delete {}: not a folder named Null", o.user_data_dir.display())));
    }
    if o.delete_user_data {
        let (u, i) = (&o.user_data_dir, &o.install_dir);
        if !u.is_absolute() || u.starts_with(i) || i.starts_with(u) {
            return Err(Error::Other(format!(
                "refusing to delete {}: it must be an absolute path that does not overlap the install",
                u.display()
            )));
        }
    }
    let _lock = swap::lock_install(&o.install_dir, Duration::ZERO)?;
    swap::recover_unlocked(&o.install_dir, &o.timing)?;
    if !is_ours(&o.install_dir) {
        return Err(Error::Other(format!("{} is not a Null IDE install; nothing was removed", o.install_dir.display())));
    }
    o.registrar.stop_widgets(&o.install_dir, ctx);
    procs::close_all(&o.install_dir, ctx, o.close_grace)?;
    procs::release_inherited_handles(&o.install_dir, ctx);
    if o.release_shell_ext {
        shellext::release(ctx);
    }
    // Registrations first: the script that removes them lives inside the folder deleted below.
    if let Registration::Warning(w) = o.registrar.apply(&o.install_dir, &[], &Feature::ALL, false, ctx) {
        ctx.log.line(&format!("some registrations could not be removed: {w}"));
    }
    remove_install(&o.install_dir, !o.delete_user_data)?;
    // Last on purpose: if a file above could not be removed, the entry must stay so "Uninstall" can be run again.
    o.registrar.arp(&o.install_dir, None, ctx);
    if o.delete_user_data && o.user_data_dir.is_dir() {
        fs::remove_dir_all(&o.user_data_dir).ctx("remove user data")?;
    }
    Ok(())
}

fn remove_install(dir: &Path, keep_data: bool) -> Result<()> {
    for entry in fs::read_dir(dir).ctx("list the install folder")? {
        let entry = entry.ctx("list the install folder")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // The marker goes last: if anything above fails, the folder is still recognizably ours and a retry works.
        // VS Code's portable check is case-insensitive on NTFS, so `Data` is the profile too.
        if name == MARKER || (keep_data && name.eq_ignore_ascii_case("data")) {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.file_type().ctx("inspect the install folder")?.is_dir();
        let done = if is_dir { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
        done.ctx(format!("remove {}", path.display()))?;
    }
    fs::remove_file(dir.join(MARKER)).ctx("remove the install marker")?;
    let _ = fs::remove_dir(dir); // succeeds only when empty, i.e. when no portable data was kept
    Ok(())
}
