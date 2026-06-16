import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock, routeModelMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  routeModelMock: vi.fn(),
}));

vi.mock('../ai/model-router', () => ({
  routeModel: routeModelMock,
}));

import { createResearchAgentPlannerGenerate } from '../ai/research-agent-planner-provider';
import type { AiRuntimeSettings } from '../ai/types';

const settings: AiRuntimeSettings = {
  aiEnabled: true,
  providerId: 'openai',
  model: 'gpt-planner',
  temperature: 0.7,
  maxTokens: 4000,
  systemPrompt: 'system',
};

describe('research-agent-planner-provider', () => {
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
        model: 'gpt-planner',
        source: 'cloud',
      },
      policy: {
        taskType: 'task_proposal',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 12000,
        evidenceRequired: true,
      },
    });
  });

  it('creates a planner generator from the routed task proposal provider', async () => {
    generateMock.mockResolvedValue({
      text: '{"steps":[]}',
      model: 'gpt-planner',
    });

    const adapter = createResearchAgentPlannerGenerate(settings);
    const result = await adapter.generatePlan([
      { role: 'user', content: 'Plan this research task.' },
    ], {
      temperature: 0.1,
      maxTokens: 600,
    });

    expect(routeModelMock).toHaveBeenCalledWith('task_proposal', settings);
    expect(generateMock).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Plan this research task.' }],
      expect.objectContaining({
        model: 'gpt-planner',
        temperature: 0.1,
        maxTokens: 600,
      }),
    );
    expect(result).toEqual({ text: '{"steps":[]}' });
    expect(adapter.modelInfo.providerName).toBe('OpenAI');
    expect(adapter.policy.taskType).toBe('task_proposal');
  });

  it('caps default planner temperature and max tokens from runtime settings', async () => {
    generateMock.mockResolvedValue({
      text: '{"steps":[]}',
      model: 'gpt-planner',
    });

    const adapter = createResearchAgentPlannerGenerate(settings);
    await adapter.generatePlan([
      { role: 'user', content: 'Plan this research task.' },
    ], {});

    expect(generateMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        model: 'gpt-planner',
        temperature: 0.2,
        maxTokens: 1200,
      }),
    );
  });

  it('supports custom task routing and propagates provider errors to the planner runner', async () => {
    generateMock.mockRejectedValue(new Error('provider failed'));

    const adapter = createResearchAgentPlannerGenerate(settings, {
      taskType: 'research',
    });

    await expect(adapter.generatePlan([
      { role: 'user', content: 'Plan this research task.' },
    ], {})).rejects.toThrow('provider failed');
    expect(routeModelMock).toHaveBeenCalledWith('research', settings);
  });

  it('creates an omitted-context summary generator from the same routed provider', async () => {
    generateMock.mockResolvedValue({
      text: 'Model omitted summary.',
      model: 'gpt-planner',
    });

    const adapter = createResearchAgentPlannerGenerate(settings, {
      taskType: 'research',
    });
    const result = await adapter.generateOmittedSummary({
      task: 'Analyze Alpha',
      query: 'What was omitted?',
      contextPackId: 'context-pack-alpha',
      omittedContextCount: 2,
      omittedContextTokens: 640,
      omittedContextPreview: 'workspace_chunk: notes/beta.md',
      omittedAutoSummary: 'workspace_chunk: 2 omitted items / labels=Beta',
      omittedSemanticPreview: 'Beta method context.',
      omittedRecoveryPlan: '1. read_indexed_context | notes/beta.md',
    });

    expect(result).toBe('Model omitted summary.');
    expect(generateMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('bounded audit previews'),
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Context pack: context-pack-alpha'),
        }),
      ]),
      expect.objectContaining({
        model: 'gpt-planner',
        temperature: 0.15,
        maxTokens: 700,
      }),
    );
  });
});
