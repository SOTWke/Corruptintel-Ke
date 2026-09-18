import { getPool, getAiPool } from "@corruptintel/database";
import {
  runExtractionAgent,
  runClassificationAgent,
  verifySpan,
  buildFallbackReference,
  findEntityMatchCandidates,
  AUTO_ALIAS_THRESHOLD,
} from "@corruptintel/ai";
import { chunkText } from "../lib/chunker";

const EXTRACTION_MODEL_LABEL = "extraction-agent-v0.1";
const CLASSIFICATION_MODEL_LABEL = "classification-agent-v0.1";

interface UnprocessedVersion {
  id: string;
  document_id: string;
  normalized_text: string;
  document_title: string | null;
  canonical_url: string | null;
}

/**
 * Processes up to `batchSize` not-yet-extracted document_versions:
 *  1. Chunk the normalized text.
 *  2. Run the Extraction Agent on each chunk (untrusted content, wrapped).
 *  3. Verify every claimed source_span against the actual chunk text —
 *     unverified items are REJECTED and get no evidence row, full stop.
 *  4. For verified items, create an `evidence` row (deterministic write,
 *     full-privilege pool — see note below) and stage an `ai_extractions`
 *     row via the restricted AI pool.
 *  5. Route every verified item into `review_queue`. Nothing here writes to
 *     a published table (cases, entities, financial_amounts, etc.) — that
 *     only happens when a human approves via the admin console, which then
 *     performs the actual typed insert (see apps/api/src/routes/admin.ts).
 *
 * On evidence rows: creating one is a DETERMINISTIC act (a literal substring
 * match), not an LLM assertion of truth, so it's done via the full-privilege
 * pool rather than the AI-restricted pool — the AI role intentionally has no
 * INSERT grant on `evidence` (see migrations/002_ai_role_permissions.sql).
 * The untrusted part is the LLM's claimed span; verifySpan() is what
 * actually earns it an evidence row, and that check is plain string code,
 * not a model call.
 */
export async function runExtractionJob(batchSize = 5): Promise<{
  versionsProcessed: number;
  itemsVerified: number;
  itemsRejected: number;
}> {
  const aiPool = getAiPool();
  const fullPool = getPool();

  const pending = await aiPool.query<UnprocessedVersion>(
    `SELECT dv.id, dv.document_id, dv.normalized_text, d.title AS document_title, d.canonical_url
     FROM document_versions dv
     JOIN documents d ON d.id = dv.document_id
     WHERE dv.extraction_processed_at IS NULL
       AND dv.normalized_text IS NOT NULL
       AND length(dv.normalized_text) > 0
     ORDER BY dv.fetched_at ASC
     LIMIT $1`,
    [batchSize]
  );

  let itemsVerified = 0;
  let itemsRejected = 0;

  for (const version of pending.rows) {
    const sourceLabel = version.document_title || version.canonical_url || version.document_id;
    const chunks = chunkText(version.normalized_text);

    for (const chunk of chunks) {
      let extraction;
      try {
        extraction = await runExtractionAgent(chunk, sourceLabel);
      } catch (err) {
        console.error(`Extraction agent failed on document_version ${version.id}:`, err);
        continue; // leave extraction_processed_at unset — will retry next run
      }

      const { output, modelName, modelVersion } = extraction;

      if (output.suspicious_content_detected) {
        console.warn(
          `Extraction agent flagged suspicious/injection-like content in document_version ${version.id}. ` +
            `Continuing normally — the model has no write access regardless of what the content asked for.`
        );
      }

      // --- Financial amounts ---
      for (const item of output.financial_amounts) {
        const verification = verifySpan(chunk, item.source_span);
        if (!verification.verified) {
          itemsRejected++;
          await stageRejected(aiPool, version.id, "financial_amount", item, modelName, modelVersion);
          continue;
        }
        itemsVerified++;
        const evidenceId = await createEvidence(
          fullPool,
          version.id,
          verification,
          chunk.length
        );
        const extractionId = await stageVerified(
          aiPool,
          version.id,
          "financial_amount",
          { ...item, evidence_id: evidenceId },
          modelName,
          modelVersion,
          0.85
        );
        await enqueueReview(fullPool, extractionId, "NORMAL", "New financial amount proposed from extraction.");
      }

      // --- Proposed claims (with classification) ---
      for (const item of output.proposed_claims) {
        const verification = verifySpan(chunk, item.source_span);
        if (!verification.verified) {
          itemsRejected++;
          await stageRejected(aiPool, version.id, "claim", item, modelName, modelVersion);
          continue;
        }
        itemsVerified++;
        const evidenceId = await createEvidence(fullPool, version.id, verification, chunk.length);

        let classification = null;
        try {
          const classResult = await runClassificationAgent(item.source_span, sourceLabel);
          classification = classResult.output;
        } catch (err) {
          console.error(`Classification agent failed for a claim in document_version ${version.id}:`, err);
        }

        const extractionId = await stageVerified(
          aiPool,
          version.id,
          "claim",
          { ...item, evidence_id: evidenceId, classification },
          modelName,
          modelVersion,
          0.85
        );

        // Anything touching legal/procedural status is HIGH priority for
        // review regardless of confidence — never eligible for auto-approve
        // (AI Agent Architecture §4 / Evidence Model §2).
        const highStakes = ["CHARGED", "CONVICTED", "ACQUITTED_DISMISSED", "INVESTIGATED"].includes(
          item.certainty
        );
        await enqueueReview(
          fullPool,
          extractionId,
          highStakes ? "HIGH" : "NORMAL",
          `Proposed claim (${item.certainty}) requires human verification before publication.`
        );
      }

      // --- Entity mentions (with resolution candidates attached) ---
      for (const item of output.entity_mentions) {
        const verification = verifySpan(chunk, item.source_span);
        if (!verification.verified) {
          itemsRejected++;
          await stageRejected(aiPool, version.id, "entity", item, modelName, modelVersion);
          continue;
        }
        itemsVerified++;
        const evidenceId = await createEvidence(fullPool, version.id, verification, chunk.length);

        const candidates = await findEntityMatchCandidates(item.name, item.entity_type);
        const topMatch = candidates[0];
        const autoAliasEligible = !!topMatch && topMatch.similarity >= AUTO_ALIAS_THRESHOLD;

        const extractionId = await stageVerified(
          aiPool,
          version.id,
          "entity",
          {
            ...item,
            evidence_id: evidenceId,
            match_candidates: candidates,
            auto_alias_eligible: autoAliasEligible,
          },
          modelName,
          modelVersion,
          0.85
        );

        // A PERSON entity mention always needs a human's eyes before it's
        // linked to anything public-facing; company/institution mentions
        // with a confident existing match are lower priority (still
        // reviewed — never AUTO_APPROVED into a published table directly).
        const priority = item.entity_type === "PERSON" ? "HIGH" : autoAliasEligible ? "LOW" : "NORMAL";
        await enqueueReview(
          fullPool,
          extractionId,
          priority,
          autoAliasEligible
            ? `Likely alias of existing entity "${topMatch!.canonicalName}" (similarity ${topMatch!.similarity.toFixed(2)}).`
            : "New entity mention — no confident existing match found."
        );
      }

      // --- Relationships ---
      for (const item of output.relationships) {
        const verification = verifySpan(chunk, item.source_span);
        if (!verification.verified) {
          itemsRejected++;
          await stageRejected(aiPool, version.id, "relationship", item, modelName, modelVersion);
          continue;
        }
        itemsVerified++;
        const evidenceId = await createEvidence(fullPool, version.id, verification, chunk.length);
        const extractionId = await stageVerified(
          aiPool,
          version.id,
          "relationship",
          { ...item, evidence_id: evidenceId },
          modelName,
          modelVersion,
          0.85
        );
        await enqueueReview(fullPool, extractionId, "NORMAL", "New relationship edge proposed from extraction.");
      }
    }

    await aiPool.query(
      `UPDATE document_versions SET extraction_processed_at = now() WHERE id = $1`,
      [version.id]
    );
  }

  return { versionsProcessed: pending.rows.length, itemsVerified, itemsRejected };
}

