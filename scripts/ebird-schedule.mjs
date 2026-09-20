#!/usr/bin/env node
/**
 * Faunterra — install the daily eBird pull as a scheduled job
 *
 * WHY LAUNCHD AND NOT CRON
 * A laptop is asleep at 3am. cron silently skips the run and you lose that
 * day permanently — the API's ~30-day window does not wait. launchd runs a
 * missed StartCalendarInterval job when the machine next wakes.
 *
 * NO SECRETS IN THE PLIST
 * ~/Library/LaunchAgents/*.plist is an ordinary file in your home directory
 * and ends up in backups. The generated job carries no API token: the puller
 * reads .env.local from the repo root, which is already gitignored.
 *
 * USAGE
 *   node scripts/ebird-schedule.mjs --check       # validate setup, change nothing
 *   node scripts/ebird-schedule.mjs --print       # show the plist, write nothing
 *   node scripts/ebird-schedule.mjs --install     # write + load the agent
 *   node scripts/ebird-schedule.mjs --status      # is it loaded? when did it last run?
 *   node scripts/ebird-schedule.mjs --uninstall   # unload + remove
 *
 *   --hour N --minute N   when to run (default 09:00 local)
 *   --days N              lookback per run (default 3, so missed days self-heal)
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { REPO_ROOT, resolveArchiveDir, loadEnvFile } from './ebird-pull.mjs';

export const LABEL = 'com.faunterra.ebird';

// ── plist generation ──────────────────────────────────────────
// Every interpolated value is escaped. A path or label containing & or < would
// otherwise produce a plist that launchd rejects with a uselessly vague error.
export function xmlEscape(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildPlist({ label, nodePath, scriptPath, workingDir, days, hour, minute, outLog, errLog }) {
  if (!path.isAbsolute(nodePath))   throw new Error(`nodePath must be absolute: ${nodePath}`);
  if (!path.isAbsolute(scriptPath)) throw new Error(`scriptPath must be absolute: ${scriptPath}`);
  if (!Number.isInteger(hour)   || hour   < 0 || hour   > 23) throw new Error(`hour out of range: ${hour}`);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error(`minute out of range: ${minute}`);
  if (!Number.isInteger(days)   || days   < 1 || days   > 30) throw new Error(`days out of range: ${days}`);

  const args = [nodePath, scriptPath, '--days', String(days)]
    .map(a => `    <string>${xmlEscape(a)}</string>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDir)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(errLog)}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

// ── prerequisites ─────────────────────────────────────────────
// Each check returns {ok, label, detail}. Nothing here mutates anything.
export function runChecks({ env = process.env, existsSync = fs.existsSync, statSync = fs.statSync } = {}) {
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok, label, detail });

  const nodePath = process.execPath;
  add(path.isAbsolute(nodePath), 'node binary resolvable', nodePath);

  const scriptPath = path.join(REPO_ROOT, 'scripts', 'ebird-pull.mjs');
  add(existsSync(scriptPath), 'puller present', scriptPath);

  const envFile = path.join(REPO_ROOT, '.env.local');
  const hasEnvFile = existsSync(envFile);
  add(hasEnvFile, '.env.local present', hasEnvFile ? envFile : `missing — create ${envFile}`);

  // The token must come from the file, because the scheduled job will not
  // inherit your shell. A token that only exists in the current shell would
  // make --check pass and the 9am run fail.
  let tokenInFile = false;
  if (hasEnvFile) {
    try { tokenInFile = /^\s*(export\s+)?EBIRD_API_TOKEN\s*=\s*\S/m.test(fs.readFileSync(envFile, 'utf-8')); }
    catch { /* unreadable — reported by the permissions check below */ }
  }
  add(tokenInFile, 'EBIRD_API_TOKEN in .env.local',
      tokenInFile ? 'found' : 'the scheduled job does not inherit your shell — it must be in the file');

  if (hasEnvFile) {
    try {
      const mode = statSync(envFile).mode & 0o777;
      const tight = (mode & 0o077) === 0;
      add(tight, '.env.local not group/world readable',
          tight ? `mode ${mode.toString(8)}` : `mode ${mode.toString(8)} — run: chmod 600 ${envFile}`);
    } catch { add(false, '.env.local readable', 'could not stat'); }
  }

  try {
    const a = resolveArchiveDir(env.EBIRD_ARCHIVE_DIR);
    add(true, 'archive location usable', a.guarded ? `${a.dir} (volume ${a.volume} mounted)` : a.dir);
  } catch (err) {
    add(false, 'archive location usable', err.message);
  }

  add(process.platform === 'darwin', 'platform is macOS',
      process.platform === 'darwin' ? 'darwin' : `${process.platform} — see --print for a cron/systemd equivalent`);

  return checks;
}

// ── CLI ───────────────────────────────────────────────────────
function num(argv, flag, dflt) {
  const i = argv.indexOf(flag);
  if (i === -1 || i === argv.length - 1) return dflt;
  const n = Number(argv[i + 1]);
  return Number.isInteger(n) ? n : dflt;
}

