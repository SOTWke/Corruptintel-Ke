interface EvidenceRef {
  evidence_id: string;
  source_name: string;
  source_tier: string;
  document_title: string | null;
  page_reference: string | null;
  excerpt: string;
  url: string | null;
  retrieval_date: string;
  extraction_confidence: number | null;
}

interface Claim {
  id: string;
  claim_text: string;
  certainty: string;
  conflicts_with_claim_id: string | null;
  evidence: EvidenceRef | null;
}

interface TimelineEvent {
  status: string;
  date: string | null;
  notes: string | null;
  evidence: EvidenceRef | null;
}

interface FinancialAmount {
  amount: string;
  currency: string;
  amount_type: string;
  is_approximate: boolean;
  context_note: string | null;
  evidence: EvidenceRef | null;
}

interface CaseEntity {
  role: string | null;
  entity_type: string;
  name: string;
  evidence: EvidenceRef | null;
}

interface CaseDetail {
  id: string;
  case_code: string;
  title: string;
  current_status: string;
  sector: string | null;
  county: string | null;
  outcome_summary: string | null;
  claims: Claim[];
  timeline: TimelineEvent[];
  financial_amounts: FinancialAmount[];
  entities: CaseEntity[];
}

async function getCase(id: string): Promise<CaseDetail | null> {
  try {
    const res = await fetch(`${process.env.API_BASE_URL}/api/v1/cases/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

function EvidenceNote({ evidence }: { evidence: EvidenceRef | null }) {
  if (!evidence) {
    return <p className="evidence-note">Insufficient evidence to establish this claim.</p>;
  }
  return (
    <details className="evidence-note" style={{ cursor: "pointer" }}>
      <summary>
        Show Evidence — {evidence.source_name} ({evidence.source_tier.replace(/_/g, " ")})
      </summary>
      <div style={{ marginTop: "0.5rem" }}>
        {evidence.document_title && <div><strong>{evidence.document_title}</strong></div>}
        {evidence.page_reference && <div>Reference: {evidence.page_reference}</div>}
        <div style={{ fontStyle: "italic", margin: "0.35rem 0" }}>&ldquo;{evidence.excerpt}&rdquo;</div>
        <div>Retrieved: {evidence.retrieval_date}</div>
        {evidence.extraction_confidence != null && (
          <div>Extraction confidence: {(evidence.extraction_confidence * 100).toFixed(0)}%</div>
        )}
        {evidence.url && (
          <div><a href={evidence.url} target="_blank" rel="noopener noreferrer">View original source</a></div>
        )}
      </div>
    </details>
  );
}

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  const caseData = await getCase(params.id);

  if (!caseData) {
    return (
      <div className="card">
        <p className="evidence-note">Case not found, not published, or the API is unreachable.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-serif)", marginBottom: "0.25rem" }}>{caseData.title}</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {caseData.case_code} · {caseData.sector ?? "Sector unspecified"} · {caseData.county ?? "County unspecified"}
          </div>
        </div>
        <span className={`status-badge ${caseData.current_status.toLowerCase()}`}>
          {caseData.current_status.replace(/_/g, " ")}
        </span>
      </div>

      {caseData.outcome_summary && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ marginTop: 0 }}>Summary</h3>
          <p>{caseData.outcome_summary}</p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>What Happened — Evidence-Qualified Claims</h3>
        {caseData.claims.length === 0 && <p className="evidence-note">No claims recorded yet.</p>}
        {caseData.claims.map((claim) => (
          <div key={claim.id} style={{ borderBottom: "1px solid var(--line)", padding: "0.75rem 0" }}>
            <div>
              <span className={`status-badge ${claim.certainty.toLowerCase()}`} style={{ marginRight: "0.5rem" }}>
                {claim.certainty.replace(/_/g, " ")}
              </span>
              {claim.claim_text}
            </div>
            {claim.conflicts_with_claim_id && (
              <p className="evidence-note">Sources conflict on this point — see related claim for the opposing account.</p>
            )}
            <EvidenceNote evidence={claim.evidence} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Timeline</h3>
        {caseData.timeline.length === 0 && <p className="evidence-note">No status history recorded yet.</p>}
        {caseData.timeline.map((event, i) => (
          <div key={i} style={{ borderBottom: "1px solid var(--line)", padding: "0.75rem 0" }}>
            <div>
              <strong>{event.date ?? "Date unknown"}</strong> —{" "}
              <span className={`status-badge ${event.status.toLowerCase()}`}>{event.status.replace(/_/g, " ")}</span>
            </div>
            {event.notes && <p style={{ margin: "0.35rem 0" }}>{event.notes}</p>}
            <EvidenceNote evidence={event.evidence} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Financial Figures (kept separate by type — never summed)</h3>
        {caseData.financial_amounts.length === 0 && <p className="evidence-note">No financial figures recorded yet.</p>}
        {caseData.financial_amounts.map((amt, i) => (
          <div key={i} style={{ borderBottom: "1px solid var(--line)", padding: "0.75rem 0" }}>
            <div>
              <strong>{amt.currency} {Number(amt.amount).toLocaleString()}</strong>{amt.is_approximate ? " (approximate)" : ""} — {amt.amount_type.replace(/_/g, " ")}
            </div>
            {amt.context_note && <p style={{ margin: "0.35rem 0", color: "var(--muted)" }}>{amt.context_note}</p>}
            <EvidenceNote evidence={amt.evidence} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Entities Named</h3>
        {caseData.entities.length === 0 && <p className="evidence-note">No entities linked yet.</p>}
        {caseData.entities.map((e, i) => (
          <div key={i} style={{ borderBottom: "1px solid var(--line)", padding: "0.75rem 0" }}>
            <div><strong>{e.name}</strong> — {e.entity_type.toLowerCase()}{e.role ? ` · ${e.role.replace(/_/g, " ")}` : ""}</div>
            <EvidenceNote evidence={e.evidence} />
          </div>
        ))}
      </div>
    </div>
  );
}
