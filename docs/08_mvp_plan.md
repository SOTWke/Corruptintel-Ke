# CorruptIntel — MVP Implementation Plan (Phase 1 output)

## Scope (§40, §51 — do not overbuild)

A working vertical slice, 50–200 curated Kenyan documents, proving:
open dashboard → search a case → open it → see summary, institutions, financial figures (typed, not summed), timeline, evidence → open the original source → ask the AI a question → get a grounded, cited answer.

## Build Order (maps to §41's phases, condensed for MVP)

1. **Foundation** — monorepo scaffold, Docker Compose (Postgres+pgvector, Redis, MinIO for S3-compatible storage), auth + RBAC, base Next.js shell, base API service skeleton.
2. **Evidence Engine** — `sources`, `documents`, `document_versions`, `evidence` tables live; one connector (`AuditorGeneralConnector` or a curated static-file connector for the first 50 documents) fetching, hashing, storing, parsing.
3. **Intelligence Engine** — `entities`, `cases`, `case_claims`, `case_status_events`, `financial_amounts`, `relationships`; Extraction + Classification + Entity Resolution agents wired to `ai_extractions` + `review_queue`; admin review console (approve/reject only, minimal UI).
4. **Search** — Postgres FTS live first; `document_chunks` + pgvector added same phase since embeddings are cheap to generate during ingestion.
5. **AI Research Agent** — Orchestrator + Reporting Agent producing the structured brief via `/research`; grounded against published evidence only.
6. **Dashboard & Case Pages** — `/dashboard`, `/cases`, `/cases/[id]`, `/people|companies|institutions/[id]`, `/search`, basic statistics with separated exposure/loss/recovered figures.
7. **Monitoring** — scheduled `discover()` reruns, `source_monitor_runs` logging, basic system-health view.

Explicitly deferred past MVP: Elasticsearch, multi-country adapters beyond the `CountryAdapter` interface shape, network-graph visualization polish, historical backfill to 1963, public API keys for external consumers, i18n beyond English (Swahili UI strings can be stubbed but full translation is post-MVP).

## Acceptance Criteria (§52, unchanged — carried forward verbatim as the definition of done)
- Every factual case claim has provenance.
- Users can find cases via keyword and natural-language search.
- AI responses are grounded in retrieved evidence; unsupported points return "insufficient evidence" rather than a guess.
- Duplicate documents/cases are handled (content-hash idempotency).
- Unauthorized users cannot reach admin functionality.
- All changes to published data are audit-logged.
- Architecture supports scaling document volume without a core rewrite (hybrid search + staging/publish separation are the load-bearing design choices here).
- Financial figures preserve original semantic meaning (typed `amount_type`, never summed across types).
- Allegations are clearly attributed; procedural status is preserved and never overstated.

## Immediate Next Steps From Here

This turn produced the ten Phase-1 architecture deliverables the brief calls for (§53: architecture, ERD/schema, repo structure, API spec, AI-agent architecture, ingestion architecture, evidence/provenance model, security architecture, MVP plan — repo structure is embedded in the system architecture doc). The natural next step is Phase 2 (Foundation): scaffold the actual repo, Docker Compose environment, and a running migration against the schema above — happy to start that whenever you're ready, and we can build it incrementally with tests at each stage as the brief specifies, rather than in one large drop.
