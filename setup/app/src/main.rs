#![cfg_attr(windows, windows_subsystem = "windows")]

mod args;
mod headless;
mod relocate;
mod window;

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
        Mode::Update => {
            relocate::maybe_relocate(&args);
            window::run_update(args)
        }
    };
    std::process::exit(code);
}
