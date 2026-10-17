use std::{ffi::OsString, os::windows::{ffi::OsStringExt, process::CommandExt}, path::{Path, PathBuf}, process::Command};

use windows::{
    core::{Interface, HSTRING},
    Win32::{
        Foundation::MAX_PATH,
        Security::Cryptography::{CERT_SYSTEM_STORE_CURRENT_USER, CERT_SYSTEM_STORE_LOCAL_MACHINE},
        System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ},
        UI::Shell::{FOLDERID_Desktop, FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT},
    },
};

use super::{shortcuts::ShortcutSpec, AppxAdd, System};
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

    fn restart_explorer(&self) {
        // Windows starts Explorer again by itself; the install's DLL is released while it is down.
        let _ = Command::new("taskkill").args(["/F", "/IM", "explorer.exe"]).creation_flags(NO_WINDOW).status();
    }

    // ponytail: three PowerShell cmdlets for APPX; replace with the WinRT PackageManager if PowerShell startup time ever matters.
    fn appx_installed(&self) -> Result<Option<String>> {
        let o = powershell(&format!("(Get-AppxPackage -Name '{PACKAGE}' -ErrorAction SilentlyContinue | Select-Object -First 1).PackageFullName"))
            .map_err(|e| Error::Other(format!("could not start PowerShell: {e}")))?;
        let name = String::from_utf8_lossy(&o.stdout).trim().to_string();
        Ok((!name.is_empty()).then_some(name))
    }

    fn appx_remove(&self, full_name: &str) -> Result<()> {
        powershell(&format!("Remove-AppxPackage -Package '{}' -ErrorAction SilentlyContinue", full_name.replace('\'', "''")))
            .map(|_| ())
            .map_err(|e| Error::Other(e.to_string()))
    }

    fn appx_add(&self, appx: &Path, external: &Path) -> AppxAdd {
        let script = format!(
            "$ErrorActionPreference='Stop'; try {{ Add-AppxPackage -Path {} -ExternalLocation {} -ForceUpdateFromAnyVersion }} catch {{ [Console]::Error.WriteLine($_.Exception.Message); exit 1 }}",
            quote(appx),
            quote(external)
        );
        match powershell(&script) {
            Ok(o) if o.status.success() => AppxAdd::Added,
            Ok(o) => {
                let msg = String::from_utf8_lossy(&o.stderr).trim().to_string();
                if is_untrusted_root(&msg) { AppxAdd::UntrustedRoot } else { AppxAdd::Failed(msg) }
            }
            Err(e) => AppxAdd::Failed(format!("could not start PowerShell: {e}")),
        }
    }

    fn cert_thumbprint(&self, cer: &Path) -> Result<String> { cert::thumbprint(cer) }
    fn cert_trusted_machine(&self, thumbprint: &str) -> bool { cert::trusted(CERT_SYSTEM_STORE_LOCAL_MACHINE, thumbprint) }
    fn cert_add_current_user(&self, cer: &Path) -> Result<()> { cert::add(CERT_SYSTEM_STORE_CURRENT_USER, cer) }

    fn cert_add_machine_elevated(&self, install: &Path) -> Result<()> {
        elevate::run_self(&["trust-cert", "--install-dir", &install.display().to_string()]).map_err(|code| {
            Error::Other(format!(
                "Could not install the shell extension certificate (exit {code}). Approve the UAC prompt or run as administrator."
            ))
        })
    }
}

const NO_WINDOW: u32 = 0x0800_0000;
const PACKAGE: &str = "NullIDE.ExplorerCommand";

fn powershell(script: &str) -> std::io::Result<std::process::Output> {
    Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(NO_WINDOW)
        .output()
}

