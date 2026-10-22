import type {
  AiConnectionTestResult,
  AiGenerateOptions,
  AiGenerateResult,
  AiMessage,
  AiModel,
  AiProvider,
  AiStreamChunk,
} from "./types";
import { getProfileApiKey, loadProfileApiKey } from "./key-storage";
import { classifyAiConnectionError, getProfileDefaultModel, getProfileModelOutputLimit, sanitizeErrorMessage } from "./provider-profiles";
import { buildProtocolRequest, modelListUrl, parseProtocolResponse, parseProtocolStream } from "./protocol-adapters";
import { requestAiHttp } from "./native-http";
import { AiRequestTimeoutError, generationTimeouts, requestProgressReporter } from './request-lifecycle';
import { AiQuotaExceededError, AiRateLimitError, recordRateLimit, waitForRateLimit } from './rate-limit-recovery';

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Provider request timed out")), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function shouldRetryResponse(response: Response): boolean {
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

async function waitForRetry(signal: AbortSignal | undefined, attempt: number): Promise<void> {
  const delayMs = Math.min(100 * 2 ** attempt, 1_000);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new Error("Provider request aborted"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

type ProfileHttpRequester = (url: string, init: RequestInit) => Promise<Response>;

async function fetchWithProfileRetries(
  url: string,
  init: RequestInit,
  maxRetries: number,
  rateLimit: { scope: string; profileName: string },
  requester: ProfileHttpRequester = (requestUrl, requestInit) => fetch(requestUrl, requestInit),
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    await waitForRateLimit(rateLimit.scope, rateLimit.profileName, { signal: init.signal });
    try {
      const response = await requester(url, init);
      if (response.status === 429) {
        const error = await recordRateLimit(rateLimit.scope, rateLimit.profileName, response, attempt, { signal: init.signal });
        if (error instanceof AiQuotaExceededError || attempt >= maxRetries) throw error;
        continue;
      }
      if (!shouldRetryResponse(response) || attempt >= maxRetries) return response;
      // Discard the old connection immediately; its close handshake must not delay retry.
      void response.body?.cancel().catch(() => {});
    } catch (error) {
      if (error instanceof AiQuotaExceededError || error instanceof AiRateLimitError || attempt >= maxRetries || init.signal?.aborted) throw error;
    }
    await waitForRetry(init.signal ?? undefined, attempt);
  }
}

async function parseError(response: Response, profileName: string): Promise<AiConnectionTestResult> {
  const body = await response.text().catch(() => "");
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
  const result = classifyAiConnectionError({ status: response.status, responseBody: body });
  return {
    ...result,
    requestId,
    message: `${profileName}: ${result.message}`,
  };
}

function buildConnectionRequest(profile: import("./types").AiProviderProfile, apiKey: string, fallbackModel: string) {
  if (profile.protocol === "anthropic-messages") {
    return buildProtocolRequest(profile.protocol, profile, apiKey, [{ role: "user", content: "ping" }], { model: fallbackModel, maxTokens: 1 });
  }
  return buildProtocolRequest(profile.protocol, profile, apiKey, [], { model: fallbackModel });
}

async function validateProbeResponse(profile: import("./types").AiProviderProfile, response: Response): Promise<boolean> {
  try {
    const data = await response.clone().json() as Record<string, unknown>;
    if (profile.protocol === "anthropic-messages") return Array.isArray(data.content) || typeof data.id === "string";
    if (profile.protocol === "ollama-native") return Array.isArray(data.models) || typeof data.message === "object";
    if (profile.protocol === "gemini-generate-content") return Array.isArray(data.models) || Array.isArray(data.candidates);
    return Array.isArray(data.data) || Array.isArray(data.choices) || typeof data.output_text === "string" || Array.isArray(data.output);
  } catch {
    return false;
  }
}

export function createProfiledProvider(profile: import("./types").AiProviderProfile, apiKey?: string): AiProvider {
  const resolveKey = () => apiKey ?? getProfileApiKey(profile.id);
  const prepareCredentials = async () => {
    if (apiKey === undefined && profile.authMode !== 'none') await loadProfileApiKey(profile.id);
  };
  const fallbackModel = getProfileDefaultModel(profile) ?? "default";
  const rateLimitScope = (model = fallbackModel) => JSON.stringify([profile.id, profile.baseUrl, model]);

  const modelCatalogError = (message: string): Error => new Error(`${profile.name}: ${message}`);
  const requestProfileHttp: ProfileHttpRequester = (url, init) => requestAiHttp(url, init, profile.timeoutMs);

  return {
    id: profile.provider,
    name: profile.name,
    getMaxOutputTokens: model => getProfileModelOutputLimit(profile, model ?? fallbackModel),
    requestTimeouts: generationTimeouts(profile.timeoutMs, false, { firstResponseMs: profile.firstResponseTimeoutMs, totalMs: profile.maxRequestDurationMs }),
    isConfigured: () => profile.authMode === "none" || Boolean(resolveKey()),

    async testConnection(): Promise<AiConnectionTestResult> {
      await prepareCredentials();
      if (profile.authMode !== "none" && !resolveKey()) {
        return { ok: false, code: "missing_credentials", message: `${profile.name}: Missing credentials.` };
      }
      const started = performance.now();
      const timeout = timeoutSignal(undefined, profile.timeoutMs);
      try {
        const connectionRequest = buildConnectionRequest(profile, resolveKey(), fallbackModel);
        const url = profile.protocol === "anthropic-messages" ? connectionRequest.url : modelListUrl(profile, resolveKey());
        const init = profile.protocol === "anthropic-messages"
          ? connectionRequest.init
          : {
              method: "GET",
              headers: connectionRequest.init.headers,
            } satisfies RequestInit;
        const response = await fetchWithProfileRetries(url, { ...init, signal: timeout.signal }, profile.maxRetries, { scope: rateLimitScope(), profileName: profile.name }, requestProfileHttp);
        if (!response.ok) {
          const failure = await parseError(response, profile.name);
          return { ...failure, latencyMs: Math.round(performance.now() - started) };
        }
        if (!(await validateProbeResponse(profile, response))) {
          return { ok: false, code: "invalid_response", message: `${profile.name}: The provider response did not match the selected protocol.`, latencyMs: Math.round(performance.now() - started) };
        }
        return { ok: true, code: undefined, message: `${profile.name}: Connection successful.`, latencyMs: Math.round(performance.now() - started), requestId: response.headers.get("x-request-id") ?? undefined };
      } catch (error) {
        if (error instanceof AiQuotaExceededError) return { ok: false, code: error.code, httpStatus: error.httpStatus, message: error.message, latencyMs: Math.round(performance.now() - started) };
        if (error instanceof AiRateLimitError) return { ok: false, code: 'rate_limited', httpStatus: 429, message: error.message, latencyMs: Math.round(performance.now() - started) };
        const failure = classifyAiConnectionError({ error });
        return { ...failure, message: `${profile.name}: ${failure.message}`, latencyMs: Math.round(performance.now() - started) };
      } finally {
        timeout.dispose();
      }
    },

    async getAvailableModels(): Promise<AiModel[]> {
      await prepareCredentials();
      if (profile.authMode !== "none" && !resolveKey()) {
        throw modelCatalogError("Missing credentials.");
      }
      const timeout = timeoutSignal(undefined, profile.timeoutMs);
      try {
        const response = await fetchWithProfileRetries(modelListUrl(profile, resolveKey()), {
          headers: buildConnectionRequest(profile, resolveKey(), fallbackModel).init.headers,
          signal: timeout.signal,
        }, profile.maxRetries, { scope: rateLimitScope(), profileName: profile.name }, requestProfileHttp);
        const body = await response.text();
        if (!response.ok) {
          const failure = classifyAiConnectionError({ status: response.status, responseBody: body });
          throw modelCatalogError(failure.message ?? "Model catalog request failed.");
        }

        let data: Record<string, unknown>;
        try {
          const parsed = JSON.parse(body) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
          data = parsed as Record<string, unknown>;
        } catch {
          const failure = classifyAiConnectionError({ responseBody: body });
          throw modelCatalogError(failure.code === "protocol_mismatch"
            ? failure.message ?? "The model catalog endpoint returned an invalid response."
            : "Model catalog response was not valid JSON.");
        }

        const rawCatalog = profile.protocol === "ollama-native" || profile.protocol === "gemini-generate-content"
          ? data.models
          : data.data;
        if (!Array.isArray(rawCatalog)) {
          throw modelCatalogError("Model catalog response did not match the selected protocol.");
        }

        const raw: Array<{ id?: unknown; name?: unknown; contextWindow?: unknown }> = profile.protocol === "ollama-native"
          ? rawCatalog.map((item) => ({ id: item && typeof item === "object" ? (item as { name?: unknown }).name : undefined }))
          : profile.protocol === "gemini-generate-content"
            ? rawCatalog.map((item) => ({
                id: item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
                  ? (item as { name: string }).name.replace(/^models\//, "")
                  : item && typeof item === "object" ? (item as { name?: unknown }).name : undefined,
              }))
            : rawCatalog.map((item) => ({
                id: item && typeof item === "object" ? (item as { id?: unknown }).id : undefined,
                name: item && typeof item === "object" ? (item as { display_name?: unknown }).display_name : undefined,
                contextWindow: item && typeof item === "object" ? (item as { context_window?: unknown }).context_window : undefined,
              }));
        return raw.filter((item): item is { id: string; name?: unknown; contextWindow?: unknown } => typeof item.id === "string" && item.id.length > 0).map((item) => ({
          id: item.id,
          name: typeof item.name === "string" && item.name.trim() ? item.name : item.id,
          provider: profile.provider,
          contextWindow: typeof item.contextWindow === "number" && Number.isFinite(item.contextWindow) ? Math.max(1, Math.round(item.contextWindow)) : 128000,
          supportsStreaming: true,
        }));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`${profile.name}:`)) {
          throw error;
        }
        const failure = classifyAiConnectionError({ error });
        throw modelCatalogError(failure.message ?? "Model catalog request failed.");
      } finally {
        timeout.dispose();
      }
    },

    async generate(messages: AiMessage[], options?: AiGenerateOptions): Promise<AiGenerateResult> {
      await prepareCredentials();
      const request = buildProtocolRequest(profile.protocol, profile, resolveKey(), messages, { ...options, model: options?.model ?? fallbackModel });
      const budgets = generationTimeouts(profile.timeoutMs, false, { firstResponseMs: profile.firstResponseTimeoutMs, totalMs: profile.maxRequestDurationMs });
      const startedAt = Date.now();
      const scope = rateLimitScope(options?.model);
      for (let attempt = 0; ; attempt++) {
        if (options?.signal?.aborted) throw options.signal.reason ?? new DOMException('Request aborted', 'AbortError');
        const progress = requestProgressReporter(options?.onProgress, startedAt, attempt + 1);
        await waitForRateLimit(scope, profile.name, { signal: options?.signal, deadline: startedAt + budgets.totalMs, onWaiting: () => progress.report('retrying') });
        const remaining = budgets.totalMs - (Date.now() - startedAt);
        if (remaining <= 0) throw new AiRequestTimeoutError('overall', budgets.totalMs);
        progress.report(attempt ? 'retrying' : 'waiting');
        let retryable = true, rateLimited = false;
        try {
          const response = await requestAiHttp(request.url, { ...request.init, signal: options?.signal }, Math.min(budgets.firstResponseMs, remaining), {
            idleTimeoutMs: budgets.idleMs, totalTimeoutMs: remaining, onActivity: progress.activity,
          });
          if (response.status === 429) {
            rateLimited = true;
            throw await recordRateLimit(scope, profile.name, response, attempt, { signal: options?.signal, deadline: startedAt + budgets.totalMs });
          }
          if (!response.ok) {
            retryable = shouldRetryResponse(response);
            if (retryable && attempt < profile.maxRetries) {
              // A gateway may never finish its error body. Release that request
              // before retrying instead of waiting for text or a close handshake.
              void response.body?.cancel().catch(() => {});
              throw new Error(profile.name + ': transient provider response (' + response.status + ')');
            }
            const failure = await parseError(response, profile.name);
            throw new Error(failure.message);
          }
          const result = await parseProtocolResponse(profile.protocol, response, options?.model ?? fallbackModel);
          if (result.responseDiagnostics) options?.onResponseDiagnostics?.(result.responseDiagnostics);
          return result;
        } catch (error) {
          if (options?.signal?.aborted) throw options.signal.reason ?? new DOMException('Request aborted', 'AbortError');
          if (error instanceof AiQuotaExceededError) throw error;
          if (attempt >= profile.maxRetries || !retryable || error instanceof SyntaxError || Date.now() - startedAt >= budgets.totalMs) {
            if (error instanceof Error && error.message.startsWith(profile.name + ':')) throw error;
            if (error instanceof AiRequestTimeoutError) throw error;
            const failure = classifyAiConnectionError({ error });
            if (error instanceof SyntaxError) throw new Error(profile.name + ': The provider returned invalid JSON; check the selected protocol and API endpoint.');
            throw new Error(failure.code === 'timeout'
              ? profile.name + ': Provider request timed out. The task can continue from its saved checkpoint.'
              : profile.name + ': ' + failure.message);
          }
        }
        if (rateLimited) continue;
        await waitForRetry(options?.signal, attempt);
      }
    },

    async *stream(messages: AiMessage[], options?: AiGenerateOptions): AsyncIterable<AiStreamChunk> {
      await prepareCredentials();
      const budgets = generationTimeouts(profile.timeoutMs, true, { firstResponseMs: profile.firstResponseTimeoutMs, totalMs: profile.maxRequestDurationMs }), startedAt = Date.now();
      const request = buildProtocolRequest(profile.protocol, profile, resolveKey(), messages, { ...options, model: options?.model ?? fallbackModel, stream: true });
      const scope = rateLimitScope(options?.model);
      for (let attempt = 0; ; attempt++) {
        if (options?.signal?.aborted) throw options.signal.reason ?? new DOMException('Request aborted', 'AbortError');
        const progress = requestProgressReporter(options?.onProgress, startedAt, attempt + 1);
        let emittedText = false, retryable = true, rateLimited = false;
        let failureCode: AiStreamChunk['code'];
        try {
          await waitForRateLimit(scope, profile.name, { signal: options?.signal, deadline: startedAt + budgets.totalMs, onWaiting: () => progress.report('retrying') });
          const remaining = budgets.totalMs - (Date.now() - startedAt);
          if (remaining <= 0) throw new AiRequestTimeoutError('overall', budgets.totalMs);
          progress.report(attempt ? 'retrying' : 'waiting');
          const response = await requestAiHttp(request.url, { ...request.init, signal: options?.signal }, Math.min(budgets.firstResponseMs, remaining), {
            idleTimeoutMs: budgets.idleMs, totalTimeoutMs: remaining, onActivity: progress.activity,
          });
          if (response.status === 429) {
            rateLimited = true;
            failureCode = 'rate_limited';
            throw await recordRateLimit(scope, profile.name, response, attempt, { signal: options?.signal, deadline: startedAt + budgets.totalMs });
          }
          if (!response.ok) {
            retryable = shouldRetryResponse(response);
            if (retryable && attempt < profile.maxRetries) {
              void response.body?.cancel().catch(() => {});
              throw new Error(profile.name + ': transient provider response (' + response.status + ')');
            }
            throw new Error((await parseError(response, profile.name)).message);
          }
          for await (const chunk of parseProtocolStream(profile.protocol, response, options?.onResponseDiagnostics)) {
            if (chunk.type === 'error') {
              failureCode = chunk.code;
              retryable = /timed out|timeout|network|fetch|connection|overloaded|temporary/i.test(chunk.error ?? '');
              throw new Error(chunk.error ?? 'AI provider stream failed');
            }
            if (chunk.type === 'text' && chunk.text) { emittedText = true; progress.text(); }
            yield chunk;
          }
          return;
        } catch (error) {
          if (options?.signal?.aborted) throw options.signal.reason ?? new DOMException('Request aborted', 'AbortError');
          if (error instanceof AiQuotaExceededError) {
            yield { type: 'error', code: error.code, error: sanitizeErrorMessage(error.message) };
            return;
          }
          if (attempt >= profile.maxRetries || emittedText || !retryable || Date.now() - startedAt >= budgets.totalMs) {
            const message = error instanceof Error ? error.message : classifyAiConnectionError({ error }).message;
            yield { type: 'error', error: sanitizeErrorMessage(message ?? 'AI provider stream failed'), ...(error instanceof AiRateLimitError ? { code: error.code, retryAt: error.retryAt } : failureCode ? { code: failureCode } : {}) };
            return;
          }
        }
        if (rateLimited) continue;
        await waitForRetry(options?.signal, attempt);
      }
    },

    estimateTokens: (text: string) => Math.ceil(text.length / 4),
  };
}
