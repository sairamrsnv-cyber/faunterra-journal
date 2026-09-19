#!/usr/bin/env node
/**
 * Faunterra Journal — Free Curation Engine
 * No paid APIs. Uses RSS + keyword scoring + NLP sentence extraction.
 *
 * 1. Fetch RSS feeds from approved conservation sources
 * 2. Score & filter: keyword exclusion + positive signals + sentiment
 * 3. Extract summary from article excerpt (Natural.js sentence tokeniser)
 * 4. Assign "Why This Matters" from per-category editorial templates
 * 5. Save to data/curated-articles.json
 * 6. Pull live field signals from eBird → data/ebird-signals.json
 * 7. Sundays: generate structured weekly roundup → data/weekly-roundup.json
 */

import Parser  from 'rss-parser';
import natural from 'natural';
import fs      from 'fs';
import path    from 'path';
import crypto  from 'crypto';
import { fileURLToPath } from 'url';
import { fetchBirdSignals } from './ebird.mjs';

const { WordTokenizer, PorterStemmer, SentimentAnalyzer, SentenceTokenizer } = natural;

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR     = path.join(__dirname, '..', 'data');
const TODAY        = new Date();
const IS_SUNDAY    = TODAY.getDay() === 0;
const ROUNDUP_ONLY = process.argv.includes('--roundup');

const wordTok  = new WordTokenizer();
const sentTok  = new SentenceTokenizer();
const analyzer = new SentimentAnalyzer('English', PorterStemmer, 'afinn');

// ── Approved sources ─────────────────────────────────────────
const SOURCES = [
  { name: 'Mongabay India',            url: 'https://india.mongabay.com/feed/',                                   tags: ['India', 'conservation', 'biodiversity'] },
  { name: 'WWF India',                 url: 'https://wwfindia.org/news_facts/?format=feed&type=rss',               tags: ['wildlife', 'India'] },
  { name: 'Wildlife Trust of India',   url: 'https://www.wti.org.in/feed/',                                       tags: ['India', 'wildlife'] },
  { name: 'IUCN News',                 url: 'https://www.iucn.org/news/rss.xml',                                   tags: ['global', 'species', 'conservation'] },
  { name: 'Conservation International',url: 'https://blog.conservation.org/feed/',                                 tags: ['global', 'conservation'] },
  { name: 'Rewilding Europe',          url: 'https://rewildingeurope.com/feed/',                                   tags: ['rewilding', 'Europe'] },
  { name: 'The Better India',          url: 'https://www.thebetterindia.com/category/environment/feed/',           tags: ['India', 'community'] },
  { name: 'Earth.org',                 url: 'https://earth.org/feed/',                                             tags: ['global', 'ecology'] },
  { name: 'Sanctuary Asia',            url: 'https://www.sanctuaryasia.com/feed/',                                 tags: ['India', 'nature'] },
  { name: 'UNEP News',                 url: 'https://www.unep.org/news-and-stories/news/rss.xml',                  tags: ['global', 'policy'] },
  { name: 'Bird Count India',          url: 'https://www.birdcount.in/feed/',                                      tags: ['India', 'birds', 'citizen science'] },
  { name: 'Nature Conservation Foundation', url: 'https://www.ncf-india.org/feed',                                tags: ['India', 'research'] },
];

// ── Hard exclusion keywords (title + excerpt must not contain) ──
const EXCLUDE_TERMS = [
  'poach', 'snare', 'traffick', 'smuggl',
  'killed by', 'gored', 'trampled', 'mauled', 'attack',
  'fatal', 'death toll', 'casualt',
  'wildfire', 'forest fire', 'blaze',
  'flood damage', 'cyclone', 'earthquake', 'tsunami',
  'extinction warning', 'irreversible loss', 'no hope',
  'arrested', 'convicted', 'crime', 'illegal dump',
  'human-wildlife conflict', 'crop raid', 'retaliat',
  'political', 'controversy', 'protest', 'scandal',
  'climate doom', 'catastrophe', 'collapse warn',
  'fails to', 'failure to',
];

