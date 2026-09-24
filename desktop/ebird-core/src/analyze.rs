//! Rollups over the archive.
//!
//! Descriptive only, and deliberately so. eBird counts confound observation
//! effort with abundance: more birders on a holiday weekend looks exactly like
//! more birds. Separating the two needs the effort variables in the eBird Basic
//! Dataset, which the API does not carry. Every summary produced here ships
//! with that caveat attached, because a number without it invites a conclusion
//! it cannot support.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use crate::archive;

pub const EFFORT_CAVEAT: &str = "Descriptive counts only. eBird records confound \
observation effort with abundance — effort variables require the eBird Basic Dataset.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesRow {
    pub species_code: String,
    pub com_name: String,
    pub sci_name: String,
    pub records: usize,
    pub individuals: i64,
    pub days_seen: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayRow {
    pub date: String,
    pub records: usize,
    pub species: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub regions: Vec<String>,
    pub days: usize,
    pub records: usize,
    pub species: usize,
    pub locations: usize,
    /// None when the archive holds no days at all — distinct from a real zero,
    /// and rendered as an em dash rather than a fabricated 0.
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub any_synthetic: bool,
    pub top_species: Vec<SpeciesRow>,
    pub by_day: Vec<DayRow>,
    pub caveat: String,
}

pub fn summarize(dir: &Path, top_n: usize) -> std::io::Result<Summary> {
    let idx = archive::index(dir)?;

    let mut species: HashMap<String, SpeciesRow> = HashMap::new();
    let mut seen_days: HashMap<String, Vec<String>> = HashMap::new();
    let mut locations: std::collections::HashSet<String> = Default::default();
    let mut all_species: std::collections::HashSet<String> = Default::default();
    let mut by_day: HashMap<String, (usize, std::collections::HashSet<String>)> = HashMap::new();
    let mut records = 0usize;
    let mut any_synthetic = false;
    let mut all_dates: Vec<String> = Vec::new();

    for (region, days) in &idx {
        for date in days {
            let Ok(day) = archive::read_day(dir, region, date) else {
                continue;
            };
            if !day.live {
                any_synthetic = true;
            }
            all_dates.push(date.clone());
            let bucket = by_day.entry(date.clone()).or_default();

            for obs in &day.observations {
                records += 1;
                bucket.0 += 1;
                if let Some(loc) = &obs.loc_id {
                    locations.insert(loc.clone());
                }
                let Some(code) = obs.species_code.clone() else {
                    continue;
                };
                bucket.1.insert(code.clone());
                all_species.insert(code.clone());
                seen_days
                    .entry(code.clone())
                    .or_default()
                    .push(date.clone());

                let row = species.entry(code.clone()).or_insert_with(|| SpeciesRow {
                    species_code: code.clone(),
                    com_name: obs.com_name.clone().unwrap_or_else(|| code.clone()),
                    sci_name: obs.sci_name.clone().unwrap_or_default(),
                    records: 0,
                    individuals: 0,
                    days_seen: 0,
                });
                row.records += 1;
                row.individuals += obs.how_many.unwrap_or(0);
            }
        }
    }

    for (code, dates) in &seen_days {
        if let Some(row) = species.get_mut(code) {
            let mut uniq: Vec<&String> = dates.iter().collect();
            uniq.sort_unstable();
            uniq.dedup();
            row.days_seen = uniq.len();
        }
    }

    let mut top: Vec<SpeciesRow> = species.into_values().collect();
    // Records first; name as the tiebreak so the order is stable between runs
    // rather than whatever the hash map felt like today.
    top.sort_unstable_by(|a, b| b.records.cmp(&a.records).then(a.com_name.cmp(&b.com_name)));
    top.truncate(top_n);

    let mut daily: Vec<DayRow> = by_day
        .into_iter()
        .map(|(date, (records, sp))| DayRow {
            date,
            records,
            species: sp.len(),
        })
        .collect();
    daily.sort_unstable_by(|a, b| a.date.cmp(&b.date));

    all_dates.sort_unstable();
    all_dates.dedup();

    Ok(Summary {
        regions: idx.iter().map(|(r, _)| r.clone()).collect(),
        days: all_dates.len(),
        records,
        species: all_species.len(),
        locations: locations.len(),
        first_date: all_dates.first().cloned(),
        last_date: all_dates.last().cloned(),
        any_synthetic,
        by_day: daily,
        top_species: top,
        caveat: EFFORT_CAVEAT.to_string(),
    })
}

