import { format } from 'date-fns';
import type { WeeklyRoundup } from '../lib/types';

export function WeeklyRoundupSection({ roundup }: { roundup: WeeklyRoundup }) {
  // Convert simple newlines to paragraphs
  const paragraphs = roundup.body.split('\n\n').filter(Boolean);

  return (
    <section className="py-24 px-6 md:px-12 lg:px-20 bg-[#1C2B1E]">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-16 pb-10 border-b border-[rgba(166,138,100,0.15)]">
          <span className="label text-bronze mb-5 block">
            Weekly Conservation Roundup · Week of {format(new Date(roundup.weekEnding), 'MMMM d, yyyy')}
          </span>
          <h2
            className="font-display font-light text-ivory mb-4 leading-none"
            style={{ fontSize: 'clamp(2.4rem, 5vw, 4.8rem)' }}
          >
            {roundup.headline}
          </h2>
          <p className="font-display italic font-light text-[rgba(245,241,232,0.5)] text-xl md:text-2xl">
            {roundup.subheading}
          </p>
        </div>

        {/* Highlights grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[rgba(166,138,100,0.1)] mb-16">
          {roundup.highlights.map((h, i) => (
            <div key={i} className="bg-[#1C2B1E] p-7 hover:bg-[#243526] transition-colors duration-300">
              <span className="font-ui text-xs font-700 tracking-wide uppercase text-bronze/60 block mb-3">
                {h.category}
              </span>
              <h4 className="font-ui font-600 text-ivory text-sm leading-snug mb-3">{h.title}</h4>
              <p className="font-body text-xs font-light text-[rgba(245,241,232,0.4)] leading-relaxed">
                {h.description}
              </p>
            </div>
          ))}
        </div>

        {/* Editorial body */}
        <div className="max-w-2xl mx-auto">
          {paragraphs.map((para, i) => (
            <p
              key={i}
              className={`font-body font-light text-[rgba(245,241,232,0.62)] leading-loose mb-7 ${
                i === 0 ? 'text-lg first-letter:text-5xl first-letter:font-display first-letter:float-left first-letter:leading-none first-letter:mr-2 first-letter:text-bronze' : 'text-base'
              }`}
            >
              {para}
            </p>
          ))}
          <div className="mt-10 pt-8 border-t border-[rgba(166,138,100,0.12)] flex items-center gap-4">
            <span className="font-ui text-xs uppercase tracking-widest text-[rgba(245,241,232,0.25)]">
              Faunterra Editorial · Auto-generated from verified sources
            </span>
          </div>
        </div>

      </div>
    </section>
  );
}
