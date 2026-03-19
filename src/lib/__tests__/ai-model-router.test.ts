import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getConfiguredProvidersMock,
  getDefaultProviderMock,
  getProviderMock,
} = vi.hoisted(() => ({
  getConfiguredProvidersMock: vi.fn(),
  getDefaultProviderMock: vi.fn(),
  getProviderMock: vi.fn(),
}));

vi.mock('../ai/providers', () => ({
  getConfiguredProviders: getConfiguredProvidersMock,
  getDefaultProvider: getDefaultProviderMock,
  getProvider: getProviderMock,
}));

import { getModelRouterPolicy, routeModel } from '../ai/model-router';
import type { AiProvider, AiRuntimeSettings } from '../ai/types';

function createProvider(id: AiProvider['id'], name: string): AiProvider {
  return {
    id,
    name,
    isConfigured: () => true,
    testConnection: async () => ({ ok: true }),
    getAvailableModels: async () => [],
    generate: async () => ({ text: 'ok', model: 'stub-model' }),
    stream: async function* () {
      yield { type: 'done' as const };
    },
    estimateTokens: () => 0,
  };
}

const baseSettings: AiRuntimeSettings = {
  aiEnabled: true,
  providerId: 'openai',
  model: 'gpt-test',
  temperature: 0.2,
  maxTokens: 512,
  systemPrompt: 'system',
};

describe('model-router', () => {
  beforeEach(() => {
    getConfiguredProvidersMock.mockReset();
    getDefaultProviderMock.mockReset();
    getProviderMock.mockReset();
  });

  it('prefers local provider when preferLocal is enabled', () => {
    const ollamaProvider = createProvider('ollama', 'Ollama');
    const openaiProvider = createProvider('openai', 'OpenAI');

    getConfiguredProvidersMock.mockReturnValue([ollamaProvider, openaiProvider]);
    getProviderMock.mockImplementation((id: string) => {
      if (id === 'openai') return openaiProvider;
      if (id === 'ollama') return ollamaProvider;
      return null;
    });

    const selection = routeModel('research', {
      ...baseSettings,
      preferLocal: true,
    });

    expect(selection.provider.id).toBe('ollama');
    expect(selection.modelInfo.source).toBe('local');
    expect(selection.policy.evidenceRequired).toBe(true);
  });

  it('falls back to default configured provider when preferred provider is unavailable', () => {
    const googleProvider = createProvider('google', 'Google');

    getConfiguredProvidersMock.mockReturnValue([]);
    getProviderMock.mockReturnValue(null);
    getDefaultProviderMock.mockReturnValue(googleProvider);

    const selection = routeModel('chat', baseSettings);

    expect(selection.provider.id).toBe('google');
    expect(selection.modelInfo.source).toBe('cloud');
  });

  it('returns policy with task-specific budget and evidence requirement', () => {
    const policy = getModelRouterPolicy('knowledge_organize', {
      ...baseSettings,
      preferLocal: false,
    });

    expect(policy.taskType).toBe('knowledge_organize');
    expect(policy.maxContextTokens).toBe(20000);
    expect(policy.evidenceRequired).toBe(true);
    expect(policy.preferredProvider).toBe('openai');
  });
});
