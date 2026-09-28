#![deny(clippy::all)]

use std::sync::{Mutex, OnceLock};

use libloading::{Library, Symbol};
use napi_derive::napi;

// ─── Wooting C API types ──────────────────────────────────────────────────────

type FnInitialise   = unsafe extern "C" fn() -> i32;
type FnUninitialise = unsafe extern "C" fn() -> i32;
type FnReadAnalog   = unsafe extern "C" fn(u16) -> f32;

// ─── SDK handle ──────────────────────────────────────────────────────────────

struct WootingSdk {
    // Library must outlive the function pointers — keep it alive in the struct.
    _lib:         Library,
    initialise:   FnInitialise,
    uninitialise: FnUninitialise,
    read_analog:  FnReadAnalog,
}

// Safety: all access is serialised through the Mutex below.
unsafe impl Send for WootingSdk {}
unsafe impl Sync for WootingSdk {}

static SDK: OnceLock<Mutex<Option<WootingSdk>>> = OnceLock::new();

fn sdk_lock() -> &'static Mutex<Option<WootingSdk>> {
    SDK.get_or_init(|| Mutex::new(None))
}

// ─── napi exports ────────────────────────────────────────────────────────────

/// Load the Wooting SDK DLL and initialise it.
/// Returns true on success; safe to call multiple times (idempotent).
#[napi]
pub fn load(dll_path: String) -> bool {
    let mut guard = sdk_lock().lock().unwrap();
    if guard.is_some() {
        return true; // already loaded
    }

    match try_load(&dll_path) {
        Ok(sdk) => {
            *guard = Some(sdk);
            true
        }
        Err(_) => false,
    }
}

/// Read the analog depth (0.0–1.0) for a single HID key code.
/// Returns 0.0 if the SDK is not loaded or the key is not pressed.
#[napi]
pub fn read_analog(hid_code: u32) -> f64 {
    let guard = sdk_lock().lock().unwrap();
    match guard.as_ref() {
        Some(sdk) => clamp(unsafe { (sdk.read_analog)(hid_code as u16) }),
        None => 0.0,
    }
}

/// Read analog depths for a batch of HID key codes in a single call.
///
/// Prefer this over calling read_analog() in a loop — it holds the lock once
/// and avoids repeated FFI overhead. The returned Vec is in the same order as
/// the input slice.
#[napi]
pub fn read_analog_batch(hid_codes: Vec<u32>) -> Vec<f64> {
    let guard = sdk_lock().lock().unwrap();
    match guard.as_ref() {
        Some(sdk) => hid_codes
            .iter()
            .map(|&code| clamp(unsafe { (sdk.read_analog)(code as u16) }))
            .collect(),
        None => vec![0.0; hid_codes.len()],
    }
}

/// Uninitialise the SDK and unload the DLL.
/// Safe to call even if the SDK was never loaded.
#[napi]
pub fn unload() {
    let mut guard = sdk_lock().lock().unwrap();
    if let Some(sdk) = guard.take() {
        unsafe { (sdk.uninitialise)() };
        // sdk dropped here → _lib dropped → DLL unloaded
    }
}

// ─── Internal ────────────────────────────────────────────────────────────────

fn try_load(dll_path: &str) -> Result<WootingSdk, Box<dyn std::error::Error>> {
    // SAFETY: we're loading a known, trusted DLL.
    let lib = unsafe { Library::new(dll_path)? };

    // Copy each function pointer out of its Symbol so they don't borrow `lib`.
    // The pointers remain valid for the lifetime of `lib` (kept in the struct).
    let initialise: FnInitialise = unsafe {
        *lib.get::<FnInitialise>(b"wooting_analog_initialise\0")?
    };
    let uninitialise: FnUninitialise = unsafe {
        *lib.get::<FnUninitialise>(b"wooting_analog_uninitialise\0")?
    };
    let read_analog: FnReadAnalog = unsafe {
        *lib.get::<FnReadAnalog>(b"wooting_analog_read_analog\0")?
    };

    // Initialise the SDK; negative return = error code.
    let result = unsafe { initialise() };
    if result < 0 {
        return Err(format!("wooting_analog_initialise returned {result}").into());
    }

    Ok(WootingSdk {
        _lib: lib,
        initialise,
        uninitialise,
        read_analog,
    })
}

/// Clamp a raw SDK value to [0.0, 1.0].
/// The SDK returns negative values as error codes.
#[inline]
fn clamp(val: f32) -> f64 {
    if val < 0.0 { 0.0 } else { val.min(1.0) as f64 }
}
