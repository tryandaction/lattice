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
  it('ranks matching workspace chunks beyond the opening pair', () => {
    searchIndexMock.mockReturnValue([{ path: 'calibration.md', summary: 'Opening summary', chunks: [
      { id: 'intro', label: 'Introduction', content: 'General background.' },
      { id: 'setup', label: 'Setup', content: 'General setup.' },
      { id: 'method', label: 'Calibration', content: 'The ORCHID calibration uses coefficient 73.' },
    ] }]);
    const context = new AiContextGraph().buildPromptContext({ query: 'ORCHID calibration' });
    expect(context.prompt).toContain('coefficient 73');
    expect(context.nodes.filter(node => node.kind === 'workspace_chunk')[0]?.id).toBe('workspace-calibration.md-method');
  });

  it('retains supplied Markdown passages beyond the display preview and keeps selection scope separate', () => {
    const content = 'Introduction '.repeat(30) + '\nSpecific evidence at the end.';
    const context = new AiContextGraph().buildPromptContext({ filePath: 'notes.md', content, selection: 'Selected passage', references: [{ path: 'other.md', content }] });
    expect(context.evidenceRefs.filter((ref) => ref.locator === 'notes.md').map((ref) => ref.preview)).toEqual(['Selected passage', content]);
    expect(context.evidenceRefs.find((ref) => ref.locator === 'other.md')?.preview).toBe(content);
  });

  it('limits file evidence to the exact text supplied under the prompt budget', () => {
    const content = 'Supplied research text '.repeat(500) + 'UNSUPPLIED END';
    const context = new AiContextGraph().buildPromptContext({ references: [{ path: 'other.md', content }] }, 180);
    const preview = context.evidenceRefs[0]?.preview;
    expect(preview?.length).toBeGreaterThan(180);
    expect(content.startsWith(preview!)).toBe(true);
    expect(context.prompt).toContain(preview);
    expect(preview).not.toContain('UNSUPPLIED END');
  });

  it('never uses a user annotation comment as a PDF source quote', () => {
    const context = new AiContextGraph().buildPromptContext({ filePath: 'paper.pdf', annotations: [
      { id: 'one', target: { type: 'pdf', page: 2 }, content: 'Original text.', comment: 'My interpretation.' },
      { id: 'two', target: { type: 'pdf', page: 3 }, comment: 'Comment without source.' },
    ] });
    expect(context.evidenceRefs.find((ref) => ref.locator.endsWith('#page=2'))?.anchor?.snippet).toBe('Original text.');
    expect(context.evidenceRefs.find((ref) => ref.locator.endsWith('#page=3'))?.anchor?.snippet).toBeUndefined();
  });
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

  it('keeps bounded PDF page text instead of dropping one oversized file node', () => {
    const graph = new AiContextGraph();
    const context = graph.buildPromptContext(
      {
        filePath: 'papers/logical-qubits.pdf',
        content: [
          '[PDF text extracted from papers/logical-qubits.pdf; pages 1-3.]',
          '--- Page 1 ---',
          'Introduction '.repeat(900),
          '--- Page 2 ---',
          'The [[4, 2, 2]] code detects a single erasure and encodes two logical qubits.',
          '--- Page 3 ---',
          'Appendix '.repeat(900),
        ].join('\n'),
        query: 'Explain the 4,2,2 code and erasure detection',
      },
      220,
    );

    expect(context.prompt).toContain('The [[4, 2, 2]] code detects a single erasure');
    expect(context.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'pdf_page',
        evidenceRef: expect.objectContaining({
          kind: 'pdf_page',
          locator: 'papers/logical-qubits.pdf#page=2',
          anchor: expect.objectContaining({
            page: 2,
          }),
        }),
      }),
    ]));
    expect(context.truncated).toBe(true);
  });

  it('does not inject a full PDF or citations for a trivial greeting', () => {
    const graph = new AiContextGraph();
    const content = Array.from({ length: 16 }, (_, index) => [
      `--- Page ${index + 1} ---`,
      `Research page ${index + 1} with enough text to be considered context. `.repeat(80),
    ].join('\n')).join('\n');

    const context = graph.buildPromptContext({
      filePath: 'papers/research.pdf',
      content,
      query: 'hi',
    });

    expect(context.prompt).not.toContain('Evidence References');
    expect(context.evidenceRefs).toEqual([]);
    expect(context.truncated).toBe(false);
  });

  it('keeps the active file visible without inventing evidence when no text is available', () => {
    const graph = new AiContextGraph();
    const context = graph.buildPromptContext({
      filePath: 'papers/current.pdf',
      query: 'What is the main result?',
    });

    expect(context.prompt).toContain('## Current file: papers/current.pdf');
    expect(context.prompt).toContain('no text was selected');
    expect(context.evidenceRefs).toEqual([]);
  });

  it('only exposes citations for context nodes that fit in the prompt budget', () => {
    const graph = new AiContextGraph();
    const content = Array.from({ length: 8 }, (_, index) => [
      `--- Page ${index + 1} ---`,
      `Page ${index + 1} evidence `.repeat(700),
    ].join('\n')).join('\n');

    const context = graph.buildPromptContext({
      filePath: 'papers/research.pdf',
      content,
      query: 'evidence',
    }, 1200);

    const includedPages = new Set(
      context.nodes
        .filter((node) => context.prompt.includes(node.label))
        .flatMap((node) => node.evidenceRef?.kind === 'pdf_page' ? [node.evidenceRef.locator] : []),
    );
    expect(context.truncated).toBe(true);
    expect(context.evidenceRefs.length).toBeGreaterThan(0);
    expect(context.evidenceRefs.every((ref) => ref.kind !== 'pdf_page' || includedPages.has(ref.locator))).toBe(true);
    expect(context.evidenceRefs.length).toBeLessThan(8);
  });

  it('keeps independently addressable evidence for every included source', () => {
    const graph = new AiContextGraph();
    const content = Array.from({ length: 12 }, (_, index) => `## Section ${index + 1}\nEvidence for section ${index + 1}.`).join('\n');

    const context = graph.buildPromptContext({
      filePath: 'notes/long-note.md',
      content,
      query: 'section evidence',
    });

    expect(context.evidenceRefs).toHaveLength(13);
    expect(new Set(context.evidenceRefs.map((ref) => ref.locator)).size).toBe(13);
  });

  it('splits a mentioned PDF into page references without treating page previews as exact quotes', () => {
    const context = new AiContextGraph().buildPromptContext({
      references: [{ path: 'papers/other.pdf', content: '--- Page 3 ---\nMeasured polarizability.\n--- Page 12 ---\nMagnetic field is 58 G.' }],
      query: 'Compare the results',
    });
    expect(context.evidenceRefs.map((ref) => ref.locator)).toEqual([
      'papers/other.pdf#page=3', 'papers/other.pdf#page=12',
    ]);
    expect(context.evidenceRefs.every((ref) => ref.anchor?.snippet === undefined)).toBe(true);
  });

  it('keeps source coverage notices and exposes only the actual excerpt for quote verification', () => {
    const content = '[PDF text extracted from paper.pdf; supplied pages 3 of 40.]\n--- Page 3 ---\n'
      + 'Read evidence '.repeat(300)
      + '\n[PDF extraction limited to 1 pages. Omitted pages were not read.]';
    const context = new AiContextGraph().buildPromptContext({ filePath: 'paper.pdf', content }, 200);
    expect(context.prompt).toContain('supplied pages 3 of 40');
    expect(context.prompt).toContain('Omitted pages were not read');
    expect(context.evidenceRefs).toHaveLength(1);
    expect(context.prompt).toContain(context.evidenceRefs[0].preview);
    expect(context.evidenceRefs[0].preview!.length).toBeLessThan(content.length);
  });

  it('shares a tight PDF context budget across explicit sources before taking more pages from one file', () => {
    const pages = (source: string) => Array.from({ length: 16 }, (_, index) =>
      `--- Page ${index + 1} ---\n${source} ${index === 2 ? 'resonance' : 'overview'} ${'verified text '.repeat(650)}`,
    ).join('\n');
    const context = new AiContextGraph().buildPromptContext({
      filePath: 'active.pdf', content: pages('active'), selection: 'Selected experimental result.', query: 'resonance',
      references: [
        { path: 'first.pdf', content: pages('first') },
        { path: 'second.pdf', content: pages('second') },
      ],
    }, 1200);
    const pageRefs = context.evidenceRefs.filter((ref) => ref.kind === 'pdf_page');
    expect(pageRefs.map((ref) => ref.locator)).toEqual([
      'first.pdf#page=3', 'second.pdf#page=3', 'active.pdf#page=3',
    ]);
    expect(context.prompt.indexOf('Selected experimental result.')).toBeLessThan(context.prompt.indexOf('## first.pdf'));
    for (const ref of pageRefs) {
      expect(ref.preview!.length).toBeGreaterThan(120);
      expect(context.prompt).toContain(ref.preview);
    }
    expect(context.truncated).toBe(true);
    expect(context.prompt).toContain('Do not infer content of omitted pages');
  });
});