// ── Positive signals (at least one must be present) ──────────
const POSITIVE_TERMS = [
  // recovery & growth
  'recover', 'restor', 'rewild', 'reintroduc',
  'increas', 'growing', 'rose to', 'population growth',
  'population rise', 'breeding success', 'new record',
  'milestone', 'breakthrough', 'first time in',
  // species
  'tiger', 'leopard', 'elephant', 'rhino', 'lion', 'cheetah',
  'dolphin', 'whale', 'shark', 'turtle', 'vulture',
  'eagle', 'owl', 'flamingo', 'crane', 'stork',
  'gharial', 'python', 'monitor lizard',
  // habitat
  'habitat restor', 'mangrove', 'coral reef', 'seagrass',
  'wetland restor', 'grassland', 'shola', 'forest restor',
  'river restor', 'creek restor',
  // community
  'community conserv', 'indigenous steward', 'tribal',
  'community forest', 'coexist', 'local guardian',
  // science & tech
  'camera trap', 'citizen science', 'ai conserv',
  'satellite track', 'biodiversity survey', 'genetic',
  'discovery', 'new species', 'first observ',
  // protected areas
  'national park', 'protected area', 'tiger reserve',
  'marine protected', 'biosphere reserve',
];

// ── Category detection rules (first match wins) ──────────────
const CATEGORY_RULES = [
  { cat: 'marine',      terms: ['ocean', 'coral', 'reef', 'marine', 'seagrass', 'mangrove', 'coast', 'lakshadweep', 'andaman', 'shark', 'whale', 'dolphin', 'turtle sea', 'river dolphin'] },
  { cat: 'species',     terms: ['tiger', 'leopard', 'elephant', 'rhino', 'lion', 'cheetah', 'vulture', 'crane', 'flamingo', 'gharial', 'population census', 'species recover', 'breeding'] },
  { cat: 'restoration', terms: ['restor', 'rewild', 'replant', 'reveget', 'shola', 'grassland restor', 'forest restor', 'river restor', 'soil restor'] },
  { cat: 'technology',  terms: ['camera trap', 'ai', 'satellite', 'drone', 'wildlens', 'machine learning', 'sensor network', 'remote sensing'] },
  { cat: 'community',   terms: ['community conserv', 'tribal', 'indigenous', 'village', 'local steward', 'community forest', 'coexist', 'forest right'] },
  { cat: 'ecology',     terms: ['ecosystem', 'biodiversity', 'food web', 'pollinator', 'carbon sequester', 'soil health', 'new species', 'genetic'] },
  { cat: 'expeditions', terms: ['expedition', 'survey', 'field station', 'transect', 'patrol'] },
  { cat: 'education',   terms: ['citizen science', 'school', 'youth', 'outreach', 'awareness', 'volunteer'] },
  { cat: 'conservation',terms: ['conserv', 'protect', 'national park', 'reserve', 'sanctuary', 'corridor'] },
];

// ── Editorial "Why This Matters" per category ─────────────────
const WHY_TEMPLATES = {
  marine:       'Marine ecosystems under protection respond measurably. Each positive signal from coastal and ocean environments confirms that sustained conservation investment at sea yields the same results as on land — and that the two are inseparable.',
  species:      'Species population recovery validates a fundamental conservation principle: legal protection combined with habitat management and community engagement creates the conditions for natural systems to repair themselves without further intervention.',
  restoration:  'Ecological restoration builds self-sustaining systems. Each restored site reduces future conservation costs, rebuilds biodiversity services, and strengthens the ecological connectivity on which both wildlife and human communities depend.',
  community:    'Community-led conservation consistently outperforms centralised approaches in both ecological outcome and long-term durability. Recognising local stewardship scales protection to the landscapes where it is most needed and most sustainable.',
  technology:   'Conservation technology bridges the gap between observation and understanding. Better ecological data enables targeted interventions, more accurate baselines, and faster detection of both threats and recoveries.',
  ecology:      'Understanding how ecosystems function is the prerequisite for protecting them effectively. Scientific work that reveals natural dynamics — species interactions, soil processes, genetic diversity — informs every management decision with lasting consequence.',
  expeditions:  'Systematic surveys of understudied habitats consistently reveal biodiversity that was previously unknown. Each field season expands the living inventory we rely on to make sound, evidence-based conservation decisions.',
  education:    'Conservation literacy is the precondition for conservation action. Reaching new communities with accurate, science-grounded storytelling builds the broad constituency that long-term nature protection requires.',
  'field-notes':'Field observation remains the most reliable foundation for conservation knowledge. What practitioners witness on the ground shapes the decisions that ultimately determine what survives.',
  conservation: 'Conservation milestones at landscape scale reflect years of coordinated, science-led investment. Each documented success strengthens both the methodology and the political case for sustained protection.',
};

