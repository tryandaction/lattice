import type { AiModel } from '../types';
import { createOpenAiCompatibleProvider } from './openai-compatible';

const MODELS: AiModel[] = [
  { id: 'moonshot-v1-8k', name: 'Kimi / Moonshot 8K', provider: 'moonshot', contextWindow: 8192, supportsStreaming: true },
  { id: 'moonshot-v1-32k', name: 'Kimi / Moonshot 32K', provider: 'moonshot', contextWindow: 32768, supportsStreaming: true },
  { id: 'moonshot-v1-128k', name: 'Kimi / Moonshot 128K', provider: 'moonshot', contextWindow: 131072, supportsStreaming: true },
];

export const moonshotProvider = createOpenAiCompatibleProvider({
  id: 'moonshot',
  name: 'Kimi (Moonshot)',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  defaultModel: 'moonshot-v1-32k',
  models: MODELS,
});
