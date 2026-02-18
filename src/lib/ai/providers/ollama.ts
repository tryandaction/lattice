import type { AiProvider, AiModel, AiMessage, AiGenerateOptions, AiGenerateResult, AiStreamChunk } from '../types';
import { getMessageText } from '../types';
import { getBaseUrl as getUrl } from '../key-storage';

function getBaseUrl(): string {
  return getUrl('ollama') || 'http://localhost:11434';
}

export const ollamaProvider: AiProvider = {
  id: 'ollama',
  name: 'Ollama (Local)',

  isConfigured: () => true, // Always "configured" — just needs Ollama running

  testConnection: async () => {
    try {
      const res = await fetch(`${getBaseUrl()}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  },

  getAvailableModels: async (): Promise<AiModel[]> => {
    try {
      const res = await fetch(`${getBaseUrl()}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json();
      const models = (data.models ?? []) as Array<{ name: string; details?: { parameter_size?: string } }>;
      return models.map((m) => ({
        id: m.name,
        name: m.name,
        provider: 'ollama' as const,
        contextWindow: 8192, // Conservative default; varies by model
        supportsStreaming: true,
      }));
    } catch {
      return [];
    }
  },

  generate: async (messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> => {
    const model = options?.model ?? 'llama3.2';
    const formatted = messages.map((m) => ({ role: m.role, content: getMessageText(m.content) }));
    if (options?.systemPrompt) {
      formatted.unshift({ role: 'system', content: options.systemPrompt });
    }

    const res = await fetch(`${getBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: formatted,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return {
      text: data.message?.content ?? '',
      model: data.model ?? model,
      usage: data.eval_count ? {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      } : undefined,
    };
  },

  stream: async function* (messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
    const model = options?.model ?? 'llama3.2';
    const formatted = messages.map((m) => ({ role: m.role, content: getMessageText(m.content) }));
    if (options?.systemPrompt) {
      formatted.unshift({ role: 'system', content: options.systemPrompt });
    }

    const res = await fetch(`${getBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: formatted,
        stream: true,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      yield { type: 'error', error: `Ollama error ${res.status}: ${err}` };
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Ollama streams newline-delimited JSON
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.done) {
              yield { type: 'done' };
              return;
            }
            if (data.message?.content) {
              yield { type: 'text', text: data.message.content };
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: 'done' };
  },

  estimateTokens: (text: string) => Math.ceil(text.length / 4),
};
