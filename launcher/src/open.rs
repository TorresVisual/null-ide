//! Turning a stored entry into a `null.exe` command line, and starting it.

use crate::store::Entry;
use std::path::Path;
use std::process::Command;

/// Everything but unreserved characters and `/` becomes `%XX` over the UTF-8 bytes.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `D:\a b` -> `file:///D:/a%20b`; a UNC share `\\srv\x` -> `file://srv/x`.
pub fn file_uri(path: &str) -> String {
    let p = path.replace('\\', "/");
    if let Some(unc) = p.strip_prefix("//") {
        return format!("file://{}", encode(unc));
    }
    let b = p.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return format!("file:///{}:{}", &p[..1], encode(&p[2..]));
    }
    format!("file:///{}", encode(p.trim_start_matches('/')))
}

/// The URI is its own argument; the same arguments the jump list entries use.
pub fn launch_args(entry: &Entry) -> Vec<String> {
    let flag = if entry.is_workspace_file { "--file-uri" } else { "--folder-uri" };
    vec![flag.to_string(), file_uri(&entry.path)]
}

/// Detached, with the temp folder as working directory so the child never keeps the install
/// folder busy (an update renames it). Same as `start_widgets` in `setup/core/src/shell/sys.rs`.
pub fn spawn_null(null_exe: &Path, args: &[String]) -> std::io::Result<()> {
    let mut cmd = Command::new(null_exe);
    cmd.args(args).current_dir(std::env::temp_dir());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, workspace: bool) -> Entry {
        Entry {
            path: path.into(),
            label: "x".into(),
            is_workspace_file: workspace,
            timestamp: 1.into(),
            pinned: false,
            extra: Default::default(),
        }
    }

    #[test]
    fn file_uri_plain_drive_path() {
        assert_eq!(file_uri("D:\\Coding\\Apps\\null-ide"), "file:///D:/Coding/Apps/null-ide");
    }

    #[test]
    fn file_uri_escapes_space_hash_and_percent() {
        assert_eq!(file_uri("D:\\My Proj\\a#b%c"), "file:///D:/My%20Proj/a%23b%25c");
    }

    #[test]
    fn file_uri_encodes_non_ascii_as_utf8() {
        assert_eq!(file_uri("D:\\Café"), "file:///D:/Caf%C3%A9");
    }

    #[test]
    fn file_uri_unc_share_keeps_the_host() {
        assert_eq!(file_uri("\\\\srv\\share\\x y"), "file://srv/share/x%20y");
    }

    #[test]
    fn file_uri_keeps_unreserved_characters() {
        assert_eq!(file_uri("D:\\a-b_c.d~e"), "file:///D:/a-b_c.d~e");
    }

    #[test]
    fn launch_args_folder_vs_workspace() {
        assert_eq!(
            launch_args(&entry("D:\\My Proj", false)),
            vec!["--folder-uri".to_string(), "file:///D:/My%20Proj".to_string()]
        );
        assert_eq!(
            launch_args(&entry("D:\\a\\w.code-workspace", true)),
            vec!["--file-uri".to_string(), "file:///D:/a/w.code-workspace".to_string()]
        );
    }
}
