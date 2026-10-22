import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAiHttp } from "../native-http";

type StreamEvent =
  | { type: "headers"; status: number; headers: Record<string, string> }
  | { type: "chunk"; data: number[] }
  | { type: "end" }
  | { type: "error"; message: string };

const { invokeTauriCommand, channels } = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  channels: [] as Array<{ onmessage: (event: StreamEvent) => void }>,
}));

vi.mock("@/lib/storage-adapter", () => ({
  invokeTauriCommand,
  isTauriHost: () => true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (event: StreamEvent) => void = () => {};
    constructor() { channels.push(this); }
  },
}));

function streamRequest(signal?: AbortSignal) {
  return requestAiHttp("https://gateway.example/v1/messages", {
    method: "POST",
    headers: { accept: "text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ stream: true, model: "vendor-model" }),
    signal,
  }, 30_000);
}

function emit(event: StreamEvent) {
  channels.at(-1)?.onmessage(event);
}

function cancelCalls() {
  return invokeTauriCommand.mock.calls.filter(([command]) => command === "ai_native_http_stream_cancel");
}

describe("native AI HTTP transport", () => {
  it("cancels a pending JSON generation immediately instead of waiting for the server timeout", async () => {
    invokeTauriCommand.mockImplementation((command: string) => command.includes('cancel') ? Promise.resolve() : new Promise(() => {}));
    const controller = new AbortController();
    const pending = requestAiHttp('https://gateway.example/v1/messages', { method: 'POST', body: '{"stream":false}', signal: controller.signal }, 30000).catch(error => error);
    controller.abort();
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still pending'), 50))]);
    expect(result).toMatchObject({ name: 'AbortError' });
    expect(cancelCalls()).toHaveLength(1);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    invokeTauriCommand.mockReset();
    channels.length = 0;
    vi.useRealTimers();
  });

  it("preserves ordinary JSON semantics on the cancellable native byte channel", async () => {
    const browserFetch = vi.spyOn(globalThis, "fetch");
    invokeTauriCommand.mockResolvedValue(undefined);

    const pending = requestAiHttp("https://gateway.example/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "profile-secret", "content-type": "application/json" },
      body: JSON.stringify({ model: "vendor-model" }),
    }, 30_000);
    emit({ type: 'headers', status: 200, headers: { 'content-type': 'application/json' } });
    const response = await pending;
    emit({ type: 'chunk', data: [...new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: 'native answer' }] }))] });
    emit({ type: 'end' });

    await expect(response.json()).resolves.toEqual({ content: [{ type: "text", text: "native answer" }] });
    expect(browserFetch).not.toHaveBeenCalled();
    expect(invokeTauriCommand).toHaveBeenCalledWith(
      "ai_native_http_stream_start",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "vendor-model" }), headers: expect.objectContaining({ "x-api-key": "profile-secret" }) }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("resolves at headers and yields the first chunk before native completion", async () => {
    let acknowledge!: () => void;
    invokeTauriCommand.mockImplementation((command: string) => command === "ai_native_http_stream_start"
      ? new Promise<void>((resolve) => { acknowledge = resolve; })
      : Promise.resolve());
    const responsePromise = streamRequest();
    emit({ type: "headers", status: 200, headers: { "content-type": "text/event-stream" } });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = reader.read();
    emit({ type: "chunk", data: [100, 97, 116, 97, 58, 32, 111, 107, 10, 10] });
    expect(new TextDecoder().decode((await first).value)).toBe("data: ok\n\n");
    expect(typeof acknowledge).toBe("function");
    acknowledge();
    emit({ type: "end" });
    expect((await reader.read()).done).toBe(true);
    expect(invokeTauriCommand).toHaveBeenCalledWith("ai_native_http_stream_start", expect.objectContaining({
      requestId: expect.any(String), onEvent: expect.anything(),
    }), expect.anything());
  });

  it("preserves UTF-8 bytes across chunk boundaries", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const responsePromise = streamRequest();
    emit({ type: "headers", status: 200, headers: {} });
    const response = await responsePromise;
    const bytes = new TextEncoder().encode("data: 中文\n\n");
    emit({ type: "chunk", data: [...bytes.slice(0, 7)] });
    emit({ type: "chunk", data: [...bytes.slice(7)] });
    emit({ type: "end" });
    expect(await response.text()).toBe("data: 中文\n\n");
  });

  it("aborts before headers and repeats cancellation after the start acknowledgement", async () => {
    let acknowledge!: () => void;
    invokeTauriCommand.mockImplementation((command: string) => command === "ai_native_http_stream_start"
      ? new Promise<void>((resolve) => { acknowledge = resolve; })
      : Promise.resolve());
    const controller = new AbortController();
    const pending = streamRequest(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelCalls()).toHaveLength(1);
    acknowledge();
    await vi.waitFor(() => expect(cancelCalls()).toHaveLength(2));
  });

  it("errors an opened response and cancels native work when aborted", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const controller = new AbortController();
    const pending = streamRequest(controller.signal);
    emit({ type: "headers", status: 200, headers: {} });
    const response = await pending;
    const reader = response.body!.getReader();
    const next = reader.read();
    controller.abort();
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelCalls()).toHaveLength(1);
    emit({ type: "chunk", data: [1] });
    expect(cancelCalls()).toHaveLength(1);
  });

  it("cancels the native request when the response reader is cancelled", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = streamRequest();
    emit({ type: "headers", status: 200, headers: {} });
    const response = await pending;
    await response.body!.getReader().cancel();
    expect(cancelCalls()).toHaveLength(1);
  });

  it("retains non-2xx status and error bytes for provider error handling", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = streamRequest();
    emit({ type: "headers", status: 429, headers: { "content-type": "application/json" } });
    const response = await pending;
    emit({ type: "chunk", data: [...new TextEncoder().encode('{"error":"rate limit"}')] });
    emit({ type: "end" });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate limit" });
  });

  it("rejects malformed event order and a transport error before headers", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const malformed = streamRequest();
    emit({ type: "chunk", data: [1] });
    await expect(malformed).rejects.toThrow(/headers/i);
    expect(cancelCalls().length).toBeGreaterThanOrEqual(1);

    const failed = streamRequest();
    emit({ type: "error", message: "connection refused" });
    await expect(failed).rejects.toThrow("connection refused");
  });

  it("supports an empty body and uses the configured timeout for hung streams", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const empty = streamRequest();
    emit({ type: "headers", status: 200, headers: {} });
    const response = await empty;
    emit({ type: "end" });
    expect(await response.text()).toBe("");

    vi.useFakeTimers();
    const hung = requestAiHttp("https://gateway.example/v1/messages", {
      headers: { accept: "text/event-stream" },
    }, 1_000);
    const rejected = expect(hung).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(cancelCalls()).toHaveLength(1);
  });

  it("cancels an open native request when the page closes", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = streamRequest();
    emit({ type: "headers", status: 200, headers: {} });
    const response = await pending;
    const reader = response.body!.getReader();
    const next = reader.read();
    window.dispatchEvent(new Event("pagehide"));
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelCalls().length).toBeGreaterThanOrEqual(1);
  });

  it("detects stream:true in the JSON body without an Accept header", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = requestAiHttp("https://gateway.example/v1/messages", {
      method: "POST",
      body: JSON.stringify({ stream: true }),
    }, 30_000);
    emit({ type: "headers", status: 200, headers: {} });
    const response = await pending;
    emit({ type: "end" });
    expect(await response.text()).toBe("");
    expect(invokeTauriCommand).toHaveBeenCalledWith("ai_native_http_stream_start", expect.anything(), expect.anything());
  });

  it("does not start an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(streamRequest(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeTauriCommand).not.toHaveBeenCalled();
    expect(channels).toHaveLength(0);
  });

  it("streams Gemini SSE RPC URLs without an Accept header or body stream flag", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = requestAiHttp("https://gateway.example/v1beta/models/gemini:streamGenerateContent?key=test&alt=sse", {
      method: "POST",
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Question" }] }] }),
    }, 30_000);
    emit({ type: "headers", status: 200, headers: { "content-type": "text/event-stream" } });
    const response = await pending;
    const read = response.body!.getReader().read();
    emit({ type: "chunk", data: [...new TextEncoder().encode("data: first\n\n")] });
    expect(new TextDecoder().decode((await read).value)).toBe("data: first\n\n");
    emit({ type: "end" });
    expect(invokeTauriCommand).toHaveBeenCalledWith("ai_native_http_stream_start", expect.anything(), expect.anything());
  });

  it.each([
    "https://gateway.example/v1beta/models/gemini:generateContent?alt=sse",
    "https://gateway.example/v1beta/models/gemini:streamGenerateContent?alt=json",
    "https://gateway.example/v1/models?redirect=:streamGenerateContent&alt=sse",
  ])("preserves JSON for non-streaming RPC URLs: %s", async (url) => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = requestAiHttp(url, { method: "POST", body: "{}" }, 30_000);
    emit({ type: 'headers', status: 200, headers: { 'content-type': 'application/json' } });
    const response = await pending;
    emit({ type: 'chunk', data: [123, 125] });
    emit({ type: 'end' });
    expect(await response.json()).toEqual({});
    expect(invokeTauriCommand).toHaveBeenCalledWith("ai_native_http_stream_start", expect.objectContaining({ url, body: '{}' }), expect.anything());
  });

  it("cleans up cancellation listeners once the stream has ended", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const controller = new AbortController();
    const pending = streamRequest(controller.signal);
    emit({ type: "headers", status: 200, headers: {} });
    const response = await pending;
    emit({ type: "end" });
    controller.abort();
    window.dispatchEvent(new Event("pagehide"));
    expect(await response.text()).toBe("");
    expect(cancelCalls()).toHaveLength(0);
  });

  it("errors an active reader when the stream times out after headers", async () => {
    vi.useFakeTimers();
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = streamRequest();
    emit({ type: "headers", status: 200, headers: {} });
    const response = await pending;
    const read = response.body!.getReader().read();
    const rejected = expect(read).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(cancelCalls()).toHaveLength(1);
  });

  it("propagates a failed start command instead of leaving the response pending", async () => {
    invokeTauriCommand.mockImplementation((command: string) => command === "ai_native_http_stream_start"
      ? Promise.reject(new Error("native launch failed"))
      : Promise.resolve());
    await expect(streamRequest()).rejects.toThrow("native launch failed");
    expect(cancelCalls()).toHaveLength(1);
  });

  it("rejects invalid byte events after headers", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const pending = streamRequest();
    emit({ type: "headers", status: 200, headers: {} });
    const response = await pending;
    const read = response.body!.getReader().read();
    emit({ type: "chunk", data: [256] });
    await expect(read).rejects.toThrow(/invalid bytes/i);
    expect(cancelCalls()).toHaveLength(1);
  });

  it("preserves a provider timeout reason carried by the abort signal", async () => {
    invokeTauriCommand.mockResolvedValue(undefined);
    const controller = new AbortController();
    const pending = streamRequest(controller.signal);
    controller.abort(new Error("Provider request timed out"));
    await expect(pending).rejects.toThrow("Provider request timed out");
  });
});
