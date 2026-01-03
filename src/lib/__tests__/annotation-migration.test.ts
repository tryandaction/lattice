/**
 * Property-based tests for annotation migration utilities
 * 
 * Feature: universal-annotation-manager
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  isLegacyAnnotationFile,
  migrateLegacyAnnotation,
  migrateLegacyAnnotationFile,
  tryMigrateLegacyJson,
} from '../annotation-migration';
import type { LatticeAnnotation, AnnotationFile, BoundingRect } from '../../types/annotation';
import { ANNOTATION_COLORS, ANNOTATION_TYPES } from '../../types/annotation';
import { isAnnotationItem, isPdfTarget } from '../../types/universal-annotation';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for valid BoundingRect (legacy format)
 */
const boundingRectArb: fc.Arbitrary<BoundingRect> = fc.record({
  x1: fc.double({ min: 0, max: 1, noNaN: true }),
  y1: fc.double({ min: 0, max: 1, noNaN: true }),
  x2: fc.double({ min: 0, max: 1, noNaN: true }),
  y2: fc.double({ min: 0, max: 1, noNaN: true }),
  width: fc.double({ min: 1, max: 10000, noNaN: true }),
  height: fc.double({ min: 1, max: 10000, noNaN: true }),
});

/**
 * Generator for valid LatticeAnnotation (legacy format)
 */
const latticeAnnotationArb: fc.Arbitrary<LatticeAnnotation> = fc.record({
  id: fc.uuid(),
  fileId: fc.string({ minLength: 1, maxLength: 100 }),
  page: fc.integer({ min: 1, max: 10000 }),
  position: fc.record({
    boundingRect: boundingRectArb,
    rects: fc.array(boundingRectArb, { minLength: 1, maxLength: 5 }),
  }),
  content: fc.record({
    text: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
    image: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  }),
  comment: fc.string({ maxLength: 200 }),
  color: fc.constantFrom(...ANNOTATION_COLORS),
  timestamp: fc.integer({ min: 0 }),
  type: fc.constantFrom(...ANNOTATION_TYPES),
});

/**
 * Generator for valid AnnotationFile (legacy format)
 */
