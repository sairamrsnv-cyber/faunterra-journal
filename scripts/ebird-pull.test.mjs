#!/usr/bin/env node
/**
 * Faunterra — archive puller & analyzer tests
 *
 * The eBird API needs a key and returns non-deterministic data, so these test
 * the pure logic: the external-volume guard, UTC date handling, contributor
 * stripping, CSV escaping, and the full load→analyze path over a synthetic
 * archive written to a temp directory.
 *
 * Run: npm run test:ebird
 */
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { resolveArchiveDir, targetDates, sanitize } from './ebird-pull.mjs';
import { csvCell, toCsv, loadArchive, analyze }     from './ebird-analyze.mjs';
import { parseEnvFile, loadEnvFile }               from './ebird-pull.mjs';
import { xmlEscape, buildPlist, runChecks, LABEL } from './ebird-schedule.mjs';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}`); }
};
const throws = (fn, re) => {
  try { fn(); return false; } catch (e) { return re.test(e.message); }
};

console.log('\n  Archive location guard');

// A plain relative path is ours to create — no guard.
check('local path is unguarded',
  resolveArchiveDir('/home/user/proj/ebird-archive', { platform: 'darwin' }).guarded === false);

check('empty value falls back to cwd/ebird-archive',
  resolveArchiveDir('', { platform: 'darwin' }).dir.endsWith('ebird-archive'));

// The dangerous case: drive unplugged, /Volumes/LaCie is a folder on the boot
// disk. Same st_dev as /Volumes means it is not a real mount.
const sameDev = p => ({ dev: 1, isDirectory: () => true });
check('refuses an unmounted volume that is really a boot-disk folder',
  throws(() => resolveArchiveDir('/Volumes/LaCie/faunterra', {
    platform: 'darwin', statSync: sameDev,
  }), /folder on the system disk/));

// A genuinely mounted volume: different device to its parent. Mount ROOTS
// live on the system disk (dev 1); anything mounted under them does not.
const MOUNT_ROOTS = ['/Volumes', '/mnt', '/media'];
const realMount = p => ({ dev: MOUNT_ROOTS.includes(p) ? 1 : 42, isDirectory: () => true });
check('accepts a genuinely mounted volume',
  resolveArchiveDir('/Volumes/LaCie/faunterra', {
    platform: 'darwin', statSync: realMount,
  }).guarded === true);

check('reports the volume it verified',
  resolveArchiveDir('/Volumes/LaCie/faunterra', {
    platform: 'darwin', statSync: realMount,
  }).volume === '/Volumes/LaCie');

// Drive absent entirely — stat throws.
check('refuses when the volume is absent',
  throws(() => resolveArchiveDir('/Volumes/LaCie/x', {
    platform: 'darwin', statSync: () => { throw new Error('ENOENT'); },
  }), /not present|plugged in/));

check('guards /mnt and /media on linux',
  resolveArchiveDir('/mnt/ext/arch', { platform: 'linux', statSync: realMount }).guarded === true
);

check('does not guard /Volumes on linux',
  resolveArchiveDir('/Volumes/x/y', { platform: 'linux' }).guarded === false);

console.log('\n  Dates');
const fixedNow = new Date('2026-09-19T03:00:00Z');
const d1 = targetDates(1, fixedNow);
check('one day back is yesterday in UTC', d1.length === 1 && d1[0].iso === '2026-09-18');
check('date parts match the ISO string',
  d1[0].y === 2026 && d1[0].m === 9 && d1[0].d === 18);

const d5 = targetDates(5, fixedNow);
check('N days back returns N descending days',
  d5.length === 5 && d5[0].iso === '2026-09-18' && d5[4].iso === '2026-09-14');

// Month boundary, and a UTC hour that would be the previous day locally.
const boundary = targetDates(2, new Date('2026-03-01T00:30:00Z'));
check('crosses a month boundary correctly',
  boundary[0].iso === '2026-02-28' && boundary[1].iso === '2026-02-27');

console.log('\n  Contributor stripping');
check('sanitize removes userDisplayName',
  sanitize({ comName: 'X', userDisplayName: 'Someone' }).userDisplayName === undefined);
check('sanitize keeps everything else',
  sanitize({ comName: 'X', speciesCode: 'y', userDisplayName: 'S' }).speciesCode === 'y');
check('sanitize rejects non-objects', sanitize(null) === null && sanitize('str') === null);

console.log('\n  CSV escaping');
check('plain value is unquoted', csvCell('Indian Pitta') === 'Indian Pitta');
check('comma forces quoting', csvCell('Ranganathittu, Karnataka') === '"Ranganathittu, Karnataka"');
check('embedded quotes are doubled', csvCell('He said "hi"') === '"He said ""hi"""');
check('newline forces quoting', csvCell('a\nb') === '"a\nb"');
check('null becomes empty, not the string "null"', csvCell(null) === '' && csvCell(undefined) === '');
check('zero survives as 0, not empty', csvCell(0) === '0');
check('toCsv emits a header plus one line per row',
  toCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }], ['a', 'b']) === 'a,b\n1,2\n3,4\n');

console.log('\n  Load and analyze a synthetic archive');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ebird-test-'));
const mk = (region, date, rows) => {
  fs.mkdirSync(path.join(tmp, region), { recursive: true });
  fs.writeFileSync(path.join(tmp, region, `${date}.json`),
    JSON.stringify({ region, date, pulledAt: '2026-09-19T00:00:00Z',
                     rowCount: rows.length, observations: rows }));
};

mk('IN-KA', '2026-09-17', [
  { speciesCode:'inpitt1', comName:'Indian Pitta', sciName:'Pitta brachyura',
    locId:'L1', locName:'Ranganathittu, Karnataka', obsDt:'2026-09-17 06:20',
    howMany:2, lat:12.42, lng:76.66, obsValid:true, obsReviewed:true },
  { speciesCode:'houcro1', comName:'House Crow', locId:'L2', locName:'Bengaluru',
    obsDt:'2026-09-17 08:00', howMany:15, lat:12.97, lng:77.59 },
]);
mk('IN-KA', '2026-09-18', [
  { speciesCode:'inpitt1', comName:'Indian Pitta', locId:'L2', locName:'Bengaluru',
    obsDt:'2026-09-18 06:30', howMany:1, lat:12.97, lng:77.59 },
  { speciesCode:'mallar3', comName:'Malabar Lark', locId:'L1',
    locName:'Ranganathittu, Karnataka', obsDt:'2026-09-18 07:15', howMany:null },
]);
// A corrupt file must be skipped, not crash the run.
fs.writeFileSync(path.join(tmp, 'IN-KA', '2026-09-16.json'), '{ not json');
// A .tmp file from an interrupted write must be ignored.
fs.writeFileSync(path.join(tmp, 'IN-KA', '2026-09-15.json.tmp'), '{}');

const loaded = loadArchive(tmp);
check('loads only valid, non-tmp days', loaded.days.length === 2);
check('loads all observations across days', loaded.observations.length === 4);
check('corrupt file did not crash the load', loaded.regions.includes('IN-KA'));

const a = analyze(loaded);
check('counts distinct species', a.totals.species === 3);
check('counts distinct locations', a.totals.locations === 2);
check('counts observations', a.totals.observations === 4);
check('date range spans the archived days',
  a.dateRange.from === '2026-09-17' && a.dateRange.to === '2026-09-18' && a.dateRange.days === 2);

const pitta = a.speciesRows.find(s => s.speciesCode === 'inpitt1');
check('species seen twice has reports=2', pitta.reports === 2);
check('species seen at two locations has locationCount=2', pitta.locationCount === 2);
check('species seen on two days has daysSeen=2', pitta.daysSeen === 2);
check('firstSeen/lastSeen bracket the archive',
  pitta.firstSeen === '2026-09-17' && pitta.lastSeen === '2026-09-18');
check('totalCounted sums howMany, ignoring nulls', pitta.totalCounted === 3);
check('species with only null counts reports totalCounted as null',
  a.speciesRows.find(s => s.speciesCode === 'mallar3').totalCounted === null);
check('species rows are sorted by reports descending',
  a.speciesRows[0].reports >= a.speciesRows[1].reports);

check('accumulation is monotonically non-decreasing',
  a.accumulation.every((p, i, arr) => i === 0 || p.cumulativeSpecies >= arr[i-1].cumulativeSpecies));
check('accumulation ends at the total species count',
  a.accumulation.slice(-1)[0].cumulativeSpecies === a.totals.species);

check('CSV export escapes a location name containing a comma',
  toCsv(loaded.observations, ['locName']).includes('"Ranganathittu, Karnataka"'));
check('analysis carries the effort caveat', /confound/.test(a.caveat));
check('analysis carries eBird attribution', /Cornell/.test(a.attribution));

check('empty archive dir returns empty, does not throw',
  loadArchive(path.join(tmp, 'does-not-exist')).observations.length === 0);

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n  Env file parsing');
const envText = [
  '# a comment',
  '',
  'EBIRD_API_TOKEN=abc123',
  'export EBIRD_REGIONS=IN-KA,IN-TN',
  'QUOTED="has spaces"',
  "SINGLE='also quoted'",
  'WITH_EQUALS=a=b=c',
  'EMPTY=',
  '   # indented comment',
  'no_equals_line',
].join('\n');
const env = parseEnvFile(envText);
check('parses a bare key=value', env.EBIRD_API_TOKEN === 'abc123');
check('strips an export prefix', env.EBIRD_REGIONS === 'IN-KA,IN-TN');
check('strips surrounding double quotes', env.QUOTED === 'has spaces');
check('strips surrounding single quotes', env.SINGLE === 'also quoted');
check('keeps = inside a value', env.WITH_EQUALS === 'a=b=c');
check('allows an empty value', env.EMPTY === '');
check('ignores comments and blank lines', env['# a comment'] === undefined);
check('ignores a line with no =', env.no_equals_line === undefined);

const envTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ebird-env-'));
const envFile = path.join(envTmp, '.env.local');
fs.writeFileSync(envFile, 'FOO=from_file\nBAR=from_file\n');
const fakeEnv = { BAR: 'from_shell' };
const res = loadEnvFile(envFile, fakeEnv);
check('loads values that are unset', fakeEnv.FOO === 'from_file');
check('does NOT override a value already in the environment', fakeEnv.BAR === 'from_shell');
check('reports which keys it set', res.keys.includes('FOO') && !res.keys.includes('BAR'));
check('missing env file is not an error',
  loadEnvFile(path.join(envTmp, 'nope'), {}).loaded === false);
fs.rmSync(envTmp, { recursive: true, force: true });

console.log('\n  Scheduler plist');
check('xmlEscape handles ampersand', xmlEscape('a & b') === 'a &amp; b');
check('xmlEscape handles angle brackets', xmlEscape('<x>') === '&lt;x&gt;');
check('xmlEscape leaves ordinary text alone', xmlEscape('/Users/me/repo') === '/Users/me/repo');

const good = {
  label: LABEL, nodePath: '/usr/local/bin/node',
  scriptPath: '/Users/me/repo/scripts/ebird-pull.mjs',
  workingDir: '/Users/me/repo', days: 3, hour: 9, minute: 0,
  outLog: '/Users/me/Library/Logs/o.log', errLog: '/Users/me/Library/Logs/e.log',
};
const plist = buildPlist(good);
check('plist declares the label', plist.includes(`<string>${LABEL}</string>`));
check('plist uses an absolute node path', plist.includes('<string>/usr/local/bin/node</string>'));
check('plist passes the lookback window', plist.includes('<string>--days</string>') && plist.includes('<string>3</string>'));
check('plist sets the run time', plist.includes('<key>Hour</key><integer>9</integer>'));
check('plist does NOT contain an API token',
  !/EBIRD_API_TOKEN/.test(plist) && !/EnvironmentVariables/.test(plist));
check('plist does not run at load', plist.includes('<key>RunAtLoad</key>\n  <false/>'));

check('rejects a relative node path',
  throws(() => buildPlist({ ...good, nodePath: 'node' }), /must be absolute/));
check('rejects a relative script path',
  throws(() => buildPlist({ ...good, scriptPath: 'scripts/x.mjs' }), /must be absolute/));
check('rejects an out-of-range hour',
  throws(() => buildPlist({ ...good, hour: 24 }), /hour out of range/));
check('rejects a negative minute',
  throws(() => buildPlist({ ...good, minute: -1 }), /minute out of range/));
check('rejects days beyond the API window',
  throws(() => buildPlist({ ...good, days: 31 }), /days out of range/));
check('rejects a non-integer hour',
  throws(() => buildPlist({ ...good, hour: 9.5 }), /hour out of range/));

const escaped = buildPlist({ ...good, workingDir: '/Users/me/R&D/repo' });
check('escapes an ampersand in a path', escaped.includes('/Users/me/R&amp;D/repo'));

console.log('\n  Scheduler preflight');
const checksNoEnv = runChecks({ env: {}, existsSync: () => false });
check('preflight flags a missing .env.local',
  checksNoEnv.find(c => c.label === '.env.local present')?.ok === false);
check('preflight flags a token that is not in the file',
  checksNoEnv.find(c => c.label === 'EBIRD_API_TOKEN in .env.local')?.ok === false);
check('preflight reports the platform honestly',
  checksNoEnv.find(c => c.label === 'platform is macOS')?.ok === (process.platform === 'darwin'));
check('preflight mutates nothing (returns plain data)',
  Array.isArray(checksNoEnv) && checksNoEnv.every(c => typeof c.ok === 'boolean'));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
