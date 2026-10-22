import { describe, expect, it, vi } from "vitest";
import { ApiTransport } from "../api-transport";
import { isSharedLibraryError } from "../errors";
import { RemoteRepository } from "../remote-repository";
import type { TransportResponse } from "../remote-repository";
import type { SyncOperation } from "../domain";
import { InMemorySyncQueueStorage } from "../sync-queue";
import { runInNewContext } from "node:vm";

function makeResponse(status: number, body: unknown, requestId?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-request-id" ? requestId ?? null : null,
    },
  } as unknown as Response;
}

describe("api transport", () => {
  it("parses a successful response body and requestId", async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200, { libraries: [] }, "req-1"));
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => "tok-1",
      fetchImpl,
    });

    const result = await transport.request({ method: "GET", path: "/v1/libraries" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ libraries: [] });
    expect(result.requestId).toBe("req-1");
  });

  it("sends bearer token and idempotency key headers", async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200, {}));
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => "tok-1",
      fetchImpl,
    });

    await transport.request({
      method: "POST",
      path: "/v1/libraries/x/items",
      body: { kind: "pdf" },
      idempotencyKey: "d1:3",
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/libraries/x/items");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-1");
    expect(headers["idempotency-key"]).toBe("d1:3");
    expect(init.body).toBe(JSON.stringify({ kind: "pdf" }));
  });

  it("preserves binary upload bodies and can return array buffers", async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    const fetchImpl = vi.fn(async (_input: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "",
      arrayBuffer: async () => data,
      requestBody: init.body,
    } as unknown as Response));
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => "tok-1",
      fetchImpl,
    });

    const response = await transport.request({ method: "PUT", path: "/v1/upload", body: data, responseType: "arrayBuffer" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(data);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
    expect(response.body).toBe(data);
  });

  it("encodes query parameters", async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200, {}));
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => null,
      fetchImpl,
    });

    await transport.request({
      method: "GET",
      path: "/v1/libraries",
      query: { limit: 10, q: "a b&c" },
    });

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("limit=10");
    expect(url).toContain("q=" + encodeURIComponent("a b&c"));
  });

  it("uploads cross-realm buffers as original bytes instead of JSON objects", async () => {
    const data: ArrayBuffer = runInNewContext("new Uint8Array([0, 255, 23]).buffer");
    const fetchImpl = vi.fn(async () => makeResponse(200, {}));
    const transport = new ApiTransport({ baseUrl: "https://api.example.com", getAccessToken: async () => null, fetchImpl });
    await transport.request({ method: "PUT", path: "/v1/upload", body: data });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(init.body as ArrayBuffer))).toEqual([0, 255, 23]);
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse(401, { error: { code: "UNAUTHORIZED", message: "bad token" } }),
    );
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => "tok-1",
      fetchImpl,
    });

    let caught: unknown = null;
    try {
      await transport.request({ method: "GET", path: "/v1/libraries" });
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("UNAUTHORIZED");
    expect(caught.retryable).toBe(false);
  });

  it("maps 429 to a retryable error", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse(429, { error: { code: "QUOTA_EXCEEDED", message: "slow down", retryable: true } }),
    );
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => null,
      fetchImpl,
    });

    let caught: unknown = null;
    try {
      await transport.request({ method: "GET", path: "/v1/libraries" });
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.retryable).toBe(true);
  });

  it("maps 500 to a retryable error", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse(500, { error: { code: "SERVER", message: "boom" } }),
    );
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => null,
      fetchImpl,
    });

    let caught: unknown = null;
    try {
      await transport.request({ method: "GET", path: "/v1/libraries" });
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.retryable).toBe(true);
  });

  it("maps 409 to SYNC_CONFLICT", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse(409, { error: { code: "SYNC_CONFLICT", message: "newer remote version" } }),
    );
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => null,
      fetchImpl,
    });

    let caught: unknown = null;
    try {
      await transport.request({ method: "POST", path: "/v1/libraries/x/sync/push" });
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("SYNC_CONFLICT");
    expect(caught.retryable).toBe(false);
  });

  it("treats a network rejection as a retryable NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => null,
      fetchImpl,
    });

    let caught: unknown = null;
    try {
      await transport.request({ method: "GET", path: "/v1/libraries" });
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("NETWORK_ERROR");
    expect(caught.retryable).toBe(true);
  });
  it("keeps a caller-cancelled read out of the retryable network failure path", async () => {
    const abort = new AbortController();
    const transport = new ApiTransport({ baseUrl: "https://api.example.com", getAccessToken: async () => null, fetchImpl: async () => { abort.abort(); throw new DOMException("signal is aborted without reason", "AbortError"); } });
    await expect(transport.request({ method: "GET", path: "/v1/items/file", signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws a retryable NETWORK_ERROR on timeout", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      requestSignal = init.signal;
      return new Promise<Response>(() => {});
    });
    const transport = new ApiTransport({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => null,
      fetchImpl,
      timeoutMs: 30,
    });

    let caught: unknown = null;
    try {
      await transport.request({ method: "GET", path: "/v1/libraries" });
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("NETWORK_ERROR");
    expect(caught.retryable).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
  });
  it("allows a large binary transfer to run beyond the metadata timeout", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (response: Response) => void;
      let signal: AbortSignal | null | undefined;
      const transport = new ApiTransport({ baseUrl: "https://fixture.example", getAccessToken: async () => "fixture", fetchImpl: async (_url, init) => { signal = init.signal; return new Promise<Response>(resolve => { finish = resolve; }); } });
      const request = transport.request({ method: "PUT", path: "/v1/upload/parts/1", body: new ArrayBuffer(20 * 1024 * 1024) });
      await vi.advanceTimersByTimeAsync(20000);
      expect(signal?.aborted).toBe(false);
      finish(makeResponse(200, { etag: "verified" }));
      expect((await request).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });
  it.each(["arrayBuffer", "text"] as const)("times out a stalled %s body after response headers", async (responseType) => {
    vi.useFakeTimers();
    let release!: (value: never) => void;
    let requestSignal: AbortSignal | null | undefined;
    let outcome: unknown = "pending";
    try {
      const transport = new ApiTransport({ baseUrl: "https://fixture.example", getAccessToken: async () => null, timeoutMs: 30,
        fetchImpl: async (_url, init) => {
          requestSignal = init.signal;
          const body = () => new Promise<never>((_resolve, reject) => { release = reject; init.signal?.addEventListener("abort", () => reject(new DOMException("body aborted", "AbortError")), { once: true }); });
          return { ...makeResponse(200, {}), text: body, arrayBuffer: body } as Response;
        },
      });
      void transport.request({ method: "GET", path: "/v1/content", ...(responseType === "arrayBuffer" ? { responseType } : {}) }).then(value => { outcome = value; }, error => { outcome = error; });
      await vi.advanceTimersByTimeAsync(31);
      expect(outcome).toMatchObject({ code: "NETWORK_ERROR", retryable: true, message: "request timed out" });
      expect(requestSignal?.aborted).toBe(true);
    } finally { release?.(undefined as never); vi.useRealTimers(); }
  });
  it.each(["arrayBuffer", "text"] as const)("forwards caller cancellation during the %s body", async (responseType) => {
    const abort = new AbortController();
    let release!: (value: never) => void;
    let requestSignal: AbortSignal | null | undefined;
    let outcome: unknown = "pending";
    try {
      const transport = new ApiTransport({ baseUrl: "https://fixture.example", getAccessToken: async () => null,
        fetchImpl: async (_url, init) => {
          requestSignal = init.signal;
          const body = () => new Promise<never>((_resolve, reject) => { release = reject; init.signal?.addEventListener("abort", () => reject(new DOMException("body aborted", "AbortError")), { once: true }); });
          return { ...makeResponse(200, {}), text: body, arrayBuffer: body } as Response;
        },
      });
      void transport.request({ method: "GET", path: "/v1/content", signal: abort.signal, ...(responseType === "arrayBuffer" ? { responseType } : {}) }).then(value => { outcome = value; }, error => { outcome = error; });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      abort.abort();
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(requestSignal?.aborted).toBe(true);
      expect(outcome).toMatchObject({ name: "AbortError" });
    } finally { release?.(undefined as never); }
  });
  it("maps a response body network failure to the retryable network envelope", async () => {
    const transport = new ApiTransport({ baseUrl: "https://fixture.example", getAccessToken: async () => null, fetchImpl: async () => ({ ...makeResponse(200, {}), text: async () => { throw new TypeError("body connection closed"); } }) as Response });
    await expect(transport.request({ method: "GET", path: "/v1/content" })).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });
  });
});

