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

static FINISHED: AtomicBool = AtomicBool::new(false);

enum Action { Retry, ForceClose, Cancel }
struct Channel(Mutex<mpsc::Sender<Action>>);

#[tauri::command]
fn action(name: String, ch: State<Channel>) {
    let a = match name.as_str() { "retry" => Action::Retry, "force" => Action::ForceClose, _ => Action::Cancel };
    let _ = ch.0.lock().unwrap().send(a);
}

#[tauri::command]
fn diagnostics(log: State<Arc<Logger>>) -> String { log.tail(80) }

#[tauri::command]
fn quit(app: AppHandle) { app.exit(0) }

struct UiInteract<'a> { app: &'a AppHandle, rx: &'a mpsc::Receiver<Action> }

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

fn worker(app: AppHandle, args: Args, log: Arc<Logger>, rx: mpsc::Receiver<Action>) {
    let emit = |p: Progress| { let _ = app.emit("progress", &p); };
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
        Err(_) => {} // Failed was already emitted; the page offers Copy diagnostics and Close
    }
}

pub fn run_update(args: Args) -> i32 {
    let (tx, rx) = mpsc::channel::<Action>();
    let log = Arc::new(Logger::open(&logs_dir()));
    let worker_log = log.clone();
    let mut slot = Some((args, rx));
    tauri::Builder::default()
        .manage(Channel(Mutex::new(tx)))
        .manage(log)
        .invoke_handler(tauri::generate_handler![action, diagnostics, quit])
        // Closing the window mid-swap would leave a half-installed app.
        .on_window_event(|_, ev| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                if !FINISHED.load(Ordering::SeqCst) {
                    api.prevent_close();
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            if let Some((args, rx)) = slot.take() {
                std::thread::spawn(move || worker(handle, args, worker_log, rx));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the update window");
    0
}