// ── CSV export ────────────────────────────────────────────────
// Six files at different grains rather than one wide table. The grain is the
// point: `observations.csv` is what you load into pandas, but a question about
// which locations are richest should not require you to re-derive that from
// 150,000 rows every time you ask.

use std::collections::BTreeMap;
use std::io::Write;

/// Quote a field only when it needs it, doubling any internal quotes. Species
/// and place names contain commas, parentheses and apostrophes routinely —
/// "Blyth's Reed Warbler", "Bharatpur (Keoladeo NP)" — and an unquoted comma
/// silently shifts every column after it.
pub fn csv_cell(v: &str) -> String {
    if v.contains(',') || v.contains('"') || v.contains('\n') || v.contains('\r') {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_string()
    }
}

fn row(cells: &[String]) -> String {
    let mut s = cells
        .iter()
        .map(|c| csv_cell(c))
        .collect::<Vec<_>>()
        .join(",");
    s.push('\n');
    s
}

fn opt<T: ToString>(v: &Option<T>) -> String {
    v.as_ref().map(|x| x.to_string()).unwrap_or_default()
}

#[derive(Default)]
struct SpeciesAgg {
    com_name: String,
    sci_name: String,
    records: usize,
    individuals: i64,
    days: std::collections::BTreeSet<String>,
    locations: std::collections::BTreeSet<String>,
}

#[derive(Default)]
struct LocationAgg {
    name: String,
    records: usize,
    species: std::collections::BTreeSet<String>,
    lat: Option<f64>,
    lng: Option<f64>,
}

