import { describe, expect, it, vi } from 'vitest';
import { resolveCloudConversationTargets } from '../cloud-conversation-targeting';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';

function fixture() {
  const folder: CloudLibraryResource = { id: 'cloud:account:library:folder', libraryId: 'library', itemId: 'folder', role: 'editor',
    versionId: 'folder-v1', name: 'papers', kind: 'folder', path: 'cloud://papers', content: null };
  const paper: CloudLibraryResource = { ...folder, id: 'cloud:account:library:paper', itemId: 'paper', name: 'paper.md', kind: 'markdown',
    content: { kind: 'text', text: '# Actual paper', mimeType: 'text/markdown', updatedAt: '2026-10-17' } };
  const provider: CloudLibrarySourceProvider = { scope: 'account',
    read: vi.fn(async (_library, item) => item === folder.itemId ? folder : paper),
    list: vi.fn(async () => []), search: vi.fn(), save: vi.fn() };
  return { folder, paper, provider };
}

describe('natural current cloud folder targeting', () => {
  it.each(['在当前文件夹里搜索BB1', '总结当前文件夹', '请在这个目录里查找参数', 'Search this folder for BB1', 'Summarize the selected directory'])('keeps %s in the selected cloud folder without a local workspace', async query => {
    const { folder, provider } = fixture();
    const result = await resolveCloudConversationTargets({ query, provider, knownSnapshots: [], activeResource: folder });
    expect(result).toMatchObject({ paths: [], selections: [{ kind: 'folder', libraryId: 'library', itemId: 'folder' }] });
    expect(provider.list).not.toHaveBeenCalled();
    expect(provider.read).toHaveBeenCalledWith('library', 'folder', undefined);
    expect(provider.save).not.toHaveBeenCalled();
  });

  it('keeps an explicit file selection ahead of the active cloud folder', async () => {
    const { folder, paper, provider } = fixture();
    const result = await resolveCloudConversationTargets({ query: '@cloud:library:paper 总结当前文件夹中的这份文件', provider, knownSnapshots: [], activeResource: folder });
    expect(result).toMatchObject({ paths: [paper.id], selections: [{ kind: 'file', libraryId: 'library', itemId: 'paper' }] });
    expect(provider.read).not.toHaveBeenCalledWith('library', 'folder', undefined);
  });

  it('does not authorize folder discovery when the user explicitly asks for an independent explanation', async () => {
    const { folder, provider } = fixture();
    const result = await resolveCloudConversationTargets({ query: '无需读取当前文件夹，只从一般原理解释BB1', provider, knownSnapshots: [], activeResource: folder });
    expect(result).toMatchObject({ paths: [], selections: [] });
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.list).not.toHaveBeenCalled();
  });

  it.each(['identity', 'role', 'kind'] as const)('rejects a changed active folder %s before granting a source scope', async change => {
    const { folder, provider } = fixture();
    const current = change === 'identity' ? { ...folder, id: 'cloud:another-account:library:folder' }
      : change === 'role' ? { ...folder, role: 'viewer' as const } : { ...folder, kind: 'markdown' as const };
    vi.mocked(provider.read).mockResolvedValue(current);
    await expect(resolveCloudConversationTargets({ query: '在当前文件夹里搜索BB1', provider, knownSnapshots: [], activeResource: folder })).rejects.toThrow(/身份|权限|目录|folder|scope/i);
    expect(provider.list).not.toHaveBeenCalled();
  });
});
