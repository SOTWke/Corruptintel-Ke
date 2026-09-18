import { Router } from "express";
import { z } from "zod";
import { query } from "@corruptintel/database";
import { resolveEvidence } from "../lib/evidence";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

const listQuerySchema = z.object({
  q: z.string().optional(),
  county_id: z.string().uuid().optional(),
  sector_id: z.string().uuid().optional(),
  status: z.string().optional(),
  year_from: z.coerce.number().int().optional(),
  year_to: z.coerce.number().int().optional(),
  amount_min: z.coerce.number().optional(),
  amount_max: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

// GET /cases — filtered, paginated case summaries. Only published cases.
router.get("/", async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    const conditions: string[] = ["c.is_published = true"];
    const params: unknown[] = [];
    let i = 1;

    if (q.q) {
      conditions.push(`c.title ILIKE $${i++}`);
      params.push(`%${q.q}%`);
    }
    if (q.county_id) {
      conditions.push(`c.county_id = $${i++}`);
      params.push(q.county_id);
    }
    if (q.sector_id) {
      conditions.push(`c.sector_id = $${i++}`);
      params.push(q.sector_id);
    }
    if (q.status) {
      conditions.push(`c.current_status = $${i++}`);
      params.push(q.status);
    }
    if (q.year_from) {
      conditions.push(`EXTRACT(YEAR FROM c.first_reported_date) >= $${i++}`);
      params.push(q.year_from);
    }
    if (q.year_to) {
      conditions.push(`EXTRACT(YEAR FROM c.first_reported_date) <= $${i++}`);
      params.push(q.year_to);
    }

    const whereClause = conditions.join(" AND ");
    params.push(q.limit, q.offset);

    const result = await query(
      `SELECT c.id, c.case_code, c.title, c.current_status,
              se.name AS sector, co.name AS county, c.source_count,
              c.source_confidence, c.extraction_confidence, c.entity_confidence,
              c.relationship_confidence, c.classification_confidence
       FROM cases c
       LEFT JOIN sectors se ON se.id = c.sector_id
       LEFT JOIN counties co ON co.id = c.county_id
       WHERE ${whereClause}
       ORDER BY c.first_reported_date DESC NULLS LAST
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );

    res.json({
      data: result.rows.map((r: any) => ({
        id: r.id,
        case_code: r.case_code,
        title: r.title,
        current_status: r.current_status,
        sector: r.sector,
        county: r.county,
        source_count: r.source_count,
        confidence: {
          source_confidence: r.source_confidence,
          extraction_confidence: r.extraction_confidence,
          entity_confidence: r.entity_confidence,
          relationship_confidence: r.relationship_confidence,
          classification_confidence: r.classification_confidence,
        },
      })),
      meta: { limit: q.limit, offset: q.offset },
    });
  } catch (err) {
    next(err);
  }
});

// GET /cases/:id — full detail: claims (each with evidence + certainty),
// timeline, amounts (typed, never summed), entities, sources.
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const caseResult = await query(
      `SELECT c.*, se.name AS sector_name, co.name AS county_name
       FROM cases c
       LEFT JOIN sectors se ON se.id = c.sector_id
       LEFT JOIN counties co ON co.id = c.county_id
       WHERE c.id = $1 AND c.is_published = true`,
      [id]
    );
    const caseRow = caseResult.rows[0] as any;
    if (!caseRow) {
      throw new ApiError(404, "NOT_FOUND", "Case not found.");
    }

    const claimsResult = await query(
      `SELECT id, claim_text, certainty, evidence_id, conflicts_with_claim_id
       FROM case_claims WHERE case_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    const statusEventsResult = await query(
      `SELECT id, status, event_date, evidence_id, notes
       FROM case_status_events WHERE case_id = $1 ORDER BY event_date ASC NULLS LAST, created_at ASC`,
      [id]
    );

    const amountsResult = await query(
      `SELECT amount::text, currency, amount_type, is_approximate, context_note, evidence_id
       FROM financial_amounts WHERE case_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    const entitiesResult = await query(
      `SELECT ce.role, en.entity_type, en.canonical_name, ce.evidence_id
       FROM case_entities ce
       JOIN entities en ON en.id = ce.entity_id
       WHERE ce.case_id = $1`,
      [id]
    );

    const allEvidenceIds = [
      ...claimsResult.rows.map((r: any) => r.evidence_id),
      ...statusEventsResult.rows.map((r: any) => r.evidence_id),
      ...amountsResult.rows.map((r: any) => r.evidence_id),
      ...entitiesResult.rows.map((r: any) => r.evidence_id),
    ].filter(Boolean);

    const evidenceRefs = await resolveEvidence(allEvidenceIds);
    const evidenceById = new Map(evidenceRefs.map((e) => [e.evidence_id, e]));

    res.json({
      data: {
        id: caseRow.id,
        case_code: caseRow.case_code,
        title: caseRow.title,
        current_status: caseRow.current_status,
        sector: caseRow.sector_name,
        county: caseRow.county_name,
        outcome_summary: caseRow.outcome_summary,
        confidence: {
          source_confidence: caseRow.source_confidence,
          extraction_confidence: caseRow.extraction_confidence,
          entity_confidence: caseRow.entity_confidence,
          relationship_confidence: caseRow.relationship_confidence,
          classification_confidence: caseRow.classification_confidence,
        },
        claims: claimsResult.rows.map((r: any) => ({
          id: r.id,
          claim_text: r.claim_text,
          certainty: r.certainty,
          conflicts_with_claim_id: r.conflicts_with_claim_id,
          evidence: evidenceById.get(r.evidence_id) ?? null,
        })),
        timeline: statusEventsResult.rows.map((r: any) => ({
          status: r.status,
          date: r.event_date,
          notes: r.notes,
          evidence: evidenceById.get(r.evidence_id) ?? null,
        })),
        // Financial amounts are intentionally NOT summed here — each row
        // keeps its own amount_type. Aggregation happens only in
        // /statistics, and even there, separately per type.
        financial_amounts: amountsResult.rows.map((r: any) => ({
          amount: r.amount,
          currency: r.currency,
          amount_type: r.amount_type,
          is_approximate: r.is_approximate,
          context_note: r.context_note,
          evidence: evidenceById.get(r.evidence_id) ?? null,
        })),
        entities: entitiesResult.rows.map((r: any) => ({
          role: r.role,
          entity_type: r.entity_type,
          name: r.canonical_name,
          evidence: evidenceById.get(r.evidence_id) ?? null,
        })),
      },
      evidence: evidenceRefs,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
