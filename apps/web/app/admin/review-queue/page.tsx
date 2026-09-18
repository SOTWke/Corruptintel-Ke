"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authHeaders, getToken, getRole, clearSession } from "../../../lib/auth";

interface ReviewQueueItem {
  id: string;
  item_type: string;
  item_id: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  reason: string | null;
  status: string;
  created_at: string;
}

interface ExtractionDetail {
  id: string;
  extraction_type: string;
  payload: unknown;
  model_name: string;
  model_version: string;
  confidence: number;
  document_title: string | null;
  canonical_url: string | null;
}

const API = process.env.API_BASE_URL;

export default function ReviewQueuePage() {
  const router = useRouter();
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [details, setDetails] = useState<Record<string, ExtractionDetail>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/review-queue`, { headers: authHeaders() });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const json = await res.json();
      setItems(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    setRole(getRole());
    loadQueue();
  }, [loadQueue, router]);

  async function toggleExpand(item: ReviewQueueItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (item.item_type === "ai_extraction" && !details[item.item_id]) {
      const res = await fetch(`${API}/api/v1/admin/ai-extractions/${item.item_id}`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        setDetails((prev) => ({ ...prev, [item.item_id]: json.data }));
      }
    }
  }

  async function decide(item: ReviewQueueItem, decision: "approve" | "reject") {
    setActionError(null);
    const res = await fetch(`${API}/api/v1/admin/review-queue/${item.id}/${decision}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setActionError(json?.error?.message || `Failed to ${decision} item.`);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  function logout() {
    clearSession();
    router.push("/login");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-serif)" }}>Review Queue</h1>
        <div>
          {role && <span style={{ color: "var(--muted)", marginRight: "1rem" }}>{role}</span>}
          <button onClick={logout} style={{ background: "none", border: "1px solid var(--line)", padding: "0.4rem 0.8rem", borderRadius: 4, cursor: "pointer" }}>
            Log out
          </button>
        </div>
      </div>

      <p className="evidence-note">
        Every item here is an AI proposal, not a published fact. Approving an
        item marks the underlying extraction reviewed — it does not by itself
        publish anything to a case page. Nothing about a named person&apos;s
        legal status is ever auto-approved.
      </p>

      {actionError && <p style={{ color: "var(--accent)" }}>{actionError}</p>}
      {loading && <p>Loading...</p>}
      {!loading && items.length === 0 && (
        <p className="evidence-note">Queue is empty — nothing awaiting review right now.</p>
      )}

      {items.map((item) => {
        const detail = details[item.item_id];
        const isExpanded = expandedId === item.id;
        return (
          <div key={item.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span
                  className="status-badge"
                  style={{
                    background: item.priority === "URGENT" || item.priority === "HIGH" ? "#f5dcdc" : "#ececec",
                    color: item.priority === "URGENT" || item.priority === "HIGH" ? "var(--accent)" : "var(--muted)",
                    marginRight: "0.5rem",
                  }}
                >
                  {item.priority}
                </span>
                <strong>{item.item_type.replace(/_/g, " ")}</strong>
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{item.reason}</div>
              </div>
              <button onClick={() => toggleExpand(item)} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 4, padding: "0.35rem 0.7rem", cursor: "pointer" }}>
                {isExpanded ? "Hide detail" : "Show detail"}
              </button>
            </div>

            {isExpanded && (
              <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--line)", paddingTop: "0.75rem" }}>
                {!detail && <p className="evidence-note">Loading detail...</p>}
                {detail && (
                  <>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
                      From: {detail.document_title || detail.canonical_url} · model {detail.model_name}/{detail.model_version} · confidence {(detail.confidence * 100).toFixed(0)}%
                    </div>
                    <pre style={{ background: "#f4f4f2", padding: "0.75rem", borderRadius: 4, overflowX: "auto", fontSize: "0.8rem" }}>
                      {JSON.stringify(detail.payload, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}

            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => decide(item, "approve")}
                style={{ background: "var(--confirmed)", color: "white", border: "none", borderRadius: 4, padding: "0.45rem 1rem", cursor: "pointer" }}
              >
                Approve
              </button>
              <button
                onClick={() => decide(item, "reject")}
                style={{ background: "none", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 4, padding: "0.45rem 1rem", cursor: "pointer" }}
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
