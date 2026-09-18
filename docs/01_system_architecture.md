# CorruptIntel — System Architecture (Phase 1)

**Tagline:** Follow the Money. Track the Evidence. Expose the Pattern.
**Scope v1:** Kenya. Architecture is country-agnostic via `CountryAdapter`.

## 1. Guiding Constraint

The single non-negotiable rule that shapes every layer of this system:

> **ALLEGATION ≠ INVESTIGATION ≠ CHARGE ≠ COURT CASE ≠ CONVICTION ≠ PROVEN FACT**

This is not a UI copywriting rule. It is enforced structurally:
- The database schema makes `status` a first-class, append-only-history field — never a free-text label.
- The AI layer cannot write directly to published tables. It writes only to `ai_extractions` (a staging area). Promotion to a published `cases` record requires either a deterministic rule (e.g., a primary-source document with a machine-readable status field) or human review.
- Every user-facing claim resolves to one or more `evidence` rows with a `source_id`. A claim with zero evidence rows cannot render.

## 2. High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          apps/web (Next.js)                      │
│  Public site, dashboard, case pages, search, AI chat, admin UI   │
└───────────────────────────────┬───────────────────────────────────┘
                                 │ REST/JSON (internal API contract)
┌───────────────────────────────▼───────────────────────────────────┐
│                          apps/api (Node.js)                       │
│  AuthN/AuthZ · Cases · Entities · Search · Research · Admin       │
└───────┬──────────────────┬──────────────────┬────────────────────┘
        │                  │                  │
┌───────▼───────┐  ┌───────▼────────┐ ┌───────▼─────────┐
│  packages/db  │  │ packages/search │ │ packages/ai      │
│  Postgres ORM │  │ FTS + pgvector  │ │ Orchestrator +    │
│  + migrations │  │ hybrid retrieve │ │ sub-agents (§AI)  │
└───────┬───────┘  └───────┬────────┘ └───────┬─────────┘
        │                  │                  │
┌───────▼──────────────────▼──────────────────▼─────────┐
│                    PostgreSQL + pgvector                │
└──────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────────┐
│                        apps/worker (Node.js)                      │
│  Source monitoring · document fetch · OCR · extraction ·          │
│  entity resolution · classification · review-queue dispatch       │
│  (BullMQ on Redis; scheduled + event-driven jobs)                 │
└───────┬──────────────────────────────────┬────────────────────────┘
        │                                  │
┌───────▼───────┐                 ┌────────▼────────┐
│ packages/      │                 │ S3-compatible    │
│ connectors     │                 │ object storage   │
│ (SourceConnector│                │ (raw docs,       │
│ interface)      │                │ snapshots, OCR)  │
└───────────────┘                 └─────────────────┘
```

## 3. Monorepo Layout (maps to §37 of the brief)

```
/apps
  /web       — Next.js + TypeScript frontend (public + admin)
  /api       — Node.js API service (REST)
  /worker    — background jobs: ingestion, extraction, monitoring
/packages
  /database  — Postgres schema, migrations, query layer
  /ai        — provider-agnostic LLM client + agent definitions
  /search    — hybrid FTS + vector search
  /entities  — entity resolution, alias management
  /evidence  — evidence/provenance model, citation formatting
  /connectors — SourceConnector implementations per source type
  /security  — auth, RBAC, input validation, prompt-injection guards
  /shared    — shared types (TypeScript), constants, taxonomy
/infrastructure
  /docker
  /deployment
/docs
```

## 4. Data Flow Summary (maps to §5 pipeline)

`SourceConnector.discover()` → new/changed documents queued → `fetch()` downloads + hashes + stores raw file in object storage → `parse()` extracts text (OCR if scanned) → normalization → **Extraction Agent** pulls entities/events/amounts into `ai_extractions` (never directly into published tables) → **Entity Resolution Agent** proposes matches/aliases (auto-accept only above a high similarity + corroboration threshold; otherwise queued) → **Classification Agent** tags taxonomy + proposed status → **Verification Agent** checks source tier, cross-references conflicting sources, computes confidence dimensions → human review queue for anything touching an identifiable person's status → publication → case + evidence rows become live → continuous monitoring re-runs `discover()` against known sources on a schedule and on webhook where available.

## 5. Idempotency

Every ingested document is keyed by `(source_id, content_hash)`. Re-fetching an unchanged document is a no-op. A changed document creates a new `document_version` linked to the same logical `document_id`, never an in-place overwrite — this preserves the historical record required by §45 (data provenance) and §28 (corrections history).

## 6. Why this shape

- **AI never writes truth directly** — it writes proposals with confidence scores; deterministic code and/or humans decide what becomes a published fact. This is the mechanical enforcement of §14 (no-hallucination policy) and §44 (human-in-the-loop).
- **Country logic is isolated in `CountryAdapter`** (institutions, legal terms, procurement systems, source connectors) so Kenya-specific work in Phase 1 doesn't have to be unwound later per §47.
- **Search is hybrid from day one** (Postgres FTS now, pgvector alongside) rather than vector-only, per §12/§24 — corruption-research queries are often exact-entity/exact-amount lookups where lexical search outperforms embeddings.
