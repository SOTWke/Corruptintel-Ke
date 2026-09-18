import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import path from "path";
import { CuratedFileConnector } from "./connectors/CuratedFileConnector";
import { RssConnector } from "./connectors/RssConnector";
import { runIngestJob } from "./jobs/ingest";
import { runExtractionJob } from "./jobs/extract";
import { closeAll } from "@corruptintel/database";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
const INGEST_QUEUE_NAME = "corruptintel-ingest";
const EXTRACT_QUEUE_NAME = "corruptintel-extract";
const ingestQueue = new Queue(INGEST_QUEUE_NAME, { connection });
const extractQueue = new Queue(EXTRACT_QUEUE_NAME, { connection });

const connectors = [
  new CuratedFileConnector(process.env.CURATED_DOCS_DIR || path.join(process.cwd(), "seed-documents"), {
    sourceKey: "curated_seed", sourceName: "Curated MVP Document Set", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 360,
  }),
  new RssConnector({ url: "https://www.businessdailyafrica.com/rss/bda_news_rss.xml", sourceKey: "business_daily_rss", sourceName: "Business Daily Africa", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 60 }),
  new RssConnector({ url: "https://tikenya.org/feed/", sourceKey: "ti_kenya_rss", sourceName: "Transparency International Kenya", tier: "TIER_2_INSTITUTIONAL", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
  new RssConnector({ url: "https://www.theelephant.info/feed/", sourceKey: "the_elephant_rss", sourceName: "The Elephant", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
  new RssConnector({ url: "https://www.kenyanews.go.ke/category/business-finance/feed/", sourceKey: "kenya_news_business_rss", sourceName: "Kenya News Agency — Business & Finance", tier: "TIER_2_INSTITUTIONAL", countryIsoCode: "KEN", pollIntervalMinutes: 120 }),
  new RssConnector({ url: "https://www.occrp.org/en/rss", sourceKey: "occrp_rss", sourceName: "OCCRP", tier: "TIER_3_JOURNALISM", countryIsoCode: "KEN", pollIntervalMinutes: 180 }),
];

async function scheduleRecurringJobs() {
  for (const connector of connectors) {
    const meta = connector.metadata();
    await ingestQueue.add(`ingest:${meta.sourceKey}`, { sourceKey: meta.sourceKey }, { repeat: { every: meta.pollIntervalMinutes * 60_000 }, jobId: `recurring:${meta.sourceKey}` });
    // Run once at startup so a fresh deployment does not wait for the first interval.
    await ingestQueue.add(`ingest-now:${meta.sourceKey}`, { sourceKey: meta.sourceKey }, { jobId: `startup:${meta.sourceKey}:${Date.now()}`, removeOnComplete: true });
    console.log(`Scheduled ${meta.sourceName} every ${meta.pollIntervalMinutes}m`);
  }
  await extractQueue.add("extract:pending", {}, { repeat: { every: 15 * 60_000 }, jobId: "recurring:extract-pending" });
}

const worker = new Worker(INGEST_QUEUE_NAME, async (job) => {
  const connector = connectors.find((c) => c.metadata().sourceKey === job.data.sourceKey);
  if (!connector) throw new Error(`Unknown connector sourceKey: ${job.data.sourceKey}`);
  return runIngestJob(connector);
}, { connection, concurrency: 2 });
worker.on("failed", (job, err) => console.error(`Ingest job ${job?.id} failed:`, err.message));

const extractWorker = new Worker(EXTRACT_QUEUE_NAME, () => runExtractionJob(), { connection, concurrency: 1 });
extractWorker.on("failed", (job, err) => console.error(`Extraction job ${job?.id} failed:`, err.message));

scheduleRecurringJobs().then(() => console.log("CorruptIntel worker running. Waiting for jobs...")).catch((err) => { console.error("Worker failed to start:", err); process.exit(1); });

async function shutdown() {
  await Promise.all([worker.close(), extractWorker.close(), ingestQueue.close(), extractQueue.close(), connection.quit(), closeAll()]);
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
