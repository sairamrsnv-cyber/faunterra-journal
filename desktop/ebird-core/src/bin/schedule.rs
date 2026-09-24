//! Install the daily pull as a launchd agent.
//!
//! WHY LAUNCHD AND NOT CRON
//! cron does not run what it missed. Close the lid at 23:00 and a 09:00 job
//! simply never happened — and for an archive whose whole value is continuity,
//! against an API that will not sell you back a missed day, that is the one
//! failure mode worth engineering against. launchd runs a missed
//! StartCalendarInterval job when the machine wakes.
//!
//!   schedule --print        show the plist, write nothing
//!   schedule --check        preflight only
//!   schedule --install      write it and load it
//!   schedule --status       ask launchd what it thinks
//!   schedule --uninstall    unload and remove
//!
//! NO SECRETS IN THE PLIST. `~/Library/LaunchAgents` ends up in Time Machine
//! and in any backup of the home directory. The agent points at the binary and
//! a working directory; the key stays in `.env.local`, which the binary reads
//! itself and which should be chmod 600.

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

pub const LABEL: &str = "com.faunterra.ebird";

struct Config {
    program: PathBuf,
    working_dir: PathBuf,
    days: u32,
    hour: u32,
    minute: u32,
    out_log: PathBuf,
    err_log: PathBuf,
}

fn flag(name: &str) -> bool {
    std::env::args().any(|a| a == name)
}
fn value(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}
fn num(name: &str, default: u32) -> u32 {
    value(name).and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// XML text escaping. A path with an ampersand in it would otherwise produce a
/// plist that launchd rejects with a message that names nothing useful.
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn plist(c: &Config) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>

  <!-- No environment variables here, and no API key. This file is backed up. -->
  <key>ProgramArguments</key>
  <array>
    <string>{program}</string>
    <string>--days</string>
    <string>{days}</string>
  </array>

  <!-- The binary reads .env.local from here. -->
  <key>WorkingDirectory</key>
  <string>{wd}</string>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>{hour}</integer>
    <key>Minute</key><integer>{minute}</integer>
  </dict>

  <!-- Run a missed job when the machine wakes. This is the entire reason for
       preferring launchd to cron: a closed lid must not cost a day. -->
  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>{out}</string>
  <key>StandardErrorPath</key>
  <string>{err}</string>

  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
</dict>
</plist>
"#,
        label = esc(LABEL),
        program = esc(&c.program.display().to_string()),
        days = c.days,
        wd = esc(&c.working_dir.display().to_string()),
        hour = c.hour,
        minute = c.minute,
        out = esc(&c.out_log.display().to_string()),
        err = esc(&c.err_log.display().to_string()),
    )
}

struct Check {
    ok: bool,
    what: &'static str,
    detail: String,
}

fn preflight(c: &Config) -> Vec<Check> {
    let mut out = Vec::new();
    let mut add =
        |ok: bool, what: &'static str, detail: String| out.push(Check { ok, what, detail });

    add(
        c.program.is_file(),
        "pull binary present",
        if c.program.is_file() {
            c.program.display().to_string()
        } else {
            format!(
                "{} — run `cargo build --release` first",
                c.program.display()
            )
        },
    );

    let env_file = c.working_dir.join(".env.local");
    add(
        env_file.is_file(),
        ".env.local present",
        if env_file.is_file() {
            env_file.display().to_string()
        } else {
            format!("missing — create {}", env_file.display())
        },
    );

    // Check the FILE, not the environment. A scheduled job does not inherit
    // your shell, so a key exported in .zshrc works by hand and vanishes at
    // 09:00 — the single most common way this fails silently.
    let in_file = std::fs::read_to_string(&env_file)
        .map(|t| {
            ebird_core::parse_env_file(&t)
                .iter()
                .any(|(k, v)| k == "EBIRD_API_TOKEN" && !v.trim().is_empty())
        })
        .unwrap_or(false);
    add(
        in_file,
        "EBIRD_API_TOKEN in the file",
        if in_file {
            "found".into()
        } else {
            "the scheduled job does not inherit your shell — it must be in .env.local".into()
        },
    );

    // Permissions, because a key readable by every process on the machine is a
    // key you should assume is known.
    #[cfg(unix)]
    if env_file.is_file() {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&env_file)
            .map(|m| m.permissions().mode() & 0o777)
            .unwrap_or(0);
        add(
            mode & 0o077 == 0,
            ".env.local not world/group readable",
            if mode & 0o077 == 0 {
                format!("{mode:o}")
            } else {
                format!("{mode:o} — run: chmod 600 {}", env_file.display())
            },
        );
    }

    match ebird_core::archive::resolve(
        std::env::var("EBIRD_ARCHIVE_DIR").ok().as_deref(),
        &c.working_dir.join("ebird-archive"),
    ) {
        Ok(l) => add(true, "archive location usable", l.dir.display().to_string()),
        Err(e) => add(false, "archive location usable", e.to_string()),
    }

    let mac = cfg!(target_os = "macos");
    add(
        mac,
        "platform is macOS",
        if mac {
            "launchd available".into()
        } else {
            format!(
                "{} — see --print for the plist; on Linux use a systemd timer with Persistent=true",
                std::env::consts::OS
            )
        },
    );

    out
}

