//! The eBird HTTP client.
//!
//! Small on purpose. One endpoint, one header, one timeout. Everything that
//! could surprise us — a non-200, a truncated body, unparseable JSON — comes
//! back as data rather than a panic, because this runs unattended at 09:00
//! every morning and a crash there is a silently missing day.

use std::time::{Duration, Instant};

pub const DEFAULT_BASE: &str = "https://api.ebird.org/v2";
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
pub const MAX_RESULTS: u32 = 10_000;

/// Politeness gap between requests. eBird asks for restraint and publishes no
/// rate number, so we pick a conservative one rather than guess at theirs.
/// Being throttled costs a day of data; being slow costs nothing.
pub const THROTTLE: Duration = Duration::from_millis(1_100);

#[derive(Debug)]
pub enum FetchError {
    Http(String),
    Timeout,
    Status { code: u16, body: String },
    Parse(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::Http(e) => write!(f, "network error: {e}"),
            FetchError::Timeout => write!(f, "timed out after {}s", REQUEST_TIMEOUT.as_secs()),
            FetchError::Status { code, .. } => match code {
                401 | 403 => write!(f, "HTTP {code} — key rejected. Check EBIRD_API_TOKEN."),
                404 => write!(f, "HTTP 404 — unknown region code."),
                429 => write!(f, "HTTP 429 — rate limited. Slow down and retry later."),
                _ => write!(f, "HTTP {code}"),
            },
            FetchError::Parse(e) => write!(f, "response was not the JSON we expected: {e}"),
        }
    }
}

pub struct Fetched {
    pub url: String,
    pub status: u16,
    pub bytes: usize,
    pub ms: u64,
    pub body: String,
}

pub struct EbirdClient {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl EbirdClient {
    pub fn new(token: impl Into<String>, base: Option<String>) -> Result<Self, FetchError> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent("faunterra-data-station/0.1 (+https://faunterra.com)")
            .build()
            .map_err(|e| FetchError::Http(e.to_string()))?;
        Ok(Self {
            http,
            base: base.unwrap_or_else(|| DEFAULT_BASE.to_string()),
            token: token.into(),
        })
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// True when we are talking to eBird itself. False means a local stand-in,
    /// and every row that comes back must be labelled synthetic.
    pub fn is_live(&self) -> bool {
        self.base == DEFAULT_BASE
    }

    /// What the log shows in place of the key. Enough to tell two keys apart
    /// while debugging; not enough to be a key.
    pub fn masked_token(&self) -> String {
        let n = self.token.chars().count();
        if n <= 4 {
            "****".to_string()
        } else {
            let tail: String = self.token.chars().skip(n - 4).collect();
            format!("{}{tail}", "*".repeat(n - 4))
        }
    }

    pub fn historic_url(&self, region: &str, y: i32, m: u32, d: u32) -> String {
        format!(
            "{}/data/obs/{region}/historic/{y}/{m}/{d}?detail=full&maxResults={MAX_RESULTS}&includeProvisional=true",
            self.base
        )
    }

    /// Unusual species reported in a region over the last `back` days. This is
    /// the endpoint behind the journal's field-signals section — a short,
    /// editorial window, not an archive.
    pub fn notable_url(&self, region: &str, back: u32, max: u32) -> String {
        format!(
            "{}/data/obs/{region}/recent/notable?back={back}&detail=full&maxResults={max}",
            self.base
        )
    }

    /// A region's activity for one day: checklists, contributors, species.
    pub fn stats_url(&self, region: &str, y: i32, m: u32, d: u32) -> String {
        format!("{}/product/stats/{region}/{y}/{m}/{d}", self.base)
    }

    /// One day, one region. Returns the raw body so the caller can report byte
    /// counts before paying to parse it.
    pub async fn historic(
        &self,
        region: &str,
        y: i32,
        m: u32,
        d: u32,
    ) -> Result<Fetched, FetchError> {
        self.get(self.historic_url(region, y, m, d)).await
    }

    /// Fetch any prepared eBird URL. Every request in this crate goes through
    /// here, so the timeout, the auth header and the failure taxonomy are
    /// defined exactly once.
    pub async fn get(&self, url: String) -> Result<Fetched, FetchError> {
        let started = Instant::now();

        let res = self
            .http
            .get(&url)
            .header("x-ebirdapitoken", &self.token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    FetchError::Timeout
                } else {
                    FetchError::Http(e.to_string())
                }
            })?;

        let status = res.status().as_u16();
        let body = res
            .text()
            .await
            .map_err(|e| FetchError::Http(e.to_string()))?;
        let ms = started.elapsed().as_millis() as u64;

        if !(200..300).contains(&status) {
            return Err(FetchError::Status {
                code: status,
                body: body.chars().take(200).collect(),
            });
        }

        Ok(Fetched {
            url,
            status,
            bytes: body.len(),
            ms,
            body,
        })
    }
}
