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
│   ├── automate.mjs   ← Core automation engine
│   └── ebird.mjs      ← eBird API client + signal digest
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

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |

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
