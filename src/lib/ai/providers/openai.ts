import type { AiModel } from '../types';
import { createOpenAiCompatibleProvider } from './openai-compatible';

const MODELS: AiModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, supportsStreaming: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, supportsStreaming: true },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextWindow: 128000, supportsStreaming: true },
  { id: 'o3-mini', name: 'o3-mini', provider: 'openai', contextWindow: 200000, supportsStreaming: true },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', contextWindow: 1047576, supportsStreaming: true },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', contextWindow: 1047576, supportsStreaming: true },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'openai', contextWindow: 1047576, supportsStreaming: true },
  { id: 'o3', name: 'o3', provider: 'openai', contextWindow: 200000, supportsStreaming: true },
  { id: 'o4-mini', name: 'o4-mini', provider: 'openai', contextWindow: 200000, supportsStreaming: true },
];

export const openaiProvider = createOpenAiCompatibleProvider({
  id: 'openai',
  name: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  models: MODELS,
});
