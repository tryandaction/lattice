import { expect, it } from 'vitest';
import { buildCloudSourceSelectionMention, parseCloudSourceSelections, captureSelectedCloudAgentDocumentSources, invalidCloudSourceSelectionMentions } from '../cloud-source';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import type { Item } from '@/lib/shared-library/domain';
const resource = (id: string): CloudLibraryResource => ({ id: `lattice-cloud:account:lib:${id}`, libraryId: 'lib', itemId: id, versionId: 'v1', name: 'same.txt', kind: 'code', path: 'cloud://display', role: 'admin', content: { kind: 'text', text: `result-${id}`, mimeType: 'text/plain', updatedAt: 'today' } });
const entries = (parent: string): Item[] => parent === 'folder' ? Array.from({ length: 12 }, (_, i) => ({ id: `nested-${i}`, libraryId: 'lib', kind: 'folder', status: 'active' } as Item))
  : [{ id: parent.replace('nested', 'file'), canonicalName: 'same.txt', libraryId: 'lib', kind: 'code', status: 'active' } as Item];
const provider = (): CloudLibrarySourceProvider => ({ scope: 'account', read: async (_lib, item) => resource(item), list: async (_lib, parent) => entries(parent!), search: async () => ({ results: [] }), save: async () => {} });
it('parses cloud file/folder mentions with opaque encoded ids', () => {
  const selection = { libraryId: 'library:space', itemId: 'item with space', kind: 'folder' as const };
  const mention = buildCloudSourceSelectionMention(selection);
  expect(mention).toBe('@cloud-folder:library%3Aspace:item%20with%20space');
  expect(parseCloudSourceSelections(`read ${mention} @cloud:lib:item`)).toEqual([selection, { libraryId: 'lib', itemId: 'item', kind: 'file' }]);
});
it('skips malformed and incomplete cloud ids while retaining valid selections', () => {
  expect(parseCloudSourceSelections('read @cloud:lib:half% @cloud-folder:bad%ZZ:item @cloud:lib:ok')).toEqual([{ libraryId: 'lib', itemId: 'ok', kind: 'file' }]);
  expect(invalidCloudSourceSelectionMentions('@cloud:lib:half% @cloud-folder:bad%ZZ:item @cloud:lib:')).toEqual(['@cloud:lib:half%', '@cloud-folder:bad%ZZ:item', '@cloud:lib:']);
});
it('bounds empty-folder discovery and does not traverse unrelated children', async () => {
  let lists = 0;
  const current = provider();
  current.list = async (_library, parent) => {
    lists++;
    return lists < 10 ? [{ id: `next-${parent}`, libraryId: 'lib', kind: 'folder', status: 'active' } as Item] : [];
  };
  await expect(captureSelectedCloudAgentDocumentSources({ provider: current, selections: [{ libraryId: 'lib', itemId: 'folder', kind: 'folder' }], maxFolders: 3 })).rejects.toThrow(/预算/);
  expect(lists).toBe(3);
});
it('reads twelve nested same-name cloud sources through the provider without local handles', async () => {
  const captured = await captureSelectedCloudAgentDocumentSources({ provider: provider(), selections: [{ libraryId: 'lib', itemId: 'folder', kind: 'folder' }] });
  expect(captured.sources).toHaveLength(12);
  expect(new Set(captured.sources.map(source => source.path)).size).toBe(12);
  expect((await captured.sources[11].readUnit(1)).text).toBe('result-file-11');
  expect(captured.snapshots[11].cloudIdentity.role).toBe('admin');
  await Promise.all(captured.sources.map(source => source.close()));
});
it('refuses oversized cloud folders and an invalidated current provider pointer', async () => {
  await expect(captureSelectedCloudAgentDocumentSources({ provider: provider(), selections: [{ libraryId: 'lib', itemId: 'folder', kind: 'folder' }], maxFiles: 3 })).rejects.toThrow(/预算/);
  await expect(captureSelectedCloudAgentDocumentSources({ provider: provider(), selections: [{ libraryId: 'lib', itemId: 'file-1', kind: 'file' }], isCurrent: () => false })).rejects.toThrow(/scope|权限/);
});
