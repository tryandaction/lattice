import type {
  AiModelInfo,
  AiModelSource,
  AiProvider,
  AiProviderId,
  AiTaskType,
  AiRuntimeSettings,
  ModelRouterPolicy,
} from './types';
import { getConfiguredProviders, getDefaultProvider, getProfileProvider, getProvider } from './providers';
import { useAiProviderProfileStore } from '@/stores/ai-provider-profile-store';
import { getProfileDefaultModel } from '@/lib/ai/provider-profiles';

const DEFAULT_POLICY: Record<AiTaskType, Omit<ModelRouterPolicy, 'taskType'>> = {
  chat: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 12000,
    evidenceRequired: true,
  },
  inline: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 6000,
    evidenceRequired: true,
  },
  research: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 18000,
    evidenceRequired: true,
  },
  pdf_summary: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 18000,
    evidenceRequired: true,
  },
  pdf_qa: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 18000,
    evidenceRequired: true,
  },
  notebook_assist: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 10000,
    evidenceRequired: true,
  },
  code_explain: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 12000,
    evidenceRequired: true,
  },
  knowledge_organize: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 20000,
    evidenceRequired: true,
  },
  task_proposal: {
    preferredProvider: null,
    fallbackProvider: null,
    maxContextTokens: 12000,
    evidenceRequired: true,
  },
};

function providerSource(providerId: AiProviderId): AiModelSource {
  return providerId === 'ollama' ? 'local' : 'cloud';
}

export function getModelRouterPolicy(
  taskType: AiTaskType,
  settings: AiRuntimeSettings,
): ModelRouterPolicy {
  const preferredProvider = settings.providerId;
  const fallbackProvider = settings.preferLocal ? 'ollama' : null;

  return {
    taskType,
    ...DEFAULT_POLICY[taskType],
    preferredProvider,
    fallbackProvider,
  };
}

export interface ModelRouterSelection {
  provider: AiProvider;
  modelInfo: AiModelInfo;
  policy: ModelRouterPolicy;
}

function chooseProvider(
  policy: ModelRouterPolicy,
  settings: AiRuntimeSettings,
): AiProvider | null {
  const preferLocal = settings.preferLocal;
  const configured = getConfiguredProviders();

  if (preferLocal) {
    const localProvider = configured.find((provider) => provider.id === 'ollama');
    if (localProvider) return localProvider;
  }

  if (policy.preferredProvider) {
    const preferred = getProvider(policy.preferredProvider);
    if (preferred?.isConfigured()) return preferred;
  }

  if (policy.fallbackProvider) {
    const fallback = getProvider(policy.fallbackProvider);
    if (fallback?.isConfigured()) return fallback;
  }

  return getDefaultProvider();
}

export function routeModel(
  taskType: AiTaskType,
  settings: AiRuntimeSettings,
): ModelRouterSelection {
  if (!settings.aiEnabled) {
    throw new Error('AI is disabled in settings');
  }

  const policy = getModelRouterPolicy(taskType, settings);
  const requestedProfileId = settings.profileId ?? useAiProviderProfileStore.getState().activeProfileId;
  const requestedProfile = requestedProfileId
    ? useAiProviderProfileStore.getState().profiles.find((profile) => profile.id === requestedProfileId) ?? null
    : null;
  const profiled = requestedProfileId ? getProfileProvider(requestedProfileId) : null;
  if (requestedProfile && !requestedProfile.enabled) {
    throw new Error(`AI connection "${requestedProfile.name}" is disabled.`);
  }
  if (requestedProfile && !profiled?.isConfigured()) {
    throw new Error(`AI connection "${requestedProfile.name}" is not configured. Check its credentials.`);
  }
  const provider = requestedProfile
    ? profiled
    : chooseProvider(policy, settings);
  if (!provider) {
    throw new Error('No AI provider configured');
  }

  const activeProfile = profiled?.isConfigured() ? requestedProfile : null;
  const selectedModel = activeProfile ? getProfileDefaultModel(activeProfile) : settings.model;
  if (!selectedModel) {
    throw new Error('No AI model configured. Select a model in Settings > AI.');
  }

  return {
    provider,
    policy,
    modelInfo: {
      providerId: provider.id,
      providerName: provider.name,
      model: selectedModel,
      source: providerSource(provider.id),
    },
  };
}
