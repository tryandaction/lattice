/**
 * Property-based tests for Annotation Store
 * 
 * Feature: pdf-annotation-engine
 * Validates: Requirements 5.2, 8.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { useAnnotationStore } from '../annotation-store';
import type {
  LatticeAnnotation,
  BoundingRect,
  AnnotationColor,
  AnnotationType,
} from '../../types/annotation';
import { ANNOTATION_COLORS, ANNOTATION_TYPES } from '../../types/annotation';

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
 * Generator for partial annotation updates (excluding id and fileId)
 */
const annotationUpdateArb = fc.record({
  page: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
  comment: fc.option(fc.string(), { nil: undefined }),
  color: fc.option(annotationColorArb, { nil: undefined }),
  timestamp: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
});

// ============================================================================
// Test Setup
// ============================================================================

describe('Annotation Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAnnotationStore.setState({
      annotations: new Map(),
      activeFileId: null,
      isLoading: false,
      error: null,
      pendingSave: false,
      backup: new Map(),
      rootHandle: null,
    });
  });

  // ============================================================================
  // Property 6: Annotation Update Field Preservation
  // Feature: pdf-annotation-engine, Property 6: Annotation Update Field Preservation
  // Validates: Requirements 5.2
  // ============================================================================

  describe('Property 6: Annotation Update Field Preservation', () => {
    it('updating an annotation only modifies specified fields', () => {
      fc.assert(
        fc.property(
          latticeAnnotationArb,
          annotationUpdateArb,
          (annotation, updates) => {
            // Setup: Add annotation to store
            const store = useAnnotationStore.getState();
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            annotationsMap.set(annotation.fileId, [annotation]);
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Filter out undefined values from updates
            const definedUpdates: Partial<Omit<LatticeAnnotation, 'id' | 'fileId'>> = {};
            if (updates.page !== undefined) definedUpdates.page = updates.page;
            if (updates.comment !== undefined) definedUpdates.comment = updates.comment;
            if (updates.color !== undefined) definedUpdates.color = updates.color;
            if (updates.timestamp !== undefined) definedUpdates.timestamp = updates.timestamp;

            // Skip if no updates
            if (Object.keys(definedUpdates).length === 0) return true;

            // Perform update
            useAnnotationStore.getState().updateAnnotation(annotation.id, definedUpdates);

            // Verify
            const updatedAnnotation = useAnnotationStore.getState().getAnnotationById(annotation.id);
            expect(updatedAnnotation).toBeDefined();

            if (updatedAnnotation) {
              // id and fileId should never change
              expect(updatedAnnotation.id).toBe(annotation.id);
              expect(updatedAnnotation.fileId).toBe(annotation.fileId);

              // Updated fields should have new values
              for (const [key, value] of Object.entries(definedUpdates)) {
                expect(updatedAnnotation[key as keyof LatticeAnnotation]).toBe(value);
              }

              // Non-updated fields should be preserved
              const nonUpdatedFields = ['position', 'content', 'type'] as const;
              for (const field of nonUpdatedFields) {
                if (!(field in definedUpdates)) {
                  expect(updatedAnnotation[field]).toEqual(annotation[field]);
                }
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('updating comment preserves all other fields', () => {
      fc.assert(
        fc.property(
          latticeAnnotationArb,
          fc.string(),
          (annotation, newComment) => {
            // Setup
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            annotationsMap.set(annotation.fileId, [annotation]);
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Update only comment
            useAnnotationStore.getState().updateAnnotation(annotation.id, { comment: newComment });

            // Verify
            const updated = useAnnotationStore.getState().getAnnotationById(annotation.id);
            expect(updated).toBeDefined();

            if (updated) {
              expect(updated.comment).toBe(newComment);
              expect(updated.id).toBe(annotation.id);
              expect(updated.fileId).toBe(annotation.fileId);
              expect(updated.page).toBe(annotation.page);
              expect(updated.position).toEqual(annotation.position);
              expect(updated.content).toEqual(annotation.content);
              expect(updated.color).toBe(annotation.color);
              expect(updated.type).toBe(annotation.type);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('updating color preserves all other fields', () => {
      fc.assert(
        fc.property(
          latticeAnnotationArb,
          annotationColorArb,
          (annotation, newColor) => {
            // Setup
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            annotationsMap.set(annotation.fileId, [annotation]);
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Update only color
            useAnnotationStore.getState().updateAnnotation(annotation.id, { color: newColor });

            // Verify
            const updated = useAnnotationStore.getState().getAnnotationById(annotation.id);
            expect(updated).toBeDefined();

            if (updated) {
              expect(updated.color).toBe(newColor);
              expect(updated.id).toBe(annotation.id);
              expect(updated.fileId).toBe(annotation.fileId);
              expect(updated.page).toBe(annotation.page);
              expect(updated.position).toEqual(annotation.position);
              expect(updated.content).toEqual(annotation.content);
              expect(updated.comment).toBe(annotation.comment);
              expect(updated.type).toBe(annotation.type);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('id and fileId cannot be changed via update', () => {
      fc.assert(
        fc.property(
          latticeAnnotationArb,
          fc.uuid(),
          fc.string({ minLength: 1 }),
          (annotation, newId, newFileId) => {
            // Setup
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            annotationsMap.set(annotation.fileId, [annotation]);
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Attempt to update id and fileId (should be ignored)
            useAnnotationStore.getState().updateAnnotation(annotation.id, {
              comment: 'updated',
              // @ts-expect-error - Testing that id/fileId are ignored
              id: newId,
              fileId: newFileId,
            });

            // Verify id and fileId are preserved
            const updated = useAnnotationStore.getState().getAnnotationById(annotation.id);
            expect(updated).toBeDefined();

            if (updated) {
              expect(updated.id).toBe(annotation.id);
              expect(updated.fileId).toBe(annotation.fileId);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ============================================================================
  // Property 10: Backup Data Preservation
  // Feature: pdf-annotation-engine, Property 10: Backup Data Preservation
  // Validates: Requirements 8.4
  // ============================================================================

  describe('Property 10: Backup Data Preservation', () => {
    it('backup preserves all annotations', () => {
      fc.assert(
        fc.property(
          fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 20 }),
          (annotations) => {
            // Group annotations by fileId
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            for (const ann of annotations) {
              const existing = annotationsMap.get(ann.fileId) ?? [];
              annotationsMap.set(ann.fileId, [...existing, ann]);
            }

            // Setup store with annotations
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Create backup
            useAnnotationStore.getState().createBackup();

            // Verify backup contains all annotations
            const state = useAnnotationStore.getState();
            
            for (const [fileId, fileAnnotations] of annotationsMap) {
              const backupAnnotations = state.backup.get(fileId);
              expect(backupAnnotations).toBeDefined();
              expect(backupAnnotations?.length).toBe(fileAnnotations.length);

              for (const ann of fileAnnotations) {
                const backupAnn = backupAnnotations?.find(b => b.id === ann.id);
                expect(backupAnn).toBeDefined();
                expect(backupAnn).toEqual(ann);
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('restore from backup recovers all annotations', () => {
      fc.assert(
        fc.property(
          fc.array(latticeAnnotationArb, { minLength: 1, maxLength: 20 }),
          (annotations) => {
            // Group annotations by fileId
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            for (const ann of annotations) {
              const existing = annotationsMap.get(ann.fileId) ?? [];
              annotationsMap.set(ann.fileId, [...existing, ann]);
            }

            // Setup store with annotations
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Create backup
            useAnnotationStore.getState().createBackup();

            // Clear annotations
            useAnnotationStore.setState({ annotations: new Map() });

            // Verify annotations are cleared
            expect(useAnnotationStore.getState().annotations.size).toBe(0);

            // Restore from backup
            useAnnotationStore.getState().restoreFromBackup();

            // Verify all annotations are restored
            const restoredState = useAnnotationStore.getState();
            
            for (const [fileId, fileAnnotations] of annotationsMap) {
              const restoredAnnotations = restoredState.annotations.get(fileId);
              expect(restoredAnnotations).toBeDefined();
              expect(restoredAnnotations?.length).toBe(fileAnnotations.length);

              for (const ann of fileAnnotations) {
                const restoredAnn = restoredAnnotations?.find(r => r.id === ann.id);
                expect(restoredAnn).toBeDefined();
                expect(restoredAnn).toEqual(ann);
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('backup is independent of original (deep copy)', () => {
      fc.assert(
        fc.property(
          latticeAnnotationArb,
          fc.string(),
          (annotation, newComment) => {
            // Setup
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            annotationsMap.set(annotation.fileId, [annotation]);
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Create backup
            useAnnotationStore.getState().createBackup();

            // Modify original annotation
            useAnnotationStore.getState().updateAnnotation(annotation.id, { comment: newComment });

            // Verify backup is unchanged
            const state = useAnnotationStore.getState();
            const backupAnnotations = state.backup.get(annotation.fileId);
            const backupAnn = backupAnnotations?.find(b => b.id === annotation.id);

            expect(backupAnn).toBeDefined();
            expect(backupAnn?.comment).toBe(annotation.comment); // Original comment
            expect(backupAnn?.comment).not.toBe(newComment); // Not the new comment (unless they happen to be equal)

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('multiple backups overwrite previous backup', () => {
      fc.assert(
        fc.property(
          latticeAnnotationArb,
          fc.string(),
          (annotation, newComment) => {
            // Setup with original annotation
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            annotationsMap.set(annotation.fileId, [annotation]);
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Create first backup
            useAnnotationStore.getState().createBackup();

            // Modify annotation
            useAnnotationStore.getState().updateAnnotation(annotation.id, { comment: newComment });

            // Create second backup
            useAnnotationStore.getState().createBackup();

            // Verify backup has the modified annotation
            const state = useAnnotationStore.getState();
            const backupAnnotations = state.backup.get(annotation.fileId);
            const backupAnn = backupAnnotations?.find(b => b.id === annotation.id);

            expect(backupAnn).toBeDefined();
            expect(backupAnn?.comment).toBe(newComment);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ============================================================================
  // Additional Store Tests
  // ============================================================================

  describe('Store Operations', () => {
    it('addAnnotation adds annotation to correct file', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (annotation) => {
          useAnnotationStore.getState().addAnnotation(annotation);

          const annotations = useAnnotationStore.getState().getAnnotationsForFile(annotation.fileId);
          expect(annotations).toContainEqual(annotation);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('deleteAnnotation removes annotation', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (annotation) => {
          // Add annotation
          const annotationsMap = new Map<string, LatticeAnnotation[]>();
          annotationsMap.set(annotation.fileId, [annotation]);
          useAnnotationStore.setState({ annotations: annotationsMap });

          // Delete annotation
          useAnnotationStore.getState().deleteAnnotation(annotation.id);

          // Verify it's gone
          const remaining = useAnnotationStore.getState().getAnnotationById(annotation.id);
          expect(remaining).toBeUndefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('getAnnotationsForPage filters by page number', () => {
      fc.assert(
        fc.property(
          fc.array(latticeAnnotationArb, { minLength: 2, maxLength: 20 }),
          fc.integer({ min: 1, max: 100 }),
          (annotations, targetPage) => {
            // Ensure all annotations have the same fileId for this test
            const fileId = 'test-file';
            const normalizedAnnotations = annotations.map((a, i) => ({
              ...a,
              fileId,
              page: i % 2 === 0 ? targetPage : targetPage + 1, // Alternate pages
            }));

            // Setup
            const annotationsMap = new Map<string, LatticeAnnotation[]>();
            annotationsMap.set(fileId, normalizedAnnotations);
            useAnnotationStore.setState({ annotations: annotationsMap });

            // Get annotations for target page
            const pageAnnotations = useAnnotationStore.getState().getAnnotationsForPage(fileId, targetPage);

            // Verify all returned annotations are on the target page
            for (const ann of pageAnnotations) {
              expect(ann.page).toBe(targetPage);
            }

            // Verify count matches expected
            const expectedCount = normalizedAnnotations.filter(a => a.page === targetPage).length;
            expect(pageAnnotations.length).toBe(expectedCount);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('setActiveFile updates activeFileId', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (fileId) => {
          useAnnotationStore.getState().setActiveFile(fileId);
          expect(useAnnotationStore.getState().activeFileId).toBe(fileId);

          useAnnotationStore.getState().setActiveFile(null);
          expect(useAnnotationStore.getState().activeFileId).toBe(null);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('clearError clears error state', () => {
      useAnnotationStore.setState({ error: 'Test error' });
      expect(useAnnotationStore.getState().error).toBe('Test error');

      useAnnotationStore.getState().clearError();
      expect(useAnnotationStore.getState().error).toBe(null);
    });
  });
});
