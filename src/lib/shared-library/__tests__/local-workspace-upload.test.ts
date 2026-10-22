import { beforeEach, describe, expect, it } from 'vitest';
import { collectLocalPdfUploadBundle, uploadLocalWorkspaceEntries } from '../local-workspace-upload';
import { SourceTestDirectory, SourceTestFile } from '@/lib/ai/__tests__/fixtures/source-workspace';
import { buildFileFingerprint } from '@/lib/file-identity';
import { getDefaultPdfItemFolderPath } from '@/lib/pdf-item';
import type { Item, Annotation } from '../domain';
import type { CreateAnnotationInput } from '../repository';
import type { SharedLibraryItemContent } from '../content-store';
import { registerAnnotationLocation, saveAnnotationRegistry } from '@/lib/annotation-registry';
import { generateFileId } from '@/lib/universal-annotation-storage';

async function fixture() {
  const root = new SourceTestDirectory('workspace');
  const pdf = root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('paper.pdf', '%PDF-fixture-only', 123));
  const pdfHandle = pdf as unknown as FileSystemFileHandle;
  const fingerprint = await buildFileFingerprint(pdfHandle);
  const folderPath = getDefaultPdfItemFolderPath('papers/paper.pdf');
  let folder = root;
  for (const segment of folderPath.split('/')) folder = await folder.getDirectoryHandle(segment, { create: true });
  const manifest = { version: 4, itemId: 'pdf-document', pdfPath: 'papers/paper.pdf', itemFolderPath: folderPath, annotationIndexPath: null, fileFingerprint: fingerprint.fingerprint, versionFingerprint: fingerprint.versionFingerprint, knownPdfPaths: ['papers/paper.pdf'], createdAt: 1, updatedAt: 1 };
  const manifestFile = folder.add(new SourceTestFile('manifest.json', JSON.stringify(manifest)));
  folder.add(new SourceTestFile('summary.md', '# Summary'));
  folder.add(new SourceTestDirectory('analysis')).add(new SourceTestFile('experiment.ipynb', '{"cells":[]}'));
  const annotations = await (await root.getDirectoryHandle('.lattice')).getDirectoryHandle('annotations', { create: true });
  const annotation = { id: 'local-ann', author: 'local-nickname', createdAt: 123, target: { type: 'pdf', page: 1, rects: [{ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }] }, style: { type: 'highlight', color: '#FFD400' }, content: 'original quote', comment: 'local comment' };
  const sidecar = annotations.add(new SourceTestFile('pdf-document.json', JSON.stringify({ version: 3, documentId: 'pdf-document', fileId: 'pdf-document', fileType: 'pdf', lastModified: 123, annotations: [annotation] })));
  return { root, pdf, pdfHandle, manifest, manifestFile, sidecar, annotation };
}
function controller() {
  const items: Item[] = [], annotations: Array<CreateAnnotationInput & { authorId: string }> = [], contents: SharedLibraryItemContent[] = [];
  return { items, annotations, contents, userId: 'cloud-user',
    async createItem(input: {libraryId: string; name: string; kind: Item['kind']; parentItemId?: string}, content?: SharedLibraryItemContent): Promise<Item> {
      const item: Item = { id: `item-${items.length}`, libraryId: input.libraryId, canonicalName: input.name, title: input.name, kind: input.kind, currentVersionId: content ? `new-version-${items.length}` : undefined, metadata: input.parentItemId ? { parentItemId: input.parentItemId } : {}, status: 'active', createdBy: 'cloud-user', createdAt: 'now', updatedAt: 'now' };
      items.push(item); if (content) contents.push(content); return item;
    },
    async createAnnotation(_libraryId: string, input: CreateAnnotationInput): Promise<Annotation> { annotations.push({ ...input, authorId: 'cloud-user' }); return { ...input, id: 'cloud-ann', authorId: 'cloud-user', body: input.body ?? {}, status: 'active', revision: 1, createdAt: 'now', updatedAt: 'now' }; },
  };
}
describe('local workspace cloud upload', () => {
  beforeEach(async () => { await saveAnnotationRegistry({ entriesByDocumentId: {}, documentIdsByFingerprint: {}, documentIdsByCanonicalPath: {}, conflictsByCanonicalPath: {} }); });
  it('uploads the exact PDF, annotations bound to the new version, and nested PDF children', async () => {
    const f = await fixture(), cloud = controller();
    const result = await uploadLocalWorkspaceEntries({ rootHandle: f.root.handle(), entries: [{ path: 'papers/paper.pdf', kind: 'file', handle: f.pdfHandle }], controller: cloud, libraryId: 'lib', parentItemId: 'target' });
    expect(result.warnings).toEqual([]);
    expect(result.annotationsImported).toBe(1);
    expect(cloud.items.map(item => [item.canonicalName, item.metadata.parentItemId])).toEqual([['paper.pdf', 'target'], ['analysis', 'item-0'], ['experiment.ipynb', 'item-1'], ['summary.md', 'item-0']]);
    expect(cloud.annotations[0]).toMatchObject({ itemId: 'item-0', versionId: 'new-version-0', authorId: 'cloud-user', body: { comment: 'local comment', importedFromLocal: { annotationId: 'local-ann', author: 'local-nickname' } } });
    expect(cloud.annotations[0].body?.importedFromLocal).toHaveProperty('sourceSha256');
    const content = cloud.contents[0];
    expect(content.kind === 'binary' ? new TextDecoder().decode(content.data) : content.text).toBe('%PDF-fixture-only');
  });
  it('does not attach annotations or children from a stale PDF version and reports the omission', async () => {
    const f = await fixture(); f.pdf.content = '%PDF-changed-version';
    const bundle = await collectLocalPdfUploadBundle({ rootHandle: f.root.handle(), pdfPath: 'papers/paper.pdf', pdfHandle: f.pdfHandle });
    expect(bundle.annotations).toEqual([]); expect(bundle.children).toEqual([]);
    expect(bundle.warnings.join(' ')).toMatch(/版本|指纹/);
  });
  it('imports valid annotations and warns about malformed or non-PDF records without silently dropping them', async () => {
    const f = await fixture();
    f.sidecar.content = JSON.stringify({ version: 3, documentId: 'pdf-document', fileId: 'pdf-document', fileType: 'pdf', lastModified: 123, annotations: [f.annotation, { id: 'broken' }, { ...f.annotation, id: 'code-ann', target: { type: 'code_line', line: 2 } }] });
    const bundle = await collectLocalPdfUploadBundle({ rootHandle: f.root.handle(), pdfPath: 'papers/paper.pdf', pdfHandle: f.pdfHandle });
    expect(bundle.annotations.map(item => item.id)).toEqual(['local-ann']);
    expect(bundle.warnings.join(' ')).toContain('broken'); expect(bundle.warnings.join(' ')).toContain('code-ann');
  });
  it('uploads selected folder hierarchy and avoids uploading .lattice as an ordinary directory', async () => {
    const f = await fixture(), cloud = controller();
    await uploadLocalWorkspaceEntries({ rootHandle: f.root.handle(), entries: [{ path: 'workspace', storagePath: '', name: 'workspace', kind: 'directory', handle: f.root.handle() }], controller: cloud, libraryId: 'lib' });
    expect(cloud.items.some(item => item.canonicalName === '.lattice')).toBe(false);
    expect(cloud.items.slice(0, 3).map(item => [item.canonicalName, item.metadata.parentItemId])).toEqual([['workspace', undefined], ['papers', 'item-0'], ['paper.pdf', 'item-1']]);
    expect(cloud.annotations[0].itemId).toBe('item-2');
  });
  it('does not mutate cloud storage when cancelled before collection', async () => {
    const f = await fixture(), cloud = controller(), signal = AbortSignal.abort();
    await expect(uploadLocalWorkspaceEntries({ rootHandle: f.root.handle(), entries: [{ path: 'papers/paper.pdf', kind: 'file', handle: f.pdfHandle }], controller: cloud, libraryId: 'lib', signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cloud.items).toEqual([]);
  });
  it('imports an existing sidecar without a PDF child manifest when the registry verifies its exact source version', async () => {
    const f = await fixture();
    (await f.root.getDirectoryHandle('.lattice')).entries.delete('items');
    await registerAnnotationLocation({ documentId: 'pdf-document', fileFingerprint: f.manifest.fileFingerprint, versionFingerprint: f.manifest.versionFingerprint,
      alias: { sourcePath: '.lattice/annotations/pdf-document.json', canonicalPath: null, relativePathFromRoot: 'papers/paper.pdf', fileId: 'pdf-document', workspaceKey: null, updatedAt: 1 } });
    const bundle = await collectLocalPdfUploadBundle({ rootHandle: f.root.handle(), pdfPath: 'papers/paper.pdf', pdfHandle: f.pdfHandle });
    expect(bundle.annotations.map(annotation => annotation.id)).toEqual(['local-ann']);
    expect(bundle.warnings).toEqual([]);
  });
  it('keeps the frozen uploaded PDF revision if the local file changes after collection', async () => {
    const f = await fixture(), cloud = controller(), create = cloud.createItem;
    cloud.createItem = async (input, content) => { f.pdf.content = '%PDF-changed-after-read'; return create(input, content); };
    const result = await uploadLocalWorkspaceEntries({ rootHandle: f.root.handle(), entries: [{ path: 'papers/paper.pdf', kind: 'file', handle: f.pdfHandle }], controller: cloud, libraryId: 'lib' });
    expect(result.annotationsImported).toBe(1);
    const pdf = cloud.contents[0];
    expect(pdf.kind === 'binary' ? new TextDecoder().decode(pdf.data) : pdf.text).toBe('%PDF-fixture-only');
  });
  it('migrates a legacy exact-path sidecar without fingerprint metadata and preserves binding provenance', async () => {
    const f = await fixture(), cloud = controller();
    const lattice = await f.root.getDirectoryHandle('.lattice'); lattice.entries.delete('items');
    const annotations = await lattice.getDirectoryHandle('annotations'); annotations.entries.delete('pdf-document.json');
    const id = generateFileId('papers/paper.pdf');
    annotations.add(new SourceTestFile(`${id}.json`, JSON.stringify({ version: 3, documentId: id, fileId: id, fileType: 'pdf', lastModified: 123, annotations: [f.annotation] })));
    const result = await uploadLocalWorkspaceEntries({ rootHandle: f.root.handle(), entries: [{ path: 'papers/paper.pdf', kind: 'file', handle: f.pdfHandle }], controller: cloud, libraryId: 'lib' });
    expect(result.annotationsImported).toBe(1);
    expect(cloud.annotations[0].body?.importedFromLocal).toMatchObject({ binding: 'legacy-path', documentId: id });
  });
  it('does not adopt a mismatched document id from a same-path legacy sidecar', async () => {
    const f = await fixture(); const lattice = await f.root.getDirectoryHandle('.lattice'); lattice.entries.delete('items');
    const annotations = await lattice.getDirectoryHandle('annotations'); annotations.entries.delete('pdf-document.json');
    const id = generateFileId('papers/paper.pdf');
    annotations.add(new SourceTestFile(`${id}.json`, JSON.stringify({ version: 3, documentId: 'other-document', fileId: id, fileType: 'pdf', lastModified: 123, annotations: [f.annotation] })));
    const result = await collectLocalPdfUploadBundle({ rootHandle: f.root.handle(), pdfPath: 'papers/paper.pdf', pdfHandle: f.pdfHandle });
    expect(result.annotations).toEqual([]); expect(result.warnings.join(' ')).toMatch(/身份/);
  });
  it('keeps root-prefixed storage identity separate from the already authorized file handle', async () => {
    const f = await fixture(), cloud = controller();
    const result = await uploadLocalWorkspaceEntries({ rootHandle: f.root.handle(), entries: [{ path: 'papers/paper.pdf', storagePath: 'workspace/papers/paper.pdf', kind: 'file', handle: f.pdfHandle }], controller: cloud, libraryId: 'lib' });
    expect(result.annotationsImported).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(cloud.items.map(item => item.canonicalName)).toEqual(['paper.pdf', 'analysis', 'experiment.ipynb', 'summary.md']);
  });
  it('uses the connection file size limit before mutating cloud state', async () => {
    const f = await fixture(), cloud = { ...controller(), connection: { maxFileBytes: 8 } };
    await expect(uploadLocalWorkspaceEntries({ rootHandle: f.root.handle(), entries: [{ path: 'papers/paper.pdf', kind: 'file', handle: f.pdfHandle }], controller: cloud, libraryId: 'lib' })).rejects.toThrow(/8 bytes/);
    expect(cloud.items).toEqual([]);
  });
});
