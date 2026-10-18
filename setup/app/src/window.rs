use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

use null_setup_core::{
    procs::Running,
    progress::{logs_dir, Ctx, Interact, LockedChoice, Logger, Progress},
    registrations::Registration,
    update::{self, Opts},
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::args::Args;

pub static FINISHED: AtomicBool = AtomicBool::new(false);
/// From "Installing" on, closing the window would leave a half-installed app; before that it just abandons the update.
pub static SWAPPING: AtomicBool = AtomicBool::new(false);

pub enum Action { Retry, ForceClose, Cancel }
pub struct Channel(pub Mutex<mpsc::Sender<Action>>);
struct Ready(Mutex<mpsc::Sender<()>>);

/// The page has registered its event listeners; earlier events would be dropped.
#[tauri::command]
fn ui_ready(r: State<Ready>) { let _ = r.0.lock().unwrap().send(()); }

#[tauri::command]
pub fn action(name: String, ch: State<Channel>) {
    let a = match name.as_str() { "retry" => Action::Retry, "force" => Action::ForceClose, _ => Action::Cancel };
    let _ = ch.0.lock().unwrap().send(a);
}

#[tauri::command]
pub fn diagnostics(log: State<Arc<Logger>>) -> String { log.tail(80) }

#[tauri::command]
pub fn quit(app: AppHandle) { app.exit(0) }

pub struct UiInteract<'a> { pub app: &'a AppHandle, pub rx: &'a mpsc::Receiver<Action> }

impl Interact for UiInteract<'_> {
    fn locked(&self, running: &[Running]) -> LockedChoice {
        let names: Vec<_> = running.iter().map(|r| r.name.clone()).collect();
        let _ = self.app.emit("locked", names);
        match self.rx.recv() {
            Ok(Action::Retry) => LockedChoice::Retry,
            Ok(Action::ForceClose) => LockedChoice::ForceClose,
            _ => LockedChoice::Cancel,
        }
    }
}

/// From "Installing" on, closing the window would leave a half-installed app.
pub fn guard_close(_: &tauri::Window, ev: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
        if SWAPPING.load(Ordering::SeqCst) && !FINISHED.load(Ordering::SeqCst) {
            api.prevent_close();
        }
    }
}

fn worker(app: AppHandle, args: Args, log: Arc<Logger>, rx: mpsc::Receiver<Action>, ready: mpsc::Receiver<()>) {
    let _ = ready.recv_timeout(Duration::from_secs(5));
    let emit = |p: Progress| {
        if p == Progress::Installing { SWAPPING.store(true, Ordering::SeqCst); }
        let _ = app.emit("progress", &p);
    };
    let interact = UiInteract { app: &app, rx: &rx };
    let ctx = Ctx { progress: &emit, log: &log, interact: &interact };
    let mut opts = Opts::standard(args.repo.clone(), args.tag.clone(), args.install_dir.clone());
    opts.launch = args.launch;
    let result = update::update(&opts, &ctx);
    FINISHED.store(true, Ordering::SeqCst);
    match result {
        Ok(o) if o.registration == Registration::NeedsReapproval => {} // the page stays open with its note
        Ok(_) => {
            std::thread::sleep(Duration::from_secs(2));
            app.exit(0);
        }
        Err(null_setup_core::Error::Busy) => {} // another update owns the install; leave it alone
        Err(_) => {
            // Failed was already emitted; the page offers Copy diagnostics and Close.
            // The user was promised "close, update, reopen": after a rolled-back update, reopen the old version.
            if args.launch && args.install_dir.join("null.exe").exists() {
                let _ = update::launch_ide(&args.install_dir);
            }
        }
    }
}

pub fn run_update(args: Args) -> i32 {
    let (tx, rx) = mpsc::channel::<Action>();
    let (ready_tx, ready_rx) = mpsc::channel::<()>();
    let mut ready_slot = Some(ready_rx);
    let log = Arc::new(Logger::open(&logs_dir()));
    let worker_log = log.clone();
    let mut slot = Some((args, rx));
    tauri::Builder::default()
        .manage(Channel(Mutex::new(tx)))
        .manage(Ready(Mutex::new(ready_tx)))
        .manage(log)
        .invoke_handler(tauri::generate_handler![action, diagnostics, quit, ui_ready])
        .on_window_event(guard_close)
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            if let (Some((args, rx)), Some(ready)) = (slot.take(), ready_slot.take()) {
                std::thread::spawn(move || worker(handle, args, worker_log, rx, ready));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the update window");
    0
}
