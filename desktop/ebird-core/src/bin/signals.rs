//! The journal's field-signals digest, written for the website build.
//!
//! Replaces the Node pass that used to run inside the curation script. It is a
//! separate binary rather than a mode of `pull` because the two do genuinely
//! different jobs: `pull` builds a private archive that must never lose a day,
//! this rewrites a public page that may safely skip a run.
//!
//!   signals                      write data/ebird-signals.json
//!   signals --out <path>         somewhere else
//!   signals --stdout             print it and write nothing
//!
//! Exits 0 even when it produces nothing. A missing key or an unreachable API
//! is not a build failure — it means leave the page as it is. Only a refusal to
//! write a file we decided to write is an error.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ebird_core::client::EbirdClient;
use ebird_core::signals;

fn flag(name: &str) -> bool {
    std::env::args().any(|a| a == name)
}

fn value(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

/// Write atomically. This file is read by a static site build; a half-written
/// JSON blob would fail the build with a parse error at the least useful moment.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

#[tokio::main]
async fn main() -> ExitCode {
    let root = ebird_core::init();

    println!("\n  eBird field signals");

    let token = std::env::var("EBIRD_API_TOKEN")
        .unwrap_or_default()
        .trim()
        .to_string();
    if token.is_empty() {
        println!("  EBIRD_API_TOKEN not set — skipping. This is not an error.\n");
        return ExitCode::SUCCESS;
    }

    // `||`-style fallback rather than a null check: an unset GitHub Actions
    // variable arrives as an empty string, and treating that as "configured"
    // would silently fetch nothing.
    let regions: Vec<String> = std::env::var("EBIRD_REGIONS")
        .unwrap_or_default()
        .split(',')
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .collect();
    let regions = if regions.is_empty() {
        vec!["IN".to_string()]
    } else {
        regions
    };

    let client = match EbirdClient::new(token, std::env::var("EBIRD_API_BASE").ok()) {
        Ok(c) => c,
        Err(e) => {
            println!("  could not build an HTTP client: {e} — skipping\n");
            return ExitCode::SUCCESS;
        }
    };
    if !client.is_live() {
        println!(
            "  NOTE: endpoint is {} — not eBird. Do not publish this.",
            client.base()
        );
    }

    let Some(store) = signals::fetch(&client, &regions).await else {
        println!("  No signals this run — the existing page is left unchanged.\n");
        return ExitCode::SUCCESS;
    };

    let json = match serde_json::to_vec_pretty(&store) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("  could not serialise the digest: {e}");
            return ExitCode::FAILURE;
        }
    };

    if flag("--stdout") {
        println!("{}", String::from_utf8_lossy(&json));
        return ExitCode::SUCCESS;
    }

    let out = value("--out")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("data").join("ebird-signals.json"));

    if let Err(e) = write_atomic(&out, &json) {
        eprintln!("  could not write {}: {e}", out.display());
        return ExitCode::FAILURE;
    }

    let notable: usize = store.regions.iter().map(|r| r.notable_count).sum();
    println!(
        "\n  {notable} notable species across {} region(s) → {}\n",
        store.regions.len(),
        out.display()
    );
    ExitCode::SUCCESS
}
