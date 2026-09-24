//! Tests for the publishing path.
//!
//! The stakes here are different from the archive's. A bug in the archive
//! loses data; a bug here *states something false on a public conservation
//! page*. So the bias is toward the claims: that an unreviewed rarity is never
//! marked confirmed, that a contributor is never named, and that the ordering
//! puts the records an editor can safely assert at the top.

use std::process::{Child, Command};

use ebird_core::client::EbirdClient;
use ebird_core::model::Observation;
use ebird_core::signals::{self, Sighting};

fn obs(json: &str) -> Observation {
    serde_json::from_str(json).expect("fixture row should parse")
}

fn shaped(json: &str) -> Sighting {
    signals::shape(&obs(json)).expect("row should shape")
}

// ── shaping ───────────────────────────────────────────────

#[test]
fn a_row_without_a_species_or_a_name_is_not_publishable() {
    assert!(signals::shape(&obs(r#"{"comName":"House Crow"}"#)).is_none());
    assert!(signals::shape(&obs(r#"{"speciesCode":"houcro1"}"#)).is_none());
    assert!(signals::shape(&obs(r#"{"speciesCode":"","comName":"x"}"#)).is_none());
    assert!(signals::shape(&obs(r#"{}"#)).is_none());
}

#[test]
fn confirmed_requires_both_reviewed_and_valid() {
    let base = |reviewed: &str, valid: &str| {
        format!(
            r#"{{"speciesCode":"a","comName":"A","obsReviewed":{reviewed},"obsValid":{valid}}}"#
        )
    };
    assert!(
        shaped(&base("true", "true")).confirmed,
        "reviewed and accepted"
    );
    assert!(
        !shaped(&base("true", "false")).confirmed,
        "reviewed and rejected"
    );
    assert!(
        !shaped(&base("false", "true")).confirmed,
        "not yet reviewed"
    );
    assert!(!shaped(&base("false", "false")).confirmed);

    // An absent obsValid means not-yet-flagged, so it does not block validity —
    // but an absent obsReviewed must never be read as reviewed, or every
    // unchecked rarity would be published as fact.
    let bare = shaped(r#"{"speciesCode":"a","comName":"A"}"#);
    assert!(!bare.reviewed);
    assert!(
        !bare.confirmed,
        "an unreviewed record is a claim, not a fact"
    );
}

#[test]
fn shaping_strips_the_contributor_and_keeps_the_checklist_link() {
    let s = shaped(
        r#"{"speciesCode":"rinpar","comName":"Rose-ringed Parakeet",
             "sciName":"Psittacula krameri","locName":"Okhla","locId":"L123",
             "obsDt":"2026-09-20 07:14","howMany":4,"lat":28.5,"lng":77.3,
             "subId":"S99","userDisplayName":"A Birder","obsId":"OBS1"}"#,
    );
    let json = serde_json::to_string(&s).unwrap();
    assert!(
        !json.contains("A Birder"),
        "a contributor must never reach the page"
    );
    assert!(!json.contains("userDisplayName"));
    assert_eq!(
        s.checklist_url.as_deref(),
        Some("https://ebird.org/checklist/S99")
    );
    assert_eq!(s.species_url, "https://ebird.org/species/rinpar");
    assert_eq!(s.how_many, Some(4));
}

#[test]
fn a_missing_checklist_id_yields_no_link_rather_than_a_broken_one() {
    assert!(shaped(r#"{"speciesCode":"a","comName":"A"}"#)
        .checklist_url
        .is_none());
    assert!(shaped(r#"{"speciesCode":"a","comName":"A","subId":""}"#)
        .checklist_url
        .is_none());
}

#[test]
fn every_nullable_field_is_serialised_rather_than_omitted() {
    // The website declares `string | null`, not an optional key. A dropped key
    // arrives as undefined there, which is a different claim from "unknown".
    let json = serde_json::to_value(shaped(r#"{"speciesCode":"a","comName":"A"}"#)).unwrap();
    let obj = json.as_object().unwrap();
    for key in [
        "sciName",
        "locName",
        "locId",
        "obsDt",
        "howMany",
        "lat",
        "lng",
        "checklistUrl",
    ] {
        assert!(obj.contains_key(key), "{key} must be present as null");
        assert!(obj[key].is_null(), "{key} should be null here");
    }
}

// ── ranking ───────────────────────────────────────────────

fn row(code: &str, date: &str, confirmed: bool, loc: &str) -> Sighting {
    shaped(&format!(
        r#"{{"speciesCode":"{code}","comName":"{code} bird","obsDt":"{date}",
             "obsReviewed":{confirmed},"obsValid":true,"locId":"{loc}","locName":"{loc}"}}"#
    ))
}

#[test]
fn ranking_collapses_to_one_entry_per_species_and_counts_the_rest() {
    let ranked = signals::rank(vec![
        row("a", "2026-09-01 08:00", false, "L1"),
        row("a", "2026-09-05 08:00", false, "L2"),
        row("a", "2026-09-03 08:00", false, "L1"),
        row("b", "2026-09-02 08:00", false, "L9"),
    ]);
    assert_eq!(ranked.len(), 2, "one entry per species");
    let a = ranked.iter().find(|r| r.species_code == "a").unwrap();
    assert_eq!(a.report_count, 3, "all three reports counted");
    assert_eq!(a.location_count, 2, "L1 twice is one location");
    assert_eq!(
        a.obs_dt.as_deref(),
        Some("2026-09-05 08:00"),
        "keeps the newest record"
    );
}

#[test]
fn a_confirmed_record_wins_over_a_newer_unconfirmed_one() {
    let ranked = signals::rank(vec![
        row("a", "2026-09-01 08:00", true, "L1"),
        row("a", "2026-09-20 08:00", false, "L2"),
    ]);
    assert_eq!(ranked.len(), 1);
    assert!(
        ranked[0].confirmed,
        "the page should carry the record it can assert"
    );
    assert_eq!(ranked[0].obs_dt.as_deref(), Some("2026-09-01 08:00"));
    assert_eq!(ranked[0].report_count, 2);
}

#[test]
fn confirmed_species_sort_ahead_of_unconfirmed_then_newest_first() {
    let ranked = signals::rank(vec![
        row("old_conf", "2026-09-01 08:00", true, "L1"),
        row("new_unconf", "2026-09-28 08:00", false, "L2"),
        row("new_conf", "2026-09-20 08:00", true, "L3"),
        row("old_unconf", "2026-09-02 08:00", false, "L4"),
    ]);
    let order: Vec<&str> = ranked.iter().map(|r| r.species_code.as_str()).collect();
    assert_eq!(
        order,
        vec!["new_conf", "old_conf", "new_unconf", "old_unconf"]
    );
}

#[test]
fn a_place_we_cannot_identify_is_not_counted_as_a_place() {
    let ranked = signals::rank(vec![shaped(
        r#"{"speciesCode":"a","comName":"A","obsDt":"2026-09-01 08:00"}"#,
    )]);
    // The page only shows a location count above 1, so 0 renders as nothing at
    // all. Inventing a location would put a number on the page for a record
    // that has none.
    assert_eq!(ranked[0].location_count, 0);
    assert_eq!(ranked[0].report_count, 1);
}

#[test]
fn ranking_nothing_yields_nothing() {
    assert!(signals::rank(vec![]).is_empty());
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
    for _ in 0..80 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Some(Fixture(child));
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    None
}

#[tokio::test]
async fn the_digest_has_the_shape_the_website_declares() {
    let port = 18_801;
    let Some(_fx) = start_fixture(port) else {
        eprintln!("skipped: fixture would not start");
        return;
    };
    let client = EbirdClient::new(
        "test-token-long-enough",
        Some(format!("http://127.0.0.1:{port}/v2")),
    )
    .unwrap();
    let store = signals::fetch(&client, &["IN-KL".to_string(), "IN-KA".to_string()])
        .await
        .expect("the fixture serves both endpoints, so there should be a digest");

    assert_eq!(store.regions.len(), 2);
    assert_eq!(store.source, "eBird API 2.0");
    assert!(
        store.attribution.contains("Cornell Lab"),
        "eBird's terms require attribution"
    );

    // These are the exact keys src/lib/types.ts declares. A rename on either
    // side should fail here rather than silently blank a section of the page.
    let json = serde_json::to_value(&store).unwrap();
    for key in [
        "lastUpdated",
        "source",
        "sourceUrl",
        "attribution",
        "regions",
    ] {
        assert!(json.get(key).is_some(), "store is missing {key}");
    }
    let region = &json["regions"][0];
    for key in [
        "code",
        "windowDays",
        "statsDate",
        "numChecklists",
        "numContributors",
        "numSpecies",
        "notableCount",
        "confirmedCount",
        "notable",
    ] {
        assert!(region.get(key).is_some(), "region is missing {key}");
    }
    let sighting = &region["notable"][0];
    for key in [
        "speciesCode",
        "comName",
        "sciName",
        "locName",
        "locId",
        "obsDt",
        "howMany",
        "lat",
        "lng",
        "confirmed",
        "reviewed",
        "checklistUrl",
        "speciesUrl",
        "reportCount",
        "locationCount",
    ] {
        assert!(sighting.get(key).is_some(), "sighting is missing {key}");
    }

    let r = &store.regions[0];
    assert_eq!(r.window_days, signals::LOOKBACK_DAYS);
    assert_eq!(
        r.notable_count,
        r.notable.len(),
        "the count must match what we publish"
    );
    assert!(r.confirmed_count <= r.notable_count);
    assert_eq!(r.stats_date.len(), 10, "YYYY-MM-DD");

    // One entry per species, and confirmed records lead.
    let codes: Vec<&str> = r.notable.iter().map(|n| n.species_code.as_str()).collect();
    let mut uniq = codes.clone();
    uniq.sort_unstable();
    uniq.dedup();
    assert_eq!(codes.len(), uniq.len(), "a species must not appear twice");
    let first_unconfirmed = r.notable.iter().position(|n| !n.confirmed);
    if let Some(i) = first_unconfirmed {
        assert!(
            r.notable[i..].iter().all(|n| !n.confirmed),
            "confirmed records must all precede unconfirmed ones"
        );
    }

    assert!(
        !serde_json::to_string(&store)
            .unwrap()
            .contains("userDisplayName"),
        "no contributor identity may survive into the published digest"
    );
}

#[tokio::test]
async fn an_unreachable_api_produces_no_digest_rather_than_an_empty_one() {
    // Nothing is listening on this port. Both requests fail, so we learned
    // nothing — and a digest of zero notable species would read on the page as
    // a genuinely quiet fortnight.
    let client = EbirdClient::new(
        "test-token-long-enough",
        Some("http://127.0.0.1:1/v2".into()),
    )
    .unwrap();
    assert!(signals::fetch(&client, &["IN".to_string()]).await.is_none());
}

#[tokio::test]
async fn a_rejected_key_produces_no_digest() {
    let port = 18_802;
    let Some(_fx) = start_fixture(port) else {
        eprintln!("skipped: fixture would not start");
        return;
    };
    let client = EbirdClient::new("xx", Some(format!("http://127.0.0.1:{port}/v2"))).unwrap();
    assert!(
        signals::fetch(&client, &["IN".to_string()]).await.is_none(),
        "a 403 on both endpoints must leave the page alone"
    );
}
