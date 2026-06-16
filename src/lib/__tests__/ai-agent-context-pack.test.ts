import { describe, expect, it } from 'vitest';

import { buildAgentContextPack } from '../ai/agent-context-pack';
import type { AgentMemoryEntry } from '../ai/agent-memory';

function memory(overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry {
  return {
    id: 'memory-1',
    scope: 'workspace',
    title: 'Preferred citation style',
    content: 'Use short evidence-backed reading notes.',
    source: {
      label: 'User instruction',
      locator: 'settings://agent-memory',
    },
    createdAt: 100,
    updatedAt: 100,
    pinned: false,
    status: 'active',
    ...overrides,
  };
}

describe('agent-context-pack', () => {
  it('builds an inspectable prompt with source budgets and evidence provenance', () => {
    const pack = buildAgentContextPack({
      id: 'pack-1',
      now: 100,
      explicitEvidenceRefs: [
        {
          kind: 'file',
          label: 'paper.md',
          locator: 'paper.md',
          preview: 'main result',
        },
      ],
      selection: {
        text: 'Selected claim about the main result.',
      },
      activeFile: {
        path: 'paper.md',
        summary: 'Active file summary.',
      },
      workspaceChunks: [
        {
          id: 'chunk-1',
          path: 'notes/related.md',
          label: 'Chunk 1',
          content: 'Related workspace context.',
        },
      ],
      memoryEntries: [memory()],
    });

    expect(pack.id).toBe('pack-1');
    expect(pack.truncated).toBe(false);
    expect(pack.sections.map((section) => section.source)).toEqual(
      expect.arrayContaining(['explicit_evidence', 'selection', 'active_file', 'workspace_chunk', 'memory']),
    );
    expect(pack.prompt).toContain('## Selected text');
    expect(pack.prompt).toContain('## Evidence References');
    expect(pack.evidenceRefs.map((ref) => ref.locator)).toContain('paper.md');
    expect(pack.sourceSummaries.find((summary) => summary.source === 'memory')?.includedCount).toBe(1);
  });

  it('keeps pinned memory before regular memory and omits entries over source budget', () => {
    const pack = buildAgentContextPack({
      budget: {
        maxTokens: 1200,
        bySource: {
          memory: 70,
        },
      },
      memoryEntries: [
        memory({
          id: 'regular',
          title: 'Regular memory',
          content: 'regular '.repeat(80),
          pinned: false,
        }),
        memory({
          id: 'pinned',
          title: 'Pinned memory',
          content: 'Pinned fact.',
          pinned: true,
          updatedAt: 200,
        }),
      ],
    });

    expect(pack.sections[0]).toMatchObject({
      source: 'memory',
      metadata: expect.objectContaining({
        memoryId: 'pinned',
      }),
    });
    expect(pack.omitted.map((item) => item.metadata?.memoryId)).toContain('regular');
    expect(pack.truncated).toBe(true);
    expect(pack.omittedSummary).toMatchObject({
      totalOmittedCount: expect.any(Number),
      totalOmittedTokens: expect.any(Number),
      bySource: expect.arrayContaining([
        expect.objectContaining({
          source: 'memory',
          omittedCount: 1,
          contentPreviews: expect.arrayContaining([
            expect.stringContaining('Regular memory: regular regular'),
          ]),
        }),
      ]),
    });
    expect(pack.omittedSummary.preview).toContain('memory: 1 omitted');
    expect(pack.omittedSummary.semanticPreview).toContain('memory: workspace: Regular memory: regular regular');
    expect(pack.omittedSummary.autoSummary).toEqual([
      expect.objectContaining({
        source: 'memory',
        omittedCount: 1,
        labels: ['workspace: Regular memory'],
        keywords: expect.arrayContaining(['regular', 'memory']),
        representativePreviews: expect.arrayContaining([
          expect.stringContaining('Regular memory: regular regular'),
        ]),
        summary: expect.stringContaining('memory: 1 omitted item'),
      }),
    ]);
    expect(pack.omittedSummary.autoSummaryPreview).toContain('memory: 1 omitted item');
    expect(pack.omittedSummary.autoSummaryPreview).toContain('keywords=');
    expect(pack.omittedSummary.recoveryHints).toEqual([
      expect.objectContaining({
        source: 'memory',
        label: 'workspace: Regular memory',
        locator: null,
        priorityScore: expect.any(Number),
        priorityReason: expect.stringContaining('source=memory'),
        contentPreview: expect.stringContaining('regular regular'),
      }),
    ]);
    expect(pack.omittedSummary.recoveryHintsPreview).toContain('memory: workspace: Regular memory');
    expect(pack.omittedSummary.recoveryPriorityPreview).toContain('memory: workspace: Regular memory');
    expect(pack.omittedSummary.recoveryPriorityPreview).toContain('score=');
    expect(pack.omittedSummary.recoveryPlan).toEqual([
      expect.objectContaining({
        source: 'memory',
        label: 'workspace: Regular memory',
        recoveryAction: 'use_semantic_preview',
        whyOmitted: 'budget_limited:memory',
        priorityScore: expect.any(Number),
        contentPreview: expect.stringContaining('regular regular'),
      }),
    ]);
    expect(pack.omittedSummary.recoveryPlanPreview).toContain('use_semantic_preview');
    expect(pack.omittedSummary.recoveryPlanPreview).toContain('reason=budget_limited:memory');
    expect(pack.prompt).toContain('## Omitted context summary');
    expect(pack.prompt).toContain('Omitted auto summary: memory: 1 omitted item');
    expect(pack.prompt).toContain('Omitted content preview: memory: workspace: Regular memory: regular regular');
    expect(pack.prompt).toContain('Omitted recovery hints: memory: workspace: Regular memory');
    expect(pack.prompt).toContain('Omitted recovery priority: memory: workspace: Regular memory');
    expect(pack.prompt).toContain('Omitted recovery plan: 1. use_semantic_preview');
  });

  it('keeps explicit evidence refs even when source sections are omitted', () => {
    const pack = buildAgentContextPack({
      budget: {
        maxTokens: 10,
        bySource: {
          explicit_evidence: 0,
          active_file: 0,
        },
      },
      explicitEvidenceRefs: [
        {
          kind: 'code_line',
          label: 'main.ts line 10',
          locator: 'main.ts#line=10',
        },
      ],
      activeFile: {
        path: 'main.ts',
        summary: 'large '.repeat(200),
      },
    });

    expect(pack.sections).toHaveLength(0);
    expect(pack.omitted.length).toBeGreaterThan(0);
    expect(pack.evidenceRefs).toEqual([
      expect.objectContaining({
        locator: 'main.ts#line=10',
      }),
    ]);
  });
});
