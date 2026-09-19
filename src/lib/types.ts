// ── Article Types ─────────────────────────────────────────────

export type ArticleType = 'faunterra' | 'curated';

export type ArticleCategory =
  | 'conservation'
  | 'marine'
  | 'technology'
  | 'field-notes'
  | 'ecology'
  | 'expeditions'
  | 'education'
  | 'restoration'
  | 'species'
  | 'community';

export interface Article {
  id:            string;
  type:          ArticleType;
  title:         string;
  source:        string;
  sourceUrl:     string;
  originalUrl:   string;
  publishedAt:   string;        // ISO date string
  category:      ArticleCategory;
  image:         string | null;
  excerpt:       string;        // Original excerpt / first paragraph
  summary:       string;        // AI-generated 2–3 sentence summary
  whyItMatters:  string;        // AI-generated insight
  tags:          string[];
  featured:      boolean;
  authorName?:   string;
}

export interface WeeklyRoundup {
  id:            string;
  weekEnding:    string;        // ISO date string (Sunday)
  headline:      string;
  subheading:    string;
  body:          string;        // Full AI-generated editorial text (markdown)
  highlights:    RoundupHighlight[];
  publishedAt:   string;
}

export interface RoundupHighlight {
  title:       string;
  description: string;
  category:    string;
}

// ── Data Store Types ──────────────────────────────────────────

export interface ArticleStore {
  lastUpdated:  string;
  articles:     Article[];
}

export interface RoundupStore {
  lastGenerated: string;
  roundups:      WeeklyRoundup[];
}

// ── eBird Field Signals ───────────────────────────────────────
// Live observation data from the eBird API 2.0 (Cornell Lab of Ornithology).
// Populated by scripts/ebird.mjs. Every field is nullable by design: the API
// omits stats on quiet days, and a half-present digest beats a fabricated zero.

export interface BirdObservation {
  speciesCode:   string;
  comName:       string;
  sciName:       string | null;
  locName:       string | null;
  locId:         string | null;
  obsDt:         string | null;   // eBird local datetime, "YYYY-MM-DD HH:mm"
  howMany:       number | null;
  lat:           number | null;
  lng:           number | null;
  /** Reviewed AND accepted by an eBird regional editor. */
  confirmed:     boolean;
  /** Has been through review at all. Unreviewed rarities are claims, not facts. */
  reviewed:      boolean;
  checklistUrl:  string | null;
  speciesUrl:    string;
  /** Distinct reports of this species in the window. */
  reportCount:   number;
  /** Distinct locations reporting it. A 1 is a better story than a 20. */
  locationCount: number;
}

export interface BirdRegionSignal {
  code:            string;        // eBird region code, e.g. "IN" or "IN-KA"
  windowDays:      number;
  statsDate:       string;        // YYYY-MM-DD the activity stats describe
  numChecklists:   number | null;
  numContributors: number | null;
  numSpecies:      number | null;
  notableCount:    number;
  confirmedCount:  number;
  notable:         BirdObservation[];
}

export interface BirdSignalStore {
  lastUpdated: string;
  source:      string;
  sourceUrl:   string;
  /** Required by eBird's terms — render this wherever the data appears. */
  attribution: string;
  regions:     BirdRegionSignal[];
}
