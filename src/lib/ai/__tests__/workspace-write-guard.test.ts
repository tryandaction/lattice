import { beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceWriteGuard } from '../workspace-write-guard';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useContentCacheStore } from '@/stores/content-cache-store';
import { createEmptyPane } from '@/lib/layout-utils';

const emitVaultChange = vi.hoisted(() => vi.fn());
vi.mock('@/lib/plugins/runtime', () => ({ emitVaultChange, emitFileOpen: vi.fn(), emitFileClose: vi.fn(), emitWorkspaceOpen: vi.fn(), emitActiveFileChange: vi.fn() }));
const root = { name: 'root' } as FileSystemDirectoryHandle;
const handle = { name: 'note.md', getFile: async () => new File(['saved'], 'note.md') } as FileSystemFileHandle;
beforeEach(() => {
  vi.clearAllMocks(); useContentCacheStore.getState().clearCache();
  const pane = createEmptyPane('pane');
  pane.tabs = [{ id: 'note', fileName: 'note.md', filePath: 'root/note.md', fileHandle: handle, isDirty: false, scrollPosition: 0 }];
  useWorkspaceStore.setState({ rootHandle: root, layout: { root: pane, activePaneId: 'pane' } });
});
it('checks inactive editors and rejects a dirty cache even when the tab flag is clean', () => {
  useContentCacheStore.getState().setContent('note', 'unsaved', 'old');
  expect(() => createWorkspaceWriteGuard(root).beforeWrite('note.md')).toThrow('未保存修改');
});
it('refuses writes after changing workspaces', () => {
  const guard = createWorkspaceWriteGuard(root);
  useWorkspaceStore.setState({ rootHandle: { name: 'other' } as FileSystemDirectoryHandle });
  expect(() => guard.beforeWrite('note.md')).toThrow('工作区已切换');
});
it('refreshes clean open content after disk writes and reports the changed path', async () => {
  useContentCacheStore.getState().setContent('note', 'old', 'old');
  await createWorkspaceWriteGuard(root).refresh('root/note.md', handle);
  expect(useContentCacheStore.getState().getContent('note')).toMatchObject({ content: 'saved', originalContent: 'saved', isDirty: false });
  expect(emitVaultChange).toHaveBeenCalledWith('root/note.md');
});
it('keeps edits made while the write finished instead of replacing the dirty cache', async () => {
  useContentCacheStore.getState().setContent('note', 'new edit', 'old');
  await createWorkspaceWriteGuard(root).refresh('note.md', handle);
  expect(useContentCacheStore.getState().getContent('note')?.content).toBe('new edit');
});
