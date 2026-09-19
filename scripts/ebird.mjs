#!/usr/bin/env node
/**
 * Faunterra Journal — eBird signal fetcher
 *
 * Pulls live field signals from the eBird API 2.0 (Cornell Lab of Ornithology)
 * and digests them into an editorial summary. This is the "what nature actually
 * did this week" counterpart to the RSS feed's "what people wrote about nature".
 *
 * Design constraints, deliberately:
 *
 *   - RESTRAINT. Two requests per region per run. The eBird docs ask callers to
 *     use the API sparingly; abuse risks key suspension. Do not loop this.
 *   - AGGREGATE, DON'T MIRROR. We publish a digest, not a copy of the database.
 *     Bulk redistribution is a licensing question; a weekly summary is not.
 *   - NO OBSERVER NAMES. `detail=full` returns `userDisplayName`. Birders did not
 *     submit checklists to be named on a third-party site. We drop the field.
 *   - FAIL SOFT. No key, bad key, timeout, 500 — log it and return null. The
 *     conservation RSS pipeline must never die because a bird API had a bad day.
 *
 * Auth:  set EBIRD_API_TOKEN (free key: https://ebird.org/api/keygen)
 * Regions: set EBIRD_REGIONS as a comma-separated list of eBird region codes
 *          (e.g. "IN,IN-KA,IN-TN"). Defaults to "IN".
 *
 * Attribution is required and is written into the output file.
 */

const API_BASE = 'https://api.ebird.org/v2';

// The API's own default lookback is 14 days. We stay at the default rather than
// pushing to the documented maximum — it is the polite setting and the one whose
// behaviour is least likely to change under us.
const LOOKBACK_DAYS = 14;

const REQUEST_TIMEOUT_MS = 15000;
const MAX_NOTABLE        = 60;

export const EBIRD_ATTRIBUTION =
  'Observation data from eBird (https://ebird.org), a project of the ' +
  'Cornell Lab of Ornithology. Contributed by volunteer birdwatchers worldwide.';

// ── Low-level request ─────────────────────────────────────────
async function ebirdGet(pathname, token, params = {}) {
  const url = new URL(API_BASE + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'x-ebirdapitoken': token, 'Accept': 'application/json' },
      signal:  controller.signal,
    });

    if (!res.ok) {
      // 403 almost always means a missing or revoked key, not a bad region.
      const hint = res.status === 403 ? ' (check EBIRD_API_TOKEN)' : '';
      console.log(`    ${pathname} → HTTP ${res.status}${hint}`);
      return null;
    }

    const body = await res.json();
    return body;
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : err.message.slice(0, 60);
    console.log(`    ${pathname} → failed (${reason})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Shape a raw observation into something publishable ────────
// Raw eBird observations carry more than we want to restate. We keep what makes
// an editorial line — species, place, date, count — and drop the rest.
export function shapeObservation(obs) {
  if (!obs || typeof obs !== 'object') return null;
  if (!obs.comName || !obs.speciesCode)  return null;

  // `obsValid` / `obsReviewed` appear with detail=full. A rare-bird report that
  // has not cleared review is a claim, not a fact — we carry the flag through so
  // the front end can hedge the language instead of asserting a rarity.
  const reviewed  = obs.obsReviewed === true;
  const valid     = obs.obsValid !== false;   // absent → assume not-yet-flagged
  const confirmed = reviewed && valid;

  return {
    speciesCode: obs.speciesCode,
    comName:     obs.comName,
    sciName:     obs.sciName ?? null,
    locName:     obs.locName ?? null,
    locId:       obs.locId ?? null,
    obsDt:       obs.obsDt ?? null,
    howMany:     typeof obs.howMany === 'number' ? obs.howMany : null,
    lat:         typeof obs.lat === 'number' ? obs.lat : null,
    lng:         typeof obs.lng === 'number' ? obs.lng : null,
    confirmed,
    reviewed,
    checklistUrl: obs.subId ? `https://ebird.org/checklist/${obs.subId}` : null,
    speciesUrl:   `https://ebird.org/species/${obs.speciesCode}`,
    // Deliberately NOT carried through: userDisplayName, subId as a bare field,
    // obsAux, and anything else that identifies the contributor.
  };
}

