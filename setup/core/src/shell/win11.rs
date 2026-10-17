use std::path::Path;

use super::{classes::set_context_menu_key, AppxAdd, Locations, System};
use crate::error::{Error, Result};

#[derive(Debug, PartialEq)]
pub enum Win11 {
    Registered,
    /// An update could not trust the new certificate without UAC; the registration from before still points at this folder.
    Kept,
    /// Nothing registered and trust is missing: `modify` has to ask for approval.
    NeedsReapproval,
    /// The package file is not in this build; the HKCU verbs still work.
    Missing(String),
}

pub fn register(loc: &Locations, sys: &dyn System, install: &Path, allow_elevate: bool) -> Result<Win11> {
    let appx = install.join("shell-ext").join("null-shell-ext.appx");
    if !appx.is_file() {
        return Ok(Win11::Missing(format!("shell extension package not found at {}", appx.display())));
    }
    let cer = install.join("shell-ext").join("NullIDECert.cer");
    set_context_menu_key(loc, install)?;

    let trusted = cer.is_file() && sys.cert_thumbprint(&cer).map(|t| sys.cert_trusted_machine(&t)).unwrap_or(false);
    if !allow_elevate && !trusted {
        // Updates never elevate. Each build has its own certificate, so the new one is usually not trusted yet:
        // keep the registration that exists (it points at this folder, so Explorer loads the new DLL under it).
        return Ok(if sys.appx_installed()?.is_some() { Win11::Kept } else { Win11::NeedsReapproval });
    }

    // Best effort: CurrentUser trust is not enough for Add-AppxPackage on its own, but it costs nothing.
    let _ = sys.cert_add_current_user(&cer);

    if let Some(existing) = sys.appx_installed()? {
        // Ask for trust before the old package goes: a declined UAC prompt must not leave the user with no package.
        if !trusted {
            sys.cert_add_machine_elevated(install)?;
        }
        // Explorer keeps null_explorer_command.dll loaded while this package is registered; servicing it blocks
        // forever. Restart Explorer first so the file is free.
        sys.restart_explorer();
        let _ = sys.appx_remove(&existing);
    }

    let mut added = sys.appx_add(&appx, install);
    if added == AppxAdd::UntrustedRoot {
        if !allow_elevate {
            return Ok(Win11::NeedsReapproval);
        }
        sys.cert_add_machine_elevated(install)?;
        added = sys.appx_add(&appx, install);
    }
    match added {
        AppxAdd::Added => {}
        AppxAdd::UntrustedRoot => {
            return Err(Error::Other("Win11 context menu registration failed: the certificate is still not trusted".into()))
        }
        AppxAdd::Failed(m) => return Err(Error::Other(format!("Win11 context menu registration failed: {m}"))),
    }
    if sys.appx_installed()?.is_none() {
        return Err(Error::Other("Win11 context menu registration failed: NullIDE.ExplorerCommand package is not registered".into()));
    }
    // Keep the registry InstallDir in step with the ExternalLocation this package was registered with.
    set_context_menu_key(loc, install)?;
    sys.restart_explorer();
    Ok(Win11::Registered)
}

pub fn unregister(sys: &dyn System) -> Result<()> {
    if let Some(existing) = sys.appx_installed()? {
        let _ = sys.appx_remove(&existing);
    }
    Ok(())
}
