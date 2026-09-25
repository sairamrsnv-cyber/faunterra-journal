import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  Article, ArticleStore, WeeklyRoundup, RoundupStore,
  BirdSignalStore, BirdObservation,
} from './types';

const DATA_DIR = join(process.cwd(), 'data');

function readJSON<T>(filename: string, fallback: T): T {
  try {
    const raw = readFileSync(join(DATA_DIR, filename), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Faunterra original stories ────────────────────────────────
export function getFaunterraSrticles(): Article[] {
  const store = readJSON<ArticleStore>('faunterra-articles.json', {
    lastUpdated: new Date().toISOString(),
    articles: [],
  });
  return store.articles.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

// ── Curated conservation wins ─────────────────────────────────
export function getCuratedArticles(): Article[] {
  const store = readJSON<ArticleStore>('curated-articles.json', {
    lastUpdated: new Date().toISOString(),
    articles: [],
  });
  return store.articles.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

// ── Weekly roundup ────────────────────────────────────────────
export function getLatestRoundup(): WeeklyRoundup | null {
  const store = readJSON<RoundupStore>('weekly-roundup.json', {
    lastGenerated: '',
    roundups: [],
  });
  if (!store.roundups.length) return null;
  return store.roundups.sort(
    (a, b) => new Date(b.weekEnding).getTime() - new Date(a.weekEnding).getTime()
  )[0];
}

// ── Combined feed for homepage ────────────────────────────────
export function getJournalData() {
  const faunterra    = getFaunterraSrticles();
  const curated      = getCuratedArticles();
  const roundup      = getLatestRoundup();
  const birdSignals  = getBirdSignals();
  const featured     = faunterra.find(a => a.featured) ?? faunterra[0] ?? null;
  const secondary    = faunterra.filter(a => a !== featured).slice(0, 12);

  // Headline figures, counted rather than asserted.
  //
  // These used to be hardcoded in the page: "48 Published Essays" above six
  // articles, "22 Contributors" with no author field anywhere in the schema.
  // A number in a hero is a claim, and a claim about our own publication
  // record is not covered by any disclaimer about third-party data. Counting
  // them means they are right now and stay right later.
  // The categories we actually have something to show for. A filter offering
  // ten options when four have articles is a promise of nine empty grids.
  // Array.from rather than a spread: tsconfig targets ES5 here, where
  // spreading a Set needs downlevelIteration.
  const presentCategories = Array.from(
    new Set([...faunterra, ...curated].map(a => a.category as string)),
  );

  const stats = {
    essays:     faunterra.length,
    wins:       curated.length,
    categories: presentCategories.length,
  };

  return {
    featured, secondary, faunterra, curated, roundup, birdSignals,
    stats, presentCategories,
  };
}

// ── eBird field signals ───────────────────────────────────────
export function getBirdSignals(): BirdSignalStore | null {
  const store = readJSON<BirdSignalStore | null>('ebird-signals.json', null);
  if (!store?.regions?.length) return null;
  return store;
}

/**
 * Notable sightings across all regions, best editorial candidates first.
 * Confirmed records lead — an unreviewed rarity is a claim, and the UI should
 * say "reported" rather than asserting it.
 */
export function getNotableSightings(limit = 12): BirdObservation[] {
  const store = getBirdSignals();
  if (!store) return [];

  return store.regions
    .flatMap(r => r.notable)
    .sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
      return (b.obsDt ?? '').localeCompare(a.obsDt ?? '');
    })
    .slice(0, limit);
}
