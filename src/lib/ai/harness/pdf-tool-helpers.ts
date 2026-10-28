import { normalizePdfReadableText } from '@/lib/pdf-readable-text';
import { PDF_ANNOTATION_DRAFTS_BEGIN, PDF_ANNOTATION_DRAFTS_END, buildEmptyPdfAnnotationDraftsSection } from '@/lib/pdf-annotation-markdown-drafts';
import type { AgentSourceRead } from '../source-index';
import { resolveAuthorizedDocumentHandle } from '../document-source-capture';
import { getAgentDocumentVersion } from '../document-source';
export interface HarnessAnnotationIntent { page: number; quote: string; type: 'highlight' | 'underline'; color?: string; comment?: string; tags?: string[] }
const CSS_ANNOTATION_COLORS: Readonly<Record<string, string>> = {
  aqua: '#00FFFF', black: '#000000', blue: '#0000FF', brown: '#A52A2A', cyan: '#00FFFF', fuchsia: '#FF00FF',
  gray: '#808080', green: '#008000', grey: '#808080', lime: '#00FF00', magenta: '#FF00FF', maroon: '#800000',
  navy: '#000080', olive: '#808000', orange: '#FFA500', pink: '#FFC0CB', purple: '#800080', red: '#FF0000',
  silver: '#C0C0C0', teal: '#008080', white: '#FFFFFF', yellow: '#FFFF00',
};
/** Preserve exact CSS color meaning; never substitute a project palette color. */
export function canonicalizeHarnessAnnotationColor(value: unknown): string {
  if (value === undefined) return '#FFD400';
  if (typeof value === 'string') {
    const color = value.trim();
    if (/^#[0-9a-f]{6}$/iu.test(color)) return color.toUpperCase();
    if (/^#[0-9a-f]{3}$/iu.test(color)) return `#${[...color.slice(1)].map(digit => digit.repeat(2)).join('').toUpperCase()}`;
    const name = color.toLowerCase();
    if (Object.hasOwn(CSS_ANNOTATION_COLORS, name)) return CSS_ANNOTATION_COLORS[name];
  }
  throw new Error('Invalid annotation color: use #RGB, #RRGGBB, or a supported CSS color name.');
}
export function validateHarnessAnnotationStyle(annotation: { type: unknown; color?: unknown }): void {
  if (annotation.type !== 'highlight' && annotation.type !== 'underline') throw new Error('Invalid annotation type: expected highlight or underline.');
  canonicalizeHarnessAnnotationColor(annotation.color);
}
export type AnnotationQuoteValidationReason = 'invalid_page' | 'invalid_quote' | 'page_not_read' | 'quote_not_found' | 'ambiguous_quote' | 'conflicting_evidence';
export interface AnnotationQuoteValidationDetails {
  issues: Array<{ annotationIndex: number; page: number; reason: AnnotationQuoteValidationReason }>;
  readPages: number[];
  pageExcerpts: Array<{ page: number; text: string }>;
}
export class AnnotationQuoteValidationError extends Error {
  readonly code = 'annotation_quote_validation';
  constructor(readonly details: AnnotationQuoteValidationDetails) {
    super('批注引文未能在已读取的对应 PDF 页正文中唯一定位；请依据同页原文修正后重试。');
    this.name = 'AnnotationQuoteValidationError';
  }
}
export function isRecoverableAnnotationQuoteError(error: unknown): error is AnnotationQuoteValidationError {
  return error instanceof AnnotationQuoteValidationError && error.details.issues.length > 0
    && error.details.issues.every(issue => ['page_not_read', 'quote_not_found', 'ambiguous_quote'].includes(issue.reason));
}
interface ReadPageSegment { text: string; startOffset: number; endOffset: number }
const expandPdfAnnotationLigatures = (text: string) => text.replace(/[\ufb00-\ufb06]/gu, glyph => glyph.normalize('NFKC'));
function actualReadPageSegments(evidence: AgentSourceRead) {
  const pages = new Map<number, ReadPageSegment[]>(), conflicts = new Set<number>(), lengths = new Map<number, Set<number>>();
  const chunks = evidence.chunks.filter(chunk => chunk.path === evidence.snapshot.path && chunk.sourceId === evidence.snapshot.sourceId
    && chunk.version === evidence.snapshot.version && Number.isSafeInteger(chunk.unit) && chunk.unit >= 1 && chunk.unit <= evidence.snapshot.totalUnits
    && Number.isSafeInteger(chunk.startOffset) && chunk.startOffset >= 0 && Number.isSafeInteger(chunk.endOffset)
    && chunk.endOffset - chunk.startOffset === chunk.text.length && chunk.text.length > 0)
    .sort((left, right) => left.unit - right.unit || left.startOffset - right.startOffset || right.endOffset - left.endOffset);
  for (const chunk of chunks) {
    const segments = pages.get(chunk.unit) ?? [];
    pages.set(chunk.unit, segments);
    const pageLengths = lengths.get(chunk.unit) ?? new Set<number>();
    lengths.set(chunk.unit, pageLengths);
    if (chunk.unitLength !== undefined) {
      if (!Number.isSafeInteger(chunk.unitLength) || chunk.unitLength < chunk.endOffset) conflicts.add(chunk.unit);
      else pageLengths.add(chunk.unitLength);
    } else if (chunk.completeUnit && chunk.startOffset === 0) pageLengths.add(chunk.endOffset);
    const prior = segments.at(-1);
    if (!prior || chunk.startOffset > prior.endOffset) {
      segments.push({ text: chunk.text, startOffset: chunk.startOffset, endOffset: chunk.endOffset });
      continue;
    }
    const overlap = Math.min(prior.endOffset - chunk.startOffset, chunk.text.length);
    if (prior.text.slice(chunk.startOffset - prior.startOffset, chunk.startOffset - prior.startOffset + overlap) !== chunk.text.slice(0, overlap)) {
      conflicts.add(chunk.unit);
      continue;
    }
    if (chunk.endOffset > prior.endOffset) {
      prior.text += chunk.text.slice(overlap);
      prior.endOffset = chunk.endOffset;
    }
  }
  const completePages = new Set<number>();
  for (const [page, segments] of pages) {
    const pageLengths = lengths.get(page)!;
    if (pageLengths.size > 1) conflicts.add(page);
    if (!conflicts.has(page) && pageLengths.size === 1 && segments.length === 1 && segments[0].startOffset === 0
      && pageLengths.has(segments[0].endOffset)) completePages.add(page);
  }
  return { pages, conflicts, completePages };
}
/** Only typographic ligature expansion is allowed; keep offsets into actual readable source text. */
function comparablePageSegment(text: string) {
  const original = normalizePdfReadableText(text), starts: number[] = [], ends: number[] = [];
  let comparable = '';
  for (let index = 0; index < original.length; index += 1) {
    const expanded = expandPdfAnnotationLigatures(original[index]);
    comparable += expanded;
    for (let offset = 0; offset < expanded.length; offset += 1) { starts.push(index); ends.push(index + 1); }
  }
  return { original, comparable, starts, ends };
}
export function appendVerifiedAnnotationDrafts(previous: string, annotations: HarnessAnnotationIntent[], evidence: AgentSourceRead): string {
  if (evidence.snapshot.kind !== 'pdf' || !annotations.length || annotations.length > 50) throw new Error('Annotation drafts require actually read PDF evidence.');
  // Validate structure before quote recovery so an invalid mark is never hidden
  // by another candidate's recoverable evidence error.
  annotations.forEach(validateHarnessAnnotationStyle);
  const line = (text: string) => text.replace(/[\r\n\u0000-\u001f]/gu, ' ').replace(/-->/gu, '').trim();
  const { pages, conflicts, completePages } = actualReadPageSegments(evidence);
  const issues: AnnotationQuoteValidationDetails['issues'] = [];
  const verified = annotations.map((annotation, annotationIndex) => {
    const requested = normalizePdfReadableText(annotation.quote), needle = expandPdfAnnotationLigatures(requested);
    let reason: AnnotationQuoteValidationReason | undefined;
    let exact = '';
    if (!Number.isSafeInteger(annotation.page) || annotation.page < 1 || annotation.page > evidence.snapshot.totalUnits) reason = 'invalid_page';
    else if (!requested || requested.length > 8000) reason = 'invalid_quote';
    else if (conflicts.has(annotation.page)) reason = 'conflicting_evidence';
    else if (!completePages.has(annotation.page)) reason = 'page_not_read';
    else {
      const matches: string[] = [];
      for (const segment of pages.get(annotation.page)!) {
        const text = comparablePageSegment(segment.text);
        for (let offset = text.comparable.indexOf(needle); offset !== -1; offset = text.comparable.indexOf(needle, offset + 1)) {
          const end = offset + needle.length;
          // A quote cannot begin or end inside a single original ligature glyph.
          if (offset > 0 && text.starts[offset] === text.starts[offset - 1] || end < text.starts.length && text.starts[end] === text.starts[end - 1]) continue;
          matches.push(text.original.slice(text.starts[offset], text.ends[end - 1]));
          if (matches.length > 1) break;
        }
        if (matches.length > 1) break;
      }
      if (!matches.length) reason = 'quote_not_found';
      else if (matches.length > 1) reason = 'ambiguous_quote';
      else exact = matches[0];
    }
    if (reason) issues.push({ annotationIndex, page: annotation.page, reason });
    return { annotation, exact };
  });
  if (issues.length) {
    const pageExcerpts: AnnotationQuoteValidationDetails['pageExcerpts'] = [];
    for (const page of new Set(issues.map(issue => issue.page))) {
      for (const segment of pages.get(page) ?? []) {
        if (pageExcerpts.length >= 3) break;
        pageExcerpts.push({ page, text: normalizePdfReadableText(segment.text).slice(0, 240) });
      }
      if (pageExcerpts.length >= 3) break;
    }
    throw new AnnotationQuoteValidationError({ issues, readPages: [...pages.keys()].sort((left, right) => left - right), pageExcerpts });
  }
  const blocks = verified.map(({ annotation, exact }) => {
    const color = canonicalizeHarnessAnnotationColor(annotation.color);
    const tags = [...new Set(['AI', 'AI批注', 'pdf-text-markup', ...(annotation.tags ?? []).map(line)])];
    return [`<!-- lattice-pdf-annotation id="ann-ai-${crypto.randomUUID()}" page="${annotation.page}" type="${annotation.type}" color="${color}" -->`,
      `- Quote: ${line(exact)}`, ...(annotation.comment ? [`- Comment: ${line(annotation.comment)}`] : []), `- Tags: ${tags.join(', ')}`, ''].join('\n');
  }).join('\n');
  const base = previous.includes(PDF_ANNOTATION_DRAFTS_BEGIN) ? previous : `${previous.trimEnd()}\n\n${buildEmptyPdfAnnotationDraftsSection()}\n`;
  const end = base.indexOf(PDF_ANNOTATION_DRAFTS_END), begin = base.indexOf(PDF_ANNOTATION_DRAFTS_BEGIN);
  if (end <= begin || base.indexOf(PDF_ANNOTATION_DRAFTS_END, end + 1) !== -1) throw new Error('Existing annotation drafts section is malformed; preserve it for manual review.');
  return `${base.slice(0, end).trimEnd()}\n\n${blocks}\n${base.slice(end)}`;
}
export interface VerifiedAnnotationDraftBatch {
  content: string;
  acceptedCount: number;
  rejectedCount: number;
  validationDetails?: AnnotationQuoteValidationDetails;
}
/** Keep valid suggestions reviewable without weakening exact-quote validation. */
export function prepareVerifiedAnnotationDraftBatch(previous: string, annotations: HarnessAnnotationIntent[], evidence: AgentSourceRead): VerifiedAnnotationDraftBatch {
  try {
    return { content: appendVerifiedAnnotationDrafts(previous, annotations, evidence), acceptedCount: annotations.length, rejectedCount: 0 };
  } catch (error) {
    if (!isRecoverableAnnotationQuoteError(error)) throw error;
    // appendVerifiedAnnotationDrafts already checked every style before quotes.
    const rejectedIndices = new Set(error.details.issues.map(issue => issue.annotationIndex));
    const accepted = annotations.filter((_annotation, index) => !rejectedIndices.has(index));
    if (!accepted.length) throw error;
    const content = appendVerifiedAnnotationDrafts(previous, accepted, evidence);
    return { content, acceptedCount: accepted.length, rejectedCount: rejectedIndices.size, validationDetails: error.details };
  }
}

export async function readExistingHarnessText(root: FileSystemDirectoryHandle, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    const file = await (await resolveAuthorizedDocumentHandle(root, path)).getFile();
    if (file.size > 1_000_000) throw new Error('Existing review content exceeds byte budget.');
    const content = await file.text(); signal?.throwIfAborted();
    return { content, version: await getAgentDocumentVersion(file, path, signal) };
  } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error; }
}
export function harnessPage<T>(entries: T[], args: Record<string, unknown>, max = 500) {
  const cursor = Number(args.cursor ?? 0), limit = Math.min(Number(args.limit ?? 100), max), page = entries.slice(cursor, cursor + limit);
  const complete = cursor + page.length >= entries.length;
  return { entries: page, complete, ...(!complete ? { nextCursor: cursor + page.length } : {}) };
}
