/**
 * Property-based tests for universal annotation storage utilities
 * 
 * Feature: universal-annotation-manager
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generateFileId,
  getAnnotationFilePath,
  serializeAnnotationFile,
  deserializeAnnotationFile,
  createUniversalAnnotationFile,
  detectFileType,
  ANNOTATIONS_DIR,
} from '../universal-annotation-storage';
import type { 
  UniversalAnnotationFile, 
  AnnotationItem,
  PdfTarget,
  ImageTarget,
  CodeLineTarget,
  TextAnchorTarget,
} from '../../types/universal-annotation';
import { ANNOTATION_STYLE_TYPES } from '../../types/universal-annotation';

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
 * Generator for valid BoundingBox
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
  page: fc.integer({ min: 1, max: 10000 }),
  rects: fc.array(boundingBoxArb, { minLength: 0, maxLength: 5 }),
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
  line: fc.integer({ min: 1, max: 100000 }),
});

/**
 * Generator for TextAnchorTarget
 */
const textAnchorTargetArb: fc.Arbitrary<TextAnchorTarget> = fc.record({
  type: fc.constant('text_anchor' as const),
  elementId: fc.string({ minLength: 1, maxLength: 50 }),
  offset: fc.integer({ min: 0, max: 10000 }),
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
  color: fc.oneof(
    fc.constantFrom('yellow', 'red', 'green', 'blue'),
    fc.hexaString({ minLength: 6, maxLength: 6 }).map(s => `#${s}`)
  ),
  type: fc.constantFrom(...ANNOTATION_STYLE_TYPES),
});

/**
 * Generator for AnnotationItem
 */
const annotationItemArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: annotationTargetArb,
  style: annotationStyleArb,
  content: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  comment: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 50 }),
  createdAt: fc.integer({ min: 0 }),
});

/**
 * Generator for UniversalAnnotationFile
 */
