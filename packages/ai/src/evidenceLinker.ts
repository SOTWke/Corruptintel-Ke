/**
 * The evidence linker is the mechanical enforcement of "no fabricated
 * quotes" (AI Agent Architecture §5). Every extracted item carries a
 * `source_span` the model claims came from the document. This function
 * verifies that span is an actual substring of the normalized document
 * text — not a semantic check, a literal one — before allowing the caller
 * to create an `evidence` row from it.
 *
 * Matching is done after light normalization (collapsing whitespace) since
 * models often reflow whitespace even when quoting exactly; it deliberately
 * does NOT do fuzzy/semantic matching, because that would let a
 * paraphrased-and-therefore-unverifiable "quote" through.
 */
export interface SpanVerificationResult {
  verified: boolean;
  normalizedSpan: string;
  /** Character offset of the match in the normalized document text, or -1. */
  matchOffset: number;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function verifySpan(documentText: string, claimedSpan: string): SpanVerificationResult {
  const normalizedDoc = normalizeWhitespace(documentText);
  const normalizedSpan = normalizeWhitespace(claimedSpan);

  if (normalizedSpan.length === 0) {
    return { verified: false, normalizedSpan, matchOffset: -1 };
  }

  const offset = normalizedDoc.indexOf(normalizedSpan);
  return { verified: offset !== -1, normalizedSpan, matchOffset: offset };
}

/** Convenience: given a claimed span, returns a page/section-free reference
 * string suitable for the `evidence.page_reference` column when no
 * page-level metadata is available (e.g. an HTML source). */
export function buildFallbackReference(matchOffset: number, documentLength: number): string {
  const percent = documentLength > 0 ? Math.round((matchOffset / documentLength) * 100) : 0;
  return `~${percent}% through document`;
}
