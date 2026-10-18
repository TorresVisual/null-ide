use null_setup_core::shell::assoc::{all_extensions, prog_id, TABLE};

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
