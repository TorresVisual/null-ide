use std::{collections::HashSet, fs, io, path::Path};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoCtx, Result};

pub const FILE: &str = "install-config.json";
pub const SCHEMA: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feature { DesktopShortcut, StartMenuShortcut, SafeModeShortcut, Path, ContextMenu, FileAssociations, PreviewHandler }

impl Feature {
    pub const ALL: [Feature; 7] = [
        Feature::DesktopShortcut,
        Feature::StartMenuShortcut,
        Feature::SafeModeShortcut,
        Feature::Path,
        Feature::ContextMenu,
        Feature::FileAssociations,
        Feature::PreviewHandler,
    ];

    /// The name `install-null-ide.ps1 -Register/-Unregister` understands.
    pub fn script_name(self) -> &'static str {
        match self {
            Feature::DesktopShortcut => "desktopShortcut",
            Feature::StartMenuShortcut => "startMenuShortcut",
            Feature::SafeModeShortcut => "safeModeShortcut",
            Feature::Path => "path",
            Feature::ContextMenu => "contextMenu",
            Feature::FileAssociations => "fileAssociations",
            Feature::PreviewHandler => "previewHandler",
        }
    }

    /// Registered against the install folder (registry, Explorer), so an update must re-point them.
    /// Shortcuts and PATH point at paths that survive the swap.
    pub fn follows_install(self) -> bool {
        matches!(self, Feature::ContextMenu | Feature::FileAssociations | Feature::PreviewHandler)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct InstallConfig {
    pub schema: u32,
    pub desktop_shortcut: bool,
    pub start_menu_shortcut: bool,
    pub safe_mode_shortcut: bool,
    pub path: bool,
    pub context_menu: bool,
    pub file_associations: bool,
    pub preview_handler: bool,
    /// Built-ins the user left off. Stored as exclusions so a built-in added by a later release is on by default.
    pub excluded_builtins: Vec<String>,
}

impl Default for InstallConfig {
    fn default() -> Self {
        InstallConfig {
            schema: SCHEMA,
            desktop_shortcut: false,
            start_menu_shortcut: true,
            safe_mode_shortcut: true,
            path: true,
            context_menu: true,
            file_associations: true,
            preview_handler: true,
            excluded_builtins: Vec::new(),
        }
    }
}

impl InstallConfig {
    pub fn has(&self, f: Feature) -> bool {
        match f {
            Feature::DesktopShortcut => self.desktop_shortcut,
            Feature::StartMenuShortcut => self.start_menu_shortcut,
            Feature::SafeModeShortcut => self.safe_mode_shortcut,
            Feature::Path => self.path,
            Feature::ContextMenu => self.context_menu,
            Feature::FileAssociations => self.file_associations,
            Feature::PreviewHandler => self.preview_handler,
        }
    }

    pub fn enabled(&self) -> Vec<Feature> {
        Feature::ALL.into_iter().filter(|f| self.has(*f)).collect()
    }

    /// On in `new` but not in `self`.
    pub fn added_features(&self, new: &InstallConfig) -> Vec<Feature> {
        Feature::ALL.into_iter().filter(|f| !self.has(*f) && new.has(*f)).collect()
    }

    /// On in `self` but not in `new`.
    pub fn removed_features(&self, new: &InstallConfig) -> Vec<Feature> {
        Feature::ALL.into_iter().filter(|f| self.has(*f) && !new.has(*f)).collect()
    }
}

pub fn builtins_changed(old: &InstallConfig, new: &InstallConfig) -> bool {
    let set = |c: &InstallConfig| c.excluded_builtins.iter().cloned().collect::<HashSet<String>>();
    set(old) != set(new)
}

pub fn from_json(text: &str) -> Result<InstallConfig> {
    let cfg: InstallConfig = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))?;
    if cfg.schema > SCHEMA {
        return Err(Error::Other(format!(
            "{FILE} was written by a newer null-setup (schema {}); update null-setup first",
            cfg.schema
        )));
    }
    Ok(cfg)
}

pub fn read_file(path: &Path) -> Result<InstallConfig> {
    from_json(&fs::read_to_string(path).ctx(format!("read {}", path.display()))?)
}

/// A folder without the file (an install from before this existed) reads as the defaults.
pub fn read(install_dir: &Path) -> Result<InstallConfig> {
    match fs::read_to_string(install_dir.join(FILE)) {
        Ok(text) => from_json(&text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(InstallConfig::default()),
        Err(e) => Err(Error::Io { context: format!("read {FILE}"), source: e }),
    }
}

pub fn write(install_dir: &Path, cfg: &InstallConfig) -> Result<()> {
    let text = serde_json::to_string_pretty(cfg).map_err(|e| Error::Other(e.to_string()))?;
    let tmp = install_dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, text).ctx("write install config")?;
    fs::rename(&tmp, install_dir.join(FILE)).ctx("replace install config")
}
