# Faunterra Field Journal — Automated Conservation Curation

> Stories from the Field. A living conservation journal powered by Faunterra + Claude AI.

---

## What This Is

A Next.js static site that automatically:
- Fetches conservation stories from 9 trusted sources every 6 hours
- Filters for **positive conservation wins only** using Claude AI
- Generates intelligent summaries and "Why This Matters" insights
- Publishes a beautifully written editorial roundup every Sunday
- Deploys automatically to Cloudflare Pages on every update

---

## Project Structure

```
faunterra-journal/
├── .github/workflows/fetch-articles.yml  ← Automation (runs every 6h)
├── src/
│   ├── app/
│   │   ├── page.tsx       ← Main journal page
│   │   ├── layout.tsx     ← Root layout + fonts
│   │   └── globals.css    ← Faunterra design system
│   ├── components/
│   │   ├── ArticleCard.tsx    ← Article cards
│   │   └── WeeklyRoundup.tsx  ← Sunday editorial
│   └── lib/
│       ├── data.ts     ← Data loading utilities
│       └── types.ts    ← TypeScript interfaces
├── data/
│   ├── faunterra-articles.json  ← Your own articles (edit manually)
│   ├── curated-articles.json    ← Auto-populated by GitHub Actions
│   ├── ebird-signals.json       ← Auto-populated from the eBird API
│   └── weekly-roundup.json      ← Auto-generated Sundays
├── scripts/
│   ├── automate.mjs        ← Core automation engine
│   ├── ebird.mjs           ← eBird client for the site's signal digest
│   ├── ebird-pull.mjs      ← Local archive builder (daily accumulation)
│   ├── ebird-analyze.mjs   ← Local analysis → CSV for pandas / R
│   └── ebird-schedule.mjs  ← Installs the daily pull as a launchd job
└── package.json
```

---

