use std::io::Write;

use null_setup_core::{
    progress::{logs_dir, Ctx, Logger, NoInteract, Progress},
    swap::{self, Timing},
    update::{self, Opts},
    Error,
};

use crate::args::Args;

pub fn prefetch(a: &Args) -> i32 {
    let log = Logger::open(&logs_dir());
    let emit = |p: Progress| {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{}", serde_json::to_string(&p).unwrap_or_default());
        let _ = out.flush();
    };
    let ctx = Ctx { progress: &emit, log: &log, interact: &NoInteract };
    match update::prefetch(&Opts::standard(a.repo.clone(), a.tag.clone(), a.install_dir.clone()), &ctx) {
        Ok(_) | Err(Error::Busy) => 0,
        Err(_) => 1,
    }
}

pub fn recover(a: &Args) -> i32 {
    let log = Logger::open(&logs_dir());
    match swap::recover(&a.install_dir, &Timing::STANDARD) {
        Ok(r) => {
            log.line(&format!("recover: {r:?}"));
            0
        }
        Err(e) => {
            log.line(&format!("recover failed: {e}"));
            1
        }
    }
}