/// Read the archive once and write every derived table.
///
/// Returns each file written with its row count, so the caller can report what
/// happened rather than claiming success. Analysis output is disposable by
/// design — the archive is the record, these are re-derivable from it.
pub fn export(archive: &Path, out: &Path) -> std::io::Result<Vec<(String, usize)>> {
    std::fs::create_dir_all(out)?;

    let mut obs_file =
        std::io::BufWriter::new(std::fs::File::create(out.join("observations.csv"))?);
    obs_file.write_all(
        b"region,date,speciesCode,comName,sciName,locId,locName,obsDt,howMany,lat,lng,obsValid,obsReviewed\n",
    )?;

    let mut species: BTreeMap<String, SpeciesAgg> = BTreeMap::new();
    let mut locations: BTreeMap<String, LocationAgg> = BTreeMap::new();
    // region-day -> (records, species set, location set)
    type DayAgg = (
        usize,
        std::collections::BTreeSet<String>,
        std::collections::BTreeSet<String>,
    );
    let mut days: BTreeMap<(String, String), DayAgg> = BTreeMap::new();
    let mut obs_rows = 0usize;

    for (region, dates) in crate::archive::index(archive)? {
        for date in dates {
            let Ok(day) = crate::archive::read_day(archive, &region, &date) else {
                continue;
            };
            for o in &day.observations {
                let code = o.species_code.clone().unwrap_or_default();
                let com = o.com_name.clone().unwrap_or_default();
                let loc_id = o.loc_id.clone().unwrap_or_default();
                let loc_name = o.loc_name.clone().unwrap_or_default();

                obs_file.write_all(
                    row(&[
                        region.clone(),
                        date.clone(),
                        code.clone(),
                        com.clone(),
                        o.sci_name.clone().unwrap_or_default(),
                        loc_id.clone(),
                        loc_name.clone(),
                        o.obs_dt.clone().unwrap_or_default(),
                        opt(&o.how_many),
                        opt(&o.lat),
                        opt(&o.lng),
                        opt(&o.obs_valid),
                        opt(&o.obs_reviewed),
                    ])
                    .as_bytes(),
                )?;
                obs_rows += 1;

                let d = days.entry((region.clone(), date.clone())).or_default();
                d.0 += 1;
                if !code.is_empty() {
                    d.1.insert(code.clone());
                }
                if !loc_id.is_empty() {
                    d.2.insert(loc_id.clone());
                }

                if !code.is_empty() {
                    let s = species.entry(code.clone()).or_default();
                    if s.com_name.is_empty() {
                        s.com_name = com;
                        s.sci_name = o.sci_name.clone().unwrap_or_default();
                    }
                    s.records += 1;
                    s.individuals += o.how_many.unwrap_or(0);
                    s.days.insert(date.clone());
                    if !loc_id.is_empty() {
                        s.locations.insert(loc_id.clone());
                    }
                }

                if !loc_id.is_empty() {
                    let l = locations.entry(loc_id).or_default();
                    if l.name.is_empty() {
                        l.name = loc_name;
                        l.lat = o.lat;
                        l.lng = o.lng;
                    }
                    l.records += 1;
                    if !code.is_empty() {
                        l.species.insert(code);
                    }
                }
            }
        }
    }
    obs_file.flush()?;

    let mut written = vec![("observations.csv".to_string(), obs_rows)];

    // ── species-summary.csv, richest first ──
    let mut sp: Vec<(&String, &SpeciesAgg)> = species.iter().collect();
    sp.sort_by(|a, b| {
        b.1.records
            .cmp(&a.1.records)
            .then(a.1.com_name.cmp(&b.1.com_name))
    });
    let mut f = String::from(
        "speciesCode,comName,sciName,records,individuals,daysSeen,locations,firstSeen,lastSeen\n",
    );
    for (code, a) in &sp {
        f.push_str(&row(&[
            (*code).clone(),
            a.com_name.clone(),
            a.sci_name.clone(),
            a.records.to_string(),
            a.individuals.to_string(),
            a.days.len().to_string(),
            a.locations.len().to_string(),
            a.days.iter().next().cloned().unwrap_or_default(),
            a.days.iter().next_back().cloned().unwrap_or_default(),
        ]));
    }
    std::fs::write(out.join("species-summary.csv"), f)?;
    written.push(("species-summary.csv".into(), sp.len()));

    // ── daily-summary.csv ──
    let mut f = String::from("region,date,records,species,locations\n");
    for ((region, date), (records, s, l)) in &days {
        f.push_str(&row(&[
            region.clone(),
            date.clone(),
            records.to_string(),
            s.len().to_string(),
            l.len().to_string(),
        ]));
    }
    std::fs::write(out.join("daily-summary.csv"), f)?;
    written.push(("daily-summary.csv".into(), days.len()));

    // ── locations.csv, ranked by species richness ──
    let mut locs: Vec<(&String, &LocationAgg)> = locations.iter().collect();
    locs.sort_by(|a, b| {
        b.1.species
            .len()
            .cmp(&a.1.species.len())
            .then(b.1.records.cmp(&a.1.records))
    });
    let mut f = String::from("locId,locName,records,species,lat,lng\n");
    for (id, a) in &locs {
        f.push_str(&row(&[
            (*id).clone(),
            a.name.clone(),
            a.records.to_string(),
            a.species.len().to_string(),
            opt(&a.lat),
            opt(&a.lng),
        ]));
    }
    std::fs::write(out.join("locations.csv"), f)?;
    written.push(("locations.csv".into(), locs.len()));

    // ── accumulation.csv ──
    // Cumulative distinct species by date. A curve that is still climbing means
    // the archive is not yet describing the region — it is describing how long
    // we have been looking.
    let mut by_date: BTreeMap<String, std::collections::BTreeSet<String>> = BTreeMap::new();
    let mut records_by_date: BTreeMap<String, usize> = BTreeMap::new();
    for ((_, date), (records, s, _)) in &days {
        by_date
            .entry(date.clone())
            .or_default()
            .extend(s.iter().cloned());
        *records_by_date.entry(date.clone()).or_insert(0) += records;
    }
    let mut seen: std::collections::BTreeSet<String> = Default::default();
    let mut f = String::from("date,newSpecies,cumulativeSpecies,records\n");
    let dates: Vec<&String> = by_date.keys().collect();
    for date in &dates {
        let todays = &by_date[*date];
        let fresh = todays.iter().filter(|c| !seen.contains(*c)).count();
        seen.extend(todays.iter().cloned());
        f.push_str(&row(&[
            (*date).clone(),
            fresh.to_string(),
            seen.len().to_string(),
            records_by_date.get(*date).copied().unwrap_or(0).to_string(),
        ]));
    }
    std::fs::write(out.join("accumulation.csv"), f)?;
    written.push(("accumulation.csv".into(), dates.len()));

    // ── summary.json ──
    let summary = summarize(archive, 25)?;
    std::fs::write(
        out.join("summary.json"),
        serde_json::to_vec_pretty(&summary)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
    )?;
    written.push(("summary.json".into(), summary.days));

    Ok(written)
}
