import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const state = vi.hoisted(() => ({ values: new Map<string, unknown>(), roots: new Map<string, unknown>(), desktop: false }));
vi.mock('@/lib/storage-adapter', () => ({
  isTauri: () => state.desktop,
  getStorageAdapter: () => ({ get: async (key: string) => structuredClone(state.values.get(key) ?? null),
    set: async (key: string, value: unknown) => { state.values.set(key, structuredClone(value)); } }),
}));
vi.mock('@/lib/workspace-identity', () => ({
  loadWorkspaceHandleRegistration: async (key: string) => state.roots.get(key) ?? null,
  findWorkspaceHandleRegistration: async (handle: unknown) => [...state.roots.values()].find(value => (value as { handle: unknown }).handle === handle) ?? null,
}));
vi.mock('@/lib/desktop-file-system', () => ({
  getDesktopHandlePath: (handle: { fullPath?: string }) => state.desktop ? handle?.fullPath ?? null : null,
  createDesktopDirectoryHandle: (path: string) => (state.roots.get('desktop:' + path) as { handle: unknown })?.handle,
}));
vi.mock('@/lib/desktop-folder', () => ({ isExistingDesktopDirectory: async (path: string) => state.roots.has('desktop:' + path) }));

import { SourceTestDirectory, SourceTestFile } from '../ai/__tests__/fixtures/source-workspace';
import { registerAnnotationLocation, loadAnnotationRegistry } from '../annotation-registry';
import { resolvePdfDocumentBinding } from '../pdf-document-binding';
import { resolveFileIdentity } from '../file-identity';
import { createUniversalAnnotationFile, saveAnnotationsToDisk, loadAnnotationsFromDisk, loadAnnotationsForFileIdentity } from '../universal-annotation-storage';
import { ensurePdfItemWorkspaceForBinding, listPdfItemNotes, savePdfItemManifest, createPdfItemNote, getDefaultPdfItemFolderPath } from '../pdf-item';
import type { WorkspaceIdentity } from '@/types/workspace-identity';

function register(root: SourceTestDirectory, path: string): WorkspaceIdentity {
  Object.assign(root, { fullPath: path });
  const identity: WorkspaceIdentity = { workspaceKey: (state.desktop ? 'desktop:' : 'web:') + path, displayPath: path,
    hostKind: state.desktop ? 'desktop' : 'web', rootName: root.name, handleFingerprint: null, lastUsedAt: 1 };
  state.roots.set(identity.workspaceKey, { ...identity, handle: root.handle() });
  return identity;
}

