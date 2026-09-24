//! Data shapes shared by the puller, the archive and the UI.

use serde::{Deserialize, Serialize};

/// Fields that identify a human contributor. Stripped before anything reaches
/// disk or a screen.
///
/// eBird's terms and plain decency both point the same way: we are analysing
/// *where birds are*, not *who was out that morning*. `userDisplayName` is the
/// field the API actually sends today; the others are defensive, so a schema
/// change on their side cannot quietly start leaking names into our archive.
pub const IDENTITY_FIELDS: &[&str] = &["userDisplayName", "firstName", "lastName"];

/// One observation.
///
/// Named fields are the ones we analyse. Everything else eBird sends lands in
/// `extra` and is written back out verbatim — the archive must stay faithful as
/// their schema grows, because the API's ~30-day window means a field we drop
/// today is a field we can never recover.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Observation {
    #[serde(rename = "speciesCode", skip_serializing_if = "Option::is_none")]
    pub species_code: Option<String>,
    #[serde(rename = "comName", skip_serializing_if = "Option::is_none")]
    pub com_name: Option<String>,
    #[serde(rename = "sciName", skip_serializing_if = "Option::is_none")]
    pub sci_name: Option<String>,
    #[serde(rename = "locId", skip_serializing_if = "Option::is_none")]
    pub loc_id: Option<String>,
    #[serde(rename = "locName", skip_serializing_if = "Option::is_none")]
    pub loc_name: Option<String>,
    #[serde(rename = "obsDt", skip_serializing_if = "Option::is_none")]
    pub obs_dt: Option<String>,
    #[serde(rename = "howMany", skip_serializing_if = "Option::is_none")]
    pub how_many: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lng: Option<f64>,
    #[serde(rename = "obsValid", skip_serializing_if = "Option::is_none")]
    pub obs_valid: Option<bool>,
    #[serde(rename = "obsReviewed", skip_serializing_if = "Option::is_none")]
    pub obs_reviewed: Option<bool>,

    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Observation {
    /// Remove contributor identity. Returns the fields that were *actually*
    /// present and removed — not the candidate list.
    ///
    /// The distinction matters: a log that names three fields when it removed
    /// one is a log you cannot audit. If eBird ever starts sending a name in a
    /// field we do not know about, the honest report is the one that shows
    /// exactly what changed.
    pub fn sanitize(&mut self) -> Vec<&'static str> {
        let mut removed = Vec::new();
        for field in IDENTITY_FIELDS {
            if self.extra.remove(*field).is_some() {
                removed.push(*field);
            }
        }
        removed
    }
}

/// One archived day, for one region. This is the on-disk record and the
/// contract between the desktop app and every downstream analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayFile {
    pub region: String,
    pub date: String,
    #[serde(rename = "pulledAt")]
    pub pulled_at: String,
    pub source: String,
    pub attribution: String,
    /// False when the rows came from the local fixture rather than eBird.
    /// Written into the file itself, not just shown in the UI — a synthetic
    /// record that loses its label is worse than no record at all.
    #[serde(default = "default_true")]
    pub live: bool,
    #[serde(rename = "rowCount")]
    pub row_count: usize,
    pub observations: Vec<Observation>,
}

fn default_true() -> bool {
    true
}

/// Everything the pull loop reports as it happens.
///
/// The UI renders these as a running log. That is the point: a data pull that
/// you cannot watch is a data pull you have to trust. This makes the mechanism
/// visible — which URL, which auth, what came back, what got stripped, where it
/// landed, and why we pause between requests.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PullEvent {
    Plan {
        regions: Vec<String>,
        dates: Vec<String>,
        requests: usize,
        archive: String,
        endpoint: String,
        live: bool,
    },
    Skip {
        region: String,
        date: String,
        reason: String,
    },
    Request {
        region: String,
        date: String,
        method: String,
        url: String,
        /// Masked. The real token never crosses into the WebView.
        auth: String,
    },
    Response {
        region: String,
        date: String,
        status: u16,
        bytes: usize,
        ms: u64,
    },
    Parse {
        region: String,
        date: String,
        rows: usize,
        species: usize,
    },
    Privacy {
        region: String,
        date: String,
        fields: Vec<String>,
        occurrences: usize,
    },
    Write {
        region: String,
        date: String,
        path: String,
        bytes: usize,
    },
    Throttle {
        ms: u64,
        why: String,
    },
    Failed {
        region: String,
        date: String,
        reason: String,
    },
    Done {
        fetched: usize,
        skipped: usize,
        failed: usize,
        rows: usize,
        ms: u64,
    },
}

impl PullEvent {
    /// Severity for the UI. Status is always paired with a text label in the
    /// interface — colour never carries meaning on its own.
    pub fn level(&self) -> &'static str {
        match self {
            PullEvent::Failed { .. } => "critical",
            PullEvent::Response { status, .. } if *status >= 400 => "critical",
            PullEvent::Write { .. } | PullEvent::Done { .. } => "good",
            PullEvent::Privacy { .. } => "notice",
            _ => "info",
        }
    }
}
