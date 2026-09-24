//! Headless pull — the same code the desktop window runs, with a terminal for
//! a front end.
//!
//! Useful three ways: it is what the scheduler can invoke, it is how the pull
//! path gets verified on a machine with no display, and it is the fastest way
//! to see whether a problem is in the data path or in the window.
//!
//!   pull                  yesterday, for EBIRD_REGIONS
//!   pull --days 30        backfill the whole API window
//!   pull --probe          one request; report what actually came back
//!   pull --json           emit raw events, one JSON object per line

use std::path::PathBuf;
use std::process::ExitCode;

use ebird_core::analyze;
use ebird_core::archive;
use ebird_core::client::EbirdClient;
use ebird_core::model::PullEvent;
use ebird_core::pull::{self, PullRequest};

fn arg_flag(name: &str) -> bool {
    std::env::args().any(|a| a == name)
}

fn arg_value(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn human_bytes(n: usize) -> String {
    const KB: f64 = 1024.0;
    let n = n as f64;
    if n < KB {
        format!("{n:.0} B")
    } else if n < KB * KB {
        format!("{:.1} KB", n / KB)
    } else {
        format!("{:.2} MB", n / (KB * KB))
    }
}

fn thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out.chars().rev().collect()
}

fn stamp() -> String {
    chrono::Local::now().format("%H:%M:%S%.3f").to_string()
}

