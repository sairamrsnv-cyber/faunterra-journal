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
