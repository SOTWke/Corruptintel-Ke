/**
 * Splits normalized text into paragraph-respecting chunks under a target
 * character budget, with a small overlap so a fact split across a paragraph
 * boundary isn't lost. Deliberately simple for MVP scale — a production
 * chunker would token-count rather than char-count and would feed
 * document_chunks for embedding at the same time (see docs/
 * 04_ai_agent_architecture.md §6 for the intended RAG shape once vector
 * search is wired).
 */
export function chunkText(text: string, targetChars = 4000, overlapChars = 300): string[] {
  if (text.length <= targetChars) return [text];

  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > targetChars && current.length > 0) {
      chunks.push(current.trim());
      // start next chunk with the tail of the previous one for continuity
      const overlap = current.slice(Math.max(0, current.length - overlapChars));
      current = overlap + "\n\n" + para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());

  return chunks;
}