fn plist_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    Path::new(&home)
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist"))
}

fn launchctl(args: &[&str]) -> String {
    Command::new("launchctl")
        .args(args)
        .output()
        .map(|o| {
            let s = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            if s.trim().is_empty() {
                "(no output)".into()
            } else {
                s
            }
        })
        .unwrap_or_else(|e| format!("launchctl unavailable: {e}"))
}

fn uid() -> String {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn main() -> ExitCode {
    // The pull binary sits beside this one — same target directory, same build.
    // Resolving it this way keeps the plist correct whether you built debug or
    // release, and `--program` covers anything unusual.
    let here = std::env::current_exe().ok();
    let program = value("--program").map(PathBuf::from).unwrap_or_else(|| {
        here.as_ref()
            .and_then(|p| p.parent())
            .map(|d| d.join("pull"))
            .unwrap_or_else(|| PathBuf::from("pull"))
    });

    let working_dir = std::env::var("FAUNTERRA_ROOT")
        .map(PathBuf::from)
        .or_else(|_| std::env::current_dir())
        .unwrap_or_else(|_| PathBuf::from("."));

    let logs = working_dir.join("logs");
    let cfg = Config {
        program,
        working_dir: working_dir.clone(),
        // One day is the routine case. The window is 30, so anything larger is
        // a backfill you should run by hand and watch.
        days: num("--days", 1).clamp(1, 30),
        hour: num("--hour", 9).min(23),
        minute: num("--minute", 15).min(59),
        out_log: logs.join("ebird-pull.log"),
        err_log: logs.join("ebird-pull.err.log"),
    };

    if flag("--print") {
        print!("{}", plist(&cfg));
        return ExitCode::SUCCESS;
    }

    if flag("--status") {
        let p = plist_path();
        println!(
            "\n  agent file : {}{}",
            p.display(),
            if p.is_file() {
                ""
            } else {
                "   (not installed)"
            }
        );
        println!(
            "  launchctl  :\n{}",
            launchctl(&["print", &format!("gui/{}/{LABEL}", uid())])
        );
        return ExitCode::SUCCESS;
    }

    if flag("--uninstall") {
        let p = plist_path();
        if !p.is_file() {
            println!("\n  Nothing installed at {}\n", p.display());
            return ExitCode::SUCCESS;
        }
        println!(
            "{}",
            launchctl(&["bootout", &format!("gui/{}/{LABEL}", uid())])
        );
        match std::fs::remove_file(&p) {
            Ok(_) => println!("  Removed {}\n", p.display()),
            Err(e) => {
                eprintln!("  Could not remove {}: {e}\n", p.display());
                return ExitCode::FAILURE;
            }
        }
        return ExitCode::SUCCESS;
    }

    let checks = preflight(&cfg);
    println!("\n  Daily pull — preflight\n");
    for c in &checks {
        println!(
            "  {:<6}{:<34}{}",
            if c.ok { "ok" } else { "FAIL" },
            c.what,
            c.detail
        );
    }
    let failed = checks.iter().filter(|c| !c.ok).count();
    println!();

    if flag("--check") {
        return if failed == 0 {
            println!("  Ready to install.\n");
            ExitCode::SUCCESS
        } else {
            println!("  {failed} check(s) failed.\n");
            ExitCode::FAILURE
        };
    }

    if !flag("--install") {
        println!("  Nothing done. Pass --install to write the agent, or --print to see it.\n");
        return ExitCode::SUCCESS;
    }

    // Refuse to install a job that cannot work. An agent that fails silently
    // every morning is worse than no agent: you believe you have an archive.
    if failed > 0 {
        println!("  Refusing to install with {failed} failing check(s).\n");
        return ExitCode::FAILURE;
    }

    if let Err(e) = std::fs::create_dir_all(&logs) {
        eprintln!("  Could not create {}: {e}", logs.display());
        return ExitCode::FAILURE;
    }
    let p = plist_path();
    if let Some(parent) = p.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("  Could not create {}: {e}", parent.display());
            return ExitCode::FAILURE;
        }
    }
    if let Err(e) = std::fs::write(&p, plist(&cfg)) {
        eprintln!("  Could not write {}: {e}", p.display());
        return ExitCode::FAILURE;
    }

    println!("  Wrote {}", p.display());
    let g = format!("gui/{}", uid());
    println!("{}", launchctl(&["bootout", &format!("{g}/{LABEL}")]));
    println!(
        "{}",
        launchctl(&["bootstrap", &g, &p.display().to_string()])
    );
    println!(
        "  Installed. Daily at {:02}:{:02}, {} day(s) back.",
        cfg.hour, cfg.minute, cfg.days
    );
    println!("  Run it now without waiting:  launchctl kickstart -k {g}/{LABEL}");
    println!("  Logs: {}\n", cfg.out_log.display());
    ExitCode::SUCCESS
}
