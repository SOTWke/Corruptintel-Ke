import { getLlmClient } from "./llmClient";
import { wrapUntrustedContent, UNTRUSTED_CONTENT_POLICY } from "./promptBoundaries";
import { EXTRACTION_SCHEMA } from "./schemas";

export interface ExtractedEntityMention {
  name: string;
  entity_type: "PERSON" | "COMPANY" | "INSTITUTION";
  role_context?: string;
  source_span: string;
}

export interface ExtractedFinancialAmount {
  amount: number;
  currency: string;
  amount_type: string;
  is_approximate?: boolean;
  context_note?: string;
  source_span: string;
}

export interface ExtractedClaim {
  claim_text: string;
  certainty: string;
  source_span: string;
}

export interface ExtractedRelationship {
  from_entity_name: string;
  to_entity_name: string;
  relationship_type: string;
  source_span: string;
}

export interface ExtractionOutput {
  entity_mentions: ExtractedEntityMention[];
  financial_amounts: ExtractedFinancialAmount[];
  proposed_claims: ExtractedClaim[];
  relationships: ExtractedRelationship[];
  suspicious_content_detected?: boolean;
  insufficient_evidence: boolean;
}

const SYSTEM_PROMPT = `
You are the Extraction Agent in an evidence-first corruption intelligence
pipeline (CorruptIntel). Your ONLY job is to identify entities, financial
amounts, evidence-qualified claims, and relationships that are LITERALLY
stated in the source text you are given.

Hard rules:
1. Every item you return MUST include a "source_span" that is an exact,
   verbatim substring of the source text (not a summary, not a paraphrase).
   A downstream system will reject any item whose span does not literally
   appear in the document — so do not paraphrase, translate, or "clean up"
   quotes.
2. NEVER infer guilt from association. Naming someone in the same document
   as an allegation does not make them a subject of that allegation unless
   the text says so.
3. NEVER assert a claim more strongly than the source text does. If the
   source says "alleged," your claim's certainty is ALLEGED, not CONFIRMED
   or CONVICTED. If the source is a court judgment stating a conviction,
   certainty is CONVICTED.
4. If a chunk of text contains nothing corruption-relevant, set
   insufficient_evidence=true and return empty arrays. Do not invent content
   to fill the schema.
5. Financial amounts must preserve their semantic type (contract value vs.
   alleged loss vs. recovered funds, etc.) — never assume a figure represents
   a "loss" unless the text says so.

${UNTRUSTED_CONTENT_POLICY}
`.trim();

/**
 * Runs the Extraction Agent on one chunk of normalized document text.
 * Returns the raw model proposal — callers (apps/worker/src/jobs/extract.ts)
 * are responsible for verifying every source_span via evidenceLinker before
 * writing anything to the database, and for routing the result through
 * ai_extractions / review_queue rather than any published table directly.
 */
export async function runExtractionAgent(
  chunkText: string,
  sourceLabel: string
): Promise<{ output: ExtractionOutput; modelName: string; modelVersion: string }> {
  const client = getLlmClient();
  const userContent = [
    "Extract corruption-relevant entities, financial amounts, claims, and relationships",
    "from the following source document excerpt.",
    "",
    wrapUntrustedContent(sourceLabel, chunkText),
  ].join("\n");

  const result = await client.complete<ExtractionOutput>({
    system: SYSTEM_PROMPT,
    userContent,
    schema: EXTRACTION_SCHEMA,
    schemaName: "extraction_result",
    maxTokens: 3000,
  });

  return { output: result.data, modelName: result.modelName, modelVersion: result.modelVersion };
}
