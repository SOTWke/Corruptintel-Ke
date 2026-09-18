import { getPool, getAiPool } from "@corruptintel/database";
import type { SourceConnector } from "../connectors/SourceConnector";

/**
 * Runs one full ingestion pass for a single connector: discover new/changed
 * documents, store them idempotently, and hand normalized text off for AI
 * extraction. Writes go through the AI-restricted pool for the parts of the
 * pipeline that touch `documents`/`document_versions` (per Security
 * Architecture §5, the worker's ingestion role can write those two tables
 * but not published intelligence tables), and the full pool only for the
 * one-time source lookup, which is a read.
 */
export async function runIngestJob(connector: SourceConnector): Promise<{
  found: number;
  new: number;
  changed: number;
  unchanged: number;
  errors: number;
}> {
  const meta = connector.metadata();
  const stats = { found: 0, new: 0, changed: 0, unchanged: 0, errors: 0 };

  const pool = getPool();
  const sourceResult = await pool.query(
    `SELECT id FROM sources WHERE connector_key = $1 LIMIT 1`,
    [meta.sourceKey]
  );
  const sourceId = sourceResult.rows[0]?.id;
  if (!sourceId) {
    throw new Error(
      `No source row found for connector_key='${meta.sourceKey}'. ` +
        `Register it first (see packages/database/migrations/003_seed_reference_data.sql for the pattern).`
    );
  }

  const monitorRun = await pool.query(
    `INSERT INTO source_monitor_runs (source_id, status) VALUES ($1, 'RUNNING') RETURNING id`,
    [sourceId]
  );
  const runId = monitorRun.rows[0].id;

  const aiPool = getAiPool();

  try {
    const refs = await connector.discover();
    stats.found = refs.length;

    for (const ref of refs) {
      try {
        const raw = await connector.fetch(ref);
        const parsed = await connector.parse(raw);
        const normalized = await connector.normalize(parsed);
        const identity = await connector.identify(normalized);

        // Idempotency check: does a document with this canonical_url already
        // exist, and if so, does it already have a version with this hash?
        const existingDoc = await aiPool.query(
          `SELECT id FROM documents WHERE source_id = $1 AND canonical_url = $2`,
          [sourceId, ref.url]
        );

        let documentId: string;
        if (existingDoc.rows.length > 0) {
          documentId = existingDoc.rows[0].id;
        } else {
          const inserted = await aiPool.query(
            `INSERT INTO documents (source_id, title, document_type, canonical_url)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [sourceId, ref.title ?? null, "unclassified", ref.url]
          );
          documentId = inserted.rows[0].id;
        }

        const existingVersion = await aiPool.query(
          `SELECT id FROM document_versions WHERE document_id = $1 AND content_hash = $2`,
          [documentId, identity.contentHash]
        );

        if (existingVersion.rows.length > 0) {
          stats.unchanged++;
          continue;
        }

        const isNewDocument = existingDoc.rows.length === 0;

        // NOTE: storage_path below is a placeholder key — a production
        // build writes raw.bytes and normalized.normalizedText to the
        // S3-compatible object store here and stores the resulting keys.
        // That object-storage client is a Phase 3 addition (Evidence
        // Engine); this job already has the correct shape to slot it in.
        await aiPool.query(
          `INSERT INTO document_versions
             (document_id, content_hash, published_date, storage_path, mime_type, ocr_applied, normalized_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            documentId,
            identity.contentHash,
            ref.publishedDate ?? null,
            `pending-object-storage/${documentId}/${identity.contentHash}`,
            raw.mimeType,
            parsed.ocrApplied,
            normalized.normalizedText,
          ]
        );

        if (isNewDocument) stats.new++;
        else stats.changed++;

        // Extraction Agent hand-off happens here in a later phase — this
        // job's job is done once the version is durably, idempotently
        // stored. See AI Agent Architecture doc §4 for what comes next.
      } catch (perDocErr) {
        stats.errors++;
        console.error(`Error processing ${ref.url}:`, perDocErr);
      }
    }

    await pool.query(
      `UPDATE source_monitor_runs
       SET finished_at = now(), documents_found = $1, documents_new = $2,
           documents_changed = $3, status = 'SUCCESS'
       WHERE id = $4`,
      [stats.found, stats.new, stats.changed, runId]
    );
  } catch (err) {
    await pool.query(
      `UPDATE source_monitor_runs
       SET finished_at = now(), status = 'FAILED', error_detail = $1
       WHERE id = $2`,
      [String(err), runId]
    );
    throw err;
  }

  return stats;
}
