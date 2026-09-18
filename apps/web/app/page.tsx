export default function HomePage() {
  return (
    <div>
      <section style={{ padding: "3rem 0", borderBottom: "1px solid var(--line)" }}>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "2.4rem", maxWidth: 640, lineHeight: 1.2 }}>
          An evidence-backed intelligence platform for tracking public-sector
          corruption, financial irregularities and accountability across Africa.
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: 560, marginTop: "1rem" }}>
          Every claim on this platform leads back to a source, a document, and
          a page reference. We distinguish allegation from investigation from
          conviction — always.
        </p>
        <div style={{ marginTop: "1.5rem" }}>
          <a
            href="/cases"
            style={{
              background: "var(--accent)",
              color: "white",
              padding: "0.7rem 1.4rem",
              borderRadius: 4,
              textDecoration: "none",
              fontWeight: 600,
              marginRight: "1rem",
            }}
          >
            Explore the Evidence
          </a>
          <a href="/search" style={{ color: "var(--ink)", textDecoration: "underline" }}>
            Start a Research Query
          </a>
        </div>
      </section>

      <section style={{ padding: "2rem 0" }}>
        <p className="evidence-note">
          CorruptIntel v0.1 (MVP scaffold) — initial geographic scope: Kenya.
          Dashboard statistics and case pages populate once the ingestion
          pipeline (see /docs) has processed source documents.
        </p>
      </section>
    </div>
  );
}
