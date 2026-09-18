import { Router } from "express";
import { query } from "@corruptintel/database";

const router = Router();

// GET /statistics — dashboard aggregates. Per the brief's §17 rule, this
// deliberately does NOT sum all monetary figures into one "money stolen"
// number. Each amount_type is aggregated separately, and case counts are
// broken out by status rather than collapsed into "corrupt vs. not."
router.get("/", async (_req, res, next) => {
  try {
    const caseCounts = await query(
      `SELECT current_status, COUNT(*)::int AS count
       FROM cases WHERE is_published = true
       GROUP BY current_status`
    );

    const amountTotals = await query(
      `SELECT fa.amount_type, fa.currency, SUM(fa.amount)::text AS total
       FROM financial_amounts fa
       JOIN cases c ON c.id = fa.case_id
       WHERE c.is_published = true
       GROUP BY fa.amount_type, fa.currency`
    );

    const institutionsAffected = await query(
      `SELECT COUNT(DISTINCT institution_entity_id)::int AS count
       FROM cases WHERE is_published = true AND institution_entity_id IS NOT NULL`
    );

    const countiesAffected = await query(
      `SELECT COUNT(DISTINCT county_id)::int AS count
       FROM cases WHERE is_published = true AND county_id IS NOT NULL`
    );

    res.json({
      data: {
        cases_by_status: Object.fromEntries(
          caseCounts.rows.map((r: any) => [r.current_status, r.count])
        ),
        // Keyed by amount_type so the frontend can never accidentally sum
        // across types — e.g. "reported_exposure" (ALLEGED_LOSS +
        // IRREGULAR_EXPENDITURE + UNSUPPORTED_EXPENDITURE) is a display-layer
        // grouping decision the frontend makes explicitly, not something
        // this endpoint decides for it.
        financial_totals_by_type: amountTotals.rows.map((r: any) => ({
          amount_type: r.amount_type,
          currency: r.currency,
          total: r.total,
        })),
        institutions_affected: institutionsAffected.rows[0]?.count ?? 0,
        counties_affected: countiesAffected.rows[0]?.count ?? 0,
      },
      meta: {
        note:
          "Financial totals are grouped by amount_type and must not be summed across types into a single figure.",
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
