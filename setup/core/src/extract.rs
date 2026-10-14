use std::{fs, io, path::Path};

use crate::{
    error::{Error, IoCtx, Result},
    progress::{Ctx, Progress},
};

pub fn extract(zip_path: &Path, dest: &Path, ctx: &Ctx) -> Result<()> {
    ctx.emit(Progress::Preparing);
    let result = extract_inner(zip_path, dest);
    if result.is_err() {
        let _ = fs::remove_dir_all(dest);
    }
    result
}

fn extract_inner(zip_path: &Path, dest: &Path) -> Result<()> {
    let file = fs::File::open(zip_path).ctx("open update package")?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| Error::Package(e.to_string()))?;
    fs::create_dir_all(dest).ctx("create staging directory")?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| Error::Package(e.to_string()))?;
        let Some(rel) = entry.enclosed_name() else {
            return Err(Error::Package(format!("unsafe path in package: {}", entry.name())));
        };
        let out = dest.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).ctx("create directory")?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).ctx("create directory")?;
        }
        let mut f = fs::File::create(&out).ctx(format!("create {}", out.display()))?;
        io::copy(&mut entry, &mut f).map_err(|e| Error::Package(format!("{}: {e}", entry.name())))?;
    }
    if !dest.join("null.exe").is_file() {
        return Err(Error::Package("null.exe is missing from the package root".into()));
    }
    Ok(())
}
