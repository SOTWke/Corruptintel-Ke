interface StatusCounts {
  [status: string]: number;
}

interface FinancialTotal {
  amount_type: string;
  currency: string;
  total: string;
}

interface StatisticsResponse {
  data: {
    cases_by_status: StatusCounts;
    financial_totals_by_type: FinancialTotal[];
    institutions_affected: number;
    counties_affected: number;
  };
}

async function getStatistics(): Promise<StatisticsResponse["data"] | null> {
  try {
    const res = await fetch(`${process.env.API_BASE_URL}/api/v1/statistics`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as StatisticsResponse;
    return json.data;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const stats = await getStatistics();

  if (!stats) {
    return (
      <div className="card">
        <h2>Dashboard</h2>
        <p className="evidence-note">
          Could not reach the API ({process.env.API_BASE_URL}). Make sure the
          api service is running (`npm run dev:api`) and migrations have been
          applied (`npm run migrate`).
        </p>
      </div>
    );
  }

  const totalCases = Object.values(stats.cases_by_status).reduce((a, b) => a + b, 0);

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-serif)" }}>Intelligence Overview</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", margin: "1.5rem 0" }}>
        <div className="card">
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase" }}>Total Cases</div>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>{totalCases}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase" }}>Institutions Affected</div>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.institutions_affected}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase" }}>Counties Affected</div>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.counties_affected}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Cases by Status</h3>
        {totalCases === 0 && <p className="evidence-note">No published cases yet — run ingestion to populate.</p>}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {Object.entries(stats.cases_by_status).map(([status, count]) => (
            <li key={status} style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: "1px solid var(--line)" }}>
              <span className={`status-badge ${status.toLowerCase()}`}>{status.replace(/_/g, " ")}</span>
              <span>{count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Financial Figures — By Type (never summed across types)</h3>
        {stats.financial_totals_by_type.length === 0 && (
          <p className="evidence-note">No financial figures recorded yet.</p>
        )}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {stats.financial_totals_by_type.map((t, i) => (
            <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: "1px solid var(--line)" }}>
              <span>{t.amount_type.replace(/_/g, " ")}</span>
              <span>{t.currency} {Number(t.total).toLocaleString()}</span>
            </li>
          ))}
        </ul>
        <p className="evidence-note" style={{ marginTop: "0.75rem" }}>
          Contract value, alleged loss, irregular expenditure, and recovered
          funds are tracked separately by design — they are not the same
          claim and are never added together into a single "money stolen" figure.
        </p>
      </div>
    </div>
  );
}
