/**
 * Property-based tests for universal annotation sidebar
 * 
 * Feature: universal-annotation-manager
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { 
  truncateText, 
  groupAnnotations 
} from '../universal-annotation-sidebar';
import type { AnnotationItem, PdfTarget, CodeLineTarget, ImageTarget } from '../../../types/universal-annotation';
import { ANNOTATION_STYLE_TYPES } from '../../../types/universal-annotation';

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
  page: fc.integer({ min: 1, max: 100 }),
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
  line: fc.integer({ min: 1, max: 1000 }),
});

/**
 * Generator for any AnnotationTarget
 */
const annotationTargetArb = fc.oneof(
  pdfTargetArb,
  imageTargetArb,
  codeLineTargetArb
);

/**
 * Generator for AnnotationStyle
 */
const annotationStyleArb = fc.record({
  color: fc.constantFrom('yellow', 'red', 'green', 'blue'),
  type: fc.constantFrom(...ANNOTATION_STYLE_TYPES),
});

/**
 * Generator for AnnotationItem
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
// Property 7: Review Panel Render Completeness
// Feature: universal-annotation-manager, Property 7: Review Panel Render Completeness
// Validates: Requirements 4.3
// ============================================================================

describe('Property 7: Review Panel Render Completeness', () => {
  describe('truncateText', () => {
    it('returns original text when shorter than maxLength', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 49 }),
          (text) => {
            const result = truncateText(text, 50);
            expect(result).toBe(text);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('truncates text longer than maxLength with ellipsis', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 51, maxLength: 200 }),
          (text) => {
            const result = truncateText(text, 50);
            expect(result.length).toBe(50);
            expect(result.endsWith('...')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('preserves text at exactly maxLength', () => {
      const text = 'a'.repeat(50);
      const result = truncateText(text, 50);
      expect(result).toBe(text);
    });
  });

  describe('groupAnnotations', () => {
    it('groups PDF annotations by page', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              target: pdfTargetArb,
              style: annotationStyleArb,
              content: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
              author: fc.string({ minLength: 1 }),
              createdAt: fc.integer({ min: 0 }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (annotations) => {
            const groups = groupAnnotations(annotations as AnnotationItem[]);
            
            // Each group should have a unique key
            const keys = groups.map(g => g.key);
            expect(new Set(keys).size).toBe(keys.length);
            
            // All annotations should be accounted for
            const totalAnnotations = groups.reduce((sum, g) => sum + g.annotations.length, 0);
            expect(totalAnnotations).toBe(annotations.length);
            
            // PDF annotations should be grouped by page
            for (const group of groups) {
              if (group.key.startsWith('pdf-page-')) {
                const pageNum = parseInt(group.key.replace('pdf-page-', ''));
                for (const ann of group.annotations) {
                  expect(ann.target.type).toBe('pdf');
                  if (ann.target.type === 'pdf') {
                    expect(ann.target.page).toBe(pageNum);
                  }
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('groups code annotations by line ranges', () => {
      const annotations: AnnotationItem[] = [
        {
          id: '1',
          target: { type: 'code_line', line: 5 },
          style: { color: 'yellow', type: 'highlight' },
          author: 'user',
          createdAt: 1000,
        },
        {
          id: '2',
          target: { type: 'code_line', line: 45 },
          style: { color: 'blue', type: 'highlight' },
          author: 'user',
          createdAt: 2000,
        },
        {
          id: '3',
          target: { type: 'code_line', line: 55 },
          style: { color: 'green', type: 'highlight' },
          author: 'user',
          createdAt: 3000,
        },
      ];

      const groups = groupAnnotations(annotations);
      
      // Lines 5 and 45 should be in the same group (1-50)
      // Line 55 should be in a different group (51-100)
      expect(groups.length).toBe(2);
      
      const firstGroup = groups.find(g => g.key === 'code-lines-1-50');
      const secondGroup = groups.find(g => g.key === 'code-lines-51-100');
      
      expect(firstGroup?.annotations.length).toBe(2);
      expect(secondGroup?.annotations.length).toBe(1);
    });

    it('groups image annotations together', () => {
      const annotations: AnnotationItem[] = [
        {
          id: '1',
          target: { type: 'image', x: 10, y: 20, width: 30, height: 40 },
          style: { color: 'yellow', type: 'area' },
          author: 'user',
          createdAt: 1000,
        },
        {
          id: '2',
          target: { type: 'image', x: 50, y: 60, width: 20, height: 20 },
          style: { color: 'blue', type: 'area' },
          author: 'user',
          createdAt: 2000,
        },
      ];

      const groups = groupAnnotations(annotations);
      
      expect(groups.length).toBe(1);
      expect(groups[0].key).toBe('image-regions');
      expect(groups[0].annotations.length).toBe(2);
    });

    it('sorts annotations within groups by createdAt', () => {
      fc.assert(
        fc.property(
          fc.array(annotationItemArb, { minLength: 2, maxLength: 20 }),
          (annotations) => {
            const groups = groupAnnotations(annotations);
            
            for (const group of groups) {
              for (let i = 1; i < group.annotations.length; i++) {
                expect(group.annotations[i].createdAt).toBeGreaterThanOrEqual(
                  group.annotations[i - 1].createdAt
                );
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns empty array for empty input', () => {
      const groups = groupAnnotations([]);
      expect(groups).toHaveLength(0);
    });

    it('preserves all annotation data in groups', () => {
      fc.assert(
        fc.property(
          fc.array(annotationItemArb, { minLength: 1, maxLength: 10 }),
          (annotations) => {
            const groups = groupAnnotations(annotations);
            
            // Collect all annotations from groups
            const groupedAnnotations = groups.flatMap(g => g.annotations);
            
            // Every original annotation should be in the groups
            for (const original of annotations) {
              const found = groupedAnnotations.find(a => a.id === original.id);
              expect(found).toBeDefined();
              expect(found?.style.color).toBe(original.style.color);
              expect(found?.style.type).toBe(original.style.type);
              expect(found?.content).toBe(original.content);
              expect(found?.comment).toBe(original.comment);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Render Data Completeness Tests
// ============================================================================

describe('Sidebar Render Data Completeness', () => {
  it('annotation item contains all required display fields', () => {
    fc.assert(
      fc.property(annotationItemArb, (annotation) => {
        // Verify all fields needed for rendering are present
        expect(annotation.id).toBeDefined();
        expect(annotation.style.color).toBeDefined();
        expect(annotation.style.type).toBeDefined();
        expect(annotation.target.type).toBeDefined();
        expect(annotation.createdAt).toBeDefined();
        
        // Content and comment are optional but should be string if present
        if (annotation.content !== undefined) {
          expect(typeof annotation.content).toBe('string');
        }
        if (annotation.comment !== undefined) {
          expect(typeof annotation.comment).toBe('string');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('group labels are human-readable', () => {
    const testCases: AnnotationItem[] = [
      {
        id: '1',
        target: { type: 'pdf', page: 5, rects: [] },
        style: { color: 'yellow', type: 'highlight' },
        author: 'user',
        createdAt: Date.now(),
      },
      {
        id: '2',
        target: { type: 'code_line', line: 42 },
        style: { color: 'blue', type: 'underline' },
        author: 'user',
        createdAt: Date.now(),
      },
      {
        id: '3',
        target: { type: 'image', x: 10, y: 20, width: 30, height: 40 },
        style: { color: 'green', type: 'area' },
        author: 'user',
        createdAt: Date.now(),
      },
    ];

    const groups = groupAnnotations(testCases);
    
    for (const group of groups) {
      // Labels should be non-empty strings
      expect(group.label.length).toBeGreaterThan(0);
      // Labels should not contain raw keys
      expect(group.label).not.toContain('pdf-page-');
      expect(group.label).not.toContain('code-lines-');
      expect(group.label).not.toContain('image-regions');
    }
  });
});
