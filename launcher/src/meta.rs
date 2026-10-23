//! Live facts about a project folder: does it exist, which branch, which kind of project.

use crate::store::Entry;
use std::path::{Path, PathBuf};

/// The folder, or a workspace file's parent folder.
pub fn project_dir(entry: &Entry) -> PathBuf {
    let path = PathBuf::from(&entry.path);
    if entry.is_workspace_file {
        path.parent().map(Path::to_path_buf).unwrap_or(path)
    } else {
        path
    }
}

/// A folder entry needs a directory, a workspace entry needs a file.
pub fn exists(entry: &Entry) -> bool {
    let path = Path::new(&entry.path);
    if entry.is_workspace_file { path.is_file() } else { path.is_dir() }
}

/// UNC (`\\host\share`, `//host/share`) and verbatim (`\\?\...`) paths. A `.git` file in a
/// cloned repo is untrusted, and touching a share would send the user's NTLM credentials to it.
fn is_network_path(p: &str) -> bool {
    let mut c = p.chars();
    matches!((c.next(), c.next()), (Some('\\' | '/'), Some('\\' | '/')))
}

/// Reads `<dir>/.git/HEAD` (following a `gitdir:` file for worktrees and submodules); no `git` process.
pub fn git_branch(dir: &Path) -> Option<String> {
    let dot_git = dir.join(".git");
    let git_dir = if dot_git.is_dir() {
        dot_git
    } else {
        let text = std::fs::read_to_string(&dot_git).ok()?;
        let target = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
        if is_network_path(target) {
            return None;
        }
        dir.join(target)
    };
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        let branch = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (!branch.is_empty()).then(|| branch.to_string());
    }
    (head.len() >= 7 && head.chars().all(|c| c.is_ascii_hexdigit())).then(|| head[..7].to_string())
}

/// Mirrors `MARKERS` in `extensions/null-tools/src/projectType.ts`: the first marker found wins.
pub fn project_type(dir: &Path) -> Option<&'static str> {
    let names: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .collect();
    if names.iter().any(|n| n == "Cargo.toml") {
        Some("Rust")
    } else if names.iter().any(|n| n == "CMakeLists.txt") {
        Some("CMake")
    } else if names.iter().any(|n| n.ends_with(".sln") || n.ends_with(".csproj")) {
        Some(".NET")
    } else if names.iter().any(|n| n == "package.json") {
        Some("Node")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn entry(path: &Path, workspace: bool) -> Entry {
        Entry {
            path: path.to_string_lossy().into_owned(),
            label: "x".into(),
            is_workspace_file: workspace,
            timestamp: 1.into(),
            pinned: false,
            extra: Default::default(),
        }
    }

    fn repo(head: &str) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join(".git")).unwrap();
        fs::write(d.path().join(".git").join("HEAD"), head).unwrap();
        d
    }

    #[test]
    fn branch_from_head_ref() {
        let d = repo("ref: refs/heads/feat/nav\n");
        assert_eq!(git_branch(d.path()).as_deref(), Some("feat/nav"));
    }

    #[test]
    fn detached_head_shows_short_hash() {
        let d = repo("0123456789abcdef0123456789abcdef01234567\n");
        assert_eq!(git_branch(d.path()).as_deref(), Some("0123456"));
    }

    #[test]
    fn worktree_git_file_is_followed() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("proj");
        let real = d.path().join("real-git");
        fs::create_dir(&proj).unwrap();
        fs::create_dir(&real).unwrap();
        fs::write(real.join("HEAD"), "ref: refs/heads/wt\n").unwrap();
        fs::write(proj.join(".git"), "gitdir: ../real-git\n").unwrap();
        assert_eq!(git_branch(&proj).as_deref(), Some("wt"));
    }

    #[test]
    fn no_repo_unreadable_or_empty_head_is_none() {
        let none = tempfile::tempdir().unwrap();
        assert_eq!(git_branch(none.path()), None);

        let dangling = tempfile::tempdir().unwrap();
        fs::write(dangling.path().join(".git"), "gitdir: ../nowhere\n").unwrap();
        assert_eq!(git_branch(dangling.path()), None);

        assert_eq!(git_branch(&repo("").path()), None);
        assert_eq!(git_branch(&repo("garbage\n").path()), None);
        assert_eq!(git_branch(&none.path().join("gone")), None);
    }

    #[test]
    fn gitdir_pointing_at_a_network_share_is_never_opened() {
        // Reading it would make Windows authenticate to an arbitrary host (NTLM leak).
        let d = tempfile::tempdir().unwrap();
        for target in ["\\\\attacker\\share\\git", "//attacker/share/git", "\\\\?\\UNC\\attacker\\share"] {
            fs::write(d.path().join(".git"), format!("gitdir: {target}\n")).unwrap();
            assert_eq!(git_branch(d.path()), None, "{target}");
        }
        assert!(!is_network_path("D:\\repo\\.git\\worktrees\\wt"));
        assert!(!is_network_path("../real-git"));
    }

    #[test]
    fn type_order_first_marker_wins() {
        let touch = |names: &[&str]| {
            let d = tempfile::tempdir().unwrap();
            for n in names {
                fs::write(d.path().join(n), "").unwrap();
            }
            project_type(d.path())
        };
        assert_eq!(touch(&["Cargo.toml", "package.json"]), Some("Rust"));
        assert_eq!(touch(&["CMakeLists.txt", "package.json"]), Some("CMake"));
        assert_eq!(touch(&["x.sln"]), Some(".NET"));
        assert_eq!(touch(&["x.csproj", "package.json"]), Some(".NET"));
        assert_eq!(touch(&["package.json"]), Some("Node"));
        assert_eq!(touch(&["readme.md"]), None);
        assert_eq!(project_type(&std::env::temp_dir().join("null-launcher-no-such-dir")), None);
    }

    #[test]
    fn project_dir_of_workspace_file_is_parent() {
        let d = tempfile::tempdir().unwrap();
        let ws = d.path().join("a.code-workspace");
        assert_eq!(project_dir(&entry(&ws, true)), d.path());
        assert_eq!(project_dir(&entry(d.path(), false)), d.path());
    }

    #[test]
    fn exists_checks_kind() {
        let d = tempfile::tempdir().unwrap();
        let ws = d.path().join("a.code-workspace");
        fs::write(&ws, "{}").unwrap();
        assert!(exists(&entry(d.path(), false)));
        assert!(!exists(&entry(&ws, false)), "a file is not a folder project");
        assert!(exists(&entry(&ws, true)));
        assert!(!exists(&entry(d.path(), true)), "a folder is not a workspace file");
        assert!(!exists(&entry(&d.path().join("gone"), false)));
    }
}
