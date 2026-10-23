use crate::store::Entry;

/// Tightest window of `name` holding `query` as a subsequence: `(span, start)`, lower is better.
fn name_score(name: &[char], query: &[char]) -> Option<(usize, usize)> {
    (0..name.len())
        .filter(|&start| name[start] == query[0])
        .filter_map(|start| {
            let mut next = 1;
            let mut end = start;
            for (i, c) in name.iter().enumerate().skip(start + 1) {
                if next == query.len() {
                    break;
                }
                if *c == query[next] {
                    next += 1;
                    end = i;
                }
            }
            (next == query.len()).then_some((end - start, start))
        })
        .min()
}

/// Indices into `entries` (already in display order), best first. The name (`label`) is a
/// case-insensitive subsequence match, the path a plain substring match; name matches
/// rank above path-only ones. A blank query returns everything.
pub fn search(entries: &[Entry], query: &str) -> Vec<usize> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return (0..entries.len()).collect();
    }
    let q: Vec<char> = query.chars().collect();
    let mut named: Vec<((usize, usize), usize)> = Vec::new();
    let mut by_path = Vec::new();
    for (i, entry) in entries.iter().enumerate() {
        let name: Vec<char> = entry.label.to_lowercase().chars().collect();
        if let Some(score) = name_score(&name, &q) {
            named.push((score, i));
        } else if entry.path.to_lowercase().contains(&query) {
            by_path.push(i);
        }
    }
    named.sort();
    named.into_iter().map(|(_, i)| i).chain(by_path).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(label: &str, path: &str) -> Entry {
        Entry {
            path: path.into(),
            label: label.into(),
            is_workspace_file: false,
            timestamp: 1.into(),
            pinned: false,
            extra: Default::default(),
        }
    }

    fn names(entries: &[Entry], q: &str) -> Vec<String> {
        search(entries, q).into_iter().map(|i| entries[i].label.clone()).collect()
    }

    #[test]
    fn blank_query_returns_all_in_order() {
        let v = [e("a", "D:\\a"), e("b", "D:\\b"), e("c", "D:\\c")];
        assert_eq!(search(&v, ""), vec![0, 1, 2]);
        assert_eq!(search(&v, "   "), vec![0, 1, 2]);
    }

    #[test]
    fn subsequence_matches_name() {
        let v = [e("null-ide", "D:\\x\\null-ide"), e("null-notes", "D:\\x\\null-notes")];
        assert_eq!(names(&v, "nide"), vec!["null-ide"]);
        assert_eq!(names(&v, "nts"), vec!["null-notes"]);
        assert!(names(&v, "xyz").is_empty());
    }

    #[test]
    fn case_insensitive() {
        let v = [e("null-ide", "D:\\p"), e("Other", "D:\\q")];
        assert_eq!(names(&v, "NULL"), vec!["null-ide"]);
        assert_eq!(names(&v, "other"), vec!["Other"]);
    }

    #[test]
    fn contiguous_beats_scattered() {
        let v = [e("zzz-i-d-e", "D:\\a"), e("zzz-ide", "D:\\b")];
        assert_eq!(names(&v, "ide"), vec!["zzz-ide", "zzz-i-d-e"]);
    }

    #[test]
    fn contiguous_run_found_after_an_earlier_scattered_start() {
        let v = [e("i-x-d-e-ide", "D:\\a"), e("i-d---e", "D:\\b")];
        assert_eq!(names(&v, "ide"), vec!["i-x-d-e-ide", "i-d---e"]);
    }

    #[test]
    fn name_match_beats_path_only_match_regardless_of_order() {
        let v = [e("other", "D:\\ide\\other"), e("ide-tool", "D:\\tools\\ide-tool")];
        assert_eq!(search(&v, "ide"), vec![1, 0]);
    }

    #[test]
    fn ties_keep_input_order() {
        let v = [e("abc", "D:\\1"), e("abc", "D:\\2"), e("abc", "D:\\3")];
        assert_eq!(search(&v, "abc"), vec![0, 1, 2]);
    }

    #[test]
    fn path_is_substring_not_fuzzy() {
        let v = [e("zzz", "D:\\Coding\\null")];
        assert!(search(&v, "dcn").is_empty());
        assert_eq!(search(&v, "coding\\nu"), vec![0]);
    }

    #[test]
    fn special_characters_are_literal() {
        let v = [e("c++-lib", "D:\\c++-lib"), e("plain", "D:\\plain")];
        assert_eq!(names(&v, "c++"), vec!["c++-lib"]);
        for q in ["[", "(", "\\", "*", "?"] {
            let _ = search(&v, q);
        }
        assert_eq!(search(&v, "\\"), vec![0, 1]);
    }
}