describe("remote repository wiring", () => {
  it("routes listItems through the transport to the versioned path", async () => {
    const transport = {
      request: vi.fn(
        async (): Promise<TransportResponse> => ({
          status: 200,
          body: [{ id: "item-1" }],
          requestId: "req-9",
        }),
      ),
    };
    const repo = new RemoteRepository(transport);

    const items = await repo.listItems({ libraryId: "lib-1" });
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/v1/libraries/lib-1/items" }),
    );
    expect(items).toHaveLength(1);
  });

  it("maps item, child, version and lifecycle operations instead of throwing not implemented", async () => {
    const transport = {
      request: vi.fn(async (input: { path: string; method: string }) => ({
        status: 200,
        body: input.path.includes("versions") ? [] : { id: "item-1" },
      })),
    };
    const repo = new RemoteRepository(transport);

    await repo.getItem("item-1");
    await repo.updateItem({ itemId: "item-1", title: "Updated" });
    await repo.trashItem("item-1");
    await repo.restoreItem("item-1");
    await repo.addItemChild({ parentItemId: "item-1", relativePath: "notes.md", kind: "markdown" });
    await repo.listItemChildren("item-1");
    await repo.createVersion({ itemId: "item-1", manifest: {}, contentHash: "hash" });
    await repo.listItemVersions("item-1");
    await repo.listOperations("lib-1");

    expect(transport.request).toHaveBeenCalledTimes(9);
    expect(transport.request).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining("not-implemented") }));
  });

  it("maps sync push/pull and composes a real SyncEngine", async () => {
    const operation: SyncOperation = {
      id: "op-1",
      libraryId: "lib-1",
      actorId: "user-1",
      deviceId: "device-1",
      clientSequence: 1,
      operationType: "item.create",
      entityType: "item",
      entityId: "item-1",
      payload: {},
      idempotencyKey: "device-1:1",
      createdAt: "2026-08-30T00:00:00.000Z",
    };
    const transport = {
      request: vi.fn(async (input: { path: string }) => ({
        status: 200,
        body: input.path.endsWith("/push")
          ? { accepted: ["op-1"], rejected: [], conflicts: [] }
          : { operations: [operation], cursor: "cursor-1", hasMore: false },
      })),
    };
    const repository = new RemoteRepository(transport);

    await expect(repository.pushOperations([operation])).resolves.toMatchObject({ accepted: ["op-1"] });
    await expect(repository.pullOperations("lib-1")).resolves.toMatchObject({ operations: [operation], cursor: "cursor-1" });
    expect(repository.createSyncEngine({ libraryId: "lib-1", storage: new InMemorySyncQueueStorage() }).getState()).toBe("offline");
  });

  it("routes annotation comment threads through the remote repository", async () => {
    const transport = {
      request: vi.fn(async (input: { method: string; path: string }) => ({
        status: 200,
        body: input.method === "GET" ? [] : { id: "comment-1", annotationId: "ann-1", body: "Reply" },
      })),
    };
    const repository = new RemoteRepository(transport);
    await repository.createComment({ annotationId: "ann-1", body: "Reply" });
    await repository.listComments("ann-1");
    await repository.updateComment({ commentId: "comment-1", body: "Edited" });
    await repository.deleteComment("comment-1");
    expect(transport.request.mock.calls.map(([input]) => input.path)).toEqual([
      "/v1/annotations/ann-1/comments",
      "/v1/annotations/ann-1/comments",
      "/v1/comments/comment-1",
      "/v1/comments/comment-1",
    ]);
  });
});
