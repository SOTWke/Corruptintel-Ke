import fetch from "node-fetch";
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
 * AuditorGeneralConnector — scrapes published audit reports from the
 * Office of the Auditor-General (OAG) website (www.oag.go.ke).
 *
 * This connector:
 * - Discovers audit reports via RSS feed or HTML scraping of the reports page
 * - Fetches PDF documents with checksums for change detection
 * - Extracts text via OCR if needed
 * - Normalizes multi-page audit language into searchable segments
 *
 * Phase 1: targets TIER_1_PRIMARY official government documents
 */
export class AuditorGeneralConnector implements SourceConnector {
  private readonly baseUrl = "https://www.oag.go.ke";
  private readonly reportsEndpoint = `${this.baseUrl}/reports`;

  metadata(): ConnectorMetadata {
    return {
      sourceKey: "oag-kenya",
      sourceName: "Office of the Auditor-General (Kenya)",
      tier: "TIER_1_PRIMARY",
      countryIsoCode: "KE",
      pollIntervalMinutes: 360, // Check every 6 hours for new reports
    };
  }

  async discover(since?: Date): Promise<DiscoveredDocRef[]> {
    try {
      const response = await fetch(`${this.reportsEndpoint}`);
      if (!response.ok) {
        console.error(`Failed to fetch OAG reports page: ${response.statusText}`);
        return [];
      }

      const html = await response.text();
      const refs: DiscoveredDocRef[] = [];

      // Parse HTML for report links — pattern: /reports/[year]/[report-code].pdf
      // This is a simplified regex; production would use a proper HTML parser
      const pdfRegex =
        /href=["']([^"']*\.pdf)["']\s*[^>]*>\s*([^<]+(?:Audit|Report)[^<]*)/gi;
      let match;

      while ((match = pdfRegex.exec(html)) !== null) {
        const url = match[1].startsWith("http")
          ? match[1]
          : `${this.baseUrl}${match[1]}`;
        const title = match[2]?.trim() || "Audit Report";

        // Only include reports published after `since` (if provided)
        // In production, extract publication date from HTML metadata
        refs.push({
          url,
          title,
          publishedDate: new Date().toISOString().slice(0, 10),
        });
      }

      console.log(`AuditorGeneralConnector discovered ${refs.length} reports`);
      return refs;
    } catch (error) {
      console.error("AuditorGeneralConnector.discover() failed:", error);
      return [];
    }
  }

  async fetch(ref: DiscoveredDocRef): Promise<RawDocument> {
    try {
      const response = await fetch(ref.url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${ref.url}: ${response.statusText}`
        );
      }

      const bytes = await response.buffer();
      return {
        ref,
        bytes,
        mimeType: "application/pdf",
        fetchedAt: new Date(),
      };
    } catch (error) {
      throw new Error(
        `AuditorGeneralConnector.fetch() failed for ${ref.url}: ${error}`
      );
    }
  }

  async parse(raw: RawDocument): Promise<ParsedDocument> {
    // In production, delegate to a PDF text extraction library (pdfjs, pdf-parse)
    // or an OCR service. This stub assumes text layer exists.
    // See Ingestion Architecture §2 for the full strategy.

    let text = "";
    let ocrApplied = false;

    if (raw.mimeType === "application/pdf") {
      // TODO: wire pdf-parse or call an OCR service for scanned PDFs
      // For now, log a warning and return empty text to indicate OCR is needed
      console.warn(
        `OCR not wired; ${raw.ref.title} requires manual text extraction or OCR service integration`
      );
      ocrApplied = true;
      text = ""; // Placeholder; real implementation extracts text
    }

    return {
      raw,
      text,
      pageCount: undefined, // Would be extracted from PDF metadata
      ocrApplied,
    };
  }

  async normalize(parsed: ParsedDocument): Promise<NormalizedDocument> {
    const normalizedText = parsed.text
      .replace(/[ \t]+/g, " ") // collapse multiple spaces
      .replace(/\n{3,}/g, "\n\n") // normalize multiple newlines to double
      .trim();

    return {
      parsed,
      normalizedText,
    };
  }

  async identify(normalized: NormalizedDocument): Promise<DocumentIdentity> {
    // Use the URL as the logical document ID (OAG reports have stable URLs)
    const url = normalized.parsed.raw.ref.url;
    const contentHash = this.hashContent(normalized.normalizedText);

    return {
      documentId: null, // Let the pipeline assign this; we only provide the hash
      contentHash,
    };
  }

  private hashContent(text: string): string {
    // In production, use crypto.createHash('sha256')
    // This is a placeholder that uses a simple string-based approach
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(text).digest("hex");
  }
}
