'use client';
import { format } from 'date-fns';
import type { Article } from '../lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  conservation: 'Conservation',
  marine:       'Marine & Ocean',
  technology:   'Technology',
  'field-notes':'Field Notes',
  ecology:      'Ecology',
  expeditions:  'Expeditions',
  education:    'Education',
  restoration:  'Restoration',
  species:      'Species',
  community:    'Community',
};

// ── Small card (grid layout) ─────────────────────────────────
export function ArticleCard({ article }: { article: Article }) {
  const isF = article.type === 'faunterra';

  return (
    <article className="article-card bg-white border border-[rgba(107,112,92,0.1)] cursor-pointer group overflow-hidden">
      {/* Image / placeholder */}
      <div className="relative h-52 overflow-hidden bg-card-dark">
        {article.image && (
          <img
            src={article.image}
            alt={article.title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <span className="absolute top-4 left-4 label text-bronze">
          {CATEGORY_LABELS[article.category] ?? article.category}
        </span>
        {!isF && (
          <span className="absolute top-4 right-4 win-badge">Conservation Win</span>
        )}
      </div>

      {/* Content */}
      <div className="p-7">
        <h3 className="font-display font-normal text-forest-deep text-xl leading-snug mb-3 group-hover:text-moss transition-colors duration-300">
          {article.title}
        </h3>
        <p className="font-body text-sm font-light text-moss/70 leading-relaxed mb-5 line-clamp-3">
          {article.summary}
        </p>

        {/* Why it matters */}
        {article.whyItMatters && (
          <p className="font-body text-xs font-light text-moss/55 leading-relaxed italic border-l-2 border-bronze/30 pl-3 mb-5 line-clamp-2">
            {article.whyItMatters}
          </p>
        )}

        {/* Meta row */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="source-tag block">{article.source}</span>
            <span className="font-body text-xs text-moss/45 font-light">
              {format(new Date(article.publishedAt), 'MMM d, yyyy')}
            </span>
          </div>
          {!isF && article.originalUrl !== '#' && (
            <a
              href={article.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-ui text-xs font-600 tracking-wide uppercase text-forest-deep border border-forest-deep/20 px-4 py-2 hover:bg-forest-deep hover:text-ivory transition-all duration-300 whitespace-nowrap"
              onClick={e => e.stopPropagation()}
            >
              Read Original
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Featured large card ───────────────────────────────────────
export function FeaturedCard({ article }: { article: Article }) {
  return (
    <article className="article-card grid md:grid-cols-2 gap-0 bg-white border border-[rgba(107,112,92,0.1)] cursor-pointer group overflow-hidden">
      {/* Image */}
      <div className="relative min-h-72 md:min-h-full overflow-hidden bg-card-dark">
        {article.image && (
          <img
            src={article.image}
            alt={article.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <span className="absolute top-6 left-6 label text-bronze">
          Featured · {CATEGORY_LABELS[article.category] ?? article.category}
        </span>
      </div>

      {/* Content */}
      <div className="p-10 md:p-12 flex flex-col justify-center">
        <span className="label text-bronze mb-4 block">Faunterra Field Journal</span>
        <h2 className="font-display font-light text-forest-deep leading-snug mb-5 group-hover:text-moss transition-colors duration-300"
            style={{ fontSize: 'clamp(1.7rem, 2.5vw, 2.6rem)' }}>
          {article.title}
        </h2>
        <p className="font-body text-sm font-light text-moss/65 leading-relaxed mb-6">
          {article.summary}
        </p>
        <p className="font-display italic text-base text-forest-deep/70 leading-relaxed border-l-2 border-bronze/35 pl-5 mb-8">
          {article.whyItMatters}
        </p>
        <div className="flex items-center gap-4">
          <span className="source-tag">{article.source}</span>
          <span className="font-body text-xs text-moss/45">
            {format(new Date(article.publishedAt), 'MMMM d, yyyy')}
          </span>
        </div>
      </div>
    </article>
  );
}
