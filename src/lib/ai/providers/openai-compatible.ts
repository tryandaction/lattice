import type {
  AiConnectionTestResult,
  AiGenerateOptions,
  AiGenerateResult,
  AiMessage,
  AiModel,
  AiProvider,
  AiProviderId,
  AiStreamChunk,
} from '../types';
import { getMessageText } from '../types';
import { extractProviderText, extractStreamTextDelta, parseSseJson } from '../provider-response';
import { getApiKey as getKey, getBaseUrl as getUrl } from '../key-storage';
import { classifyAiConnectionError } from '../provider-profiles';

export interface OpenAiCompatibleProviderConfig {
  id: Extract<AiProviderId, 'openai' | 'deepseek' | 'moonshot' | 'zhipu' | 'openrouter' | 'groq' | 'together' | 'fireworks' | 'siliconflow' | 'azure-openai' | 'custom'>;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: AiModel[];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function getApiKey(provider: AiProviderId): string {
  return getKey(provider);
}

function getBaseUrl(provider: AiProviderId, fallback: string): string {
  return normalizeBaseUrl(getUrl(provider) || fallback);
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

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    const error = data?.error;
    if (typeof error === 'string') {
      return error;
    }
    if (typeof error?.message === 'string') {
      return error.message;
    }
    return JSON.stringify(data);
  } catch {
    return await response.text();
  }
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleProviderConfig): AiProvider {
  return {
    id: config.id,
    name: config.name,

    isConfigured: () => !!getApiKey(config.id),

    testConnection: async (): Promise<AiConnectionTestResult> => {
      const apiKey = getApiKey(config.id);
      if (!apiKey) {
        return { ok: false, message: '请先填写 API Key。' };
      }

      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        const response = await fetch(`${getBaseUrl(config.id, config.defaultBaseUrl)}/models`, {
          headers: buildHeaders(apiKey),
        });

        if (!response.ok) {
          const body = await parseErrorMessage(response);
          const classified = classifyAiConnectionError({ status: response.status, responseBody: body });
          return { ...classified, message: `${config.name}：${classified.message}`, latencyMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started), requestId: response.headers.get('x-request-id') ?? undefined };
        }

        return { ok: true, message: `${config.name} 连接成功。`, latencyMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started), requestId: response.headers.get('x-request-id') ?? undefined };
      } catch (error) {
        const classified = classifyAiConnectionError({ error });
        return { ...classified, message: `${config.name}：${classified.message}`, latencyMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started) };
      }
    },

    getAvailableModels: async (): Promise<AiModel[]> => {
      const apiKey = getApiKey(config.id);
      if (!apiKey) {
        return config.models;
      }

      try {
        const response = await fetch(`${getBaseUrl(config.id, config.defaultBaseUrl)}/models`, {
          headers: buildHeaders(apiKey),
        });
        if (!response.ok) {
          return config.models;
        }

        const data = await response.json();
        const remoteModels: unknown[] = Array.isArray(data?.data) ? data.data : [];
        if (remoteModels.length === 0) {
          return config.models;
        }

        return remoteModels
          .filter((item: unknown): item is { id: string } => typeof (item as { id?: unknown })?.id === 'string')
          .map((item: { id: string }) => ({
            id: item.id,
            name: item.id,
            provider: config.id,
            contextWindow: config.models.find((model) => model.id === item.id)?.contextWindow ?? 128000,
            supportsStreaming: true,
          }));
      } catch {
        return config.models;
      }
    },

    generate: async (messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> => {
      const apiKey = getApiKey(config.id);
      if (!apiKey) {
        throw new Error(`Missing API key for ${config.name}`);
      }

      let response: Response;
      try {
        response = await fetch(`${getBaseUrl(config.id, config.defaultBaseUrl)}/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(apiKey),
          body: JSON.stringify({
            model: options?.model ?? config.defaultModel,
            messages: formatMessages(messages, options?.systemPrompt),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens,
          }),
          signal: options?.signal,
        });
      } catch (error) {
        throw new Error(`${config.name} 网络连接失败：${error instanceof Error ? error.message : String(error)}`);
      }

      if (!response.ok) {
        throw new Error(`${config.name} API 错误 ${response.status}: ${await parseErrorMessage(response)}`);
      }

      const data = await response.json();
      return {
        text: extractProviderText(data?.choices?.[0]?.message?.content),
        model: data?.model ?? options?.model ?? config.defaultModel,
        usage: data?.usage ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        } : undefined,
      };
    },

    stream: async function* (messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
      const apiKey = getApiKey(config.id);
      if (!apiKey) {
        yield { type: 'error', error: `Missing API key for ${config.name}` };
        return;
      }

      let response: Response;
      try {
        response = await fetch(`${getBaseUrl(config.id, config.defaultBaseUrl)}/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(apiKey),
          body: JSON.stringify({
            model: options?.model ?? config.defaultModel,
            messages: formatMessages(messages, options?.systemPrompt),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens,
            stream: true,
          }),
          signal: options?.signal,
        });
      } catch (error) {
        yield { type: 'error', error: `${config.name} 网络连接失败：${error instanceof Error ? error.message : String(error)}` };
        return;
      }

      if (!response.ok) {
        yield { type: 'error', error: `${config.name} API 错误 ${response.status}: ${await parseErrorMessage(response)}` };
        return;
      }

      try {
        for await (const chunk of parseSseJson(response)) {
          const delta = extractStreamTextDelta((chunk as { choices?: Array<{ delta?: unknown }> }).choices?.[0]?.delta);
          if (delta) {
            yield { type: 'text', text: delta };
          }
        }
      } catch (error) {
        yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
        return;
      }
      yield { type: 'done' };
    },

    estimateTokens: (text: string) => Math.ceil(text.length / 4),
  };
}

export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl);
}
