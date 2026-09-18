import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import path from "path";
import { CuratedFileConnector } from "./connectors/CuratedFileConnector";
import { runIngestJob } from "./jobs/ingest";
import { runExtractionJob } from "./jobs/extract";
import { closeAll } from "@corruptintel/database";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const INGEST_QUEUE_NAME = "corruptintel-ingest";
const EXTRACT_QUEUE_NAME = "corruptintel-extract";
const ingestQueue = new Queue(INGEST_QUEUE_NAME, { connection });
const extractQueue = new Queue(EXTRACT_QUEUE_NAME, { connection });

// MVP connector registry. Each entry corresponds to a `sources` row (see
// migrations/003_seed_reference_data.sql) via connector_key. Live government
// connectors (Auditor-General, Judiciary, PPRA, Hansard, EACC) are added
// here in a later phase, each implementing the same SourceConnector
// interface — the scheduler and ingest job below don't change.
const connectors = [
  new CuratedFileConnector(
    process.env.CURATED_DOCS_DIR || path.join(process.cwd(), "seed-documents"),
    {
      sourceKey: "curated_seed",
      sourceName: "Curated MVP Document Set",
      tier: "TIER_3_JOURNALISM",
      countryIsoCode: "KEN",
      pollIntervalMinutes: 360, // 6 hours, per Ingestion Architecture §2 government/court cadence
    }
  ),
];

async function scheduleRecurringJobs() {
  for (const connector of connectors) {
    const meta = connector.metadata();
    await ingestQueue.add(
      `ingest:${meta.sourceKey}`,
      { sourceKey: meta.sourceKey },
      {
        repeat: { every: meta.pollIntervalMinutes * 60_000 },
        jobId: `recurring:${meta.sourceKey}`, // stable id prevents duplicate schedules on restart
      }
    );
    console.log(`Scheduled recurring ingest for ${meta.sourceName} every ${meta.pollIntervalMinutes}m`);
  }

  // Extraction runs more frequently than ingestion — it just needs to catch
  // up on whatever document_versions ingestion has already stored.
  const EXTRACTION_INTERVAL_MINUTES = 15;
  await extractQueue.add(
    "extract:pending",
    {},
    {
      repeat: { every: EXTRACTION_INTERVAL_MINUTES * 60_000 },
      jobId: "recurring:extract-pending",
    }
  );
  console.log(`Scheduled recurring extraction every ${EXTRACTION_INTERVAL_MINUTES}m`);
}

const worker = new Worker(
  INGEST_QUEUE_NAME,
  async (job) => {
    const connector = connectors.find((c) => c.metadata().sourceKey === job.data.sourceKey);
    if (!connector) {
      throw new Error(`Unknown connector sourceKey: ${job.data.sourceKey}`);
    }
    console.log(`Running ingest job for ${connector.metadata().sourceName}...`);
    const stats = await runIngestJob(connector);
    console.log(`Ingest complete:`, stats);
    return stats;
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`Ingest job ${job?.id} failed:`, err.message);
});

const extractWorker = new Worker(
  EXTRACT_QUEUE_NAME,
  async () => {
    // Requires ANTHROPIC_API_KEY (or another configured LLM_PROVIDER) —
    // see packages/ai/src/llmClient.ts. If unset, this job will throw per
    // document_version attempt and simply retry next scheduled run; it
    // will not silently fabricate results.
    console.log("Running extraction job over pending document_versions...");
    const stats = await runExtractionJob();
    console.log("Extraction complete:", stats);
    return stats;
  },
  { connection }
);

extractWorker.on("failed", (job, err) => {
  console.error(`Extraction job ${job?.id} failed:`, err.message);
});

async function main() {
  await scheduleRecurringJobs();
  console.log("CorruptIntel worker running. Waiting for jobs...");
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await worker.close();
  await extractWorker.close();
  await ingestQueue.close();
  await extractQueue.close();
  await closeAll();
  process.exit(0);
});
