import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock, routeModelMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  routeModelMock: vi.fn(),
}));

vi.mock('../ai/model-router', () => ({
  routeModel: routeModelMock,
}));

import { aiOrchestrator } from '../ai/orchestrator';
import type { AiRuntimeSettings } from '../ai/types';

const baseSettings: AiRuntimeSettings = {
  aiEnabled: true,
  providerId: 'openai',
  model: 'gpt-test',
  temperature: 0.1,
  maxTokens: 800,
  systemPrompt: 'system prompt',
};

describe('AiOrchestrator', () => {
  beforeEach(() => {
    generateMock.mockReset();
    routeModelMock.mockReset();
    routeModelMock.mockReturnValue({
      provider: {
        generate: generateMock,
      },
      modelInfo: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      policy: {
        taskType: 'chat',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 4000,
        evidenceRequired: true,
      },
    });
  });

  it('returns model info, evidence refs, context, and follow-up actions for chat requests', async () => {
    generateMock.mockResolvedValue({
      text: 'Conclusion\n\nEvidence\n\nNext actions',
      model: 'gpt-test',
    });

    const result = await aiOrchestrator.runChat({
      prompt: 'Explain the experiment',
      history: [{ role: 'user', content: 'Previous question' }],
      settings: baseSettings,
      filePath: 'lab/notes.md',
      content: '# Experiment\nObserved a clear trend.',
      explicitEvidenceRefs: [
        {
          kind: 'heading',
          label: 'lab/notes.md#Experiment',
          locator: 'lab/notes.md#Experiment',
        },
      ],
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('Conclusion');
    expect(result.model.providerName).toBe('OpenAI');
    expect(result.context.nodes.length).toBeGreaterThan(0);
    expect(result.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'heading',
          locator: 'lab/notes.md#Experiment',
        }),
      ]),
    );
    expect(result.followUpActions.map((action) => action.kind)).toEqual([
      'create_draft',
      'propose_task',
    ]);
    expect(result.draftSuggestion?.type).toBe('paper_note');
  });

  it('does not inject workspace search context into chat unless query is explicitly provided', async () => {
    generateMock.mockResolvedValue({
      text: 'No workspace search',
      model: 'gpt-test',
    });

    const result = await aiOrchestrator.runChat({
      prompt: 'Find related notes',
      settings: baseSettings,
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.context.nodes).toEqual([]);
    expect(result.evidenceRefs).toEqual([]);
  });

  it('falls back to a safe default proposal when provider output is not valid json', async () => {
    generateMock.mockResolvedValue({
      text: 'not-json',
      model: 'gpt-test',
    });

    const proposal = await aiOrchestrator.proposeTask({
      prompt: '整理本周实验记录',
      settings: baseSettings,
      filePath: 'lab/log.md',
      content: '# Week log',
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(proposal.summary).toBe('整理本周实验记录');
    expect(proposal.steps).toHaveLength(1);
    expect(proposal.requiredApprovals).toEqual([
      'Confirm any file creation or updates before execution',
    ]);
    expect(proposal.plannedWrites).toEqual([
      expect.objectContaining({
        targetPath: 'AI Drafts/整理本周实验记录 Plan.md',
        mode: 'create',
        contentPreview: expect.stringContaining('Proposal: 整理本周实验记录'),
      }),
    ]);
    expect(proposal.plannedWrites[0]?.contentPreview).toContain('lab/log.md#Week log');
    expect(proposal.approvedWrites).toEqual(['AI Drafts/整理本周实验记录 Plan.md']);
  });

  it('normalizes proposal planned writes and filters unsafe model targets', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify({
        summary: 'Organize Alpha notes',
        steps: [
          {
            title: 'Review Alpha',
            description: 'Review Alpha sources.',
          },
        ],
        plannedWrites: [
          {
            targetPath: 'Research//alpha-plan.md',
            mode: 'append',
            contentPreview: 'Append Alpha plan.',
          },
          {
            targetPath: '../escape.md',
            mode: 'create',
            contentPreview: 'Unsafe traversal.',
          },
          {
            targetPath: 'C:/Users/me/unsafe.md',
            mode: 'update',
            contentPreview: 'Unsafe absolute path.',
          },
        ],
      }),
      model: 'gpt-test',
    });

    const proposal = await aiOrchestrator.proposeTask({
      prompt: 'Organize Alpha notes',
      settings: baseSettings,
      filePath: 'notes/alpha.md',
      content: '# Alpha\nResult summary.',
    });

    expect(proposal.summary).toBe('Organize Alpha notes');
    expect(proposal.steps).toEqual([
      {
        id: 'step-1',
        title: 'Review Alpha',
        description: 'Review Alpha sources.',
      },
    ]);
    expect(proposal.plannedWrites).toEqual([
      {
        targetPath: 'Research/alpha-plan.md',
        mode: 'append',
        contentPreview: 'Append Alpha plan.',
      },
    ]);
    expect(proposal.approvedWrites).toEqual(['Research/alpha-plan.md']);
  });
});
