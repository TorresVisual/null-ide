mod support;
use std::{fs, path::{Path, PathBuf}, sync::{atomic::{AtomicUsize, Ordering}, Arc}, time::Duration};

use null_setup_core::{
    config,
    download::Cache,
    http::Http,
    install_config::{self, InstallConfig},
    progress::{Ctx, Logger, NoInteract, Progress},
    swap::{journal_path, lock_install, Timing},
    update::{launch_command, prefetch, update, Kind, Opts},
    Error,
};
use sha2::{Digest, Sha256};

struct World { _tmp: tempfile::TempDir, install: PathBuf, cache: PathBuf, zip: Vec<u8> }

fn world(extra: &[(&str, &[u8])]) -> World {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE ünï");
    fs::create_dir_all(install.join("data")).unwrap();
    fs::write(install.join("old.txt"), "old").unwrap();
    fs::write(install.join("data").join("user.txt"), "mine").unwrap();
    config::write(&install, &config::InstallMeta { repo: "o/r".into(), version: "v1".into(), installed_at: None, install_dir: None }).unwrap();
    let zip_path = tmp.path().join("pkg.zip");
    let mut entries: Vec<(&str, &[u8])> = vec![("null.exe", b"MZ"), ("new.txt", b"new")];
    entries.extend_from_slice(extra);
    support::make_zip(&zip_path, &entries);
    let zip = fs::read(&zip_path).unwrap();
    World { cache: tmp.path().join("cache"), install, zip, _tmp: tmp }
}

fn serve_release(zip: Vec<u8>, sha: String, zip_hits: Arc<AtomicUsize>) -> support::Server {
    support::serve(move |req| match req.url.as_str() {
        "/repos/o/r/releases/tags/v2" => (
            200,
            serde_json::json!({ "assets": [
                { "name": "null-ide-win32-x64.zip", "browser_download_url": format!("{}/zip", req.base), "size": zip.len() },
                { "name": "null-ide-win32-x64.zip.sha256", "browser_download_url": format!("{}/sha", req.base), "size": 64 }
            ]}).to_string().into_bytes(),
            vec![],
        ),
        "/sha" => (200, sha.clone().into_bytes(), vec![]),
        "/zip" => { zip_hits.fetch_add(1, Ordering::SeqCst); (200, zip.clone(), vec![]) }
        _ => (404, vec![], vec![]),
    })
}

fn opts(w: &World, base: &str) -> Opts {
    let mut o = Opts::standard("o/r".into(), "v2".into(), w.install.clone());
    o.api_base = base.into();
    o.cache = Cache { root: w.cache.clone() };
    o.http = Http::with_delay(Duration::from_millis(1));
    o.timing = Timing { retries: 2, delay: Duration::from_millis(1) };
    o.launch = false;
    o.reapply = false;
    o.registrar = support::Recorder::new(null_setup_core::registrations::Registration::Done);
    o.release_shell_ext = false;
    o.close_grace = Duration::from_millis(500);
    o
}

fn run<T>(f: impl FnOnce(&Ctx) -> T) -> (T, Vec<Progress>) {
    let log = Logger::none();
    let seen = std::sync::Mutex::new(vec![]);
    let progress = |p: Progress| seen.lock().unwrap().push(p);
    let r = f(&Ctx { progress: &progress, log: &log, interact: &NoInteract });
    (r, seen.into_inner().unwrap())
}

fn sha(b: &[u8]) -> String { format!("{:x}  null-ide-win32-x64.zip", Sha256::digest(b)) }
fn assert_old(install: &Path) {
    assert!(install.join("old.txt").exists() && !install.join("new.txt").exists());
    assert_eq!(fs::read_to_string(install.join("data").join("user.txt")).unwrap(), "mine");
}

#[test]
fn update_installs_the_new_version_keeps_data_and_prunes_the_cache() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    fs::create_dir_all(w.cache.join("v0-old")).unwrap();
    let (r, seen) = run(|c| update(&opts(&w, &srv.base), c));
    r.unwrap();
    assert!(w.install.join("new.txt").exists() && !w.install.join("old.txt").exists());
    assert_eq!(fs::read_to_string(w.install.join("data").join("user.txt")).unwrap(), "mine");
    let meta = config::read(&w.install).unwrap();
    assert_eq!((meta.version.as_str(), meta.repo.as_str()), ("v2", "o/r"));
    assert!(!journal_path(&w.install).exists());
    assert!(!w.cache.join("v0-old").exists());
    for s in [Progress::Checking, Progress::Preparing, Progress::Installing] { assert!(seen.contains(&s), "{s:?}"); }
}

