interface CaseSummary {
  id: string;
  case_code: string;
  title: string;
  current_status: string;
  sector: string | null;
  county: string | null;
  source_count: number;
}

async function getCases(): Promise<CaseSummary[]> {
  try {
    const res = await fetch(`${process.env.API_BASE_URL}/api/v1/cases`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

export default async function CasesPage() {
  const cases = await getCases();

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-serif)" }}>Case Explorer</h1>
      {cases.length === 0 && (
        <p className="evidence-note">
          No published cases yet. Cases appear here once ingestion, AI
          extraction, and human review have run and a SENIOR_RESEARCHER has
          published them via the admin console.
        </p>
      )}
      {cases.map((c) => (
        <a key={c.id} href={`/cases/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>{c.title}</strong>
              <span className={`status-badge ${c.current_status.toLowerCase()}`}>
                {c.current_status.replace(/_/g, " ")}
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.35rem" }}>
              {c.case_code} · {c.sector ?? "Sector unspecified"} · {c.county ?? "County unspecified"} · {c.source_count} source{c.source_count === 1 ? "" : "s"}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
