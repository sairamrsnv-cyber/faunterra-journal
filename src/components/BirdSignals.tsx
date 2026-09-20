import type { BirdSignalStore, BirdRegionSignal, BirdObservation } from '../lib/types';

/**
 * Live field signals from eBird.
 *
 * Two editorial rules are load-bearing here, not decorative:
 *
 * 1. An unreviewed rare-bird report is a CLAIM, not a record. eBird regional
 *    editors review flagged sightings; until that clears, the honest verb is
 *    "reported". We never print an unreviewed rarity as established fact, and
 *    the distinction is carried by a text label — never by colour alone, which
 *    would vanish for a colourblind reader or in print.
 *
 * 2. eBird's terms require attribution wherever the data appears. It renders
 *    at the foot of the section, from the `attribution` string in the data.
 */

// eBird region codes are opaque to readers. Known codes get a name; anything
// unrecognised falls through to the raw code rather than being invented.
const REGION_NAMES: Record<string, string> = {
  IN: 'India',
  'IN-AP': 'Andhra Pradesh', 'IN-AR': 'Arunachal Pradesh', 'IN-AS': 'Assam',
  'IN-BR': 'Bihar',          'IN-CT': 'Chhattisgarh',      'IN-GA': 'Goa',
  'IN-GJ': 'Gujarat',        'IN-HR': 'Haryana',           'IN-HP': 'Himachal Pradesh',
  'IN-JH': 'Jharkhand',      'IN-KA': 'Karnataka',         'IN-KL': 'Kerala',
  'IN-MP': 'Madhya Pradesh', 'IN-MH': 'Maharashtra',       'IN-MN': 'Manipur',
  'IN-ML': 'Meghalaya',      'IN-MZ': 'Mizoram',           'IN-NL': 'Nagaland',
  'IN-OR': 'Odisha',         'IN-PB': 'Punjab',            'IN-RJ': 'Rajasthan',
  'IN-SK': 'Sikkim',         'IN-TN': 'Tamil Nadu',        'IN-TG': 'Telangana',
  'IN-TR': 'Tripura',        'IN-UP': 'Uttar Pradesh',     'IN-UT': 'Uttarakhand',
  'IN-WB': 'West Bengal',    'IN-AN': 'Andaman & Nicobar', 'IN-LD': 'Lakshadweep',
  'IN-DL': 'Delhi',          'IN-JK': 'Jammu & Kashmir',   'IN-LA': 'Ladakh',
};
const regionName = (code: string) => REGION_NAMES[code] ?? code;

// eBird's obsDt is "YYYY-MM-DD HH:mm" in the observation's LOCAL time, with no
// zone attached. Handing that to `new Date()` would reinterpret it in the build
// machine's zone and can shift the date by a day. We read the parts directly.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function dateParts(value: string | null) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? { day: Number(m[3]), month, year: m[1] } : null;
}

/** "18 Sep" — for a sighting, where the year is implied by the 14-day window. */
function formatObsDate(obsDt: string | null): string | null {
  const p = dateParts(obsDt);
  return p ? `${p.day} ${p.month}` : null;
}

/** "19 Sep 2026" — for the stats date, which stands alone. */
function formatStatsDate(value: string | null): string | null {
  const p = dateParts(value);
  return p ? `${p.day} ${p.month} ${p.year}` : null;
}

// The attribution string is self-contained for non-HTML consumers, so it
// carries its URL inline. Here we render a real link instead, and drop the
// parenthetical so the address does not appear twice in one sentence.
function stripInlineUrl(text: string): string {
  return text.replace(/\s*\(https?:\/\/[^)]+\)/g, '').trim();
}

// ── A headline number ─────────────────────────────────────────
// A handful of standalone figures is a stat row, not a chart. No plot, so no
// hover layer; `null` prints an em dash rather than a fabricated zero.
function Stat({ value, label }: { value: number | null; label: string }) {
  return (
    <div>
      <div className="font-display font-light text-forest-deep text-3xl leading-none mb-1.5">
        {value === null ? '—' : value.toLocaleString('en-IN')}
      </div>
      <div className="font-ui text-[0.55rem] font-600 tracking-[0.15em] uppercase text-moss/70">
        {label}
      </div>
    </div>
  );
}

