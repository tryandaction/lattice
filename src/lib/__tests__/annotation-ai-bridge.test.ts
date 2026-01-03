/**
 * Property-based tests for annotation AI bridge
 * 
 * Feature: universal-annotation-manager
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  formatAnnotationForAI,
  exportAnnotationsForAI,
  exportAnnotationsWithComments,
  exportAnnotationsForPage,
  exportAnnotationsForLineRange,
} from '../annotation-ai-bridge';
import type { 
  AnnotationItem, 
  PdfTarget, 
  ImageTarget, 
  CodeLineTarget, 
  TextAnchorTarget 
} from '../../types/universal-annotation';
import { ANNOTATION_STYLE_TYPES } from '../../types/universal-annotation';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for BoundingBox
 */
const boundingBoxArb = fc.record({
  x1: fc.double({ min: 0, max: 1, noNaN: true }),
  y1: fc.double({ min: 0, max: 1, noNaN: true }),
  x2: fc.double({ min: 0, max: 1, noNaN: true }),
  y2: fc.double({ min: 0, max: 1, noNaN: true }),
});

/**
 * Generator for PdfTarget
 */
const pdfTargetArb: fc.Arbitrary<PdfTarget> = fc.record({
  type: fc.constant('pdf' as const),
  page: fc.integer({ min: 1, max: 1000 }),
  rects: fc.array(boundingBoxArb, { minLength: 0, maxLength: 3 }),
});

/**
 * Generator for ImageTarget
 */
const imageTargetArb: fc.Arbitrary<ImageTarget> = fc.record({
  type: fc.constant('image' as const),
  x: fc.double({ min: 0, max: 100, noNaN: true }),
  y: fc.double({ min: 0, max: 100, noNaN: true }),
  width: fc.double({ min: 0, max: 100, noNaN: true }),
  height: fc.double({ min: 0, max: 100, noNaN: true }),
});

/**
 * Generator for CodeLineTarget
 */
const codeLineTargetArb: fc.Arbitrary<CodeLineTarget> = fc.record({
  type: fc.constant('code_line' as const),
  line: fc.integer({ min: 1, max: 10000 }),
});

/**
 * Generator for TextAnchorTarget
 */
const textAnchorTargetArb: fc.Arbitrary<TextAnchorTarget> = fc.record({
  type: fc.constant('text_anchor' as const),
  elementId: fc.string({ minLength: 1, maxLength: 30 }),
  offset: fc.integer({ min: 0, max: 1000 }),
});

/**
 * Generator for any AnnotationTarget
 */
const annotationTargetArb = fc.oneof(
  pdfTargetArb,
  imageTargetArb,
  codeLineTargetArb,
  textAnchorTargetArb
);

/**
 * Generator for AnnotationStyle
 */
const annotationStyleArb = fc.record({
  color: fc.constantFrom('yellow', 'red', 'green', 'blue'),
  type: fc.constantFrom(...ANNOTATION_STYLE_TYPES),
});

/**
 * Generator for AnnotationItem with content
 */
const annotationItemWithContentArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: annotationTargetArb,
  style: annotationStyleArb,
  content: fc.string({ minLength: 1, maxLength: 100 }),
  comment: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 30 }),
  createdAt: fc.integer({ min: 0 }),
});

/**
 * Generator for AnnotationItem (may or may not have content/comment)
 */
const annotationItemArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: annotationTargetArb,
  style: annotationStyleArb,
  content: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  comment: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 30 }),
  createdAt: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 4: AI Export Format Correctness
// Feature: universal-annotation-manager, Property 4: AI Export Format Correctness
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
// ============================================================================

