import { describe, expect, it } from 'vitest';
import { buildSourceSelectionMention, createAuthorizedSourceIndex, parseSourceSelections, type AgentSourceSelection } from '../source-index';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

describe('source selection mention paths', () => {
  it.each<AgentSourceSelection>([
    { kind: 'file', path: 'notes/meeting@lab.md' },
    { kind: 'file', path: 'notes/result#draft.md' },
    { kind: 'file', path: 'notes/result?draft.md' },
    { kind: 'folder', path: 'papers@lab' },
    { kind: 'folder', path: 'papers#draft' },
    { kind: 'folder', path: 'papers?draft' },
    { kind: 'file', path: '笔记/实验 @lab#draft?100%40.md' },
  ])('round-trips the selected $kind path $path without treating filename characters as mention syntax', (selection) => {
    expect(parseSourceSelections(buildSourceSelectionMention(selection))).toEqual([selection]);
  });

  it('continues to read legacy mentions and their navigation fragments', () => {
    expect(parseSourceSelections('read @folder:papers/Quantum%20Notes @notes/%E5%AE%9E%E9%AA%8C.md#line=7 @plain.md')).toEqual([
      { kind: 'folder', path: 'papers/Quantum Notes' },
      { kind: 'file', path: 'notes/实验.md' },
      { kind: 'file', path: 'plain.md' },
    ]);
  });

  it('reads the selected real file when reserved characters also form another valid mention', async () => {
    const root = new SourceTestDirectory('workspace');
    const notes = root.add(new SourceTestDirectory('notes'));
    const selected = notes.add(new SourceTestFile('meeting@lab.md', '# Selected\n\nActual selected source.'));
    const decoy = root.add(new SourceTestFile('lab.md', '# Decoy\n\nUnrelated source.'));
    const selections = parseSourceSelections(buildSourceSelectionMention({ kind: 'file', path: 'notes/meeting@lab.md' }));
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections });

    try {
      const result = await index.read({ path: selections[0].path });
      expect(result.snapshot.path).toBe('notes/meeting@lab.md');
      expect(result.chunks.map(chunk => chunk.text).join('')).toContain('Actual selected source.');
      expect(selected.reads).toBeGreaterThan(0);
      expect(decoy.reads).toBe(0);
    } finally { index.invalidate(); }
  });
});
