export default function HomePage() {
  return (
    <div className="home-page">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Public-sector accountability · Kenya</p>
          <h1 id="hero-title">Follow the money. Track the evidence. Expose the pattern.</h1>
          <p className="hero-lede">
            CorruptIntel is an evidence-first intelligence platform for researching public-sector corruption and financial irregularities.
          </p>
          <p className="hero-supporting">
            Every published claim leads back to a source document and page reference. We distinguish allegation from investigation from conviction — always.
          </p>
          <div className="hero-actions">
            <a href="/cases" className="button button-primary">Explore the evidence</a>
            <a href="/search" className="button button-secondary">Ask the research agent <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <aside className="principle-card" aria-label="CorruptIntel publishing principle">
          <span className="principle-mark" aria-hidden="true">✓</span>
          <p className="eyebrow">Our publishing principle</p>
          <h2>No claim without a resolved evidence trail.</h2>
          <p>Sources are stored, hashed, linked, and reviewable before a case becomes public.</p>
        </aside>
      </section>

      <section className="home-grid" aria-label="Platform capabilities">
        <article><span className="feature-number">01</span><h2>Evidence, first</h2><p>Read the source behind every claim, amount, relationship, and timeline event.</p></article>
        <article><span className="feature-number">02</span><h2>Clear status</h2><p>Separate allegations from investigations, charges, court cases, convictions, and facts.</p></article>
        <article><span className="feature-number">03</span><h2>Responsible AI</h2><p>AI helps researchers find patterns; deterministic retrieval and human review keep the record grounded.</p></article>
      </section>
    </div>
  );
}
