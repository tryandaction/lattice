import type { AiProvider, AiModel, AiMessage, AiGenerateOptions, AiGenerateResult, AiStreamChunk } from '../types';
import { getMessageText } from '../types';
import { getApiKey as getKey, getBaseUrl as getUrl } from '../key-storage';

const MODELS: AiModel[] = [
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic', contextWindow: 200000, supportsStreaming: true },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', contextWindow: 200000, supportsStreaming: true },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextWindow: 200000, supportsStreaming: true },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200000, supportsStreaming: true },
];

function getApiKey(): string {
  return getKey('anthropic');
}

function getBaseUrl(): string {
  return getUrl('anthropic') || 'https://api.anthropic.com';
}

function buildAnthropicBody(messages: AiMessage[], options?: AiGenerateOptions, stream = false) {
  // Anthropic uses a separate `system` param, not in messages array
  let systemPrompt = options?.systemPrompt ?? '';
  const filtered: Array<{ role: string; content: string }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${getMessageText(m.content)}` : getMessageText(m.content);
    } else {
      filtered.push({ role: m.role, content: getMessageText(m.content) });
    }
  }

  // Ensure messages alternate user/assistant; Anthropic requires first message to be user
  if (filtered.length === 0) {
    filtered.push({ role: 'user', content: '(empty)' });
  }

  const body: Record<string, unknown> = {
    model: options?.model ?? 'claude-sonnet-4-5-20250929',
    messages: filtered,
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.7,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (stream) body.stream = true;

  return body;
}

async function* parseAnthropicSSE(response: Response): AsyncIterable<AiStreamChunk> {
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
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.text) {
            yield { type: 'text', text: event.delta.text };
          } else if (event.type === 'message_stop') {
            yield { type: 'done' };
            return;
          } else if (event.type === 'error') {
            yield { type: 'error', error: event.error?.message ?? 'Unknown error' };
            return;
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: 'done' };
}

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  name: 'Anthropic',

  isConfigured: () => !!getApiKey(),

  testConnection: async () => {
    try {
      const res = await fetch(`${getBaseUrl()}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': getApiKey(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
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
      res = await fetch(`${getBaseUrl()}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': getApiKey(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(buildAnthropicBody(messages, options)),
        signal: options?.signal,
      });
    } catch (err) {
      throw new Error(`Network error connecting to Anthropic API: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      throw new Error('Failed to parse Anthropic API response');
    }
    const text = (data.content as Array<{ text?: string }>)?.map((b) => b.text ?? '').join('') ?? '';
    return {
      text,
      model: (data.model as string) ?? options?.model ?? 'claude-sonnet-4-5-20250929',
      usage: data.usage ? {
        promptTokens: (data.usage as Record<string, number>).input_tokens ?? 0,
        completionTokens: (data.usage as Record<string, number>).output_tokens ?? 0,
        totalTokens: ((data.usage as Record<string, number>).input_tokens ?? 0) + ((data.usage as Record<string, number>).output_tokens ?? 0),
      } : undefined,
    };
  },

  stream: async function* (messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
    let res: Response;
    try {
      res = await fetch(`${getBaseUrl()}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': getApiKey(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(buildAnthropicBody(messages, options, true)),
        signal: options?.signal,
      });
    } catch (err) {
      yield { type: 'error', error: `Network error connecting to Anthropic API: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    if (!res.ok) {
      const err = await res.text();
      yield { type: 'error', error: `Anthropic API error ${res.status}: ${err}` };
      return;
    }

    yield* parseAnthropicSSE(res);
  },

  estimateTokens: (text: string) => Math.ceil(text.length / 4),
};
