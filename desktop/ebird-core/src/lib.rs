//! Faunterra Data Station — core.
//!
//! Everything that touches eBird data, with no GUI dependency anywhere in the
//! tree. That constraint is load-bearing: it means this crate compiles, tests
//! and runs headless, so the data path can be verified on a machine with no
//! display — and a GUI failure can never be mistaken for a data failure.

pub mod analyze;
pub mod archive;
pub mod client;
pub mod model;
pub mod pull;
pub mod signals;

pub use client::{EbirdClient, DEFAULT_BASE};
pub use model::{DayFile, Observation, PullEvent};
pub use pull::{PullRequest, PullSummary};

/// Read an `.env.local`-style file into a map. Values already in the real
/// environment win, so `EBIRD_REGIONS=X cargo run` still overrides the file.
///
/// The token lives in a file rather than the environment because the scheduled
/// job does not inherit your shell — a key that works when you run it by hand
/// and vanishes at 09:00 is the single most common way this kind of automation
/// fails silently.
pub fn parse_env_file(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some(eq) = t.find('=') else { continue };
        let key = t[..eq].trim().trim_start_matches("export ").trim();
        let mut val = t[eq + 1..].trim();
        if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
            || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
        {
            val = &val[1..val.len() - 1];
        }
        if !key.is_empty() {
            out.push((key.to_string(), val.to_string()));
        }
    }
    out
}

/// Load `.env.local` without clobbering anything already set.
pub fn load_env_file(path: &std::path::Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut loaded = Vec::new();
    for (k, v) in parse_env_file(&text) {
        if std::env::var_os(&k).is_none() {
            std::env::set_var(&k, v);
            loaded.push(k);
        }
    }
    loaded
}

/// Where configuration and data live, decided the same way by every binary
/// and by the app.
///
/// WHY THIS IS SHARED
/// These five programs each resolved this differently once, and one of them
/// used `env!("CARGO_MANIFEST_DIR")` — a path baked in when the binary was
/// compiled. That works exactly until the binary is copied somewhere, or the
/// checkout moves, and then the scheduled job quietly reads no key and
/// archives nothing while reporting success. Agreement here is not tidiness;
/// it is the difference between one place to put the key and five.
///
/// Precedence:
///   1. `FAUNTERRA_ROOT` — explicit wins, always.
///   2. the current directory, if it holds a `.env.local` — this covers
///      working in a checkout, and launchd's WorkingDirectory.
///   3. `~/.faunterra` — the installed app, which has no useful cwd.
pub fn resolve_root() -> std::path::PathBuf {
    resolve_root_from(
        std::env::var_os("FAUNTERRA_ROOT").map(std::path::PathBuf::from),
        std::env::current_dir().ok(),
        home_dir(),
    )
}

/// The decision itself, with its inputs handed in so it can be tested.
pub fn resolve_root_from(
    explicit: Option<std::path::PathBuf>,
    cwd: Option<std::path::PathBuf>,
    home: Option<std::path::PathBuf>,
) -> std::path::PathBuf {
    if let Some(dir) = explicit.filter(|d| !d.as_os_str().is_empty()) {
        return dir;
    }
    if let Some(dir) = cwd.filter(|d| d.join(".env.local").is_file()) {
        return dir;
    }
    home.map(|h| h.join(".faunterra"))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(std::path::PathBuf::from)
}

/// Resolve the root and load its `.env.local`. What every binary calls first.
pub fn init() -> std::path::PathBuf {
    let root = resolve_root();
    load_env_file(&root.join(".env.local"));
    root
}
