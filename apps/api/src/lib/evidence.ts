import { query } from "@corruptintel/database";
import type { EvidenceRef } from "@corruptintel/shared";
import { InsufficientEvidenceError } from "../middleware/errorHandler";

/**
 * Resolves a list of evidence_ids into full EvidenceRef objects (source name,
 * tier, document title, excerpt, etc.) by joining evidence -> document_versions
 * -> documents -> sources. This is the ONE place that assembles evidence for
 * API responses — every route that returns a claim should go through this
 * rather than hand-rolling the join, so the "no claim without evidence" rule
 * has a single enforcement point instead of being re-implemented per route.
 */
export async function resolveEvidence(evidenceIds: string[]): Promise<EvidenceRef[]> {
  if (evidenceIds.length === 0) return [];

  const result = await query<{
    evidence_id: string;
    source_name: string;
    source_tier: string;
    document_title: string | null;
    page_reference: string | null;
    excerpt: string;
    url: string | null;
    retrieval_date: string;
    extraction_confidence: number | null;
  }>(
    `SELECT
       e.id AS evidence_id,
       s.name AS source_name,
       s.tier AS source_tier,
       d.title AS document_title,
       e.page_reference,
       e.excerpt,
       COALESCE(d.canonical_url, s.base_url) AS url,
       dv.retrieval_date::text AS retrieval_date,
       e.extraction_confidence
     FROM evidence e
     JOIN document_versions dv ON dv.id = e.document_version_id
     JOIN documents d ON d.id = dv.document_id
     JOIN sources s ON s.id = d.source_id
     WHERE e.id = ANY($1::uuid[])`,
    [evidenceIds]
  );

  return result.rows as unknown as EvidenceRef[];
}

/** Call at the end of building any evidenced response. Throws rather than
 * letting a claim render with zero evidence — see InsufficientEvidenceError. */
export function assertHasEvidence(evidence: EvidenceRef[]): void {
  if (evidence.length === 0) {
    throw new InsufficientEvidenceError();
  }
}
