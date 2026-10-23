#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod webview2;

use null_launcher::{fallback, meta, open, search, store};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, State};

/// Where the store lives and which `null.exe` to start. `NULL_LAUNCHER_USER_DATA` and
/// `NULL_LAUNCHER_NULL_EXE` override both, so `cargo run` can work against fake data.
struct Paths {
    user_data: PathBuf,
    null_exe: PathBuf,
}

impl Paths {
    fn resolve() -> Paths {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from))
            .unwrap_or_else(std::env::temp_dir);
        let user_data = std::env::var_os("NULL_LAUNCHER_USER_DATA")
            .map(PathBuf::from)
            .or_else(|| store::user_data_dir(&exe_dir, std::env::var_os("APPDATA").map(PathBuf::from).as_deref()))
            // No APPDATA and no portable data folder: nothing to read, the list is simply empty.
            .unwrap_or_else(std::env::temp_dir);
        let null_exe = std::env::var_os("NULL_LAUNCHER_NULL_EXE")
            .map(PathBuf::from)
            .unwrap_or_else(|| exe_dir.join("null.exe"));
        Paths { user_data, null_exe }
    }

    fn store(&self) -> PathBuf {
        store::store_path(&self.user_data)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    path: String,
    label: String,
    is_workspace_file: bool,
    pinned: bool,
    timestamp: serde_json::Number,
    stored_branch: Option<String>,
    stored_type: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Meta {
    branch: Option<String>,
    project_type: Option<String>,
    missing: bool,
}

/// The stored entry for `path`. The webview only ever names a path; what is acted on is what the file holds.
fn stored_entry(paths: &Paths, path: &str) -> Option<store::Entry> {
    let key = store::normalize(path);
    store::read(&paths.store()).into_iter().find(|e| store::normalize(&e.path) == key)
}

fn extra_string(entry: &store::Entry, key: &str) -> Option<String> {
    entry.extra.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

#[tauri::command]
fn search(query: String, paths: State<Paths>) -> Vec<Row> {
    let entries = store::display_order(store::read(&paths.store()));
    search::search(&entries, &query)
        .into_iter()
        .map(|i| {
            let e = &entries[i];
            Row {
                path: e.path.clone(),
                label: e.label.clone(),
                is_workspace_file: e.is_workspace_file,
                pinned: e.pinned,
                timestamp: e.timestamp.clone(),
                stored_branch: extra_string(e, "gitBranch"),
                stored_type: extra_string(e, "projectType"),
            }
        })
        .collect()
}

#[tauri::command]
async fn project_meta(path: String, paths: State<'_, Paths>) -> Result<Meta, String> {
    let Some(entry) = stored_entry(&paths, &path) else { return Ok(Meta::default()) };
    if !meta::exists(&entry) {
        return Ok(Meta { missing: true, ..Meta::default() });
    }
    let dir = meta::project_dir(&entry);
    Ok(Meta {
        branch: meta::git_branch(&dir),
        project_type: meta::project_type(&dir).map(str::to_string),
        missing: false,
    })
}

#[tauri::command]
fn open_project(path: String, paths: State<Paths>, app: tauri::AppHandle) -> Result<(), String> {
    let entry = stored_entry(&paths, &path).ok_or("That project is no longer in the list.")?;
    if !meta::exists(&entry) {
        return Err("That folder no longer exists.".into());
    }
    open::spawn_null(&paths.null_exe, &open::launch_args(&entry)).map_err(|e| format!("Could not start Null: {e}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn toggle_pin(path: String, paths: State<Paths>) -> Result<(), String> {
    let Some(entry) = stored_entry(&paths, &path) else { return Ok(()) };
    store::set_pinned(&paths.store(), &path, !entry.pinned).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_project(path: String, paths: State<Paths>) -> Result<(), String> {
    store::remove(&paths.store(), &path).map(|_| ()).map_err(|e| e.to_string())
}

/// The page has drawn its first rows; show the window now so it never flashes empty.
#[tauri::command]
fn ready(window: tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn close_launcher(app: tauri::AppHandle) {
    app.exit(0);
}

/// Centres the window on the monitor under the mouse; left centred on the primary one when Tauri cannot say.
fn centre_on_cursor_monitor(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(cursor) = app.cursor_position() else { return };
    let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) else { return };
    let Ok(size) = window.outer_size() else { return };
    let (area, origin) = (monitor.size(), monitor.position());
    let x = origin.x + (area.width as i32 - size.width as i32) / 2;
    let y = origin.y + (area.height as i32 - size.height as i32) / 2;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// A second start raises the first launcher instead of opening another. Returns the mutex handle to keep alive.
#[cfg(windows)]
fn single_instance() -> Option<windows::Win32::Foundation::HANDLE> {
    use windows::{
        core::w,
        Win32::{
            Foundation::{GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
            UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow},
        },
    };
    unsafe {
        let handle = CreateMutexW(None, false, w!("Local\\NullLauncher")).ok()?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            if let Ok(window) = FindWindowW(None, w!("Null Launcher")) {
                let _ = SetForegroundWindow(window);
            }
            std::process::exit(0);
        }
        Some(handle)
    }
}

/// Anything that stops the window from appearing: run the dashboard route instead and say why in the log.
fn fall_back(paths: &Paths, reason: &str) -> ! {
    fallback::log_failure(&paths.user_data, reason);
    let _ = open::spawn_null(&paths.null_exe, &fallback::fallback_args());
    std::process::exit(0);
}

fn main() {
    #[cfg(windows)]
    let _single = single_instance();

    let paths = Paths::resolve();
    #[cfg(windows)]
    if !webview2::installed() {
        fall_back(&paths, "WebView2 runtime not found");
    }

    let (user_data, null_exe) = (paths.user_data.clone(), paths.null_exe.clone());
    let result = tauri::Builder::default()
        .manage(paths)
        .invoke_handler(tauri::generate_handler![
            search, project_meta, open_project, toggle_pin, remove_project, ready, close_launcher
        ])
        .setup(|app| {
            centre_on_cursor_monitor(app);
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(e) = result {
        fall_back(&Paths { user_data, null_exe }, &format!("window failed to start: {e}"));
    }
}
