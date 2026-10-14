use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};

use crate::{
    error::{Error, IoCtx, Result},
    http::Http,
    local_app_data, procs,
    progress::{Ctx, Progress},
    release::Release,
};

pub struct Cache { pub root: PathBuf }

impl Cache {
    pub fn standard() -> Cache { Cache { root: local_app_data().join("Null").join("updates") } }
    pub fn dir(&self, tag: &str) -> PathBuf { self.root.join(tag) }

    /// Best effort and only when nobody is downloading: `run/` holds the relocated updater itself.
    pub fn prune_except(&self, keep: &str) {
        let Ok(_lock) = Lock::acquire(&self.root, Duration::ZERO) else { return };
        let Ok(rd) = fs::read_dir(&self.root) else { return };
        for e in rd.flatten() {
            if e.path().is_dir() && e.file_name() != keep && e.file_name() != "run" {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
}

/// Single-writer lock over the whole cache, so a `prefetch` and an `update` cannot delete each other's download.
pub struct Lock { path: PathBuf }

impl Lock {
    pub fn acquire(root: &Path, wait: Duration) -> Result<Lock> {
        Lock::acquire_named(root, ".lock", wait)
    }

    pub fn acquire_named(root: &Path, name: &str, wait: Duration) -> Result<Lock> {
        fs::create_dir_all(root).ctx("create lock directory")?;
        let path = root.join(name);
        let start = Instant::now();
        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut f) => {
                    let _ = write!(f, "{}", std::process::id());
                    return Ok(Lock { path });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if holder_is_dead(&path) {
                        // Rename first: two thieves cannot then delete a lock the other one just created.
                        let stale = path.with_extension(format!("stale-{}", std::process::id()));
                        if fs::rename(&path, &stale).is_ok() {
                            let _ = fs::remove_file(&stale);
                        }
                        continue;
                    }
                    if start.elapsed() >= wait {
                        return Err(Error::Busy);
                    }
                    thread::sleep(Duration::from_millis(200));
                }
                Err(e) => return Err(Error::Io { context: "create download lock".into(), source: e }),
            }
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) { let _ = fs::remove_file(&self.path); }
}

/// An empty pid file means the holder is between create and write, or died there: it is dead once it is 10 s old.
fn holder_is_dead(path: &Path) -> bool {
    match fs::read_to_string(path).ok().and_then(|s| s.trim().parse::<u32>().ok()) {
        Some(pid) => !procs::pid_alive(pid),
        None => fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > Duration::from_secs(10)),
    }
}

fn sidecar(zip: &Path) -> PathBuf {
    let mut name = zip.file_name().unwrap_or_default().to_os_string();
    name.push(".sha256");
    zip.with_file_name(name)
}

/// A zip that an earlier `prefetch` verified, found again without any network access.
pub fn cached(cache: &Cache, tag: &str) -> Option<PathBuf> {
    let dir = cache.dir(tag);
    for e in fs::read_dir(&dir).ok()?.flatten() {
        let path = e.path();
        if path.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip")) {
            let expected = fs::read_to_string(sidecar(&path)).ok()?;
            if sha256_file(&path).ok()? == expected.trim() {
                return Some(path);
            }
        }
    }
    None
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path).ctx("open file to hash")?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).ctx("read file to hash")?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

pub fn fetch(http: &Http, cache: &Cache, rel: &Release, expected_sha: &str, wait: Duration, ctx: &Ctx) -> Result<PathBuf> {
    let dir = cache.dir(&rel.tag);
    fs::create_dir_all(&dir).ctx("create cache directory")?;
    let _lock = Lock::acquire(&cache.root, wait)?;
    let done = dir.join(&rel.zip_name);
    let part = dir.join(format!("{}.part", rel.zip_name));

    if done.exists() {
        ctx.emit(Progress::Verifying);
        if sha256_file(&done)? == expected_sha {
            let _ = fs::write(sidecar(&done), expected_sha);
            return Ok(done);
        }
        let _ = fs::remove_file(&done);
    }

    let (mut net_failures, mut sha_failures) = (0u32, 0u32);
    loop {
        match download_into(http, rel, &part, ctx) {
            Ok(()) => {}
            Err(e @ (Error::Size { .. } | Error::Network(_))) if net_failures < 2 => {
                net_failures += 1;
                ctx.log.line(&format!("download interrupted ({e}); resuming"));
                thread::sleep(http.retry_delay * net_failures);
                continue;
            }
            Err(e) => return Err(e),
        }
        ctx.emit(Progress::Verifying);
        let actual = sha256_file(&part)?;
        if actual == expected_sha {
            fs::rename(&part, &done).ctx("finish download")?;
            let _ = fs::write(sidecar(&done), expected_sha);
            return Ok(done);
        }
        ctx.log.line(&format!("checksum mismatch: expected {expected_sha}, got {actual}"));
        let _ = fs::remove_file(&part);
        sha_failures += 1;
        if sha_failures > 1 {
            return Err(Error::Checksum { expected: expected_sha.into(), actual });
        }
    }
}

fn download_into(http: &Http, rel: &Release, part: &Path, ctx: &Ctx) -> Result<()> {
    let mut have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if have > rel.zip_size {
        let _ = fs::remove_file(part);
        have = 0;
    }
    if have == rel.zip_size {
        return Ok(()); // complete; the hash check decides
    }
    let resp = match http.get(&rel.zip_url, (have > 0).then_some(have)) {
        Err(Error::Http { status: 416, .. }) => {
            let _ = fs::remove_file(part);
            have = 0;
            http.get(&rel.zip_url, None)?
        }
        other => other?,
    };
    let resumed = resp.status() == 206 && have > 0;
    let mut file = if resumed {
        OpenOptions::new().append(true).open(part).ctx("open partial download")?
    } else {
        have = 0;
        File::create(part).ctx("create download file")?
    };

    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; 64 * 1024];
    let mut written = have;
    let (mut window_start, mut window_bytes) = (Instant::now(), written);
    loop {
        let n = reader.read(&mut buf).map_err(|e| Error::Network(e.to_string()))?;
        if n == 0 { break; }
        written += n as u64;
        if written > rel.zip_size {
            drop(file);
            let _ = fs::remove_file(part); // a server sending more than it advertised is not worth resuming
            return Err(Error::Size { expected: rel.zip_size, actual: written });
        }
        file.write_all(&buf[..n]).ctx("write download")?;
        let elapsed = window_start.elapsed();
        if elapsed >= Duration::from_millis(250) {
            let per_sec = ((written - window_bytes) as f64 / elapsed.as_secs_f64()) as u64;
            ctx.emit(Progress::Downloading { bytes: written, total: rel.zip_size, bytes_per_sec: per_sec });
            window_start = Instant::now();
            window_bytes = written;
        }
    }
    file.flush().ctx("flush download")?;
    if written != rel.zip_size {
        return Err(Error::Size { expected: rel.zip_size, actual: written }); // keep the .part for resuming
    }
    Ok(())
}
