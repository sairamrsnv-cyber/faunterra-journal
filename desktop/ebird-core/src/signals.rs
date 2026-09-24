//! The journal's field-signals digest.
//!
//! This is the *publishing* path, and it has nothing in common with the archive
//! but the API it talks to. The archive is exhaustive, permanent and private;
//! this is a short editorial window — unusual birds reported in the last two
//! weeks — that gets rewritten on every run and rendered on a public page.
//!
//! Two requests per region. That is the whole budget, and it is a deliberate
//! ceiling: this runs on a schedule against an account that can be suspended
//! for abuse, and a digest is not worth risking the archive's key over.
//!
//! Nothing here throws. A missing key, an unreachable API or a response shape
//! we did not anticipate all produce `None`, and the caller leaves the existing
//! page untouched. A stale digest is a small problem; a build that fails at
//! 06:00 because a third party had a bad morning is a larger one.

use std::collections::{BTreeSet, HashMap};

use chrono::{Datelike, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::client::EbirdClient;
use crate::model::Observation;

/// Two weeks. Long enough that a quiet region still has something to show,
/// short enough that "recently" is honest. The endpoint accepts up to 30; we
/// do not push a documented maximum we do not need.
pub const LOOKBACK_DAYS: u32 = 14;

/// Per region, before ranking. Ranking collapses to one entry per species, so
/// this is a raw-report ceiling, not a species count.
const MAX_NOTABLE: u32 = 60;

/// Per region, after ranking. A page, not a database dump.
const PUBLISH_LIMIT: usize = 20;

pub const ATTRIBUTION: &str =
    "Observation data from eBird (https://ebird.org), a project of the Cornell Lab of \
     Ornithology. Contributed by volunteer birdwatchers worldwide.";

/// One publishable sighting.
///
/// Every nullable field is `Option` and is serialised even when empty: the
/// website's types declare `string | null`, not an optional key, and a missing
/// key would read as `undefined` there rather than "we do not know".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sighting {
    pub species_code: String,
    pub com_name: String,
    pub sci_name: Option<String>,
    pub loc_name: Option<String>,
    pub loc_id: Option<String>,
    /// eBird local datetime, "YYYY-MM-DD HH:mm", with no zone. Left as text on
    /// purpose — parsing it as UTC would shift the day for half the world.
    pub obs_dt: Option<String>,
    pub how_many: Option<i64>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    /// Reviewed *and* accepted by a regional editor.
    pub confirmed: bool,
    /// Has been through review at all. An unreviewed rarity is a claim, and the
    /// page hedges its language accordingly.
    pub reviewed: bool,
    pub checklist_url: Option<String>,
    pub species_url: String,
    pub report_count: usize,
    pub location_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSignal {
    pub code: String,
    pub window_days: u32,
    /// The day the activity figures describe — yesterday, UTC.
    pub stats_date: String,
    pub num_checklists: Option<i64>,
    pub num_contributors: Option<i64>,
    pub num_species: Option<i64>,
    pub notable_count: usize,
    pub confirmed_count: usize,
    pub notable: Vec<Sighting>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalStore {
    pub last_updated: String,
    pub source: String,
    pub source_url: String,
    /// Required by eBird's terms. Render it wherever the data appears.
    pub attribution: String,
    pub regions: Vec<RegionSignal>,
}

#[derive(Debug, Default, Deserialize)]
struct RegionStats {
    #[serde(rename = "numChecklists")]
    num_checklists: Option<i64>,
    #[serde(rename = "numContributors")]
    num_contributors: Option<i64>,
    #[serde(rename = "numSpecies")]
    num_species: Option<i64>,
}

/// Keep what makes an editorial line — species, place, date, count — and drop
/// the rest.
///
/// What is deliberately NOT carried through: the contributor's display name,
/// and any other field that identifies who was out that morning. `subId`
/// becomes a checklist link, which is public on eBird, rather than a bare id.
pub fn shape(obs: &Observation) -> Option<Sighting> {
    let species_code = obs.species_code.clone()?;
    let com_name = obs.com_name.clone()?;
    if species_code.is_empty() || com_name.is_empty() {
        return None;
    }

    // `obsValid` / `obsReviewed` arrive with detail=full. Absent means
    // not-yet-flagged rather than rejected, so an absent `obsValid` is treated
    // as valid — but absent `obsReviewed` is NOT treated as reviewed, and
    // confirmation needs both.
    let reviewed = obs.obs_reviewed == Some(true);
    let valid = obs.obs_valid != Some(false);

    let checklist_url = obs
        .extra
        .get("subId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| format!("https://ebird.org/checklist/{s}"));

    Some(Sighting {
        species_url: format!("https://ebird.org/species/{species_code}"),
        species_code,
        com_name,
        sci_name: obs.sci_name.clone(),
        loc_name: obs.loc_name.clone(),
        loc_id: obs.loc_id.clone(),
        obs_dt: obs.obs_dt.clone(),
        how_many: obs.how_many,
        lat: obs.lat,
        lng: obs.lng,
        confirmed: reviewed && valid,
        reviewed,
        checklist_url,
        report_count: 1,
        location_count: 0,
    })
}

/// Collapse raw reports to one entry per species, then order them for an editor.
///
/// Confirmed beats unconfirmed, because asserting an unreviewed rarity on a
/// conservation page is a correction waiting to happen. Recent beats stale.
/// Within a species we keep the best single record — preferring a confirmed one
/// over a merely newer one — while the counts accumulate across all of them.
pub fn rank(sightings: Vec<Sighting>) -> Vec<Sighting> {
    let mut by_species: HashMap<String, (Sighting, usize, BTreeSet<String>)> = HashMap::new();
    // Insertion order, so equal-ranking species come out the way eBird sent
    // them rather than however the hash map felt today.
    let mut order: Vec<String> = Vec::new();

    for s in sightings {
        // A location is identified by its eBird id when present; the name is a
        // fallback. Unnamed, unidentified places count as no location at all
        // rather than as one shared mystery place.
        let place = s
            .loc_id
            .clone()
            .or_else(|| s.loc_name.clone())
            .filter(|p| !p.is_empty());

        match by_species.get_mut(&s.species_code) {
            None => {
                let mut places = BTreeSet::new();
                if let Some(p) = place {
                    places.insert(p);
                }
                order.push(s.species_code.clone());
                by_species.insert(s.species_code.clone(), (s, 1, places));
            }
            Some((best, count, places)) => {
                *count += 1;
                if let Some(p) = place {
                    places.insert(p);
                }
                let newer =
                    s.obs_dt.as_deref().unwrap_or("") > best.obs_dt.as_deref().unwrap_or("");
                let better =
                    (s.confirmed && !best.confirmed) || (s.confirmed == best.confirmed && newer);
                if better {
                    *best = s;
                }
            }
        }
    }

    let mut out: Vec<Sighting> = order
        .into_iter()
        .filter_map(|code| by_species.remove(&code))
        .map(|(mut s, count, places)| {
            s.report_count = count;
            s.location_count = places.len();
            s
        })
        .collect();

    out.sort_by(|a, b| {
        b.confirmed.cmp(&a.confirmed).then_with(|| {
            b.obs_dt
                .as_deref()
                .unwrap_or("")
                .cmp(a.obs_dt.as_deref().unwrap_or(""))
        })
    });
    out
}

/// Yesterday, UTC. Today's activity figures are always partial — checklists
/// land all day — so yesterday is the most recent complete picture.
fn yesterday() -> (i32, u32, u32) {
    let d = Utc::now() - Duration::days(1);
    (d.year(), d.month(), d.day())
}

async fn fetch_region(client: &EbirdClient, code: &str) -> Option<RegionSignal> {
    let (y, m, d) = yesterday();

    // Both requests, concurrently. Two round trips is the per-region budget.
    let (notable_res, stats_res) = tokio::join!(
        client.get(client.notable_url(code, LOOKBACK_DAYS, MAX_NOTABLE)),
        client.get(client.stats_url(code, y, m, d)),
    );

    let notable_body = notable_res.map_err(|e| eprintln!("    notable → {e}")).ok();
    let stats_body = stats_res.map_err(|e| eprintln!("    stats → {e}")).ok();

    // Both failing means we learned nothing about this region. Leave it out
    // entirely rather than publishing an empty shell that looks like a quiet
    // fortnight.
    if notable_body.is_none() && stats_body.is_none() {
        return None;
    }

    let raw: Vec<Observation> = notable_body
        .as_ref()
        .and_then(|f| serde_json::from_str(&f.body).ok())
        .unwrap_or_default();
    let notable = rank(raw.iter().filter_map(shape).collect());

    let stats: RegionStats = stats_body
        .as_ref()
        .and_then(|f| serde_json::from_str(&f.body).ok())
        .unwrap_or_default();

    let confirmed_count = notable.iter().filter(|n| n.confirmed).count();
    Some(RegionSignal {
        code: code.to_string(),
        window_days: LOOKBACK_DAYS,
        stats_date: format!("{y}-{m:02}-{d:02}"),
        num_checklists: stats.num_checklists,
        num_contributors: stats.num_contributors,
        num_species: stats.num_species,
        notable_count: notable.len(),
        confirmed_count,
        notable: notable.into_iter().take(PUBLISH_LIMIT).collect(),
    })
}

/// Build the digest, or return `None` if there is nothing worth publishing.
///
/// `None` is not an error and must not be treated as one: it means leave the
/// page as it is.
pub async fn fetch(client: &EbirdClient, regions: &[String]) -> Option<SignalStore> {
    println!("  {} region(s), {LOOKBACK_DAYS}-day window", regions.len());

    let mut out = Vec::new();
    for code in regions {
        print!("  {code} … ");
        use std::io::Write;
        let _ = std::io::stdout().flush();

        match fetch_region(client, code).await {
            Some(r) => {
                let checklists = r
                    .num_checklists
                    .map(|n| format!(", {n} checklists"))
                    .unwrap_or_default();
                println!("{} notable species{checklists}", r.notable_count);
                out.push(r);
            }
            None => println!("no data"),
        }
    }

    if out.is_empty() {
        return None;
    }
    Some(SignalStore {
        last_updated: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        source: "eBird API 2.0".into(),
        source_url: "https://ebird.org".into(),
        attribution: ATTRIBUTION.into(),
        regions: out,
    })
}
