import { describe, expect, it } from 'vitest';
import { inferMentionFolderPath, listMentionWorkspaceEntries, normalizeMentionFolderPath } from '../mention-workspace-browser';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

describe('mention workspace directory browsing', () => {
  it('lists the current folder lazily and sorts folders before supported files', async () => {
    const root = new SourceTestDirectory('atom');
    root.add(new SourceTestDirectory('Theoretical Research')).add(new SourceTestDirectory('taiyi'))
      .add(new SourceTestDirectory('essay')).add(new SourceTestDirectory('06 gates'))
      .add(new SourceTestFile('paper.md', '# Synthetic'));
    root.add(new SourceTestFile('AGENTS.md', 'instructions'));
    root.add(new SourceTestDirectory('secrets')).add(new SourceTestFile('token.txt', 'secret'));
    const rows = await listMentionWorkspaceEntries(root.handle());
    expect(rows).toEqual([{ kind: 'folder', path: 'Theoretical Research', name: 'Theoretical Research' }]);
    const nested = await listMentionWorkspaceEntries(root.handle(), 'Theoretical Research/taiyi/essay');
    expect(nested).toEqual([{ kind: 'folder', path: 'Theoretical Research/taiyi/essay/06 gates', name: '06 gates' }]);
    const selected = await listMentionWorkspaceEntries(root.handle(), 'Theoretical Research/taiyi/essay/06 gates');
    expect(selected.map(item => item.path)).toEqual([
      'Theoretical Research/taiyi/essay/06 gates/paper.md',
    ]);
  });

  it('rejects traversal, absolute folders, malformed encoding, and unsupported-only leaves', async () => {
    expect(() => normalizeMentionFolderPath('../private')).toThrow();
    expect(() => normalizeMentionFolderPath('C:/private')).toThrow();
    expect(() => normalizeMentionFolderPath('/private')).toThrow();
    expect(() => normalizeMentionFolderPath('%E0%A4%A', true)).toThrow();
    expect(normalizeMentionFolderPath('Research/100% calculations')).toBe('Research/100% calculations');
    const root = new SourceTestDirectory('atom');
    root.add(new SourceTestFile('image.png', 'binary'));
    expect(await listMentionWorkspaceEntries(root.handle())).toEqual([]);
  });

  it('recovers an explicit spaced folder path before the Chinese request suffix', () => {
    expect(inferMentionFolderPath('Theoretical Research/taiyi/essay/06_fast_long_range_and_native_gates中的文章都阅读')).toBe('Theoretical Research/taiyi/essay/06_fast_long_range_and_native_gates');
    expect(inferMentionFolderPath('read notes from the paper')).toBeNull();
  });

  it('fails closed after workspace permission is revoked', async () => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile('paper.md', 'content'));
    root.permission = 'denied';
    await expect(listMentionWorkspaceEntries(root.handle())).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});
