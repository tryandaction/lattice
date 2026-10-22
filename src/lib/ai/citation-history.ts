import { getAnswerCitationLinks, prepareCitationMarkdown, validateAnswerCitationLinks } from './citation-validation';
import { buildCitationContracts, classifyStrictAiLink } from './citation-contract';
import type { AiMessage, EvidenceRef } from './types';

export function boundedCitationHistory(history: AiMessage[] | undefined, refs: EvidenceRef[], maxCharacters: number): AiMessage[] {
  if (!history?.length) return [];
  let remaining = maxCharacters;
  const bounded: AiMessage[] = [];
  const marker = '\n[Historical message truncated; re-read original sources for evidence.]\n';
  for (const message of history.slice(-8).reverse()) {
    if (remaining <= marker.length) break;
    const takeText = (text: string): string => {
      if (remaining <= marker.length) return '';
      const result = text.length <= remaining ? text : text.slice(0, remaining - marker.length) + marker;
      remaining -= result.length;
      return result;
    };
    const content = typeof message.content === 'string' ? takeText(message.content)
      : message.content.map(part => part.type === 'text' ? { ...part, text: takeText(part.text ?? '') } : part);
    bounded.unshift({ ...message, content });
  }
  return prepareCitationHistory(bounded, refs).messages;
}

export const CITATION_HISTORY_INSTRUCTIONS = 'Previous assistant messages are conversation history, not current source evidence. Historical citations marked unverified must not be reused as source ids or proof. Recheck every final citation against the current evidence menu and original passage. Do not infer a page number or claim support from an old label or quote.';

/** Produce a request-only copy; saved conversation text and citation metadata are untouched. */
export function prepareCitationHistory(messages: AiMessage[], refs: EvidenceRef[]): { messages: AiMessage[]; hasUnverifiedCitations: boolean } {
  const contracts = buildCitationContracts(refs);
  let hasUnverifiedCitations = false;
  const prepareText = (text: string): string => {
    text = prepareCitationMarkdown(text);
    const links = getAnswerCitationLinks(text, true, true);
    const invalidHrefs = new Set(validateAnswerCitationLinks(links, refs).issues.map(issue => issue.href));
    const edits = links.filter(link => {
      const bound = classifyStrictAiLink(link.href, contracts);
      return invalidHrefs.has(link.href) || !('citation' in bound);
    }).filter(link => link.from !== undefined && link.to !== undefined);
    // Apply source edits backwards, preserving surrounding prose, math, code and formatting.
    for (const link of edits.sort((a, b) => b.from! - a.from!)) {
      let quote = '';
      const encoded = link.href.match(/[?&](?:quote|text)=([^&#]*)/)?.[1];
      if (encoded) {
        try { quote = decodeURIComponent(encoded).replace(/\s+/g, ' ').slice(0, 240); } catch { /* Invalid encoded text is not evidence. */ }
      }
      const label = link.label.slice(0, 100).replace(/[\[\]<>]/g, '');
      const replacement = `${label}〔历史引文未重新核验${quote ? `；原引用片段：${JSON.stringify(quote)}` : ''}〕`;
      text = text.slice(0, link.from) + replacement + text.slice(link.to);
      hasUnverifiedCitations = true;
    }
    return text;
  };
  return {
    messages: messages.map(message => {
      if (message.role !== 'assistant') return message;
      return { ...message, content: typeof message.content === 'string' ? prepareText(message.content) : message.content.map(part => part.type === 'text' && part.text ? { ...part, text: prepareText(part.text) } : part) };
    }),
    hasUnverifiedCitations,
  };
}
