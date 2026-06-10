import { getJournalData } from '../lib/data';
import { ArticleCard, FeaturedCard } from '../components/ArticleCard';
import { WeeklyRoundupSection } from '../components/WeeklyRoundup';
import { format } from 'date-fns';

export const dynamic = 'force-static';
export const revalidate = false;

const CATEGORIES = [
  { key: 'all',          label: 'All Stories' },
  { key: 'conservation', label: 'Conservation' },
  { key: 'marine',       label: 'Marine & Ocean' },
  { key: 'technology',   label: 'Technology' },
  { key: 'field-notes',  label: 'Field Notes' },
  { key: 'ecology',      label: 'Ecology' },
  { key: 'expeditions',  label: 'Expeditions' },
  { key: 'restoration',  label: 'Restoration' },
  { key: 'species',      label: 'Species' },
  { key: 'community',    label: 'Community' },
];

export default function JournalPage() {
  const { featured, secondary, curated, roundup } = getJournalData();

  return (
    <main className="min-h-screen bg-ivory">

      {/* ── NAV ───────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-12 h-[70px] bg-[rgba(245,241,232,0.92)] backdrop-blur-sm border-b border-[rgba(107,112,92,0.1)]">
        <a href="faunterra-v2.html" className="font-ui text-[0.65rem] font-600 tracking-[0.2em] uppercase text-moss/70 hover:text-forest transition-colors flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 12H5M5 12l7-7M5 12l7 7"/>
          </svg>
          Back to Faunterra
        </a>
        <a href="/" className="font-ui font-800 text-sm tracking-[0.38em] uppercase text-forest">
          FAUNTERRA
        </a>
        <a href="#contribute" className="font-ui text-[0.65rem] font-600 tracking-[0.2em] uppercase px-5 py-2.5 bg-forest text-ivory hover:bg-[#1C2B1E] transition-colors">
          Contribute
        </a>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section className="pt-[170px] pb-20 px-6 md:px-12 lg:px-20 text-center bg-ivory border-b border-[rgba(107,112,92,0.1)]">
        <span className="label text-bronze mb-6 block">The Faunterra Field Journal</span>
        <h1
          className="font-display font-light text-forest-deep leading-none mb-6"
          style={{ fontSize: 'clamp(2.8rem, 6vw, 6rem)' }}
        >
          Stories from<br />
          <em className="italic text-moss/60">the Field.</em>
        </h1>
        <p className="font-display italic font-light text-moss/65 text-lg md:text-xl max-w-xl mx-auto leading-relaxed mb-12">
          Field observations, conservation milestones, restoration journeys, and inspiring stories from the natural world.
        </p>
        <div className="flex flex-wrap gap-6 justify-center text-center">
          {[
            { n: '48', l: 'Published Essays' },
            { n: '22', l: 'Contributors' },
            { n: '6',  l: 'Categories' },
            { n: '∞',  l: 'Conservation Wins' },
          ].map(({ n, l }) => (
            <div key={l}>
              <div className="font-display font-light text-forest-deep text-3xl mb-1">{n}</div>
              <div className="font-ui text-[0.6rem] font-600 tracking-[0.15em] uppercase text-moss">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CATEGORY FILTER ───────────────────────────────────── */}
      <div className="sticky top-[70px] z-40 bg-[#EDE8DC] border-b border-[rgba(107,112,92,0.1)] px-6 md:px-12 py-4 flex gap-3 flex-wrap items-center overflow-x-auto">
        <span className="font-ui text-[0.57rem] font-600 tracking-[0.3em] uppercase text-moss mr-2">Filter</span>
        {CATEGORIES.map(({ key, label }) => (
          <span key={key} className={`cat-pill ${key === 'all' ? 'active' : ''}`} data-filter={key}>
            {label}
          </span>
        ))}
      </div>

      {/* ── SECTION 1 — FAUNTERRA FIELD JOURNAL ──────────────── */}
      <section className="py-20 px-6 md:px-12 lg:px-20 bg-ivory">
        <div className="max-w-[1400px] mx-auto">

          {/* Section label */}
          <div className="mb-12 flex items-center gap-8">
            <div>
              <span className="label text-bronze block mb-2">Section 01</span>
              <h2 className="font-display font-light text-forest-deep text-4xl md:text-5xl">
                Faunterra <em className="italic">Field Journal</em>
              </h2>
            </div>
          </div>

          {/* Featured article */}
          {featured && (
            <div className="mb-10">
              <FeaturedCard article={featured} />
            </div>
          )}

          {/* Secondary grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {secondary.map(article => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>

        </div>
      </section>

      {/* ── DIVIDER QUOTE ─────────────────────────────────────── */}
      <section className="py-24 px-6 md:px-12 bg-[#1C2B1E] text-center">
        <p
          className="font-display font-light italic text-ivory leading-relaxed max-w-2xl mx-auto"
          style={{ fontSize: 'clamp(1.5rem, 3vw, 2.6rem)' }}
        >
          "The wild was never outside us."
        </p>
        <span className="label text-bronze/60 block mt-8">Faunterra Field Journal</span>
      </section>

      {/* ── SECTION 2 — CONSERVATION WINS ────────────────────── */}
      <section className="py-20 px-6 md:px-12 lg:px-20 bg-stone">
        <div className="max-w-[1400px] mx-auto">

          {/* Section label */}
          <div className="mb-12">
            <span className="label text-bronze block mb-2">Section 02 · Auto-curated</span>
            <div className="flex items-end justify-between gap-8 flex-wrap">
              <h2 className="font-display font-light text-forest-deep text-4xl md:text-5xl">
                Conservation <em className="italic">Wins</em>
              </h2>
              <p className="font-body text-sm font-light text-moss/65 max-w-sm leading-relaxed">
                Positive conservation stories collected every 6 hours from verified sources. Species recoveries, habitat restoration, rewilding milestones, and scientific breakthroughs.
              </p>
            </div>
          </div>

          {/* Trusted sources strip */}
          <div className="flex flex-wrap gap-3 mb-12 pb-10 border-b border-[rgba(107,112,92,0.1)]">
            {['Mongabay India','WWF India','Wildlife Trust of India','IUCN','National Geographic','Conservation International','UNEP','Smithsonian'].map(src => (
              <span key={src} className="font-ui text-[0.55rem] font-600 tracking-[0.15em] uppercase text-moss/50 border border-[rgba(107,112,92,0.18)] px-3 py-1.5">
                {src}
              </span>
            ))}
          </div>

          {/* Curated grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {curated.map(article => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>

          {curated.length === 0 && (
            <div className="py-20 text-center">
              <p className="font-display italic text-moss/50 text-xl">
                The next curation runs in a few hours. Check back soon.
              </p>
            </div>
          )}

        </div>
      </section>

      {/* ── SECTION 3 — WEEKLY ROUNDUP ───────────────────────── */}
      {roundup && <WeeklyRoundupSection roundup={roundup} />}
      {!roundup && (
        <section className="py-24 px-6 md:px-12 bg-[#1C2B1E] text-center">
          <span className="label text-bronze block mb-4">Weekly Roundup</span>
          <p className="font-display italic font-light text-ivory/50 text-xl">
            Published every Sunday. Next edition arriving this week.
          </p>
        </section>
      )}

      {/* ── CONTRIBUTE SECTION ───────────────────────────────── */}
      <section id="contribute" className="py-24 px-6 md:px-12 lg:px-20 bg-[#1C2B1E]">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 mb-20">
            <div>
              <span className="label text-bronze block mb-5">Open for Submissions</span>
              <h2
                className="font-display font-light text-ivory leading-none mb-0"
                style={{ fontSize: 'clamp(2.4rem, 4.5vw, 4.4rem)' }}
              >
                Write for<br /><em className="italic text-bronze/70">the Journal.</em>
              </h2>
            </div>
            <div className="flex flex-col justify-center">
              <p className="font-body font-light text-[rgba(245,241,232,0.6)] text-sm leading-relaxed mb-5">
                Faunterra accepts contributions from researchers, conservationists, naturalists, field biologists, photographers, science writers, and the general public.
              </p>
              <p className="font-body font-light text-[rgba(245,241,232,0.6)] text-sm leading-relaxed">
                All submissions are subject to editorial review and verification. We prioritise original, well-sourced work grounded in field experience or research.
              </p>
            </div>
          </div>

          {/* Editorial process */}
          <div className="grid sm:grid-cols-4 gap-px bg-[rgba(166,138,100,0.12)] mb-20">
            {[
              { n: '01', t: 'Submission',       b: 'Submit your essay or field note through the form below.' },
              { n: '02', t: 'Editorial Review', b: 'Our editors review within 7–10 business days.' },
              { n: '03', t: 'Verification',     b: 'Claims and observations are independently fact-checked.' },
              { n: '04', t: 'Publication',       b: 'Accepted pieces are published with full author attribution.' },
            ].map(({ n, t, b }) => (
              <div key={n} className="bg-[#1C2B1E] p-8 hover:bg-[#243526] transition-colors">
                <div className="font-display text-5xl font-light text-bronze/20 leading-none mb-5">{n}</div>
                <div className="font-ui font-700 text-[0.7rem] tracking-[0.18em] uppercase text-ivory mb-3">{t}</div>
                <p className="font-body font-light text-[0.75rem] text-[rgba(245,241,232,0.45)] leading-relaxed">{b}</p>
              </div>
            ))}
          </div>

          {/* Submission form */}
          <div className="border border-[rgba(166,138,100,0.15)] p-10 md:p-14">
            <h3 className="font-display font-light text-ivory text-3xl mb-2">Submit Your Story</h3>
            <p className="font-body font-light text-[rgba(245,241,232,0.4)] text-sm mb-10">
              Fields marked <span className="text-bronze">*</span> are required.
            </p>

            <form id="submitForm" noValidate className="grid gap-6">
              <div className="grid md:grid-cols-2 gap-6">
                <FormField label="Full Name *"         name="name"     type="text"  placeholder="Your name" />
                <FormField label="Email Address *"     name="email"    type="email" placeholder="you@example.com" />
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <FormField label="Affiliation / Organisation" name="affiliation" type="text" placeholder="University, NGO, freelance…" />
                <FormField label="Country / Region"           name="region"      type="text" placeholder="e.g. Karnataka, India" />
              </div>
              <FormField label="Article Title *" name="title" type="text" placeholder="A concise, evocative title" />
              <div className="grid md:grid-cols-2 gap-6">
                <SelectField label="Category *" name="category" options={[
                  { value: 'conservation', label: 'Conservation' },
                  { value: 'marine',       label: 'Marine & Ocean' },
                  { value: 'ecology',      label: 'Ecology & Biodiversity' },
                  { value: 'field-notes',  label: 'Field Notes' },
                  { value: 'technology',   label: 'Technology & Science' },
                  { value: 'expeditions',  label: 'Expeditions & Travel' },
                  { value: 'education',    label: 'Education & Outreach' },
                  { value: 'community',    label: 'Community & Tribal' },
                ]} />
                <SelectField label="Approximate Word Count *" name="wordcount" options={[
                  { value: 'short',   label: 'Field Note (300–800 words)' },
                  { value: 'medium',  label: 'Standard Essay (800–1500 words)' },
                  { value: 'long',    label: 'Long-form (1500–3000 words)' },
                  { value: 'feature', label: 'Feature (3000+ words)' },
                ]} />
              </div>
              <TextareaField label="Brief Synopsis *" name="synopsis" rows={3} maxLength={300} placeholder="Summary in 2–3 sentences (max 300 characters)" />
              <TextareaField label="Article Body / Draft *" name="body" rows={8} placeholder="Paste your full draft here, or an outline if in progress." />
              <div className="grid md:grid-cols-2 gap-6">
                <TextareaField label="Author Bio" name="bio" rows={3} maxLength={240} placeholder="Brief bio — your background or relevant work" />
                <TextareaField label="Sources & References" name="sources" rows={3} placeholder="Sources, citations, or supporting links" />
              </div>
              <FormField label="Photography / Image Links (optional)" name="images" type="text" placeholder="Links to your own photographs" />

              {/* Checkboxes */}
              <div className="space-y-4 pt-2">
                <Checkbox id="ck1" label="This work is my own original writing. Any cited sources are properly attributed." required />
                <Checkbox id="ck2" label="I understand submissions are subject to editorial review and fact-verification. Acceptance is not guaranteed." required />
                <Checkbox id="ck3" label="I consent to occasional updates about Faunterra Journal opportunities." />
              </div>

              <div className="flex items-start justify-between gap-6 flex-wrap pt-2">
                <button
                  type="submit"
                  className="font-ui text-[0.68rem] font-700 tracking-[0.2em] uppercase px-10 py-4 bg-bronze text-[#1C2B1E] hover:bg-bronze-2 transition-colors hover:-translate-y-0.5 duration-300"
                >
                  Submit for Review
                </button>
                <p className="font-body font-light text-[0.68rem] text-[rgba(245,241,232,0.35)] leading-relaxed max-w-sm italic">
                  We acknowledge every submission within 48 hours. Write to{' '}
                  <a href="mailto:journal@faunterra.com" className="text-bronze">journal@faunterra.com</a>{' '}
                  for follow-up.
                </p>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="bg-charcoal py-14 px-6 md:px-12 text-center">
        <p className="font-ui font-800 tracking-[0.4em] text-ivory/50 text-sm mb-4">FAUNTERRA</p>
        <p className="font-body font-light text-ivory/30 text-xs leading-relaxed max-w-lg mx-auto mb-6">
          The Field Journal · A publication from Faunterra documenting conservation progress, ecological intelligence, and stories from India's wilderness and oceans.
        </p>
        <div className="flex gap-8 justify-center flex-wrap mb-8">
          {[
            { href: 'faunterra-v2.html', label: 'Main Site' },
            { href: 'faunterra-v2.html#wildlens', label: 'WildLens AI' },
            { href: 'faunterra-v2.html#marine', label: 'Marine' },
            { href: 'faunterra-v2.html#contact', label: 'Contact' },
            { href: 'mailto:journal@faunterra.com', label: 'Journal Editor' },
          ].map(({ href, label }) => (
            <a key={label} href={href} className="font-ui text-[0.6rem] font-600 tracking-[0.2em] uppercase text-ivory/30 hover:text-ivory/70 transition-colors">
              {label}
            </a>
          ))}
        </div>
        <p className="font-body font-light text-[0.63rem] text-ivory/15 max-w-2xl mx-auto leading-relaxed">
          All figures and data references are indicative estimates from publicly available research and conservation databases. Not proprietary Faunterra operational metrics.
        </p>
        <p className="font-body font-light text-[0.6rem] text-ivory/15 mt-4">
          © {new Date().getFullYear()} Faunterra. The Field Journal.
        </p>
      </footer>

      {/* ── CLIENT-SIDE FILTER SCRIPT ─────────────────────────── */}
      <script dangerouslySetInnerHTML={{ __html: `
        // Category filter
        document.querySelectorAll('.cat-pill').forEach(pill => {
          pill.addEventListener('click', function() {
            document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            const f = this.dataset.filter;
            document.querySelectorAll('article[data-cat]').forEach(a => {
              a.style.display = (f === 'all' || a.dataset.cat === f) ? '' : 'none';
            });
          });
        });

        // Scroll reveal
        const obs = new IntersectionObserver(entries => {
          entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
        }, { threshold: 0.08 });
        document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

        // Form submit
        const form = document.getElementById('submitForm');
        if (form) {
          form.addEventListener('submit', e => {
            e.preventDefault();
            const required = form.querySelectorAll('[required]');
            let ok = true;
            required.forEach(f => {
              if (!f.value || (f.type === 'checkbox' && !f.checked)) { f.style.borderColor='#c0392b'; ok=false; }
              else f.style.borderColor='';
            });
            if (ok) {
              form.innerHTML = '<div style="padding:32px;text-align:center;font-family:Syne,sans-serif;font-size:.85rem;color:#C9A97A;letter-spacing:.1em;">SUBMISSION RECEIVED — We\'ll respond within 48 hours. <br><br><a href="mailto:journal@faunterra.com" style="color:#A68A64">journal@faunterra.com</a></div>';
            }
          });
        }
      `}} />

    </main>
  );
}

