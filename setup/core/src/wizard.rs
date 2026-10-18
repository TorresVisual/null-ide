//! What the setup window shows, decided from the command line and from what is installed. No window code here.

use std::path::{Path, PathBuf};

use crate::{
    builtins::{self, Manifest},
    http::Http,
    release,
    Error, Result,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Intent { Auto, Modify, Uninstall }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Page {
    /// Nothing installed: the full wizard.
    Install,
    /// Installed: Modify / Repair / Uninstall.
    Maintenance,
    Modify,
    Uninstall,
    /// The Add/Remove Programs entry points at a folder that is gone.
    Stale,
}

impl Page {
    pub fn name(&self) -> &'static str {
        match self {
            Page::Install => "install",
            Page::Maintenance => "maintenance",
            Page::Modify => "modify",
            Page::Uninstall => "uninstall",
            Page::Stale => "stale",
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct Plan {
    pub page: Page,
    pub install_dir: PathBuf,
}

fn same(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().trim_end_matches('\\').to_lowercase();
    norm(a) == norm(b)
}

/// `given`: `--install-dir` from the command line. `registered`: the folder in Add/Remove Programs.
pub fn decide(intent: Intent, given: Option<PathBuf>, registered: Option<PathBuf>, is_ours: &dyn Fn(&Path) -> bool, default_dir: PathBuf) -> Result<Plan> {
    // Installs from before the Add/Remove Programs entry existed have no registration, so the default folder counts too.
    let found = |d: &PathBuf| given.is_none() && is_ours(d);
    if intent == Intent::Auto {
        if let Some(d) = given.as_ref().or(registered.as_ref()).filter(|d| is_ours(d)).or(Some(&default_dir).filter(|d| found(d))) {
            return Ok(Plan { page: Page::Maintenance, install_dir: d.clone() });
        }
        return Ok(Plan { page: Page::Install, install_dir: given.unwrap_or(default_dir) });
    }
    let dir = given
        .or_else(|| registered.clone().filter(|d| is_ours(d)))
        .or_else(|| Some(default_dir.clone()).filter(|d| is_ours(d)))
        .or_else(|| registered.clone())
        .ok_or_else(|| Error::Other("no Null IDE install found".into()))?;
    if is_ours(&dir) {
        let page = if intent == Intent::Modify { Page::Modify } else { Page::Uninstall };
        return Ok(Plan { page, install_dir: dir });
    }
    if intent == Intent::Uninstall && registered.as_deref().is_some_and(|r| same(r, &dir)) {
        return Ok(Plan { page: Page::Stale, install_dir: dir });
    }
    Err(Error::Other(format!("no Null IDE install found in {}", dir.display())))
}

pub struct InstallView {
    pub tag: String,
    /// `None` only when the release has no `builtins.json` asset at all; a failed download is an `Err`.
    pub manifest: Option<Manifest>,
}

pub fn fetch_install(http: &Http, api_base: &str, repo: &str) -> Result<InstallView> {
    let latest = release::resolve_latest(http, api_base, repo)?;
    let manifest = match &latest.builtins_url {
        Some(url) => Some(builtins::parse(&http.get_text(url)?)?),
        None => None,
    };
    Ok(InstallView { tag: latest.release.tag, manifest })
}