describe('PDF metadata survives parent and child workspace changes', () => {
  beforeEach(() => {
    state.values.clear(); state.roots.clear(); vi.stubGlobal('crypto', webcrypto);
    vi.spyOn(SourceTestFile.prototype, 'createWritable').mockImplementation(async function(this: SourceTestFile) {
      let content = this.content;
      return { write: async (value: string) => { content = typeof value === 'string' ? value : await (value as Blob).text(); },
        close: async () => { this.content = content; this.writes++; }, abort: async () => {} };
    });
  });

  it('keeps a recovered nested legacy sidecar bound to its mirrored id when the parent has an unrelated same-name PDF', async () => {
    state.desktop = false;
    const root = new SourceTestDirectory('workspace'), child = root.add(new SourceTestDirectory('chapter'));
    const paper = child.add(new SourceTestFile('paper.pdf', '%PDF nested legacy paper'));
    root.add(new SourceTestFile('paper.pdf', '%PDF unrelated parent paper'));
    const owner = register(root, 'C:/synthetic/workspace');
    const annotation = { id: 'nested-annotation', target: { type: 'pdf' as const, page: 1, rects: [] },
      style: { type: 'highlight' as const, color: '#ffeb3b' }, content: 'Synthetic nested annotation', author: 'user', createdAt: 1 };
    await saveAnnotationsToDisk({ ...createUniversalAnnotationFile('paper.pdf', 'pdf', 'nested-document'), annotations: [annotation] }, child.handle());
    await saveAnnotationsToDisk({ ...createUniversalAnnotationFile('paper.pdf', 'pdf', 'parent-document'),
      annotations: [{ ...annotation, id: 'unrelated-parent-annotation' }] }, root.handle());

    const binding = await resolvePdfDocumentBinding({ rootHandle: root.handle(), fileHandle: paper as unknown as FileSystemFileHandle,
      fileName: paper.name, filePath: 'chapter/paper.pdf', workspaceIdentity: owner });
    expect(binding.documentId).toBe('nested-document');
    const reloaded = await loadAnnotationsForFileIdentity({ rootHandle: binding.itemRootHandle!, fileIdentity: binding.fileIdentity,
      workspaceKey: binding.storageWorkspaceKey ?? null, fileType: 'pdf' });
    expect(reloaded.annotationFile.documentId).toBe('nested-document');
    expect(reloaded.annotationFile.annotations.map(item => item.id)).toEqual(['nested-annotation']);
    expect(binding.canonicalStorageFileId).toBe(binding.annotationFile.fileId);
    expect(binding.fileIdentity.primaryFileId).toBe(binding.annotationFile.fileId);
    expect((await loadAnnotationsFromDisk('paper.pdf', root.handle(), 'pdf')).documentId).toBe('parent-document');
  });

  it('uses the actual registered sidecar name when an original-root legacy file embeds an older id', async () => {
    state.desktop = false;
    const root = new SourceTestDirectory('workspace'), child = root.add(new SourceTestDirectory('chapter'));
    const paper = child.add(new SourceTestFile('paper.pdf', '%PDF original owner sidecar'));
    const owner = register(root, 'C:/synthetic/workspace'), childOwner = register(child, 'C:/synthetic/workspace/chapter');
    const identity = await resolveFileIdentity({ fileHandle: paper as unknown as FileSystemFileHandle,
      fileName: paper.name, filePath: 'chapter/paper.pdf', workspaceIdentity: owner });
    await saveAnnotationsToDisk(createUniversalAnnotationFile('old-embedded-id', 'pdf', 'stable-document'), root.handle());
    const annotations = await (await root.getDirectoryHandle('.lattice')).getDirectoryHandle('annotations');
    const sidecar = annotations.entries.get('old-embedded-id.json')!;
    annotations.entries.delete('old-embedded-id.json'); sidecar.name = 'actual-sidecar.json'; annotations.add(sidecar);
    await registerAnnotationLocation({ documentId: 'stable-document', fileFingerprint: identity.fileFingerprint,
      alias: { workspaceKey: owner.workspaceKey, fileId: 'actual-sidecar', sourcePath: '.lattice/annotations/actual-sidecar.json',
        canonicalPath: identity.canonicalPath, relativePathFromRoot: identity.relativePathFromRoot, updatedAt: 1 } });
    const binding = await resolvePdfDocumentBinding({ rootHandle: child.handle(), fileHandle: paper as unknown as FileSystemFileHandle,
      fileName: paper.name, filePath: 'paper.pdf', workspaceIdentity: childOwner });
    expect(binding.documentId).toBe('stable-document');
    expect(binding.itemRootHandle).toBe(root);
    expect(binding.canonicalStorageFileId).toBe('actual-sidecar');
    expect(binding.fileIdentity.primaryFileId).toBe('actual-sidecar');
  });

  it.each([false, true])('keeps annotations and child files on their actual original root (desktop=%s)', async desktop => {
    state.desktop = desktop;
    const atom = new SourceTestDirectory('atom'), taiyi = atom.add(new SourceTestDirectory('taiyi'));
    const essay = taiyi.add(new SourceTestDirectory('essay')), paper = essay.add(new SourceTestFile('paper.pdf', '%PDF synthetic cross-root'));
    const parentIdentity = register(atom, 'C:/synthetic/atom'), childIdentity = register(taiyi, 'C:/synthetic/atom/taiyi');
    const fileHandle = paper as unknown as FileSystemFileHandle;
    Object.assign(paper, { isSameEntry: async (other: unknown) => other === paper });
    const identity = await resolveFileIdentity({ fileHandle, fileName: paper.name, filePath: 'taiyi/essay/paper.pdf', workspaceIdentity: parentIdentity });
    const annotationFile = { ...createUniversalAnnotationFile(identity.primaryFileId, 'pdf', 'stable-paper'),
      annotations: [{ id: 'annotation-29', target: { type: 'pdf' as const, page: 1, rects: [] }, style: { type: 'highlight' as const, color: '#ffeb3b' }, content: 'Original annotation', author: 'user', createdAt: 1 }] };
    await saveAnnotationsToDisk(annotationFile, atom.handle());
    await registerAnnotationLocation({ documentId: 'stable-paper', fileFingerprint: identity.fileFingerprint, versionFingerprint: identity.versionFingerprint,
      alias: { workspaceKey: parentIdentity.workspaceKey, sourcePath: `.lattice/annotations/${identity.primaryFileId}.json`, fileId: identity.primaryFileId,
        canonicalPath: identity.canonicalPath, relativePathFromRoot: identity.relativePathFromRoot, updatedAt: 1 } });
    // An old path-derived item id is deliberately different from annotation.documentId.
    const manifest = await savePdfItemManifest(atom.handle(), { version: 4, itemId: 'legacy-parent-path', pdfPath: 'taiyi/essay/paper.pdf',
      itemFolderPath: '.lattice/items/original-paper', annotationIndexPath: null, fileFingerprint: identity.fileFingerprint,
      versionFingerprint: identity.versionFingerprint, knownPdfPaths: ['taiyi/essay/paper.pdf'], createdAt: 1, updatedAt: 1 });
    await createPdfItemNote(atom.handle(), manifest, 'note', 'original-note');
    // A later empty legacy mapping must not hide the populated original directory.
    const childMirror = await savePdfItemManifest(taiyi.handle(), { ...manifest, itemId: 'legacy-child-path', pdfPath: 'essay/paper.pdf',
      itemFolderPath: '.lattice/items/empty-mirror', knownPdfPaths: ['essay/paper.pdf'] });
    await createPdfItemNote(taiyi.handle(), childMirror, 'note', 'child-root-note');
    const conflicting = await createPdfItemNote(taiyi.handle(), childMirror, 'note', 'original-note');
    const edit = await conflicting.handle.createWritable(); await edit.write('Different valuable child-root version'); await edit.close();
    const staleChildIdentity = await resolveFileIdentity({ fileHandle, fileName: paper.name, filePath: 'essay/paper.pdf', workspaceIdentity: childIdentity });
    await saveAnnotationsToDisk(createUniversalAnnotationFile(staleChildIdentity.primaryFileId, 'pdf', 'incorrect-empty-child-document'), taiyi.handle());
    await registerAnnotationLocation({ documentId: 'incorrect-empty-child-document', fileFingerprint: identity.fileFingerprint,
      alias: { workspaceKey: childIdentity.workspaceKey, sourcePath: `.lattice/annotations/${staleChildIdentity.primaryFileId}.json`,
        fileId: staleChildIdentity.primaryFileId, canonicalPath: staleChildIdentity.canonicalPath,
        relativePathFromRoot: staleChildIdentity.relativePathFromRoot, updatedAt: 2 } });

    const child = await resolvePdfDocumentBinding({ rootHandle: taiyi.handle(), fileHandle, fileName: paper.name, filePath: 'essay/paper.pdf', workspaceIdentity: childIdentity });
    expect(child.annotationFile.annotations.map(item => item.id)).toEqual(['annotation-29']);
    expect(child.documentId).toBe('stable-paper');
    expect(child.itemRootHandle).toBe(atom);
    expect(child.fileIdentity.relativePathFromRoot).toBe('taiyi/essay/paper.pdf');
    const childManifest = await ensurePdfItemWorkspaceForBinding(child.itemRootHandle!, child);
    const notes = await listPdfItemNotes(child.itemRootHandle!, childManifest);
    expect(notes.map(note => note.fileName)).toContain('original-note.md');
    expect(notes.map(note => note.fileName)).toContain('child-root-note.md');
    const recoveredContent = await Promise.all(notes.filter(note => note.handle).map(async note => (await note.handle!.getFile()).text()));
    expect(recoveredContent).toContain('Different valuable child-root version');
    await expect((await conflicting.handle.getFile()).text()).resolves.toBe('Different valuable child-root version');
    await saveAnnotationsToDisk({ ...child.annotationFile, annotations: [{ ...annotationFile.annotations[0], comment: 'Edited from child root' }] }, child.itemRootHandle!);
    const parent = await resolvePdfDocumentBinding({ rootHandle: atom.handle(), fileHandle, fileName: paper.name, filePath: 'taiyi/essay/paper.pdf', workspaceIdentity: parentIdentity });
    expect(parent.annotationFile.annotations[0].comment).toBe('Edited from child root');
    expect(parent.documentId).toBe(child.documentId);
    expect((await loadAnnotationsFromDisk(identity.primaryFileId, atom.handle(), 'pdf')).annotations).toHaveLength(1);
    const registry = await loadAnnotationRegistry();
    expect(registry.entriesByDocumentId['stable-paper'].aliases.every(alias => alias.workspaceKey === parentIdentity.workspaceKey)).toBe(true);
    await saveAnnotationsToDisk({ ...parent.annotationFile, annotations: [] }, atom.handle());
    const intentionallyEmpty = await resolvePdfDocumentBinding({ rootHandle: atom.handle(), fileHandle, fileName: paper.name, filePath: 'taiyi/essay/paper.pdf', workspaceIdentity: parentIdentity });
    expect(intentionallyEmpty.documentId).toBe('stable-paper');
    expect(intentionallyEmpty.annotationFile.annotations).toEqual([]);
    essay.entries.delete('paper.pdf'); paper.name = 'renamed.pdf'; essay.add(paper);
    // Explorer can discover the renamed path before annotation binding settles.
    await savePdfItemManifest(atom.handle(), { ...manifest, itemId: 'new-path-empty-shadow',
      pdfPath: 'taiyi/essay/renamed.pdf', itemFolderPath: getDefaultPdfItemFolderPath('taiyi/essay/renamed.pdf'),
      knownPdfPaths: ['taiyi/essay/renamed.pdf'] });
    const renamed = await resolvePdfDocumentBinding({ rootHandle: atom.handle(), fileHandle, fileName: paper.name,
      filePath: 'taiyi/essay/renamed.pdf', workspaceIdentity: parentIdentity });
    expect(renamed.documentId).toBe('stable-paper');
    expect(renamed.fileIdentity.relativePathFromRoot).toBe('taiyi/essay/renamed.pdf');
    const renamedManifest = await ensurePdfItemWorkspaceForBinding(renamed.itemRootHandle!, renamed);
    expect(renamedManifest.pdfPath).toBe('taiyi/essay/renamed.pdf');
    expect((await listPdfItemNotes(renamed.itemRootHandle!, renamedManifest)).map(note => note.fileName)).toContain('original-note.md');
    const copied = atom.add(new SourceTestDirectory('independent')).add(new SourceTestFile('paper.pdf', paper.content));
    Object.assign(copied, { isSameEntry: async (other: unknown) => other === copied });
    const separate = await resolvePdfDocumentBinding({ rootHandle: atom.handle(), fileHandle: copied as unknown as FileSystemFileHandle,
      fileName: copied.name, filePath: 'independent/paper.pdf', workspaceIdentity: parentIdentity });
    expect(separate.annotationFile.annotations).toEqual([]);
    expect(separate.documentId).not.toBe('stable-paper');
    const separateManifest = await ensurePdfItemWorkspaceForBinding(separate.itemRootHandle!, separate);
    expect((await listPdfItemNotes(separate.itemRootHandle!, separateManifest)).map(note => note.fileName)).not.toContain('original-note.md');
    const copyIdentity = await resolveFileIdentity({ fileHandle: copied as unknown as FileSystemFileHandle,
      fileName: copied.name, filePath: 'independent/paper.pdf', workspaceIdentity: parentIdentity });
    await saveAnnotationsToDisk(separate.annotationFile, atom.handle());
    await registerAnnotationLocation({ documentId: separate.documentId, fileFingerprint: copyIdentity.fileFingerprint,
      versionFingerprint: copyIdentity.versionFingerprint, alias: { workspaceKey: parentIdentity.workspaceKey,
        fileId: separate.annotationFile.fileId, sourcePath: `.lattice/annotations/${separate.annotationFile.fileId}.json`,
        canonicalPath: copyIdentity.canonicalPath, relativePathFromRoot: copyIdentity.relativePathFromRoot, updatedAt: 2 } });
    const movedRoot = new SourceTestDirectory('moved');
    const movedIdentity = register(movedRoot, 'C:/synthetic/moved');
    essay.entries.delete('renamed.pdf'); movedRoot.add(paper);
    const moved = await resolvePdfDocumentBinding({ rootHandle: movedRoot.handle(), fileHandle,
      fileName: paper.name, filePath: 'renamed.pdf', workspaceIdentity: movedIdentity });
    expect(moved.documentId).toBe('stable-paper');
    const movedManifest = await ensurePdfItemWorkspaceForBinding(moved.itemRootHandle!, moved);
    expect((await listPdfItemNotes(moved.itemRootHandle!, movedManifest)).map(note => note.fileName)).toContain('original-note.md');
  });
});
