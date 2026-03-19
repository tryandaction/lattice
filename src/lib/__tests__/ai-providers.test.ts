import { describe, expect, it } from 'vitest';
import { getProvider } from '../ai/providers';

describe('ai providers registry', () => {
  it('exposes common chinese providers and custom provider', () => {
    expect(getProvider('deepseek')?.name).toBe('DeepSeek');
    expect(getProvider('moonshot')?.name).toBe('Kimi (Moonshot)');
    expect(getProvider('zhipu')?.name).toBe('智谱 AI');
    expect(getProvider('custom')?.name).toBe('Custom (OpenAI Compatible)');
  });
});
