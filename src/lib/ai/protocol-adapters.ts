import type {
  AiContentPart,
  AiGenerateOptions,
  AiGenerateResult,
  AiMessage,
  AiProviderProfile,
  AiProtocol,
  AiStreamChunk,
  AiResponseDiagnostics,
} from "./types";
import { extractProviderText, extractStreamTextDelta, parseSseJson } from "./provider-response";
import { createOutputDiagnostics, protocolStopReason } from './provider-output-diagnostics';
import { getProfileModelOutputLimit } from './provider-profiles';

export interface ProtocolRequest {
  url: string;
  init: RequestInit;
}

function joinUrl(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

function protocolUrl(profile: AiProviderProfile, suffix: string): string {
  const base = profile.baseUrl.replace(/\/+$/, "");
  if (profile.protocol === "anthropic-messages" && suffix.startsWith("/v1/") && base.endsWith("/v1")) {
    return `${base}${suffix.slice(3)}`;
  }
  return joinUrl(profile.baseUrl, suffix);
}

function authHeaders(profile: AiProviderProfile, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...profile.customHeaders,
  };
  if (!apiKey) return headers;
  if (profile.authMode === "bearer") headers.Authorization = `Bearer ${apiKey}`;
  if (profile.authMode === "api-key") {
    // Gemini's REST API uses the documented x-goog-api-key header.
    headers[profile.protocol === "gemini-generate-content" ? "x-goog-api-key" : "api-key"] = apiKey;
  }
  if (profile.authMode === "x-api-key") headers["x-api-key"] = apiKey;
  return headers;
}

function appendQueryKey(url: string, apiKey: string): string {
  if (!apiKey) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("key", apiKey);
  return parsed.toString();
}

type ImagePart = { type: 'image'; data?: string; mimeType?: string };
type TextPart = { type: 'text'; text?: string };
type InputPart = TextPart | ImagePart;

function assertImagePart(part: AiContentPart): asserts part is ImagePart & { data: string; mimeType: string } {
  if (!part.data || !part.mimeType || !/^image\/(?:png|jpeg|jpg|webp)$/i.test(part.mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data)) {
    throw new Error('Image content requires base64 PNG, JPEG, or WEBP bytes.');
  }
}

function messageParts(message: AiMessage): InputPart[] {
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }];
  return message.content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text ?? '' };
    assertImagePart(part);
    return part;
  });
}

function textMessages(messages: AiMessage[]): Array<{ role: string; content: string | InputPart[] }> {
  return messages.map((message) => {
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    const parts = messageParts(message);
    return { role: message.role, content: parts.length && parts.some(part => part.type === 'image') ? parts : extractProviderText(parts) };
  });
}

function openAiChatMessages(messages: AiMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    const parts = messageParts(message);
    return {
      role: message.role,
      content: parts.map((part) => part.type === 'text'
        ? { type: 'text', text: part.text ?? '' }
        : { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }),
    };
  });
}

function openAiResponsesInput(messages: AiMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === 'string') return message;
    return { role: message.role, content: messageParts(message).map((part) => part.type === 'text'
      ? { type: 'input_text', text: part.text ?? '' }
      : { type: 'input_image', image_url: `data:${part.mimeType};base64,${part.data}` }) };
  });
}

function buildGeminiContents(messages: AiMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: messageParts(message).map((part) => part.type === 'text'
        ? { text: part.text ?? '' }
        : { inlineData: { mimeType: part.mimeType, data: part.data } }),
    }));
}

function buildAnthropicMessages(messages: AiMessage[]): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
  const normalized = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      content: typeof message.content === 'string' ? message.content : messageParts(message).map((part) => part.type === 'text'
        ? { type: 'text', text: part.text ?? '' }
        : { type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } }),
    }));
  if (normalized[0]?.role !== "user") normalized.unshift({ role: "user", content: "" });
  return normalized.reduce<Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>>((result, message) => {
    const previous = result[result.length - 1];
    if (previous?.role === message.role) {
      if (typeof previous.content === 'string' && typeof message.content === 'string') previous.content = `${previous.content}\n\n${message.content}`;
      else {
        const left = typeof previous.content === 'string' ? [{ type: 'text', text: previous.content }] : previous.content;
        const right = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
        previous.content = [...left, ...right];
      }
    }
    else result.push(message);
    return result;
  }, []);
}

