"use client";

import { useState } from "react";

interface CaseResult { id: string; case_code: string; title: string; current_status: string; sector: string | null; county: string | null; source_count: number; }
const API = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "http://localhost:4000";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [searched, setSearched] = useState(false);

  async function runQuery(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 3) return;
    setLoading(true); setError(null); setSearched(true);
    try {
      const response = await fetch(`${API}/api/v1/cases?q=${encodeURIComponent(value)}&limit=50`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || "Search failed.");
      setResults(json.data || []);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Could not reach the search service.");
    } finally { setLoading(false); }
  }

  return <div>
    <h1 style={{ fontFamily: "var(--font-serif)" }}>Search the evidence</h1>
    <p className="evidence-note">Search published, evidence-backed cases by title, institution, sector, or issue. AI research synthesis remains available from the research API when configured.</p>
    <form onSubmit={runQuery} style={{ display: "flex", gap: ".5rem", margin: "1rem 0", flexWrap: "wrap" }}>
      <label htmlFor="case-search" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Search cases</label>
      <input id="case-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. procurement, county government, finance" minLength={3} required style={{ flex: "1 1 300px", padding: ".7rem", border: "1px solid var(--line)", borderRadius: 4 }} />
      <button type="submit" disabled={loading || query.trim().length < 3} className="button button-primary">{loading ? "Searching…" : "Search"}</button>
    </form>
    {error && <p role="alert" style={{ color: "var(--accent)" }}>{error}</p>}
    {searched && !loading && !error && results.length === 0 && <p className="evidence-note">No published cases matched “{query.trim()}”. Try a broader term.</p>}
    {results.map((item) => <a key={item.id} href={`/cases/${item.id}`} style={{ textDecoration: "none", color: "inherit" }}><article className="card"><div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}><strong>{item.title}</strong><span className={`status-badge ${item.current_status.toLowerCase()}`}>{item.current_status.replace(/_/g, " ")}</span></div><div style={{ color: "var(--muted)", fontSize: ".85rem", marginTop: ".35rem" }}>{item.case_code} · {item.sector || "Sector unspecified"} · {item.county || "County unspecified"} · {item.source_count} source{item.source_count === 1 ? "" : "s"}</div></article></a>)}
  </div>;
}
