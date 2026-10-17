use std::{borrow::Cow, io, path::Path};

use winreg::{enums::*, RegValue};

use super::{create, open, Locations, System};
use crate::error::{Error, Result};

const KEY: &str = "Environment";

fn same(a: &str, b: &str) -> bool { a.trim_end_matches('\\').eq_ignore_ascii_case(b.trim_end_matches('\\')) }

fn parts(value: &str) -> Vec<&str> { value.split(';').filter(|p| !p.is_empty()).collect() }

pub fn with_dir(value: &str, dir: &str) -> Option<String> {
    let p = parts(value);
    if p.iter().any(|e| same(e, dir)) {
        return None;
    }
    let mut out: Vec<&str> = p;
    out.push(dir);
    Some(out.join(";"))
}

pub fn without_dir(value: &str, dir: &str) -> Option<String> {
    let p = parts(value);
    if !p.iter().any(|e| same(e, dir)) {
        return None;
    }
    Some(p.into_iter().filter(|e| !same(e, dir)).collect::<Vec<_>>().join(";"))
}

fn read(loc: &Locations) -> Result<Option<(String, RegType)>> {
    let Some(k) = open(loc, KEY) else { return Ok(None) };
    match k.get_raw_value("Path") {
        Ok(v) if matches!(v.vtype, REG_SZ | REG_EXPAND_SZ) => {
            let units: Vec<u16> = v.bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let text = String::from_utf16_lossy(&units);
            Ok(Some((text.trim_end_matches('\0').to_string(), v.vtype)))
        }
        Ok(_) => Err(Error::Other("the user PATH is not a text value; leaving it alone".into())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Io { context: "read the user PATH".into(), source: e }),
    }
}

fn write(loc: &Locations, text: &str, vtype: RegType) -> Result<()> {
    let bytes: Vec<u8> = text.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
    create(loc, KEY)?
        .set_raw_value("Path", &RegValue { bytes: Cow::Owned(bytes), vtype })
        .map_err(|e| Error::Io { context: "write the user PATH".into(), source: e })
}

pub fn add(loc: &Locations, sys: &dyn System, dir: &Path) -> Result<()> {
    let dir = dir.display().to_string();
    // A new value is REG_EXPAND_SZ like Windows' own default, so %VAR% entries added later keep working.
    let (current, vtype) = read(loc)?.unwrap_or((String::new(), REG_EXPAND_SZ));
    if let Some(new) = with_dir(&current, &dir) {
        write(loc, &new, vtype)?;
        sys.env_changed();
    }
    Ok(())
}

pub fn remove(loc: &Locations, sys: &dyn System, dir: &Path) -> Result<()> {
    let Some((current, vtype)) = read(loc)? else { return Ok(()) };
    if let Some(new) = without_dir(&current, &dir.display().to_string()) {
        write(loc, &new, vtype)?;
        sys.env_changed();
    }
    Ok(())
}
