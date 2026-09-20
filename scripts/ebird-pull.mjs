#!/usr/bin/env node
/**
 * Faunterra — eBird local archive puller
 *
 * WHY THIS EXISTS
 * The eBird API only serves a rolling ~30-day window. Anything older is not
 * retrievable through the API at any price — you would have to request the
 * eBird Basic Dataset instead. So this is not a fetcher, it is an ARCHIVE
 * BUILDER: run it daily and you accumulate a time series the API itself
 * cannot give you retroactively. Miss a month and that month is gone.
 *
 * DESIGN
 *   - Date-partitioned. One file per region per day: <archive>/<region>/<date>.json
 *   - Idempotent. A day already on disk is skipped without spending a request.
 *   - Append-only. Never rewrites an existing day. The archive is the raw
 *     record; analysis is derived and disposable.
 *   - Raw. Stores what the API returned, minus observer names. Analysis
 *     decisions belong downstream, not baked into collection.
 *
 * STORAGE
 * Set EBIRD_ARCHIVE_DIR to put the archive on an external volume, e.g.
 *   EBIRD_ARCHIVE_DIR=/Volumes/LaCie/faunterra/ebird-archive
 * If that path looks like an external mount, we verify it is ACTUALLY mounted
 * before writing. macOS will happily let you create /Volumes/LaCie as an
 * ordinary folder on the boot disk when the drive is unplugged — and you will
 * not notice until the disk is full. We refuse instead.
 *
 * USAGE
 *   node scripts/ebird-pull.mjs              # yesterday only
 *   node scripts/ebird-pull.mjs --days 30    # backfill the full API window
 *   node scripts/ebird-pull.mjs --probe      # 1 request, report what came back
 *   node scripts/ebird-pull.mjs --dry-run    # plan the requests, send none
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const API_BASE           = 'https://api.ebird.org/v2';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESULTS        = 10000;
// Politeness gap between requests. The docs ask for restraint and give no
// published rate number, so we pick a conservative one rather than guess.
const THROTTLE_MS        = 1100;

// ── Env file ──────────────────────────────────────────────────
// Loads .env.local from the repo root so the API token lives in one
// gitignored file rather than being baked into a launchd plist or shell
// history. Values already present in the environment win, so an explicit
// `EBIRD_REGIONS=X npm run ...` still overrides the file.
export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!key) continue;
    let val = t.slice(eq + 1).trim();
    // Strip one matching pair of surrounding quotes, if present.
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadEnvFile(file = path.join(REPO_ROOT, '.env.local'), env = process.env) {
  let text;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return { loaded: false, keys: [] }; }
  const parsed = parseEnvFile(text);
  const keys = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined || env[k] === '') { env[k] = v; keys.push(k); }
  }
  return { loaded: true, keys, file };
}

// ── CLI ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const has = f => argv.includes(f);
  const val = (f, d) => {
    const i = argv.indexOf(f);
    if (i === -1 || i === argv.length - 1) return d;
    const n = Number(argv[i + 1]);
    return Number.isFinite(n) ? n : d;
  };
  return {
    days:   Math.max(1, Math.min(30, val('--days', 1))),
    probe:  has('--probe'),
    dryRun: has('--dry-run'),
  };
}

// ── Archive location, with the unplugged-drive guard ──────────
export function resolveArchiveDir(raw, { platform = process.platform, statSync = fs.statSync } = {}) {
  const dir = raw?.trim() || path.join(process.cwd(), 'ebird-archive');

  // Only guard paths that look like external mounts. A plain ./ebird-archive
  // is ours to create.
  const mountRoots = platform === 'darwin' ? ['/Volumes'] : ['/mnt', '/media'];
  const root = mountRoots.find(r => dir === r || dir.startsWith(r + path.sep));
  if (!root) return { dir, guarded: false };

  // The volume is the first path segment under the mount root.
  const rest   = dir.slice(root.length + 1).split(path.sep)[0];
  const volume = rest ? path.join(root, rest) : null;
  if (!volume) {
    throw new Error(`EBIRD_ARCHIVE_DIR "${dir}" names a mount root with no volume`);
  }

  let volStat, rootStat;
  try {
    volStat  = statSync(volume);
    rootStat = statSync(root);
  } catch {
    throw new Error(
      `Archive volume "${volume}" is not present. Is the drive plugged in and mounted?`
    );
  }

  // A real mount sits on a different device than its parent. Same device means
  // the "drive" is actually a folder on the boot disk.
  if (volStat.dev === rootStat.dev) {
    throw new Error(
      `"${volume}" is a folder on the system disk, not a mounted volume. ` +
      `Refusing to write — plug the drive in, or unset EBIRD_ARCHIVE_DIR.`
    );
  }

  return { dir, guarded: true, volume };
}

// ── Dates ─────────────────────────────────────────────────────
// UTC throughout. The archive filename must mean the same thing regardless of
// which machine, in which timezone, ran the pull.
export function targetDates(days, now = new Date()) {
  const out = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push({
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      iso: d.toISOString().slice(0, 10),
    });
  }
  return out;
}

// ── Strip contributor identity before anything touches disk ───
export function sanitize(obs) {
  if (!obs || typeof obs !== 'object') return null;
  const { userDisplayName, ...rest } = obs;
  return rest;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ebirdGet(pathname, token, params = {}) {
  const url = new URL(API_BASE + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'x-ebirdapitoken': token, 'Accept': 'application/json' },
      signal:  ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, status: err.name === 'AbortError' ? 'timeout' : err.message.slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const args  = parseArgs(process.argv.slice(2));
  const env   = loadEnvFile();
  const token = process.env.EBIRD_API_TOKEN?.trim();
  const regions = (process.env.EBIRD_REGIONS || 'IN')
    .split(',').map(r => r.trim()).filter(Boolean);

  if (!token && !args.dryRun) {
    console.error('  EBIRD_API_TOKEN not set. Get a free key: https://ebird.org/api/keygen');
    process.exit(1);
  }
  if (regions.length === 0) {
    console.error('  EBIRD_REGIONS parsed to nothing.');
    process.exit(1);
  }

  let archive;
  try {
    archive = resolveArchiveDir(process.env.EBIRD_ARCHIVE_DIR);
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  }

  console.log('\n  eBird archive puller');
  if (env.loaded && env.keys.length) {
    console.log(`  env     : ${env.keys.join(', ')} from .env.local`);
  }
  console.log(`  archive : ${archive.dir}${archive.guarded ? '  (external volume, verified mounted)' : ''}`);
  console.log(`  regions : ${regions.join(', ')}`);
  console.log(`  window  : ${args.days} day(s) back from today (UTC)`);
  console.log('─'.repeat(60));

  // --probe: spend exactly one request and describe the response, so we can
  // calibrate against what the API actually does rather than what docs imply.
  if (args.probe) {
    const [day] = targetDates(1);
    const region = regions[0];
    console.log(`\n  Probing ${region} for ${day.iso}…\n`);
    const res = await ebirdGet(
      `/data/obs/${region}/historic/${day.y}/${day.m}/${day.d}`,
      token, { detail: 'full', maxResults: MAX_RESULTS, includeProvisional: true }
    );
    if (!res.ok) { console.log(`  Request failed: ${res.status}`); process.exit(1); }
    const rows = Array.isArray(res.data) ? res.data : [];
    const species = new Set(rows.map(r => r.speciesCode));
    console.log(`  rows returned    : ${rows.length}`);
    console.log(`  distinct species : ${species.size}`);
    console.log(`  rows per species : ${species.size ? (rows.length / species.size).toFixed(2) : 'n/a'}`);
    console.log(
      species.size === rows.length
        ? '\n  → One row per species. This endpoint collapses to a species list;\n' +
          '    per-observation analysis needs the EBD.'
        : '\n  → Multiple rows per species. Full per-observation detail available.'
    );
    console.log(`\n  fields on first row: ${rows[0] ? Object.keys(rows[0]).join(', ') : '(none)'}\n`);
    return;
  }

  const days = targetDates(args.days);
  let fetched = 0, skipped = 0, failed = 0, totalRows = 0;

  for (const region of regions) {
    const regionDir = path.join(archive.dir, region);
    if (!args.dryRun) fs.mkdirSync(regionDir, { recursive: true });

    for (const day of days) {
      const file = path.join(regionDir, `${day.iso}.json`);

      if (fs.existsSync(file)) { skipped++; continue; }
      if (args.dryRun) {
        console.log(`  would fetch  ${region}  ${day.iso}`);
        fetched++;
        continue;
      }

      process.stdout.write(`  ${region}  ${day.iso}  … `);
      const res = await ebirdGet(
        `/data/obs/${region}/historic/${day.y}/${day.m}/${day.d}`,
        token, { detail: 'full', maxResults: MAX_RESULTS, includeProvisional: true }
      );

      if (!res.ok) {
        console.log(`failed (${res.status})`);
        failed++;
        await sleep(THROTTLE_MS);
        continue;
      }

      const rows = (Array.isArray(res.data) ? res.data : []).map(sanitize).filter(Boolean);

      // Write atomically: a half-written day that later gets skipped as
      // "already archived" would be a silent hole in the dataset.
      const payload = {
        region,
        date:        day.iso,
        pulledAt:    new Date().toISOString(),
        source:      'eBird API 2.0 /data/obs/{region}/historic',
        attribution: 'eBird (https://ebird.org), Cornell Lab of Ornithology.',
        rowCount:    rows.length,
        observations: rows,
      };
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, file);

      console.log(`${rows.length} rows`);
      fetched++;
      totalRows += rows.length;
      await sleep(THROTTLE_MS);
    }
  }

  console.log('─'.repeat(60));
  console.log(`  fetched ${fetched}  skipped ${skipped} (already archived)  failed ${failed}`);
  if (totalRows) console.log(`  ${totalRows} observations added`);
  console.log(`  archive: ${archive.dir}\n`);

  if (failed > 0 && fetched === 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
