# CorruptIntel — API Specification (Phase 1)

Base URL: `/api/v1`
Format: JSON. Auth: session cookie (web) or Bearer token (future public API).
Every response that includes a factual claim about a case, person, company, or institution includes an `evidence` array — this is not optional and is enforced at the serializer level, not left to each endpoint author.

## Standard Response Envelope

```json
{
  "data": { ... },
  "meta": { "confidence": {...}, "generated_at": "..." },
  "evidence": [
    {
      "evidence_id": "uuid",
      "source_name": "Office of the Auditor-General",
      "source_tier": "TIER_1_PRIMARY",
      "document_title": "...",
      "page_reference": "p.87",
      "excerpt": "short excerpt, fair-use bounded",
      "url": "...",
      "retrieval_date": "2026-08-29",
      "extraction_confidence": 0.94
    }
  ]
}
```

Error envelope:
```json
{ "error": { "code": "INSUFFICIENT_EVIDENCE", "message": "..." } }
```

## Public Read Endpoints

### `GET /cases`
Filters: `q, person_id, company_id, institution_id, county_id, sector_id, status, year_from, year_to, amount_min, amount_max, amount_type, allegation_type`
Returns paginated case summaries. Each summary includes `current_status`, `confidence` object (multi-dimensional, never a single score), and `source_count`.

### `GET /cases/:id`
Full case detail: claims (each with certainty + evidence), timeline, entities involved, financial amounts (typed, not summed), related cases, sources, correction history.

### `GET /people/:id` / `GET /companies/:id` / `GET /institutions/:id`
Entity profile: canonical name + aliases, known roles/timeline, cases, contracts, relationships, evidence for every listed fact. Never returns a derived "risk score."

### `GET /sources/:id`
Source metadata, tier, all document versions on file, cases derived from it.

### `GET /search?q=...`
Hybrid search (FTS + vector). Natural-language queries are parsed into structured filters server-side (see AI architecture §NL-to-filter) before hitting the query planner — the LLM proposes filters, deterministic code executes the query.

### `GET /timeline?entity_id=|case_id=`
Ordered event list with evidence per event.

### `GET /statistics`
Dashboard aggregates. Explicitly separate fields — `reported_exposure_total`, `alleged_loss_total`, `confirmed_loss_total`, `recovered_total` — never a single "total stolen" figure (per §17).

### `GET /relationships?entity_id=`
Graph edges for the network view. Every edge includes its `evidence_id`.

## AI Research Endpoint

### `POST /research`
```json
{ "query": "Investigate procurement irregularities involving Institution X" }
```
Response is a structured research brief (Executive Summary, Key Findings, Timeline, Financial Exposure, Entities, Institutions, Evidence, Conflicting Accounts, Case Status, Unknown/Missing Information, Sources) — see AI Agent Architecture doc for how this is produced and grounded. This endpoint is read-only against the published graph; it cannot create or alter cases.

## Admin / Researcher Endpoints (RBAC: RESEARCHER+)

- `GET /admin/review-queue` — pending AI extractions, entity-merge candidates, low-confidence items
- `POST /admin/review-queue/:id/approve` | `/reject` — requires reviewer id, writes audit log
- `POST /admin/entities/:id/merge` — human-confirmed merge only; writes audit log; never automatic
- `POST /admin/entities/:id/split`
- `POST /admin/cases/:id/status` — appends a `case_status_events` row; requires `evidence_id`
- `POST /admin/sources` — register a new source + connector config
- `POST /admin/cases/:id/publish` — flips `is_published`; requires SENIOR_RESEARCHER+, writes audit log
- `GET /admin/system-health` — queue depth, source availability, extraction failure rate, token usage

## Design Rules Baked Into the API Layer

1. **No endpoint returns a claim without evidence.** The serializer layer refuses to emit a `case_claims` row that lacks a resolved `evidence_id` join — this is a database constraint (`NOT NULL`), not just an app-layer convention.
2. **Write endpoints that touch identifiable people require a human `reviewed_by` on the audit log**, even when the underlying data is deterministic (e.g., linking a person to a court judgment already on file).
3. **`/research` cannot write.** Read-only, always. Any leads it surfaces for further investigation route through the human review queue, not straight to publication.
