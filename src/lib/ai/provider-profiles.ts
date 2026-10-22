import type {
  AiAuthMode,
  AiConnectionErrorCode,
  AiConnectionTestResult,
  AiProviderId,
  AiProtocol,
  AiProviderProfile,
  AiModelConfig,
} from "./types";

export interface AiProviderPreset {
  id: string;
  name: string;
  provider: AiProviderId;
  protocol: AiProtocol;
  defaultBaseUrl: string;
  defaultModel: string | null;
  defaultModels: readonly AiModelConfig[];
  authMode: AiAuthMode;
  description: string;
}

const DEFAULT_PRIVACY = {
  sendCurrentFile: true,
  sendAnnotations: true,
  sendChatHistory: true,
  sendWorkspaceIndex: true,
};

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  { id: "openai-chat", name: "OpenAI (Chat Completions)", provider: "openai", protocol: "openai-chat-completions", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "OpenAI-compatible chat endpoint. Fetch models from this connection." },
  { id: "openai-responses", name: "OpenAI (Responses)", provider: "openai", protocol: "openai-responses", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "OpenAI Responses API. Fetch models from this connection." },
  { id: "anthropic", name: "Anthropic", provider: "anthropic", protocol: "anthropic-messages", defaultBaseUrl: "https://api.anthropic.com", defaultModel: null, defaultModels: [], authMode: "x-api-key", description: "Anthropic Messages protocol. Fetch models from this connection." },
  { id: "gemini", name: "Google Gemini", provider: "google", protocol: "gemini-generate-content", defaultBaseUrl: "https://generativelanguage.googleapis.com", defaultModel: null, defaultModels: [], authMode: "api-key", description: "Gemini Generate Content protocol. Fetch models from this connection." },
  { id: "ollama-native", name: "Ollama (Native)", provider: "ollama", protocol: "ollama-native", defaultBaseUrl: "http://localhost:11434", defaultModel: null, defaultModels: [], authMode: "none", description: "Local Ollama native API. Fetch installed models from this connection." },
  { id: "openrouter", name: "OpenRouter", provider: "openrouter", protocol: "openai-chat-completions", defaultBaseUrl: "https://openrouter.ai/api/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "OpenAI-compatible routing channel. Fetch models from this connection." },
  { id: "groq", name: "Groq", provider: "groq", protocol: "openai-chat-completions", defaultBaseUrl: "https://api.groq.com/openai/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "OpenAI-compatible inference channel. Fetch models from this connection." },
  { id: "together", name: "Together AI", provider: "together", protocol: "openai-chat-completions", defaultBaseUrl: "https://api.together.xyz/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "OpenAI-compatible hosted channel. Fetch models from this connection." },
  { id: "fireworks", name: "Fireworks AI", provider: "fireworks", protocol: "openai-chat-completions", defaultBaseUrl: "https://api.fireworks.ai/inference/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "OpenAI-compatible hosted channel. Fetch models from this connection." },
  { id: "siliconflow", name: "SiliconFlow", provider: "siliconflow", protocol: "openai-chat-completions", defaultBaseUrl: "https://api.siliconflow.cn/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "OpenAI-compatible regional channel. Fetch models from this connection." },
  { id: "azure-openai", name: "Azure OpenAI", provider: "azure-openai", protocol: "openai-chat-completions", defaultBaseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/v1", defaultModel: null, defaultModels: [], authMode: "api-key", description: "Azure OpenAI v1 channel. Enter the deployment returned by your endpoint." },
  { id: "custom-openai-compatible", name: "Custom (OpenAI Compatible)", provider: "custom", protocol: "openai-chat-completions", defaultBaseUrl: "https://api.example.com/v1", defaultModel: null, defaultModels: [], authMode: "bearer", description: "Any OpenAI-compatible gateway or local proxy." },
  { id: "custom-anthropic-messages", name: "Custom (Anthropic Messages)", provider: "custom", protocol: "anthropic-messages", defaultBaseUrl: "https://api.example.com", defaultModel: null, defaultModels: [], authMode: "x-api-key", description: "Any Anthropic Messages-compatible gateway or proxy." },
];

function modelConfig(id: string): AiModelConfig {
  return { id, name: id, contextWindow: 128000, maxOutputTokens: 8192, enabled: true, supportsStreaming: true };
}

export function getAiProviderPreset(id: string): AiProviderPreset | null {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function createDefaultAiProviderProfile(
  presetId: string,
  overrides: Partial<Pick<AiProviderProfile, "id" | "name" | "model" | "baseUrl" | "isDefault">> = {},
): AiProviderProfile {
  const preset = getAiProviderPreset(presetId) ?? getAiProviderPreset("custom-openai-compatible")!;
  return {
    id: overrides.id ?? preset.id,
    name: overrides.name ?? preset.name,
    provider: preset.provider,
    protocol: preset.protocol,
    channel: preset.id.startsWith("custom-") ? "custom" : "official",
    baseUrl: overrides.baseUrl ?? preset.defaultBaseUrl,
    model: overrides.model === undefined ? null : overrides.model,
    defaultModelId: overrides.model === undefined ? null : overrides.model,
    models: overrides.model?.trim() ? [modelConfig(overrides.model.trim())] : [],
    enabled: true,
    isDefault: overrides.isDefault ?? false,
    authMode: preset.authMode,
    timeoutMs: 30000,
    firstResponseTimeoutMs: 120000,
    maxRequestDurationMs: 600000,
    maxRetries: 2,
    customHeaders: {},
    privacy: { ...DEFAULT_PRIVACY },
  };
}

export function getProfileDefaultModel(profile: AiProviderProfile): string | null {
  const configured = profile.defaultModelId ?? profile.model;
  if (configured && profile.models.some((model) => model.id === configured && model.enabled)) return configured;
  return profile.models.find((model) => model.enabled)?.id ?? configured ?? null;
}

/** Unknown limits stay unknown; never infer extra model capability. */
export function getProfileModelOutputLimit(profile: AiProviderProfile, model: string): number | undefined {
  const limit = profile.models.find(item => item.id === model)?.maxOutputTokens;
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.max(1, Math.floor(limit)) : undefined;
}

export function sanitizeErrorMessage(value: string): string {
  return value
    .replace(/(https?:\/\/[^\s?)]+)\?[^\s)]+/gi, '$1?[redacted]')
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(?:api[-_ ]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, "[redacted]");
}

export function classifyAiConnectionError(input: {
  error?: unknown;
  status?: number;
  responseBody?: string;
}): AiConnectionTestResult {
  const status = input.status;
  let code: AiConnectionErrorCode = "unknown";
  if (status === 401) code = "unauthorized";
  else if (status === 403) code = "forbidden";
  else if (status === 404) code = "not_found";
  else if (status === 429) code = "rate_limited";
  else if (typeof status === "number" && status >= 500) code = "server_error";
  else if (typeof status === "number" && status >= 400) code = "unknown";

  const rawMessage = input.error instanceof Error ? input.error.message : typeof input.error === "string" ? input.error : "";
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes("timeout") || normalized.includes("timed out")) code = "timeout";
  else if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed")) code = "cors_or_network";
  else if (typeof input.responseBody === "string" && /^\s*</.test(input.responseBody)) code = "protocol_mismatch";

  const messages: Record<AiConnectionErrorCode, string> = {
    missing_credentials: "Missing credentials.",
    cors_or_network: "The request was blocked by the network or browser CORS policy.",
    timeout: "The provider did not respond before the timeout.",
    unauthorized: "The provider rejected the credentials (401).",
    forbidden: "The provider rejected access to this resource (403).",
    not_found: "The endpoint or model path was not found (404).",
    rate_limited: "The provider rate-limited the request (429).",
    quota_exceeded: "The provider quota or spending limit is exhausted (429). Check billing or usage limits before continuing.",
    server_error: "The provider returned a server error.",
    protocol_mismatch: "The endpoint returned a non-JSON API response; check protocol and base URL.",
    invalid_response: "The provider response did not match the selected protocol.",
    unknown: "The provider connection failed.",
  };
  return {
    ok: false,
    code,
    ...(typeof status === "number" ? { httpStatus: status } : {}),
    message: sanitizeErrorMessage(messages[code]),
    diagnostics: rawMessage ? [sanitizeErrorMessage(rawMessage).slice(0, 240)] : undefined,
  };
}
