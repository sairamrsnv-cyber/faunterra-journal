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
├─ ebird-core/     pure Rust. HTTP, sanitisation, archive writes, rollups.
│                  No GUI dependency anywhere — compiles, tests and RUNS headless.
├─ src-tauri/      the window. Thin: commands in, events out. Nothing decides
│                  anything about data here.
└─ ui/             the interface. One file, no external requests.
```

The split is load-bearing, not tidiness. `ebird-core` can be verified on a
machine with no display, which means a GUI failure can never be mistaken for a
data failure — and the data path is the part that must not be wrong.

## Running it

```bash
npm install                 # @tauri-apps/cli only
npm run dev                 # the window, with hot reload
npm run build               # a signed-able .app + .dmg in src-tauri/target/release/bundle
```

Headless, no window needed:

```bash
npm run pull -- --days 30   # backfill the whole API window
npm run pull -- --probe     # one request; report what actually came back
npm run pull -- --json      # one JSON object per line, timestamped
npm run pull -- --summary   # archive rollup as JSON
```

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
EBIRD_API_BASE=http://127.0.0.1:8788/v2 npm run pull -- --days 4
```

The fixture speaks eBird's response shape over a real socket. The puller is not
mocked or stubbed — only the base URL changes, so parsing, sanitisation, atomic
writes and rollups all run exactly as they do in production. Rows it produces
are generated, and are marked `"live": false` inside every archive file they
land in; the window shows a banner the whole time.

One thing the fixture cannot settle: whether the real endpoint returns every
observation or collapses to one row per species. The docs do not say. Run
`npm run pull -- --probe` once against the live API — it spends exactly one
request and tells you.

## Attribution

Data from [eBird](https://ebird.org), Cornell Lab of Ornithology. The archive
is not redistributed; see `.gitignore`.
