use std::{collections::HashSet, fs, io, path::Path};

use serde::Deserialize;
use serde_json::Value;

use crate::error::{Error, IoCtx, Result};

pub const FILE: &str = "builtins.json";

fn yes() -> bool { true }

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Builtin {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "yes")]
    pub default: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub requires: Vec<String>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Choice {
    pub value: String,
    pub label: String,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SettingKind { Choice, Bool, Number, Text }

/// One IDE setting the installer may preset. `default` is what the IDE has when the key is unset.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingDef {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    pub kind: SettingKind,
    pub default: Value,
    #[serde(default)]
    pub options: Vec<Choice>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl SettingDef {
    /// The only values `first-run.json` may carry for this key. null-tools has the same rules in `firstRun.ts`.
    pub fn accepts(&self, v: &Value) -> bool {
        match self.kind {
            SettingKind::Choice => v.as_str().is_some_and(|s| self.options.iter().any(|o| o.value == s)),
            SettingKind::Bool => v.is_boolean(),
            SettingKind::Number => v
                .as_f64()
                .is_some_and(|n| self.min.map_or(true, |m| n >= m) && self.max.map_or(true, |m| n <= m)),
            SettingKind::Text => v.as_str().is_some_and(|s| !s.is_empty() && s.chars().count() <= 200 && !s.chars().any(char::is_control)),
        }
    }
}

/// An extension the IDE installs from the marketplace on first launch.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct MarketplaceExt {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
}

/// `publisher.name`, each part alphanumeric or `-` and starting alphanumeric. The id reaches the extension installer.
pub fn valid_extension_id(id: &str) -> bool {
    let part = |p: &str| p.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    matches!(id.split_once('.'), Some((a, b)) if part(a) && part(b))
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct Manifest {
    pub schema: u32,
    pub builtins: Vec<Builtin>,
    #[serde(default)]
    pub settings: Vec<SettingDef>,
    #[serde(default)]
    pub marketplace: Vec<MarketplaceExt>,
}

/// Ids are folder names under `resources/app/extensions/`, so only a conservative character set is accepted.
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

pub fn parse(text: &str) -> Result<Manifest> {
    let m: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Package(format!("invalid {FILE}: {e}")))?;
    if m.schema != 1 {
        return Err(Error::Package(format!("{FILE} has schema {}; this null-setup understands 1", m.schema)));
    }
    let mut seen = HashSet::new();
    for b in &m.builtins {
        if !safe_id(&b.id) {
            return Err(Error::Package(format!("{FILE}: unsafe id {:?}", b.id)));
        }
        if !seen.insert(b.id.as_str()) {
            return Err(Error::Package(format!("{FILE}: duplicate id {}", b.id)));
        }
    }
    for b in &m.builtins {
        if let Some(r) = b.requires.iter().find(|r| !seen.contains(r.as_str())) {
            return Err(Error::Package(format!("{FILE}: {} requires unknown {r}", b.id)));
        }
    }
    let mut keys = HashSet::new();
    for s in &m.settings {
        if s.key.is_empty() || !keys.insert(s.key.as_str()) {
            return Err(Error::Package(format!("{FILE}: empty or duplicate setting key {:?}", s.key)));
        }
        if s.kind == SettingKind::Choice && s.options.is_empty() {
            return Err(Error::Package(format!("{FILE}: {} is a choice without options", s.key)));
        }
        if !s.accepts(&s.default) {
            return Err(Error::Package(format!("{FILE}: the default of {} is not a valid value for it", s.key)));
        }
    }
    for e in &m.marketplace {
        if !valid_extension_id(&e.id) {
            return Err(Error::Package(format!("{FILE}: invalid marketplace extension id {:?}", e.id)));
        }
    }
    Ok(m)
}

/// `None` when the package predates `builtins.json`.
pub fn load(root: &Path) -> Result<Option<Manifest>> {
    match fs::read_to_string(root.join(FILE)) {
        Ok(text) => parse(&text).map(Some),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Io { context: format!("read {FILE}"), source: e }),
    }
}

pub struct Resolution {
    /// What will really be left off disk, in manifest order.
    pub excluded: Vec<String>,
    /// Every request that could not be honored, as sentences for the log or an error message.
    pub notes: Vec<String>,
}

/// Turns the wanted exclusions into the ones this release can honor: unknown ids and locked built-ins are
/// dropped, and a built-in that an included one requires stays. Never fails, so an update cannot be blocked
/// by a stale saved choice; callers that take the choice from a person treat any note as an error.
pub fn resolve(m: &Manifest, wanted: &[String]) -> Resolution {
    let mut notes = Vec::new();
    let mut ex: HashSet<&str> = HashSet::new();
    for id in wanted {
        match m.builtins.iter().find(|b| &b.id == id) {
            None => notes.push(format!("{id} is not a built-in of this version")),
            Some(b) if b.locked => notes.push(format!("{id} is part of the core and cannot be left out")),
            Some(b) => {
                ex.insert(b.id.as_str());
            }
        }
    }
    loop {
        let included: Vec<&Builtin> = m.builtins.iter().filter(|b| !ex.contains(b.id.as_str())).collect();
        let mut changed = false;
        for b in included {
            for r in &b.requires {
                if ex.remove(r.as_str()) {
                    notes.push(format!("{r} stays installed because {} needs it", b.id));
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    let excluded = m.builtins.iter().filter(|b| ex.contains(b.id.as_str())).map(|b| b.id.clone()).collect();
    Resolution { excluded, notes }
}

/// Deletes the listed built-in folders. Callers pass `Resolution::excluded`; anything that is not a plain id is skipped anyway.
pub fn prune(extensions_dir: &Path, excluded: &[String]) -> Result<Vec<String>> {
    let mut removed = Vec::new();
    for id in excluded {
        let dir = extensions_dir.join(id);
        if safe_id(id) && dir.is_dir() {
            fs::remove_dir_all(&dir).ctx(format!("remove built-in {id}"))?;
            removed.push(id.clone());
        }
    }
    Ok(removed)
}
