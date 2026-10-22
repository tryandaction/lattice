import { buildCitationContracts, isPreciseCitation } from './citation-contract';
import type { EvidenceRef } from './types';

/** Shared by Chat and Agent so both ask for evidence at the same precision. */
export const TARGETED_CITATION_INSTRUCTIONS = [
  'Place a short Markdown citation immediately after the specific claim it supports. Choose the fewest passages needed to verify the answer; multiple citations are appropriate only when they support distinct claims or genuinely complementary evidence.',
  'Do not list all available sources or context pages. The reference table is a private menu of available context, not a bibliography to reproduce. Do not append a source inventory or citation-only output.',
  'A PDF page without a passage anchor is context, not a precise citation. The same applies to a whole Markdown file. For entries marked quote required, replace URL_ENCODED_EXACT_QUOTE with a URL-encoded short contiguous passage copied verbatim from that specific supplied page or file.',
  'Choose a short passage that directly supports the claim and is unique within that supplied page or file. Keep its original spelling and case, include enough surrounding words to identify it, and keep it under 600 characters. Do not use only a number, unit, or generic phrase.',
  'Each quote must stay inside one supplied page or file excerpt. If a sentence crosses PDF pages, cite separate useful passages from those pages instead of concatenating them. Do not repair extracted formulas inside quote: preserve original symbols or choose a clear nearby explanatory phrase that supports the same claim.',
  'Check that the cited passage supports this particular claim, not merely the general topic. Distinguish a source statement from your inference and preserve its assumptions and scope. Do not generalize a method-specific result or a physical-level tradeoff into a broader conclusion without supporting evidence.',
  'Use citation:SOURCE_ID?quote=URL_ENCODED_EXACT_QUOTE to bind that passage to its supplied source. Preserve the supplied source id. Never put a summary, translation, section name, invented text, or text from a different source in quote. Never output the placeholder literally or invent a file path.',
  'Entries marked passage anchor available may use their exact supplied token when that passage supports the claim; use ?quote= with another exact supplied passage when a different passage supports it. Use a concise page or source label, not a full filename or file path.',
  'Do not cite pages or passages that were not supplied. If the necessary passage is unavailable or context was truncated, explain the specific evidence gap when relevant instead of adding a page-only link or pretending the claim is verified.',
].join('\n');

export function buildCitationPromptReferences(evidenceRefs: EvidenceRef[]): string {
  return buildCitationContracts(evidenceRefs).map((ref) => {
    const precise = isPreciseCitation(ref);
    const href = `citation:${ref.stableId}${precise ? '' : '?quote=URL_ENCODED_EXACT_QUOTE'}`;
    const label = ref.page ? `p.${ref.page}` : ref.basename || ref.displayTitle;
    const target = ref.navigationTarget;
    const snippet = precise && target && (target.type === 'pdf_page' || target.type === 'workspace_text')
      ? target.snippet
      : undefined;
    const passage = snippet ? ` Anchored passage: ${JSON.stringify(snippet)}` : '';
    return `- [${label}](${href}) -> ${ref.evidenceRef.locator} (${precise ? 'passage anchor available' : 'quote required'})${passage}`;
  }).join('\n');
}
