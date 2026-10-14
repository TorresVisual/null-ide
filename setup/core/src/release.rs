use serde_json::Value;

use crate::{http::Http, Error, Result};

#[derive(Clone, Debug, PartialEq)]
pub struct Release {
    pub tag: String,
    pub zip_name: String,
    pub zip_url: String,
    pub zip_size: u64,
    pub sha256_url: String,
}

pub fn resolve(http: &Http, api_base: &str, repo: &str, tag: &str) -> Result<Release> {
    let v = http.get_json(&format!("{api_base}/repos/{repo}/releases/tags/{tag}"))?;
    from_json(&v, tag)
}

fn is_zip_name(n: &str) -> bool {
    let l = n.to_ascii_lowercase();
    l.starts_with("null-ide-win32-x64") && l.ends_with(".zip")
}

pub fn from_json(v: &Value, tag: &str) -> Result<Release> {
    let assets = v["assets"].as_array().ok_or_else(|| Error::Package("release has no assets".into()))?;
    let zip = assets
        .iter()
        .find(|a| a["name"].as_str().is_some_and(is_zip_name))
        .ok_or_else(|| Error::Package("release has no Windows zip".into()))?;
    let zip_name = zip["name"].as_str().unwrap_or_default().to_string();
    let sidecar_name = format!("{zip_name}.sha256");
    let sidecar = assets
        .iter()
        .find(|a| a["name"].as_str() == Some(sidecar_name.as_str()))
        .ok_or_else(|| Error::Package(format!("release has no {sidecar_name}")))?;
    let url = |a: &Value| {
        a["browser_download_url"].as_str().map(str::to_string).ok_or_else(|| Error::Package("asset without a URL".into()))
    };
    Ok(Release {
        tag: tag.to_string(),
        zip_url: url(zip)?,
        zip_size: zip["size"].as_u64().ok_or_else(|| Error::Package("zip asset without a size".into()))?,
        sha256_url: url(sidecar)?,
        zip_name,
    })
}

pub fn parse_sha256(text: &str) -> Result<String> {
    let token = text.split_whitespace().next().unwrap_or_default().to_ascii_lowercase();
    if token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(token)
    } else {
        Err(Error::Package("the .sha256 sidecar does not contain a SHA256 hash".into()))
    }
}
