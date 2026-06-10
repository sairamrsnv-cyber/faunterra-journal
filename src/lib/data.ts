import { readFileSync } from 'fs';
import { join } from 'path';
import type { Article, ArticleStore, WeeklyRoundup, RoundupStore } from './types';

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
  const faunterra  = getFaunterraSrticles();
  const curated    = getCuratedArticles();
  const roundup    = getLatestRoundup();
  const featured   = faunterra.find(a => a.featured) ?? faunterra[0] ?? null;
  const secondary  = faunterra.filter(a => a !== featured).slice(0, 12);

  return { featured, secondary, faunterra, curated, roundup };
}