// ── Rank notable sightings for editorial interest ─────────────
// Confirmed beats unconfirmed; recent beats stale; everything else is a tiebreak
// on how many distinct places reported it (a one-off is a better story than a
// bird that is quietly everywhere).
export function rankNotable(observations) {
  const bySpecies = new Map();

  for (const obs of observations) {
    const entry = bySpecies.get(obs.speciesCode);
    if (!entry) {
      bySpecies.set(obs.speciesCode, { ...obs, reportCount: 1, locations: new Set([obs.locName]) });
      continue;
    }
    entry.reportCount += 1;
    if (obs.locName) entry.locations.add(obs.locName);
    // Keep the most recent, preferring a confirmed record over an unconfirmed one.
    const better = (obs.confirmed && !entry.confirmed) ||
                   (obs.confirmed === entry.confirmed && (obs.obsDt ?? '') > (entry.obsDt ?? ''));
    if (better) Object.assign(entry, obs, { reportCount: entry.reportCount, locations: entry.locations });
  }

  return [...bySpecies.values()]
    .map(e => ({ ...e, locationCount: e.locations.size, locations: undefined }))
    .sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
      return (b.obsDt ?? '').localeCompare(a.obsDt ?? '');
    });
}

// ── Yesterday, in UTC, as the API's y/m/d path segments ───────
// Today's stats are always partial — checklists land all day. Yesterday is the
// most recent complete picture.
function yesterdayParts() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

// ── One region ────────────────────────────────────────────────
async function fetchRegion(regionCode, token) {
  const { y, m, d } = yesterdayParts();

  // Two calls. That is the whole budget.
  const [notableRaw, stats] = await Promise.all([
    ebirdGet(`/data/obs/${regionCode}/recent/notable`, token, {
      back:       LOOKBACK_DAYS,
      detail:     'full',
      maxResults: MAX_NOTABLE,
    }),
    ebirdGet(`/product/stats/${regionCode}/${y}/${m}/${d}`, token),
  ]);

  if (notableRaw === null && stats === null) return null;

  const shaped  = Array.isArray(notableRaw)
    ? notableRaw.map(shapeObservation).filter(Boolean)
    : [];
  const notable = rankNotable(shaped);

  return {
    code:        regionCode,
    windowDays:  LOOKBACK_DAYS,
    statsDate:   `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    // `stats` fields are absent on days with no activity; null beats a fake zero.
    numChecklists:   stats?.numChecklists   ?? null,
    numContributors: stats?.numContributors ?? null,
    numSpecies:      stats?.numSpecies      ?? null,
    notableCount:    notable.length,
    confirmedCount:  notable.filter(n => n.confirmed).length,
    notable:         notable.slice(0, 20),
  };
}

// ── Public entry point ────────────────────────────────────────
// Returns a digest object, or null if eBird is unconfigured or unreachable.
// Never throws.
export async function fetchBirdSignals() {
  const token = process.env.EBIRD_API_TOKEN?.trim();

  if (!token) {
    console.log('  eBird: EBIRD_API_TOKEN not set — skipping (this is not an error)');
    return null;
  }

  // Note `||` not `??`: GitHub Actions passes an unset `vars.*` as an empty
  // string, not undefined, and `??` would not fall back on it.
  const regions = (process.env.EBIRD_REGIONS || 'IN')
    .split(',')
    .map(r => r.trim())
    .filter(Boolean);

  if (regions.length === 0) {
    console.log('  eBird: EBIRD_REGIONS parsed to nothing — skipping');
    return null;
  }

  console.log(`  eBird: ${regions.length} region(s), ${LOOKBACK_DAYS}-day window\n`);

  const results = [];
  for (const code of regions) {
    process.stdout.write(`  ${code}… `);
    try {
      const region = await fetchRegion(code, token);
      if (region) {
        results.push(region);
        console.log(
          `${region.notableCount} notable species` +
          (region.numChecklists !== null ? `, ${region.numChecklists} checklists` : '')
        );
      } else {
        console.log('no data');
      }
    } catch (err) {
      // fetchRegion already swallows request errors; this is the belt to that
      // braces — a shape we did not anticipate must not kill the run.
      console.log(`failed (${err.message.slice(0, 50)})`);
    }
  }

  if (results.length === 0) return null;

  return {
    lastUpdated: new Date().toISOString(),
    source:      'eBird API 2.0',
    sourceUrl:   'https://ebird.org',
    attribution: EBIRD_ATTRIBUTION,
    regions:     results,
  };
}

// Allow `node scripts/ebird.mjs` for a standalone smoke test.
if (import.meta.url === `file://${process.argv[1]}`) {
  const signals = await fetchBirdSignals();
  console.log(signals ? JSON.stringify(signals, null, 2) : 'No signals.');
}
