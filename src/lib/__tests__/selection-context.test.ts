import { describe, expect, it } from 'vitest';
import { createSelectionContext, defaultPromptForSelectionMode } from '../ai/selection-context';

describe('selection context', () => {
  it('builds code selection context with exact line range evidence', () => {
    const context = createSelectionContext({
      sourceKind: 'code',
      paneId: 'pane-main',
      fileName: 'main.py',
      filePath: 'src/main.py',
      selectedText: 'score = 1\n    return score',
      documentText: 'def calc():\n    score = 1\n    return score\nprint(calc())\n',
      selectionRange: {
        start: 12,
        end: 38,
        lineStart: 2,
        lineEnd: 3,
      },
    });

    expect(context.sourceLabel).toContain('第 2-3 行');
    expect(context.contextSummary).toContain('上下文前后各 3 行');
    expect(context.anchor).toEqual(expect.objectContaining({
      lineStart: 2,
      lineEnd: 3,
      offsets: {
        start: 12,
        end: 38,
      },
    }));
    expect(context.evidenceRefs).toEqual([
      expect.objectContaining({
        kind: 'code_line',
        locator: 'src/main.py#line=2-3',
      }),
    ]);
    expect(context.contextText).toContain('return score');
  });

  it('builds notebook contexts with cell id and cell index anchors', () => {
    const context = createSelectionContext({
      sourceKind: 'notebook',
      paneId: 'pane-main',
      fileName: 'analysis.ipynb',
      filePath: 'lab/analysis.ipynb',
      selectedText: 'loss decreased',
      documentText: 'loss decreased after epoch 4',
      notebookCellId: 'cell-4',
      notebookCellIndex: 3,
    });

    expect(context.sourceLabel).toContain('Cell 4');
    expect(context.sourceLabel).toContain('cell-4');
    expect(context.anchor).toEqual(expect.objectContaining({
      cellId: 'cell-4',
      cellIndex: 3,
    }));
    expect(context.evidenceRefs[0]).toEqual(
      expect.objectContaining({
        kind: 'notebook_cell',
        locator: 'lab/analysis.ipynb#cell=cell-4',
      }),
    );
  });

  it('builds pdf contexts with page, rects, and snippet anchor', () => {
    const context = createSelectionContext({
      sourceKind: 'pdf',
      paneId: 'pane-main',
      fileName: 'paper.pdf',
      filePath: 'papers/paper.pdf',
      selectedText: 'Important result',
      pdfPage: 12,
      pdfRects: [
        { left: 0.1, top: 0.2, width: 0.3, height: 0.05 },
      ],
    });

    expect(context.evidenceRefs[0]).toEqual(
      expect.objectContaining({
        kind: 'pdf_page',
        locator: 'papers/paper.pdf#page=12',
        anchor: expect.objectContaining({
          page: 12,
          rects: [{ left: 0.1, top: 0.2, width: 0.3, height: 0.05 }],
          snippet: 'Important result',
        }),
      }),
    );
    expect(context.contextSummary).toContain('已捕获区域锚点');
  });

  it('builds html and word block contexts with block labels', () => {
    const htmlContext = createSelectionContext({
      sourceKind: 'html',
      paneId: 'pane-main',
      fileName: 'report.html',
      filePath: 'docs/report.html',
      selectedText: 'Rendered paragraph',
      documentText: '<p>Rendered paragraph</p>',
      contextText: 'Heading\n\nRendered paragraph\n\nNext paragraph',
      blockLabel: '段落 · Rendered paragraph',
    });

    expect(htmlContext.anchor).toEqual(expect.objectContaining({
      blockLabel: '段落 · Rendered paragraph',
    }));
    expect(htmlContext.contextText).toContain('Next paragraph');
    expect(htmlContext.contextSummary).toContain('HTML 块级选区');

    const wordContext = createSelectionContext({
      sourceKind: 'word',
      paneId: 'pane-main',
      fileName: 'proposal.docx',
      filePath: 'docs/proposal.docx',
      selectedText: 'Word section',
      documentText: 'Word section body',
      contextText: 'Heading\n\nWord section body\n\nClosing note',
      blockLabel: '标题 · Proposal',
    });

    expect(wordContext.anchor).toEqual(expect.objectContaining({
      blockLabel: '标题 · Proposal',
    }));
    expect(wordContext.contextSummary).toContain('Word 块级选区');
  });

  it('returns stable default prompts for chat, agent, and plan', () => {
    const context = createSelectionContext({
      sourceKind: 'markdown',
      paneId: 'pane-main',
      fileName: 'notes.md',
      filePath: 'notes/notes.md',
      selectedText: 'A highlighted paragraph',
      documentText: 'A highlighted paragraph',
    });

    expect(defaultPromptForSelectionMode('chat', context)).toContain('关键的证据');
    expect(defaultPromptForSelectionMode('agent', context)).toContain('Conclusion / Evidence / Next Actions');
    expect(defaultPromptForSelectionMode('plan', context)).toContain('目标草稿');
  });
});
