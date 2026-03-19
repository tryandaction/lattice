import { describe, expect, it } from 'vitest';
import { buildSelectionOrigin, isMeaningfulSelectionText } from '../ai/selection-ui';
import { createSelectionContext } from '../ai/selection-context';

describe('selection-ui helpers', () => {
  it('detects meaningful selections', () => {
    expect(isMeaningfulSelectionText('ab')).toBe(false);
    expect(isMeaningfulSelectionText('   ')).toBe(false);
    expect(isMeaningfulSelectionText('123')).toBe(true);
    expect(isMeaningfulSelectionText('中文段落')).toBe(true);
  });

  it('builds selection origin metadata for chat results', () => {
    const context = createSelectionContext({
      sourceKind: 'markdown',
      paneId: 'pane-main',
      fileName: 'notes.md',
      filePath: 'notes/notes.md',
      selectedText: 'A highlighted paragraph with extra detail',
      documentText: 'A highlighted paragraph with extra detail',
    });

    expect(buildSelectionOrigin(context, 'chat')).toEqual({
      kind: 'selection-ai',
      mode: 'chat',
      sourceKind: 'markdown',
      sourceLabel: context.sourceLabel,
      selectionPreview: 'A highlighted paragraph with extra detail',
    });
  });
});
