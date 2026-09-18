import { SourceConnector, DiscoveredDocRef, RawDocument, ParsedDocument, NormalizedDocument, DocumentIdentity, ConnectorMetadata } from "./SourceConnector";
import crypto from "node:crypto";

interface FeedDefinition {
  url: string;
  sourceKey: string;
  sourceName: string;
  tier: ConnectorMetadata["tier"];
  countryIsoCode: string;
  pollIntervalMinutes?: number;
}

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function stripHtml(value: string): string {
  return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : undefined;
}

function parseDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export class RssConnector implements SourceConnector {
  constructor(private readonly feed: FeedDefinition) {}

  metadata(): ConnectorMetadata {
    return { ...this.feed, pollIntervalMinutes: this.feed.pollIntervalMinutes ?? 60 };
  }

  async discover(since?: Date): Promise<DiscoveredDocRef[]> {
    const response = await fetch(this.feed.url, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "CorruptIntel/1.0 (+evidence-monitor)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`RSS feed ${this.feed.url} returned HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_FEED_BYTES) throw new Error(`RSS feed exceeds ${MAX_FEED_BYTES} bytes`);
    const xml = await response.text();
    if (Buffer.byteLength(xml, "utf8") > MAX_FEED_BYTES) throw new Error(`RSS feed exceeds ${MAX_FEED_BYTES} bytes`);

    const refs: DiscoveredDocRef[] = [];
    const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
    for (const [, , block] of blocks) {
      const title = tag(block, "title");
      const publishedDate = parseDate(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"));
      const linkTag = block.match(/<link(?:\s[^>]*)?href=["']([^"']+)["'][^>]*\/?>/i);
      const link = decodeXml(linkTag?.[1] || tag(block, "link") || tag(block, "guid") || "");
      if (!link || !title) continue;
      if (since && publishedDate && new Date(publishedDate) < since) continue;
      refs.push({ url: link, title, publishedDate });
    }
    return refs;
  }

  async fetch(ref: DiscoveredDocRef): Promise<RawDocument> {
    const response = await fetch(ref.url, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "CorruptIntel/1.0 (+evidence-monitor)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Article ${ref.url} returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_FEED_BYTES) throw new Error(`Article exceeds ${MAX_FEED_BYTES} bytes`);
    return { ref, bytes, mimeType: response.headers.get("content-type")?.split(";")[0] || "text/html", fetchedAt: new Date() };
  }

  async parse(raw: RawDocument): Promise<ParsedDocument> {
    const html = raw.bytes.toString("utf8");
    const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
    return { raw, text: stripHtml(main), ocrApplied: false };
  }

  async normalize(parsed: ParsedDocument): Promise<NormalizedDocument> {
    return { parsed, normalizedText: parsed.text.replace(/\s+/g, " ").trim() };
  }

  async identify(normalized: NormalizedDocument): Promise<DocumentIdentity> {
    return { documentId: null, contentHash: crypto.createHash("sha256").update(normalized.normalizedText).digest("hex") };
  }
}
