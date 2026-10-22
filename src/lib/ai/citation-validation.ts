import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { buildCitationContracts, canonicalCitationPath, classifyStrictAiLink } from './citation-contract';
import type { EvidenceRef } from './types';
import { prepareMarkdownForReading } from '@/lib/markdown-reading';
import { convertWikiLinksToMarkdown } from '@/lib/markdown-links';
import { decoratePdfAnnotationMarkdown } from '@/lib/pdf-annotation-markdown-rendering';
import { linkifyBareCitationTokens } from './citation-markdown';

export interface CitationValidationIssue {
  href: string;
  reason: 'unbound_source_or_quote' | 'page_label_mismatch';
}

export interface CitationValidationResult {
  validCount: number;
  issues: CitationValidationIssue[];
}

interface RenderedNode {
  tagName?: string;
  properties?: { href?: unknown };
  value?: string;
  children?: RenderedNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
const nodeText = (node: RenderedNode): string => node.value ?? node.children?.map(nodeText).join('') ?? '';

/** Repair syntax, never infer missing evidence: all identity fields and the quote must match. */
export function normalizeVerifiedCitationDestinations(answer: string, refs: EvidenceRef[]): string {
  if (!answer.includes('citation:')) return answer;
  const contracts = buildCitationContracts(refs);
  const protectedRanges: Array<[number, number]> = [];
  const collectProtected = (node: { type: string; position?: RenderedNode['position']; children?: unknown[] }) => {
    if (['code', 'inlineCode', 'math', 'inlineMath', 'html', 'image', 'definition'].includes(node.type)) {
      const from = node.position?.start.offset, to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) protectedRanges.push([from, to]);
      return;
    }
    node.children?.forEach(child => collectProtected(child as Parameters<typeof collectProtected>[0]));
  };
  collectProtected(parser.parse(answer));
  return answer.replace(/\[([^\]\n]+)\]\(citation:([^\n()]+?)#page=(\d+)\?quote=([^\s()]+)\)/gu,
    (original, label: string, sourcePath: string, page: string, quote: string, offset: number) => {
      if (protectedRanges.some(([from, to]) => offset >= from && offset < to)) return original;
      let decodedQuote: string;
      try { decodedQuote = decodeURIComponent(quote); } catch { return original; }
      const candidates = contracts.filter(contract => contract.canonicalPath === canonicalCitationPath(sourcePath)
        && contract.page === Number(page));
      const matches = candidates.map(contract => ({ contract, href: `citation:${contract.stableId}?quote=${encodeURIComponent(decodedQuote)}` }))
        .filter(({ href, contract }) => {
          const result = classifyStrictAiLink(href, contracts);
          return 'citation' in result && result.citation.sourceGroupId === contract.sourceGroupId
            && result.citation.page === contract.page;
        });
      return matches.length === 1 ? `[${label}](${matches[0].href})` : original;
    });
}

export interface AnswerCitationLink { href: string; label: string; from?: number; to?: number }

/** Keep citation parsing aligned with MarkdownRenderer's document preprocessing. */
export function prepareCitationMarkdown(answer: string): string {
  return linkifyBareCitationTokens(convertWikiLinksToMarkdown(prepareMarkdownForReading(decoratePdfAnnotationMarkdown(answer))));
}