## Setup Guide

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/faunterra-journal.git
cd faunterra-journal
npm install
```

### 2. Run Locally

```bash
npm run dev
# Open http://localhost:3000
```

### 3. Add Your Anthropic API Key

For GitHub Actions:
1. Go to your repo → **Settings → Secrets → Actions**
2. Add secret: `ANTHROPIC_API_KEY` = your key from console.anthropic.com

For local testing:
```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run automate
```

### 4. Add Your eBird API Key (optional)

Pulls live bird observation signals — notable sightings and regional birding
activity — from the [eBird API 2.0](https://ebird.org/api/keygen), run by the
Cornell Lab of Ornithology. The key is free; you just need an eBird account.

1. Get a key at **https://ebird.org/api/keygen**
2. Repo → **Settings → Secrets → Actions** → add `EBIRD_API_TOKEN`
3. Optionally, repo → **Settings → Variables → Actions** → add `EBIRD_REGIONS`
   as a comma-separated list of [eBird region codes](https://ebird.org/region/world)
   (e.g. `IN,IN-KA,IN-TN`). Defaults to `IN`.

Local testing:
```bash
EBIRD_API_TOKEN=your_key EBIRD_REGIONS=IN,IN-KA node scripts/ebird.mjs
```

**Without a key the pipeline still runs** — the eBird pass logs a skip and the
RSS curation continues untouched.

**Before you rely on this commercially**, read the
[eBird API Terms of Use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/).
The eBird API and eBird Status & Trends are different products under different
terms, and Status & Trends restricts commercial use without written permission
from the Cornell Lab. Attribution to eBird is required wherever the data appears —
`data/ebird-signals.json` carries an `attribution` string for exactly this; render it.

### 5. Deploy to Cloudflare Pages

1. Push repo to GitHub
2. Go to **Cloudflare Pages** → Create a project
3. Connect your GitHub repo
4. Build settings:
   - **Build command**: `npm run build`
   - **Output directory**: `out`
   - **Node version**: `20`
5. Click Deploy

Cloudflare Pages auto-deploys every time GitHub Actions commits updated data.

### 6. Add Your Own Faunterra Stories

Edit `data/faunterra-articles.json` directly. Follow the existing article format:

```json
{
  "id": "f-007",
  "type": "faunterra",
  "title": "Your Story Title",
  "source": "Faunterra Field Journal",
  "sourceUrl": "https://faunterra.com",
  "originalUrl": "#",
  "publishedAt": "2025-06-10T08:00:00Z",
  "category": "conservation",
  "image": null,
  "excerpt": "Opening paragraph...",
  "summary": "2-3 sentence summary...",
  "whyItMatters": "Conservation significance...",
  "tags": ["tag1", "tag2"],
  "featured": false
}
```

Set `"featured": true` on ONE article to display it as the large hero card.

---

## Automation Details

### Schedule
| When | What |
|------|------|
| Every 6 hours (00:00, 06:00, 12:00, 18:00 UTC) | Fetch + filter + summarise new articles; pull eBird field signals |
| Every Sunday 08:00 UTC | Generate weekly editorial roundup |
| Manual trigger | Via GitHub Actions → Run workflow |

### What Claude Does
1. **Filters** raw RSS items against the exclusion list (poaching, disasters, conflict, doom)
2. **Categorises** accepted articles into the correct journal category
3. **Summarises** each article in 2-3 elegant, scientifically accurate sentences
4. **Generates** a "Why This Matters" conservation insight
5. **Writes** the Sunday roundup as a literary conservation editorial

### Trusted Sources
- Mongabay India
- WWF India
- Wildlife Trust of India
- IUCN News
- Conservation International Blog
- Rewilding Europe
- The Better India (Environment)
- Earth.org
- Sanctuary Nature Foundation

To add more sources, edit the `SOURCES` array in `scripts/automate.mjs`.

### Live Field Signals (eBird)

Alongside the RSS sources, the engine pulls from the eBird API — *what nature was
observed doing*, rather than what was written about it. Two requests per region
per run, deliberately: the eBird docs ask callers to use the API with restraint.

Per region it collects:
- **Notable sightings** — locally or nationally rare species reported in the last
  14 days, deduplicated by species and ranked with confirmed records first
- **Activity stats** — checklists, contributors and species counts for the most
  recent complete day

Two things it deliberately does *not* do:
- **No observer names.** The API returns `userDisplayName`; we drop it. Birders
  submitted checklists to eBird, not to a third-party journal.
- **No asserting unconfirmed rarities.** Each sighting carries `confirmed` and
  `reviewed` flags. A rare-bird report that has not cleared eBird's regional
  review is a claim, not a fact — render it as "reported", not as established.

Consume it from the site via `getBirdSignals()` and `getNotableSightings()` in
`src/lib/data.ts`.

---

## Local Data Archive & Analysis

Separate from the website pipeline. This builds a **local** eBird dataset for
your own analysis — it never touches `data/` and nothing here is published.

### Why this has to run daily

The eBird API serves a rolling **~30-day window**. Anything older is not
retrievable through the API at any price; you would have to request the eBird
Basic Dataset instead. So `ebird-pull.mjs` is an *archive builder*, not a
fetcher. Run it daily and you accumulate a time series the API cannot give you
retroactively. Skip a month and that month is gone.

### Setup

```bash
cp .env.local.example .env.local
chmod 600 .env.local
```

Then fill it in:

```sh
EBIRD_API_TOKEN=your_key                 # https://ebird.org/api/keygen
EBIRD_REGIONS=IN-KA,IN-TN                # comma-separated region codes
EBIRD_ARCHIVE_DIR=/Volumes/LaCie/faunterra/ebird-archive
```

`.env.local` is gitignored and is the only place the token needs to live — the
scheduled job reads it from there rather than carrying it in a plist. Shell
environment variables still override the file for a single run.

`EBIRD_ARCHIVE_DIR` defaults to `./ebird-archive` when unset. Both the archive
and the analysis output are gitignored — see the note on redistribution below.

### External drive safety

If `EBIRD_ARCHIVE_DIR` points under `/Volumes` (macOS) or `/mnt` `/media`
(Linux), the scripts verify the volume is **actually mounted** before writing,
by checking that it sits on a different device than its parent.

This is not paranoia. With the drive unplugged, macOS lets you create
`/Volumes/LaCie` as an ordinary folder on the boot disk, and you would silently
fill internal storage for weeks without noticing. Both scripts refuse and exit
non-zero instead — so a scheduled job reports the failure rather than hiding it.

### Commands

```bash
npm run ebird:probe                  # 1 request — reports what the API returned
npm run ebird:pull                   # yesterday
npm run ebird:pull -- --days 30      # backfill the whole available window
npm run ebird:pull -- --dry-run      # plan the requests, send none
npm run ebird:analyze                # analyse the archive → ./ebird-analysis
npm run ebird:analyze -- --out /Volumes/LaCie/faunterra/analysis
npm run ebird:schedule -- --check    # validate the daily job setup
```

Settings come from `.env.local` (copy `.env.local.example`), so you do not have
to export anything before each run. Values already in your environment win, so
`EBIRD_REGIONS=IN-TN npm run ebird:pull` still overrides the file for one run.

The puller is **idempotent**: a day already on disk is skipped without spending
a request, so re-running it daily costs one request per region per new day.
Writes are atomic (temp file + rename), so an interrupted pull cannot leave a
half-written day that later gets skipped as "already archived".

Start with `ebird:probe`. It spends exactly one request and tells you how many
rows came back versus how many distinct species — which is how you find out
whether the endpoint gives you every observation or collapses to one row per
species. Calibrate on the real response before planning a 30-day backfill.

### Scheduling the daily pull

Use **launchd**, not cron. A laptop is asleep at 3am: cron silently skips the
run and that day is lost permanently, because the API window does not wait.
launchd runs a missed job when the machine next wakes.

```bash
cp .env.local.example .env.local && chmod 600 .env.local   # add your token
npm run ebird:schedule -- --check       # validate, change nothing
npm run ebird:schedule -- --print       # show the job, write nothing
npm run ebird:schedule -- --install     # write + load the agent
npm run ebird:schedule -- --status      # loaded? last run? recent log lines
npm run ebird:schedule -- --uninstall
```

Defaults to 09:00 local with `--days 3`. Override with `--hour`, `--minute`,
`--days`. The three-day overlap means a couple of missed runs self-heal at no
extra cost, since already-archived days are skipped.

`--install` refuses to proceed if preflight fails, rather than installing a job
that will quietly fail every morning at nine.

**The token is not in the plist.** `~/Library/LaunchAgents/*.plist` is an
ordinary file in your home directory and ends up in backups. The job reads
`.env.local` from the repo root instead — gitignored, and preflight warns if it
is group- or world-readable.

**The scheduled job does not inherit your shell.** A token you only ever
`export`ed in a terminal will pass an interactive test and fail at 9am, so
preflight checks for it in the file specifically, not in the environment.

Verify it works without waiting a day:

```bash
launchctl kickstart -k gui/$(id -u)/com.faunterra.ebird
npm run ebird:schedule -- --status
```

On Linux, `--print` emits the equivalent cron line and the systemd `OnCalendar`
setting (with `Persistent=true`, systemd's equivalent of catching up a missed
run). `--install` is macOS-only and says so rather than half-working.

### Analysis output

`ebird:analyze` prints a terminal report and writes tidy CSVs:

| File | Grain |
|---|---|
| `observations.csv` | one row per observation — the one to load into pandas/R |
| `species-summary.csv` | one row per species (reports, locations, first/last seen) |
| `daily-summary.csv` | one row per region-day |
| `locations.csv` | one row per location, ranked by species richness |
| `accumulation.csv` | cumulative distinct species by date |
| `summary.json` | totals and date range, machine-readable |

```python
import pandas as pd
df = pd.read_csv('ebird-analysis/observations.csv', parse_dates=['date'])
df.groupby('comName').size().sort_values(ascending=False).head(20)
```

```r
library(readr); library(dplyr)
obs <- read_csv("ebird-analysis/observations.csv")
obs |> count(comName, sort = TRUE)
```

### Read this before you draw a conclusion

These are **descriptive counts, not ecological inference**. Raw eBird counts
confound *more birds* with *more birders* — a species trending upward may just
mean the weekend was nice. Effort correction needs the duration, distance,
protocol and observer-count variables, which live in the **eBird Basic Dataset**,
not the API. For population trends or occupancy modelling, request the EBD and
use [`auk`](https://cran.r-project.org/package=auk).

Treat what comes out of here as **reporting leads**, not results.

### Terms

Aggregated analytical results are shareable; the raw database is not. The
archive and analysis directories are gitignored for exactly that reason — a
public repo is republishing. Credit the Cornell Lab of Ornithology and eBird on
anything public, and keep your API token out of the repo.

---

## Content Policy

**We publish:**
- Species recovery stories
- Habitat restoration milestones
- Rewilding achievements
- Community conservation success
- Conservation technology innovations
- Scientific discoveries
- Protected area achievements
- Citizen science contributions

**We never publish:**
- Poaching or wildlife crime
- Human-wildlife conflict
- Forest fires or disasters
- Political controversies
- Climate doom content
- Negative or alarming stories

---

## Customisation

### Change article card styles
Edit `src/components/ArticleCard.tsx`

### Change the quote divider text
Edit `src/app/page.tsx` — search for `"The wild was never outside us."`

### Change the roundup writing style
Edit the `prompt` in `scripts/automate.mjs` → `generateWeeklyRoundup()`

### Add/remove RSS sources
Edit the `SOURCES` array in `scripts/automate.mjs`

---

## Environment Variables

### Website pipeline (GitHub Actions)

| Variable | Required | Description |
|----------|----------|-------------|
| `EBIRD_API_TOKEN` | No | eBird API key. Absent, the eBird pass logs a skip and RSS curation continues. |
| `EBIRD_REGIONS` | No | Comma-separated eBird region codes. Defaults to `IN`. |

### Local archive & analysis

| Variable | Required | Description |
|----------|----------|-------------|
| `EBIRD_API_TOKEN` | Yes | Required by `ebird:pull`; it exits non-zero without one. |
| `EBIRD_REGIONS` | No | Comma-separated region codes. Defaults to `IN`. |
| `EBIRD_ARCHIVE_DIR` | No | Archive location. Defaults to `./ebird-archive`. Verified as mounted if it points at an external volume. |

> **Note:** `ANTHROPIC_API_KEY` was previously listed here as required. The
> curation engine does not read it — `scripts/automate.mjs` reads no environment
> variables at all and runs on keyword scoring plus AFINN sentiment, as its own
> header states. The "Built With" and "Estimated Costs" sections below still
> describe an LLM-backed pipeline that the code does not currently implement.

---

## Built With

- **Next.js 14** — Static site generation
- **Tailwind CSS** — Styling (Faunterra design system)
- **Claude claude-sonnet-4-20250514** — Filtering + summarisation + editorial writing
- **rss-parser** — RSS feed fetching
- **GitHub Actions** — Automated scheduling
- **Cloudflare Pages** — Hosting + CDN

---

## Estimated Costs

| Service | Cost |
|---------|------|
| Cloudflare Pages | Free |
| GitHub Actions | Free (2000 min/month) |
| Anthropic API (6hr runs) | ~$2–5/month (depending on article volume) |

---

*Faunterra Field Journal — documenting meaningful progress in nature, biodiversity, restoration, and coexistence.*
