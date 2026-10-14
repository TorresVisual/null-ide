mod support;
use std::{
    fs,
    sync::{atomic::{AtomicUsize, Ordering}, Arc, Mutex},
    time::Duration,
};

use null_setup_core::{
    disk,
    download::{fetch, Cache, Lock},
    http::Http,
    progress::{Ctx, Logger, NoInteract, Progress},
    release::Release,
    Error,
};
use sha2::{Digest, Sha256};

const NAME: &str = "null-ide-win32-x64.zip";

fn body() -> Vec<u8> { (0..300_000u32).map(|i| (i % 251) as u8).collect() }
fn sha(b: &[u8]) -> String { format!("{:x}", Sha256::digest(b)) }
fn release(base: &str, size: usize) -> Release {
    Release { tag: "v2".into(), zip_name: NAME.into(), zip_url: format!("{base}/zip"), zip_size: size as u64, sha256_url: String::new() }
}
fn run<T>(f: impl FnOnce(&Ctx) -> T) -> T {
    let log = Logger::none();
    let progress = |_p: Progress| {};
    f(&Ctx { progress: &progress, log: &log, interact: &NoInteract })
}
fn http() -> Http { Http::with_delay(Duration::from_millis(1)) }

#[test]
fn downloads_and_verifies() {
    let data = body();
    let d = data.clone();
    let srv = support::serve(move |_| (200, d.clone(), vec![]));
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    let path = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(fs::read(path).unwrap(), data);
}

#[test]
fn resumes_from_a_partial_file() {
    let data = body();
    let d = data.clone();
    let ranges = Arc::new(Mutex::new(vec![]));
    let r = ranges.clone();
    let srv = support::serve(move |req| {
        r.lock().unwrap().push(req.range);
        match req.range {
            Some(n) => (206, d[n as usize..].to_vec(), vec![]),
            None => (200, d.clone(), vec![]),
        }
    });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), &data[..100_000]).unwrap();
    let path = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(fs::read(path).unwrap(), data);
    assert_eq!(*ranges.lock().unwrap(), vec![Some(100_000)]);
}

#[test]
fn restarts_when_the_server_ignores_range() {
    let data = body();
    let d = data.clone();
    let srv = support::serve(move |_| (200, d.clone(), vec![]));
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), &data[..100_000]).unwrap();
    let path = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(fs::read(path).unwrap(), data);
}

#[test]
fn restarts_on_416_and_on_an_oversized_part_file() {
    let data = body();
    let d = data.clone();
    let srv = support::serve(move |req| match req.range {
        Some(_) => (416, vec![], vec![]),
        None => (200, d.clone(), vec![]),
    });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    // 416 path: a short, wrong part file
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), b"garbage").unwrap();
    let rel = release(&srv.base, data.len());
    assert_eq!(fs::read(run(|c| fetch(&http(), &cache, &rel, &sha(&data), Duration::ZERO, c)).unwrap()).unwrap(), data);
    // oversized path: part larger than the asset
    fs::remove_file(cache.dir("v2").join(NAME)).unwrap();
    fs::write(cache.dir("v2").join(format!("{NAME}.part")), vec![0u8; data.len() + 10]).unwrap();
    assert_eq!(fs::read(run(|c| fetch(&http(), &cache, &rel, &sha(&data), Duration::ZERO, c)).unwrap()).unwrap(), data);
}

#[test]
fn checksum_mismatch_retries_once_then_fails_and_leaves_no_files() {
    let data = body();
    let wrong = vec![7u8; data.len()];
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (200, wrong.clone(), vec![]) });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    let err = run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap_err();
    assert!(matches!(err, Error::Checksum { .. }));
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert!(!cache.dir("v2").join(NAME).exists());
    assert!(!cache.dir("v2").join(format!("{NAME}.part")).exists());
}

#[test]
fn a_404_is_reported_with_its_status() {
    let srv = support::serve(|_| (404, vec![], vec![]));
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    let err = run(|c| fetch(&http(), &cache, &release(&srv.base, 10), &"0".repeat(64), Duration::ZERO, c)).unwrap_err();
    assert!(matches!(err, Error::Http { status: 404, .. }));
}

#[test]
fn a_verified_cached_zip_is_reused_without_a_request() {
    let data = body();
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (200, vec![], vec![]) });
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    fs::create_dir_all(cache.dir("v2")).unwrap();
    fs::write(cache.dir("v2").join(NAME), &data).unwrap();
    run(|c| fetch(&http(), &cache, &release(&srv.base, data.len()), &sha(&data), Duration::ZERO, c)).unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[test]
fn a_second_writer_is_refused_and_a_dead_holders_lock_is_stolen() {
    let tmp = tempfile::tempdir().unwrap();
    let first = Lock::acquire(tmp.path(), Duration::ZERO).unwrap();
    assert!(matches!(Lock::acquire(tmp.path(), Duration::ZERO), Err(Error::Busy)));
    drop(first);
    assert!(Lock::acquire(tmp.path(), Duration::ZERO).is_ok());
    // a lock file left by a process that no longer exists
    fs::write(tmp.path().join(".lock"), "4294967290").unwrap();
    assert!(Lock::acquire(tmp.path(), Duration::ZERO).is_ok());
}

#[test]
fn prune_removes_other_versions_but_not_the_run_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = Cache { root: tmp.path().into() };
    for d in ["v1", "v2", "run"] { fs::create_dir_all(tmp.path().join(d)).unwrap(); }
    cache.prune_except("v2");
    assert!(!tmp.path().join("v1").exists());
    assert!(tmp.path().join("v2").exists() && tmp.path().join("run").exists());
}

#[test]
fn disk_check_compares_available_and_needed() {
    assert!(disk::check(10_000_000, 1_000_000).is_ok());
    assert!(matches!(disk::check(1_000_000, 10_000_000), Err(Error::Disk { .. })));
}