// ── Tag extraction ────────────────────────────────────────────
const TAG_VOCABULARY = [
  'tiger','leopard','elephant','rhino','lion','cheetah','whale','dolphin',
  'vulture','eagle','crane','flamingo','gharial','coral','mangrove',
  'India','Africa','Europe','Asia','Lakshadweep','Ganga','Kuno',
  'rewilding','restoration','biodiversity','community','technology',
  'citizen science','camera trap','forest','ocean','wetland','grassland',
  'endemic','migratory','breeding','recovery',
];

// ── Utility ───────────────────────────────────────────────────
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}
function makeId(url) {
  return 'c-' + crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
}
function stripHtml(html) {
  return (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Filter: returns false if article should be excluded ───────
function passesFilter(title, excerpt) {
  const text = (title + ' ' + excerpt).toLowerCase();
  // Hard exclusion
  if (EXCLUDE_TERMS.some(t => text.includes(t))) return false;
  // Must have at least one positive signal
  if (!POSITIVE_TERMS.some(t => text.includes(t))) return false;
  // Sentiment check — reject only clearly negative text
  const tokens = wordTok.tokenize(text);
  const score  = analyzer.getSentiment(tokens);
  return score > -0.15;
}

// ── Category detection ────────────────────────────────────────
function detectCategory(title, excerpt) {
  const text = (title + ' ' + excerpt).toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.terms.some(t => text.includes(t))) return rule.cat;
  }
  return 'conservation';
}

// ── Extractive summary: first 2 meaningful sentences ─────────
function extractSummary(text) {
  if (!text || text.length < 40) return text;
  const sentences = sentTok.tokenize(text).filter(s => s.trim().length > 30);
  return sentences.slice(0, 2).join(' ').trim();
}

// ── Tag extraction ────────────────────────────────────────────
function extractTags(title, excerpt) {
  const text = (title + ' ' + excerpt).toLowerCase();
  return TAG_VOCABULARY.filter(tag => text.includes(tag.toLowerCase())).slice(0, 5);
}

// ── Step 1: Fetch RSS ─────────────────────────────────────────
async function fetchArticles() {
  const parser  = new Parser({ timeout: 12000 });
  const results = [];

  for (const source of SOURCES) {
    try {
      process.stdout.write(`  Fetching ${source.name}… `);
      const feed = await parser.parseURL(source.url);
      let count  = 0;
      for (const item of (feed.items ?? []).slice(0, 15)) {
        if (!item.title || !item.link) continue;
        results.push({
          title:   item.title.trim(),
          url:     item.link,
          source:  source.name,
          excerpt: stripHtml(item.contentSnippet ?? item.content ?? '').slice(0, 800),
          pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          image:   item.enclosure?.url ?? item['media:content']?.['$']?.url ?? null,
        });
        count++;
      }
      console.log(`${count} items`);
    } catch (err) {
      console.log(`skipped (${err.message.slice(0, 50)})`);
    }
  }

  console.log(`\n  Total: ${results.length} raw items from ${SOURCES.length} sources`);
  return results;
}

