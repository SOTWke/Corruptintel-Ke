import { getLlmClient } from "./llmClient";
import { wrapUntrustedContent, UNTRUSTED_CONTENT_POLICY } from "./promptBoundaries";
import { REPORTING_SCHEMA } from "./schemas";

export interface RetrievedClaimForReport {
  case_title: string;
  claim_text: string;
  certainty: string;
  evidence_id: string;
  evidence_excerpt: string;
  evidence_source: string;
}

export interface ReportingKeyFinding {
  text: string;
  evidence_ids: string[];
}

export interface ReportingOutput {
  key_findings: ReportingKeyFinding[];
  unknown_or_missing: string[];
}

const SYSTEM_PROMPT = `
You are the Reporting Agent in an evidence-first corruption intelligence
pipeline (CorruptIntel). You are given a set of ALREADY-PUBLISHED,
evidence-linked claims retrieved for a researcher's question. Your job is to:

1. Write key_findings: a short list of synthesis sentences, each one
   grounded in one or more of the provided claims. Every key_finding MUST
   include the evidence_id(s) (copied EXACTLY, character-for-character) of
   the claim(s) it's based on. A downstream system will REJECT any finding
   whose evidence_id doesn't match something you were actually given — so
   never invent or guess an id, and never write a finding that isn't
   directly supported by at least one provided claim.
2. Write unknown_or_missing: plain statements of what the provided claims do
   NOT establish (e.g. "No court judgment is on file for this matter" or
   "The provided evidence does not establish who authorized the payment").
   These describe absence of evidence, not assertions of fact, so they don't
   need evidence_ids.

Hard rules:
- Never escalate a claim's certainty. If a claim is ALLEGED, your finding
  must still read as an allegation ("X was named in connection with an
  allegation..."), never as settled fact.
- Never combine claims from different certainty levels into one finding that
  implies they're equally established.
- If sources conflict (you may see claims that contradict each other), say so
  explicitly rather than picking one side.
- If the provided claims are too thin to say anything useful, return an
  empty key_findings array and use unknown_or_missing to say so plainly.

${UNTRUSTED_CONTENT_POLICY}
`.trim();

/**
 * Runs the Reporting Agent over a bounded, already-evidence-linked context.
 * The caller (apps/api/src/routes/research.ts) is responsible for:
 *  - Assembling `claims` deterministically from published data (this
 *    function never queries the database itself).
 *  - Validating every returned evidence_id against the set it actually sent
 *    — dropping any finding that cites something outside that set.
 */
export async function runReportingAgent(
  researcherQuery: string,
  claims: RetrievedClaimForReport[]
): Promise<{ output: ReportingOutput; modelName: string; modelVersion: string }> {
  const client = getLlmClient();

  const contextBlock = claims
    .map(
      (c, i) =>
        `[${i}] evidence_id=${c.evidence_id} case="${c.case_title}" certainty=${c.certainty}\n` +
        `claim: ${c.claim_text}\n` +
        `evidence: "${c.evidence_excerpt}" (source: ${c.evidence_source})`
    )
    .join("\n\n");

  const userContent = [
    `Researcher question: ${researcherQuery}`,
    "",
    "Retrieved claims (this is the ONLY material you may draw on):",
    wrapUntrustedContent("retrieved_published_claims", contextBlock || "(no claims retrieved)"),
  ].join("\n");

  const result = await client.complete<ReportingOutput>({
    system: SYSTEM_PROMPT,
    userContent,
    schema: REPORTING_SCHEMA,
    schemaName: "research_report",
    maxTokens: 2000,
  });

  return { output: result.data, modelName: result.modelName, modelVersion: result.modelVersion };
}
