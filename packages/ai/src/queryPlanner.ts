import { getLlmClient } from "./llmClient";
import { wrapUntrustedContent, UNTRUSTED_CONTENT_POLICY } from "./promptBoundaries";
import { QUERY_PLANNER_SCHEMA } from "./schemas";

export interface QueryFilters {
  person_names?: string[];
  company_names?: string[];
  institution_names?: string[];
  county_names?: string[];
  sector_names?: string[];
  year_from?: number;
  year_to?: number;
  amount_min?: number;
  amount_max?: number;
  statuses?: string[];
  free_text_keywords?: string[];
}

const SYSTEM_PROMPT = `
You are the Query Planner in an evidence-first corruption intelligence
pipeline (CorruptIntel). Your job is ONLY to translate a researcher's
natural-language question into structured search filters. You do not answer
the question, you do not know the answer, and you never assert anything
about any specific person, company, or case — you are just parsing intent
into a fixed filter shape (names to look for, a date range, an amount range,
a status list, fallback keywords).

If the question doesn't mention a filter dimension, omit it — do not guess
a default range or a default status list.

${UNTRUSTED_CONTENT_POLICY}
`.trim();

/**
 * The user's own research question is technically "user content," not
 * untrusted document content — but we still wrap it, because the query
 * planner's output only ever becomes a WHERE clause built by deterministic
 * code (see apps/api/src/lib/researchRetrieval.ts). Even if a researcher
 * pasted adversarial text into their query, the planner has no path to
 * execute anything — it can only populate this fixed filter shape.
 */
export async function runQueryPlanner(
  naturalLanguageQuery: string
): Promise<{ filters: QueryFilters; modelName: string; modelVersion: string }> {
  const client = getLlmClient();
  const userContent = [
    "Parse the following research question into structured filters.",
    "",
    wrapUntrustedContent("researcher_query", naturalLanguageQuery),
  ].join("\n");

  const result = await client.complete<QueryFilters>({
    system: SYSTEM_PROMPT,
    userContent,
    schema: QUERY_PLANNER_SCHEMA,
    schemaName: "query_filters",
    maxTokens: 600,
  });

  return { filters: result.data, modelName: result.modelName, modelVersion: result.modelVersion };
}