describe('Property 4: AI Export Format Correctness', () => {
  describe('formatAnnotationForAI', () => {
    it('includes location context for PDF targets', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            target: pdfTargetArb,
            style: annotationStyleArb,
            content: fc.string({ minLength: 1, maxLength: 50 }),
            author: fc.string({ minLength: 1 }),
            createdAt: fc.integer({ min: 0 }),
          }),
          (annotation) => {
            const formatted = formatAnnotationForAI(annotation as AnnotationItem);
            expect(formatted).toContain(`Page ${annotation.target.page}:`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('includes location context for code line targets', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            target: codeLineTargetArb,
            style: annotationStyleArb,
            content: fc.string({ minLength: 1, maxLength: 50 }),
            author: fc.string({ minLength: 1 }),
            createdAt: fc.integer({ min: 0 }),
          }),
          (annotation) => {
            const formatted = formatAnnotationForAI(annotation as AnnotationItem);
            expect(formatted).toContain(`Line ${annotation.target.line}:`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('includes location context for image targets', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            target: imageTargetArb,
            style: annotationStyleArb,
            content: fc.string({ minLength: 1, maxLength: 50 }),
            author: fc.string({ minLength: 1 }),
            createdAt: fc.integer({ min: 0 }),
          }),
          (annotation) => {
            const formatted = formatAnnotationForAI(annotation as AnnotationItem);
            expect(formatted).toContain('Image region:');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('includes style type in brackets', () => {
      fc.assert(
        fc.property(annotationItemWithContentArb, (annotation) => {
          const formatted = formatAnnotationForAI(annotation);
          const expectedStyle = annotation.style.type.charAt(0).toUpperCase() + annotation.style.type.slice(1);
          expect(formatted).toContain(`[${expectedStyle}]`);
        }),
        { numRuns: 100 }
      );
    });

    it('includes content in quotes when present', () => {
      fc.assert(
        fc.property(annotationItemWithContentArb, (annotation) => {
          const formatted = formatAnnotationForAI(annotation);
          if (annotation.content && annotation.content.length > 0) {
            expect(formatted).toContain(`'${annotation.content}'`);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('appends note prefix when comment exists', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            target: annotationTargetArb,
            style: annotationStyleArb,
            content: fc.string({ minLength: 1, maxLength: 50 }),
            comment: fc.string({ minLength: 1, maxLength: 50 }),
            author: fc.string({ minLength: 1 }),
            createdAt: fc.integer({ min: 0 }),
          }),
          (annotation) => {
            const formatted = formatAnnotationForAI(annotation as AnnotationItem);
            expect(formatted).toContain(`- Note: '${annotation.comment}'`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('does not include note when comment is absent', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            target: annotationTargetArb,
            style: annotationStyleArb,
            content: fc.string({ minLength: 1, maxLength: 50 }),
            author: fc.string({ minLength: 1 }),
            createdAt: fc.integer({ min: 0 }),
          }),
          (annotation) => {
            const formatted = formatAnnotationForAI(annotation as AnnotationItem);
            expect(formatted).not.toContain('- Note:');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('exportAnnotationsForAI', () => {
    it('returns empty string for empty array', () => {
      expect(exportAnnotationsForAI([])).toBe('');
    });

    it('returns empty string for null/undefined', () => {
      expect(exportAnnotationsForAI(null as unknown as AnnotationItem[])).toBe('');
      expect(exportAnnotationsForAI(undefined as unknown as AnnotationItem[])).toBe('');
    });

    it('joins multiple annotations with newlines', () => {
      fc.assert(
        fc.property(
          fc.array(annotationItemWithContentArb, { minLength: 2, maxLength: 5 }),
          (annotations) => {
            const exported = exportAnnotationsForAI(annotations);
            const lines = exported.split('\n');
            expect(lines.length).toBe(annotations.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('each line contains location context', () => {
      fc.assert(
        fc.property(
          fc.array(annotationItemWithContentArb, { minLength: 1, maxLength: 5 }),
          (annotations) => {
            const exported = exportAnnotationsForAI(annotations);
            const lines = exported.split('\n');
            
            for (let i = 0; i < annotations.length; i++) {
              const target = annotations[i].target;
              switch (target.type) {
                case 'pdf':
                  expect(lines[i]).toContain(`Page ${target.page}:`);
                  break;
                case 'code_line':
                  expect(lines[i]).toContain(`Line ${target.line}:`);
                  break;
                case 'image':
                  expect(lines[i]).toContain('Image region:');
                  break;
                case 'text_anchor':
                  expect(lines[i]).toContain(`Element ${target.elementId}:`);
                  break;
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Filtering Utilities Tests
// ============================================================================

describe('AI Export Filtering Utilities', () => {
  describe('exportAnnotationsWithComments', () => {
    it('only includes annotations with comments', () => {
      const annotations: AnnotationItem[] = [
        {
          id: '1',
          target: { type: 'pdf', page: 1, rects: [] },
          style: { color: 'yellow', type: 'highlight' },
          content: 'Text 1',
          comment: 'Has comment',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '2',
          target: { type: 'pdf', page: 2, rects: [] },
          style: { color: 'blue', type: 'highlight' },
          content: 'Text 2',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '3',
          target: { type: 'pdf', page: 3, rects: [] },
          style: { color: 'green', type: 'highlight' },
          content: 'Text 3',
          comment: 'Another comment',
          author: 'user',
          createdAt: Date.now(),
        },
      ];

      const exported = exportAnnotationsWithComments(annotations);
      const lines = exported.split('\n');
      
      expect(lines.length).toBe(2);
      expect(exported).toContain('Has comment');
      expect(exported).toContain('Another comment');
      expect(exported).not.toContain('Text 2');
    });
  });

  describe('exportAnnotationsForPage', () => {
    it('only includes annotations for specified page', () => {
      const annotations: AnnotationItem[] = [
        {
          id: '1',
          target: { type: 'pdf', page: 1, rects: [] },
          style: { color: 'yellow', type: 'highlight' },
          content: 'Page 1 content',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '2',
          target: { type: 'pdf', page: 2, rects: [] },
          style: { color: 'blue', type: 'highlight' },
          content: 'Page 2 content',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '3',
          target: { type: 'code_line', line: 10 },
          style: { color: 'green', type: 'underline' },
          content: 'Code content',
          author: 'user',
          createdAt: Date.now(),
        },
      ];

      const exported = exportAnnotationsForPage(annotations, 1);
      
      expect(exported).toContain('Page 1 content');
      expect(exported).not.toContain('Page 2 content');
      expect(exported).not.toContain('Code content');
    });

    it('returns empty string when no annotations on page', () => {
      const annotations: AnnotationItem[] = [
        {
          id: '1',
          target: { type: 'pdf', page: 1, rects: [] },
          style: { color: 'yellow', type: 'highlight' },
          content: 'Page 1 content',
          author: 'user',
          createdAt: Date.now(),
        },
      ];

      const exported = exportAnnotationsForPage(annotations, 5);
      expect(exported).toBe('');
    });
  });

  describe('exportAnnotationsForLineRange', () => {
    it('only includes code annotations in specified range', () => {
      const annotations: AnnotationItem[] = [
        {
          id: '1',
          target: { type: 'code_line', line: 5 },
          style: { color: 'yellow', type: 'highlight' },
          content: 'Line 5',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '2',
          target: { type: 'code_line', line: 15 },
          style: { color: 'blue', type: 'highlight' },
          content: 'Line 15',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '3',
          target: { type: 'code_line', line: 25 },
          style: { color: 'green', type: 'highlight' },
          content: 'Line 25',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '4',
          target: { type: 'pdf', page: 1, rects: [] },
          style: { color: 'red', type: 'highlight' },
          content: 'PDF content',
          author: 'user',
          createdAt: Date.now(),
        },
      ];

      const exported = exportAnnotationsForLineRange(annotations, 10, 20);
      
      expect(exported).toContain('Line 15');
      expect(exported).not.toContain('Line 5');
      expect(exported).not.toContain('Line 25');
      expect(exported).not.toContain('PDF content');
    });

    it('includes boundary lines', () => {
      const annotations: AnnotationItem[] = [
        {
          id: '1',
          target: { type: 'code_line', line: 10 },
          style: { color: 'yellow', type: 'highlight' },
          content: 'Start line',
          author: 'user',
          createdAt: Date.now(),
        },
        {
          id: '2',
          target: { type: 'code_line', line: 20 },
          style: { color: 'blue', type: 'highlight' },
          content: 'End line',
          author: 'user',
          createdAt: Date.now(),
        },
      ];

      const exported = exportAnnotationsForLineRange(annotations, 10, 20);
      
      expect(exported).toContain('Start line');
      expect(exported).toContain('End line');
    });
  });
});

// ============================================================================
// Format Examples
// ============================================================================

describe('AI Export Format Examples', () => {
  it('produces expected format for PDF annotation', () => {
    const annotation: AnnotationItem = {
      id: 'test-1',
      target: { type: 'pdf', page: 1, rects: [] },
      style: { color: 'yellow', type: 'highlight' },
      content: 'Quantum entanglement is fascinating',
      comment: 'Check this citation',
      author: 'user',
      createdAt: Date.now(),
    };

    const formatted = formatAnnotationForAI(annotation);
    expect(formatted).toBe("Page 1: [Highlight] 'Quantum entanglement is fascinating' - Note: 'Check this citation'");
  });

  it('produces expected format for code annotation without comment', () => {
    const annotation: AnnotationItem = {
      id: 'test-2',
      target: { type: 'code_line', line: 42 },
      style: { color: 'blue', type: 'underline' },
      content: 'function processData()',
      author: 'user',
      createdAt: Date.now(),
    };

    const formatted = formatAnnotationForAI(annotation);
    expect(formatted).toBe("Line 42: [Underline] 'function processData()'");
  });

  it('produces expected format for image annotation', () => {
    const annotation: AnnotationItem = {
      id: 'test-3',
      target: { type: 'image', x: 10, y: 20, width: 30, height: 40 },
      style: { color: 'green', type: 'area' },
      content: 'Figure 3 diagram',
      author: 'user',
      createdAt: Date.now(),
    };

    const formatted = formatAnnotationForAI(annotation);
    expect(formatted).toBe("Image region: [Area] 'Figure 3 diagram'");
  });
});
