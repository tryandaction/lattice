import type { AiProvider, AiModel, AiMessage, AiGenerateOptions, AiGenerateResult, AiStreamChunk } from '../types';
import { getMessageText } from '../types';
import { extractProviderText, parseSseJson } from '../provider-response';
import { getApiKey as getKey, getBaseUrl as getUrl } from '../key-storage';

const MODELS: AiModel[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', contextWindow: 1048576, supportsStreaming: true },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', contextWindow: 1048576, supportsStreaming: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', contextWindow: 1048576, supportsStreaming: true },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', provider: 'google', contextWindow: 1048576, supportsStreaming: true },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google', contextWindow: 2097152, supportsStreaming: true },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'google', contextWindow: 1048576, supportsStreaming: true },
];

function getApiKey(): string {
  return getKey('google');
}

function getBaseUrl(): string {
  return getUrl('google') || 'https://generativelanguage.googleapis.com';
}

function buildGeminiContents(messages: AiMessage[], systemPrompt?: string) {
  const systemInstruction = systemPrompt
    ? { parts: [{ text: systemPrompt }] }
    : undefined;

  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let pendingSystem = '';

  for (const m of messages) {
    if (m.role === 'system') {
      pendingSystem += (pendingSystem ? '\n\n' : '') + getMessageText(m.content);
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    let text = getMessageText(m.content);
    if (pendingSystem) {
      text = pendingSystem + '\n\n' + text;
      pendingSystem = '';
    }
    contents.push({ role, parts: [{ text }] });
  }

  // If only system messages, wrap as user
  if (contents.length === 0 && pendingSystem) {
    contents.push({ role: 'user', parts: [{ text: pendingSystem }] });
  }

  return { contents, systemInstruction };
}

export const googleProvider: AiProvider = {
  id: 'google',
  name: 'Google Gemini',

  isConfigured: () => !!getApiKey(),

  testConnection: async () => {
    if (!getApiKey()) {
      return { ok: false, message: '请先填写 Google API Key。' };
    }
    try {
      const res = await fetch(
        `${getBaseUrl()}/v1beta/models?key=${getApiKey()}`
      );
      return res.ok
        ? { ok: true, message: 'Google Gemini 连接成功。' }
        : { ok: false, message: `Google Gemini 连接失败：${res.status}` };
    } catch (error) {
      return { ok: false, message: `Google Gemini 网络连接失败：${error instanceof Error ? error.message : String(error)}` };
    }
  },

  getAvailableModels: async () => MODELS,

  generate: async (messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> => {
    const model = options?.model ?? 'gemini-2.0-flash';
    const { contents, systemInstruction } = buildGeminiContents(messages, options?.systemPrompt);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 4096,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    let res: Response;
    try {
      res = await fetch(
        `${getBaseUrl()}/v1beta/models/${model}:generateContent?key=${getApiKey()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: options?.signal,
        }
      );
    } catch (err) {
      throw new Error(`Network error connecting to Gemini API: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${err}`);
    }

    const data = await res.json().catch(() => { throw new Error('Failed to parse Gemini API response'); });
    const text = extractProviderText(data.candidates?.[0]?.content?.parts);

    return {
      text,
      model,
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata.totalTokenCount ?? 0,
      } : undefined,
    };
  },

  stream: async function* (messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
    const model = options?.model ?? 'gemini-2.0-flash';
    const { contents, systemInstruction } = buildGeminiContents(messages, options?.systemPrompt);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 4096,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    let res: Response;
    try {
      res = await fetch(
        `${getBaseUrl()}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${getApiKey()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: options?.signal,
        }
      );
    } catch (err) {
      yield { type: 'error', error: `Network error connecting to Gemini API: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    if (!res.ok) {
      const err = await res.text();
      yield { type: 'error', error: `Gemini API error ${res.status}: ${err}` };
      return;
    }

    try {
      for await (const data of parseSseJson(res)) {
        const text = extractProviderText((data as { candidates?: Array<{ content?: { parts?: unknown } }> }).candidates?.[0]?.content?.parts);
        if (text) {
          yield { type: 'text', text };
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
