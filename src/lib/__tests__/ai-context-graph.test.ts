import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchIndexMock, parseNotebookMock } = vi.hoisted(() => ({
  searchIndexMock: vi.fn(),
  parseNotebookMock: vi.fn(),
}));

vi.mock('../ai/workspace-indexer', () => ({
  searchIndex: searchIndexMock,
}));

vi.mock('@/lib/notebook-utils', () => ({
  parseNotebook: parseNotebookMock,
}));

import { AiContextGraph } from '../ai/context-graph';
import type { EvidenceRef } from '../ai/types';

describe('AiContextGraph', () => {
  beforeEach(() => {
    searchIndexMock.mockReset();
    parseNotebookMock.mockReset();
    searchIndexMock.mockReturnValue([]);
  });

  it('builds unified context for markdown, annotations, references, and workspace hits', () => {
    searchIndexMock.mockReturnValue([
      {
        path: 'notes/reference.md',
        summary: 'workspace summary',
        chunks: [
          { id: 'chunk-1', label: 'Chunk 1', content: 'retrieved chunk content' },
        ],
      },
    ]);

    const explicitEvidence: EvidenceRef = {
      kind: 'pdf_annotation',
      label: 'Explicit ref',
      locator: 'paper.pdf#ann=1',
      preview: 'user-pinned evidence',
    };

    const graph = new AiContextGraph();
    const context = graph.buildPromptContext(
      {
        filePath: 'notes/paper.md',
        content: '# Intro\nA concise section.\n## Method\nDetails here.',
        selection: 'Important selected paragraph',
        references: [{ path: 'refs/cited.md', content: 'Referenced file text' }],
        annotations: [
          {
            id: 'ann-1',
            target: { type: 'pdf', page: 7 },
            content: 'Highlighted result',
            comment: 'verify later',
          },
        ],
        query: 'method result',
        explicitEvidenceRefs: [explicitEvidence],
      },
      3000,
    );

    expect(context.nodes.some((node) => node.kind === 'selection')).toBe(true);
    expect(context.nodes.some((node) => node.kind === 'heading')).toBe(true);
    expect(context.nodes.some((node) => node.kind === 'annotation')).toBe(true);
    expect(context.nodes.some((node) => node.kind === 'workspace_chunk')).toBe(true);
    expect(context.prompt).toContain('## Current file: notes/paper.md');
    expect(context.prompt).toContain('## Evidence References');
    expect(context.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'pdf_annotation',
          locator: 'paper.pdf#ann=1',
        }),
        expect.objectContaining({
          kind: 'pdf_page',
          locator: 'notes/paper.md#page=7',
        }),
      ]),
    );
  });

  it('extracts notebook cell evidence when the active file is a notebook', () => {
    parseNotebookMock.mockReturnValue({
      cells: [
        { id: 'cell-a', cell_type: 'code', source: 'print("alpha")' },
        { id: 'cell-b', cell_type: 'markdown', source: '# Notes' },
      ],
    });

    const graph = new AiContextGraph();
    const nodes = graph.resolveFocusContext({
      filePath: 'analysis.ipynb',
      content: '{"cells":[]}',
      query: 'alpha',
    });

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'notebook_cell',
          label: 'Cell 1 (code)',
          evidenceRef: expect.objectContaining({
            kind: 'notebook_cell',
            locator: 'analysis.ipynb#cell=cell-a',
          }),
        }),
      ]),
    );
  });

  it('keeps explicit evidence refs even when prompt sections are truncated by token budget', () => {
    searchIndexMock.mockReturnValue([]);

    const explicitEvidence: EvidenceRef = {
      kind: 'code_line',
      label: 'main.py line 42',
      locator: 'main.py#line=42',
      preview: 'critical equation setup',
    };

    const graph = new AiContextGraph();
    const context = graph.buildPromptContext(
      {
        filePath: 'main.py',
        content: 'x'.repeat(2000),
        explicitEvidenceRefs: [explicitEvidence],
      },
      10,
    );

    expect(context.truncated).toBe(true);
    expect(context.evidenceRefs).toContainEqual(explicitEvidence);
  });
});
