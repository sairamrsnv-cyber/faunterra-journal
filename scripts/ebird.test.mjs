#!/usr/bin/env node
/**
 * Faunterra Journal — eBird digest tests
 *
 * The eBird API cannot be reached from CI without a key, and we would not want
 * tests that depend on live rare-bird reports anyway. These run the pure digest
 * functions against a fixture shaped like a real `detail=full` response.
 *
 * Run: npm run test:ebird
 */
import { shapeObservation, rankNotable } from './ebird.mjs';

const FIXTURE = [
  // Same species, two reports, different places. Newer one is CONFIRMED.
  { speciesCode:'gybwar1', comName:'Grey-bellied Warbler', sciName:'Phylloscopus tytleri',
    locId:'L123', locName:'Ranganathittu BS', obsDt:'2026-09-14 07:30', howMany:2,
    lat:12.42, lng:76.66, obsValid:true, obsReviewed:true, subId:'S9001',
    userDisplayName:'Priya R' },
  { speciesCode:'gybwar1', comName:'Grey-bellied Warbler', sciName:'Phylloscopus tytleri',
    locId:'L124', locName:'Kokkare Bellur', obsDt:'2026-09-11 06:10', howMany:1,
    lat:12.60, lng:77.01, obsValid:true, obsReviewed:false, subId:'S9002',
    userDisplayName:'A. Kumar' },
  // Unconfirmed rarity, very recent — must NOT outrank the confirmed record.
  { speciesCode:'amaphe1', comName:'Amur Falcon', sciName:'Falco amurensis',
    locId:'L200', locName:'Doyang Reservoir', obsDt:'2026-09-18 16:45', howMany:340,
    lat:26.05, lng:94.42, obsValid:true, obsReviewed:false, subId:'S9003',
    userDisplayName:'Field Team' },
  // Explicitly invalid — reviewed and rejected.
  { speciesCode:'baleag',  comName:'Bald Eagle', sciName:'Haliaeetus leucocephalus',
    locId:'L300', locName:'Somewhere Improbable', obsDt:'2026-09-17 09:00', howMany:1,
    lat:1.0, lng:1.0, obsValid:false, obsReviewed:true, subId:'S9004',
    userDisplayName:'Anon' },
  // Malformed rows the API can emit — must be dropped, not crash.
  { speciesCode:'nocomname', obsDt:'2026-09-13 10:00' },
  null,
  'not an object',
];

const shaped = FIXTURE.map(shapeObservation).filter(Boolean);
const ranked = rankNotable(shaped);

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}`); }
};

check('malformed rows dropped (7 in → 4 shaped)', shaped.length === 4);
check('observer names stripped everywhere',
  !JSON.stringify(shaped).includes('Priya') &&
  !JSON.stringify(shaped).includes('userDisplayName'));
check('dedup by species (4 shaped → 3 unique)', ranked.length === 3);
check('duplicate species keeps reportCount=2',
  ranked.find(r => r.speciesCode === 'gybwar1')?.reportCount === 2);
check('duplicate species counts 2 distinct locations',
  ranked.find(r => r.speciesCode === 'gybwar1')?.locationCount === 2);
check('confirmed record ranks first, ahead of newer unconfirmed',
  ranked[0].speciesCode === 'gybwar1' && ranked[0].confirmed === true);
check('recent-but-unreviewed Amur Falcon is NOT marked confirmed',
  ranked.find(r => r.speciesCode === 'amaphe1')?.confirmed === false);
check('reviewed-and-rejected record is NOT confirmed',
  ranked.find(r => r.speciesCode === 'baleag')?.confirmed === false);
check('checklist URL built from subId',
  ranked[0].checklistUrl === 'https://ebird.org/checklist/S9001');
check('species URL built from speciesCode',
  ranked[0].speciesUrl === 'https://ebird.org/species/gybwar1');
check('internal `locations` Set not leaked into output',
  ranked.every(r => r.locations === undefined));
check('output is JSON-serialisable (no Set/Map leakage)',
  (() => { try { JSON.parse(JSON.stringify(ranked)); return true; } catch { return false; } })());

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
