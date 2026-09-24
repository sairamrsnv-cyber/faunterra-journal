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
