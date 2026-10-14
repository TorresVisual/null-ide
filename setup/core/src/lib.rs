use std::path::PathBuf;

pub mod config;
pub mod error;
pub mod procs;
pub mod progress;

pub use error::{Error, Result};

pub fn local_app_data() -> PathBuf {
    PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
}
