/**
 * Property-based tests for annotation storage utilities
 * 
 * Feature: pdf-annotation-engine
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  deriveFileId,
  serializeAnnotationFile,
  deserializeAnnotationFile,
  deserializeAnnotationFileWithValidation,
} from '../annotation-storage';
import { createAnnotationFile, createAnnotation } from '../annotation-utils';
import type { AnnotationFile, LatticeAnnotation, BoundingRect } from '../../types/annotation';
import { ANNOTATION_COLORS, ANNOTATION_TYPES } from '../../types/annotation';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for valid file paths
 */
const filePathArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./'
  ),
  { minLength: 1, maxLength: 100 }
).filter(s => s.trim().length > 0 && !s.match(/^[\/\-_\.]+$/));

/**
 * Generator for valid normalized coordinates
 */
const normalizedCoord = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Generator for valid BoundingRect
 */
const boundingRectArb: fc.Arbitrary<BoundingRect> = fc.record({
  x1: normalizedCoord,
  y1: normalizedCoord,
  x2: normalizedCoord,
  y2: normalizedCoord,
  width: fc.double({ min: 1, max: 10000, noNaN: true }),
  height: fc.double({ min: 1, max: 10000, noNaN: true }),
});

/**
 * Generator for valid LatticeAnnotation
 */
const latticeAnnotationArb: fc.Arbitrary<LatticeAnnotation> = fc.record({
  id: fc.uuid(),
  fileId: fc.string({ minLength: 1 }),
  page: fc.integer({ min: 1, max: 10000 }),
  position: fc.record({
    boundingRect: boundingRectArb,
    rects: fc.array(boundingRectArb, { minLength: 0, maxLength: 5 }),
  }),
  content: fc.record({
    text: fc.option(fc.string(), { nil: undefined }),
    image: fc.option(fc.string(), { nil: undefined }),
  }),
  comment: fc.string(),
  color: fc.constantFrom(...ANNOTATION_COLORS),
  timestamp: fc.integer({ min: 0 }),
  type: fc.constantFrom(...ANNOTATION_TYPES),
});

/**
 * Generator for valid AnnotationFile
 */
