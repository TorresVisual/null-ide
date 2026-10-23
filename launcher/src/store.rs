//! Reads and edits `null-recent-projects.json`, the list Null writes.
//! The entry rules mirror `readEntry` in `extensions/null-tools/src/recentProjects.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub label: String,
    pub is_workspace_file: bool,
    pub timestamp: Number,
    #[serde(default)]
    pub pinned: bool,
    /// Fields this launcher does not know (`gitBranch`, `icon`, ...); written back untouched.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// `<install>\data\user-data` when `<install>\data` is a directory (portable), else `%APPDATA%\Null`.
pub fn user_data_dir(install: &Path, appdata: Option<&Path>) -> Option<PathBuf> {
    let data = install.join("data");
    if data.is_dir() {
        return Some(data.join("user-data"));
    }
    appdata.map(|a| a.join("Null"))
}

pub fn store_path(user_data: &Path) -> PathBuf {
    user_data.join("null-recent-projects.json")
}

/// Raw file order; anything unreadable, malformed or not an array gives an empty list.
pub fn read(file: &Path) -> Vec<Entry> {
    let Ok(text) = std::fs::read_to_string(file) else { return Vec::new() };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) else { return Vec::new() };
    items.into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect()
}

/// Pinned first, then unpinned; each group newest first, stable.
pub fn display_order(mut entries: Vec<Entry>) -> Vec<Entry> {
    entries.sort_by(|a, b| {
        b.pinned.cmp(&a.pinned).then_with(|| {
            let (x, y) = (a.timestamp.as_f64().unwrap_or(0.0), b.timestamp.as_f64().unwrap_or(0.0));
            y.total_cmp(&x)
        })
    });
    entries
}

