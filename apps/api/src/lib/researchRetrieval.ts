import { query } from "@corruptintel/database";
import type { QueryFilters } from "@corruptintel/ai";
import { resolveEvidence } from "./evidence";
import type { EvidenceRef } from "@corruptintel/shared";
import type { RetrievedClaimForReport } from "@corruptintel/ai";

/**
 * Resolves query-planner filters into a list of matching PUBLISHED case ids.
 * This is plain, deterministic SQL — the planner's output only ever reaches
 * this function as data, never as something executed on its behalf
 * (AI Agent Architecture §8). No filter dimension here can express anything
 * beyond "match this name/range/status," so there's no injection surface
 * even though the filter values ultimately originated from a model reading
 * user input.
 */
export async function resolveCaseIdsFromFilters(filters: QueryFilters, limit = 8): Promise<string[]> {
  const conditions: string[] = ["c.is_published = true"];
  const params: unknown[] = [];
  let i = 1;

  function namePatterns(names?: string[]): string[] | null {
    if (!names || names.length === 0) return null;
    return names.map((n) => `%${n}%`);
  }

  const personPatterns = namePatterns(filters.person_names);
  if (personPatterns) {
    conditions.push(
      `c.id IN (SELECT ce.case_id FROM case_entities ce JOIN entities e ON e.id = ce.entity_id ` +
        `WHERE e.entity_type = 'PERSON' AND e.canonical_name ILIKE ANY($${i++}))`
    );
    params.push(personPatterns);
  }

  const companyPatterns = namePatterns(filters.company_names);
  if (companyPatterns) {
    conditions.push(
      `c.id IN (SELECT ce.case_id FROM case_entities ce JOIN entities e ON e.id = ce.entity_id ` +
        `WHERE e.entity_type = 'COMPANY' AND e.canonical_name ILIKE ANY($${i++}))`
    );
    params.push(companyPatterns);
  }

  const institutionPatterns = namePatterns(filters.institution_names);
  if (institutionPatterns) {
    conditions.push(
      `c.id IN (SELECT ce.case_id FROM case_entities ce JOIN entities e ON e.id = ce.entity_id ` +
        `WHERE e.entity_type = 'INSTITUTION' AND e.canonical_name ILIKE ANY($${i++})) ` +
        `OR c.institution_entity_id IN (SELECT id FROM entities WHERE canonical_name ILIKE ANY($${i - 1}))`
    );
    params.push(institutionPatterns);
  }

  const countyPatterns = namePatterns(filters.county_names);
  if (countyPatterns) {
    conditions.push(`c.county_id IN (SELECT id FROM counties WHERE name ILIKE ANY($${i++}))`);
    params.push(countyPatterns);
  }

  const sectorPatterns = namePatterns(filters.sector_names);
  if (sectorPatterns) {
    conditions.push(`c.sector_id IN (SELECT id FROM sectors WHERE name ILIKE ANY($${i++}))`);
    params.push(sectorPatterns);
  }

  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(`c.current_status = ANY($${i++}::case_status[])`);
    params.push(filters.statuses);
  }

  if (filters.year_from) {
    conditions.push(`EXTRACT(YEAR FROM c.first_reported_date) >= $${i++}`);
    params.push(filters.year_from);
  }
  if (filters.year_to) {
    conditions.push(`EXTRACT(YEAR FROM c.first_reported_date) <= $${i++}`);
    params.push(filters.year_to);
  }

  if (filters.amount_min != null || filters.amount_max != null) {
    const amountConds: string[] = [];
    if (filters.amount_min != null) {
      amountConds.push(`fa.amount >= $${i++}`);
      params.push(filters.amount_min);
    }
    if (filters.amount_max != null) {
      amountConds.push(`fa.amount <= $${i++}`);
      params.push(filters.amount_max);
    }
    conditions.push(
      `c.id IN (SELECT fa.case_id FROM financial_amounts fa WHERE fa.case_id IS NOT NULL AND ${amountConds.join(" AND ")})`
    );
  }

  const keywordPatterns = namePatterns(filters.free_text_keywords);
  if (keywordPatterns) {
    conditions.push(`c.title ILIKE ANY($${i++})`);
    params.push(keywordPatterns);
  }

  params.push(limit);
  const result = await query<{ id: string }>(
    `SELECT DISTINCT c.id, c.source_count
     FROM cases c
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.source_count DESC
     LIMIT $${i}`,
    params
  );

  return result.rows.map((r) => r.id);
}

