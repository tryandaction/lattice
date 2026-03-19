import { describe, expect, it } from 'vitest';
import {
  buildEvidenceDraftSeedForGroup,
  buildEvidenceDraftSeedForLeaf,
  buildEvidenceDraftSeedForSelection,
  buildEvidencePanelState,
  buildEvidenceProposalPrompt,
  buildEvidenceProposalPromptForSelection,
} from '../ai/evidence-panel';

describe('buildEvidencePanelState', () => {
  it('groups context nodes by ordered kind and counts evidence', () => {
    const state = buildEvidencePanelState({
      evidenceRefs: [
        { kind: 'heading', label: 'notes.md#Method', locator: 'notes.md#Method' },
        { kind: 'code_line', label: 'main.py line 12', locator: 'main.py#line=12' },
      ],
      contextNodes: [
        {
          id: '3',
          kind: 'annotation',
          label: 'Annotation',
          content: 'a',
          priority: 80,
          evidenceRef: {
            kind: 'pdf_page',
            label: 'paper.pdf page 2',
            locator: 'paper.pdf#page=2',
          },
        },
        { id: '1', kind: 'selection', label: 'Selection', content: 's', priority: 100 },
        { id: '2', kind: 'file', label: 'Current file', content: 'f', priority: 90 },
      ],
    });

    expect(state.evidenceCount).toBe(2);
    expect(state.contextCount).toBe(3);
    expect(state.contextGroups.map((group) => group.kind)).toEqual([
      'selection',
      'file',
    ]);
    expect(state.referenceGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'main.py',
          leaves: expect.arrayContaining([
            expect.objectContaining({
              kind: 'code_line',
              locator: 'main.py#line=12',
            }),
          ]),
        }),
        expect.objectContaining({
          path: 'paper.pdf',
          leaves: expect.arrayContaining([
            expect.objectContaining({
              kind: 'pdf_page',
              locator: 'paper.pdf#page=2',
            }),
          ]),
        }),
      ]),
    );
  });

  it('returns empty groups for empty input', () => {
    expect(buildEvidencePanelState({})).toEqual({
      evidenceCount: 0,
      contextCount: 0,
      contextGroups: [],
      referenceGroups: [],
    });
  });

  it('builds a draft seed for a single evidence leaf', () => {
    const seed = buildEvidenceDraftSeedForLeaf({
      id: 'leaf-1',
      kind: 'heading',
      label: 'notes.md#Method',
      locator: 'notes.md#Method',
      preview: 'Method summary',
    });

    expect(seed.title).toBe('Evidence - notes.md#Method');
    expect(seed.refs).toEqual([
      {
        kind: 'heading',
        label: 'notes.md#Method',
        locator: 'notes.md#Method',
        preview: 'Method summary',
      },
    ]);
    expect(seed.content).toContain('Method summary');
  });

  it('builds a draft seed and proposal prompt for a grouped evidence tree', () => {
    const group = {
      path: 'notes.md',
      title: 'notes.md',
      leaves: [
        {
          id: 'leaf-1',
          kind: 'heading' as const,
          label: 'notes.md#Method',
          locator: 'notes.md#Method',
          preview: 'Method summary',
        },
        {
          id: 'leaf-2',
          kind: 'code_line' as const,
          label: 'main.py line 12',
          locator: 'main.py#line=12',
          preview: 'x = solve()',
        },
      ],
    };

    const seed = buildEvidenceDraftSeedForGroup(group);
    const prompt = buildEvidenceProposalPrompt(group);

    expect(seed.title).toBe('Evidence - notes.md');
    expect(seed.refs).toHaveLength(2);
    expect(seed.content).toContain('Collected evidence from notes.md');
    expect(prompt).toContain('Organize the evidence from notes.md');
    expect(prompt).toContain('main.py#line=12');
  });

  it('builds a merged draft seed and proposal prompt for selected leaves', () => {
    const leaves = [
      {
        id: 'leaf-1',
        kind: 'heading' as const,
        label: 'notes.md#Method',
        locator: 'notes.md#Method',
        preview: 'Method summary',
      },
      {
        id: 'leaf-2',
        kind: 'pdf_page' as const,
        label: 'paper.pdf page 2',
        locator: 'paper.pdf#page=2',
        preview: 'Figure and result',
      },
    ];

    const seed = buildEvidenceDraftSeedForSelection(leaves);
    const prompt = buildEvidenceProposalPromptForSelection(leaves);

    expect(seed.title).toBe('Evidence Selection (2)');
    expect(seed.refs).toHaveLength(2);
    expect(seed.content).toContain('Collected evidence from 2 selected references.');
    expect(prompt).toContain('selected evidence (2 refs)');
    expect(prompt).toContain('paper.pdf#page=2');
  });
});
