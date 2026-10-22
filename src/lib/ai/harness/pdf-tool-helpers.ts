import { normalizePdfReadableText } from '@/lib/pdf-readable-text';
import { PDF_ANNOTATION_DRAFTS_BEGIN, PDF_ANNOTATION_DRAFTS_END, buildEmptyPdfAnnotationDraftsSection } from '@/lib/pdf-annotation-markdown-drafts';
import type { AgentSourceRead } from '../source-index';
import { resolveAuthorizedDocumentHandle } from '../document-source-capture';
import { getAgentDocumentVersion } from '../document-source';
export interface HarnessAnnotationIntent { page: number; quote: string; type: 'highlight' | 'underline'; color?: string; comment?: string; tags?: string[] }
export function appendVerifiedAnnotationDrafts(previous: string, annotations: HarnessAnnotationIntent[], evidence: AgentSourceRead): string {
  if (evidence.snapshot.kind !== 'pdf' || !annotations.length || annotations.length > 50) throw new Error('Annotation drafts require actually read PDF evidence.');
  const line = (text: string) => text.replace(/[\r\n\u0000-\u001f]/gu, ' ').replace(/-->/gu, '').trim();
  const blocks = annotations.map(annotation => {
    const exact = normalizePdfReadableText(annotation.quote);
    if (!Number.isSafeInteger(annotation.page) || annotation.page < 1 || !exact || exact.length > 8000 ||
      !evidence.chunks.some(chunk => chunk.unit === annotation.page && normalizePdfReadableText(chunk.text).includes(exact))) throw new Error('批注引文必须出现在实际已读取的对应 PDF 页正文中。');
    const color = annotation.color ?? '#FFD400';
    if (!/^#[0-9a-f]{6}$/iu.test(color) || !['highlight', 'underline'].includes(annotation.type)) throw new Error('Invalid annotation style.');
    const tags = [...new Set(['AI', 'AI批注', 'pdf-text-markup', ...(annotation.tags ?? []).map(line)])];
    return [`<!-- lattice-pdf-annotation id="ann-ai-${crypto.randomUUID()}" page="${annotation.page}" type="${annotation.type}" color="${color}" -->`,
      `- Quote: ${line(exact)}`, ...(annotation.comment ? [`- Comment: ${line(annotation.comment)}`] : []), `- Tags: ${tags.join(', ')}`, ''].join('\n');
  }).join('\n');
  const base = previous.includes(PDF_ANNOTATION_DRAFTS_BEGIN) ? previous : `${previous.trimEnd()}\n\n${buildEmptyPdfAnnotationDraftsSection()}\n`;
  const end = base.indexOf(PDF_ANNOTATION_DRAFTS_END), begin = base.indexOf(PDF_ANNOTATION_DRAFTS_BEGIN);
  if (end <= begin || base.indexOf(PDF_ANNOTATION_DRAFTS_END, end + 1) !== -1) throw new Error('Existing annotation drafts section is malformed; preserve it for manual review.');
  return `${base.slice(0, end).trimEnd()}\n\n${blocks}\n${base.slice(end)}`;
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
