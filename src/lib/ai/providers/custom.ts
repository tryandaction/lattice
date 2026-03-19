import type { AiModel } from '../types';
import { createOpenAiCompatibleProvider } from './openai-compatible';

const MODELS: AiModel[] = [];

export const customProvider = createOpenAiCompatibleProvider({
  id: 'custom',
  name: 'Custom (OpenAI Compatible)',
  defaultBaseUrl: 'https://api.example.com/v1',
  defaultModel: 'custom-model',
  models: MODELS,
});
