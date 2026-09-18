# CorruptIntel

Follow the Money. Track the Evidence. Expose the Pattern.

An evidence-first corruption intelligence platform. Initial scope: Kenya.
Core rule enforced end to end: **no claim exists in this system without a
resolved evidence trail back to a source document** — enforced at the
database level (`NOT NULL evidence_id` constraints), not just by convention.

Architecture docs live in `/docs` (Phase 1 deliverables: system architecture,
full database schema, API spec, AI agent architecture, ingestion
architecture, evidence/provenance model, security architecture, MVP plan).

## What's in this repo (Phase 4 — AI Research Agent)

```
/apps
  /web     — Next.js frontend: landing page, dashboard, case explorer, case detail,
             researcher login, admin review-queue UI, and a research query page
  /api     — Express API: auth, cases, statistics, admin (review queue, ai-extraction
             detail, publish), and a fully wired /research endpoint
  /worker  — BullMQ workers: ingestion (SourceConnector + CuratedFileConnector) and
             extraction (Extraction/Classification agents + evidence linking + entity resolution)
/packages
  /database  — Postgres client, migrations (schema + AI role permissions + seed data +
               normalized-text column), migration runner
  /security  — password hashing, JWT sessions, RBAC middleware, audit logging
  /shared    — TypeScript types mirroring the database's controlled vocabularies
  /ai        — provider-agnostic LLM client (Anthropic), prompt-injection boundary
               wrapper, extraction/classification agents, evidence-span verifier,
               deterministic entity-resolution matching, query planner, reporting agent
/infrastructure/docker — Dockerfiles for api/worker/web
/docs — Phase 1 architecture documents
```

## Quick Start (local, without Docker)

Requires Node.js 20+, and local Postgres 15+/16 with `pgvector` installed
(or use the Docker Compose services below just for postgres/redis/minio).

```bash
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET, JWT_SECRET, SEED_ADMIN_PASSWORD,
# and ANTHROPIC_API_KEY if/when you wire up the AI agent phase.

npm install

# Start Postgres, Redis, MinIO only (leave out api/worker/web from compose):
docker compose up -d postgres redis minio

npm run migrate        # applies 001_init_schema, 002_ai_role_permissions, 003_seed_reference_data
npm run seed:admin     # creates your first ADMIN user from SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD

npm run dev:api        # http://localhost:4000  (try GET /health)
npm run dev:web        # http://localhost:3000
npm run dev:worker     # starts the ingestion scheduler (BullMQ)
```

## Quick Start (full Docker)

```bash
cp .env.example .env   # fill in secrets first
docker compose up --build
```

Web: http://localhost:3000 · API: http://localhost:4000 · MinIO console: http://localhost:9001

## Bootstrapping your first documents

Drop a handful of `.txt`/`.md`/`.html` files into `apps/worker/seed-documents/`
(see the README there) — the worker's `CuratedFileConnector` will pick them
up on its next scheduled run (every 6h by default; restart the worker to run
immediately) and create `documents`/`document_versions` rows.

Once documents are stored, the **extraction worker** (same `npm run
dev:worker` process, a separate BullMQ queue polling every 15 minutes) picks
up any `document_versions` it hasn't processed yet, runs the Extraction
Agent on chunked text, verifies every claimed quote against the actual
source text (unverified claims are rejected and get no evidence row — see
`packages/ai/src/evidenceLinker.ts`), and stages the result into
`ai_extractions` + `review_queue`. This step requires `ANTHROPIC_API_KEY` in
`.env` — without it, the extraction job will throw and retry on the next
scheduled run rather than fabricating output.

Log in at `/login` with the admin account from `npm run seed:admin`, then
visit `/admin/review-queue` to see staged proposals, expand each to see the
model's cited source span and confidence, and approve or reject. Approving
resolves the queue item and marks the underlying extraction `APPROVED` — it
intentionally does **not** itself insert a case, entity, or claim into a
published table. That typed insert (creating a `case`, appending a
`case_status_events` row with the required `evidence_id`, etc.) is a
deliberate separate step via the admin endpoints in
`apps/api/src/routes/admin.ts`, so there's always an explicit, reviewable
record of what actually became public — not just "proposal #123 was
approved."

## Asking the research agent a question

Once at least one case is published (`is_published = true`), visit
`/search` and ask a plain-language question. The pipeline behind it
(`apps/api/src/routes/research.ts`):

1. **Query Planner** (LLM) turns the question into structured filters —
   never SQL, never anything executable, just names/ranges/statuses.
2. **Deterministic SQL** (`apps/api/src/lib/researchRetrieval.ts`) resolves
   those filters against published cases only.
3. **Deterministic assembly** pulls each matched case's claims, timeline,
   financial amounts, and entities — exactly the same rows the case detail
   page renders, each already carrying its `evidence_id`.
4. **Reporting Agent** (LLM) writes only two things: `key_findings` (each
   required to cite `evidence_id`s from what was actually retrieved) and
   `unknown_or_missing` (statements of absence, which don't need citations).
5. A mechanical check drops any finding that cites an `evidence_id` outside
   what was retrieved — the same discipline as the extraction pipeline's
   evidence linker, applied at the report level.

Timeline, financial exposure, entities, and sources are never written by a
model — they're a direct projection of published rows. If the query planner
or reporting call fails (e.g. no `ANTHROPIC_API_KEY`), the endpoint returns
a `503` rather than a fabricated answer.

## The one rule that shapes everything here

> ALLEGATION ≠ INVESTIGATION ≠ CHARGE ≠ COURT CASE ≠ CONVICTION ≠ PROVEN FACT

Concretely, in this codebase, that means:
- `financial_amounts`, `relationships`, `case_claims`, `case_status_events`,
  and `contracts` all have a `NOT NULL evidence_id` — you cannot insert one
  without pointing at a real, stored, hashed source document.
- The AI's database role (`corruptintel_ai`, see
  `packages/database/migrations/002_ai_role_permissions.sql`) has **no write
  grant on any published table** — only on staging tables (`ai_extractions`,
  `review_queue`, `entity_merge_candidates`, `document_chunks`) and the raw
  ingestion tables (`documents`, `document_versions`). A hallucinated fact
  has nowhere to be written even if it's generated.
- Publishing a case requires `SENIOR_RESEARCHER`+ and is refused outright if
  the case has zero linked sources (`apps/api/src/routes/admin.ts`).
- The frontend's case page renders a "Show Evidence" disclosure on every
  single claim, timeline entry, financial figure, and named entity — there's
  no code path that renders prose about a real person without it.

## What's deliberately not built yet

Per the brief's own phasing (`docs/08_mvp_plan.md`) and "do not overbuild"
instruction: live government-site connectors (Auditor-General, Judiciary,
PPRA, Hansard, EACC — currently only the interface + a curated-local-file
connector exist), the Entity Resolution Agent's merge-candidate write path
for already-published duplicate entities (matching a *new* mention against
existing entities is wired; deduplicating two already-existing entity
records is not), vector search wiring against `document_chunks` (embeddings
are not being generated — no embedding provider is wired, so the research
agent's retrieval is structured-filter + FTS-fallback only, not semantic —
an honest gap rather than a faked one), the network-graph visualization, and
object storage for raw document bytes (normalized text lives directly in
Postgres for MVP scale — see the comment in migration 004 for why, and what
changes when that's swapped in). Building any of these next is a reasonable
place to pick back up.
