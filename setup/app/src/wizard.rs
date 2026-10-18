//! The setup window's backend. The rules live in `null_setup_core::wizard`; the work itself runs through
//! `cli::dispatch`, the same path as the headless modes, fed with the choices as temp files.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
};

use null_setup_core::{
    builtins::{self, Manifest},
    config,
    first_run::{self, FirstRun},
    http::Http,
    install_config::{self, InstallConfig},
    local_app_data,
    progress::{logs_dir, Ctx, Logger, Progress},
    shell::{arp, Locations},
    update, wizard as rules, Error,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    args::{check_install_dir, Args, Mode},
    cli,
    window::{self, Action, Channel, UiInteract},
};

const MARKER: &str = ".null-ide-install.json";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct View {
    page: &'static str,
    install_dir: String,
    /// The version that will be installed, or the installed one.
    tag: String,
    manifest: Option<Manifest>,
    config: InstallConfig,
    user_data_dir: String,
}

/// What `wizard_start` validates the UI's choices against.
struct Loaded {
    tag: String,
    manifest: Option<Manifest>,
}

pub struct Shared {
    args: Args,
    loaded: Mutex<Option<Loaded>>,
    running: AtomicBool,
    rx: Mutex<mpsc::Receiver<Action>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    kind: String,
    install_dir: String,
    config: Option<InstallConfig>,
    first_run: Option<FirstRun>,
    #[serde(default)]
    delete_data: bool,
}

#[derive(Serialize, Clone)]
struct Done {
    warning: Option<String>,
}

fn is_ours(d: &Path) -> bool { d.join(MARKER).is_file() }

fn claim(flag: &AtomicBool) -> bool { !flag.swap(true, Ordering::SeqCst) }

fn check_target_dir(dir: &Path) -> Result<(), String> {
    if is_ours(dir) {
        return Err(format!("Null IDE is already installed in {}", dir.display()));
    }
    match update::is_empty_target(dir) {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("{} is not empty; pick an empty folder", dir.display())),
        Err(e) => Err(e.to_string()),
    }
}