export function buildProtocolRequest(
  protocol: AiProtocol,
  profile: AiProviderProfile,
  apiKey: string,
  messages: AiMessage[],
  options: AiGenerateOptions & { stream?: boolean } = {},
): ProtocolRequest {
  const imageBytes = messages.reduce((total, message) => total + messageParts(message).reduce((sum, part) => {
    if (part.type !== 'image') return sum;
    const data = part.data ?? '';
    const bytes = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (bytes > 10 * 1024 * 1024) throw new Error('Image attachment exceeds the 10 MB limit.');
    return sum + bytes;
  }, 0), 0);
  if (imageBytes > 32 * 1024 * 1024) throw new Error('Image attachments exceed the 32 MB request limit.');
  const model = options.model ?? profile.model ?? "default";
  const outputLimit = getProfileModelOutputLimit(profile, model);
  const requestedTokens = options.maxTokens ?? (protocol === 'anthropic-messages' ? 4096 : undefined);
  if (outputLimit && Number.isFinite(outputLimit) && outputLimit > 0 && requestedTokens !== undefined && requestedTokens > outputLimit) {
    options = { ...options, maxTokens: Math.max(1, Math.floor(outputLimit)) };
  }
  const signal = options.signal;
  const requestUrl = (url: string) => profile.authMode === "query-key" ? appendQueryKey(url, apiKey) : url;
  if (protocol === "openai-chat-completions") {
    return {
      url: requestUrl(joinUrl(profile.baseUrl, "/chat/completions")),
      init: {
        method: "POST",
        headers: authHeaders(profile, apiKey),
        body: JSON.stringify({
          model,
          messages: openAiChatMessages(messages),
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          ...(options.stream ? { stream: true } : {}),
        }),
        signal,
      },
    };
  }

  if (protocol === "openai-responses") {
    return {
      url: requestUrl(joinUrl(profile.baseUrl, "/responses")),
      init: {
        method: "POST",
        headers: authHeaders(profile, apiKey),
        body: JSON.stringify({
          model,
          input: openAiResponsesInput(messages),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens }),
          ...(options.stream ? { stream: true } : {}),
        }),
        signal,
      },
    };
  }

  if (protocol === "anthropic-messages") {
    const allMessages = textMessages(messages);
    const system = allMessages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    return {
      url: requestUrl(protocolUrl(profile, "/v1/messages")),
      init: {
        method: "POST",
        headers: { ...authHeaders(profile, apiKey), "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model,
          messages: buildAnthropicMessages(messages),
          max_tokens: options.maxTokens ?? 4096,
          ...(system ? { system } : {}),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.stream ? { stream: true } : {}),
        }),
        signal,
      },
    };
  }

  if (protocol === "gemini-generate-content") {
    const url = requestUrl(joinUrl(profile.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:${options.stream ? "streamGenerateContent?alt=sse" : "generateContent"}`));
    return {
      url,
      init: {
        method: "POST",
        headers: authHeaders(profile, apiKey),
        body: JSON.stringify({
          contents: buildGeminiContents(messages),
          generationConfig: {
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            ...(options.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
          },
        }),
        signal,
      },
    };
  }

  return {
    url: requestUrl(joinUrl(profile.baseUrl, "/api/chat")),
    init: {
      method: "POST",
      headers: authHeaders(profile, apiKey),
      body: JSON.stringify({
        model,
        messages: textMessages(messages).map(message => {
          if (typeof message.content === 'string') return message;
          const images = message.content.filter((part): part is ImagePart & { data: string } => part.type === 'image').map(part => part.data);
          return { role: message.role, content: message.content.filter((part): part is TextPart => part.type === 'text').map(part => part.text ?? '').join(''), ...(images.length ? { images } : {}) };
        }),
        stream: Boolean(options.stream),
        options: {
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { num_predict: options.maxTokens }),
        },
      }),
      signal,
    },
  };
}

function responseText(protocol: AiProtocol, data: Record<string, unknown>): string {
  if (protocol === "openai-responses") {
    if (typeof data.output_text === "string") return data.output_text;
    const output = Array.isArray(data.output) ? data.output : [];
    return extractProviderText(output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      if ((item as { type?: unknown }).type !== 'message') return [];
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content.flatMap(part => part?.type === 'output_text' && typeof part.text === 'string' ? [part.text] : []) : [];
    }));
  }
  if (protocol === "openai-chat-completions") {
    return extractProviderText((data.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]?.message?.content);
  }
  if (protocol === "anthropic-messages") {
    return extractProviderText(data.content);
  }
  if (protocol === "gemini-generate-content") {
    const parts = (data.candidates as Array<{ content?: { parts?: Array<{ text?: unknown; thought?: boolean }> } }> | undefined)?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.filter(part => part && part.thought !== true && typeof part.text === 'string').map(part => part.text).join('') : '';
  }
  return extractProviderText((data.message as { content?: unknown } | undefined)?.content);
}

export async function parseProtocolResponse(
  protocol: AiProtocol,
  response: Response,
  fallbackModel: string,
): Promise<AiGenerateResult> {
  const data = await response.json() as Record<string, unknown>;
  const text = responseText(protocol, data);
  const finishReason = responseFinishReason(protocol, data);
  const diagnostics = createOutputDiagnostics(protocol, 'response');
  diagnostics.observe(data, text.length);
  const responseDiagnostics = diagnostics.snapshot(finishReason);
  return {
    text,
    finishReason,
    model: typeof data.model === "string" ? data.model : fallbackModel,
    usage: responseDiagnostics.usage,
    responseDiagnostics,
  };
}

function responseFinishReason(protocol: AiProtocol, data: Record<string, unknown>): AiGenerateResult['finishReason'] {
  const raw = protocolStopReason(protocol, data);
  if (raw === undefined || raw === null) return undefined;
  if (['max_tokens', 'length', 'max_output_tokens', 'MAX_TOKENS'].includes(String(raw))) return 'length';
  if (['refusal', 'content_filter', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(String(raw))) return 'refusal';
  if (['tool_use', 'tool_calls', 'function_call'].includes(String(raw))) return 'tool_calls';
  if (['end_turn', 'stop_sequence', 'stop', 'completed', 'STOP'].includes(String(raw))) return 'stop';
  return 'unknown';
}

export async function* parseProtocolStream(
  protocol: AiProtocol,
  response: Response,
  onDiagnostics?: (diagnostics: AiResponseDiagnostics) => void,
): AsyncIterable<AiStreamChunk> {
  let receivedDoneMarker = false;
  const diagnostics = createOutputDiagnostics(protocol, 'stream');
  let terminalReason: AiGenerateResult['finishReason'];
  try {
    for await (const data of parseSseJson(response, { onDone: () => { receivedDoneMarker = true; }, strict: true })) {
      let text = '';
      if (protocol === 'openai-responses' && data.type === 'response.output_text.delta' && typeof data.delta === 'string') text = data.delta;
      else if (protocol === 'openai-chat-completions') {
        const delta = (data.choices as Array<{ delta?: unknown }> | undefined)?.[0]?.delta;
        text = typeof delta === 'string' ? delta : extractStreamTextDelta(delta);
      } else if (protocol === 'anthropic-messages' && data.type === 'content_block_delta') {
        text = extractProviderText((data.delta as { text?: unknown } | undefined)?.text);
      } else if (protocol === 'gemini-generate-content') {
        const parts = (data.candidates as Array<{ content?: { parts?: Array<{ text?: unknown; thought?: boolean }> } }> | undefined)?.[0]?.content?.parts;
        text = Array.isArray(parts) ? parts.filter(part => part && part.thought !== true && typeof part.text === 'string').map(part => part.text).join('') : '';
      } else if (protocol === 'ollama-native') text = extractProviderText((data.message as { content?: unknown } | undefined)?.content);
      diagnostics.observe(data, text.length);
      if (text) yield { type: 'text', text };
      const completionData = protocol === 'anthropic-messages' && data.type === 'message_delta'
        ? data.delta as Record<string, unknown>
        : protocol === 'openai-responses' && (data.type === 'response.incomplete' || data.type === 'response.completed')
          ? data.response as Record<string, unknown> : data;
      const finishReason = completionData && responseFinishReason(protocol, completionData);
      if (finishReason) terminalReason = finishReason;
      if (finishReason === 'length' || data.type === 'response.incomplete') {
        yield { type: 'error', code: 'output_limit', error: 'The provider output was truncated at its token limit; the answer needs continuation.' };
        return;
      }
      if (finishReason === 'refusal') {
        yield { type: 'error', code: 'refusal', error: 'The provider declined to complete this answer.' };
        return;
      }
      if (finishReason === 'tool_calls') {
        yield { type: 'error', code: 'tool_calls', error: 'The provider requested a tool instead of completing the text answer.' };
        return;
      }
      if (data.type === 'error' || data.type === 'response.failed' || data.error) {
        const error = data.error ?? (data.response as { error?: unknown } | undefined)?.error;
        const message = typeof error === 'string' ? error : (error as { message?: unknown } | undefined)?.message;
        yield { type: 'error', error: typeof message === 'string' ? message : 'The provider reported a failed response.' };
        return;
      }
      if ((protocol === 'openai-responses' && data.type === 'response.completed')
        || (protocol === 'anthropic-messages' && data.type === 'message_stop')
        || ((protocol === 'openai-chat-completions' || protocol === 'gemini-generate-content') && finishReason === 'stop')
        || (protocol === 'ollama-native' && data.done === true)) {
        terminalReason ??= 'stop';
        yield { type: "done" };
        return;
      }
    }
    yield protocol === 'openai-chat-completions' && receivedDoneMarker
      ? { type: 'done' }
      : { type: 'error', code: 'incomplete_stream', error: 'The provider stream ended before its completion event. The partial answer is incomplete; retry to continue.' };
  } catch (error) {
    yield { type: "error", error: error instanceof Error ? error.message : String(error) };
    return;
  } finally {
    onDiagnostics?.(diagnostics.snapshot(terminalReason ?? (receivedDoneMarker ? 'stop' : undefined)));
  }
}

export function modelListUrl(profile: AiProviderProfile, apiKey = ""): string {
  const url = profile.protocol === "ollama-native"
    ? joinUrl(profile.baseUrl, "/api/tags")
    : profile.protocol === "gemini-generate-content"
      ? joinUrl(profile.baseUrl, "/v1beta/models")
      : profile.protocol === "anthropic-messages"
        ? protocolUrl(profile, "/v1/models")
        : joinUrl(profile.baseUrl, "/models");
  return profile.authMode === "query-key" ? appendQueryKey(url, apiKey) : url;
}
