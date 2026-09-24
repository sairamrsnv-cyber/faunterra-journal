//! Turn the archive into tidy tables.
//!
//! Output is disposable by design: the archive is the record, everything here
//! is re-derivable from it. Which is why it writes to its own directory and
//! never modifies a single archived day.
//!
//!   analyze                  → ./ebird-analysis
//!   analyze --out <dir>      somewhere else
//!   analyze --quiet          write the files, print nothing but the paths

use std::path::PathBuf;
use std::process::ExitCode;

use ebird_core::{analyze, archive};

fn flag(name: &str) -> bool {
    std::env::args().any(|a| a == name)
}
fn value(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
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

fn main() -> ExitCode {
    let root = std::env::var("FAUNTERRA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    ebird_core::load_env_file(&root.join(".env.local"));

    let location = match archive::resolve(
        std::env::var("EBIRD_ARCHIVE_DIR").ok().as_deref(),
        &root.join("ebird-archive"),
    ) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("\n  {e}\n");
            return ExitCode::FAILURE;
        }
    };

    let out = value("--out")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("ebird-analysis"));

    let quiet = flag("--quiet");
    if !quiet {
        println!("\n  Faunterra — archive analysis");
        println!("  archive  {}", location.dir.display());
        println!("  output   {}", out.display());
        println!("{}", "-".repeat(72));
    }

    let summary = match analyze::summarize(&location.dir, 15) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("  could not read the archive: {e}");
            return ExitCode::FAILURE;
        }
    };

    if summary.days == 0 {
        println!("\n  The archive is empty. Run `pull` first.\n");
        return ExitCode::SUCCESS;
    }

    let written = match analyze::export(&location.dir, &out) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("  could not write the analysis: {e}");
            return ExitCode::FAILURE;
        }
    };

    if !quiet {
        println!(
            "\n  {} day(s)  {} record(s)  {} species  {} location(s)",
            summary.days,
            thousands(summary.records),
            summary.species,
            thousands(summary.locations)
        );
        if let (Some(a), Some(b)) = (&summary.first_date, &summary.last_date) {
            println!("  {a} → {b}   regions: {}", summary.regions.join(", "));
        }
        if summary.any_synthetic {
            println!("\n  WARNING: this archive contains synthetic rows from the fixture.");
            println!(
                "  Those days are marked live:false. Do not publish anything derived from them."
            );
        }

        println!("\n  Most recorded\n");
        let max = summary
            .top_species
            .first()
            .map(|s| s.records)
            .unwrap_or(1)
            .max(1);
        for s in &summary.top_species {
            let bar = "#".repeat((s.records * 34 / max).max(1));
            println!(
                "  {:<32}{:>7}  {bar}",
                s.com_name.chars().take(32).collect::<String>(),
                thousands(s.records)
            );
        }
        println!("\n  Written\n");
    }
    for (name, rows) in &written {
        println!(
            "  {:<24}{:>10} row(s)   {}",
            name,
            thousands(*rows),
            out.join(name).display()
        );
    }
    if !quiet {
        // Printed every run, deliberately. A count without this sentence
        // invites a conclusion it cannot support.
        println!("\n  {}\n", analyze::EFFORT_CAVEAT);
    }
    ExitCode::SUCCESS
}