/// The same rules the install pipeline applies later, so a bad choice fails before the download starts.
fn check_choices(m: Option<&Manifest>, cfg: &InstallConfig, fr: Option<&FirstRun>) -> Result<(), String> {
    let Some(m) = m else {
        let presets = fr.is_some_and(|f| !f.settings.is_empty() || !f.extensions.is_empty());
        return if cfg.excluded_builtins.is_empty() && !presets {
            Ok(())
        } else {
            Err("this release has no builtins.json, so built-ins and settings cannot be chosen".into())
        };
    };
    let r = builtins::resolve(m, &cfg.excluded_builtins);
    if !r.notes.is_empty() {
        return Err(r.notes.join("; "));
    }
    if let Some(f) = fr {
        first_run::validate(m, f).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn load(args: &Args) -> Result<(View, Loaded), String> {
    let registered = Locations::real().ok().and_then(|l| arp::find(&l)).map(|e| e.install_dir);
    let given = args.install_dir_given.then(|| args.install_dir.clone());
    let plan = rules::decide(args.intent, given, registered, &is_ours, args.install_dir.clone()).map_err(|e| e.to_string())?;
    let user_data_dir = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default().join("Null").display().to_string();
    let install_dir = plan.install_dir.display().to_string();
    let page = plan.page.name();
    let (tag, manifest, config) = match plan.page {
        rules::Page::Install => {
            let v = rules::fetch_install(&Http::standard(), &update::api_base(), &args.repo).map_err(|e| e.to_string())?;
            (v.tag, v.manifest, InstallConfig::default())
        }
        rules::Page::Stale => (String::new(), None, InstallConfig::default()),
        rules::Page::Maintenance | rules::Page::Modify | rules::Page::Uninstall => {
            let meta = config::read(&plan.install_dir).map_err(|e| e.to_string())?;
            let manifest = builtins::load(&plan.install_dir).map_err(|e| e.to_string())?;
            let cfg = install_config::read(&plan.install_dir).map_err(|e| e.to_string())?;
            (meta.version, manifest, cfg)
        }
    };
    let loaded = Loaded { tag: tag.clone(), manifest: manifest.clone() };
    Ok((View { page, install_dir, tag, manifest, config, user_data_dir }, loaded))
}

#[tauri::command]
pub fn wizard_load(app: AppHandle, shared: State<Arc<Shared>>) {
    let shared = shared.inner().clone();
    std::thread::spawn(move || match load(&shared.args) {
        Ok((view, loaded)) => {
            *shared.loaded.lock().unwrap() = Some(loaded);
            let _ = app.emit("view", view);
        }
        Err(message) => {
            let _ = app.emit("view-error", message);
        }
    });
}

#[tauri::command]
pub fn wizard_check_dir(path: String) -> Result<String, String> {
    let dir = check_install_dir(PathBuf::from(path))?;
    check_target_dir(&dir)?;
    Ok(dir.display().to_string())
}

#[tauri::command]
pub fn wizard_launch(dir: String) -> Result<(), String> {
    let dir = check_install_dir(PathBuf::from(dir))?;
    if !is_ours(&dir) {
        return Err(format!("no Null IDE install found in {}", dir.display()));
    }
    update::launch_ide(&dir).map(|_| ()).map_err(|e| e.to_string())
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<PathBuf, String> {
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(path.to_path_buf())
}

/// Turns the UI's job into the `Args` the headless modes take, plus the temp folder holding its two files.
fn prepare(job: &Job, shared: &Shared) -> Result<(Args, PathBuf), String> {
    let dir = check_install_dir(PathBuf::from(&job.install_dir))?;
    let loaded = shared.loaded.lock().unwrap();
    let loaded = loaded.as_ref().ok_or("setup has not finished loading")?;
    let (mode, tag) = match job.kind.as_str() {
        "install" => (Mode::Install, loaded.tag.clone()),
        "modify" => (Mode::Modify, String::new()),
        "repair" => (Mode::Repair, String::new()),
        "uninstall" => (Mode::Uninstall, String::new()),
        other => return Err(format!("unknown job {other:?}")),
    };
    if mode == Mode::Install {
        check_target_dir(&dir)?;
    } else if !is_ours(&dir) {
        return Err(format!("no Null IDE install found in {}", dir.display()));
    }
    if matches!(mode, Mode::Install | Mode::Modify) {
        let cfg = job.config.as_ref().ok_or("the job has no choices")?;
        check_choices(loaded.manifest.as_ref(), cfg, job.first_run.as_ref().filter(|_| mode == Mode::Install))?;
    }
    let tmp = local_app_data().join("Null").join("updates").join(format!("wizard-{}", std::process::id()));
    fs::create_dir_all(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    let config = match (&job.config, mode) {
        (Some(c), Mode::Install | Mode::Modify) => Some(write_json(&tmp.join("install-config.json"), c)?),
        _ => None,
    };
    let first_run = match (&job.first_run, mode) {
        (Some(f), Mode::Install) => Some(write_json(&tmp.join("first-run.json"), f)?),
        _ => None,
    };
    let args = Args {
        mode,
        repo: shared.args.repo.clone(),
        tag,
        install_dir: dir,
        launch: false, // the finish page has a "Launch Null IDE" button
        config,
        force_close: false,
        delete_data: job.delete_data && mode == Mode::Uninstall,
        first_run,
        intent: rules::Intent::Auto,
        install_dir_given: true,
    };
    Ok((args, tmp))
}

fn work(app: AppHandle, shared: Arc<Shared>, log: Arc<Logger>, args: Args, tmp: PathBuf) {
    window::SWAPPING.store(false, Ordering::SeqCst);
    window::FINISHED.store(false, Ordering::SeqCst);
    let emit = |p: Progress| {
        if p == Progress::Installing {
            window::SWAPPING.store(true, Ordering::SeqCst);
        }
        let _ = app.emit("progress", &p);
    };
    let result = {
        let rx = shared.rx.lock().unwrap();
        let interact = UiInteract { app: &app, rx: &rx };
        let ctx = Ctx { progress: &emit, log: &log, interact: &interact };
        cli::dispatch(&args, &ctx)
    };
    let _ = fs::remove_dir_all(&tmp);
    match result {
        Ok(()) => {
            let _ = app.emit("done", Done { warning: None });
        }
        Err(e) if cli::is_partial(&e) => {
            log.line(&format!("finished with a warning: {e}"));
            let _ = app.emit("done", Done { warning: Some(e.to_string()) });
        }
        Err(Error::Busy) => {} // `Busy` was already emitted by the core; the page offers Close
        Err(e) => {
            log.line(&format!("failed: {e}"));
            emit(Progress::Failed { message: e.to_string(), log: log.path().map(|p| p.display().to_string()) });
        }
    }
    window::FINISHED.store(true, Ordering::SeqCst);
    shared.running.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn wizard_start(job: Job, app: AppHandle, shared: State<Arc<Shared>>, log: State<Arc<Logger>>) -> Result<(), String> {
    if job.kind == "removeEntry" {
        // Only an entry whose folder is gone; a live install keeps its entry.
        let loc = Locations::real().map_err(|e| e.to_string())?;
        if arp::find(&loc).is_some_and(|e| !is_ours(&e.install_dir)) {
            arp::unregister(&loc).map_err(|e| e.to_string())?;
        }
        let _ = app.emit("done", Done { warning: None });
        return Ok(());
    }
    let shared = shared.inner().clone();
    if !claim(&shared.running) {
        return Err("Setup is already working".into());
    }
    let (args, tmp) = match prepare(&job, &shared) {
        Ok(p) => p,
        Err(e) => {
            shared.running.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    let log = log.inner().clone();
    std::thread::spawn(move || work(app, shared, log, args, tmp));
    Ok(())
}

pub fn run(args: Args) -> i32 {
    let (tx, rx) = mpsc::channel::<Action>();
    let log = Arc::new(Logger::open(&logs_dir()));
    let shared = Arc::new(Shared { args, loaded: Mutex::new(None), running: AtomicBool::new(false), rx: Mutex::new(rx) });
    // The update window is the configured one; the wizard reuses it with its own page and size.
    let mut context = tauri::generate_context!();
    {
        let w = &mut context.config_mut().app.windows[0];
        w.url = tauri::WebviewUrl::App("wizard.html".into());
        w.title = "Null IDE Setup".into();
        w.width = 640.0;
        w.height = 520.0;
    }
    tauri::Builder::default()
        .manage(Channel(Mutex::new(tx)))
        .manage(log)
        .manage(shared)
        .invoke_handler(tauri::generate_handler![
            window::action,
            window::diagnostics,
            window::quit,
            wizard_load,
            wizard_check_dir,
            wizard_start,
            wizard_launch
        ])
        .on_window_event(window::guard_close)
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            Ok(())
        })
        .run(context)
        .expect("failed to start the setup window");
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const MANIFEST: &str = r#"{"schema":1,
      "builtins":[{"id":"core","label":"Core","locked":true},{"id":"a","label":"A"},{"id":"b","label":"B","requires":["a"]}],
      "settings":[{"key":"editor.fontSize","label":"Size","kind":"number","default":13,"min":8,"max":40}],
      "marketplace":[]}"#;

    fn m() -> Manifest { builtins::parse(MANIFEST).unwrap() }
    fn cfg(excluded: &[&str]) -> InstallConfig {
        InstallConfig { excluded_builtins: excluded.iter().map(|s| s.to_string()).collect(), ..InstallConfig::default() }
    }
    fn fr(text: &str) -> FirstRun { first_run::from_json(text).unwrap() }

    #[test]
    fn choices_are_checked_against_the_manifest_before_anything_is_downloaded() {
        assert!(check_choices(Some(&m()), &cfg(&[]), None).is_ok());
        assert!(check_choices(Some(&m()), &cfg(&["b"]), None).is_ok());
        assert!(check_choices(Some(&m()), &cfg(&["core"]), None).unwrap_err().contains("core"));       // locked
        assert!(check_choices(Some(&m()), &cfg(&["a"]), None).unwrap_err().contains("stays installed")); // b needs it
        assert!(check_choices(Some(&m()), &cfg(&["ghost"]), None).is_err());
        let bad = fr(r#"{"schema":1,"settings":{"editor.fontSize":99}}"#);
        assert!(check_choices(Some(&m()), &cfg(&[]), Some(&bad)).is_err());
        let good = fr(r#"{"schema":1,"settings":{"editor.fontSize":14}}"#);
        assert!(check_choices(Some(&m()), &cfg(&[]), Some(&good)).is_ok());
    }

    #[test]
    fn a_release_without_a_manifest_cannot_honor_choices_but_installs_with_none() {
        assert!(check_choices(None, &cfg(&[]), None).is_ok());
        assert!(check_choices(None, &cfg(&[]), Some(&FirstRun::default())).is_ok());
        assert!(check_choices(None, &cfg(&["a"]), None).is_err());
        assert!(check_choices(None, &cfg(&[]), Some(&fr(r#"{"schema":1,"settings":{"editor.fontSize":14}}"#))).is_err());
    }

    #[test]
    fn the_install_folder_must_be_empty_or_missing_and_not_already_an_install() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(check_target_dir(&tmp.path().join("new")).is_ok());
        assert!(check_target_dir(tmp.path()).is_ok()); // empty
        fs::write(tmp.path().join("x.txt"), "x").unwrap();
        assert!(check_target_dir(tmp.path()).unwrap_err().contains("not empty"));
        let ours = tmp.path().join("ours");
        fs::create_dir_all(&ours).unwrap();
        fs::write(ours.join(".null-ide-install.json"), "{}").unwrap();
        assert!(check_target_dir(&ours).unwrap_err().contains("already installed"));
    }

    #[test]
    fn a_second_job_cannot_start_while_one_runs() {
        let running = AtomicBool::new(false);
        assert!(claim(&running));
        assert!(!claim(&running));
        running.store(false, Ordering::SeqCst);
        assert!(claim(&running));
    }
}