#[test]
fn prefetch_then_update_downloads_the_zip_only_once() {
    let w = world(&[]);
    let hits = Arc::new(AtomicUsize::new(0));
    let srv = serve_release(w.zip.clone(), sha(&w.zip), hits.clone());
    let o = opts(&w, &srv.base);
    let (r, seen) = run(|c| prefetch(&o, c));
    r.unwrap();
    assert_eq!(seen.last(), Some(&Progress::Ready));
    run(|c| update(&o, c)).0.unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[test]
fn a_bad_checksum_fails_the_update_and_leaves_the_old_install_untouched() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), format!("{}  x", "0".repeat(64)), Arc::new(AtomicUsize::new(0)));
    let (r, seen) = run(|c| update(&opts(&w, &srv.base), c));
    assert!(matches!(r, Err(Error::Checksum { .. })));
    assert_old(&w.install);
    assert!(matches!(seen.last(), Some(Progress::Failed { .. })));
}

#[test]
fn an_unknown_tag_reports_the_http_status() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.tag = "v9".into();
    let (r, _) = run(|c| update(&o, c));
    assert!(matches!(r, Err(Error::Http { status: 404, .. })));
    assert_old(&w.install);
}

#[test]
fn a_new_ide_that_exits_at_once_is_rolled_back() {
    // PING.EXE as null.exe prints usage and exits immediately, like a broken build.
    let ping = fs::read(r"C:\Windows\System32\PING.EXE").unwrap();
    let w = world(&[]);
    let zip_path = w._tmp.path().join("broken.zip");
    support::make_zip(&zip_path, &[("null.exe", &ping), ("new.txt", b"new")]);
    let zip = fs::read(&zip_path).unwrap();
    let srv = serve_release(zip.clone(), sha(&zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.launch = true;
    o.ready_timeout = Duration::from_secs(5);
    let (r, _) = run(|c| update(&o, c));
    assert!(r.is_err());
    assert_old(&w.install);
    assert!(!journal_path(&w.install).exists());
}

#[test]
fn a_new_ide_that_wrote_its_ready_marker_is_committed() {
    let ping = fs::read(r"C:\Windows\System32\PING.EXE").unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let zip_path = tmp.path().join("ok.zip");
    support::make_zip(&zip_path, &[("null.exe", &ping), ("new.txt", b"new"), (".null-ready", b"1")]);
    let zip = fs::read(&zip_path).unwrap();
    let w = world(&[]);
    let srv = serve_release(zip.clone(), sha(&zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.launch = true;
    o.ready_timeout = Duration::from_secs(5);
    run(|c| update(&o, c)).0.unwrap();
    assert!(w.install.join("new.txt").exists());
    assert!(!journal_path(&w.install).exists());
}

#[test]
fn a_prefetched_update_installs_without_any_network() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let o = opts(&w, &srv.base);
    run(|c| prefetch(&o, c)).0.unwrap();
    drop(srv); // the machine is offline when the user clicks "Restart to update"
    let (r, _) = run(|c| update(&o, c));
    r.unwrap();
    assert!(w.install.join("new.txt").exists());
}

#[test]
fn a_second_update_while_one_is_running_is_refused_and_touches_nothing() {
    let w = world(&[]);
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let _running = lock_install(&w.install, Duration::ZERO).unwrap();
    let (r, seen) = run(|c| update(&opts(&w, &srv.base), c));
    assert!(matches!(r, Err(Error::Busy)));
    assert_eq!(seen.last(), Some(&Progress::Busy));
    assert_old(&w.install);
}

#[test]
fn the_new_ide_is_started_without_the_extension_hosts_electron_and_vscode_environment() {
    std::env::set_var("ELECTRON_RUN_AS_NODE", "1");
    std::env::set_var("VSCODE_NULLTEST_CWD", "x");
    let install = PathBuf::from(r"C:\Programs\Null IDE");
    let cmd = launch_command(&install);
    let removed: Vec<String> = cmd
        .get_envs()
        .filter(|(_, v)| v.is_none())
        .map(|(k, _)| k.to_string_lossy().into_owned())
        .collect();
    for k in ["ELECTRON_RUN_AS_NODE", "VSCODE_NULLTEST_CWD", "NULL_SETUP_RELOCATED"] {
        assert!(removed.iter().any(|r| r == k), "{k} is inherited: {removed:?}");
    }
    assert_eq!(cmd.get_current_dir(), Some(install.as_path()));
}

const MANIFEST: &str = r#"{"schema":1,"builtins":[
  {"id":"null-env","label":"Env"},
  {"id":"null-format","label":"Format","requires":["null-env"]},
  {"id":"null-music","label":"Music"}]}"#;

fn with_builtins() -> World {
    world(&[
        ("builtins.json", MANIFEST.as_bytes()),
        ("resources/app/extensions/null-env/package.json", b"{}"),
        ("resources/app/extensions/null-format/package.json", b"{}"),
        ("resources/app/extensions/null-music/package.json", b"{}"),
    ])
}

fn ext(install: &Path, id: &str) -> PathBuf { install.join("resources").join("app").join("extensions").join(id) }

fn excluding(ids: &[&str]) -> InstallConfig {
    InstallConfig { excluded_builtins: ids.iter().map(|s| s.to_string()).collect(), ..Default::default() }
}

fn fresh_target(w: &World) -> PathBuf { w.install.parent().unwrap().join("Fresh Null ünï") }

fn install_opts(w: &World, base: &str, cfg: InstallConfig) -> Opts {
    let mut o = opts(w, base);
    o.install_dir = fresh_target(w);
    o.kind = Kind::Install;
    o.config = Some(cfg);
    o
}

#[test]
fn install_into_a_new_folder_applies_the_choices_and_leaves_excluded_builtins_off_disk() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let o = install_opts(&w, &srv.base, excluding(&["null-music"]));
    run(|c| update(&o, c)).0.unwrap();
    let t = fresh_target(&w);
    assert!(t.join("new.txt").exists() && ext(&t, "null-env").exists() && ext(&t, "null-format").exists());
    assert!(!ext(&t, "null-music").exists());
    assert_eq!(install_config::read(&t).unwrap(), excluding(&["null-music"]));
    assert_eq!(config::read(&t).unwrap().version, "v2");
    assert!(!journal_path(&t).exists());
    assert_old(&w.install); // the other install is not involved
}