const universalAnnotationFileArb: fc.Arbitrary<UniversalAnnotationFile> = fc.record({
  version: fc.constant(2 as const),
  fileId: fc.string({ minLength: 1, maxLength: 100 }),
  fileType: fc.constantFrom('pdf', 'image', 'pptx', 'code', 'html', 'unknown'),
  annotations: fc.array(annotationItemArb, { minLength: 0, maxLength: 10 }),
  lastModified: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 2: File Identifier Determinism
// Feature: universal-annotation-manager, Property 2: File Identifier Determinism
// Validates: Requirements 2.1, 2.3
// ============================================================================

describe('Property 2: File Identifier Determinism', () => {
  it('same input path always produces same fileId', () => {
    fc.assert(
      fc.property(filePathArb, (path) => {
        const fileId1 = generateFileId(path);
        const fileId2 = generateFileId(path);
        
        expect(fileId1).toBe(fileId2);
      }),
      { numRuns: 100 }
    );
  });

  it('derived fileId contains no invalid filename characters', () => {
    fc.assert(
      fc.property(filePathArb, (path) => {
        const fileId = generateFileId(path);
        
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
        const fileId = generateFileId(path);
        
        expect(fileId.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('getAnnotationFilePath produces valid path', () => {
    fc.assert(
      fc.property(filePathArb, (path) => {
        const fileId = generateFileId(path);
        const annotationPath = getAnnotationFilePath(fileId);
        
        expect(annotationPath).toBe(`${ANNOTATIONS_DIR}/${fileId}.json`);
        expect(annotationPath).toContain('.lattice/annotations/');
        expect(annotationPath.endsWith('.json')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('throws for empty paths', () => {
    expect(() => generateFileId('')).toThrow('File path cannot be empty');
    expect(() => generateFileId('   ')).toThrow('File path cannot be empty');
  });

  it('handles various path formats consistently', () => {
    // Unix-style paths
    const unixPath = 'documents/papers/research.pdf';
    const unixId = generateFileId(unixPath);
    expect(unixId).toBe('documents-papers-research.pdf');

    // Windows-style paths
    const windowsPath = 'documents\\papers\\research.pdf';
    const windowsId = generateFileId(windowsPath);
    expect(windowsId).toBe('documents-papers-research.pdf');

    // Path with spaces
    const spacePath = 'my documents/my paper.pdf';
    const spaceId = generateFileId(spacePath);
    expect(spaceId).toBe('my_documents-my_paper.pdf');
  });
});

// ============================================================================
// Property 3: Serialization Round-Trip
// Feature: universal-annotation-manager, Property 3: Serialization Round-Trip
// Validates: Requirements 3.4, 8.3
// ============================================================================

describe('Property 3: Serialization Round-Trip', () => {
  it('valid UniversalAnnotationFile survives serialization round-trip', () => {
    fc.assert(
      fc.property(universalAnnotationFileArb, (file) => {
        const serialized = serializeAnnotationFile(file);
        const deserialized = deserializeAnnotationFile(serialized);
        
        expect(deserialized).not.toBeNull();
        expect(deserialized?.version).toBe(file.version);
        expect(deserialized?.fileId).toBe(file.fileId);
        expect(deserialized?.fileType).toBe(file.fileType);
        expect(deserialized?.annotations.length).toBe(file.annotations.length);
        expect(deserialized?.lastModified).toBe(file.lastModified);
      }),
      { numRuns: 100 }
    );
  });

  it('annotations preserve all fields through round-trip', () => {
    fc.assert(
      fc.property(universalAnnotationFileArb, (file) => {
        const serialized = serializeAnnotationFile(file);
        const deserialized = deserializeAnnotationFile(serialized);
        
        expect(deserialized).not.toBeNull();
        
        for (let i = 0; i < file.annotations.length; i++) {
          const original = file.annotations[i];
          const restored = deserialized!.annotations[i];
          
          expect(restored.id).toBe(original.id);
          expect(restored.target.type).toBe(original.target.type);
          expect(restored.style.color).toBe(original.style.color);
          expect(restored.style.type).toBe(original.style.type);
          expect(restored.author).toBe(original.author);
          expect(restored.createdAt).toBe(original.createdAt);
          expect(restored.content).toBe(original.content);
          expect(restored.comment).toBe(original.comment);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('target-specific fields are preserved through round-trip', () => {
    fc.assert(
      fc.property(universalAnnotationFileArb, (file) => {
        const serialized = serializeAnnotationFile(file);
        const deserialized = deserializeAnnotationFile(serialized);
        
        expect(deserialized).not.toBeNull();
        
        for (let i = 0; i < file.annotations.length; i++) {
          const original = file.annotations[i];
          const restored = deserialized!.annotations[i];
          
          switch (original.target.type) {
            case 'pdf':
              expect((restored.target as PdfTarget).page).toBe(original.target.page);
              expect((restored.target as PdfTarget).rects.length).toBe(original.target.rects.length);
              break;
            case 'image':
              expect((restored.target as ImageTarget).x).toBe(original.target.x);
              expect((restored.target as ImageTarget).y).toBe(original.target.y);
              expect((restored.target as ImageTarget).width).toBe(original.target.width);
              expect((restored.target as ImageTarget).height).toBe(original.target.height);
              break;
            case 'code_line':
              expect((restored.target as CodeLineTarget).line).toBe(original.target.line);
              break;
            case 'text_anchor':
              expect((restored.target as TextAnchorTarget).elementId).toBe(original.target.elementId);
              expect((restored.target as TextAnchorTarget).offset).toBe(original.target.offset);
              break;
          }
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
            return false;
          } catch {
            return true;
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
    const malformedCases = [
      '{}',
      '{"version": 1}', // Wrong version
      '{"version": 2, "fileId": "test"}', // Missing fields
      '{"version": 2, "fileId": "test", "fileType": "pdf", "annotations": "not-array", "lastModified": 123}',
    ];

    for (const malformed of malformedCases) {
      const result = deserializeAnnotationFile(malformed);
      expect(result).toBeNull();
    }
  });
});

// ============================================================================
// File Type Detection Tests
// ============================================================================

describe('File Type Detection', () => {
  it('detects PDF files', () => {
    expect(detectFileType('document.pdf')).toBe('pdf');
    expect(detectFileType('path/to/file.PDF')).toBe('pdf');
  });

  it('detects image files', () => {
    expect(detectFileType('image.png')).toBe('image');
    expect(detectFileType('photo.jpg')).toBe('image');
    expect(detectFileType('photo.jpeg')).toBe('image');
    expect(detectFileType('animation.gif')).toBe('image');
    expect(detectFileType('modern.webp')).toBe('image');
  });

  it('detects code files', () => {
    expect(detectFileType('script.js')).toBe('code');
    expect(detectFileType('component.tsx')).toBe('code');
    expect(detectFileType('main.py')).toBe('code');
    expect(detectFileType('config.json')).toBe('code');
    expect(detectFileType('styles.css')).toBe('code');
  });

  it('detects PPTX files', () => {
    expect(detectFileType('presentation.pptx')).toBe('pptx');
    expect(detectFileType('slides.ppt')).toBe('pptx');
  });

  it('detects HTML files', () => {
    expect(detectFileType('page.html')).toBe('html');
    expect(detectFileType('index.htm')).toBe('html');
  });

  it('returns unknown for unrecognized extensions', () => {
    expect(detectFileType('file.xyz')).toBe('unknown');
    expect(detectFileType('noextension')).toBe('unknown');
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createUniversalAnnotationFile', () => {
  it('creates valid empty annotation file', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (fileId) => {
        const file = createUniversalAnnotationFile(fileId);
        
        expect(file.version).toBe(2);
        expect(file.fileId).toBe(fileId);
        expect(file.fileType).toBe('unknown');
        expect(file.annotations).toHaveLength(0);
        expect(typeof file.lastModified).toBe('number');
      }),
      { numRuns: 100 }
    );
  });

  it('respects provided file type', () => {
    const file = createUniversalAnnotationFile('test', 'pdf');
    expect(file.fileType).toBe('pdf');
  });

  it('created files serialize correctly', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (fileId) => {
        const file = createUniversalAnnotationFile(fileId);
        const serialized = serializeAnnotationFile(file);
        const deserialized = deserializeAnnotationFile(serialized);
        
        expect(deserialized).not.toBeNull();
        expect(deserialized?.fileId).toBe(fileId);
      }),
      { numRuns: 100 }
    );
  });
});
