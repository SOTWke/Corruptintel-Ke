import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type {
  SourceConnector,
  DiscoveredDocRef,
  RawDocument,
  ParsedDocument,
  NormalizedDocument,
  DocumentIdentity,
  ConnectorMetadata,
} from "./SourceConnector";

/**
 * CuratedFileConnector — reads a curated local directory of documents
 * (.txt/.html/.md) as the MVP's first source, per the brief's §40 guidance
 * to "start with a small curated dataset (50–200 high-quality documents)
 * and prove the pipeline before scaling ingestion."
 *
 * This is a REAL, working connector — not a mock — it just sources from a
 * local directory instead of a live government website, which is the
 * correct MVP substitute until the Auditor-General/Judiciary/PPRA connectors
 * (which need site-specific scraping agreements and structure mapping) are
 * built in a later phase. Swapping it for a live-fetch connector later is a
 * drop-in change: the interface doesn't change, only these six methods'
 * internals.
 */
export class CuratedFileConnector implements SourceConnector {
  constructor(
    private readonly directory: string,
    private readonly meta: ConnectorMetadata
  ) {}

  metadata(): ConnectorMetadata {
    return this.meta;
  }

  async discover(since?: Date): Promise<DiscoveredDocRef[]> {
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const refs: DiscoveredDocRef[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (![".txt", ".html", ".md"].includes(path.extname(entry.name))) continue;

      const fullPath = path.join(this.directory, entry.name);
      const stat = await fs.stat(fullPath);
      if (since && stat.mtime < since) continue;

      refs.push({
        url: `file://${fullPath}`,
        title: path.basename(entry.name, path.extname(entry.name)),
        publishedDate: stat.mtime.toISOString().slice(0, 10),
      });
    }
    return refs;
  }

  async fetch(ref: DiscoveredDocRef): Promise<RawDocument> {
    const filePath = ref.url.replace("file://", "");
    const bytes = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const mimeType =
      ext === ".html" ? "text/html" : ext === ".md" ? "text/markdown" : "text/plain";
    return { ref, bytes, mimeType, fetchedAt: new Date() };
  }

  async parse(raw: RawDocument): Promise<ParsedDocument> {
    let text = raw.bytes.toString("utf8");
    if (raw.mimeType === "text/html") {
      // Minimal tag strip — a real HTML pipeline would use a readability
      // extractor per Ingestion Architecture §2; kept dependency-free here
      // since this connector's job is to prove the pipeline, not to be the
      // production HTML extractor.
      text = text.replace(/<script[\s\S]*?<\/script>/gi, "")
                 .replace(/<style[\s\S]*?<\/style>/gi, "")
                 .replace(/<[^>]+>/g, " ")
                 .replace(/\s+/g, " ")
                 .trim();
    }
    return { raw, text, ocrApplied: false };
  }

  async normalize(parsed: ParsedDocument): Promise<NormalizedDocument> {
    const normalizedText = parsed.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { parsed, normalizedText };
  }

  async identify(normalized: NormalizedDocument): Promise<DocumentIdentity> {
    const contentHash = crypto
      .createHash("sha256")
      .update(normalized.normalizedText)
      .digest("hex");
    // documentId resolution (matching an existing logical document vs. a new
    // one) happens in the pipeline against the `documents` table by
    // canonical_url, not here — this connector only computes the hash.
    return { documentId: null, contentHash };
  }
}
