-- ============================================================================
-- Migration 004 — normalized text on document_versions
--
-- The Ingestion Architecture doc notes that raw bytes + extracted text
-- belong in S3-compatible object storage in production. That client isn't
-- wired yet (still a pending item — see README). At MVP scale (dozens to a
-- few hundred documents), storing the normalized text directly in Postgres
-- is an honest interim choice rather than faking an object-storage
-- integration: it lets the extraction pipeline actually run end-to-end now,
-- and migrating this column's contents into object storage later is a
-- mechanical follow-up, not a redesign.
-- ============================================================================

ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS normalized_text TEXT;

-- Marks when the extraction pipeline has processed this version (regardless
-- of whether it yielded any proposals), so the extract job doesn't reprocess
-- a version forever just because a chunk had nothing extractable in it.
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS extraction_processed_at TIMESTAMPTZ;

-- The AI role needs to read what it will extract from, and write it during
-- ingestion (see packages/database/migrations/002_ai_role_permissions.sql —
-- corruptintel_ai already has SELECT+INSERT on document_versions, so no
-- grant change is needed here; this comment just documents why that's enough).