function config(argv) {
  return {
    label:      LABEL,
    nodePath:   process.execPath,
    scriptPath: path.join(REPO_ROOT, 'scripts', 'ebird-pull.mjs'),
    workingDir: REPO_ROOT,
    days:       num(argv, '--days', 3),
    hour:       num(argv, '--hour', 9),
    minute:     num(argv, '--minute', 0),
    outLog:     path.join(os.homedir(), 'Library', 'Logs', 'faunterra-ebird.out.log'),
    errLog:     path.join(os.homedir(), 'Library', 'Logs', 'faunterra-ebird.err.log'),
  };
}

const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function printChecks() {
  const checks = runChecks();
  console.log('\n  Preflight\n');
  for (const c of checks) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.label.padEnd(34)} ${c.detail}`);
  }
  const failed = checks.filter(c => !c.ok);
  console.log(failed.length ? `\n  ${failed.length} check(s) failed.\n` : '\n  All checks passed.\n');
  return failed.length === 0;
}

function launchctl(args) {
  return execFileSync('launchctl', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  const argv = process.argv.slice(2);
  loadEnvFile();
  const cfg = config(argv);

  if (argv.includes('--check')) { process.exit(printChecks() ? 0 : 1); }

  if (argv.includes('--print')) {
    if (process.platform !== 'darwin') {
      console.log(`\n  Not macOS. Equivalent daily job elsewhere:\n`);
      console.log(`  cron:    ${cfg.minute} ${cfg.hour} * * *  cd ${cfg.workingDir} && ${cfg.nodePath} ${cfg.scriptPath} --days ${cfg.days}`);
      console.log(`  systemd: a .timer with OnCalendar=*-*-* ${String(cfg.hour).padStart(2,'0')}:${String(cfg.minute).padStart(2,'0')}:00 and Persistent=true`);
      console.log(`\n  Persistent=true is the systemd equivalent of launchd catching up a missed run.\n`);
      console.log('  The macOS plist would be:\n');
    }
    console.log(buildPlist(cfg));
    return;
  }

  if (argv.includes('--status')) {
    if (process.platform !== 'darwin') { console.log('\n  --status is macOS-only.\n'); process.exit(1); }
    console.log(`\n  plist: ${plistPath()} ${fs.existsSync(plistPath()) ? '(present)' : '(absent)'}`);
    try { console.log(`  launchctl:\n${launchctl(['list', LABEL])}`); }
    catch { console.log('  launchctl: not loaded'); }
    for (const [name, f] of [['stdout', cfg.outLog], ['stderr', cfg.errLog]]) {
      if (!fs.existsSync(f)) { console.log(`  ${name}: no log yet (${f})`); continue; }
      const lines = fs.readFileSync(f, 'utf-8').trimEnd().split('\n').slice(-6);
      console.log(`  ${name} (${f}), last lines:`);
      for (const l of lines) console.log(`    ${l}`);
    }
    console.log('');
    return;
  }

  if (argv.includes('--uninstall')) {
    if (process.platform !== 'darwin') { console.log('\n  --uninstall is macOS-only.\n'); process.exit(1); }
    try { launchctl(['unload', plistPath()]); console.log('  unloaded'); }
    catch { console.log('  was not loaded'); }
    if (fs.existsSync(plistPath())) { fs.unlinkSync(plistPath()); console.log(`  removed ${plistPath()}`); }
    else console.log('  no plist to remove');
    console.log('');
    return;
  }

  if (argv.includes('--install')) {
    if (process.platform !== 'darwin') {
      console.error('\n  --install is macOS-only. Use --print for a cron or systemd equivalent.\n');
      process.exit(1);
    }
    if (!printChecks()) {
      console.error('  Refusing to install with failing checks. Fix them, or use --print to inspect.\n');
      process.exit(1);
    }
    const p = plistPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.mkdirSync(path.dirname(cfg.outLog), { recursive: true });
    if (fs.existsSync(p)) { try { launchctl(['unload', p]); } catch { /* not loaded */ } }
    fs.writeFileSync(p, buildPlist(cfg), { mode: 0o644 });
    launchctl(['load', p]);
    console.log(`  installed ${p}`);
    console.log(`  runs daily at ${String(cfg.hour).padStart(2,'0')}:${String(cfg.minute).padStart(2,'0')} local, --days ${cfg.days}`);
    console.log(`  logs: ${cfg.outLog}`);
    console.log(`\n  Verify now without waiting:  launchctl kickstart -k gui/$(id -u)/${LABEL}`);
    console.log(`  Then:                        npm run ebird:schedule -- --status\n`);
    return;
  }

  console.log(`
  eBird daily pull scheduler

    --check       validate the setup, change nothing
    --print       show the job definition, write nothing
    --install     write + load the launchd agent (macOS)
    --status      loaded? last run? recent log lines
    --uninstall   unload + remove

    --hour N --minute N   run time (default 09:00 local)
    --days N              lookback per run (default 3)
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
