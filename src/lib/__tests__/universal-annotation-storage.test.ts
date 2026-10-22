/**
 * Property-based tests for universal annotation storage utilities
 * 
 * Feature: universal-annotation-manager
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  generateFileId,
  getAnnotationFilePath,
  serializeAnnotationFile,
  deserializeAnnotationFile,
  createUniversalAnnotationFile,
  detectFileType,
  ANNOTATIONS_DIR,
  loadAnnotationsForFileIdentity,
  loadAnnotationsFromDisk,
  moveAnnotationSidecar,
} from '../universal-annotation-storage';
import { resolveFileIdentity } from '../file-identity';
import { registerAnnotationLocation } from '../annotation-registry';
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
const filePathChars = fc.constantFrom<string>(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./'
);
const filePathArb: fc.Arbitrary<string> = fc
  .string({ unit: filePathChars, minLength: 1, maxLength: 100 })
  .filter((s: string) => s.trim().length > 0 && !s.match(/^[\/\-_\.]+$/));

const hexChars = '0123456789abcdef';
const hexa = (): fc.Arbitrary<string> =>
  fc.integer({ min: 0, max: 15 }).map((n) => hexChars[n]);
const hexaString = (constraints: Omit<fc.StringConstraints, 'unit'> = {}) =>
  fc.string({ ...constraints, unit: hexa() });

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
    hexaString({ minLength: 6, maxLength: 6 }).map((s: string) => `#${s}`)
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
  version: fc.constant(3 as const),
  documentId: fc.string({ minLength: 1, maxLength: 100 }),
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

  it('same filename in different directories produces different fileIds', () => {
    const first = generateFileId('papers/figure.png');
    const second = generateFileId('archive/figure.png');

    expect(first).not.toBe(second);
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
        
        expect(file.version).toBe(3);
        expect(file.documentId).toBe(fileId);
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

class NestedTestFileHandle {
  kind = 'file' as const;

  constructor(public name: string, private content: string) {}

  async getFile() {
    return new File([this.content], this.name, { lastModified: 1710000000000 });
  }

  async createWritable() {
    return {
      write: async (nextContent: string) => {
        this.content = typeof nextContent === "string" ? nextContent : this.content;
      },
      close: async () => undefined,
      abort: async () => undefined,
    } as unknown as FileSystemWritableFileStream;
  }
}

class NestedTestDirectoryHandle {
  kind = 'directory' as const;
  private readonly directories = new Map<string, NestedTestDirectoryHandle>();
  private readonly files = new Map<string, NestedTestFileHandle>();

  constructor(public name: string) {}

  addDirectory(dir: NestedTestDirectoryHandle) {
    this.directories.set(dir.name, dir);
    return dir;
  }

  addFile(file: NestedTestFileHandle) {
    this.files.set(file.name, file);
    return file;
  }

  async *values(): AsyncGenerator<NestedTestDirectoryHandle | NestedTestFileHandle> {
    for (const dir of this.directories.values()) {
      yield dir;
    }
    for (const file of this.files.values()) {
      yield file;
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) {
      return existing;
    }
    if (options?.create) {
      const created = new NestedTestDirectoryHandle(name);
      this.directories.set(name, created);
      return created;
    }
    throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) {
      return existing;
    }
    if (options?.create) {
      const created = new NestedTestFileHandle(name, '');
      this.files.set(name, created);
      return created;
    }
    throw new DOMException(`File not found: ${name}`, 'NotFoundError');
  }

  async removeEntry(name: string) {
    if (this.files.delete(name) || this.directories.delete(name)) {
      return;
    }
    throw new DOMException(`Entry not found: ${name}`, 'NotFoundError');
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }
}

describe('nested .lattice discovery', () => {
  function sidecar(id: string): string {
    return JSON.stringify({ ...createUniversalAnnotationFile('paper.pdf', 'pdf', id), annotations: [{ id, target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }] }, style: { type: 'highlight', color: '#FFD400' }, author: 'user', createdAt: 1 }] });
  }

  async function identityFor(path: string) {
    return resolveFileIdentity({ fileName: 'paper.pdf', filePath: path, workspaceIdentity: null });
  }

  it('recovers only the PDF ancestor workspace rather than an unrelated same-name document', async () => {
    const root = new NestedTestDirectoryHandle('scoped-root');
    const unrelated = root.addDirectory(new NestedTestDirectoryHandle('unrelated'));
    unrelated.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('wrong-document')));
    const relevant = root.addDirectory(new NestedTestDirectoryHandle('papers'));
    relevant.addFile(new NestedTestFileHandle('paper.pdf', 'synthetic pdf'));
    relevant.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('right-document')));
    const fileIdentity = await identityFor('scoped-root/papers/paper.pdf');
    const resolved = await loadAnnotationsForFileIdentity({ rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null, fileType: 'pdf' });
    expect(resolved.annotationFile.annotations.map((item) => item.id)).toEqual(['right-document']);
  });

  it('does not enumerate the workspace while looking for an unannotated PDF', async () => {
    const root = new NestedTestDirectoryHandle('no-scan-root');
    const relevant = root.addDirectory(new NestedTestDirectoryHandle('papers'));
    relevant.addFile(new NestedTestFileHandle('paper.pdf', 'synthetic pdf'));
    const enumerations = vi.spyOn(root, 'values');
    const childEnumerations = vi.spyOn(relevant, 'values');
    const fileIdentity = await identityFor('no-scan-root/papers/paper.pdf');
    const resolved = await loadAnnotationsForFileIdentity({ rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null, fileType: 'pdf' });
    expect(resolved.annotationFile.annotations).toEqual([]);
    expect(enumerations).not.toHaveBeenCalled();
    expect(childEnumerations).not.toHaveBeenCalled();
  });

  it('does not reuse a same-basename sidecar belonging to a PDF in the current root', async () => {
    const root = new NestedTestDirectoryHandle('ancestor-collision-root');
    root.addFile(new NestedTestFileHandle('paper.pdf', 'other synthetic pdf'));
    root.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('root-document')));
    const child = root.addDirectory(new NestedTestDirectoryHandle('papers'));
    child.addFile(new NestedTestFileHandle('paper.pdf', 'target synthetic pdf'));
    child.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('child-document')));
    const fileIdentity = await identityFor('ancestor-collision-root/papers/paper.pdf');
    const resolved = await loadAnnotationsForFileIdentity({ rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null, fileType: 'pdf' });
    expect(resolved.annotationFile.annotations.map((item) => item.id)).toEqual(['child-document']);
  });

  it('uses the file path relative to each nested workspace when recovering sidecars', async () => {
    const root = new NestedTestDirectoryHandle('nested-collision-root');
    const papers = root.addDirectory(new NestedTestDirectoryHandle('papers'));
    papers.addFile(new NestedTestFileHandle('paper.pdf', 'other synthetic pdf'));
    papers.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('ancestor-document')));
    const child = papers.addDirectory(new NestedTestDirectoryHandle('chapter'));
    child.addFile(new NestedTestFileHandle('paper.pdf', 'target synthetic pdf'));
    child.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('chapter-document')));
    const fileIdentity = await identityFor('nested-collision-root/papers/chapter/paper.pdf');
    const resolved = await loadAnnotationsForFileIdentity({ rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null, fileType: 'pdf' });
    expect(resolved.annotationFile.annotations.map((item) => item.id)).toEqual(['chapter-document']);
  });

  it('ignores a registry alias whose relative path resolves to another document in this root', async () => {
    const root = new NestedTestDirectoryHandle('registry-collision-root');
    root.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('unrelated-registry-document')));
    const child = root.addDirectory(new NestedTestDirectoryHandle('papers'));
    child.addFile(new NestedTestFileHandle('paper.pdf', 'target synthetic pdf'));
    child.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('expected-registry-document')));
    const fileIdentity = await identityFor('registry-collision-root/papers/paper.pdf');
    await registerAnnotationLocation({ documentId: 'expected-registry-document', alias: { sourcePath: '.lattice/annotations/paper.pdf.json', canonicalPath: fileIdentity.canonicalPath, relativePathFromRoot: fileIdentity.relativePathFromRoot, fileId: 'paper.pdf', workspaceKey: 'another-workspace', updatedAt: 1 } });
    const resolved = await loadAnnotationsForFileIdentity({ rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null, fileType: 'pdf' });
    expect(resolved.annotationFile.annotations.map((item) => item.id)).toEqual(['expected-registry-document']);
  });

  it.each(['permission', 'invalid JSON'])('rejects direct sidecar loading on %s failure', async (failure) => {
    const root = new NestedTestDirectoryHandle('direct-load-root');
    const annotations = root.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations'));
    const file = annotations.addFile(new NestedTestFileHandle('paper.pdf.json', '{broken'));
    if (failure === 'permission') vi.spyOn(file, 'getFile').mockRejectedValue(new DOMException('Access denied', 'NotAllowedError'));
    await expect(loadAnnotationsFromDisk('paper.pdf', root as unknown as FileSystemDirectoryHandle, 'pdf')).rejects.toThrow();
  });

  it('reports unreadable existing storage rather than returning a writable empty snapshot', async () => {
    const root = new NestedTestDirectoryHandle('denied-root');
    vi.spyOn(root, 'getDirectoryHandle').mockRejectedValue(new DOMException('Access denied', 'NotAllowedError'));
    const fileIdentity = await identityFor('denied-root/paper.pdf');
    await expect(loadAnnotationsForFileIdentity({ rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null })).rejects.toThrow('Access denied');
  });

  it('reports malformed sidecars instead of treating them as absent', async () => {
    const root = new NestedTestDirectoryHandle('corrupt-root');
    root.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations')).addFile(new NestedTestFileHandle('corrupt-root-paper.pdf.json', '{broken'));
    const fileIdentity = await identityFor('corrupt-root/paper.pdf');
    await expect(loadAnnotationsForFileIdentity({ rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null })).rejects.toThrow();
  });

  it('does not mirror a legacy sidecar when restoration is cancelled during its read', async () => {
    const root = new NestedTestDirectoryHandle('cancelled-root');
    const annotations = root.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations'));
    const legacy = annotations.addFile(new NestedTestFileHandle('paper.pdf.json', sidecar('cancelled-document')));
    let finishRead!: (file: File) => void;
    vi.spyOn(legacy, 'getFile').mockImplementationOnce(() => new Promise<File>((resolve) => { finishRead = resolve; }));
    const fileIdentity = await identityFor('cancelled-root/paper.pdf');
    const controller = new AbortController();
    const input = { rootHandle: root as unknown as FileSystemDirectoryHandle, fileIdentity, workspaceKey: null, signal: controller.signal };
    const pending = loadAnnotationsForFileIdentity(input);
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'));
    controller.abort();
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    finishRead(new File([sidecar('cancelled-document')], 'paper.pdf.json'));
    await assertion;
    await expect(annotations.getFileHandle('cancelled-root-paper.pdf.json')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('loads annotations from a nested child workspace and mirrors them into the current root', async () => {
    const root = new NestedTestDirectoryHandle('Course');
    const child = root.addDirectory(new NestedTestDirectoryHandle('选修'));
    const subRoot = child.addDirectory(new NestedTestDirectoryHandle('概统'));
    const pdfHandle = subRoot.addFile(new NestedTestFileHandle('讲义.pdf', 'pdf'));
    const latticeDir = subRoot.addDirectory(new NestedTestDirectoryHandle('.lattice'));
    const annotationsDir = latticeDir.addDirectory(new NestedTestDirectoryHandle('annotations'));
    annotationsDir.addFile(new NestedTestFileHandle(
      `${generateFileId('概统/讲义.pdf')}.json`,
      JSON.stringify({
        version: 2,
        fileId: generateFileId('概统/讲义.pdf'),
        fileType: 'pdf',
        annotations: [
          {
            id: 'ann-1',
            target: {
              type: 'pdf',
              page: 1,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }],
            },
            style: { color: '#FFEB3B', type: 'highlight' },
            author: 'user',
            createdAt: 1710000000000,
          },
        ],
        lastModified: 1710000000000,
      }),
    ));

    const fileIdentity = await resolveFileIdentity({
      fileHandle: pdfHandle as unknown as FileSystemFileHandle,
      fileName: '讲义.pdf',
      filePath: 'Course/选修/概统/讲义.pdf',
      workspaceIdentity: {
        workspaceKey: 'web:course',
        displayPath: 'Course',
        rootName: 'Course',
        hostKind: 'web',
        handleFingerprint: null,
        lastUsedAt: Date.now(),
      },
    });

    const resolved = await loadAnnotationsForFileIdentity({
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      fileIdentity,
      workspaceKey: 'web:course',
      fileType: 'pdf',
    });

    expect(resolved.annotationFile.annotations).toHaveLength(1);

    const mirrored = await root.getDirectoryHandle('.lattice').then((dir) => dir.getDirectoryHandle('annotations')).then((dir) => dir.getFileHandle(`${fileIdentity.primaryFileId}.json`));
    const mirroredContent = await (await mirrored.getFile()).text();
    const parsedMirrored = deserializeAnnotationFile(mirroredContent);
    expect(parsedMirrored?.annotations).toHaveLength(1);
  });
});

describe('annotation sidecar moves', () => {
  it('does not remove a different root-level PDF sidecar when renaming a nested same-name PDF', async () => {
    const root = new NestedTestDirectoryHandle('root');
    const annotations = root.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations'));
    const sourceId = generateFileId('root/folder/paper.pdf');
    annotations.addFile(new NestedTestFileHandle(`${sourceId}.json`, serializeAnnotationFile(createUniversalAnnotationFile(sourceId, 'pdf', 'nested-document'))));
    annotations.addFile(new NestedTestFileHandle('paper.pdf.json', serializeAnnotationFile(createUniversalAnnotationFile('paper.pdf', 'pdf', 'unrelated-document'))));
    await moveAnnotationSidecar(root as unknown as FileSystemDirectoryHandle, 'root/folder/paper.pdf', 'root/folder/renamed.pdf', 'pdf');
    const unrelated = deserializeAnnotationFile(await (await (await annotations.getFileHandle('paper.pdf.json')).getFile()).text());
    expect(unrelated?.documentId).toBe('unrelated-document');
  });

  it('keeps the old sidecar when the new path cannot be written', async () => {
    const root = new NestedTestDirectoryHandle('root');
    const annotations = root.addDirectory(new NestedTestDirectoryHandle('.lattice')).addDirectory(new NestedTestDirectoryHandle('annotations'));
    const sourceId = generateFileId('root/folder/paper.pdf'), targetId = generateFileId('root/folder/renamed.pdf');
    annotations.addFile(new NestedTestFileHandle(`${sourceId}.json`, serializeAnnotationFile(createUniversalAnnotationFile(sourceId, 'pdf', 'retained-document'))));
    const original = annotations.getFileHandle.bind(annotations);
    vi.spyOn(annotations, 'getFileHandle').mockImplementation(async (name, options) => {
      if (name === `${targetId}.json`) throw new DOMException('Permission denied', 'NotAllowedError');
      return original(name, options);
    });
    await expect(moveAnnotationSidecar(root as unknown as FileSystemDirectoryHandle, 'root/folder/paper.pdf', 'root/folder/renamed.pdf', 'pdf')).rejects.toThrow();
    await expect(annotations.getFileHandle(`${sourceId}.json`)).resolves.toBeDefined();
  });
  it('moves annotation sidecars to the new file id on rename', async () => {
    const root = new NestedTestDirectoryHandle('Course');
    const latticeDir = root.addDirectory(new NestedTestDirectoryHandle('.lattice'));
    const annotationsDir = latticeDir.addDirectory(new NestedTestDirectoryHandle('annotations'));
    const oldFileId = generateFileId('Course/notes/original.pdf');
    const newFileId = generateFileId('Course/notes/renamed.pdf');

    annotationsDir.addFile(new NestedTestFileHandle(
      `${oldFileId}.json`,
      JSON.stringify({
        version: 3,
        documentId: oldFileId,
        fileId: oldFileId,
        fileType: 'pdf',
        annotations: [
          {
            id: 'ann-1',
            target: {
              type: 'pdf',
              page: 1,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }],
            },
            style: { color: '#FFEB3B', type: 'highlight' },
            author: 'user',
            createdAt: 1710000000000,
          },
        ],
        lastModified: 1710000000000,
      }),
    ));

    await moveAnnotationSidecar(
      root as unknown as FileSystemDirectoryHandle,
      'Course/notes/original.pdf',
      'Course/notes/renamed.pdf',
      'pdf',
    );

    await expect(annotationsDir.getFileHandle(`${oldFileId}.json`)).rejects.toThrow();
    const renamedHandle = await annotationsDir.getFileHandle(`${newFileId}.json`);
    const parsed = deserializeAnnotationFile(await (await renamedHandle.getFile()).text());
    expect(parsed?.fileId).toBe(newFileId);
    expect(parsed?.annotations).toHaveLength(1);
  });
});
