/**
 * HTTP transport for the shared-library API (`/v1`, see design section 13).
 *
 * Responsibilities:
 *   - Build and encode request URLs and query params.
 *   - Attach the bearer token and the `Idempotency-Key` header on writes.
 *   - Normalize every failure into a structured `SharedLibraryError`
 *     (network/timeout -> retryable `NETWORK_ERROR`; HTTP errors mapped by
 *     status and by the server error envelope).
 *
 * No component may reach around this transport to call `fetch`/Supabase/R2
 * directly.
 */

import {
  isKnownSharedLibraryErrorCode,
  SharedLibraryError,
  type SharedLibraryErrorCode,
} from "./errors";
import type { ApiConfig } from "./api-config";
import type { SharedLibraryTransport, TransportRequest, TransportResponse } from "./remote-repository";
import { cloudArrayBuffer } from "./file-content";

interface ErrorEnvelope {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  requestId?: unknown;
}

function extractErrorEnvelope(body: unknown): ErrorEnvelope | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  return error as ErrorEnvelope;
}

function mapStatusToCode(status: number): {
  code: SharedLibraryErrorCode;
  retryable: boolean;
  message: string;
} {
  if (status === 401) {
    return { code: "UNAUTHORIZED", retryable: false, message: "Unauthorized" };
  }
  if (status === 403) {
    return { code: "FORBIDDEN", retryable: false, message: "Forbidden" };
  }
  if (status === 404) {
    return { code: "NOT_FOUND", retryable: false, message: "Not found" };
  }
  if (status === 409) {
    return { code: "SYNC_CONFLICT", retryable: false, message: "Conflict" };
  }
  if (status === 422) {
    return { code: "VALIDATION_FAILED", retryable: false, message: "Validation failed" };
  }
  if (status === 400) {
    return { code: "INVALID_INPUT", retryable: false, message: "Invalid input" };
  }
  if (status === 429) {
    return { code: "QUOTA_EXCEEDED", retryable: true, message: "Rate limited" };
  }
  if (status >= 500) {
    return { code: "NETWORK_ERROR", retryable: true, message: "Server error" };
  }
  return { code: "INVALID_INPUT", retryable: false, message: `Request failed with status ${status}` };
}

function buildUrl(baseUrl: string, path: string, query?: TransportRequest["query"]): string {
  const base = `${baseUrl}${path}`;
  if (!query) {
    return base;
  }
  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
  return params ? `${base}?${params}` : base;
}

export class ApiTransport implements SharedLibraryTransport {
  private readonly baseUrl: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly timeoutMs?: number;
  private readonly fetchImpl: (input: string, init: RequestInit) => Promise<Response>;

  constructor(config: ApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.getAccessToken = config.getAccessToken;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async request(input: TransportRequest): Promise<TransportResponse> {
    input.signal?.throwIfAborted();
    const url = buildUrl(this.baseUrl, input.path, input.query);
    const token = await this.getAccessToken();
    input.signal?.throwIfAborted();
    const binaryBody = cloudArrayBuffer(input.body);
    const isBinaryRequest = binaryBody !== null;
    const headers: Record<string, string> = {
      "content-type": isBinaryRequest ? "application/octet-stream" : "application/json",
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    if (input.idempotencyKey) {
      headers["idempotency-key"] = input.idempotencyKey;
    }

    let response: Response;
    let body: unknown;
    try {
      const requestBody = isBinaryRequest
        ? binaryBody
        : input.body !== undefined
          ? JSON.stringify(input.body)
          : undefined;
      ({ response, body } = await this.fetchWithTimeout(url, {
        method: input.method,
        headers,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }, this.timeoutMs ?? (isBinaryRequest || input.responseType === "arrayBuffer" || /\/uploads\/[^/]+\/complete$/.test(input.path) ? 120_000 : 15_000), input.responseType));
    } catch (error) {
      if (input.signal?.aborted) throw new DOMException("云资源读取已取消", "AbortError");
      throw new SharedLibraryError({
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        originalError: error,
      });
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (!response.ok) {
      throw this.mapHttpError(response.status, body, requestId);
    }

    return { status: response.status, body, requestId };
  }

  private fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, responseType?: TransportRequest["responseType"]): Promise<{ response: Response; body: unknown }> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const forwardAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", forwardAbort, { once: true });
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("request timed out"));
        controller.abort();
      }, timeoutMs);
    });
    let rejectAbort!: (reason: unknown) => void;
    const abort = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancelled = () => rejectAbort(new DOMException("request aborted", "AbortError"));
    if (controller.signal.aborted) cancelled();
    else controller.signal.addEventListener("abort", cancelled, { once: true });
    const request = (async () => {
      const response = await this.fetchImpl.call(globalThis, url, { ...init, signal: controller.signal });
      let body: unknown = null;
      if (responseType === "arrayBuffer") body = await response.arrayBuffer();
      else {
        const value = await response.text();
        if (value) { try { body = JSON.parse(value); } catch { body = value; } }
      }
      return { response, body };
    })();
    return Promise.race([request, timeout, abort]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
      externalSignal?.removeEventListener("abort", forwardAbort);
      controller.signal.removeEventListener("abort", cancelled);
    });
  }

  private mapHttpError(
    status: number,
    body: unknown,
    requestId?: string,
  ): SharedLibraryError {
    const envelope = extractErrorEnvelope(body);
    const fallback = mapStatusToCode(status);
    const code =
      typeof envelope?.code === "string" && isKnownSharedLibraryErrorCode(envelope.code)
        ? envelope.code
        : fallback.code;
    return new SharedLibraryError({
      code,
      message:
        typeof envelope?.message === "string" ? envelope.message : fallback.message,
      retryable:
        typeof envelope?.retryable === "boolean" ? envelope.retryable : fallback.retryable,
      entityType: typeof envelope?.entityType === "string" ? envelope.entityType : undefined,
      entityId: typeof envelope?.entityId === "string" ? envelope.entityId : undefined,
      requestId:
        typeof envelope?.requestId === "string" ? envelope.requestId : requestId,
      status,
    });
  }
}
