/**
 * Property-based tests for Annotation Sidebar utilities
 * 
 * Feature: pdf-annotation-engine
 * Property 7: Text Truncation Correctness
 * Property 8: Annotation Grouping by Page
 * Validates: Requirements 6.2, 6.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { truncateText, groupAnnotationsByPage } from '../annotation-sidebar';
import type {
  LatticeAnnotation,
  BoundingRect,
  AnnotationColor,
  AnnotationType,
} from '../../../types/annotation';
import { ANNOTATION_COLORS, ANNOTATION_TYPES } from '../../../types/annotation';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for valid normalized coordinates (0-1 range)
 */
const normalizedCoord = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Generator for valid page dimensions (positive numbers)
 */
const pageDimension = fc.double({ min: 1, max: 10000, noNaN: true });

/**
 * Generator for valid BoundingRect
 */
const boundingRectArb: fc.Arbitrary<BoundingRect> = fc.record({
  x1: normalizedCoord,
  y1: normalizedCoord,
  x2: normalizedCoord,
  y2: normalizedCoord,
  width: pageDimension,
  height: pageDimension,
});

/**
 * Generator for valid AnnotationColor
 */
const annotationColorArb: fc.Arbitrary<AnnotationColor> = fc.constantFrom(...ANNOTATION_COLORS);

/**
 * Generator for valid AnnotationType
 */
const annotationTypeArb: fc.Arbitrary<AnnotationType> = fc.constantFrom(...ANNOTATION_TYPES);

/**
 * Generator for valid LatticeAnnotation
 */
const latticeAnnotationArb: fc.Arbitrary<LatticeAnnotation> = fc.record({
  id: fc.uuid(),
  fileId: fc.string({ minLength: 1 }),
  page: fc.integer({ min: 1, max: 10000 }),
  position: fc.record({
    boundingRect: boundingRectArb,
    rects: fc.array(boundingRectArb, { minLength: 0, maxLength: 10 }),
  }),
  content: fc.record({
    text: fc.option(fc.string(), { nil: undefined }),
    image: fc.option(fc.string(), { nil: undefined }),
  }),
  comment: fc.string(),
  color: annotationColorArb,
  timestamp: fc.integer({ min: 0 }),
  type: annotationTypeArb,
});

// ============================================================================
// Property 7: Text Truncation Correctness
// Feature: pdf-annotation-engine, Property 7: Text Truncation Correctness
// Validates: Requirements 6.2
// ============================================================================

describe('Property 7: Text Truncation Correctness', () => {
  it('truncated text is never longer than maxLength', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 4, max: 200 }), // min 4 to accommodate "..."
        (text, maxLength) => {
          const result = truncateText(text, maxLength);
          expect(result.length).toBeLessThanOrEqual(maxLength);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('text shorter than maxLength is preserved unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 50 }),
        fc.integer({ min: 51, max: 200 }),
        (text, maxLength) => {
          const result = truncateText(text, maxLength);
          expect(result).toBe(text);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('text equal to maxLength is preserved unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (length) => {
          const text = 'a'.repeat(length);
          const result = truncateText(text, length);
          expect(result).toBe(text);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('truncated text ends with ellipsis when truncation occurs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10 }),
        fc.integer({ min: 4, max: 9 }),
        (text, maxLength) => {
          // Only test when text is actually longer than maxLength
          if (text.length > maxLength) {
            const result = truncateText(text, maxLength);
            expect(result.endsWith('...')).toBe(true);
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('truncated text preserves the beginning of the original text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10 }),
        fc.integer({ min: 6, max: 9 }),
        (text, maxLength) => {
          if (text.length > maxLength) {
            const result = truncateText(text, maxLength);
            const preservedPart = result.slice(0, -3); // Remove "..."
            expect(text.startsWith(preservedPart)).toBe(true);
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty string returns empty string', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (maxLength) => {
          const result = truncateText('', maxLength);
          expect(result).toBe('');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('default maxLength is 50', () => {
    const shortText = 'a'.repeat(50);
    const longText = 'a'.repeat(51);

    expect(truncateText(shortText)).toBe(shortText);
    expect(truncateText(longText)).toBe('a'.repeat(47) + '...');
  });
});

// ============================================================================
// Property 8: Annotation Grouping by Page
// Feature: pdf-annotation-engine, Property 8: Annotation Grouping by Page
// Validates: Requirements 6.4
// ============================================================================

describe('Property 8: Annotation Grouping by Page', () => {
  it('all annotations in a group have the same page number', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 50 }),
        (annotations) => {
          const groups = groupAnnotationsByPage(annotations);

          for (const group of groups) {
            for (const annotation of group.annotations) {
              expect(annotation.page).toBe(group.page);
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('union of all groups equals the original list', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 50 }),
        (annotations) => {
          const groups = groupAnnotationsByPage(annotations);

          // Collect all annotation IDs from groups
          const groupedIds = new Set<string>();
          for (const group of groups) {
            for (const annotation of group.annotations) {
              groupedIds.add(annotation.id);
            }
          }

          // Collect all original annotation IDs
          const originalIds = new Set(annotations.map((a) => a.id));

          // Sets should be equal
          expect(groupedIds).toEqual(originalIds);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('total count of grouped annotations equals original count', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 0, maxLength: 50 }),
        (annotations) => {
          const groups = groupAnnotationsByPage(annotations);
          const totalGrouped = groups.reduce((sum, g) => sum + g.annotations.length, 0);

          expect(totalGrouped).toBe(annotations.length);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('groups are sorted by page number in ascending order', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 2, maxLength: 50 }),
        (annotations) => {
          const groups = groupAnnotationsByPage(annotations);

          for (let i = 1; i < groups.length; i++) {
            expect(groups[i].page).toBeGreaterThan(groups[i - 1].page);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('annotations within each group are sorted by timestamp', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 2, maxLength: 50 }),
        (annotations) => {
          const groups = groupAnnotationsByPage(annotations);

          for (const group of groups) {
            for (let i = 1; i < group.annotations.length; i++) {
              expect(group.annotations[i].timestamp).toBeGreaterThanOrEqual(
                group.annotations[i - 1].timestamp
              );
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('each page number appears in exactly one group', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 50 }),
        (annotations) => {
          const groups = groupAnnotationsByPage(annotations);
          const pageNumbers = groups.map((g) => g.page);
          const uniquePageNumbers = new Set(pageNumbers);

          expect(pageNumbers.length).toBe(uniquePageNumbers.size);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty input returns empty array', () => {
    const groups = groupAnnotationsByPage([]);
    expect(groups).toEqual([]);
  });

  it('single annotation creates single group', () => {
    fc.assert(
      fc.property(latticeAnnotationArb, (annotation) => {
        const groups = groupAnnotationsByPage([annotation]);

        expect(groups.length).toBe(1);
        expect(groups[0].page).toBe(annotation.page);
        expect(groups[0].annotations.length).toBe(1);
        expect(groups[0].annotations[0]).toEqual(annotation);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('annotations on same page are grouped together', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.array(latticeAnnotationArb, { minLength: 2, maxLength: 10 }),
        (page, annotations) => {
          // Set all annotations to the same page
          const samePageAnnotations = annotations.map((a) => ({ ...a, page }));
          const groups = groupAnnotationsByPage(samePageAnnotations);

          expect(groups.length).toBe(1);
          expect(groups[0].page).toBe(page);
          expect(groups[0].annotations.length).toBe(samePageAnnotations.length);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
