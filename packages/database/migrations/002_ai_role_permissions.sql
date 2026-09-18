-- ============================================================================
-- Migration 002 — least-privilege database roles (Security Architecture §5)
--
-- This is the mechanical enforcement of "the AI cannot write truth directly":
-- corruptintel_ai has INSERT/SELECT on staging tables and SELECT-only on
-- published tables. It has no grant at all on users/audit_logs.
-- Run this after 001_init_schema.sql. Passwords here are LOCAL DEV DEFAULTS —
-- override in production via your secret manager, never hardcode there.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'corruptintel_ai') THEN
    CREATE ROLE corruptintel_ai LOGIN PASSWORD 'corruptintel_ai_dev_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE corruptintel TO corruptintel_ai;
GRANT USAGE ON SCHEMA public TO corruptintel_ai;

-- Staging tables: AI can read and propose, never approve itself.
GRANT SELECT, INSERT, UPDATE ON
    ai_extractions,
    entity_merge_candidates,
    review_queue,
    document_chunks
TO corruptintel_ai;

-- Ingestion-adjacent tables the worker/AI path needs to read/write while
-- processing a document (creating versions, chunks) — but note: cases,
-- entities, evidence, relationships, financial_amounts, case_claims,
-- case_status_events are NOT writable by this role. Only SELECT below.
GRANT SELECT, INSERT ON
    documents,
    document_versions
TO corruptintel_ai;

GRANT SELECT ON
    sources,
    entities,
    entity_aliases,
    people,
    companies,
    institutions,
    cases,
    case_claims,
    case_status_events,
    case_entities,
    case_sources,
    financial_amounts,
    contracts,
    relationships,
    evidence,
    corruption_taxonomy,
    sectors,
    counties,
    countries
TO corruptintel_ai;

-- Explicitly no grants on users or audit_logs — enforced by omission.
-- Sequences: allow nextval where the role can insert.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO corruptintel_ai;