/// Render one event the way the window does: a timestamp, a short tag, and a
/// line you can read without knowing the code.
fn print_event(ev: &PullEvent) {
    let t = stamp();
    match ev {
        PullEvent::Plan {
            regions,
            dates,
            requests,
            archive,
            endpoint,
            live,
        } => {
            println!(
                "{t}  PLAN   {requests} request(s): {} region(s) x {} day(s)",
                regions.len(),
                dates.len()
            );
            println!(
                "{t}         endpoint  {endpoint}{}",
                if *live {
                    ""
                } else {
                    "   [SYNTHETIC — not eBird]"
                }
            );
            println!("{t}         archive   {archive}");
        }
        PullEvent::Skip {
            region,
            date,
            reason,
        } => {
            println!("{t}  SKIP   {region}  {date}  — {reason}");
        }
        PullEvent::Request {
            region,
            date,
            method,
            url,
            auth,
        } => {
            println!("{t}  GET    {region}  {date}");
            println!("{t}         {method} {url}");
            println!("{t}         {auth}");
        }
        PullEvent::Response {
            status, bytes, ms, ..
        } => {
            println!("{t}  {status}    {} in {ms} ms", human_bytes(*bytes));
        }
        PullEvent::Parse { rows, species, .. } => {
            println!(
                "{t}  PARSE  {} rows, {} distinct species",
                thousands(*rows),
                species
            );
        }
        PullEvent::Privacy {
            fields,
            occurrences,
            ..
        } => {
            println!(
                "{t}  STRIP  removed {} ({} occurrence(s)) before disk",
                fields.join(", "),
                thousands(*occurrences)
            );
        }
        PullEvent::Write { path, bytes, .. } => {
            println!(
                "{t}  WRITE  {path}  {}  (tmp -> rename, atomic)",
                human_bytes(*bytes)
            );
        }
        PullEvent::Throttle { ms, why } => {
            println!("{t}  WAIT   {ms} ms — {why}");
        }
        PullEvent::Failed {
            region,
            date,
            reason,
        } => {
            println!("{t}  FAIL   {region}  {date}  — {reason}");
        }
        PullEvent::Done {
            fetched,
            skipped,
            failed,
            rows,
            ms,
        } => {
            println!("{}", "-".repeat(72));
            println!(
                "{t}  DONE   fetched {fetched}  skipped {skipped}  failed {failed}  in {ms} ms"
            );
            if *rows > 0 {
                println!("{t}         {} observations added", thousands(*rows));
            }
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    let loaded = ebird_core::load_env_file(&repo_root.join(".env.local"));

    let json_mode = arg_flag("--json");
    let days: u32 = arg_value("--days")
        .and_then(|d| d.parse().ok())
        .unwrap_or(1)
        .clamp(1, 30);

    let token = std::env::var("EBIRD_API_TOKEN").unwrap_or_default();
    let base = std::env::var("EBIRD_API_BASE").ok();

    if token.trim().is_empty() {
        eprintln!("\n  EBIRD_API_TOKEN is not set.");
        eprintln!(
            "  Get a free key for a dedicated Faunterra account: https://ebird.org/api/keygen"
        );
        eprintln!("  Then put it in .env.local — the scheduled job does not inherit your shell.\n");
        return ExitCode::FAILURE;
    }

    // `||` not `??`-style fallback: an unset variable often arrives as an empty
    // string, and an empty region list silently fetches nothing.
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

    let default_archive = repo_root.join("ebird-archive");
    let location = match archive::resolve(
        std::env::var("EBIRD_ARCHIVE_DIR").ok().as_deref(),
        &default_archive,
    ) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("\n  {e}\n");
            return ExitCode::FAILURE;
        }
    };

    let client = match EbirdClient::new(token, base) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("  {e}");
            return ExitCode::FAILURE;
        }
    };

    // Dump the archive rollup as JSON and stop. Used to capture a real state
    // for the interface preview, and handy for piping into anything else.
    if arg_flag("--summary") {
        let s = analyze::summarize(&location.dir, 12).unwrap_or_else(|e| {
            eprintln!("  {e}");
            std::process::exit(1);
        });
        println!("{}", serde_json::to_string_pretty(&s).unwrap_or_default());
        return ExitCode::SUCCESS;
    }

    if !json_mode {
        println!("\n  Faunterra Data Station — pull");
        if !loaded.is_empty() {
            println!("  env      {} from .env.local", loaded.join(", "));
        }
        if location.guarded {
            println!("  volume   external, verified mounted");
        }
        if !client.is_live() {
            println!(
                "  NOTE     talking to a local fixture, not eBird. Rows will be marked synthetic."
            );
        }
        println!("{}", "-".repeat(72));
    }

    // --probe spends exactly one request and reports what came back. Run it
    // once against the live API before any backfill: whether the endpoint
    // returns every observation or collapses to one row per species decides
    // what this archive can and cannot answer, and the docs do not say.
    if arg_flag("--probe") {
        let dates = pull::target_dates(1);
        let (iso, y, m, d) = &dates[0];
        println!("\n  Probing {} for {iso}\n", regions[0]);
        match client.historic(&regions[0], *y, *m, *d).await {
            Ok(f) => {
                let rows: Vec<serde_json::Value> =
                    serde_json::from_str(&f.body).unwrap_or_default();
                let species: std::collections::HashSet<&str> = rows
                    .iter()
                    .filter_map(|r| r.get("speciesCode").and_then(|v| v.as_str()))
                    .collect();
                println!("  transport        {} in {} ms", human_bytes(f.bytes), f.ms);
                println!("  rows returned    {}", thousands(rows.len()));
                println!("  distinct species {}", species.len());
                println!(
                    "  rows per species {}",
                    if species.is_empty() {
                        "n/a".into()
                    } else {
                        format!("{:.2}", rows.len() as f64 / species.len() as f64)
                    }
                );
                println!(
                    "\n  {}",
                    if !rows.is_empty() && species.len() == rows.len() {
                        "One row per species — this endpoint collapses to a species list.\n  Per-observation analysis would need the eBird Basic Dataset."
                    } else {
                        "Multiple rows per species — full per-observation detail is available."
                    }
                );
                if let Some(first) = rows.first().and_then(|r| r.as_object()) {
                    println!(
                        "\n  fields on first row:\n    {}",
                        first.keys().cloned().collect::<Vec<_>>().join(", ")
                    );
                }
                println!();
                return ExitCode::SUCCESS;
            }
            Err(e) => {
                eprintln!("  probe failed: {e}");
                return ExitCode::FAILURE;
            }
        }
    }

    let req = PullRequest {
        regions,
        days,
        archive_dir: location.dir.clone(),
    };
    let summary = pull::run(&client, &req, |ev| {
        if json_mode {
            // Stamp each line. A machine-readable event stream without a time
            // on it cannot be correlated with anything else that went wrong.
            let mut v = serde_json::to_value(&ev).unwrap_or_default();
            if let Some(obj) = v.as_object_mut() {
                obj.insert("ts".into(), serde_json::Value::String(stamp()));
            }
            println!("{v}");
        } else {
            print_event(&ev);
        }
    })
    .await;

    if !json_mode {
        if let Ok(s) = analyze::summarize(&location.dir, 10) {
            println!(
                "\n  Archive now holds {} day(s), {} record(s), {} location(s)",
                s.days,
                thousands(s.records),
                thousands(s.locations)
            );
            if s.any_synthetic {
                println!("  Contains synthetic rows from the fixture — not eBird data.");
            }
        }
        println!();
    }

    // Total failure is an error the scheduler should notice. A partial run is
    // not: some days genuinely have no data, and exiting non-zero there would
    // train whoever reads the logs to ignore them.
    if summary.failed > 0 && summary.fetched == 0 {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