// ── One sighting ──────────────────────────────────────────────
function SightingCard({ obs }: { obs: BirdObservation }) {
  const when  = formatObsDate(obs.obsDt);
  const where = obs.locName;

  return (
    <article className="article-card bg-white border border-[rgba(107,112,92,0.1)] p-6 flex flex-col">
      {/* Review state. Text first — colour is reinforcement, never the signal. */}
      <div className="mb-4">
        {obs.confirmed ? (
          <span className="win-badge">Confirmed</span>
        ) : (
          <span className="font-ui text-[0.54rem] font-700 tracking-[0.18em] uppercase px-2.5 py-1 text-moss/60 border border-[rgba(107,112,92,0.25)]">
            Reported · under review
          </span>
        )}
      </div>

      <h3 className="font-display font-normal text-forest-deep text-xl leading-snug mb-1">
        {obs.comName}
      </h3>
      {obs.sciName && (
        <p className="font-display italic font-light text-moss/55 text-sm mb-4">
          {obs.sciName}
        </p>
      )}

      <dl className="font-body text-xs font-light text-moss/70 leading-relaxed space-y-1 mb-5">
        {where && (
          <div className="flex gap-2">
            <dt className="sr-only">Location</dt>
            <dd>{where}</dd>
          </div>
        )}
        <div className="flex gap-3 text-moss/50">
          {when && <><dt className="sr-only">Date</dt><dd>{when}</dd></>}
          {obs.howMany !== null && (
            <><dt className="sr-only">Count</dt>
              <dd>{obs.howMany === 1 ? '1 bird' : `${obs.howMany.toLocaleString('en-IN')} birds`}</dd></>
          )}
        </div>
        {obs.locationCount > 1 && (
          <div>
            <dt className="sr-only">Spread</dt>
            <dd className="text-moss/50">
              {obs.reportCount} reports across {obs.locationCount} locations
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-auto pt-4 border-t border-[rgba(107,112,92,0.1)] flex items-center gap-5">
        <a
          href={obs.speciesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-ui text-[0.55rem] font-600 tracking-[0.15em] uppercase text-moss hover:text-forest transition-colors"
        >
          Species
        </a>
        {obs.checklistUrl && (
          <a
            href={obs.checklistUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ui text-[0.55rem] font-600 tracking-[0.15em] uppercase text-moss hover:text-forest transition-colors"
          >
            Checklist
          </a>
        )}
      </div>
    </article>
  );
}

// ── One region ────────────────────────────────────────────────
function RegionBlock({ region }: { region: BirdRegionSignal }) {
  const hasStats =
    region.numChecklists !== null ||
    region.numContributors !== null ||
    region.numSpecies !== null;
  const statsOn = formatStatsDate(region.statsDate);

  return (
    <div className="mb-16 last:mb-0">
      <div className="flex items-end justify-between gap-8 flex-wrap pb-6 mb-8 border-b border-[rgba(107,112,92,0.1)]">
        <div>
          <h3 className="font-display font-light text-forest-deep text-2xl md:text-3xl">
            {regionName(region.code)}
          </h3>
          {hasStats && statsOn && (
            <p className="font-body text-[0.7rem] font-light text-moss/50 mt-1.5">
              Activity recorded {statsOn}
            </p>
          )}
        </div>
        {hasStats && (
          <div className="flex gap-10">
            <Stat value={region.numSpecies}      label="Species" />
            <Stat value={region.numChecklists}   label="Checklists" />
            <Stat value={region.numContributors} label="Observers" />
          </div>
        )}
      </div>

      {region.notable.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {region.notable.map(obs => (
            <SightingCard key={`${region.code}-${obs.speciesCode}`} obs={obs} />
          ))}
        </div>
      ) : (
        <p className="font-display italic text-moss/50 text-lg py-8">
          No unusual sightings reported here in the last {region.windowDays} days.
        </p>
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────
export function BirdSignalsSection({ signals }: { signals: BirdSignalStore }) {
  const totalNotable = signals.regions.reduce((n, r) => n + r.notableCount, 0);
  const confirmed    = signals.regions.reduce((n, r) => n + r.confirmedCount, 0);
  const windowDays   = signals.regions[0]?.windowDays ?? 14;

  return (
    <section className="py-20 px-6 md:px-12 lg:px-20 bg-ivory border-t border-[rgba(107,112,92,0.1)]">
      <div className="max-w-[1400px] mx-auto">

        <div className="mb-12">
          <span className="label text-bronze block mb-2">Section 03 · Live field data</span>
          <div className="flex items-end justify-between gap-8 flex-wrap">
            <h2 className="font-display font-light text-forest-deep text-4xl md:text-5xl">
              Field <em className="italic">Signals</em>
            </h2>
            <p className="font-body text-sm font-light text-moss/65 max-w-sm leading-relaxed">
              Unusual birds reported in the last {windowDays} days, drawn from checklists
              submitted by volunteer birdwatchers. Not what was written about nature —
              what was observed.
            </p>
          </div>
        </div>

        {totalNotable > 0 && (
          <p className="font-body text-xs font-light text-moss/55 mb-12 pb-10 border-b border-[rgba(107,112,92,0.1)] max-w-2xl leading-relaxed">
            {totalNotable} notable species reported
            {confirmed > 0 && <>, {confirmed} confirmed by regional reviewers</>}.
            Rare-bird reports are published as reported until review clears them, so
            treat anything marked <em className="italic">under review</em> as a claim
            rather than a record.
          </p>
        )}

        {signals.regions.map(region => (
          <RegionBlock key={region.code} region={region} />
        ))}

        {/* Attribution is required by eBird's terms of use. */}
        <p className="font-body text-[0.68rem] font-light text-moss/45 leading-relaxed mt-16 pt-8 border-t border-[rgba(107,112,92,0.1)]">
          {stripInlineUrl(signals.attribution)}{' '}
          <a
            href={signals.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-bronze hover:text-bronze-2 transition-colors"
          >
            ebird.org
          </a>
        </p>

      </div>
    </section>
  );
}

// ── Placeholder ───────────────────────────────────────────────
// Shown until an eBird key is configured, matching how the other sections
// handle an empty data file rather than collapsing the page.
export function BirdSignalsPlaceholder() {
  return (
    <section className="py-20 px-6 md:px-12 lg:px-20 bg-ivory border-t border-[rgba(107,112,92,0.1)]">
      <div className="max-w-[1400px] mx-auto text-center">
        <span className="label text-bronze block mb-4">Section 03 · Live field data</span>
        <h2 className="font-display font-light text-forest-deep text-4xl md:text-5xl mb-6">
          Field <em className="italic">Signals</em>
        </h2>
        <p className="font-display italic text-moss/50 text-xl max-w-lg mx-auto">
          Live bird observations arrive once the eBird feed is connected.
        </p>
      </div>
    </section>
  );
}