// ── Step 2: Score and build article object ────────────────────
function processArticle(item, existingIds) {
  const id = makeId(item.url);
  if (existingIds.has(id)) return null;
  if (!passesFilter(item.title, item.excerpt)) return null;

  const category     = detectCategory(item.title, item.excerpt);
  const summary      = extractSummary(item.excerpt) || item.excerpt.slice(0, 240);
  const whyItMatters = WHY_TEMPLATES[category] ?? WHY_TEMPLATES.conservation;
  const tags         = extractTags(item.title, item.excerpt);
  let sourceUrl      = item.url;
  try { sourceUrl = new URL(item.url).origin; } catch { /* leave as-is */ }

  return {
    id,
    type:         'curated',
    title:        item.title,
    source:       item.source,
    sourceUrl,
    originalUrl:  item.url,
    publishedAt:  item.pubDate,
    category,
    image:        item.image,
    excerpt:      item.excerpt,
    summary,
    whyItMatters,
    tags,
    featured:     false,
  };
}

// ── Step 3: Weekly roundup (template-based) ───────────────────
const CAT_LABELS = {
  conservation: 'Conservation', marine: 'Marine & Ocean',
  technology: 'Technology', 'field-notes': 'Field Notes',
  ecology: 'Ecology', expeditions: 'Expeditions',
  education: 'Education', restoration: 'Restoration',
  species: 'Species Recovery', community: 'Community',
};

