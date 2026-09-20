#!/usr/bin/env node
/**
 * Faunterra — local eBird archive analysis
 *
 * Reads the date-partitioned archive built by ebird-pull.mjs and produces:
 *   - a terminal report (quick look)
 *   - observations.csv  — tidy, one row per observation, for pandas / R / Excel
 *   - daily-summary.csv — one row per region-day, for trend work
 *   - species-summary.csv — one row per species
 *   - summary.json      — the same numbers, machine-readable
 *
 * The archive is the record; everything here is derived and safe to delete.
 * Re-run it any time.
 *
 * A deliberate non-goal: this does not model occupancy or abundance. Raw eBird
 * counts confound "more birds" with "more birders" — without the effort
 * variables in the eBird Basic Dataset (duration, distance, protocol, observer
 * count), a rising count is not evidence of a rising population. This computes
 * descriptive statistics and says so. Treat them as reporting leads, not results.
 *
 * USAGE
 *   node scripts/ebird-analyze.mjs
 *   node scripts/ebird-analyze.mjs --out /Volumes/LaCie/faunterra/analysis
 */

import fs   from 'fs';
import path from 'path';
import { resolveArchiveDir, loadEnvFile } from './ebird-pull.mjs';

// ── CSV writing. Quote everything that could break a cell. ────
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map(c => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

// ── Load every archived day ───────────────────────────────────
export function loadArchive(archiveDir, { readdirSync = fs.readdirSync, readFileSync = fs.readFileSync } = {}) {
  const observations = [];
  const days         = [];

  let regions;
  try {
    regions = readdirSync(archiveDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return { observations, days, regions: [] };
  }

  for (const region of regions) {
    const regionDir = path.join(archiveDir, region);
    const files = readdirSync(regionDir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .sort();

    for (const f of files) {
      let payload;
      try {
        payload = JSON.parse(readFileSync(path.join(regionDir, f), 'utf-8'));
      } catch {
        console.log(`  warning: could not parse ${region}/${f} — skipping`);
        continue;
      }
      const rows = Array.isArray(payload.observations) ? payload.observations : [];
      days.push({
        region,
        date:     payload.date ?? f.replace('.json', ''),
        rowCount: rows.length,
        species:  new Set(rows.map(r => r.speciesCode).filter(Boolean)).size,
        pulledAt: payload.pulledAt ?? null,
      });
      for (const r of rows) {
        observations.push({
          region,
          date:        payload.date ?? f.replace('.json', ''),
          speciesCode: r.speciesCode ?? null,
          comName:     r.comName ?? null,
          sciName:     r.sciName ?? null,
          locId:       r.locId ?? null,
          locName:     r.locName ?? null,
          obsDt:       r.obsDt ?? null,
          howMany:     typeof r.howMany === 'number' ? r.howMany : null,
          lat:         typeof r.lat === 'number' ? r.lat : null,
          lng:         typeof r.lng === 'number' ? r.lng : null,
          // eBird review state. An unreviewed rarity is a claim, not a record.
          obsValid:    r.obsValid ?? null,
          obsReviewed: r.obsReviewed ?? null,
        });
      }
    }
  }
  return { observations, days, regions };
}

// ── Descriptive statistics ────────────────────────────────────
export function analyze({ observations, days, regions }) {
  const bySpecies = new Map();
  const byLoc     = new Map();

  for (const o of observations) {
    if (o.speciesCode) {
      const s = bySpecies.get(o.speciesCode) ?? {
        speciesCode: o.speciesCode, comName: o.comName, sciName: o.sciName,
        reports: 0, totalCounted: 0, locations: new Set(), dates: new Set(),
      };
      s.reports += 1;
      if (typeof o.howMany === 'number') s.totalCounted += o.howMany;
      if (o.locId) s.locations.add(o.locId);
      if (o.date)  s.dates.add(o.date);
      bySpecies.set(o.speciesCode, s);
    }
    if (o.locId) {
      const l = byLoc.get(o.locId) ?? {
        locId: o.locId, locName: o.locName, lat: o.lat, lng: o.lng,
        reports: 0, species: new Set(),
      };
      l.reports += 1;
      if (o.speciesCode) l.species.add(o.speciesCode);
      byLoc.set(o.locId, l);
    }
  }

  const speciesRows = [...bySpecies.values()].map(s => ({
    speciesCode:   s.speciesCode,
    comName:       s.comName,
    sciName:       s.sciName,
    reports:       s.reports,
    totalCounted:  s.totalCounted || null,
    locationCount: s.locations.size,
    daysSeen:      s.dates.size,
    firstSeen:     [...s.dates].sort()[0] ?? null,
    lastSeen:      [...s.dates].sort().slice(-1)[0] ?? null,
  })).sort((a, b) => b.reports - a.reports);

  const locationRows = [...byLoc.values()].map(l => ({
    locId:        l.locId,
    locName:      l.locName,
    lat:          l.lat,
    lng:          l.lng,
    reports:      l.reports,
    speciesCount: l.species.size,
  })).sort((a, b) => b.speciesCount - a.speciesCount);

  const dailyRows = days
    .slice()
    .sort((a, b) => (a.region + a.date).localeCompare(b.region + b.date))
    .map(d => ({ region: d.region, date: d.date, observations: d.rowCount, species: d.species }));

  const allDates = [...new Set(days.map(d => d.date))].sort();

  // Species accumulation: how many distinct species the archive has seen by
  // each date. A curve still climbing steeply means the archive is young.
  const seen = new Set();
  const accumulation = allDates.map(date => {
    for (const o of observations) {
      if (o.date === date && o.speciesCode) seen.add(o.speciesCode);
    }
    return { date, cumulativeSpecies: seen.size };
  });

  return {
    generatedAt:  new Date().toISOString(),
    attribution:  'eBird (https://ebird.org), Cornell Lab of Ornithology.',
    caveat:       'Descriptive counts only. eBird counts confound observation ' +
                  'effort with abundance; effort variables require the eBird Basic Dataset.',
    regions,
    dateRange:    { from: allDates[0] ?? null, to: allDates.slice(-1)[0] ?? null, days: allDates.length },
    totals: {
      observations:  observations.length,
      species:       bySpecies.size,
      locations:     byLoc.size,
      archivedDays:  days.length,
    },
    speciesRows,
    locationRows,
    dailyRows,
    accumulation,
  };
}

// ── Main ──────────────────────────────────────────────────────
function main() {
  const argv   = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx !== -1 && argv[outIdx + 1]
    ? argv[outIdx + 1]
    : path.join(process.cwd(), 'ebird-analysis');

  loadEnvFile();

  let archive;
  try {
    archive = resolveArchiveDir(process.env.EBIRD_ARCHIVE_DIR);
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  }

  console.log('\n  eBird archive analysis');
  console.log(`  archive: ${archive.dir}`);
  console.log('─'.repeat(60));

  const loaded = loadArchive(archive.dir);
  if (loaded.observations.length === 0) {
    console.log('\n  Archive is empty. Run: npm run ebird:pull -- --days 30\n');
    process.exit(1);
  }

  const a = analyze(loaded);

  console.log(`\n  ${a.totals.observations} observations · ${a.totals.species} species · ` +
              `${a.totals.locations} locations`);
  console.log(`  ${a.dateRange.days} day(s) archived: ${a.dateRange.from} → ${a.dateRange.to}`);
  console.log(`  regions: ${a.regions.join(', ')}`);

  console.log('\n  Most reported species');
  for (const s of a.speciesRows.slice(0, 10)) {
    console.log(`    ${String(s.reports).padStart(5)}  ${(s.comName ?? s.speciesCode).slice(0, 38).padEnd(38)} ` +
                `${s.locationCount} loc, ${s.daysSeen}d`);
  }

  console.log('\n  Richest locations');
  for (const l of a.locationRows.slice(0, 10)) {
    console.log(`    ${String(l.speciesCount).padStart(5)} spp  ${(l.locName ?? l.locId).slice(0, 48)}`);
  }

  const last = a.accumulation.slice(-1)[0];
  const prev = a.accumulation.slice(-2)[0];
  if (last && prev) {
    const delta = last.cumulativeSpecies - prev.cumulativeSpecies;
    console.log(`\n  Species accumulation: ${last.cumulativeSpecies} total ` +
                `(+${delta} on the most recent day)`);
    if (delta > 0) {
      console.log('    Still climbing — the archive has not saturated. Keep pulling daily.');
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, content) => {
    fs.writeFileSync(path.join(outDir, name), content);
    console.log(`    ${name}`);
  };

  console.log(`\n  Writing to ${outDir}`);
  write('observations.csv', toCsv(loaded.observations, [
    'region','date','speciesCode','comName','sciName','locId','locName',
    'obsDt','howMany','lat','lng','obsValid','obsReviewed',
  ]));
  write('species-summary.csv', toCsv(a.speciesRows, [
    'speciesCode','comName','sciName','reports','totalCounted',
    'locationCount','daysSeen','firstSeen','lastSeen',
  ]));
  write('daily-summary.csv', toCsv(a.dailyRows, ['region','date','observations','species']));
  write('locations.csv', toCsv(a.locationRows, [
    'locId','locName','lat','lng','reports','speciesCount',
  ]));
  write('accumulation.csv', toCsv(a.accumulation, ['date','cumulativeSpecies']));
  write('summary.json', JSON.stringify({
    generatedAt: a.generatedAt, attribution: a.attribution, caveat: a.caveat,
    regions: a.regions, dateRange: a.dateRange, totals: a.totals,
  }, null, 2));

  console.log(`\n  ${a.caveat}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
