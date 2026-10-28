import { buildCitationContracts, classifyStrictAiLink } from './citation-contract';
import type { EvidenceRef } from './types';
import type { TransientPdfAnnotation } from './transient-pdf-annotations';

/** Only the model's selected, evidence-verified quotes become proposals. */
export function preparePdfAnnotationProposal(answer: string, evidenceRefs: EvidenceRef[], options?: { maxAnnotations?: number }): {
  text: string;
  annotations: TransientPdfAnnotation[];
  rejectedCount: number;
  limitedCount: number;
} {
  const blocks: string[] = [];
  const text = answer.replace(/```(lattice-annotations|json)\s*\n([\s\S]*?)```/gi, (whole, language: string, body: string) => {
    if (language.toLowerCase() === 'json') {
      // Compatibility is limited to the typed envelope. Keep ordinary JSON
      // examples, and never infer annotations from arbitrary model prose.
      try {
        const value = JSON.parse(body);
        if (!value || !Object.hasOwn(value, 'annotations')) return whole;
      } catch { if (!/^\s*\{\s*"annotations"\s*:/.test(body)) return whole; }
    }
    blocks.push(body);
    return '';
  }).trim();
  const contracts = buildCitationContracts(evidenceRefs);
  const annotations: TransientPdfAnnotation[] = [];
  let rejectedCount = 0;
  let limitedCount = 0;
  const limit = Math.max(1, Math.min(30, Math.floor(options?.maxAnnotations ?? 5)));
  for (const block of blocks) {
    let candidates: unknown;
    try { candidates = JSON.parse(block).annotations; } catch { rejectedCount++; continue; }
    if (!Array.isArray(candidates)) { rejectedCount++; continue; }
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') { rejectedCount++; continue; }
      const { page, reason, passageId, quoteId } = candidate;
      const sourceId = candidate.sourceId ?? passageId ?? quoteId;
      let quote = candidate.quote;
      if (passageId !== undefined || quoteId !== undefined) {
        // Synthesis only advertises IDs for already anchored, verified findings.
        // Never upgrade a whole-page context into an annotation by selecting its ID.
        const selection = passageId ?? quoteId;
        const selected = contracts.find(contract => contract.stableId === sourceId && contract.stableId === selection);
        if (!selected?.evidenceRef.anchor?.snippet || (passageId !== undefined && quoteId !== undefined && passageId !== quoteId)) { rejectedCount++; continue; }
        // A passage id identifies a verified source window. When the model
        // supplies a shorter quote, keep and re-resolve that exact subrange
        // inside the window; do not silently expand it back to the full anchor.
        // Omitting quote intentionally selects the complete verified window.
        quote = typeof quote === 'string' && quote.trim()
          ? quote.trim()
          : selected.evidenceRef.anchor.snippet;
      }
      if (typeof sourceId !== 'string' || typeof quote !== 'string' || quote.trim().length < 8 ||
          typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
        rejectedCount++; continue;
      }
      const link = classifyStrictAiLink(`citation:${sourceId}?quote=${encodeURIComponent(quote.trim())}`, contracts);
      if (link.kind !== 'citation' || link.citation.navigationTarget?.type !== 'pdf_page' ||
          (page !== undefined && page !== link.citation.navigationTarget.page)) {
        rejectedCount++; continue;
      }
      const target = link.citation.navigationTarget;
      const id = `proposal-${link.citation.stableId}`;
      if (annotations.some((annotation) => annotation.id === id)) continue;
      if (annotations.length >= limit) { limitedCount++; continue; }
      annotations.push({
        id, documentPath: link.citation.canonicalPath, page: target.page,
        quote: link.citation.evidenceRef.anchor?.snippet ?? quote.trim(), reason: reason.trim(), rects: [], source: link.citation.evidenceRef,
      });
    }
  }
  return { text, annotations, rejectedCount, limitedCount };
}
