# CorruptIntel — Security Architecture (Phase 1)

## 1. Authentication & Authorization
- Session-based auth for `apps/web` (httpOnly, secure, SameSite cookies) with OAuth option for staff SSO.
- RBAC roles: `PUBLIC` (read-only, no login) < `RESEARCHER` < `SENIOR_RESEARCHER` < `ADMIN`. Enforced centrally in `packages/security`, not re-implemented per route.
- Publication of a case (`is_published = true`) requires `SENIOR_RESEARCHER` or above.
- Entity merges, source registration, and status-event insertion all require `RESEARCHER`+ and produce an `audit_logs` row.

## 2. Secrets & Credentials
- All external credentials (OCR API keys, LLM provider keys, object storage keys, DB creds) live in environment variables, injected via the deployment platform's secret manager — never committed. `.env.example` documents every required variable with a description, per the brief's §42 rule.

## 3. Input Validation & Injection Defense
- Standard SQL-injection defense via parameterized queries/ORM only — no raw string-interpolated SQL.
- Prompt-injection defense is architectural, not just a system-prompt instruction: retrieved document content is (a) wrapped in an explicit untrusted-content boundary in every LLM call, and (b) the model has no direct write permission to any published table regardless of what it "concludes" from adversarial content in a source document (full detail in AI Agent Architecture §7).
- File uploads/fetched documents pass through malware/virus scanning before parsing or storage.

## 4. API Security
- Rate limiting per IP/API key on all public endpoints, tighter limits on `/research` (LLM-backed, costlier).
- CSRF protection on state-changing web routes.
- Standard secure headers (CSP, HSTS, X-Content-Type-Options, etc.) at the edge/CDN layer.

## 5. Least Privilege at the Database Layer
- The AI service's database role has INSERT/SELECT only on staging tables (`ai_extractions`, `document_chunks`, `entity_merge_candidates`, `review_queue`) and SELECT-only on published tables (`cases`, `entities`, `evidence`, `relationships`, `financial_amounts`, etc.). This makes "the AI directly altered a published fact" not a plausible failure mode — it isn't a permissions bug to catch, it's a permission that doesn't exist.
- The worker's ingestion role can write to `documents`/`document_versions`/`sources` but not to published intelligence tables.
- Only the API service's "publish" code path (invoked by human action) holds write permission on published tables, and even that path requires an `audit_logs` insert in the same transaction.

## 6. Audit Logging
- Every write to a published table outside of migrations goes through code that also writes `audit_logs` in the same transaction (actor, action, before/after state). This is enforced by a shared repository-layer helper rather than left to each call site to remember.

## 7. Encrypted Backups & Storage
- Object storage (raw documents, extracted text, OCR output) encrypted at rest.
- Database backups encrypted at rest and in transit; backup restore tested as part of the deployment runbook (Phase 2 deliverable).

## 8. Privacy / Defamation Safeguards as a Security Concern
Treated here because the failure mode is legal exposure, not just data quality: any write path that would assert or imply a specific real person's legal status routes through human review regardless of AI confidence (see AI Agent Architecture §4, Evidence Model §2). This is enforced by the routing logic, not by asking reviewers to "remember" to be careful.

## 9. Testing (ties to §38)
Security test suite includes: authZ boundary tests per role, adversarial prompt-injection fixtures run against the extraction/reporting agents, malicious-document fixtures (zip bombs, oversized files, script-laden HTML) against the ingestion pipeline, and API-abuse/rate-limit tests.
