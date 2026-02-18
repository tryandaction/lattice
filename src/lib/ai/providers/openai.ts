import type { AiProvider, AiProviderId, AiModel, AiMessage, AiGenerateOptions, AiGenerateResult, AiStreamChunk } from '../types';
import { getApiKey as getKey, getBaseUrl as getUrl } from '../key-storage';

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

function getApiKey(): string {
  return getKey('openai');
}

function getBaseUrl(): string {
  return getUrl('openai') || 'https://api.openai.com/v1';
}

async function* parseSSE(response: Response): AsyncIterable<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data);
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const openaiProvider: AiProvider = {
  id: 'openai',
  name: 'OpenAI',

  isConfigured: () => !!getApiKey(),

  testConnection: async () => {
    try {
      const res = await fetch(`${getBaseUrl()}/models`, {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  getAvailableModels: async () => MODELS,

  generate: async (messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> => {
    let res: Response;
    try {
      res = await fetch(`${getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
          model: options?.model ?? 'gpt-4o-mini',
          messages: formatMessages(messages, options?.systemPrompt),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens,
        }),
        signal: options?.signal,
      });
    } catch (err) {
      throw new Error(`Network error connecting to OpenAI API: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json().catch(() => { throw new Error('Failed to parse OpenAI API response'); });
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? options?.model ?? 'gpt-4o-mini',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      } : undefined,
    };
  },

  stream: async function* (messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
    let res: Response;
    try {
      res = await fetch(`${getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
          model: options?.model ?? 'gpt-4o-mini',
          messages: formatMessages(messages, options?.systemPrompt),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens,
          stream: true,
        }),
        signal: options?.signal,
      });
    } catch (err) {
      yield { type: 'error', error: `Network error connecting to OpenAI API: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    if (!res.ok) {
      const err = await res.text();
      yield { type: 'error', error: `OpenAI API error ${res.status}: ${err}` };
      return;
    }

    for await (const chunk of parseSSE(res)) {
      const delta = (chunk as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
      if (delta) {
        yield { type: 'text', text: delta };
      }
    }
    yield { type: 'done' };
  },

  estimateTokens: (text: string) => Math.ceil(text.length / 4),
};

function formatMessages(messages: AiMessage[], systemPrompt?: string) {
  const formatted = messages.map((m) => ({ role: m.role, content: m.content }));
  if (systemPrompt) {
    formatted.unshift({ role: 'system', content: systemPrompt });
  }
  return formatted;
}
