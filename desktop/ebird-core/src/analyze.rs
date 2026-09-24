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
