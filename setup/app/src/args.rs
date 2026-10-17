use std::path::PathBuf;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Mode { Prefetch, Update, Recover, Install, Modify, Repair, Uninstall, TrustCert }

#[derive(Debug)]
pub struct Args {
    pub mode: Mode,
    pub repo: String,
    pub tag: String,
    pub install_dir: PathBuf,
    pub launch: bool,
    pub config: Option<PathBuf>,
    pub force_close: bool,
    pub delete_data: bool,
}

use null_setup_core::update::safe_tag;

/// `owner/name` with GitHub's character set; it is interpolated into an API URL path.
fn safe_repo(r: &str) -> bool {
    let ok = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    matches!(r.split_once('/'), Some((o, n)) if ok(o) && ok(n) && o != ".." && n != "..")
}

pub fn parse<I: IntoIterator<Item = String>>(it: I) -> Result<Args, String> {
    let mut it = it.into_iter();
    let mode = match it.next().as_deref() {
        Some("prefetch") => Mode::Prefetch,
        Some("update") => Mode::Update,
        Some("recover") => Mode::Recover,
        Some("install") => Mode::Install,
        Some("modify") => Mode::Modify,
        Some("repair") => Mode::Repair,
        Some("uninstall") => Mode::Uninstall,
        Some("trust-cert") => Mode::TrustCert,
        other => {
            return Err(format!(
                "unknown or missing mode: {other:?} (expected prefetch, update, recover, install, modify, repair, uninstall or trust-cert)"
            ))
        }
    };
    let (mut repo, mut tag, mut install_dir, mut launch) = ("TorresVisual/null-ide".to_string(), String::new(), None, false);
    let (mut config, mut force_close, mut delete_data) = (None, false, false);
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match flag.as_str() {
            "--repo" => repo = value("--repo")?,
            "--version" => tag = value("--version")?,
            "--install-dir" => install_dir = Some(PathBuf::from(value("--install-dir")?)),
            "--config" => config = Some(PathBuf::from(value("--config")?)),
            "--launch" => launch = true,
            "--force-close" => force_close = true,
            "--delete-data" => delete_data = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    if !safe_repo(&repo) {
        return Err("--repo must look like owner/name".into());
    }
    let install_dir = install_dir.ok_or("--install-dir is required")?;
    // The working directory is changed before the work starts, so a relative path would mean something else than the caller meant.
    if !install_dir.is_absolute() || install_dir.parent().is_none() {
        return Err("--install-dir must be an absolute path to a folder (not a drive root)".into());
    }
    if config.as_deref().is_some_and(|c| !c.is_absolute()) {
        return Err("--config must be an absolute path".into());
    }
    // Modes that download for a version need one; the others use the installed version and only validate a given tag.
    let needs_tag = matches!(mode, Mode::Prefetch | Mode::Update | Mode::Install);
    if (needs_tag || !tag.is_empty()) && !safe_tag(&tag) {
        return Err("--version is required and may only contain letters, digits, '.', '-' and '_'".into());
    }
    if mode == Mode::Modify && config.is_none() {
        return Err("modify needs --config <file>".into());
    }
    Ok(Args { mode, repo, tag, install_dir, launch, config, force_close, delete_data })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> std::result::Result<Args, String> { parse(s.split_whitespace().map(String::from)) }

    #[test]
    fn parses_update() {
        let a = p("update --repo o/r --version v1.2.3 --install-dir C:\\x --launch").unwrap();
        assert_eq!(a.mode, Mode::Update);
        assert_eq!((a.repo.as_str(), a.tag.as_str()), ("o/r", "v1.2.3"));
        assert!(a.launch);
    }

    #[test]
    fn repo_defaults_and_launch_is_off_by_default() {
        let a = p("prefetch --version v1 --install-dir C:\\x").unwrap();
        assert_eq!((a.repo.as_str(), a.launch), ("TorresVisual/null-ide", false));
    }

    #[test]
    fn rejects_missing_unknown_and_unsafe_input() {
        assert!(p("update --install-dir C:\\x").is_err());          // no version
        assert!(p("update --version v1").is_err());                 // no install dir
        assert!(p("update --version v1 --install-dir C:\\x --bogus").is_err());
        assert!(p("frobnicate").is_err());
        assert!(p("update --version ..\\evil --install-dir C:\\x").is_err()); // tag becomes a directory name
        assert!(p("update --version a/b --install-dir C:\\x").is_err());
    }

    #[test]
    fn repo_must_be_owner_slash_name() {
        assert!(p("update --repo ../x --version v1 --install-dir C:\\x").is_err());
        assert!(p("update --repo a/b/c --version v1 --install-dir C:\\x").is_err());
        assert!(p("update --repo a --version v1 --install-dir C:\\x").is_err());
        assert!(p("update --repo a?b/c --version v1 --install-dir C:\\x").is_err());
        assert!(p("update --repo Torres-Visual/null_ide.2 --version v1 --install-dir C:\\x").is_ok());
    }

    #[test]
    fn parses_the_management_modes() {
        let a = p("install --version v1 --install-dir C:\\x --config C:\\c.json --launch").unwrap();
        assert_eq!(a.mode, Mode::Install);
        assert_eq!(a.config.as_deref(), Some(std::path::Path::new("C:\\c.json")));
        assert!(a.launch);
        assert_eq!(p("repair --install-dir C:\\x --force-close").unwrap().mode, Mode::Repair);
        assert!(p("repair --install-dir C:\\x --force-close").unwrap().force_close);
        let m = p("modify --install-dir C:\\x --config C:\\c.json").unwrap();
        assert_eq!(m.mode, Mode::Modify);
        let u = p("uninstall --install-dir C:\\x --delete-data").unwrap();
        assert_eq!((u.mode, u.delete_data), (Mode::Uninstall, true));
        assert!(!p("uninstall --install-dir C:\\x").unwrap().delete_data);
    }

    #[test]
    fn only_install_needs_a_version_among_the_management_modes() {
        assert!(p("install --install-dir C:\\x").is_err());
        assert!(p("repair --install-dir C:\\x").is_ok());
        assert!(p("modify --install-dir C:\\x --config C:\\c.json").is_ok());
        assert!(p("uninstall --install-dir C:\\x").is_ok());
        assert!(p("uninstall --version ..\\evil --install-dir C:\\x").is_err()); // a given tag is still validated
    }

    #[test]
    fn paths_must_be_absolute_and_not_a_drive_root() {
        assert!(p("repair --install-dir Foo").is_err());
        assert!(p("repair --install-dir C:\\").is_err());
        assert!(p("modify --install-dir C:\\x --config c.json").is_err());
    }

    #[test]
    fn trust_cert_needs_only_an_install_dir() {
        let a = p("trust-cert --install-dir C:\\x").unwrap();
        assert_eq!(a.mode, Mode::TrustCert);
        assert!(p("trust-cert").is_err());
        assert!(p("trust-cert --install-dir C:\\x --version v1").is_ok()); // ignored, not an error
    }

    #[test]
    fn recover_needs_no_version() {
        assert_eq!(p("recover --install-dir C:\\x").unwrap().mode, Mode::Recover);
    }

    #[test]
    fn install_dir_may_contain_spaces_when_passed_as_one_argument() {
        let a = parse(["update", "--version", "v1", "--install-dir", "C:\\Null IDE ünï"].map(String::from)).unwrap();
        assert_eq!(a.install_dir.to_string_lossy(), "C:\\Null IDE ünï");
    }
}