#[test]
fn install_refuses_a_folder_that_is_not_empty_and_not_ours() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let o = install_opts(&w, &srv.base, InstallConfig::default());
    let t = fresh_target(&w);
    fs::create_dir_all(&t).unwrap();
    fs::write(t.join("precious.txt"), "mine").unwrap();
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("not empty"), "{e}");
    assert_eq!(fs::read_to_string(t.join("precious.txt")).unwrap(), "mine");
    assert!(!t.join("new.txt").exists() && !journal_path(&t).exists());
}

#[test]
fn install_refuses_an_existing_install() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = install_opts(&w, &srv.base, InstallConfig::default());
    o.install_dir = w.install.clone();
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("already installed"), "{e}");
    assert_old(&w.install);
}

#[test]
fn an_update_keeps_the_saved_exclusions() {
    let w = with_builtins();
    install_config::write(&w.install, &excluding(&["null-music"])).unwrap();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    run(|c| update(&opts(&w, &srv.base), c)).0.unwrap();
    assert!(!ext(&w.install, "null-music").exists() && ext(&w.install, "null-env").exists());
    assert_eq!(install_config::read(&w.install).unwrap(), excluding(&["null-music"]));
}

#[test]
fn an_update_survives_saved_choices_the_new_release_cannot_honor() {
    let w = with_builtins();
    // null-gone no longer exists; null-env is needed by the still-included null-format.
    install_config::write(&w.install, &excluding(&["null-gone", "null-env"])).unwrap();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    run(|c| update(&opts(&w, &srv.base), c)).0.unwrap();
    assert!(ext(&w.install, "null-env").exists());
    assert_eq!(install_config::read(&w.install).unwrap(), excluding(&["null-gone", "null-env"])); // the file is not rewritten
}

#[test]
fn a_corrupt_config_stops_the_update_before_anything_changes() {
    let w = with_builtins();
    fs::write(w.install.join("install-config.json"), "{nope").unwrap();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let e = run(|c| update(&opts(&w, &srv.base), c)).0.unwrap_err().to_string();
    assert!(e.contains("install-config.json"), "{e}");
    assert_old(&w.install);
    assert!(!journal_path(&w.install).exists());
}

#[test]
fn repair_with_a_new_choice_reinstalls_and_prunes_the_newly_excluded_builtin() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.kind = Kind::Repair;
    o.config = Some(excluding(&["null-music"]));
    run(|c| update(&o, c)).0.unwrap();
    assert!(!ext(&w.install, "null-music").exists() && w.install.join("new.txt").exists());
    assert_eq!(fs::read_to_string(w.install.join("data").join("user.txt")).unwrap(), "mine");
}

#[test]
fn a_chosen_set_that_breaks_a_dependency_fails_and_leaves_the_old_install() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.kind = Kind::Repair;
    o.config = Some(excluding(&["null-env"])); // null-format stays and needs it
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("null-env") && e.contains("null-format"), "{e}");
    assert_old(&w.install);
    assert!(!journal_path(&w.install).exists());
}

#[test]
fn a_tag_that_could_escape_the_parent_folder_is_refused_before_anything_changes() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = opts(&w, &srv.base);
    o.kind = Kind::Repair;
    o.tag = r"x\..\..\Victim".into();
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("version"), "{e}");
    assert_old(&w.install);
}

#[test]
fn install_into_something_that_is_not_a_folder_is_refused() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let o = install_opts(&w, &srv.base, InstallConfig::default());
    let t = fresh_target(&w);
    fs::write(&t, "i am a file").unwrap();
    let e = run(|c| update(&o, c)).0.unwrap_err().to_string();
    assert!(e.contains("not a folder"), "{e}");
    assert_eq!(fs::read_to_string(&t).unwrap(), "i am a file");
}

#[test]
fn a_fresh_install_whose_first_launch_fails_stays_installed() {
    let w = with_builtins();
    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
    let mut o = install_opts(&w, &srv.base, InstallConfig::default());
    o.launch = true; // the fake null.exe cannot start
    run(|c| update(&o, c)).0.unwrap();
    let t = fresh_target(&w);
    assert!(t.join("new.txt").exists() && t.join(".null-ide-install.json").exists());
}
