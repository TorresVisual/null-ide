use std::path::Path;

use sysinfo::Disks;

use crate::{Error, Result};

pub fn check(available: u64, needed: u64) -> Result<()> {
    if available >= needed { Ok(()) } else { Err(Error::Disk { need: needed >> 20, have: available >> 20 }) }
}

fn available_space(path: &Path) -> Option<u64> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

/// Unknown free space (odd mount, UNC path) is not an error: the write itself will fail loudly.
pub fn ensure(path: &Path, needed: u64) -> Result<()> {
    match available_space(path) {
        Some(a) => check(a, needed),
        None => Ok(()),
    }
}
