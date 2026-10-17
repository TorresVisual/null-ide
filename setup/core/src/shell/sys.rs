use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::{Path, PathBuf}};

use windows::{
    core::{Interface, HSTRING},
    Win32::{
        Foundation::MAX_PATH,
        System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ},
        UI::Shell::{FOLDERID_Desktop, FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT},
    },
};

use super::{shortcuts::ShortcutSpec, System};
use crate::error::{Error, Result};

pub enum KnownFolder { Desktop, Programs }

pub fn known_folder(id: KnownFolder) -> Result<PathBuf> {
    let guid = match id { KnownFolder::Desktop => FOLDERID_Desktop, KnownFolder::Programs => FOLDERID_Programs };
    unsafe {
        let p = SHGetKnownFolderPath(&guid, KF_FLAG_DEFAULT, None).map_err(|e| Error::Other(format!("known folder: {e}")))?;
        Ok(PathBuf::from(OsString::from_wide(p.as_wide())))
    }
}

/// COM must be initialised on the calling thread; the guard balances it.
struct Com;
impl Com {
    fn init() -> Com {
        unsafe { let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED); }
        Com
    }
}
impl Drop for Com {
    fn drop(&mut self) { unsafe { CoUninitialize() } }
}

fn com(e: windows::core::Error) -> Error { Error::Other(format!("shortcut: {e}")) }

pub struct WinSystem;

impl System for WinSystem {
    fn assoc_changed(&self) {
        use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) }
    }

    fn env_changed(&self) {
        use windows::Win32::{
            Foundation::{LPARAM, WPARAM},
            UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE},
        };
        let env: Vec<u16> = "Environment".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            // Unanswered windows must not stall setup, hence the 5 s cap per window.
            let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(env.as_ptr() as isize), SMTO_ABORTIFHUNG, 5000, None);
        }
    }

    fn create_shortcut(&self, s: &ShortcutSpec) -> Result<()> {
        let _com = Com::init();
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(com)?;
            link.SetPath(&HSTRING::from(s.target.as_os_str())).map_err(com)?;
            link.SetWorkingDirectory(&HSTRING::from(s.working_dir.as_os_str())).map_err(com)?;
            if !s.args.is_empty() {
                link.SetArguments(&HSTRING::from(s.args.as_str())).map_err(com)?;
            }
            link.SetIconLocation(&HSTRING::from(s.target.as_os_str()), 0).map_err(com)?;
            let file: IPersistFile = link.cast().map_err(com)?;
            file.Save(&HSTRING::from(s.path.as_os_str()), true).map_err(com)
        }
    }
}

/// (target, arguments, working directory) of an existing `.lnk`. Used by the tests to prove the writer above.
pub fn read_shortcut(path: &Path) -> Result<(PathBuf, String, PathBuf)> {
    let _com = Com::init();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(com)?;
        let file: IPersistFile = link.cast().map_err(com)?;
        file.Load(&HSTRING::from(path.as_os_str()), STGM_READ).map_err(com)?;
        let mut buf = [0u16; MAX_PATH as usize * 2];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).map_err(com)?;
        let target = PathBuf::from(OsString::from_wide(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]));
        let mut args = [0u16; 1024];
        link.GetArguments(&mut args).map_err(com)?;
        let args = String::from_utf16_lossy(&args[..args.iter().position(|&c| c == 0).unwrap_or(args.len())]);
        let mut wd = [0u16; MAX_PATH as usize * 2];
        link.GetWorkingDirectory(&mut wd).map_err(com)?;
        let wd = PathBuf::from(OsString::from_wide(&wd[..wd.iter().position(|&c| c == 0).unwrap_or(wd.len())]));
        Ok((target, args, wd))
    }
}
