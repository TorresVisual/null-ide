use null_setup_core::shell::assoc::{all_extensions, prog_id, TABLE};

type Row = (String, String, Vec<String>, Option<String>);

fn script_table() -> Vec<Row> {
    let ps1 = include_str!("../../../scripts/install-null-ide.ps1");
    let start = ps1.find("$FileAssocMap = [ordered]@{").expect("table in script");
    let body = &ps1[start..];
    let end = body.find("\n}\n").or_else(|| body.find("\r\n}\r\n")).expect("end of table");
    body[..end]
        .lines()
        .skip(1)
        .filter(|l| l.contains("Description ="))
        .map(|l| {
            let key = l.split('=').next().unwrap().trim().to_string();
            let between = |from: &str, to: &str| {
                let s = l.find(from).unwrap() + from.len();
                let e = s + l[s..].find(to).unwrap();
                l[s..e].to_string()
            };
            let desc = between("Description = '", "'");
            let exts = between("Extensions = @(", ")").split(',').map(|e| e.trim().trim_matches('\'').to_string()).collect();
            let icon = l.contains("Icon = '").then(|| between("Icon = '", "'"));
            (key, desc, exts, icon)
        })
        .collect()
}

#[test]
fn the_table_matches_the_script() {
    let rust: Vec<Row> = TABLE
        .iter()
        .map(|a| (a.key.to_string(), a.description.to_string(), a.extensions.iter().map(|e| e.to_string()).collect(), a.icon.map(String::from)))
        .collect();
    assert_eq!(rust, script_table());
}

#[test]
fn extensions_are_unique_in_first_appearance_order() {
    let all = all_extensions();
    assert_eq!(all[0], ".js");
    let mut sorted = all.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), all.len());
    assert!(all.contains(&".code-workspace") && all.contains(&".h++"));
}

#[test]
fn prog_ids_are_stable() {
    assert_eq!(prog_id(&TABLE[0]), "NullIDE.AssocFile.js");
}
