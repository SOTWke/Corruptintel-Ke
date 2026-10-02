export interface DiscoveredDocRef {
  url: string;
  title?: string;
  publishedDate?: string;
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
  documentId: string | null;
  contentHash: string;
}

export interface ConnectorMetadata {
  sourceKey: string;
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
