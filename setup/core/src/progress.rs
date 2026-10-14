use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{local_app_data, procs::Running};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Progress {
    Checking,
    Downloading { bytes: u64, total: u64, bytes_per_sec: u64 },
    Verifying,
    Preparing,
    WaitingForClose { processes: Vec<String> },
    Installing,
    Restarting,
    UpToDate,
    Ready,
    Busy,
    NeedsReapproval,
    Failed { message: String, log: Option<String> },
}

pub enum LockedChoice { Retry, ForceClose, Cancel }

pub trait Interact {
    fn locked(&self, running: &[Running]) -> LockedChoice;
}

pub struct NoInteract;
impl Interact for NoInteract {
    fn locked(&self, _: &[Running]) -> LockedChoice { LockedChoice::Cancel }
}

pub struct Ctx<'a> {
    pub progress: &'a dyn Fn(Progress),
    pub log: &'a Logger,
    pub interact: &'a dyn Interact,
}

impl Ctx<'_> {
    pub fn emit(&self, p: Progress) {
        if !matches!(p, Progress::Downloading { .. }) {
            self.log.line(&format!("{p:?}"));
        }
        (self.progress)(p);
    }
}

pub struct Logger { file: Mutex<Option<File>>, path: Option<PathBuf> }

fn unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn logs_dir() -> PathBuf { local_app_data().join("Null").join("logs") }

impl Logger {
    pub fn none() -> Logger { Logger { file: Mutex::new(None), path: None } }

    pub fn open(dir: &Path) -> Logger {
        let _ = fs::create_dir_all(dir);
        let path = dir.join(format!("setup-{}.log", unix_secs()));
        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(f) => Logger { file: Mutex::new(Some(f)), path: Some(path) },
            Err(_) => Logger::none(),
        }
    }

    pub fn path(&self) -> Option<&Path> { self.path.as_deref() }

    pub fn line(&self, s: &str) {
        if let Ok(mut g) = self.file.lock() {
            if let Some(f) = g.as_mut() {
                let _ = writeln!(f, "{} {s}", unix_secs());
            }
        }
    }

    pub fn tail(&self, n: usize) -> String {
        let Some(p) = &self.path else { return String::new() };
        let text = fs::read_to_string(p).unwrap_or_default();
        let lines: Vec<&str> = text.lines().collect();
        lines[lines.len().saturating_sub(n)..].join("\n")
    }
}
