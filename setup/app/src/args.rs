use std::path::PathBuf;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Mode { Prefetch, Update, Recover }

#[derive(Debug)]
pub struct Args {
    pub mode: Mode,
    pub repo: String,
    pub tag: String,
    pub install_dir: PathBuf,
    pub launch: bool,
}

/// Tags become directory names (`.null-ide-stage-<tag>`), so only a conservative character set is accepted.
fn safe_tag(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) && !t.contains("..")
}

pub fn parse<I: IntoIterator<Item = String>>(it: I) -> Result<Args, String> {
    let mut it = it.into_iter();
    let mode = match it.next().as_deref() {
        Some("prefetch") => Mode::Prefetch,
        Some("update") => Mode::Update,
        Some("recover") => Mode::Recover,
        other => return Err(format!("unknown or missing mode: {other:?} (expected prefetch, update or recover)")),
    };
    let (mut repo, mut tag, mut install_dir, mut launch) = ("TorresVisual/null-ide".to_string(), String::new(), None, false);
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match flag.as_str() {
            "--repo" => repo = value("--repo")?,
            "--version" => tag = value("--version")?,
            "--install-dir" => install_dir = Some(PathBuf::from(value("--install-dir")?)),
            "--launch" => launch = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    let install_dir = install_dir.ok_or("--install-dir is required")?;
    if mode != Mode::Recover && !safe_tag(&tag) {
        return Err("--version is required and may only contain letters, digits, '.', '-' and '_'".into());
    }
    Ok(Args { mode, repo, tag, install_dir, launch })
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
    fn recover_needs_no_version() {
        assert_eq!(p("recover --install-dir C:\\x").unwrap().mode, Mode::Recover);
    }

    #[test]
    fn install_dir_may_contain_spaces_when_passed_as_one_argument() {
        let a = parse(["update", "--version", "v1", "--install-dir", "C:\\Null IDE ünï"].map(String::from)).unwrap();
        assert_eq!(a.install_dir.to_string_lossy(), "C:\\Null IDE ünï");
    }
}
