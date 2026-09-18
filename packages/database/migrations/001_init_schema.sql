-- ============================================================================
-- CorruptIntel — Database Schema (Phase 1)
-- PostgreSQL 15+, pgvector extension
-- Design principles:
--   1. Evidence and provenance are never optional — foreign keys enforce it.
--   2. Status/lifecycle fields are append-only history, never overwritten.
--   3. AI output lands in staging tables; publication is a separate, audited step.
--   4. Nothing about a real person is stated without a source_id trail.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgvector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy name matching
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. CORE REFERENCE / TAXONOMY
-- ----------------------------------------------------------------------------

CREATE TABLE countries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    iso_code        VARCHAR(3) UNIQUE NOT NULL,     -- 'KEN'
    name            TEXT NOT NULL,
    adapter_key     TEXT NOT NULL UNIQUE            -- maps to CountryAdapter implementation
);

CREATE TABLE counties (                             -- sub-national units (Kenya: 47 counties)
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country_id      UUID NOT NULL REFERENCES countries(id),
    name            TEXT NOT NULL,
    code            TEXT,
    UNIQUE(country_id, name)
);

CREATE TABLE sectors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT UNIQUE NOT NULL             -- Health, Infrastructure, Energy, ...
);

CREATE TABLE corruption_taxonomy (                   -- §16 taxonomy, hierarchical, evolvable
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id       UUID REFERENCES corruption_taxonomy(id),
    category        TEXT NOT NULL,                   -- 'PROCUREMENT'
    subcategory     TEXT,                             -- 'Tender manipulation'
    description     TEXT
);

-- Case status is a controlled vocabulary, never free text.
CREATE TYPE case_status AS ENUM (
    'REPORTED','ALLEGED','INVESTIGATION','UNDER_REVIEW','CHARGED',
    'COURT_PROCEEDINGS','CONVICTED','ACQUITTED','DISMISSED','WITHDRAWN',
    'SETTLED','UNRESOLVED'
);

CREATE TYPE source_tier AS ENUM ('TIER_1_PRIMARY','TIER_2_INSTITUTIONAL',
    'TIER_3_JOURNALISM','TIER_4_COMMENTARY','TIER_5_SOCIAL');

CREATE TYPE claim_certainty AS ENUM (
    'CONFIRMED','REPORTED','ALLEGED','INVESTIGATED','CHARGED',
    'CONVICTED','ACQUITTED_DISMISSED','UNKNOWN_UNRESOLVED'
);

CREATE TYPE amount_type AS ENUM (
    'CONTRACT_VALUE','TENDER_VALUE','ALLEGED_LOSS','IRREGULAR_EXPENDITURE',
    'UNSUPPORTED_EXPENDITURE','OVERPAYMENT','RECOVERY_AMOUNT','FINE',
    'PENALTY','BUDGET_ALLOCATION'
);

-- ----------------------------------------------------------------------------
-- 2. SOURCES, DOCUMENTS, EVIDENCE — the provenance backbone
-- ----------------------------------------------------------------------------

CREATE TABLE sources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,                    -- 'Office of the Auditor-General'
    publisher       TEXT,
    source_type     TEXT NOT NULL,                     -- 'government','court','media','ngo',...
    tier            source_tier NOT NULL,
    base_url        TEXT,
    country_id      UUID REFERENCES countries(id),
    connector_key   TEXT,                              -- which SourceConnector handles this
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (                              -- logical document, stable across versions
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       UUID NOT NULL REFERENCES sources(id),
    title           TEXT,
    document_type   TEXT,                              -- 'audit_report','judgment','news_article',...
    canonical_url   TEXT,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_removed      BOOLEAN NOT NULL DEFAULT FALSE      -- source took it down; never delete our copy
);