/// A PowerShell single-quoted literal. PowerShell treats the typographic single quotes as quote characters too,
/// and a doubled quote character is the escape for each of them.
pub fn quote(p: &Path) -> String {
    let mut out = String::from("'");
    for c in p.display().to_string().chars() {
        out.push(c);
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// The text the cmdlet fails with when the signing certificate is not trusted.
pub fn is_untrusted_root(message: &str) -> bool {
    ["0x800B0109", "800B0109", "CERT_E_UNTRUSTEDROOT", "not trusted"].iter().any(|m| message.contains(m))
}

/// Runs elevated. Accepts only an install folder, never a path: the certificate is the one shipped in it.
pub fn trust_target(install: &Path) -> Result<PathBuf> {
    trust_der(install)?;
    Ok(install.join("shell-ext").join("NullIDECert.cer"))
}

/// The certificate bytes are read once, checked, and these same bytes are what gets imported, so the file
/// cannot be swapped between the check and the import.
pub fn trust_der(install: &Path) -> Result<Vec<u8>> {
    if !install.join(".null-ide-install.json").is_file() {
        return Err(Error::Other(format!("{} is not a Null IDE install", install.display())));
    }
    let cer = install.join("shell-ext").join("NullIDECert.cer");
    let der = std::fs::read(&cer).map_err(|e| Error::Io { context: format!("read {}", cer.display()), source: e })?;
    let subject = cert::subject_of(&der)?; // fails for bytes that are not a certificate
    if subject != "Null IDE" {
        return Err(Error::Other(format!("refusing a certificate issued to {subject:?}")));
    }
    Ok(der)
}

pub fn trust_cert_machine(install: &Path) -> Result<()> {
    cert::add_der(CERT_SYSTEM_STORE_LOCAL_MACHINE, &trust_der(install)?)
}

/// Can `LocalMachine\TrustedPeople` be read by this process? (The trust check must not need admin rights.)
pub fn machine_store_readable() -> bool { cert::readable(CERT_SYSTEM_STORE_LOCAL_MACHINE) }

/// Simple display name of the certificate's subject.
pub fn cert_subject(cer: &Path) -> Result<String> { cert::subject(cer) }

mod cert {
    use std::path::Path;

    use windows::{core::w, Win32::Security::Cryptography::*};

    use crate::error::{Error, Result};

    fn read_der(cer: &Path) -> Result<Vec<u8>> {
        std::fs::read(cer).map_err(|e| Error::Io { context: format!("read {}", cer.display()), source: e })
    }

    fn bad(what: &str) -> Error { Error::Other(format!("{what}: not a valid certificate")) }

    struct Context(*const CERT_CONTEXT);
    impl Context {
        fn from_der(der: &[u8]) -> Result<Context> {
            let p = unsafe { CertCreateCertificateContext(X509_ASN_ENCODING, der) };
            if p.is_null() { Err(bad("certificate")) } else { Ok(Context(p)) }
        }
    }
    impl Drop for Context {
        fn drop(&mut self) { unsafe { let _ = CertFreeCertificateContext(Some(self.0)); } }
    }

    struct Store(HCERTSTORE);
    impl Store {
        fn open(location: u32, readonly: bool) -> Result<Store> {
            // Without the read-only flag the system store is opened for writing, which needs admin rights for LocalMachine.
            let flags = if readonly { location | CERT_STORE_READONLY_FLAG.0 } else { location };
            let name = w!("TrustedPeople");
            let h = unsafe { CertOpenStore(CERT_STORE_PROV_SYSTEM_W, CERT_QUERY_ENCODING_TYPE(0), None, CERT_OPEN_STORE_FLAGS(flags), Some(name.as_ptr() as *const _)) }
                .map_err(|e| Error::Other(format!("could not open the certificate store: {e}")))?;
            Ok(Store(h))
        }
    }
    impl Drop for Store {
        fn drop(&mut self) { unsafe { let _ = CertCloseStore(Some(self.0), 0); } }
    }

    pub fn thumbprint(cer: &Path) -> Result<String> {
        let ctx = Context::from_der(&read_der(cer)?)?;
        let mut buf = [0u8; 20];
        let mut len = buf.len() as u32;
        unsafe { CertGetCertificateContextProperty(ctx.0, CERT_SHA1_HASH_PROP_ID, Some(buf.as_mut_ptr() as *mut _), &mut len) }
            .map_err(|e| Error::Other(format!("could not hash the certificate: {e}")))?;
        Ok(buf[..len as usize].iter().map(|b| format!("{b:02X}")).collect())
    }

    pub fn subject(cer: &Path) -> Result<String> { subject_of(&read_der(cer)?) }

    pub fn subject_of(der: &[u8]) -> Result<String> {
        let ctx = Context::from_der(der)?;
        let mut buf = [0u16; 256];
        let n = unsafe { CertGetNameStringW(ctx.0, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, Some(&mut buf)) } as usize;
        if n <= 1 {
            return Err(bad("certificate subject"));
        }
        Ok(String::from_utf16_lossy(&buf[..n - 1]))
    }

    pub fn readable(location: u32) -> bool { Store::open(location, true).is_ok() }

    /// A question, not an operation: any failure answers "no".
    pub fn trusted(location: u32, thumbprint: &str) -> bool {
        let Ok(store) = Store::open(location, true) else { return false };
        let hash: Option<Vec<u8>> = (0..thumbprint.len() / 2)
            .map(|i| u8::from_str_radix(thumbprint.get(i * 2..i * 2 + 2)?, 16).ok())
            .collect();
        let Some(hash) = hash else { return false };
        let blob = CRYPT_INTEGER_BLOB { cbData: hash.len() as u32, pbData: hash.as_ptr() as *mut u8 };
        let found = unsafe { CertFindCertificateInStore(store.0, X509_ASN_ENCODING, 0, CERT_FIND_SHA1_HASH, Some(&blob as *const _ as *const _), None) };
        if found.is_null() {
            return false;
        }
        unsafe { let _ = CertFreeCertificateContext(Some(found)); }
        true
    }

    pub fn add(location: u32, cer: &Path) -> Result<()> { add_der(location, &read_der(cer)?) }

    pub fn add_der(location: u32, der: &[u8]) -> Result<()> {
        Context::from_der(der)?; // refuse bytes that are not a certificate
        let store = Store::open(location, false)?;
        unsafe { CertAddEncodedCertificateToStore(Some(store.0), X509_ASN_ENCODING, der, CERT_STORE_ADD_USE_EXISTING, None) }
            .map_err(|e| Error::Other(format!("could not add the certificate: {e}")))
    }
}

mod elevate {
    use std::os::windows::ffi::OsStrExt;

    use windows::{
        core::{w, PCWSTR},
        Win32::{
            Foundation::{CloseHandle, WAIT_OBJECT_0},
            System::Threading::{GetExitCodeProcess, WaitForSingleObject},
            UI::{
                Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
                WindowsAndMessaging::SW_HIDE,
            },
        },
    };

    /// Re-runs this executable with UAC. `Err` carries the Windows error (1223 = declined) or the exit code.
    pub fn run_self(args: &[&str]) -> std::result::Result<(), u32> {
        let exe = std::env::current_exe().map_err(|_| 2u32)?;
        let file: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let quoted: Vec<String> = args.iter().map(|a| format!("\"{a}\"")).collect();
        let params: Vec<u16> = quoted.join(" ").encode_utf16().chain(std::iter::once(0)).collect();
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: w!("runas"),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        unsafe {
            ShellExecuteExW(&mut info).map_err(|e| (e.code().0 as u32) & 0xFFFF)?;
            let h = info.hProcess;
            // A UAC prompt waits for a person, as in registrations.rs.
            if WaitForSingleObject(h, 600_000) != WAIT_OBJECT_0 {
                let _ = CloseHandle(h);
                return Err(258);
            }
            let mut code = 1u32;
            let _ = GetExitCodeProcess(h, &mut code);
            let _ = CloseHandle(h);
            if code == 0 { Ok(()) } else { Err(code) }
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