function isCitationHref(href: string): boolean {
  return !/^(?:https?:\/\/|mailto:)/i.test(href) && (/^citation:/i.test(href)
    || /\.(?:pdf|md|mdx|markdown|docx?|html?|ipynb|txt|csv|tsx?|jsx?|py)(?:[#?]|$)/i.test(href)
    || /#(?:page|line|cell|text|annotation)=/i.test(href));
}

/** Match the renderer's GFM, math and raw-HTML semantics without executing HTML. */
export function getAnswerCitationLinks(answer: string, includeDefinitions = false, prepared = false): AnswerCitationLink[] {
  // Positions address this prepared request text, not the original stored message.
  const markdownTree = parser.parse(prepared ? answer : prepareCitationMarkdown(answer));
  const tree = parser.runSync(markdownTree) as RenderedNode;
  const links: AnswerCitationLink[] = [];
  const walk = (node: RenderedNode) => {
    if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
      const href = node.properties.href;
      if (isCitationHref(href)) {
        links.push({ href, label: nodeText(node).trim(), from: node.position?.start.offset, to: node.position?.end.offset });
      }
    }
    node.children?.forEach(walk);
  };
  walk(tree);
  if (includeDefinitions) {
    const visitDefinition = (node: { type: string; url?: string; identifier?: string; position?: RenderedNode['position']; children?: unknown[] }) => {
      if (node.type === 'definition' && node.url && isCitationHref(node.url)) {
        links.push({ href: node.url, label: node.identifier ?? '', from: node.position?.start.offset, to: node.position?.end.offset });
      }
      node.children?.forEach(child => visitDefinition(child as Parameters<typeof visitDefinition>[0]));
    };
    visitDefinition(markdownTree);
  }
  return links;
}

/** Check rendered Markdown citations, excluding code samples and ordinary web links. */
export function validateAnswerCitations(answer: string, refs: EvidenceRef[]): CitationValidationResult {
  return validateAnswerCitationLinks(getAnswerCitationLinks(answer), refs);
}

export function validateAnswerCitationLinks(links: AnswerCitationLink[], refs: EvidenceRef[]): CitationValidationResult {
  const contracts = buildCitationContracts(refs);
  const result: CitationValidationResult = { validCount: 0, issues: [] };
  links.forEach(({ href, label }) => {
    const classification = classifyStrictAiLink(href, contracts);
    if (!('citation' in classification)) {
      result.issues.push({ href, reason: 'unbound_source_or_quote' });
      return;
    }
    // A displayed page number is part of the claim, not decorative link text.
    const labelledPage = label.match(/^(?:p\.?\s*|page\s*|第\s*)(\d+)\s*(?:页)?$/i);
    if (labelledPage && classification.citation.page !== undefined && Number(labelledPage[1]) !== classification.citation.page) {
      result.issues.push({ href, reason: 'page_label_mismatch' });
      return;
    }
    result.validCount++;
  });
  return result;
}

export function assertValidAnswerCitations(answer: string, refs: EvidenceRef[]): void {
  const result = validateAnswerCitations(answer, refs);
  if (!result.issues.length) return;
  const details = [...new Set(result.issues.map(issue => issue.reason === 'page_label_mismatch' ? '页码标签与原文不符' : '引用来源或原文片段无法核验'))].join('；');
  throw new Error(`引文校验未通过（${result.issues.length} 处）：${details}。请使用对应来源的原文与正确页码修复引文；无法核实时说明证据缺口，不要伪造定位。`);
}

/** Reject deterministic removal-only repairs without imposing citations on ordinary answers. */
export function assertRepairedAnswerCitations(original: string, repaired: string, refs: EvidenceRef[]): void {
  assertValidAnswerCitations(repaired, refs);
  const originalLinks = getAnswerCitationLinks(original);
  const invalid = validateAnswerCitationLinks(originalLinks, refs);
  if (!invalid.issues.length) return;
  const prose = (value: string) => {
    const tree = parser.runSync(parser.parse(prepareCitationMarkdown(value))) as RenderedNode;
    const withoutLinks = (node: RenderedNode): string => node.tagName === 'a' ? '' : node.value ?? node.children?.map(withoutLinks).join(' ') ?? '';
    // Preserve mathematical punctuation (decimal points, signs) as claim content.
    return withoutLinks(tree).normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '').replace(/[。.!?！？]+$/u, '');
  };
  if (prose(original) !== prose(repaired)) return;
  const contracts = buildCitationContracts(refs);
  const counts = (links: AnswerCitationLink[], invalidHrefs = new Set<string>()) => {
    const result = new Map<string, number>();
    links.forEach(({ href }) => {
      if (invalidHrefs.has(href)) return;
      const classified = classifyStrictAiLink(href, contracts);
      if ('citation' in classified) {
        const key = classified.citation.stableId;
        result.set(key, (result.get(key) ?? 0) + 1);
      }
    });
    return result;
  };
  const before = counts(originalLinks, new Set(invalid.issues.map(issue => issue.href)));
  const after = counts(getAnswerCitationLinks(repaired));
  if ([...after].some(([key, count]) => count > (before.get(key) ?? 0))) return;
  throw new Error('引文修复未通过：仅删除了无效引文，原论点仍未得到核验。请提供有效原文依据，或明确说明证据缺口。');
}

export function buildCitationRepairInstructions(result: CitationValidationResult): string {
  return [
    'Repair only the invalid citations and any claims they do not actually support. Recheck the meaning of each cited passage; changing a page number alone does not establish support.',
    'Use the exact supplied source id and a short contiguous quote from that same page. Never concatenate across pages, rewrite formulas, replace symbols, or translate the quote. If formula extraction is damaged, cite a clear explanatory sentence from the same relevant location instead.',
    'Preserve valid citations. If no supplied passage supports a claim, state the specific evidence gap rather than hiding the citation or presenting the unsupported claim as verified.',
    ...result.issues.slice(0, 6).map(issue => `${issue.reason}: ${issue.href.slice(0, 260)}`),
  ].join('\n');
}
