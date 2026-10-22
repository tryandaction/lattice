import { Channel } from "@tauri-apps/api/core";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
import { createRequestLifecycle } from './request-lifecycle';

type NativeHttpStreamEvent =
  | { type: "headers"; status: number; headers: Record<string, string> }
  | { type: "chunk"; data: number[] }
  | { type: "end" }
  | { type: "error"; message: string };

const MAX_AI_STREAM_BYTES = 16 * 1024 * 1024;

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  const normalized = new Headers(headers);
  return Object.fromEntries(normalized.entries());
}

function abortError(signal?: AbortSignal | null): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("Request aborted", "AbortError");
}

function requestAiHttpStream(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  headers: Record<string, string>,
  idleTimeoutMs: number,
  totalTimeoutMs: number,
  lifecycle: Pick<ReturnType<typeof createRequestLifecycle>, 'activity' | 'dispose'>,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.min(300_000, Math.max(1_000, timeoutMs)) : 30_000;
  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let responseStarted = false;
    let terminal = false;
    let cancelRequested = false;
    let receivedBytes = 0;
    const channel = new Channel<NativeHttpStreamEvent>();

    const cancelNative = () => {
      if (cancelRequested) return;
      cancelRequested = true;
      void invokeTauriCommand("ai_native_http_stream_cancel", { requestId }, { timeoutMs: 5_000 }).catch(() => {
        // A cancellation is best effort if the native task already ended.
      });
    };
    const cleanup = () => {
      lifecycle.dispose();
      init.signal?.removeEventListener("abort", onAbort);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
      channel.onmessage = () => {};
    };
    const fail = (error: Error, cancel = true) => {
      if (terminal) return;
      terminal = true;
      cleanup();
      if (cancel) cancelNative();
      if (responseStarted) controller?.error(error);
      else reject(error);
    };
    const onAbort = () => fail(abortError(init.signal));
    const onPageHide = () => fail(abortError());
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) { controller = streamController; },
      cancel() {
        if (terminal) return;
        terminal = true;
        cleanup();
        cancelNative();
      },
    });

    channel.onmessage = (event) => {
      if (terminal) return;
      if (!event || typeof event !== "object") {
        fail(new Error("Desktop AI HTTP stream returned an invalid event."));
        return;
      }
      switch (event.type) {
        case "headers": {
          if (responseStarted || !Number.isInteger(event.status) || event.status < 200 || event.status > 599
            || !event.headers || typeof event.headers !== "object" || Array.isArray(event.headers)) {
            fail(new Error("Desktop AI HTTP stream returned invalid headers."));
            return;
          }
          try {
            const response = new Response(
              [204, 205, 304].includes(event.status) ? null : stream,
              { status: event.status, headers: event.headers },
            );
            responseStarted = true;
            resolve(response);
          } catch {
            fail(new Error("Desktop AI HTTP stream returned invalid headers."));
          }
          return;
        }
        case "chunk":
          if (!responseStarted) {
            fail(new Error("Desktop AI HTTP stream received data before headers."));
          } else if (!Array.isArray(event.data) || event.data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
            fail(new Error("Desktop AI HTTP stream returned invalid bytes."));
          } else if (receivedBytes + event.data.length > MAX_AI_STREAM_BYTES) {
            fail(new Error("Desktop AI HTTP stream response is too large."));
          } else {
            receivedBytes += event.data.length;
            if (event.data.length) lifecycle.activity();
            controller?.enqueue(Uint8Array.from(event.data));
          }
          return;
        case "end":
          if (!responseStarted) {
            fail(new Error("Desktop AI HTTP stream ended before headers."));
          } else {
            terminal = true;
            cleanup();
            controller?.close();
          }
          return;
        case "error":
          fail(new Error(typeof event.message === "string" && event.message
            ? event.message
            : "Desktop AI HTTP stream failed."), false);
          return;
        default:
          fail(new Error("Desktop AI HTTP stream returned an invalid event."));
      }
    };

    init.signal?.addEventListener("abort", onAbort, { once: true });
    if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide, { once: true });
    if (init.signal?.aborted) {
      onAbort();
      return;
    }

    void invokeTauriCommand(
      "ai_native_http_stream_start",
      {
        requestId,
        url,
        method: init.method ?? "GET",
        headers,
        body: typeof init.body === "string" ? init.body : null,
        timeoutMs: boundedTimeoutMs,
        idleTimeoutMs,
        totalTimeoutMs,
        onEvent: channel,
      },
      { timeoutMs: boundedTimeoutMs + 1_000 },
    ).then(() => {
      // An abort may race the native task's registration.
      if (cancelRequested) {
        void invokeTauriCommand("ai_native_http_stream_cancel", { requestId }, { timeoutMs: 5_000 }).catch(() => {});
      }
    }, (error: unknown) => {
      if (!terminal) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export async function requestAiHttp(
  url: string,
  init: RequestInit = {},
  timeoutMs: number,
  options?: { idleTimeoutMs?: number; totalTimeoutMs?: number; onActivity?: () => void },
): Promise<Response> {
  if (init.signal?.aborted) {
    throw abortError(init.signal);
  }
  const firstResponseMs = Number.isFinite(timeoutMs) ? Math.min(300000, Math.max(1000, timeoutMs)) : 30000;
  const idleMs = options?.idleTimeoutMs ?? firstResponseMs;
  const totalMs = options?.totalTimeoutMs ?? Math.max(firstResponseMs, 600000);
  const lifecycle = createRequestLifecycle({ firstResponseMs, idleMs, totalMs }, init.signal, options?.onActivity);
  const headers = headersToRecord(init.headers);
  // The native byte channel cancels both JSON and SSE requests. This does not
  // change the provider's stream flag or its HTTP response format.
  try {
    const request = { ...init, signal: lifecycle.signal };
    const response = isTauriHost()
      ? await requestAiHttpStream(url, request, firstResponseMs, headers, idleMs, totalMs, lifecycle)
      : await fetch(url, request);
    return isTauriHost() ? response : lifecycle.track(response);
  } catch (error) {
    lifecycle.dispose();
    throw lifecycle.signal.aborted ? lifecycle.signal.reason : error;
  }
}
