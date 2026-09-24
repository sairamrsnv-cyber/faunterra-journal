//! Tests for the parts that must not be wrong.
//!
//! The bias here is toward the failures that are expensive and silent: an
//! archive that quietly stops writing, a name that survives to disk, a day
//! written half-way. A wrong colour in the window costs an afternoon; a hole
//! in the archive cannot be repaired at any price.

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};

use ebird_core::{analyze, archive, client::EbirdClient, model::Observation, pull};

fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "ebird-core-test-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&d).unwrap();
    d
}

// ── env file ──────────────────────────────────────────────

#[test]
fn env_file_parses_comments_quotes_and_exports() {
    let pairs = ebird_core::parse_env_file(
        "# a comment\n\
         EBIRD_API_TOKEN=abc123\n\
         export EBIRD_REGIONS=\"IN-KL, IN-KA\"\n\
         QUOTED='single'\n\
         \n\
         NOEQUALS\n\
         SPACED  =  padded  \n",
    );
    let get = |k: &str| pairs.iter().find(|(a, _)| a == k).map(|(_, b)| b.clone());
    assert_eq!(get("EBIRD_API_TOKEN").as_deref(), Some("abc123"));
    assert_eq!(get("EBIRD_REGIONS").as_deref(), Some("IN-KL, IN-KA"));
    assert_eq!(get("QUOTED").as_deref(), Some("single"));
    assert_eq!(get("SPACED").as_deref(), Some("padded"));
    assert!(get("NOEQUALS").is_none(), "a line with no '=' is not a setting");
}

// ── sanitisation ──────────────────────────────────────────

#[test]
fn sanitize_removes_identity_and_reports_only_what_was_there() {
    let raw = r#"{"speciesCode":"houcro1","comName":"House Crow",
                  "userDisplayName":"A Birder","obsId":"OBS1","subId":"S1"}"#;
    let mut obs: Observation = serde_json::from_str(raw).unwrap();

    let removed = obs.sanitize();
    assert_eq!(removed, vec!["userDisplayName"],
        "must report the field it actually removed, not the candidate list");

    let back = serde_json::to_string(&obs).unwrap();
    assert!(!back.contains("userDisplayName"));
    // Fields we do not model must survive: the API window is one-way, and a
    // field dropped today cannot be re-fetched later.
    assert!(back.contains("OBS1") && back.contains("S1"),
        "unmodelled fields must be preserved verbatim");
    assert!(back.contains("houcro1"));
}