-- Idempotent versioning: same logical document, content changes over time.
CREATE TABLE document_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id     UUID NOT NULL REFERENCES documents(id),
    content_hash    TEXT NOT NULL,                      -- sha256 of raw bytes
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_date  DATE,
    retrieval_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    storage_path    TEXT NOT NULL,                       -- S3 key for raw file
    extracted_text_path TEXT,                             -- S3 key for normalized text
    mime_type       TEXT,
    page_count      INTEGER,
    ocr_applied     BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(document_id, content_hash)
);

CREATE INDEX idx_doc_versions_doc ON document_versions(document_id);

-- The atomic unit of "proof". Every factual claim traces to >=1 evidence row.
CREATE TABLE evidence (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_version_id UUID NOT NULL REFERENCES document_versions(id),
    page_reference      TEXT,                            -- 'p.87' or section id
    excerpt             TEXT NOT NULL,                    -- short, legally-bounded excerpt
    excerpt_char_limit_note TEXT DEFAULT 'excerpt capped to fair-use length',
    extracted_by        TEXT NOT NULL,                     -- 'ai:extraction-agent-v1.2' or 'human:<user_id>'
    extraction_confidence NUMERIC(4,3),                     -- 0.000–1.000
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_docver ON evidence(document_version_id);

-- ----------------------------------------------------------------------------
-- 3. ENTITIES: people, companies, institutions — with alias/resolution support
-- ----------------------------------------------------------------------------

CREATE TABLE entities (                               -- superclass row for graph joins
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type     TEXT NOT NULL CHECK (entity_type IN ('PERSON','COMPANY','INSTITUTION')),
    canonical_name  TEXT NOT NULL,
    country_id      UUID REFERENCES countries(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    merged_into_id  UUID REFERENCES entities(id)        -- soft-merge pointer; never hard-delete
);

CREATE INDEX idx_entities_name_trgm ON entities USING gin (canonical_name gin_trgm_ops);

CREATE TABLE entity_aliases (                          -- 'J. Kamau', 'Hon. John Kamau', ...
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id       UUID NOT NULL REFERENCES entities(id),
    alias           TEXT NOT NULL,
    source_document_version_id UUID REFERENCES document_versions(id), -- where this alias was seen
    UNIQUE(entity_id, alias)
);

CREATE TABLE people (
    entity_id       UUID PRIMARY KEY REFERENCES entities(id),
    date_of_birth_approx DATE,
    notes           TEXT
);

CREATE TABLE companies (
    entity_id       UUID PRIMARY KEY REFERENCES entities(id),
    registration_number TEXT,
    former_names    TEXT[]
);

CREATE TABLE institutions (
    entity_id       UUID PRIMARY KEY REFERENCES entities(id),
    institution_type TEXT,                              -- 'ministry','county_government','state_corporation',...
    government_level TEXT                                 -- 'national','county'
);

CREATE TABLE positions (                                -- person's role at an institution/company over time
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    person_entity_id UUID NOT NULL REFERENCES entities(id),
    org_entity_id    UUID NOT NULL REFERENCES entities(id),
    title            TEXT NOT NULL,
    start_date       DATE,
    end_date         DATE,
    evidence_id      UUID REFERENCES evidence(id)
);

-- Entity-resolution review queue — never auto-merge on name similarity alone.
CREATE TABLE entity_merge_candidates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_a_id     UUID NOT NULL REFERENCES entities(id),
    entity_b_id     UUID NOT NULL REFERENCES entities(id),
    similarity_score NUMERIC(4,3),
    matching_signals JSONB,                              -- {name_sim, org_match, role_match, date_overlap,...}
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','MERGED','REJECTED')),
    reviewed_by     UUID,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. CASES — the canonical corruption-case entity (§7)
-- ----------------------------------------------------------------------------

CREATE TABLE cases (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_code           TEXT UNIQUE NOT NULL,             -- 'CI-0000124'
    title               TEXT NOT NULL,
    country_id          UUID NOT NULL REFERENCES countries(id),
    jurisdiction        TEXT,
    sector_id           UUID REFERENCES sectors(id),
    government_level    TEXT,
    institution_entity_id UUID REFERENCES entities(id),
    county_id           UUID REFERENCES counties(id),
    allegation_type_id  UUID REFERENCES corruption_taxonomy(id),
    current_status      case_status NOT NULL DEFAULT 'REPORTED',
    first_reported_date DATE,
    incident_date_approx DATE,
    resolution_date     DATE,
    outcome_summary     TEXT,
    source_count        INTEGER NOT NULL DEFAULT 0,
    -- Confidence is multi-dimensional (§33) — never a single "truth score"
    source_confidence      NUMERIC(4,3),
    extraction_confidence   NUMERIC(4,3),
    entity_confidence       NUMERIC(4,3),
    relationship_confidence NUMERIC(4,3),
    classification_confidence NUMERIC(4,3),
    is_published        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable status history — a case can move backward/branch; never overwrite.
CREATE TABLE case_status_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id         UUID NOT NULL REFERENCES cases(id),
    status          case_status NOT NULL,
    event_date      DATE,
    evidence_id     UUID NOT NULL REFERENCES evidence(id),  -- status changes MUST cite evidence
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_case_status_events_case ON case_status_events(case_id);

-- Every discrete claim inside a case ("X was named", "Y flagged Z amount") —
-- this is the join between narrative and evidence, enforcing §2 evidence-first.
CREATE TABLE case_claims (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id         UUID NOT NULL REFERENCES cases(id),
    claim_text      TEXT NOT NULL,                        -- evidence-qualified language only
    certainty       claim_certainty NOT NULL,
    evidence_id     UUID NOT NULL REFERENCES evidence(id),
    conflicts_with_claim_id UUID REFERENCES case_claims(id), -- for "sources conflict" surfacing
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_entities (                             -- many-to-many, with role context
    case_id         UUID NOT NULL REFERENCES cases(id),
    entity_id       UUID NOT NULL REFERENCES entities(id),
    role            TEXT,                                  -- 'named_person','contractor','institution',...
    evidence_id     UUID NOT NULL REFERENCES evidence(id),
    PRIMARY KEY (case_id, entity_id, role)
);

CREATE TABLE case_sources (                              -- rollup for source_count + quick lookup
    case_id         UUID NOT NULL REFERENCES cases(id),
    document_version_id UUID NOT NULL REFERENCES document_versions(id),
    PRIMARY KEY (case_id, document_version_id)
);

-- ----------------------------------------------------------------------------
-- 5. FINANCIAL AMOUNTS — semantics preserved, never collapsed into one number
-- ----------------------------------------------------------------------------

CREATE TABLE financial_amounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id         UUID REFERENCES cases(id),
    contract_id     UUID,                                  -- FK added after contracts table below
    amount           NUMERIC(20,2) NOT NULL,
    currency         TEXT NOT NULL DEFAULT 'KES',
    amount_type      amount_type NOT NULL,
    context_note     TEXT,
    is_approximate   BOOLEAN NOT NULL DEFAULT FALSE,
    evidence_id      UUID NOT NULL REFERENCES evidence(id),
    extraction_confidence NUMERIC(4,3),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id          UUID REFERENCES cases(id),
    awarding_institution_entity_id UUID REFERENCES entities(id),
    awarded_to_entity_id UUID REFERENCES entities(id),
    description      TEXT,
    award_date       DATE,
    evidence_id      UUID NOT NULL REFERENCES evidence(id)
);

ALTER TABLE financial_amounts
    ADD CONSTRAINT fk_amount_contract FOREIGN KEY (contract_id) REFERENCES contracts(id);

-- ----------------------------------------------------------------------------
-- 6. RELATIONSHIP GRAPH (§10)
-- ----------------------------------------------------------------------------

CREATE TYPE relationship_type AS ENUM (
    'WORKED_FOR','DIRECTED','OWNED','CONTROLLED','AWARDED','RECEIVED',
    'CONTRACTED','INVESTIGATED','CHARGED','PROSECUTED','CONVICTED',
    'ACQUITTED','MENTIONED_IN','AUDITED_BY','REPORTED_BY','SERVED_ON','CONNECTED_TO'
);

CREATE TABLE relationships (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_entity_id  UUID NOT NULL REFERENCES entities(id),
    to_entity_id    UUID NOT NULL REFERENCES entities(id),
    relationship_type relationship_type NOT NULL,
    case_id         UUID REFERENCES cases(id),
    evidence_id     UUID NOT NULL REFERENCES evidence(id),   -- graph edges require evidence, never AI speculation
    start_date      DATE,
    end_date        DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_from ON relationships(from_entity_id);
CREATE INDEX idx_rel_to ON relationships(to_entity_id);

-- ----------------------------------------------------------------------------
-- 7. AI STAGING — where model output lands BEFORE it can influence anything public
-- ----------------------------------------------------------------------------

CREATE TABLE ai_extractions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_version_id UUID NOT NULL REFERENCES document_versions(id),
    extraction_type TEXT NOT NULL,                          -- 'entity','event','amount','relationship','status'
    payload         JSONB NOT NULL,                          -- raw structured proposal
    model_name      TEXT NOT NULL,
    model_version   TEXT NOT NULL,
    confidence      NUMERIC(4,3) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','AUTO_APPROVED','APPROVED','REJECTED')),
    reviewed_by     UUID,
    reviewed_at     TIMESTAMPTZ,
    resulting_row_id UUID,                                   -- points to the published row once approved
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_extractions_status ON ai_extractions(status);
CREATE INDEX idx_ai_extractions_docver ON ai_extractions(document_version_id);

CREATE TABLE review_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_type       TEXT NOT NULL,                            -- 'ai_extraction','entity_merge','case_status',...
    item_id         UUID NOT NULL,
    priority        TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
    reason          TEXT,                                       -- why it needs review, e.g. "low confidence 0.61"
    assigned_to     UUID,
    status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 8. VECTOR SEARCH SUPPORT
-- ----------------------------------------------------------------------------

CREATE TABLE document_chunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_version_id UUID NOT NULL REFERENCES document_versions(id),
    chunk_index     INTEGER NOT NULL,
    chunk_text      TEXT NOT NULL,
    embedding       vector(1536),
    tsv             tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
    UNIQUE(document_version_id, chunk_index)
);

CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_chunks_tsv ON document_chunks USING gin (tsv);

-- ----------------------------------------------------------------------------
-- 9. USERS, RBAC, AUDIT
-- ----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('PUBLIC','RESEARCHER','SENIOR_RESEARCHER','ADMIN');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT,                                     -- null if OAuth-only
    role            user_role NOT NULL DEFAULT 'RESEARCHER',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id   UUID REFERENCES users(id),
    actor_type      TEXT NOT NULL DEFAULT 'human' CHECK (actor_type IN ('human','system','ai')),
    action          TEXT NOT NULL,                              -- 'case.publish','entity.merge','case.status_change',...
    target_table    TEXT NOT NULL,
    target_id       UUID NOT NULL,
    before_state     JSONB,
    after_state      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_target ON audit_logs(target_table, target_id);

-- ----------------------------------------------------------------------------
-- 10. SOURCE MONITORING
-- ----------------------------------------------------------------------------

CREATE TABLE source_monitor_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       UUID NOT NULL REFERENCES sources(id),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    documents_found INTEGER DEFAULT 0,
    documents_new   INTEGER DEFAULT 0,
    documents_changed INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
    error_detail    TEXT
);

-- ============================================================================
-- End of Phase 1 schema. Deliberately excluded until MVP requires it:
--   - Elasticsearch/OpenSearch (Postgres FTS covers MVP scale)
--   - Multi-country partitioning (handled logically via country_id for now)
--   - Public API rate-limit tables (added with API gateway in Phase 5+)
-- ============================================================================
