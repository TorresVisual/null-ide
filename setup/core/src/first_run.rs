//! The hand-over from the installer to the IDE: choices made during install that null-tools applies on its first start.
//! The file lives outside the install (`%APPDATA%\Null\null-setup\first-run.json`) because `%APPDATA%\Null\User` is the user's.

use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    builtins::{self, Manifest},
    error::{Error, IoCtx, Result},
};

pub const FILE: &str = "first-run.json";
pub const SCHEMA: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct FirstRun {
    pub schema: u32,
    pub settings: BTreeMap<String, Value>,
    pub extensions: Vec<String>,
}

impl Default for FirstRun {
    fn default() -> Self { FirstRun { schema: SCHEMA, settings: BTreeMap::new(), extensions: Vec::new() } }
}

impl FirstRun {
    fn is_empty(&self) -> bool { self.settings.is_empty() && self.extensions.is_empty() }
}

pub fn from_json(text: &str) -> Result<FirstRun> {
    // A missing "schema" must not read as the current one, so it is checked on the raw value first.
    let raw: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))?;
    if raw["schema"].as_u64() != Some(SCHEMA as u64) {
        return Err(Error::Other(format!("{FILE}: expected schema {SCHEMA}")));
    }
    serde_json::from_value(raw).map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))
}

/// Every key and value must be one the manifest of the version being installed offers.
pub fn validate(m: &Manifest, f: &FirstRun) -> Result<()> {
    for (key, value) in &f.settings {
        let def = m
            .settings
            .iter()
            .find(|s| &s.key == key)
            .ok_or_else(|| Error::Other(format!("{FILE}: {key} is not a setting this version offers")))?;
        if !def.accepts(value) {
            return Err(Error::Other(format!("{FILE}: {value} is not a valid value for {key}")));
        }
    }
    for id in &f.extensions {
        if !m.marketplace.iter().any(|e| &e.id == id) {
            return Err(Error::Other(format!("{FILE}: {id} is not in this version's extension list")));
        }
    }
    Ok(())
}

/// `%APPDATA%\Null\null-setup`
pub fn dir() -> Result<PathBuf> {
    let appdata = std::env::var_os("APPDATA").filter(|v| !v.is_empty()).ok_or_else(|| Error::Other("APPDATA is not set".into()))?;
    Ok(PathBuf::from(appdata).join("Null").join("null-setup"))
}

/// Temp file then rename, so the IDE never reads half a file; replaces an unconsumed older one.
pub fn write(dir: &Path, f: &FirstRun) -> Result<()> {
    fs::create_dir_all(dir).ctx("create the first-run folder")?;
    let text = serde_json::to_string_pretty(f).map_err(|e| Error::Other(e.to_string()))?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, text).ctx("write first-run.json")?;
    fs::rename(&tmp, dir.join(FILE)).ctx("replace first-run.json")
}

/// Checks `f` against the manifest and, when it holds anything, writes it to `dir`. Nothing is written on any error.
pub fn save(m: &Manifest, f: &FirstRun, dir: &Path) -> Result<()> {
    validate(m, f)?;
    if f.is_empty() {
        return Ok(());
    }
    write(dir, f)
}

/// Reads the choices file the caller gave and saves it against the `builtins.json` of the installed package.
pub fn save_from_file(install: &Path, file: &Path, dir: &Path) -> Result<()> {
    let f = from_json(&fs::read_to_string(file).ctx(format!("read {}", file.display()))?)?;
    let m = builtins::load(install)?
        .ok_or_else(|| Error::Other("this package has no builtins.json, so the first-run choices cannot be checked".into()))?;
    save(&m, &f, dir)
}
