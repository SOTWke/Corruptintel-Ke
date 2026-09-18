"use client";

import { useState } from "react";

interface EvidenceRef {
  evidence_id: string;
  source_name: string;
  source_tier: string;
  document_title: string | null;
  excerpt: string;
  url: string | null;
  retrieval_date: string;
}

interface KeyFinding {
  text: string;
  evidence_ids: string[];
}

interface TimelineEntry {
  date: string | null;
  description: string;
  evidence: EvidenceRef | null;
}

interface FinancialExposure {
  amount: string;
  currency: string;
  amount_type: string;
  is_approximate: boolean;
  context_note: string | null;
  evidence: EvidenceRef | null;
}

interface ResearchBrief {
  executive_summary: string;
  key_findings: KeyFinding[];
  timeline: TimelineEntry[];
  financial_exposure: FinancialExposure[];
  entities: { name: string; type: string; role: string }[];
  case_status: string;
  unknown_or_missing: string[];
  sources: EvidenceRef[];
}

const API = process.env.API_BASE_URL;

function EvidenceInline({ evidence }: { evidence: EvidenceRef | null }) {
  if (!evidence) return null;
  return (
    <details className="evidence-note" style={{ display: "inline-block", cursor: "pointer" }}>
      <summary>Evidence: {evidence.source_name}</summary>
      <div style={{ marginTop: "0.35rem" }}>
        <em>&ldquo;{evidence.excerpt}&rdquo;</em>
        {evidence.url && (
          <div>
            <a href={evidence.url} target="_blank" rel="noopener noreferrer">
              View source
            </a>
          </div>
        )}
      </div>
    </details>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [evidenceById, setEvidenceById] = useState<Record<string, EvidenceRef>>({});

  async function runQuery(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setBrief(null);
    try {
      const res = await fetch(`${API}/api/v1/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message || "Research query failed.");
        if (json?.data) setBrief(json.data);
        return;
      }
      setBrief(json.data);
      const map: Record<string, EvidenceRef> = {};
      for (const e of json.evidence ?? []) map[e.evidence_id] = e;
      setEvidenceById(map);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-serif)" }}>Research Query</h1>
      <p className="evidence-note">
        Ask a question in plain language. Every finding below is checked
        against the evidence actually retrieved — a finding citing anything
        we can&apos;t show you the source for is dropped before it ever
        reaches this page.
      </p>

      <form onSubmit={runQuery} style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. procurement irregularities in county governments since 2018"
          style={{ flex: 1, padding: "0.6rem", border: "1px solid var(--line)", borderRadius: 4 }}
        />
        <button
          type="submit"
          disabled={loading || query.length < 3}
          style={{ background: "var(--accent)", color: "white", border: "none", borderRadius: 4, padding: "0.6rem 1.2rem", fontWeight: 600 }}
        >
          {loading ? "Researching..." : "Search"}
        </button>
      </form>

      {error && <p style={{ color: "var(--accent)" }}>{error}</p>}

      {brief && (
        <div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Executive Summary</h3>
            <p>{brief.executive_summary}</p>
            <span className={`status-badge ${brief.case_status.toLowerCase()}`}>{brief.case_status.replace(/_/g, " ")}</span>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Key Findings</h3>
            {brief.key_findings.length === 0 && (
              <p className="evidence-note">No findings could be substantiated for this query.</p>
            )}
            {brief.key_findings.map((f, i) => (
              <div key={i} style={{ borderBottom: "1px solid var(--line)", padding: "0.6rem 0" }}>
                <p style={{ margin: "0 0 0.35rem" }}>{f.text}</p>
                {f.evidence_ids.map((id) => (
                  <span key={id}>
                    <EvidenceInline evidence={evidenceById[id] ?? null} />
                  </span>
                ))}
              </div>
            ))}
          </div>

          {brief.timeline.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Timeline</h3>
              {brief.timeline.map((t, i) => (
                <div key={i} style={{ borderBottom: "1px solid var(--line)", padding: "0.5rem 0" }}>
                  <strong>{t.date ?? "Date unknown"}</strong> — {t.description}
                  <EvidenceInline evidence={t.evidence} />
                </div>
              ))}
            </div>
          )}

          {brief.financial_exposure.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Financial Exposure (by type — not summed)</h3>
              {brief.financial_exposure.map((a, i) => (
                <div key={i} style={{ borderBottom: "1px solid var(--line)", padding: "0.5rem 0" }}>
                  {a.currency} {Number(a.amount).toLocaleString()} — {a.amount_type.replace(/_/g, " ")}
                  {a.is_approximate ? " (approx.)" : ""}
                  <EvidenceInline evidence={a.evidence} />
                </div>
              ))}
            </div>
          )}

          {brief.entities.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Entities</h3>
              <ul>
                {brief.entities.map((e, i) => (
                  <li key={i}>
                    {e.name} — {e.type.toLowerCase()}
                    {e.role ? ` · ${e.role.replace(/_/g, " ")}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Unknown / Missing Information</h3>
            <ul>
              {brief.unknown_or_missing.map((u, i) => (
                <li key={i} className="evidence-note">{u}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