function buildRoundup(articles) {
  const used = articles.slice(0, 10);

  // Group by category
  const byCategory = {};
  used.forEach(a => {
    (byCategory[a.category] = byCategory[a.category] ?? []).push(a);
  });

  const sourceNames = [...new Set(used.map(a => a.source))];
  const catCount    = Object.keys(byCategory).length;

  // Highlights — top 4 articles
  const highlights = used.slice(0, 4).map(a => ({
    title:       a.title.length > 70 ? a.title.slice(0, 68) + '…' : a.title,
    description: extractSummary(a.summary),
    category:    CAT_LABELS[a.category] ?? 'Conservation',
  }));

  // Body paragraphs
  const paras = [];

  paras.push(
    `This week's conservation record draws from ${sourceNames.length} trusted sources ` +
    `across ${catCount} areas of ecological and conservation practice. ` +
    `The ${used.length} stories collected share a consistent character: ` +
    `measured, evidence-based progress reported from landscapes and waterways where the work of protection is ongoing.`
  );

  for (const [cat, catArticles] of Object.entries(byCategory)) {
    const label     = CAT_LABELS[cat] ?? cat;
    const firstArt  = catArticles[0];
    const otherTitles = catArticles.slice(1).map(a => a.title.slice(0, 55));
    let para = `In ${label}, `;
    para += catArticles.length === 1
      ? `one story merits close attention this week: ${firstArt.title}. `
      : `${catArticles.length} stories document ongoing progress — led by ${firstArt.title}. `;
    if (firstArt.summary) {
      para += firstArt.summary;
    }
    if (otherTitles.length > 0) {
      para += ` Also noted: ${otherTitles.join('; ')}.`;
    }
    paras.push(para);
  }

  paras.push(
    `Conservation progress does not announce itself. It accumulates — in survey returns, ` +
    `breeding confirmations, and the slow reappearance of species in landscapes that had been quiet too long. ` +
    `The field notes from this week are part of that long, patient arithmetic.`
  );

  // Headline options based on dominant category
  const dominantCat = Object.entries(byCategory)
    .sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? 'conservation';

  const HEADLINES = {
    species:      'A Week of Quiet Recoveries',
    restoration:  "Roots and Returns: This Week's Restoration Record",
    marine:       'Below the Surface: A Week in Marine Conservation',
    community:    'Ground-Level Progress: Community Conservation This Week',
    technology:   'Field Intelligence: Conservation Technology This Week',
    ecology:      'What the Data Shows: A Week in Ecological Research',
    conservation: 'This Week in Conservation',
    default:      `${used.length} Stories: A Week of Measured Progress`,
  };

  const SUBHEADINGS = [
    'Species, habitat, and the patient arithmetic of ecological recovery.',
    "From field surveys to population milestones — nature's steady account.",
    'Restoration, research, and the measured optimism of field conservation.',
    "What the week's data tells us about the state of the natural world.",
    'Breeding seasons, survey returns, and the slow work of landscape repair.',
  ];

  return {
    headline:   HEADLINES[dominantCat] ?? HEADLINES.default,
    subheading: SUBHEADINGS[used.length % SUBHEADINGS.length],
    body:       paras.join('\n\n'),
    highlights,
  };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('\n  Faunterra Field Journal — Curation Engine');
  console.log(`  ${new Date().toUTCString()}`);
  console.log('─'.repeat(56));

  const store       = readJSON('curated-articles.json', { lastUpdated: '', articles: [] });
  const existingIds = new Set(store.articles.map(a => a.id));

  // ── Fetch and filter ──────────────────────────────────────
  if (!ROUNDUP_ONLY) {
    console.log('\n  RSS fetch\n');
    const rawItems    = await fetchArticles();
    const newArticles = [];

    console.log('\n  Filtering and processing\n');
    for (const item of rawItems) {
      const article = processArticle(item, existingIds);
      if (article) {
        newArticles.push(article);
        existingIds.add(article.id);
        console.log(`  + [${article.category.padEnd(12)}] ${article.title.slice(0, 62)}`);
      }
    }

    console.log(`\n  Fetched: ${rawItems.length}  Accepted: ${newArticles.length}  Skipped: ${rawItems.length - newArticles.length}`);

    if (newArticles.length > 0) {
      const merged = [...newArticles, ...store.articles].slice(0, 120);
      writeJSON('curated-articles.json', {
        lastUpdated: new Date().toISOString(),
        articles:    merged,
      });
      console.log(`  Saved ${merged.length} total articles to curated-articles.json`);
    } else {
      console.log('  No new articles this run — data file unchanged');
    }
  }

  // ── eBird field signals ───────────────────────────────────
  // Independent of the RSS pass: RSS tells us what was written about nature,
  // eBird tells us what nature was observed doing. A failure here is logged
  // and stepped over — it must not cost us the article run above.
  if (!ROUNDUP_ONLY) {
    console.log('\n  eBird field signals\n');
    try {
      const signals = await fetchBirdSignals();
      if (signals) {
        writeJSON('ebird-signals.json', signals);
        const totalNotable = signals.regions.reduce((n, r) => n + r.notableCount, 0);
        console.log(`\n  Saved ${totalNotable} notable species across ${signals.regions.length} region(s)`);
      } else {
        console.log('  No eBird signals this run — data file unchanged');
      }
    } catch (err) {
      console.log(`  eBird pass failed (${err.message.slice(0, 60)}) — continuing`);
    }
  }

  // ── Weekly roundup ────────────────────────────────────────
  if (IS_SUNDAY || ROUNDUP_ONLY) {
    console.log('\n  Generating weekly roundup…');
    const freshStore     = readJSON('curated-articles.json', { articles: [] });
    const recentArticles = freshStore.articles.slice(0, 12);

    if (recentArticles.length > 0) {
      const roundupData  = buildRoundup(recentArticles);
      const roundupStore = readJSON('weekly-roundup.json', { lastGenerated: '', roundups: [] });

      const newRoundup = {
        id:          'r-' + crypto.randomUUID().slice(0, 8),
        weekEnding:  new Date().toISOString(),
        ...roundupData,
        publishedAt: new Date().toISOString(),
      };

      roundupStore.roundups      = [newRoundup, ...roundupStore.roundups].slice(0, 12);
      roundupStore.lastGenerated = new Date().toISOString();
      writeJSON('weekly-roundup.json', roundupStore);
      console.log(`  Weekly roundup saved: "${newRoundup.headline}"`);
    } else {
      console.log('  No articles available for roundup — skipping');
    }
  }

  console.log('\n  Curation complete.\n');
}

main().catch(err => {
  console.error('\n  Curation failed:', err.message);
  process.exit(1);
});
