import { Router } from "express";
import { z } from "zod";
import { query } from "@corruptintel/database";
import { resolveEvidence } from "../lib/evidence";
import { ApiError } from "../middleware/errorHandler";

const router = Router();
const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(), county_id: z.string().uuid().optional(), sector_id: z.string().uuid().optional(),
  status: z.string().optional(), year_from: z.coerce.number().int().min(1900).max(2200).optional(), year_to: z.coerce.number().int().min(1900).max(2200).optional(),
  amount_min: z.coerce.number().finite().optional(), amount_max: z.coerce.number().finite().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0),
});

router.get("/", async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const conditions: string[] = ["c.is_published = true"];
    const params: unknown[] = [];
    let i = 1;
    if (q.q) {
      // Search the public case graph, not just its title: case summaries,
      // reviewed claims, named entities, source titles, and evidence excerpts.
      conditions.push(`(
        c.search_vector @@ websearch_to_tsquery('english', $${i}) OR
        EXISTS (SELECT 1 FROM case_claims cc WHERE cc.case_id = c.id AND cc.claim_text ILIKE $${i + 1}) OR
        EXISTS (SELECT 1 FROM case_entities ce JOIN entities en ON en.id = ce.entity_id WHERE ce.case_id = c.id AND en.canonical_name ILIKE $${i + 1}) OR
        EXISTS (SELECT 1 FROM case_sources cs JOIN document_versions dv ON dv.id = cs.document_version_id JOIN documents d ON d.id = dv.document_id WHERE cs.case_id = c.id AND (d.title ILIKE $${i + 1} OR d.canonical_url ILIKE $${i + 1})) OR
        EXISTS (SELECT 1 FROM case_claims cc JOIN evidence ev ON ev.id = cc.evidence_id WHERE cc.case_id = c.id AND ev.excerpt ILIKE $${i + 1})
      )`);
      params.push(q.q, `%${q.q}%`); i += 2;
    }
    if (q.county_id) { conditions.push(`c.county_id = $${i++}`); params.push(q.county_id); }
    if (q.sector_id) { conditions.push(`c.sector_id = $${i++}`); params.push(q.sector_id); }
    if (q.status) { conditions.push(`c.current_status = $${i++}`); params.push(q.status); }
    if (q.year_from) { conditions.push(`EXTRACT(YEAR FROM c.first_reported_date) >= $${i++}`); params.push(q.year_from); }
    if (q.year_to) { conditions.push(`EXTRACT(YEAR FROM c.first_reported_date) <= $${i++}`); params.push(q.year_to); }
    if (q.amount_min !== undefined) { conditions.push(`EXISTS (SELECT 1 FROM financial_amounts fa WHERE fa.case_id = c.id AND fa.amount >= $${i++})`); params.push(q.amount_min); }
    if (q.amount_max !== undefined) { conditions.push(`EXISTS (SELECT 1 FROM financial_amounts fa WHERE fa.case_id = c.id AND fa.amount <= $${i++})`); params.push(q.amount_max); }

    const whereClause = conditions.join(" AND ");
    const countResult = await query(`SELECT count(*)::int AS total FROM cases c WHERE ${whereClause}`, params);
    const total = countResult.rows[0]?.total ?? 0;
    const dataParams = [...params, q.limit, q.offset];
    const result = await query(
      `SELECT c.id, c.case_code, c.title, c.current_status, se.name AS sector, co.name AS county, c.source_count,
              c.source_confidence, c.extraction_confidence, c.entity_confidence, c.relationship_confidence, c.classification_confidence
       FROM cases c LEFT JOIN sectors se ON se.id = c.sector_id LEFT JOIN counties co ON co.id = c.county_id
       WHERE ${whereClause} ORDER BY c.first_reported_date DESC NULLS LAST, c.updated_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      dataParams
    );
    res.json({ data: result.rows.map((r: any) => ({ id: r.id, case_code: r.case_code, title: r.title, current_status: r.current_status, sector: r.sector, county: r.county, source_count: r.source_count, confidence: { source_confidence: r.source_confidence, extraction_confidence: r.extraction_confidence, entity_confidence: r.entity_confidence, relationship_confidence: r.relationship_confidence, classification_confidence: r.classification_confidence } })), meta: { total, limit: q.limit, offset: q.offset, has_more: q.offset + result.rows.length < total } });
  } catch (err) { next(err); }
});

// Detail route remains evidence-first and unchanged in behavior.
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const caseResult = await query(`SELECT c.*, se.name AS sector_name, co.name AS county_name FROM cases c LEFT JOIN sectors se ON se.id = c.sector_id LEFT JOIN counties co ON co.id = c.county_id WHERE c.id = $1 AND c.is_published = true`, [id]);
    const caseRow = caseResult.rows[0] as any;
    if (!caseRow) throw new ApiError(404, "NOT_FOUND", "Case not found.");
    const claimsResult = await query(`SELECT id, claim_text, certainty, evidence_id, conflicts_with_claim_id FROM case_claims WHERE case_id = $1 ORDER BY created_at ASC`, [id]);
    const statusEventsResult = await query(`SELECT id, status, event_date, evidence_id, notes FROM case_status_events WHERE case_id = $1 ORDER BY event_date ASC NULLS LAST, created_at ASC`, [id]);
    const amountsResult = await query(`SELECT amount::text, currency, amount_type, is_approximate, context_note, evidence_id FROM financial_amounts WHERE case_id = $1 ORDER BY created_at ASC`, [id]);
    const entitiesResult = await query(`SELECT ce.role, en.entity_type, en.canonical_name, ce.evidence_id FROM case_entities ce JOIN entities en ON en.id = ce.entity_id WHERE ce.case_id = $1`, [id]);
    const allEvidenceIds = [...claimsResult.rows, ...statusEventsResult.rows, ...amountsResult.rows, ...entitiesResult.rows].map((r: any) => r.evidence_id).filter(Boolean);
    const evidenceRefs = await resolveEvidence(allEvidenceIds);
    const evidenceById = new Map(evidenceRefs.map((e) => [e.evidence_id, e]));
    res.json({ data: { id: caseRow.id, case_code: caseRow.case_code, title: caseRow.title, current_status: caseRow.current_status, sector: caseRow.sector_name, county: caseRow.county_name, outcome_summary: caseRow.outcome_summary, confidence: { source_confidence: caseRow.source_confidence, extraction_confidence: caseRow.extraction_confidence, entity_confidence: caseRow.entity_confidence, relationship_confidence: caseRow.relationship_confidence, classification_confidence: caseRow.classification_confidence }, claims: claimsResult.rows.map((r: any) => ({ id: r.id, claim_text: r.claim_text, certainty: r.certainty, conflicts_with_claim_id: r.conflicts_with_claim_id, evidence: evidenceById.get(r.evidence_id) ?? null })), timeline: statusEventsResult.rows.map((r: any) => ({ status: r.status, date: r.event_date, notes: r.notes, evidence: evidenceById.get(r.evidence_id) ?? null })), financial_amounts: amountsResult.rows.map((r: any) => ({ amount: r.amount, currency: r.currency, amount_type: r.amount_type, is_approximate: r.is_approximate, context_note: r.context_note, evidence: evidenceById.get(r.evidence_id) ?? null })), entities: entitiesResult.rows.map((r: any) => ({ role: r.role, entity_type: r.entity_type, name: r.canonical_name, evidence: evidenceById.get(r.evidence_id) ?? null })) }, evidence: evidenceRefs });
  } catch (err) { next(err); }
});
export default router;
