//! The bridge between the window and `ebird-core`.
//!
//! Three rules hold this layer honest:
//!
//! 1. **The API token never crosses into the WebView.** The frontend asks for a
//!    pull; the Rust side reads the key from `.env.local` and uses it. The UI is
//!    told only whether a key is present and its masked tail.
//! 2. **Events are forwarded, never invented.** What the window shows is what
//!    the pull loop emitted, in the order it emitted it.
//! 3. **No business logic here.** If it decides something about data, it belongs
//!    in `ebird-core` where it can be tested without a display.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use ebird_core::{analyze, archive, client::EbirdClient, pull};

/// Where `.env.local` and the default archive live. Resolved once at startup:
/// a bundled `.app` has no useful working directory, so relying on `./` would
/// work in development and break the moment it ships.
struct Paths {
    root: PathBuf,
    archive: PathBuf,
}

#[derive(Default)]
struct Running(Mutex<bool>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    has_token: bool,
    token_hint: String,
    regions: Vec<String>,
    archive_dir: String,
    archive_external: bool,
    archive_problem: Option<String>,
    endpoint: String,
    live: bool,
    env_file: String,
    env_file_present: bool,
    days_archived: usize,
    running: bool,
}

fn token() -> String {
    std::env::var("EBIRD_API_TOKEN").unwrap_or_default().trim().to_string()
}

fn regions() -> Vec<String> {
    let raw = std::env::var("EBIRD_REGIONS").unwrap_or_default();
    let list: Vec<String> = raw
        .split(',')
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .collect();
    if list.is_empty() {
        vec!["IN".to_string()]
    } else {
        list
    }
}

fn endpoint() -> String {
    std::env::var("EBIRD_API_BASE").unwrap_or_else(|_| ebird_core::DEFAULT_BASE.to_string())
}

#[tauri::command]
fn status(paths: State<'_, Paths>, running: State<'_, Running>) -> Status {
    let tok = token();
    let resolved = archive::resolve(
        std::env::var("EBIRD_ARCHIVE_DIR").ok().as_deref(),
        &paths.archive,
    );
    let (dir, external, problem) = match resolved {
        Ok(l) => (l.dir.display().to_string(), l.guarded, None),
        Err(e) => (
            std::env::var("EBIRD_ARCHIVE_DIR").unwrap_or_default(),
            false,
            Some(e.to_string()),
        ),
    };
    let days = archive::index(std::path::Path::new(&dir))
        .map(|idx| {
            let mut all: Vec<String> = idx.into_iter().flat_map(|(_, d)| d).collect();
            all.sort_unstable();
            all.dedup();
            all.len()
        })
        .unwrap_or(0);

    let ep = endpoint();
    Status {
        has_token: !tok.is_empty(),
        token_hint: if tok.len() > 4 {
            format!("ends {}", &tok[tok.len() - 4..])
        } else {
            String::new()
        },
        regions: regions(),
        archive_dir: dir,
        archive_external: external,
        archive_problem: problem,
        live: ep == ebird_core::DEFAULT_BASE,
        endpoint: ep,
        env_file: paths.root.join(".env.local").display().to_string(),
        env_file_present: paths.root.join(".env.local").is_file(),
        days_archived: days,
        running: *running.0.lock().unwrap(),
    }
}

#[tauri::command]
fn summary(paths: State<'_, Paths>) -> Result<analyze::Summary, String> {
    let dir = archive::resolve(
        std::env::var("EBIRD_ARCHIVE_DIR").ok().as_deref(),
        &paths.archive,
    )
    .map_err(|e| e.to_string())?;
    analyze::summarize(&dir.dir, 12).map_err(|e| e.to_string())
}

/// Start a pull. Returns immediately; progress arrives as `pull-event`.
///
/// Guarded against a second concurrent run: two pulls writing the same day
/// would race on the same temp file, and the archive's whole value is that a
/// day is either absent or complete.
#[tauri::command]
async fn start_pull(
    app: AppHandle,
    days: u32,
    regions_override: Option<Vec<String>>,
) -> Result<(), String> {
    {
        let running = app.state::<Running>();
        let mut guard = running.0.lock().map_err(|_| "lock poisoned")?;
        if *guard {
            return Err("A pull is already running.".into());
        }
        *guard = true;
    }

    let result = run_pull(&app, days, regions_override).await;

    let running = app.state::<Running>();
    *running.0.lock().map_err(|_| "lock poisoned")? = false;
    result
}

async fn run_pull(
    app: &AppHandle,
    days: u32,
    regions_override: Option<Vec<String>>,
) -> Result<(), String> {
    let tok = token();
    if tok.is_empty() {
        return Err("No API key. Put EBIRD_API_TOKEN in .env.local.".into());
    }

    let paths = app.state::<Paths>();
    let location = archive::resolve(
        std::env::var("EBIRD_ARCHIVE_DIR").ok().as_deref(),
        &paths.archive,
    )
    .map_err(|e| e.to_string())?;

    let client = EbirdClient::new(tok, std::env::var("EBIRD_API_BASE").ok())
        .map_err(|e| e.to_string())?;

    let req = pull::PullRequest {
        regions: regions_override.filter(|r| !r.is_empty()).unwrap_or_else(regions),
        days: days.clamp(1, 30),
        archive_dir: location.dir,
    };

    let handle = app.clone();
    pull::run(&client, &req, move |ev| {
        // A window that has gone away is not an error worth aborting a pull
        // for — the archive write is the point, not the animation.
        let _ = handle.emit("pull-event", &ev);
    })
    .await;

    Ok(())
}

/// Show the archive in the system file manager, so "where did it go" is one
/// click rather than a path to copy.
#[tauri::command]
fn reveal_archive(paths: State<'_, Paths>) -> Result<(), String> {
    let dir = archive::resolve(
        std::env::var("EBIRD_ARCHIVE_DIR").ok().as_deref(),
        &paths.archive,
    )
    .map_err(|e| e.to_string())?
    .dir;
    let cmd = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(cmd)
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Prefer the repository beside the binary in development; fall back
            // to the user's home in a bundled app, where there is no repo.
            let root = std::env::var("FAUNTERRA_ROOT")
                .map(PathBuf::from)
                .ok()
                .or_else(|| {
                    std::env::current_dir()
                        .ok()
                        .filter(|d| d.join(".env.local").is_file())
                })
                .or_else(|| app.path().home_dir().ok().map(|h| h.join(".faunterra")))
                .unwrap_or_else(|| PathBuf::from("."));

            std::fs::create_dir_all(&root).ok();
            ebird_core::load_env_file(&root.join(".env.local"));

            let archive_dir = root.join("ebird-archive");
            app.manage(Paths { root, archive: archive_dir });
            app.manage(Running::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            status,
            summary,
            start_pull,
            reveal_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running Faunterra Data Station");
}
