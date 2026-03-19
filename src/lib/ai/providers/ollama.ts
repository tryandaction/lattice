import type {
  AiConnectionTestResult,
  AiGenerateOptions,
  AiGenerateResult,
  AiMessage,
  AiModel,
  AiProvider,
  AiStreamChunk,
} from '../types';
import { getMessageText } from '../types';
import { getBaseUrl as getUrl } from '../key-storage';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

function getRootBaseUrl(): string {
  return (getUrl('ollama') || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getCompatibilityBaseUrl(): string {
  const baseUrl = getRootBaseUrl();
  return baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
}

function formatMessages(messages: AiMessage[], systemPrompt?: string) {
  const formatted = messages.map((message) => ({
    role: message.role,
    content: getMessageText(message.content),
  }));
  if (systemPrompt) {
    formatted.unshift({ role: 'system', content: systemPrompt });
  }
  return formatted;
}

function isCorsOrNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  );
}

function buildOllamaHint(baseUrl: string): string {
  return [
    `请确认 Ollama 正在运行，并且地址为 ${baseUrl}。`,
    '推荐使用最新版 Ollama，并确保 OpenAI 兼容接口可用。',
    '网页版若跨域失败，请使用：OLLAMA_ORIGINS=* ollama serve',
  ].join(' ');
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    const error = data?.error;
    if (typeof error === 'string') return error;
    if (typeof error?.message === 'string') return error.message;
    return JSON.stringify(data);
  } catch {
    return await response.text();
  }
}

async function* parseSSE(response: Response): AsyncIterable<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return;
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
        } catch {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function fetchOllamaModels(): Promise<AiModel[]> {
  const response = await fetch(`${getRootBaseUrl()}/api/tags`);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
  const data = await response.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models.map((model: { name: string }) => ({
    id: model.name,
    name: model.name,
    provider: 'ollama',
    contextWindow: 8192,
    supportsStreaming: true,
  }));
}

async function generateViaCompat(messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> {
  const response = await fetch(`${getCompatibilityBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options?.model ?? DEFAULT_MODEL,
      messages: formatMessages(messages, options?.systemPrompt),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`compat:${response.status}:${await parseErrorMessage(response)}`);
  }

  const data = await response.json();
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    model: data?.model ?? options?.model ?? DEFAULT_MODEL,
    usage: data?.usage ? {
      promptTokens: data.usage.prompt_tokens ?? 0,
      completionTokens: data.usage.completion_tokens ?? 0,
      totalTokens: data.usage.total_tokens ?? 0,
    } : undefined,
  };
}

async function generateViaNative(messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> {
  const response = await fetch(`${getRootBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options?.model ?? DEFAULT_MODEL,
      messages: formatMessages(messages, options?.systemPrompt),
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens,
      },
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`${response.status}:${await parseErrorMessage(response)}`);
  }

  const data = await response.json();
  return {
    text: data?.message?.content ?? '',
    model: data?.model ?? options?.model ?? DEFAULT_MODEL,
    usage: data?.eval_count ? {
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
    } : undefined,
  };
}

async function* streamViaCompat(messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
  const response = await fetch(`${getCompatibilityBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options?.model ?? DEFAULT_MODEL,
      messages: formatMessages(messages, options?.systemPrompt),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stream: true,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`compat:${response.status}:${await parseErrorMessage(response)}`);
  }

  for await (const chunk of parseSSE(response)) {
    const delta = (chunk as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
    if (delta) {
      yield { type: 'text', text: delta };
    }
  }
  yield { type: 'done' };
}

async function* streamViaNative(messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
  const response = await fetch(`${getRootBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options?.model ?? DEFAULT_MODEL,
      messages: formatMessages(messages, options?.systemPrompt),
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens,
      },
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`${response.status}:${await parseErrorMessage(response)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: 'done' };
    return;
  }

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
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.done) {
          yield { type: 'done' };
          return;
        }
        if (data.message?.content) {
          yield { type: 'text', text: data.message.content };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done' };
}

export const ollamaProvider: AiProvider = {
  id: 'ollama',
  name: 'Ollama (Local)',

  isConfigured: () => true,

  testConnection: async (): Promise<AiConnectionTestResult> => {
    try {
      const models = await fetchOllamaModels();
      return {
        ok: true,
        message: models.length > 0
          ? `Ollama 连接成功，发现 ${models.length} 个模型。`
          : 'Ollama 连接成功，但当前没有已安装模型。',
      };
    } catch (error) {
      if (isCorsOrNetworkError(error)) {
        return { ok: false, message: `[Ollama CORS] ${buildOllamaHint(getRootBaseUrl())}` };
      }
      return {
        ok: false,
        message: `Ollama 连接失败：${error instanceof Error ? error.message : String(error)} ${buildOllamaHint(getRootBaseUrl())}`,
      };
    }
  },

  getAvailableModels: async (): Promise<AiModel[]> => {
    try {
      const models = await fetchOllamaModels();
      return models.length > 0 ? models : [{
        id: DEFAULT_MODEL,
        name: DEFAULT_MODEL,
        provider: 'ollama',
        contextWindow: 8192,
        supportsStreaming: true,
      }];
    } catch {
      return [{
        id: DEFAULT_MODEL,
        name: DEFAULT_MODEL,
        provider: 'ollama',
        contextWindow: 8192,
        supportsStreaming: true,
      }];
    }
  },

  generate: async (messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> => {
    try {
      return await generateViaCompat(messages, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('compat:404:') || message.startsWith('compat:400:')) {
        return generateViaNative(messages, options);
      }
      if (isCorsOrNetworkError(error)) {
        throw new Error(`[Ollama CORS] ${buildOllamaHint(getRootBaseUrl())}`);
      }
      throw new Error(`Ollama 调用失败：${message}`);
    }
  },

  stream: async function* (messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
    try {
      yield* streamViaCompat(messages, options);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('compat:404:') || message.startsWith('compat:400:')) {
        try {
          yield* streamViaNative(messages, options);
          return;
        } catch (nativeError) {
          yield { type: 'error', error: `Ollama 调用失败：${nativeError instanceof Error ? nativeError.message : String(nativeError)}` };
          return;
        }
      }
      if (isCorsOrNetworkError(error)) {
        yield { type: 'error', error: `[Ollama CORS] ${buildOllamaHint(getRootBaseUrl())}` };
        return;
      }
      yield { type: 'error', error: `Ollama 调用失败：${message}` };
    }
  },

  estimateTokens: (text: string) => Math.ceil(text.length / 4),
};