pub fn write_atomic(file: &Path, entries: &[Entry]) -> io::Result<()> {
    let mut name = file.as_os_str().to_owned();
    name.push(format!(".{}.tmp", std::process::id()));
    let tmp = PathBuf::from(name);
    let result = serde_json::to_vec(entries)
        .map_err(io::Error::other)
        .and_then(|bytes| std::fs::write(&tmp, bytes))
        .and_then(|_| std::fs::rename(&tmp, file));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Windows path identity: case-insensitive, `/` and `\` alike, no trailing separator.
pub fn normalize(path: &str) -> String {
    path.to_lowercase().replace('/', "\\").trim_end_matches('\\').to_string()
}

/// Re-reads the file, flips `pinned` on the one matching entry, writes it back.
pub fn set_pinned(file: &Path, path: &str, pinned: bool) -> io::Result<bool> {
    let mut entries = read(file);
    let key = normalize(path);
    let Some(entry) = entries.iter_mut().find(|e| normalize(&e.path) == key) else { return Ok(false) };
    entry.pinned = pinned;
    write_atomic(file, &entries).map(|_| true)
}

/// Re-reads the file and drops the one matching entry. A pinned entry is refused (`Ok(false)`).
pub fn remove(file: &Path, path: &str) -> io::Result<bool> {
    let mut entries = read(file);
    let key = normalize(path);
    let Some(i) = entries.iter().position(|e| normalize(&e.path) == key) else { return Ok(false) };
    if entries[i].pinned {
        return Ok(false);
    }
    entries.remove(i);
    write_atomic(file, &entries).map(|_| true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn entry(path: &str, ts: i64, pinned: bool) -> Entry {
        Entry {
            path: path.into(),
            label: path.rsplit('\\').next().unwrap().into(),
            is_workspace_file: false,
            timestamp: ts.into(),
            pinned,
            extra: Default::default(),
        }
    }

    fn file(dir: &tempfile::TempDir) -> PathBuf {
        store_path(dir.path())
    }

    #[test]
    fn read_missing_file_is_empty() {
        let d = tempfile::tempdir().unwrap();
        assert!(read(&file(&d)).is_empty());
    }

    #[test]
    fn read_corrupt_json_is_empty() {
        let d = tempfile::tempdir().unwrap();
        fs::write(file(&d), r#"[{"path":"D:\\a","lab"#).unwrap();
        assert!(read(&file(&d)).is_empty());
    }

    #[test]
    fn read_object_instead_of_array_is_empty() {
        let d = tempfile::tempdir().unwrap();
        fs::write(file(&d), "{}").unwrap();
        assert!(read(&file(&d)).is_empty());
    }

    #[test]
    fn read_empty_file_is_empty() {
        let d = tempfile::tempdir().unwrap();
        fs::write(file(&d), "").unwrap();
        assert!(read(&file(&d)).is_empty());
    }

    #[test]
    fn read_skips_invalid_entries_keeps_valid() {
        let d = tempfile::tempdir().unwrap();
        let v = json!([
            {"path":"D:\\good","label":"good","isWorkspaceFile":false,"timestamp":1},
            {"path":5,"label":"x","isWorkspaceFile":false,"timestamp":1},
            {"path":"D:\\p","label":"p","isWorkspaceFile":false,"timestamp":1,"pinned":null},
            "just a string"
        ]);
        fs::write(file(&d), v.to_string()).unwrap();
        let got = read(&file(&d));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].path, "D:\\good");
    }

    #[test]
    fn legacy_entry_defaults() {
        let d = tempfile::tempdir().unwrap();
        let v = json!([{"path":"D:\\a","label":"a","isWorkspaceFile":true,"timestamp":7}]);
        fs::write(file(&d), v.to_string()).unwrap();
        let got = read(&file(&d));
        assert!(!got[0].pinned);
        assert!(got[0].is_workspace_file);
    }

    #[test]
    fn unknown_fields_survive_a_round_trip() {
        let d = tempfile::tempdir().unwrap();
        let v = json!([{"path":"D:\\a","label":"a","isWorkspaceFile":false,"timestamp":7,
                        "gitBranch":"main","icon":"x"}]);
        fs::write(file(&d), v.to_string()).unwrap();
        let entries = read(&file(&d));
        write_atomic(&file(&d), &entries).unwrap();
        let back = read(&file(&d));
        assert_eq!(back[0].extra.get("gitBranch"), Some(&json!("main")));
        assert_eq!(back[0].extra.get("icon"), Some(&json!("x")));
    }

    #[test]
    fn display_order_pins_first_then_newest() {
        let got = display_order(vec![
            entry("D:\\a", 5, false),
            entry("D:\\b", 3, true),
            entry("D:\\c", 9, false),
            entry("D:\\d", 1, true),
        ]);
        let ts: Vec<_> = got.iter().map(|e| (e.pinned, e.timestamp.as_i64().unwrap())).collect();
        assert_eq!(ts, vec![(true, 3), (true, 1), (false, 9), (false, 5)]);
    }

    #[test]
    fn set_pinned_changes_only_that_entry_and_rereads() {
        let d = tempfile::tempdir().unwrap();
        let f = file(&d);
        write_atomic(&f, &[entry("D:\\Coding\\a", 1, false), entry("D:\\Coding\\b", 2, false)]).unwrap();
        // Null appends C after the launcher loaded its copy.
        let mut now = read(&f);
        now.push(entry("D:\\Coding\\c", 3, false));
        write_atomic(&f, &now).unwrap();

        assert!(set_pinned(&f, "d:\\CODING\\a", true).unwrap());
        let got = read(&f);
        assert_eq!(got.len(), 3);
        assert!(got[0].pinned && !got[1].pinned && !got[2].pinned);
    }

    #[test]
    fn remove_refuses_pinned_and_removes_unpinned() {
        let d = tempfile::tempdir().unwrap();
        let f = file(&d);
        write_atomic(&f, &[entry("D:\\a", 1, true), entry("D:\\b", 2, false)]).unwrap();
        assert!(!remove(&f, "D:\\a").unwrap());
        assert_eq!(read(&f).len(), 2);
        assert!(remove(&f, "d:/b/").unwrap());
        let got = read(&f);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].path, "D:\\a");
    }

    #[test]
    fn remove_unknown_path_is_false() {
        let d = tempfile::tempdir().unwrap();
        let f = file(&d);
        write_atomic(&f, &[entry("D:\\a", 1, false)]).unwrap();
        assert!(!remove(&f, "D:\\zzz").unwrap());
        assert!(!set_pinned(&f, "D:\\zzz", true).unwrap());
    }

    #[test]
    fn no_temp_file_left_behind() {
        let d = tempfile::tempdir().unwrap();
        write_atomic(&file(&d), &[entry("D:\\a", 1, false)]).unwrap();
        let names: Vec<_> = fs::read_dir(d.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("null-recent-projects.json")]);
    }

    #[test]
    fn user_data_dir_portable_when_data_folder_exists() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("data")).unwrap();
        assert_eq!(user_data_dir(d.path(), None), Some(d.path().join("data").join("user-data")));
    }

    #[test]
    fn user_data_dir_falls_back_to_appdata_null() {
        let d = tempfile::tempdir().unwrap();
        let appdata = Path::new("C:\\Users\\x\\AppData\\Roaming");
        assert_eq!(user_data_dir(d.path(), Some(appdata)), Some(appdata.join("Null")));
    }

    #[test]
    fn user_data_dir_none_without_appdata_or_data() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(user_data_dir(d.path(), None), None);
    }
}
