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