const annotationFileArb: fc.Arbitrary<AnnotationFile> = fc.record({
  version: fc.constant(1 as const),
  fileId: fc.string({ minLength: 1 }),
  annotations: fc.array(latticeAnnotationArb, { minLength: 0, maxLength: 10 }),
  lastModified: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 4: FileId Derivation Consistency
// Feature: pdf-annotation-engine, Property 4: FileId Derivation Consistency
// Validates: Requirements 2.4
// ============================================================================

describe('Property 4: FileId Derivation Consistency', () => {
  it('same input path always produces same fileId', () => {
    fc.assert(
      fc.property(filePathArb, (path) => {
        const fileId1 = deriveFileId(path);
        const fileId2 = deriveFileId(path);
        
        expect(fileId1).toBe(fileId2);
      }),
      { numRuns: 100 }
    );
  });

  it('derived fileId contains no invalid filename characters', () => {
    fc.assert(
      fc.property(filePathArb, (path) => {
        const fileId = deriveFileId(path);
        
        // Check for invalid filename characters
        const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
        expect(fileId).not.toMatch(invalidChars);
      }),
      { numRuns: 100 }
    );
  });

  it('derived fileId is non-empty for valid paths', () => {
    fc.assert(
      fc.property(filePathArb, (path) => {
        const fileId = deriveFileId(path);
        
        expect(fileId.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('throws for empty paths', () => {
    expect(() => deriveFileId('')).toThrow('File path cannot be empty');
    expect(() => deriveFileId('   ')).toThrow('File path cannot be empty');
  });

  it('handles various path formats consistently', () => {
    // Unix-style paths
    const unixPath = 'documents/papers/research.pdf';
    const unixId = deriveFileId(unixPath);
    expect(unixId).toBe('documents-papers-research.pdf');

    // Windows-style paths
    const windowsPath = 'documents\\papers\\research.pdf';
    const windowsId = deriveFileId(windowsPath);
    expect(windowsId).toBe('documents-papers-research.pdf');

    // Path with spaces
    const spacePath = 'my documents/my paper.pdf';
    const spaceId = deriveFileId(spacePath);
    expect(spaceId).toBe('my_documents-my_paper.pdf');
  });
});

// ============================================================================
// Property 3: Annotation Serialization Round-Trip
// Feature: pdf-annotation-engine, Property 3: Annotation Serialization Round-Trip
// Validates: Requirements 2.1, 2.5
// ============================================================================

describe('Property 3: Annotation Serialization Round-Trip', () => {
  it('valid AnnotationFile survives serialization round-trip', () => {
    fc.assert(
      fc.property(annotationFileArb, (file) => {
        const serialized = serializeAnnotationFile(file);
        const deserialized = deserializeAnnotationFile(serialized);
        
        expect(deserialized).not.toBeNull();
        expect(deserialized?.version).toBe(file.version);
        expect(deserialized?.fileId).toBe(file.fileId);
        expect(deserialized?.annotations.length).toBe(file.annotations.length);
        expect(deserialized?.lastModified).toBe(file.lastModified);
      }),
      { numRuns: 100 }
    );
  });

  it('annotations preserve all fields through round-trip', () => {
    fc.assert(
      fc.property(annotationFileArb, (file) => {
        const serialized = serializeAnnotationFile(file);
        const deserialized = deserializeAnnotationFile(serialized);
        
        expect(deserialized).not.toBeNull();
        
        for (let i = 0; i < file.annotations.length; i++) {
          const original = file.annotations[i];
          const restored = deserialized!.annotations[i];
          
          expect(restored.id).toBe(original.id);
          expect(restored.fileId).toBe(original.fileId);
          expect(restored.page).toBe(original.page);
          expect(restored.comment).toBe(original.comment);
          expect(restored.color).toBe(original.color);
          expect(restored.timestamp).toBe(original.timestamp);
          expect(restored.type).toBe(original.type);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('invalid JSON returns null', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => {
          try {
            JSON.parse(s);
            return false; // Valid JSON, skip
          } catch {
            return true; // Invalid JSON, keep
          }
        }),
        (invalidJson) => {
          const result = deserializeAnnotationFile(invalidJson);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('malformed annotation file returns null', () => {
    // Valid JSON but wrong structure
    const malformedCases = [
      '{}',
      '{"version": 2}', // Wrong version
      '{"version": 1, "fileId": "test"}', // Missing annotations
      '{"version": 1, "fileId": "test", "annotations": "not-array"}', // Wrong type
      '{"version": 1, "fileId": "test", "annotations": [{"invalid": true}]}', // Invalid annotation
    ];

    for (const malformed of malformedCases) {
      const result = deserializeAnnotationFile(malformed);
      expect(result).toBeNull();
    }
  });

  it('deserializeAnnotationFileWithValidation provides error details', () => {
    const malformed = '{"version": 2, "fileId": "test", "annotations": [], "lastModified": 123}';
    const result = deserializeAnnotationFileWithValidation(malformed);
    
    expect(result.file).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });
});

// ============================================================================
// Factory Function Integration Tests
// ============================================================================

describe('Storage Integration', () => {
  it('createAnnotationFile produces serializable files', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (fileId) => {
        const file = createAnnotationFile(fileId);
        const serialized = serializeAnnotationFile(file);
        const deserialized = deserializeAnnotationFile(serialized);
        
        expect(deserialized).not.toBeNull();
        expect(deserialized?.fileId).toBe(fileId);
        expect(deserialized?.annotations).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('createAnnotation produces annotations that serialize correctly', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 100 }),
        boundingRectArb,
        fc.constantFrom(...ANNOTATION_COLORS),
        fc.constantFrom(...ANNOTATION_TYPES),
        (fileId, page, boundingRect, color, type) => {
          const annotation = createAnnotation({
            fileId,
            page,
            position: { boundingRect, rects: [boundingRect] },
            content: { text: 'test content' },
            color,
            type,
          });
          
          const file: AnnotationFile = {
            version: 1,
            fileId,
            annotations: [annotation],
            lastModified: Date.now(),
          };
          
          const serialized = serializeAnnotationFile(file);
          const deserialized = deserializeAnnotationFile(serialized);
          
          expect(deserialized).not.toBeNull();
          expect(deserialized?.annotations[0].id).toBe(annotation.id);
          expect(deserialized?.annotations[0].color).toBe(color);
          expect(deserialized?.annotations[0].type).toBe(type);
        }
      ),
      { numRuns: 100 }
    );
  });
});
