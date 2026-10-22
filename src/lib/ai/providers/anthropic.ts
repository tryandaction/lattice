import type { AiProvider, AiModel, AiMessage, AiGenerateOptions, AiGenerateResult, AiStreamChunk } from '../types';
import { getMessageText } from '../types';
import { parseSseJson, extractProviderText } from '../provider-response';
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

  // Anthropic requires the first non-system message to be from the user.
  if (filtered[0]?.role !== 'user') filtered.unshift({ role: 'user', content: '' });
  const normalized = filtered.reduce<Array<{ role: string; content: string }>>((result, message) => {
    const previous = result[result.length - 1];
    if (previous?.role === message.role) previous.content = `${previous.content}\n\n${message.content}`;
    else result.push(message);
    return result;
  }, []);

  const body: Record<string, unknown> = {
    model: options?.model ?? 'claude-sonnet-4-5-20250929',
    messages: normalized,
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.7,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (stream) body.stream = true;

  return body;
}

async function* parseAnthropicSSE(response: Response): AsyncIterable<AiStreamChunk> {
  try {
    for await (const event of parseSseJson(response)) {
      const type = (event as { type?: unknown }).type;
      if (type === 'content_block_delta') {
        const text = extractProviderText((event as { delta?: { text?: unknown } }).delta?.text);
        if (text) yield { type: 'text', text };
      } else if (type === 'message_stop') {
        yield { type: 'done' };
        return;
      } else if (type === 'error') {
        const message = (event as { error?: { message?: unknown } }).error?.message;
        yield { type: 'error', error: typeof message === 'string' ? message : 'Unknown provider error' };
        return;
      }
    }
  } catch (error) {
    yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    return;
  }
  yield { type: 'done' };
}

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  name: 'Anthropic',

  isConfigured: () => !!getApiKey(),

  testConnection: async () => {
    if (!getApiKey()) {
      return { ok: false, message: '请先填写 Anthropic API Key。' };
    }
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
      return res.ok
        ? { ok: true, message: 'Anthropic 连接成功。' }
        : { ok: false, message: `Anthropic 连接失败：${res.status}` };
    } catch (error) {
      return { ok: false, message: `Anthropic 网络连接失败：${error instanceof Error ? error.message : String(error)}` };
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
