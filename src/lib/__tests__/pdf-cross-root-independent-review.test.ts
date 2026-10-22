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
import { createUniversalAnnotationFile, saveAnnotationsToDisk, loadAnnotationsFromDisk } from '../universal-annotation-storage';
import { ensurePdfItemWorkspaceForBinding, listPdfItemNotes, savePdfItemManifest, createPdfItemNote } from '../pdf-item';
import type { WorkspaceIdentity } from '@/types/workspace-identity';

function register(root: SourceTestDirectory, path: string): WorkspaceIdentity {
  Object.assign(root, { fullPath: path });
  const identity: WorkspaceIdentity = { workspaceKey: (state.desktop ? 'desktop:' : 'web:') + path, displayPath: path,
    hostKind: state.desktop ? 'desktop' : 'web', rootName: root.name, handleFingerprint: null, lastUsedAt: 1 };
  state.roots.set(identity.workspaceKey, { ...identity, handle: root.handle() });
  return identity;
}


import { isIndependentStoredPdf } from '../pdf-item-location-registry';

describe('independent PDF cross-root review reproductions', () => {
  beforeEach(() => {
    state.values.clear(); state.roots.clear(); state.desktop=false; vi.stubGlobal('crypto', webcrypto);
  });
  async function recordOriginal(root: SourceTestDirectory, pdf: SourceTestFile, relativePath: string, owner: WorkspaceIdentity) {
    Object.assign(pdf,{isSameEntry:async(other:unknown)=>other===pdf});
    const identity=await resolveFileIdentity({fileHandle:pdf as unknown as FileSystemFileHandle,fileName:pdf.name,filePath:relativePath,workspaceIdentity:owner});
    const annotationFile={...createUniversalAnnotationFile(identity.primaryFileId,'pdf','original-document'),annotations:[{id:'original-annotation',target:{type:'pdf' as const,page:1,rects:[]},style:{type:'highlight' as const,color:'#ffeb3b'},content:'Original synthetic annotation',author:'user',createdAt:1}]};
    await saveAnnotationsToDisk(annotationFile,root.handle());
    await registerAnnotationLocation({documentId:annotationFile.documentId,fileFingerprint:identity.fileFingerprint,versionFingerprint:identity.versionFingerprint,
      alias:{workspaceKey:owner.workspaceKey,sourcePath:'.lattice/annotations/'+identity.primaryFileId+'.json',fileId:identity.primaryFileId,canonicalPath:identity.canonicalPath,relativePathFromRoot:relativePath,updatedAt:1}});
    return identity;
  }
  it.each(['%PDF same synthetic bytes','%PDF different synthetic bytes'])('isolates a same-name independent copy from a root-level sidecar (%s)',async content=>{
    const root=new SourceTestDirectory('workspace'),original=root.add(new SourceTestFile('paper.pdf','%PDF same synthetic bytes'));
    const duplicate=root.add(new SourceTestDirectory('copies')).add(new SourceTestFile('paper.pdf',content));
    Object.assign(duplicate,{isSameEntry:async(other:unknown)=>other===duplicate});
    const owner=register(root,'C:/synthetic/workspace');
    await recordOriginal(root,original,'paper.pdf',owner);
    const binding=await resolvePdfDocumentBinding({rootHandle:root.handle(),fileHandle:duplicate as unknown as FileSystemFileHandle,fileName:duplicate.name,filePath:'copies/paper.pdf',workspaceIdentity:owner});
    expect(binding.annotationFile.annotations).toEqual([]);
    expect(binding.documentId).not.toBe('original-document');
  });
  it('does not strip a real same-name child directory from a stored relative PDF path',async()=>{
    const root=new SourceTestDirectory('papers'),original=root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('original.pdf','%PDF synthetic'));
    const duplicate=root.add(new SourceTestDirectory('copies')).add(new SourceTestFile('original.pdf',original.content));
    Object.assign(duplicate,{isSameEntry:async(other:unknown)=>other===duplicate});
    expect(await isIndependentStoredPdf(root.handle(),'papers/original.pdf',root.handle(),'copies/original.pdf',duplicate as unknown as FileSystemFileHandle)).toBe(true);
  });
  it('keeps a same-name nested independent copy separate through actual annotation binding',async()=>{
    const root=new SourceTestDirectory('papers'),original=root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('original.pdf','%PDF synthetic'));
    const duplicate=root.add(new SourceTestDirectory('copies')).add(new SourceTestFile('original.pdf',original.content));
    Object.assign(duplicate,{isSameEntry:async(other:unknown)=>other===duplicate});
    const owner=register(root,'C:/synthetic/papers');
    await recordOriginal(root,original,'papers/original.pdf',owner);
    const binding=await resolvePdfDocumentBinding({rootHandle:root.handle(),fileHandle:duplicate as unknown as FileSystemFileHandle,fileName:duplicate.name,filePath:'copies/original.pdf',workspaceIdentity:owner});
    expect(binding.annotationFile.annotations).toEqual([]);
    expect(binding.documentId).not.toBe('original-document');
  });
  it('keeps source and canonical annotation file ids consistent after an explorer-prefix alias is mirrored',async()=>{
    const root=new SourceTestDirectory('workspace'),paper=root.add(new SourceTestFile('paper.pdf','%PDF single physical paper'));
    const owner=register(root,'C:/synthetic/workspace');
    await recordOriginal(root,paper,'paper.pdf',owner);
    const binding=await resolvePdfDocumentBinding({rootHandle:root.handle(),fileHandle:paper as unknown as FileSystemFileHandle,fileName:paper.name,filePath:'workspace/paper.pdf',workspaceIdentity:owner});
    expect(binding.annotationFile.annotations.map(annotation=>annotation.id)).toEqual(['original-annotation']);
    expect(binding.canonicalStorageFileId).toBe(binding.annotationFile.fileId);
  });
});