async function createEvidence(
  fullPool: ReturnType<typeof getPool>,
  documentVersionId: string,
  verification: { normalizedSpan: string; matchOffset: number },
  chunkLength: number
): Promise<string> {
  const excerpt = verification.normalizedSpan.slice(0, 300); // fair-use bounded, per Evidence Model §5
  const pageReference = buildFallbackReference(verification.matchOffset, chunkLength);
  const result = await fullPool.query(
    `INSERT INTO evidence (document_version_id, page_reference, excerpt, extracted_by, extraction_confidence)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [documentVersionId, pageReference, excerpt, `ai:${EXTRACTION_MODEL_LABEL}`, 0.85]
  );
  return result.rows[0].id;
}

async function stageVerified(
  aiPool: ReturnType<typeof getAiPool>,
  documentVersionId: string,
  extractionType: string,
  payload: unknown,
  modelName: string,
  modelVersion: string,
  confidence: number
): Promise<string> {
  const result = await aiPool.query(
    `INSERT INTO ai_extractions (document_version_id, extraction_type, payload, model_name, model_version, confidence, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING') RETURNING id`,
    [documentVersionId, extractionType, JSON.stringify(payload), modelName, modelVersion, confidence]
  );
  return result.rows[0].id;
}

async function stageRejected(
  aiPool: ReturnType<typeof getAiPool>,
  documentVersionId: string,
  extractionType: string,
  payload: unknown,
  modelName: string,
  modelVersion: string
): Promise<void> {
  // Kept for audit/debugging visibility into what the model claimed but
  // could not substantiate — never linked to an evidence row, never
  // reachable from the review queue's normal flow.
  await aiPool.query(
    `INSERT INTO ai_extractions (document_version_id, extraction_type, payload, model_name, model_version, confidence, status)
     VALUES ($1, $2, $3, $4, $5, 0.2, 'REJECTED')`,
    [documentVersionId, extractionType, JSON.stringify({ ...(payload as object), rejection_reason: "source_span not found verbatim in source text" }), modelName, modelVersion]
  );
}

async function enqueueReview(
  fullPool: ReturnType<typeof getPool>,
  aiExtractionId: string,
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT",
  reason: string
): Promise<void> {
  await fullPool.query(
    `INSERT INTO review_queue (item_type, item_id, priority, reason) VALUES ('ai_extraction', $1, $2, $3)`,
    [aiExtractionId, priority, reason]
  );
}
