# Faunterra Data Station

A desktop application that builds a local archive of eBird observations, one
day at a time, and shows you exactly what it is doing while it does it.

## Why it exists

The eBird API serves a **rolling ~30-day window**. Anything older is not
expensive to retrieve — it is *unavailable*, short of formally requesting the
eBird Basic Dataset. So this is not a fetcher. It is an **archive builder**:
run it daily and you accumulate a time series the API itself cannot hand you
retroactively. Miss a month and that month is gone.

That single fact drives every design decision below.

## Shape of the project

```
desktop/
├─ ebird-core/     pure Rust. Everything that touches eBird data.
│  └─ src/bin/
│     ├─ pull      builds the local archive, one day at a time
│     ├─ signals   the website's field-signals digest → data/ebird-signals.json
│     ├─ analyze   the archive → tidy CSVs for pandas / R
│     ├─ schedule  installs the daily pull as a launchd agent
│     └─ fixture   a local stand-in that speaks eBird's response shape
├─ src-tauri/      the window. Thin: commands in, events out. Nothing decides
│                  anything about data here.
└─ ui/             the interface. One file, no external requests.
```

**This is the only eBird implementation in the repository.** The Node scripts
that used to do this — a digest fetcher, an archive puller, an analyser and a
scheduler — are gone. They shared the eBird response contract by convention,
which is a promise nothing enforced; now there is one definition of a sighting
and one place a field name can be wrong.

`ebird-core` has no GUI dependency anywhere in its tree, so it compiles, tests
and runs headless — in CI, in a container, over SSH. That is what makes the
website's digest and the desktop app able to share it.

The split is load-bearing, not tidiness. `ebird-core` can be verified on a
machine with no display, which means a GUI failure can never be mistaken for a
data failure — and the data path is the part that must not be wrong.

## Running it

```bash
npm install                 # @tauri-apps/cli only
npm run dev                 # the window, with hot reload
npm run build               # a signed-able .app + .dmg in src-tauri/target/release/bundle
```

Headless, no window needed. Each is a separate binary:

```bash
cargo run -p ebird-core --bin pull -- --days 30   # backfill the whole window
cargo run -p ebird-core --bin pull -- --probe     # one request; what came back?
cargo run -p ebird-core --bin pull -- --json      # timestamped event stream
cargo run -p ebird-core --bin pull -- --summary   # archive rollup as JSON

cargo run -p ebird-core --bin signals             # the website digest
cargo run -p ebird-core --bin signals -- --stdout # print it, write nothing

cargo run -p ebird-core --bin analyze             # → ./ebird-analysis/*.csv
cargo run -p ebird-core --bin schedule -- --check # preflight the daily job
```

### The daily pull

```bash
cargo build --release                             # schedule points at ./pull
cargo run -p ebird-core --bin schedule -- --check
cargo run -p ebird-core --bin schedule -- --install
launchctl kickstart -k gui/$(id -u)/com.faunterra.ebird
```

**launchd, not cron.** cron does not run what it missed: close the lid at 23:00
and a 09:00 job simply never happened. For an archive whose entire value is
continuity, against an API that will not sell you back a missed day, that is
the one failure worth engineering against.

`--install` refuses when preflight fails. An agent that fails silently every
morning is worse than no agent, because you believe you have an archive.

### The website digest

`signals` replaces what used to be a pass inside the Node curation script. Two
requests per region — notable sightings over a 14-day window, plus one day of
activity figures — and that is the whole budget.

It exits 0 and writes nothing when there is no key or eBird is unreachable.
That is deliberate: a stale page is a small problem, and a build that fails at
06:00 because a third party had a bad morning is a larger one. It never turns
an absent figure into a zero, because "no checklists submitted" and "we could
not ask" are different claims.

## Configuration

A `.env.local` beside the app (or in `~/.faunterra` for a bundled build):

```sh
EBIRD_API_TOKEN=...                                   # required
EBIRD_REGIONS=IN-KL,IN-KA                             # default: IN
EBIRD_ARCHIVE_DIR=/Volumes/LaCie/faunterra/ebird-archive
```

**The token belongs in the file, not your shell.** A scheduled job does not
inherit your environment — a key that works when you run it by hand and
vanishes at 09:00 is the most common way this kind of automation fails
silently.

**Use a dedicated Faunterra eBird account.** Not a personal one. eBird
suspends API abuse at the account level, and you do not want a script to be
able to cost you your own birding records.

## Four decisions worth knowing about

**Contributor names never reach disk.** `userDisplayName` and friends are
stripped in memory the moment a response is parsed — before the write, not
during it. The log reports the fields it *actually* removed, per field, so the
claim is auditable rather than decorative.

**An unplugged drive is refused, not silently worked around.** Pull the LaCie
out and macOS will happily let the next process *create* `/Volumes/LaCie` as an
ordinary folder on the boot disk. Days of pulls then fill internal storage
while every log line looks healthy. A real mount sits on a different device
than its parent; if it does not, the app stops.

**Writes are atomic and days are never rewritten.** A day already on disk is
skipped without spending a request. That rule turns a half-written file into a
permanent hole, so every write goes to a temp file and is renamed into place: a
day is either absent or complete.

**Counts are descriptive, and say so.** eBird records confound observation
effort with abundance — more birders on a holiday weekend looks exactly like
more birds. Separating them needs effort variables that live in the eBird Basic
Dataset, not the API. Every summary carries that caveat.

## Verifying the pull path without spending quota

```bash
cargo run -p ebird-core --bin fixture 8788 &
EBIRD_API_BASE=http://127.0.0.1:8788/v2 cargo run -p ebird-core --bin pull -- --days 4
EBIRD_API_BASE=http://127.0.0.1:8788/v2 cargo run -p ebird-core --bin signals -- --stdout
```

The fixture speaks eBird's response shape over a real socket. The puller is not
mocked or stubbed — only the base URL changes, so parsing, sanitisation, atomic
writes and rollups all run exactly as they do in production. Rows it produces
are generated, and are marked `"live": false` inside every archive file they
land in; the window shows a banner the whole time.

It serves all three endpoints the tools use, including the two behind the
digest, so the publishing path is testable too.

One thing the fixture cannot settle: whether the real endpoint returns every
observation or collapses to one row per species. The docs do not say, and the
answer decides what the archive can ever tell you. Run `pull --probe` once
against the live API — it spends exactly one request and reports the answer.

### Tests

```bash
cargo test -p ebird-core      # 28, no network required
cargo clippy -p ebird-core --all-targets -- -D warnings
cargo fmt -p ebird-core -- --check
```

The suite leans toward the failures that are expensive and silent: a name
surviving to disk, a day written half-way, an unreviewed rarity marked
confirmed, a headline number that is a property of the display rather than the
data. CI runs all three on every push.

## Attribution

Data from [eBird](https://ebird.org), Cornell Lab of Ornithology. The archive
is not redistributed; see `.gitignore`.
