import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "@corruptintel/database";
import { requireRole, writeAuditLog, AuthedRequest } from "@corruptintel/security";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

// All admin routes require at least RESEARCHER.
router.use(requireRole("RESEARCHER"));

// GET /admin/review-queue — open items awaiting human decision.
router.get("/review-queue", async (req, res, next) => {
  try {
    const priority = (req.query.priority as string) || undefined;

    const result = await query(
      `SELECT id, item_type, item_id, priority, reason, status, created_at
       FROM review_queue
       WHERE status = 'OPEN' ${priority ? "AND priority = $1" : ""}
       ORDER BY
         CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
         created_at ASC
       LIMIT 100`,
      priority ? [priority] : []
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /admin/ai-extractions/:id — full payload for a staged proposal, so a
// reviewer can see exactly what the model proposed (including its cited
// source_span and, for entities, resolution candidates) before approving.
router.get("/ai-extractions/:id", async (req: AuthedRequest, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await query(
      `SELECT ae.*, dv.document_id, d.title AS document_title, d.canonical_url
       FROM ai_extractions ae
       JOIN document_versions dv ON dv.id = ae.document_version_id
       JOIN documents d ON d.id = dv.document_id
       WHERE ae.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "AI extraction not found.");
    }
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

const decisionSchema = z.object({
  notes: z.string().optional(),
});

// POST /admin/review-queue/:id/approve
// Marks the queue item resolved and the underlying ai_extraction APPROVED.
// This does NOT itself write the fact into a published table — a human
// approving an extraction still goes through the normal typed insert path
// (a follow-up call to the relevant admin endpoint, e.g. case status or
// entity merge) so there is always an explicit, reviewable record of what
// was actually published, not just "AI proposal #123 was approved."
router.post("/review-queue/:id/approve", async (req: AuthedRequest, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { notes } = decisionSchema.parse(req.body ?? {});
    const userId = req.user!.sub;

    await withTransaction(async (client) => {
      const item = await client.query(
        `SELECT * FROM review_queue WHERE id = $1 AND status = 'OPEN' FOR UPDATE`,
        [id]
      );
      if (item.rows.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Review queue item not found or already resolved.");
      }

      await client.query(
        `UPDATE review_queue SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`,
        [id]
      );

      if (item.rows[0].item_type === "ai_extraction") {
        await client.query(
          `UPDATE ai_extractions SET status = 'APPROVED', reviewed_by = $1, reviewed_at = now()
           WHERE id = $2`,
          [userId, item.rows[0].item_id]
        );
      }

      await writeAuditLog(client, {
        actorUserId: userId,
        actorType: "human",
        action: "review_queue.approve",
        targetTable: "review_queue",
        targetId: id,
        afterState: { notes },
      });
    });

    res.json({ data: { id, status: "RESOLVED" } });
  } catch (err) {
    next(err);
  }
});

// POST /admin/review-queue/:id/reject
router.post("/review-queue/:id/reject", async (req: AuthedRequest, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { notes } = decisionSchema.parse(req.body ?? {});
    const userId = req.user!.sub;

    await withTransaction(async (client) => {
      const item = await client.query(
        `SELECT * FROM review_queue WHERE id = $1 AND status = 'OPEN' FOR UPDATE`,
        [id]
      );
      if (item.rows.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Review queue item not found or already resolved.");
      }

      await client.query(
        `UPDATE review_queue SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`,
        [id]
      );

      if (item.rows[0].item_type === "ai_extraction") {
        await client.query(
          `UPDATE ai_extractions SET status = 'REJECTED', reviewed_by = $1, reviewed_at = now()
           WHERE id = $2`,
          [userId, item.rows[0].item_id]
        );
      }

      await writeAuditLog(client, {
        actorUserId: userId,
        actorType: "human",
        action: "review_queue.reject",
        targetTable: "review_queue",
        targetId: id,
        afterState: { notes },
      });
    });

    res.json({ data: { id, status: "RESOLVED" } });
  } catch (err) {
    next(err);
  }
});

const statusChangeSchema = z.object({
  status: z.enum([
    "REPORTED", "ALLEGED", "INVESTIGATION", "UNDER_REVIEW", "CHARGED",
    "COURT_PROCEEDINGS", "CONVICTED", "ACQUITTED", "DISMISSED", "WITHDRAWN",
    "SETTLED", "UNRESOLVED",
  ]),
  event_date: z.string().optional(),
  evidence_id: z.string().uuid(), // status changes MUST cite evidence — enforced here AND at the DB level
  notes: z.string().optional(),
});

// POST /admin/cases/:id/status — appends a case_status_events row. Never
// overwrites current_status in place without also recording the history row,
// and never accepts a status change with no evidence_id (schema also
// enforces this with NOT NULL, but we reject early with a clear message).
router.post("/cases/:id/status", async (req: AuthedRequest, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = statusChangeSchema.parse(req.body);
    const userId = req.user!.sub;

    await withTransaction(async (client) => {
      const before = await client.query(`SELECT current_status FROM cases WHERE id = $1`, [id]);
      if (before.rows.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Case not found.");
      }

      await client.query(
        `INSERT INTO case_status_events (case_id, status, event_date, evidence_id, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, body.status, body.event_date ?? null, body.evidence_id, body.notes ?? null]
      );

      await client.query(`UPDATE cases SET current_status = $1, updated_at = now() WHERE id = $2`, [
        body.status,
        id,
      ]);

      await writeAuditLog(client, {
        actorUserId: userId,
        actorType: "human",
        action: "case.status_change",
        targetTable: "cases",
        targetId: id,
        beforeState: { status: before.rows[0].current_status },
        afterState: { status: body.status, evidence_id: body.evidence_id },
      });
    });

    res.json({ data: { id, status: body.status } });
  } catch (err) {
    next(err);
  }
});

// POST /admin/cases/:id/publish — requires SENIOR_RESEARCHER+.
router.post("/cases/:id/publish", requireRole("SENIOR_RESEARCHER"), async (req: AuthedRequest, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = req.user!.sub;

    await withTransaction(async (client) => {
      const existing = await client.query(`SELECT is_published FROM cases WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Case not found.");
      }
      // Guard: refuse to publish a case with zero sources — a case with no
      // evidence trail should not be reachable, but this is a belt-and-braces
      // check at the one moment a case becomes publicly visible.
      const sourceCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM case_sources WHERE case_id = $1`,
        [id]
      );
      if (sourceCount.rows[0].n === 0) {
        throw new ApiError(
          422,
          "INSUFFICIENT_EVIDENCE",
          "Cannot publish a case with no linked sources."
        );
      }

      await client.query(`UPDATE cases SET is_published = true, updated_at = now() WHERE id = $1`, [id]);

      await writeAuditLog(client, {
        actorUserId: userId,
        actorType: "human",
        action: "case.publish",
        targetTable: "cases",
        targetId: id,
        beforeState: { is_published: existing.rows[0].is_published },
        afterState: { is_published: true },
      });
    });

    res.json({ data: { id, is_published: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
