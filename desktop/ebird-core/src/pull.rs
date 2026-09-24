//! The pull loop — and the running commentary that makes it legible.
//!
//! Every step emits an event before and after it happens. That is the whole
//! design intent: an unattended job that you cannot watch is a job you have to
//! take on faith, and faith is a poor foundation for a dataset you cannot
//! re-fetch.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::time::Instant;

use chrono::{Duration as ChronoDuration, Utc};

use crate::archive;
use crate::client::{EbirdClient, FetchError, THROTTLE};
use crate::model::{DayFile, Observation, PullEvent};

/// The days to pull, newest first. Always *yesterday* backwards — today is
/// still filling up, and an archived partial day would be silently wrong in a
/// way no later run would correct.
pub fn target_dates(days: u32) -> Vec<(String, i32, u32, u32)> {
    use chrono::Datelike;
    let now = Utc::now();
    (1..=days as i64)
        .map(|i| {
            let d = now - ChronoDuration::days(i);
            (
                d.format("%Y-%m-%d").to_string(),
                d.year(),
                d.month(),
                d.day(),
            )
        })
        .collect()
}

pub struct PullRequest {
    pub regions: Vec<String>,
    pub days: u32,
    pub archive_dir: std::path::PathBuf,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct PullSummary {
    pub fetched: usize,
    pub skipped: usize,
    pub failed: usize,
    pub rows: usize,
}

/// Run the pull, reporting as we go.
///
/// `emit` is called from this task, in order. The desktop shell forwards each
/// event straight to the WebView; the CLI prints it. Same events, same order,
/// so what you debug on the terminal is what you saw in the window.
pub async fn run<F>(
    client: &EbirdClient,
    req: &PullRequest,
    mut emit: F,
) -> PullSummary
where
    F: FnMut(PullEvent),
{
    let started = Instant::now();
    let dates = target_dates(req.days);
    let live = client.is_live();

    emit(PullEvent::Plan {
        regions: req.regions.clone(),
        dates: dates.iter().map(|d| d.0.clone()).collect(),
        requests: req.regions.len() * dates.len(),
        archive: req.archive_dir.display().to_string(),
        endpoint: client.base().to_string(),
        live,
    });

    let mut sum = PullSummary::default();
    let mut first_request = true;

    for region in &req.regions {
        for (iso, y, m, d) in &dates {
            if archive::has_day(&req.archive_dir, region, iso) {
                sum.skipped += 1;
                emit(PullEvent::Skip {
                    region: region.clone(),
                    date: iso.clone(),
                    reason: "already archived — costs no request".into(),
                });
                continue;
            }

            // Wait *before* the request rather than after the last one, so the
            // run never ends on a pointless sleep.
            if !first_request {
                emit(PullEvent::Throttle {
                    ms: THROTTLE.as_millis() as u64,
                    why: "politeness gap between requests".into(),
                });
                tokio::time::sleep(THROTTLE).await;
            }
            first_request = false;

            emit(PullEvent::Request {
                region: region.clone(),
                date: iso.clone(),
                method: "GET".into(),
                url: client.historic_url(region, *y, *m, *d),
                auth: format!("x-ebirdapitoken: {}", client.masked_token()),
            });

            let fetched = match client.historic(region, *y, *m, *d).await {
                Ok(f) => f,
                Err(e) => {
                    sum.failed += 1;
                    if let FetchError::Status { code, .. } = &e {
                        emit(PullEvent::Response {
                            region: region.clone(),
                            date: iso.clone(),
                            status: *code,
                            bytes: 0,
                            ms: 0,
                        });
                    }
                    emit(PullEvent::Failed {
                        region: region.clone(),
                        date: iso.clone(),
                        reason: e.to_string(),
                    });
                    continue;
                }
            };

            emit(PullEvent::Response {
                region: region.clone(),
                date: iso.clone(),
                status: fetched.status,
                bytes: fetched.bytes,
                ms: fetched.ms,
            });

            let mut rows: Vec<Observation> = match serde_json::from_str(&fetched.body) {
                Ok(v) => v,
                Err(e) => {
                    sum.failed += 1;
                    emit(PullEvent::Failed {
                        region: region.clone(),
                        date: iso.clone(),
                        reason: format!("could not parse response: {e}"),
                    });
                    continue;
                }
            };

            // Report what arrived before reporting what we did to it, so the
            // log reads in the order the events actually happened.
            let species_count = rows
                .iter()
                .filter_map(|r| r.species_code.as_deref())
                .collect::<HashSet<&str>>()
                .len();

            emit(PullEvent::Parse {
                region: region.clone(),
                date: iso.clone(),
                rows: rows.len(),
                species: species_count,
            });

            // Strip identity before anything else touches these rows — not on
            // write, not on render. After this loop the only copy in memory is
            // already anonymous.
            //
            // Count per field rather than in total: naming a field we did not
            // remove would make this line unauditable, and a field appearing
            // here that we did not expect is exactly the signal worth seeing.
            let mut stripped: BTreeMap<&'static str, usize> = BTreeMap::new();
            for row in rows.iter_mut() {
                for field in row.sanitize() {
                    *stripped.entry(field).or_insert(0) += 1;
                }
            }
            if !stripped.is_empty() {
                emit(PullEvent::Privacy {
                    region: region.clone(),
                    date: iso.clone(),
                    occurrences: stripped.values().sum(),
                    fields: stripped.keys().map(|s| s.to_string()).collect(),
                });
            }

            let day = DayFile {
                region: region.clone(),
                date: iso.clone(),
                pulled_at: Utc::now().to_rfc3339(),
                source: "eBird API 2.0 /data/obs/{region}/historic".into(),
                attribution: "eBird (https://ebird.org), Cornell Lab of Ornithology.".into(),
                live,
                row_count: rows.len(),
                observations: rows,
            };

            match archive::write_day(&req.archive_dir, &day) {
                Ok((path, bytes)) => {
                    sum.fetched += 1;
                    sum.rows += day.row_count;
                    emit(PullEvent::Write {
                        region: region.clone(),
                        date: iso.clone(),
                        path: shorten(&path, &req.archive_dir),
                        bytes,
                    });
                }
                Err(e) => {
                    sum.failed += 1;
                    emit(PullEvent::Failed {
                        region: region.clone(),
                        date: iso.clone(),
                        reason: e.to_string(),
                    });
                }
            }
        }
    }

    emit(PullEvent::Done {
        fetched: sum.fetched,
        skipped: sum.skipped,
        failed: sum.failed,
        rows: sum.rows,
        ms: started.elapsed().as_millis() as u64,
    });

    sum
}

/// Show the path relative to the archive root. The full path is already on
/// screen once, in the plan; repeating it on every line buries the part that
/// changes.
fn shorten(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}