// ── Form helpers ──────────────────────────────────────────────
function FormField({ label, name, type, placeholder }: { label: string; name: string; type: string; placeholder: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <label className="font-ui text-[0.57rem] font-600 tracking-[0.22em] uppercase text-[rgba(245,241,232,0.5)]">{label}</label>
      <input name={name} type={type} placeholder={placeholder}
        className="bg-[rgba(0,0,0,0.18)] border border-[rgba(166,138,100,0.18)] text-ivory font-body font-light text-sm px-4 py-3 placeholder:text-ivory/20 focus:outline-none focus:border-[rgba(166,138,100,0.5)] transition-colors"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      />
    </div>
  );
}

function TextareaField({ label, name, rows, placeholder, maxLength }: { label: string; name: string; rows: number; placeholder: string; maxLength?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      <label className="font-ui text-[0.57rem] font-600 tracking-[0.22em] uppercase text-[rgba(245,241,232,0.5)]">{label}</label>
      <textarea name={name} rows={rows} placeholder={placeholder} maxLength={maxLength}
        className="bg-[rgba(0,0,0,0.18)] border border-[rgba(166,138,100,0.18)] text-ivory font-body font-light text-sm px-4 py-3 placeholder:text-ivory/20 focus:outline-none focus:border-[rgba(166,138,100,0.5)] transition-colors resize-y"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      />
    </div>
  );
}

function SelectField({ label, name, options }: { label: string; name: string; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <label className="font-ui text-[0.57rem] font-600 tracking-[0.22em] uppercase text-[rgba(245,241,232,0.5)]">{label}</label>
      <select name={name}
        className="bg-[rgba(0,0,0,0.18)] border border-[rgba(166,138,100,0.18)] text-ivory font-body font-light text-sm px-4 py-3 focus:outline-none focus:border-[rgba(166,138,100,0.5)] transition-colors appearance-none"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      >
        <option value="">Select…</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Checkbox({ id, label, required }: { id: string; label: string; required?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <input type="checkbox" id={id} required={required}
        className="mt-1 w-4 h-4 accent-bronze flex-shrink-0 cursor-pointer"
      />
      <label htmlFor={id} className="font-body font-light text-[0.77rem] text-[rgba(245,241,232,0.55)] leading-relaxed cursor-pointer">
        {label}
      </label>
    </div>
  );
}
