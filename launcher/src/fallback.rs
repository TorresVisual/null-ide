//! What happens when the launcher window cannot start: the old jump list task, plus a log line.

use std::io::Write;
use std::path::Path;

pub const FALLBACK_URL: &str = "null://null.null-tools/recent-projects";
const LOG_LIMIT: u64 = 65_536;

pub fn fallback_args() -> Vec<String> {
    vec!["--open-url".into(), "--".into(), FALLBACK_URL.into()]
}

/// Appends `<unix seconds> <message>` to `launcher.log`, restarting the file once it is past
/// 64 KiB. Never fails and never panics: there is nowhere left to report a logging error.
pub fn log_failure(user_data: &Path, message: &str) {
    let file = user_data.join("launcher.log");
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("{secs} {message}\n");
    let oversized = std::fs::metadata(&file).map(|m| m.len() > LOG_LIMIT).unwrap_or(false);
    let _ = if oversized {
        std::fs::write(&file, line)
    } else {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
            .and_then(|mut f| f.write_all(line.as_bytes()))
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn fallback_args_match_the_old_jump_list_task() {
        assert_eq!(
            fallback_args(),
            vec!["--open-url", "--", "null://null.null-tools/recent-projects"]
        );
    }

    #[test]
    fn log_failure_appends_a_line_with_the_message() {
        let d = tempfile::tempdir().unwrap();
        log_failure(d.path(), "WebView2 missing");
        log_failure(d.path(), "second");
        let text = fs::read_to_string(d.path().join("launcher.log")).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with(" WebView2 missing"));
        assert!(lines[0].split(' ').next().unwrap().parse::<u64>().is_ok());
        assert!(lines[1].ends_with(" second"));
    }

    #[test]
    fn log_failure_restarts_the_file_past_65536_bytes() {
        let d = tempfile::tempdir().unwrap();
        let log = d.path().join("launcher.log");
        fs::write(&log, vec![b'x'; 70_000]).unwrap();
        log_failure(d.path(), "fresh");
        let text = fs::read_to_string(&log).unwrap();
        assert_eq!(text.lines().count(), 1);
        assert!(text.ends_with(" fresh\n"));
    }

    #[test]
    fn log_failure_in_missing_folder_does_not_panic() {
        let d = tempfile::tempdir().unwrap();
        log_failure(&d.path().join("no").join("such"), "x");
    }
}