#[test]
fn sanitize_is_a_no_op_when_there_is_nothing_to_remove() {
    let mut obs: Observation = serde_json::from_str(r#"{"speciesCode":"commyn"}"#).unwrap();
    assert!(obs.sanitize().is_empty());
}

// ── archive ───────────────────────────────────────────────

#[test]
fn archive_defaults_to_the_fallback_when_unset_or_blank() {
    let fallback = tmpdir("fallback");
    for raw in [None, Some(""), Some("   ")] {
        let loc = archive::resolve(raw, &fallback).unwrap();
        assert_eq!(loc.dir, fallback);
        assert!(!loc.guarded);
    }
}

#[test]
fn archive_refuses_a_mount_path_that_is_not_actually_mounted() {
    // A folder we create under a mount root is, by construction, on the same
    // device as `/` — exactly the unplugged-drive case.
    let fake = "/mnt/faunterra-test-not-a-real-volume";
    if fs::create_dir_all(format!("{fake}/ebird-archive")).is_err() {
        eprintln!("skipped: cannot write under /mnt here");
        return;
    }
    let err = archive::resolve(Some(&format!("{fake}/ebird-archive")), &tmpdir("x"))
        .expect_err("a folder on the boot disk must not pass as a mounted volume");
    let msg = err.to_string();
    assert!(msg.contains("not a mounted volume"), "got: {msg}");
    assert!(msg.contains("Refusing to write"), "the refusal must be explicit: {msg}");
    let _ = fs::remove_dir_all(fake);
}

#[test]
fn archive_allows_an_ordinary_path_outside_any_mount_root() {
    let d = tmpdir("plain");
    let loc = archive::resolve(Some(d.to_str().unwrap()), &tmpdir("unused")).unwrap();
    assert_eq!(loc.dir, d);
    assert!(!loc.guarded, "an ordinary directory is not a guarded volume");
}

#[test]
fn writes_are_atomic_and_leave_no_temp_file_behind() {
    let dir = tmpdir("atomic");
    let day = ebird_core::DayFile {
        region: "IN".into(),
        date: "2026-01-02".into(),
        pulled_at: "2026-01-03T00:00:00Z".into(),
        source: "test".into(),
        attribution: "test".into(),
        live: false,
        row_count: 0,
        observations: vec![],
    };
    let (path, bytes) = archive::write_day(&dir, &day).unwrap();
    assert!(path.is_file() && bytes > 0);
    assert!(!dir.join("IN/2026-01-02.json.tmp").exists(), "temp file must be renamed away");
    assert!(archive::has_day(&dir, "IN", "2026-01-02"));
    assert!(!archive::has_day(&dir, "IN", "2026-01-03"));

    let idx = archive::index(&dir).unwrap();
    assert_eq!(idx, vec![("IN".to_string(), vec!["2026-01-02".to_string()])]);
}

// ── dates ─────────────────────────────────────────────────

#[test]
fn target_dates_start_at_yesterday_and_never_include_today() {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let dates = pull::target_dates(30);
    assert_eq!(dates.len(), 30);
    assert!(!dates.iter().any(|(iso, ..)| *iso == today),
        "today is still filling up; archiving it would store a partial day as final");
    // Newest first, strictly descending.
    let isos: Vec<&String> = dates.iter().map(|(i, ..)| i).collect();
    let mut sorted = isos.clone();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    assert_eq!(isos, sorted);
}

// ── client ────────────────────────────────────────────────

#[test]
fn token_is_masked_down_to_its_last_four() {
    let c = EbirdClient::new("abcdefghijkl", None).unwrap();
    let m = c.masked_token();
    assert_eq!(m, "********ijkl");
    assert!(!m.contains("abcdef"), "no part of the key beyond the tail may appear");
    assert_eq!(EbirdClient::new("abc", None).unwrap().masked_token(), "****");
}

#[test]
fn live_is_true_only_for_the_real_endpoint() {
    assert!(EbirdClient::new("k", None).unwrap().is_live());
    assert!(EbirdClient::new("k", Some(ebird_core::DEFAULT_BASE.into())).unwrap().is_live());
    assert!(!EbirdClient::new("k", Some("http://127.0.0.1:8788/v2".into())).unwrap().is_live());
}

#[test]
fn request_url_carries_the_parameters_the_archive_depends_on() {
    let c = EbirdClient::new("k", Some("http://x/v2".into())).unwrap();
    let u = c.historic_url("IN-KL", 2026, 9, 3);
    assert!(u.starts_with("http://x/v2/data/obs/IN-KL/historic/2026/9/3?"));
    assert!(u.contains("detail=full"), "without full detail there is no location or count");
    assert!(u.contains("includeProvisional=true"));
    assert!(u.contains("maxResults=10000"));
}

// ── end to end ────────────────────────────────────────────

struct Fixture(Child);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start_fixture(port: u16) -> Option<Fixture> {
    let child = Command::new(env!("CARGO_BIN_EXE_fixture"))
        .arg(port.to_string())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    // Poll rather than sleep a fixed amount.
    for _ in 0..80 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Some(Fixture(child));
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    None
}

#[tokio::test]
async fn full_pull_writes_clean_days_and_second_run_spends_nothing() {
    let port = 18_791;
    let Some(_fx) = start_fixture(port) else {
        eprintln!("skipped: fixture would not start");
        return;
    };
    let dir = tmpdir("e2e");
    let client = EbirdClient::new("test-token-long-enough", Some(format!("http://127.0.0.1:{port}/v2"))).unwrap();
    let req = pull::PullRequest {
        regions: vec!["IN".into()],
        days: 2,
        archive_dir: dir.clone(),
    };

    let mut kinds = Vec::new();
    let first = pull::run(&client, &req, |ev| {
        kinds.push(serde_json::to_value(&ev).unwrap()["kind"].as_str().unwrap().to_string());
    })
    .await;

    assert_eq!(first.fetched, 2, "two days requested, two days written");
    assert_eq!(first.failed, 0);
    assert!(first.rows > 0);
    assert!(kinds.contains(&"privacy".to_string()), "a strip must be reported");
    assert!(kinds.contains(&"write".to_string()));

    // Nothing identifying may survive to disk, in any file.
    for (region, days) in archive::index(&dir).unwrap() {
        for date in days {
            let raw = fs::read_to_string(archive::day_path(&dir, &region, &date)).unwrap();
            assert!(!raw.contains("userDisplayName"), "{region}/{date} leaked a contributor name");
            let parsed: ebird_core::DayFile = serde_json::from_str(&raw).unwrap();
            assert!(!parsed.live, "fixture rows must be marked synthetic in the file itself");
            assert_eq!(parsed.row_count, parsed.observations.len());
        }
    }

    // The whole value of the archive is continuity, so a re-run must be free.
    let second = pull::run(&client, &req, |_| {}).await;
    assert_eq!(second.fetched, 0);
    assert_eq!(second.skipped, 2, "an archived day must never be re-fetched");
    assert_eq!(second.rows, 0);
}

#[tokio::test]
async fn a_rejected_key_fails_loudly_and_writes_nothing() {
    let port = 18_792;
    let Some(_fx) = start_fixture(port) else {
        eprintln!("skipped: fixture would not start");
        return;
    };
    let dir = tmpdir("badkey");
    // The fixture rejects anything under six characters, as the real API
    // rejects a wrong key: with a 403, not an empty list.
    let client = EbirdClient::new("xx", Some(format!("http://127.0.0.1:{port}/v2"))).unwrap();
    let req = pull::PullRequest { regions: vec!["IN".into()], days: 1, archive_dir: dir.clone() };

    let mut reasons = Vec::new();
    let sum = pull::run(&client, &req, |ev| {
        if let ebird_core::PullEvent::Failed { reason, .. } = &ev {
            reasons.push(reason.clone());
        }
    })
    .await;

    assert_eq!(sum.fetched, 0);
    assert_eq!(sum.failed, 1);
    assert_eq!(reasons.len(), 1);
    assert!(reasons[0].contains("403") && reasons[0].contains("EBIRD_API_TOKEN"),
        "the error must name the fix, not just the status: {}", reasons[0]);
    assert!(archive::index(&dir).unwrap().is_empty(),
        "a failed day must leave no file — a hole is recoverable, a bad day is not");
}

#[tokio::test]
async fn summary_counts_all_species_not_just_the_top_slice() {
    let port = 18_793;
    let Some(_fx) = start_fixture(port) else {
        eprintln!("skipped: fixture would not start");
        return;
    };
    let dir = tmpdir("summary");
    let client = EbirdClient::new("test-token-long-enough", Some(format!("http://127.0.0.1:{port}/v2"))).unwrap();
    pull::run(&client, &pull::PullRequest {
        regions: vec!["IN".into()], days: 2, archive_dir: dir.clone(),
    }, |_| {}).await;

    // top_n of 3 must not cap the reported species count — that bug makes the
    // headline number a property of the display rather than the data.
    let s = analyze::summarize(&dir, 3).unwrap();
    assert_eq!(s.top_species.len(), 3);
    assert!(s.species > 3, "distinct species ({}) must exceed the top slice", s.species);
    assert!(s.records > 0 && s.locations > 0);
    assert_eq!(s.days, 2);
    assert!(s.any_synthetic);
    assert!(s.first_date.is_some() && s.last_date.is_some());
    assert!(s.caveat.contains("effort"), "every summary carries the effort caveat");

    // Ranking must be stable and descending.
    let recs: Vec<usize> = s.top_species.iter().map(|r| r.records).collect();
    let mut sorted = recs.clone();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    assert_eq!(recs, sorted);
}

#[test]
fn summary_of_an_empty_archive_reports_absence_not_zero() {
    let s = analyze::summarize(&tmpdir("empty"), 10).unwrap();
    assert_eq!(s.days, 0);
    assert_eq!(s.records, 0);
    // None renders as an em dash. A fabricated date would read as a finding.
    assert!(s.first_date.is_none() && s.last_date.is_none());
    assert!(s.top_species.is_empty());
    assert!(!s.any_synthetic);
}
