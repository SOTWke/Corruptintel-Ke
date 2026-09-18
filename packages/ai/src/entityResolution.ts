import { getAiPool } from "@corruptintel/database";

export interface EntityMatchCandidate {
  entityId: string;
  canonicalName: string;
  entityType: string;
  similarity: number;
}

/**
 * Proposes existing entities that might be the same real-world person/
 * company/institution as `mentionedName`. This is deliberately deterministic
 * (Postgres pg_trgm similarity), not an LLM call — per Evidence & Provenance
 * Model / AI Agent Architecture: "Never automatically merge entities solely
 * because names are similar," and matching signals should be inspectable,
 * reproducible numbers a human reviewer can sanity-check, not a model's
 * unexplained judgment call.
 *
 * Callers combine this with role/organization/date context (matchingSignals)
 * when writing an entity_merge_candidates row — see
 * apps/worker/src/jobs/extract.ts. Nothing here writes to the database.
 */
export async function findEntityMatchCandidates(
  mentionedName: string,
  entityType: "PERSON" | "COMPANY" | "INSTITUTION",
  similarityThreshold = 0.35
): Promise<EntityMatchCandidate[]> {
  const pool = getAiPool();
  const result = await pool.query(
    `SELECT id AS entity_id, canonical_name, entity_type,
            similarity(canonical_name, $1) AS similarity
     FROM entities
     WHERE entity_type = $2
       AND merged_into_id IS NULL
       AND similarity(canonical_name, $1) > $3
     ORDER BY similarity DESC
     LIMIT 5`,
    [mentionedName, entityType, similarityThreshold]
  );

  return result.rows.map((r: any) => ({
    entityId: r.entity_id,
    canonicalName: r.canonical_name,
    entityType: r.entity_type,
    similarity: Number(r.similarity),
  }));
}

/** Threshold above which a match is confident enough to auto-link a NEW
 * mention to an EXISTING entity as an alias (still logged, still reversible)
 * rather than requiring human review — but never confident enough to merge
 * two already-distinct entity records into one. Per the brief: name
 * similarity alone should never trigger a full merge, only alias-linking to
 * a single already-established entity is eligible for this fast path. */
export const AUTO_ALIAS_THRESHOLD = 0.9;
