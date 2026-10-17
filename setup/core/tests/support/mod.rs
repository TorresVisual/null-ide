#![allow(dead_code)]
use std::{fs::File, io::Write, path::Path, sync::Arc, thread};

use tiny_http::{Header, Response, Server as Tiny};

pub struct Req { pub base: String, pub url: String, pub range: Option<u64> }
pub type Reply = (u16, Vec<u8>, Vec<(&'static str, String)>);

pub struct Server { pub base: String, tiny: Arc<Tiny> }

pub fn serve<F>(handler: F) -> Server
where
    F: Fn(&Req) -> Reply + Send + 'static,
{
    let tiny = Arc::new(Tiny::http("127.0.0.1:0").unwrap());
    let base = format!("http://{}", tiny.server_addr().to_ip().unwrap());
    let (t, b) = (tiny.clone(), base.clone());
    thread::spawn(move || {
        for request in t.incoming_requests() {
            let range = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Range"))
                .and_then(|h| h.value.as_str().strip_prefix("bytes=")?.strip_suffix('-')?.parse().ok());
            let req = Req { base: b.clone(), url: request.url().to_string(), range };
            let (code, body, headers) = handler(&req);
            let mut resp = Response::from_data(body).with_status_code(code);
            for (k, v) in headers {
                resp = resp.with_header(Header::from_bytes(k, v).unwrap());
            }
            let _ = request.respond(resp);
        }
    });
    Server { base, tiny }
}

impl Drop for Server {
    fn drop(&mut self) { self.tiny.unblock(); }
}

pub fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let mut w = zip::ZipWriter::new(File::create(path).unwrap());
    let opts = zip::write::SimpleFileOptions::default();
    for (name, data) in entries {
        w.start_file(*name, opts).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap();
}

use std::sync::Mutex;

use null_setup_core::{
    install_config::Feature,
    progress::Ctx,
    registrations::{Registrar, Registration},
};

pub struct Call { pub register: Vec<Feature>, pub unregister: Vec<Feature>, pub allow_elevate: bool }

/// Stands in for the real registrar so no test writes the registry, PATH or Start Menu.
pub struct Recorder { pub calls: Mutex<Vec<Call>>, pub result: Registration }

impl Recorder {
    pub fn new(result: Registration) -> Arc<Recorder> { Arc::new(Recorder { calls: Mutex::new(vec![]), result }) }
}

impl Registrar for Recorder {
    fn apply(&self, _: &std::path::Path, register: &[Feature], unregister: &[Feature], allow_elevate: bool, _: &Ctx) -> Registration {
        self.calls.lock().unwrap().push(Call { register: register.to_vec(), unregister: unregister.to_vec(), allow_elevate });
        self.result.clone()
    }
}

use std::sync::atomic::{AtomicU32, Ordering};

use null_setup_core::shell::Locations;
use winreg::{enums::*, RegKey, RegValue};

static HIVE_ID: AtomicU32 = AtomicU32::new(0);

/// A scratch copy of the parts of HKCU the registrations write, removed again on drop.
pub struct Hive {
    pub loc: Locations,
    pub tmp: tempfile::TempDir,
    root: String,
}

impl Hive {
    pub fn new() -> Hive {
        let id = format!("{}-{}", std::process::id(), HIVE_ID.fetch_add(1, Ordering::SeqCst));
        let root = format!(r"Software\NullSetupTest\{id}");
        let tmp = tempfile::tempdir().unwrap();
        let (desktop, programs) = (tmp.path().join("Desktop"), tmp.path().join("Programs"));
        std::fs::create_dir_all(&desktop).unwrap();
        std::fs::create_dir_all(&programs).unwrap();
        Hive { loc: Locations { hkcu: format!(r"{root}\"), desktop, programs }, tmp, root }
    }
    fn open(&self, rel: &str) -> Option<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(self.loc.key(rel)).ok()
    }
    pub fn exists(&self, rel: &str) -> bool { self.open(rel).is_some() }
    /// The value as text; "" name is the (default) value. Panics when missing, so a test fails loudly.
    pub fn get(&self, rel: &str, name: &str) -> String {
        self.open(rel).unwrap_or_else(|| panic!("missing key {rel}")).get_value(name).unwrap_or_else(|e| panic!("{rel}[{name}]: {e}"))
    }
    pub fn try_get(&self, rel: &str, name: &str) -> Option<String> { self.open(rel)?.get_value(name).ok() }
    pub fn value_names(&self, rel: &str) -> Vec<String> {
        self.open(rel).map(|k| k.enum_values().filter_map(|v| v.ok()).map(|(n, _)| n).collect()).unwrap_or_default()
    }
    pub fn set_text(&self, rel: &str, name: &str, value: &str) {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(self.loc.key(rel)).unwrap();
        k.set_value(name, &value).unwrap();
    }
    pub fn set_raw(&self, rel: &str, name: &str, vtype: RegType, text: &str) {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(self.loc.key(rel)).unwrap();
        let bytes: Vec<u8> = text.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
        k.set_raw_value(name, &RegValue { bytes: bytes.into(), vtype }).unwrap();
    }
    pub fn raw_type(&self, rel: &str, name: &str) -> RegType { self.open(rel).unwrap().get_raw_value(name).unwrap().vtype }
}

impl Drop for Hive {
    fn drop(&mut self) { let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&self.root); }
}

use std::cell::RefCell;

use null_setup_core::shell::{shortcuts::ShortcutSpec, System};

#[derive(Default)]
pub struct FakeSystem { pub calls: RefCell<Vec<String>> }

impl FakeSystem {
    pub fn count(&self, what: &str) -> usize { self.calls.borrow().iter().filter(|c| c.as_str() == what).count() }
}

impl System for FakeSystem {
    fn assoc_changed(&self) { self.calls.borrow_mut().push("assoc_changed".into()); }
    fn env_changed(&self) { self.calls.borrow_mut().push("env_changed".into()); }
    fn create_shortcut(&self, s: &ShortcutSpec) -> null_setup_core::Result<()> {
        self.calls.borrow_mut().push(format!("shortcut:{}", s.path.file_name().unwrap().to_string_lossy()));
        Ok(())
    }
}
