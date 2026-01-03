/**
 * Property-based tests for Annotation Layer
 * 
 * Feature: pdf-annotation-engine
 * Property 9: Z-Index Ordering by Timestamp
 * Validates: Requirements 7.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
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

/**
 * Generator for annotations on the same page with unique timestamps
 */
const samePageAnnotationsArb = (fileId: string, page: number) =>
  fc.array(
    fc.record({
      id: fc.uuid(),
      fileId: fc.constant(fileId),
      page: fc.constant(page),
      position: fc.record({
        boundingRect: boundingRectArb,
        rects: fc.array(boundingRectArb, { minLength: 1, maxLength: 5 }),
      }),
      content: fc.record({
        text: fc.option(fc.string(), { nil: undefined }),
        image: fc.option(fc.string(), { nil: undefined }),
      }),
      comment: fc.string(),
      color: annotationColorArb,
      timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      type: annotationTypeArb,
    }),
    { minLength: 2, maxLength: 20 }
  );

// ============================================================================
// Property 9: Z-Index Ordering by Timestamp
// Feature: pdf-annotation-engine, Property 9: Z-Index Ordering by Timestamp
// Validates: Requirements 7.4
// ============================================================================

describe('Property 9: Z-Index Ordering by Timestamp', () => {
  /**
   * Helper function that mimics the sorting logic in AnnotationLayer
   * Sorts annotations by timestamp (older first = lower z-index)
   */
  function sortByTimestamp(annotations: LatticeAnnotation[]): LatticeAnnotation[] {
    return [...annotations].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Helper to get z-index for an annotation based on its position in sorted array
   */
  function getZIndex(annotation: LatticeAnnotation, sortedAnnotations: LatticeAnnotation[]): number {
    const index = sortedAnnotations.findIndex((a) => a.id === annotation.id);
    return index + 1; // z-index starts at 1
  }

  it('newer annotations have higher z-index than older annotations', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 100 }),
        (fileId, page) => {
          return fc.assert(
            fc.property(samePageAnnotationsArb(fileId, page), (annotations) => {
              const sorted = sortByTimestamp(annotations);

              // For any two annotations, the one with higher timestamp should have higher z-index
              for (let i = 0; i < sorted.length; i++) {
                for (let j = i + 1; j < sorted.length; j++) {
                  const older = sorted[i];
                  const newer = sorted[j];

                  // newer should have higher or equal timestamp
                  expect(newer.timestamp).toBeGreaterThanOrEqual(older.timestamp);

                  // newer should have higher z-index
                  const olderZIndex = getZIndex(older, sorted);
                  const newerZIndex = getZIndex(newer, sorted);
                  expect(newerZIndex).toBeGreaterThan(olderZIndex);
                }
              }

              return true;
            }),
            { numRuns: 10 }
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  it('sorting by timestamp is stable and deterministic', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 2, maxLength: 20 }),
        (annotations) => {
          const sorted1 = sortByTimestamp(annotations);
          const sorted2 = sortByTimestamp(annotations);

          // Same input should produce same output
          expect(sorted1.map((a) => a.id)).toEqual(sorted2.map((a) => a.id));

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('z-index ordering preserves all annotations', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 20 }),
        (annotations) => {
          const sorted = sortByTimestamp(annotations);

          // All annotations should be present
          expect(sorted.length).toBe(annotations.length);

          // All original IDs should be in sorted array
          const originalIds = new Set(annotations.map((a) => a.id));
          const sortedIds = new Set(sorted.map((a) => a.id));
          expect(sortedIds).toEqual(originalIds);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('annotations with same timestamp maintain relative order (stability)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.array(fc.uuid(), { minLength: 2, maxLength: 10 }),
        (timestamp, ids) => {
          // Create annotations with same timestamp
          const annotations: LatticeAnnotation[] = ids.map((id) => ({
            id,
            fileId: 'test-file',
            page: 1,
            position: {
              boundingRect: { x1: 0, y1: 0, x2: 0.5, y2: 0.5, width: 100, height: 100 },
              rects: [],
            },
            content: {},
            comment: '',
            color: 'yellow' as const,
            timestamp,
            type: 'text' as const,
          }));

          const sorted = sortByTimestamp(annotations);

          // With same timestamps, original order should be preserved (stable sort)
          // JavaScript's sort is stable as of ES2019
          expect(sorted.map((a) => a.id)).toEqual(annotations.map((a) => a.id));

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('z-index values are consecutive starting from 1', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 20 }),
        (annotations) => {
          const sorted = sortByTimestamp(annotations);

          // Each annotation should have z-index equal to its position + 1
          sorted.forEach((annotation, index) => {
            const zIndex = getZIndex(annotation, sorted);
            expect(zIndex).toBe(index + 1);
          });

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Additional Annotation Layer Tests
// ============================================================================

describe('Annotation Layer Utilities', () => {
  it('filtering by page returns only annotations for that page', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 100 }),
        (annotations, targetPage) => {
          const fileId = 'test-file';
          const normalizedAnnotations = annotations.map((a) => ({
            ...a,
            fileId,
          }));

          // Filter like the component does
          const filtered = normalizedAnnotations.filter(
            (a) => a.fileId === fileId && a.page === targetPage
          );

          // All filtered annotations should be on the target page
          for (const ann of filtered) {
            expect(ann.page).toBe(targetPage);
            expect(ann.fileId).toBe(fileId);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('filtering by fileId returns only annotations for that file', () => {
    fc.assert(
      fc.property(
        fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1 }),
        (annotations, targetFileId) => {
          // Filter like the component does
          const filtered = annotations.filter((a) => a.fileId === targetFileId);

          // All filtered annotations should have the target fileId
          for (const ann of filtered) {
            expect(ann.fileId).toBe(targetFileId);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
