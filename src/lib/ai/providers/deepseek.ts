import type { AiModel } from '../types';
import { createOpenAiCompatibleProvider } from './openai-compatible';

const MODELS: AiModel[] = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', contextWindow: 128000, supportsStreaming: true },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', contextWindow: 128000, supportsStreaming: true },
];

export const deepseekProvider = createOpenAiCompatibleProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com',
  defaultModel: 'deepseek-chat',
  models: MODELS,
});
