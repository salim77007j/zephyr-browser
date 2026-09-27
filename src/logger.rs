// Zephyr Browser — minimal file/stderr logger (no external deps)
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::{Mutex, OnceLock};

static LOGGER: OnceLock<Mutex<Option<File>>> = OnceLock::new();
static VERBOSE: OnceLock<bool> = OnceLock::new();

pub fn init(log_path: Option<&std::path::Path>, verbose: bool) {
    let _ = VERBOSE.set(verbose);
    let file = log_path.and_then(|p| {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        OpenOptions::new().create(true).append(true).open(p).ok()
    });
    let _ = LOGGER.set(Mutex::new(file));
}

fn ts() -> String {
    let ms = crate::util::now_ms();
    let secs = ms / 1000;
    let frac = ms % 1000;
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe as i64 + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        y, mo, d, h, m, s, frac
    )
}

pub fn log(level: &str, tag: &str, msg: &str) {
    let line = format!("{} {:5} [{}] {}\n", ts(), level, tag, msg);
    if level != "DEBUG" || *VERBOSE.get_or_init(&|| false) {
        eprint!("{}", line);
    }
    if let Some(m) = LOGGER.get() {
        if let Ok(mut guard) = m.lock() {
            if let Some(f) = guard.as_mut() {
                let _ = f.write_all(line.as_bytes());
            }
        }
    }
}

#[macro_export]
macro_rules! zlog {
    ($lvl:expr, $tag:expr, $($arg:tt)*) => {
        $crate::logger::log($lvl, $tag, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! zinfo {
    ($tag:expr, $($arg:tt)*) => { $crate::logger::log("INFO", $tag, &format!($($arg)*)) };
}

#[macro_export]
macro_rules! zwarn {
    ($tag:expr, $($arg:tt)*) => { $crate::logger::log("WARN", $tag, &format!($($arg)*)) };
}

#[macro_export]
macro_rules! zerror {
    ($tag:expr, $($arg:tt)*) => { $crate::logger::log("ERROR", $tag, &format!($($arg)*)) };
}

#[macro_export]
macro_rules! zdebug {
    ($tag:expr, $($arg:tt)*) => { $crate::logger::log("DEBUG", $tag, &format!($($arg)*)) };
}
