use std::path::PathBuf;

use null_setup_core::wizard::Intent;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Mode { Prefetch, Update, Recover, Install, Modify, Repair, Uninstall, TrustCert, Wizard }

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
    pub first_run: Option<PathBuf>,
    pub intent: Intent,
    pub install_dir_given: bool,
}

use null_setup_core::update::safe_tag;

/// `owner/name` with GitHub's character set; it is interpolated into an API URL path.
fn safe_repo(r: &str) -> bool {
    let ok = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    matches!(r.split_once('/'), Some((o, n)) if ok(o) && ok(n) && o != ".." && n != "..")
}

/// Rules for a folder Null IDE will be installed into; used for `--install-dir` and for the wizard's text field.
pub fn check_install_dir(install_dir: PathBuf) -> Result<PathBuf, String> {
    let raw = install_dir.to_string_lossy().into_owned();
    // ';' would split the user PATH entry and '%' would be expanded in it (REG_EXPAND_SZ).
    if raw.contains([';', '%']) {
        return Err("the install folder may not contain ';' or '%'".into());
    }
    // A trailing backslash would swallow the closing quote when the path is passed on to the elevated process.
    let install_dir = if install_dir.parent().is_some() { PathBuf::from(raw.trim_end_matches('\\')) } else { install_dir };
    // The working directory is changed before the work starts, so a relative path would mean something else than the caller meant.
    if !install_dir.is_absolute() || install_dir.parent().is_none() {
        return Err("the install folder must be an absolute path to a folder (not a drive root)".into());
    }
    Ok(install_dir)
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
        None | Some("wizard") => Mode::Wizard,
        other => {
            return Err(format!(
                "unknown mode: {other:?} (expected wizard, prefetch, update, recover, install, modify, repair, uninstall or trust-cert)"
            ))
        }
    };
    let (mut repo, mut tag, mut install_dir, mut launch) = ("TorresVisual/null-ide".to_string(), String::new(), None, false);
    let (mut config, mut force_close, mut delete_data) = (None, false, false);
    let (mut first_run, mut intent) = (None, None);
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match flag.as_str() {
            "--repo" => repo = value("--repo")?,
            "--version" => tag = value("--version")?,
            "--install-dir" => install_dir = Some(PathBuf::from(value("--install-dir")?)),
            "--config" => config = Some(PathBuf::from(value("--config")?)),
            "--first-run" => first_run = Some(PathBuf::from(value("--first-run")?)),
            "--intent" => intent = Some(value("--intent")?),
            "--launch" => launch = true,
            "--force-close" => force_close = true,
            "--delete-data" => delete_data = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    if !safe_repo(&repo) {
        return Err("--repo must look like owner/name".into());
    }
    let (install_dir, install_dir_given) = match (install_dir, mode) {
        (Some(d), _) => (check_install_dir(d).map_err(|e| format!("--install-dir: {e}"))?, true),
        // The wizard asks for the folder itself; the default is trusted, the typed one is checked when the job starts.
        (None, Mode::Wizard) => (null_setup_core::local_app_data().join("Programs").join("Null IDE"), false),
        (None, _) => return Err("--install-dir is required".into()),
    };
    let intent_given = intent.is_some();
    let intent = match intent.as_deref() {
        None | Some("auto") => Intent::Auto,
        Some("modify") => Intent::Modify,
        Some("uninstall") => Intent::Uninstall,
        Some(o) => return Err(format!("--intent must be auto, modify or uninstall, not {o:?}")),
    };
    if intent_given && mode != Mode::Wizard {
        return Err("--intent only applies to wizard".into());
    }
    if config.as_deref().is_some_and(|c| !c.is_absolute()) {
        return Err("--config must be an absolute path".into());
    }
    if first_run.as_deref().is_some_and(|f| !f.is_absolute()) {
        return Err("--first-run must be an absolute path".into());
    }
    if first_run.is_some() && mode != Mode::Install {
        return Err("--first-run only applies to install".into());
    }
    // Modes that download for a version need one; the others use the installed version and only validate a given tag.
    let needs_tag = matches!(mode, Mode::Prefetch | Mode::Update | Mode::Install);
    if (needs_tag || !tag.is_empty()) && !safe_tag(&tag) {
        return Err("--version is required and may only contain letters, digits, '.', '-' and '_'".into());
    }
    if mode == Mode::Modify && config.is_none() {
        return Err("modify needs --config <file>".into());
    }
    Ok(Args { mode, repo, tag, install_dir, launch, config, force_close, delete_data, first_run, intent, install_dir_given })
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
    fn a_trailing_backslash_is_dropped_so_it_cannot_swallow_a_quote_on_a_command_line() {
        assert_eq!(p("trust-cert --install-dir C:\\Null\\").unwrap().install_dir.to_string_lossy(), "C:\\Null");
    }

    #[test]
    fn install_dirs_with_path_separators_or_percent_are_refused() {
        assert!(p("repair --install-dir C:\\a;b").is_err()); // would split the user PATH
        assert!(p("repair --install-dir C:\\%TEMP%").is_err()); // REG_EXPAND_SZ would expand it
    }

    #[test]
    fn first_run_is_an_absolute_file_for_install_only() {
        let a = p("install --version v1 --install-dir C:\\x --first-run C:\\f.json").unwrap();
        assert_eq!(a.first_run.as_deref(), Some(std::path::Path::new("C:\\f.json")));
        assert!(p("install --version v1 --install-dir C:\\x").unwrap().first_run.is_none());
        assert!(p("install --version v1 --install-dir C:\\x --first-run f.json").is_err()); // relative: the cwd is changed before the work starts
        assert!(p("repair --install-dir C:\\x --first-run C:\\f.json").is_err());
        assert!(p("update --version v1 --install-dir C:\\x --first-run C:\\f.json").is_err());
        assert!(p("install --version v1 --install-dir C:\\x --first-run").is_err());
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

    #[test]
    fn no_arguments_mean_the_wizard_in_the_default_folder() {
        let a = parse(std::iter::empty()).unwrap();
        assert_eq!((a.mode, a.intent, a.install_dir_given), (Mode::Wizard, Intent::Auto, false));
        assert!(a.install_dir.ends_with(r"Programs\Null IDE"));
    }

    #[test]
    fn the_wizard_takes_an_intent_and_an_optional_folder() {
        let a = p("wizard --install-dir C:\\x --intent uninstall").unwrap();
        assert_eq!((a.mode, a.intent, a.install_dir_given), (Mode::Wizard, Intent::Uninstall, true));
        assert_eq!(p("wizard --intent modify").unwrap().intent, Intent::Modify);
        assert!(p("wizard --intent bogus").is_err());
        assert!(p("wizard --install-dir C:\\a;b").is_err()); // a given folder is validated like everywhere else
        assert!(p("repair --install-dir C:\\x --intent modify").is_err()); // wizard only
    }

    #[test]
    fn check_install_dir_is_what_the_wizard_applies_to_a_typed_path() {
        assert_eq!(check_install_dir(PathBuf::from("C:\\Null IDE ünï\\")).unwrap().to_string_lossy(), "C:\\Null IDE ünï");
        for bad in ["Null", "C:\\", "C:\\a;b", "C:\\%TEMP%", ""] {
            assert!(check_install_dir(PathBuf::from(bad)).is_err(), "{bad:?}");
        }
    }
}
