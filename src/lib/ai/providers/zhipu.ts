import type { AiModel } from '../types';
import { createOpenAiCompatibleProvider } from './openai-compatible';

const MODELS: AiModel[] = [
  { id: 'glm-4-plus', name: 'GLM-4 Plus', provider: 'zhipu', contextWindow: 128000, supportsStreaming: true },
  { id: 'glm-4-air', name: 'GLM-4 Air', provider: 'zhipu', contextWindow: 128000, supportsStreaming: true },
  { id: 'glm-4-flash', name: 'GLM-4 Flash', provider: 'zhipu', contextWindow: 128000, supportsStreaming: true },
];

export const zhipuProvider = createOpenAiCompatibleProvider({
  id: 'zhipu',
  name: '智谱 AI',
  defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  defaultModel: 'glm-4-flash',
  models: MODELS,
});
