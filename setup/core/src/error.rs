use std::io;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("HTTP {status} from {url}")]
    Http { status: u16, url: String },
    #[error("network error: {0}")]
    Network(String),
    #[error("{context}: {source}")]
    Io { context: String, #[source] source: io::Error },
    #[error("checksum mismatch: expected {expected}, got {actual}")]
    Checksum { expected: String, actual: String },
    #[error("size mismatch: expected {expected} bytes, got {actual}")]
    Size { expected: u64, actual: u64 },
    #[error("invalid package: {0}")]
    Package(String),
    #[error("not enough disk space: need {need} MB, have {have} MB")]
    Disk { need: u64, have: u64 },
    #[error("another download is in progress")]
    Busy,
    #[error("Null IDE is still running: {}", .0.join(", "))]
    Locked(Vec<String>),
    #[error("cancelled")]
    Cancelled,
    /// Test seam: `swap` hooks return `Hook::Crash` to simulate a killed process.
    #[error("simulated crash")]
    Crashed,
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

pub trait IoCtx<T> {
    fn ctx(self, what: impl Into<String>) -> Result<T>;
}

impl<T> IoCtx<T> for io::Result<T> {
    fn ctx(self, what: impl Into<String>) -> Result<T> {
        self.map_err(|source| Error::Io { context: what.into(), source })
    }
}
