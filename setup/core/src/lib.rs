use std::path::PathBuf;

pub mod config;
pub mod disk;
pub mod download;
pub mod error;
pub mod http;
pub mod procs;
pub mod progress;
pub mod release;

pub use error::{Error, Result};

pub fn local_app_data() -> PathBuf {
    PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
}
