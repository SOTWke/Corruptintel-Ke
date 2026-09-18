import { getLlmClient } from "./llmClient";
import { wrapUntrustedContent, UNTRUSTED_CONTENT_POLICY } from "./promptBoundaries";
import { CLASSIFICATION_SCHEMA } from "./schemas";

export interface ClassificationOutput {
  taxonomy_category: string;
  taxonomy_subcategory?: string;
  proposed_status: string;
  confidence: number;
  reasoning_note?: string;
  source_span?: string;
}

const SYSTEM_PROMPT = `
You are the Classification Agent in an evidence-first corruption intelligence
pipeline (CorruptIntel). Given a document excerpt (and optionally a
already-extracted claim about it), you propose:
1. A taxonomy category/subcategory from the fixed enum in the schema.
2. A proposed case status (REPORTED, ALLEGED, INVESTIGATION, CHARGED,
   CONVICTED, etc.) — this must match the procedural stage the text actually
   describes, never an inference about eventual outcome.
3. A calibrated confidence (0-1) reflecting how directly the text supports
   this classification, not how important the case seems.

Hard rules:
- If the text describes a person merely being named or mentioned, with no
  procedural action described, proposed_status is REPORTED or ALLEGED, never
  higher.
- Only propose CONVICTED/ACQUITTED/DISMISSED if the text explicitly
  describes a court's final ruling.
- Include a source_span (exact substring) supporting the proposed_status
  whenever one exists.

${UNTRUSTED_CONTENT_POLICY}
`.trim();

export async function runClassificationAgent(
  excerptText: string,
  sourceLabel: string
): Promise<{ output: ClassificationOutput; modelName: string; modelVersion: string }> {
  const client = getLlmClient();
  const userContent = [
    "Classify the following source document excerpt.",
    "",
    wrapUntrustedContent(sourceLabel, excerptText),
  ].join("\n");

  const result = await client.complete<ClassificationOutput>({
    system: SYSTEM_PROMPT,
    userContent,
    schema: CLASSIFICATION_SCHEMA,
    schemaName: "classification_result",
    maxTokens: 500,
  });

  return { output: result.data, modelName: result.modelName, modelVersion: result.modelVersion };
}
