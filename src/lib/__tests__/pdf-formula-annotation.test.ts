import { describe, expect, it } from 'vitest';
import { isAnnotationItem, validateAnnotationItem, type AnnotationItem } from '@/types/universal-annotation';
import { serializeAnnotationFile, deserializeAnnotationFile } from '../universal-annotation-storage';

const rect = { x1: 0.1, y1: 0.2, x2: 0.45, y2: 0.35 };
const annotation: AnnotationItem = { id: 'formula', target: { type: 'pdf', page: 1, rects: [rect] }, style: { type: 'highlight', color: '#FFD400' }, content: 'E = mc2', author: 'user', createdAt: 1, formula: { latex: 'E=mc^2', rawText: 'E = mc2', source: 'geometry', status: 'ready', originalRects: [rect] } };
describe('formula annotation persistence', () => {
  it('round trips the structured formula without replacing its source text', () => {
    const file = { version: 3 as const, documentId: 'paper', fileId: 'paper', fileType: 'pdf' as const, annotations: [annotation], lastModified: 1 };
    expect(deserializeAnnotationFile(serializeAnnotationFile(file))?.annotations[0]).toEqual(annotation);
  });
  it.each([{ latex: '' }, { source: 'guessed' }, { status: 'verified-by-magic' }, { originalRects: [] }, { originalRects: [{ ...rect, x1: NaN }] },{originalLatex:3},{recognitionTruncated:'false'},{tokenCount:1025}])('rejects invalid formula metadata: %j', patch => {
    const invalid = { ...annotation, formula: { ...annotation.formula, ...patch } };
    expect(isAnnotationItem(invalid)).toBe(false);
    expect(validateAnnotationItem(invalid).valid).toBe(false);
  });
  it('allows a source preview awaiting recognition without pretending TeX is ready', () => {
    expect(isAnnotationItem({ ...annotation, formula: { ...annotation.formula, status: 'needs-review', latex: undefined } })).toBe(true);
  });
});
