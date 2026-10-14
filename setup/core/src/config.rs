use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoCtx, Result};

const FILE: &str = ".null-ide-install.json";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallMeta {
    pub repo: String,
    pub version: String,
    #[serde(default)]
    pub installed_at: Option<String>,
    #[serde(default)]
    pub install_dir: Option<String>,
}

pub fn read(install_dir: &Path) -> Result<InstallMeta> {
    let raw = fs::read_to_string(install_dir.join(FILE)).ctx("read install metadata")?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))
}

pub fn write(install_dir: &Path, meta: &InstallMeta) -> Result<()> {
    let text = serde_json::to_string_pretty(meta).map_err(|e| Error::Other(e.to_string()))?;
    let tmp = install_dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, text).ctx("write install metadata")?;
    fs::rename(&tmp, install_dir.join(FILE)).ctx("replace install metadata")
}

pub fn now_iso() -> String {
    iso_utc(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
}

/// Howard Hinnant's civil-from-days; avoids a date crate for one timestamp.
pub fn iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}