export interface RetrievedCaseContext {
  id: string;
  case_code: string;
  title: string;
  current_status: string;
  claims: { id: string; claim_text: string; certainty: string; evidence_id: string; conflicts_with_claim_id: string | null }[];
  timeline: { status: string; date: string | null; notes: string | null; evidence_id: string | null }[];
  financial_amounts: { amount: string; currency: string; amount_type: string; is_approximate: boolean; evidence_id: string }[];
  entities: { role: string | null; entity_type: string; name: string; evidence_id: string }[];
}

/** Pulls the full evidence-linked shape for a set of case ids — the same
 * data the case-detail page renders, reused here so the research brief's
 * structured sections (timeline, financial exposure, entities) are built
 * from the exact same published rows, not a second, divergent path. */
export async function assembleCaseContexts(caseIds: string[]): Promise<RetrievedCaseContext[]> {
  if (caseIds.length === 0) return [];

  const casesResult = await query<{ id: string; case_code: string; title: string; current_status: string }>(
    `SELECT id, case_code, title, current_status FROM cases WHERE id = ANY($1::uuid[])`,
    [caseIds]
  );

  const contexts: RetrievedCaseContext[] = [];

  for (const caseRow of casesResult.rows) {
    const [claims, timeline, amounts, entities] = await Promise.all([
      query(
        `SELECT id, claim_text, certainty, evidence_id, conflicts_with_claim_id
         FROM case_claims WHERE case_id = $1`,
        [caseRow.id]
      ),
      query(
        `SELECT status, event_date, evidence_id, notes
         FROM case_status_events WHERE case_id = $1 ORDER BY event_date ASC NULLS LAST`,
        [caseRow.id]
      ),
      query(
        `SELECT amount::text, currency, amount_type, is_approximate, evidence_id
         FROM financial_amounts WHERE case_id = $1`,
        [caseRow.id]
      ),
      query(
        `SELECT ce.role, en.entity_type, en.canonical_name AS name, ce.evidence_id
         FROM case_entities ce JOIN entities en ON en.id = ce.entity_id WHERE ce.case_id = $1`,
        [caseRow.id]
      ),
    ]);

    contexts.push({
      id: caseRow.id,
      case_code: caseRow.case_code,
      title: caseRow.title,
      current_status: caseRow.current_status,
      claims: claims.rows as any,
      timeline: (timeline.rows as any).map((r: any) => ({ status: r.status, date: r.event_date, notes: r.notes, evidence_id: r.evidence_id })),
      financial_amounts: amounts.rows as any,
      entities: entities.rows as any,
    });
  }

  return contexts;
}

/** Flattens all claims across the retrieved case contexts into the shape the
 * Reporting Agent consumes, joined with their resolved evidence text. Also
 * returns the full evidence lookup map so the route can assemble the
 * deterministic timeline/financial/entity sections without a second round
 * of evidence resolution. */
export async function buildReportingContext(
  contexts: RetrievedCaseContext[]
): Promise<{
  claimsForReport: RetrievedClaimForReport[];
  allEvidence: EvidenceRef[];
  evidenceById: Map<string, EvidenceRef>;
}> {
  const allEvidenceIds = Array.from(
    new Set([
      ...contexts.flatMap((c) => c.claims.map((cl) => cl.evidence_id)),
      ...contexts.flatMap((c) => c.timeline.map((t) => t.evidence_id).filter(Boolean) as string[]),
      ...contexts.flatMap((c) => c.financial_amounts.map((a) => a.evidence_id)),
      ...contexts.flatMap((c) => c.entities.map((e) => e.evidence_id)),
    ])
  );

  const allEvidence = await resolveEvidence(allEvidenceIds);
  const evidenceById = new Map(allEvidence.map((e) => [e.evidence_id, e]));

  const claimsForReport: RetrievedClaimForReport[] = [];
  for (const ctx of contexts) {
    for (const claim of ctx.claims) {
      const ev = evidenceById.get(claim.evidence_id);
      if (!ev) continue; // should not happen given NOT NULL FK, but never trust a claim we can't show evidence for
      claimsForReport.push({
        case_title: ctx.title,
        claim_text: claim.claim_text,
        certainty: claim.certainty,
        evidence_id: ev.evidence_id,
        evidence_excerpt: ev.excerpt,
        evidence_source: ev.source_name,
      });
    }
  }

  return { claimsForReport, allEvidence, evidenceById };
}