const annotationFileArb: fc.Arbitrary<AnnotationFile> = fc.record({
  version: fc.constant(1 as const),
  fileId: fc.string({ minLength: 1, maxLength: 100 }),
  annotations: fc.array(latticeAnnotationArb, { minLength: 0, maxLength: 10 }),
  lastModified: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 5: Legacy Migration Round-Trip
// Feature: universal-annotation-manager, Property 5: Legacy Migration Round-Trip
// Validates: Requirements 7.1, 7.2, 7.3, 7.4
// ============================================================================

describe('Property 5: Legacy Migration Round-Trip', () => {
  describe('isLegacyAnnotationFile', () => {
    it('correctly identifies legacy annotation files', () => {
      fc.assert(
        fc.property(annotationFileArb, (file) => {
          expect(isLegacyAnnotationFile(file)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('rejects non-legacy formats', () => {
      const nonLegacyFormats = [
        { version: 2, fileId: 'test', fileType: 'pdf', annotations: [], lastModified: 123 },
        { version: 3, fileId: 'test', annotations: [], lastModified: 123 },
        null,
        undefined,
        'string',
        123,
        [],
      ];

      for (const format of nonLegacyFormats) {
        expect(isLegacyAnnotationFile(format)).toBe(false);
      }
    });
  });

  describe('migrateLegacyAnnotation', () => {
    it('preserves annotation ID', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          expect(migrated.id).toBe(legacy.id);
        }),
        { numRuns: 100 }
      );
    });

    it('preserves timestamp as createdAt', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          expect(migrated.createdAt).toBe(legacy.timestamp);
        }),
        { numRuns: 100 }
      );
    });

    it('preserves color in style', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          expect(migrated.style.color).toBe(legacy.color);
        }),
        { numRuns: 100 }
      );
    });

    it('preserves text content', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          if (legacy.content.text) {
            expect(migrated.content).toBe(legacy.content.text);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('preserves comment', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          if (legacy.comment && legacy.comment.length > 0) {
            expect(migrated.comment).toBe(legacy.comment);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('creates valid PDF target', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          expect(isPdfTarget(migrated.target)).toBe(true);
          expect(migrated.target.type).toBe('pdf');
          
          if (migrated.target.type === 'pdf') {
            expect(migrated.target.page).toBe(legacy.page);
            expect(migrated.target.rects.length).toBe(legacy.position.rects.length);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('maps legacy type to style type correctly', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          
          if (legacy.type === 'text') {
            expect(migrated.style.type).toBe('highlight');
          } else if (legacy.type === 'area') {
            expect(migrated.style.type).toBe('area');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('produces valid AnnotationItem', () => {
      fc.assert(
        fc.property(latticeAnnotationArb, (legacy) => {
          const migrated = migrateLegacyAnnotation(legacy);
          expect(isAnnotationItem(migrated)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('migrateLegacyAnnotationFile', () => {
    it('preserves fileId', () => {
      fc.assert(
        fc.property(annotationFileArb, (legacyFile) => {
          const migrated = migrateLegacyAnnotationFile(legacyFile);
          expect(migrated.fileId).toBe(legacyFile.fileId);
        }),
        { numRuns: 100 }
      );
    });

    it('sets version to 2', () => {
      fc.assert(
        fc.property(annotationFileArb, (legacyFile) => {
          const migrated = migrateLegacyAnnotationFile(legacyFile);
          expect(migrated.version).toBe(2);
        }),
        { numRuns: 100 }
      );
    });

    it('sets fileType to pdf', () => {
      fc.assert(
        fc.property(annotationFileArb, (legacyFile) => {
          const migrated = migrateLegacyAnnotationFile(legacyFile);
          expect(migrated.fileType).toBe('pdf');
        }),
        { numRuns: 100 }
      );
    });

    it('preserves lastModified', () => {
      fc.assert(
        fc.property(annotationFileArb, (legacyFile) => {
          const migrated = migrateLegacyAnnotationFile(legacyFile);
          expect(migrated.lastModified).toBe(legacyFile.lastModified);
        }),
        { numRuns: 100 }
      );
    });

    it('migrates all annotations', () => {
      fc.assert(
        fc.property(annotationFileArb, (legacyFile) => {
          const migrated = migrateLegacyAnnotationFile(legacyFile);
          expect(migrated.annotations.length).toBe(legacyFile.annotations.length);
          
          for (const annotation of migrated.annotations) {
            expect(isAnnotationItem(annotation)).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('tryMigrateLegacyJson', () => {
    it('migrates valid legacy JSON', () => {
      fc.assert(
        fc.property(annotationFileArb, (legacyFile) => {
          const json = JSON.stringify(legacyFile);
          const migrated = tryMigrateLegacyJson(json);
          
          expect(migrated).not.toBeNull();
          expect(migrated?.version).toBe(2);
          expect(migrated?.fileId).toBe(legacyFile.fileId);
        }),
        { numRuns: 100 }
      );
    });

    it('returns null for invalid JSON', () => {
      expect(tryMigrateLegacyJson('not valid json')).toBeNull();
      expect(tryMigrateLegacyJson('{incomplete')).toBeNull();
    });

    it('returns null for non-legacy format', () => {
      const v2File = {
        version: 2,
        fileId: 'test',
        fileType: 'pdf',
        annotations: [],
        lastModified: 123,
      };
      expect(tryMigrateLegacyJson(JSON.stringify(v2File))).toBeNull();
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Migration Edge Cases', () => {
  it('handles empty annotations array', () => {
    const emptyFile: AnnotationFile = {
      version: 1,
      fileId: 'test-file',
      annotations: [],
      lastModified: Date.now(),
    };
    
    const migrated = migrateLegacyAnnotationFile(emptyFile);
    expect(migrated.annotations).toHaveLength(0);
    expect(migrated.version).toBe(2);
  });

  it('handles annotation with empty comment', () => {
    const annotation: LatticeAnnotation = {
      id: 'test-id',
      fileId: 'test-file',
      page: 1,
      position: {
        boundingRect: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.2, width: 100, height: 50 },
        rects: [{ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.2, width: 100, height: 50 }],
      },
      content: { text: 'Test content' },
      comment: '',
      color: 'yellow',
      timestamp: Date.now(),
      type: 'text',
    };
    
    const migrated = migrateLegacyAnnotation(annotation);
    expect(migrated.comment).toBeUndefined();
  });

  it('handles annotation with no text content', () => {
    const annotation: LatticeAnnotation = {
      id: 'test-id',
      fileId: 'test-file',
      page: 1,
      position: {
        boundingRect: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.2, width: 100, height: 50 },
        rects: [{ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.2, width: 100, height: 50 }],
      },
      content: {},
      comment: 'A note',
      color: 'blue',
      timestamp: Date.now(),
      type: 'area',
    };
    
    const migrated = migrateLegacyAnnotation(annotation);
    expect(migrated.content).toBeUndefined();
    expect(migrated.comment).toBe('A note');
  });

  it('converts bounding rects correctly', () => {
    const annotation: LatticeAnnotation = {
      id: 'test-id',
      fileId: 'test-file',
      page: 5,
      position: {
        boundingRect: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9, width: 800, height: 600 },
        rects: [
          { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.3, width: 800, height: 600 },
          { x1: 0.5, y1: 0.2, x2: 0.8, y2: 0.3, width: 800, height: 600 },
        ],
      },
      content: { text: 'Multi-line selection' },
      comment: '',
      color: 'green',
      timestamp: Date.now(),
      type: 'text',
    };
    
    const migrated = migrateLegacyAnnotation(annotation);
    
    expect(migrated.target.type).toBe('pdf');
    if (migrated.target.type === 'pdf') {
      expect(migrated.target.page).toBe(5);
      expect(migrated.target.rects).toHaveLength(2);
      
      // Check that width/height are stripped (new format only has coordinates)
      expect(migrated.target.rects[0]).toEqual({ x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.3 });
      expect(migrated.target.rects[1]).toEqual({ x1: 0.5, y1: 0.2, x2: 0.8, y2: 0.3 });
    }
  });
});
