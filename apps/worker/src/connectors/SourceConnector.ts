/**
 * SourceConnector — the single interface every ingestion source implements.
 * Per Ingestion Architecture §1: "no bespoke scraping logic scattered
 * through the codebase." A connector only needs to implement these six
 * methods; the pipeline (index.ts / jobs/discover.ts) drives them.
 */

export interface DiscoveredDocRef {
  url: string;
  title?: string;
  publishedDate?: string; // ISO date, if known at discovery time
}

export interface RawDocument {
  ref: DiscoveredDocRef;
  bytes: Buffer;
  mimeType: string;
  fetchedAt: Date;
}

export interface ParsedDocument {
  raw: RawDocument;
  text: string;
  pageCount?: number;
  ocrApplied: boolean;
}

export interface NormalizedDocument {
  parsed: ParsedDocument;
  normalizedText: string;
}

export interface DocumentIdentity {
  documentId: string | null; // null = new logical document
  contentHash: string;
}

export interface ConnectorMetadata {
  sourceKey: string; // matches sources.connector_key in the DB
  sourceName: string;
  tier: "TIER_1_PRIMARY" | "TIER_2_INSTITUTIONAL" | "TIER_3_JOURNALISM" | "TIER_4_COMMENTARY" | "TIER_5_SOCIAL";
  countryIsoCode: string;
  pollIntervalMinutes: number;
}

export interface SourceConnector {
  discover(since?: Date): Promise<DiscoveredDocRef[]>;
  fetch(ref: DiscoveredDocRef): Promise<RawDocument>;
  parse(raw: RawDocument): Promise<ParsedDocument>;
  normalize(parsed: ParsedDocument): Promise<NormalizedDocument>;
  identify(normalized: NormalizedDocument): Promise<DocumentIdentity>;
  metadata(): ConnectorMetadata;
}
