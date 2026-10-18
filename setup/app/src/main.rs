#![cfg_attr(windows, windows_subsystem = "windows")]

mod args;
mod cli;
mod headless;
mod relocate;
mod window;
mod wizard;

use args::Mode;

fn main() {
    let args = match args::parse(std::env::args().skip(1)) {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("null-setup: {msg}");
            std::process::exit(2);
        }
    };
    let code = match args.mode {
        Mode::Prefetch => headless::prefetch(&args),
        Mode::Recover => headless::recover(&args),
        Mode::TrustCert => headless::trust_cert(&args), // no relocation, no log in the install: a few lines run elevated
        Mode::Update => {
            // Never keep a handle on the install dir (inherited cwd): the swap renames it.
            let _ = std::env::set_current_dir(null_setup_core::local_app_data());
            if !null_setup_core::webview2::installed() {
                null_setup_core::webview2::show_missing();
                std::process::exit(1);
            }
            relocate::maybe_relocate(&args);
            window::run_update(args)
        }
        Mode::Wizard => {
            if !null_setup_core::webview2::installed() {
                null_setup_core::webview2::show_missing();
                std::process::exit(1);
            }
            let _ = std::env::set_current_dir(null_setup_core::local_app_data());
            relocate::maybe_relocate(&args); // started from <install>\setup (Add/Remove Programs): the swap or the deletion would hit our own exe
            wizard::run(args)
        }
        Mode::Install | Mode::Modify | Mode::Repair | Mode::Uninstall => {
            let _ = std::env::set_current_dir(null_setup_core::local_app_data());
            relocate::maybe_relocate(&args); // a copy under <install>\setup would block the swap or the deletion
            cli::run(&args)
        }
    };
    std::process::exit(code);
}
