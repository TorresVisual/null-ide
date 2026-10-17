use std::path::PathBuf;

pub mod builtins;
pub mod config;
pub mod disk;
pub mod download;
pub mod extract;
pub mod first_run;
pub mod error;
pub mod install_config;
pub mod manage;
pub mod http;
pub mod procs;
pub mod progress;
pub mod registrations;
pub mod shell;
pub mod shellext;
pub mod swap;
pub mod update;
pub mod release;

pub use error::{Error, Result};

pub fn local_app_data() -> PathBuf {
    PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
}
