import { describe, expect, it, vi } from "vitest";
import { handleRequest, type SharedLibraryWorkerEnv } from "./index";

const env: SharedLibraryWorkerEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  ALLOWED_ORIGINS: "https://app.example.com",
};

function jwt(subject = "user-1"): string {
  const encode = (value: string) => Buffer.from(value).toString("base64url");
  return `${encode("{}")}.${encode(JSON.stringify({ sub: subject }))}.signature`;
}

describe("shared library Worker API", () => {
  it("rejects unauthenticated requests before contacting Supabase", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await handleRequest(new Request("https://api.example.com/v1/libraries"), env, "req-1");

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("forwards the user JWT to Supabase and maps library records", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([
      { id: "lib-1", organization_id: "org-1", name: "Research", slug: "research", visibility: "private", created_by: "user-1", created_at: "2026-08-30T00:00:00.000Z", updated_at: "2026-08-30T00:00:00.000Z" },
    ]), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await handleRequest(new Request("https://api.example.com/v1/libraries", {
      headers: { Authorization: `Bearer ${jwt()}`, Origin: "https://app.example.com" },
    }), env, "req-2");
    const body = await response.json();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(body).toMatchObject([{ id: "lib-1", organizationId: "org-1", name: "Research" }]);
    expect((init.headers as Headers).get("authorization")).toContain("Bearer");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    fetchMock.mockRestore();
  });

  it("searches only the requested library and returns the stable result contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify([
      {
        library_id: "lib-1",
        item_id: "item-1",
        source_type: "item",
        title: "Quantum",
        body: "Quantum entanglement",
        locator: { page: 2 },
        updated_at: "2026-08-30T00:00:00.000Z",
      },
    ]), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await handleRequest(new Request("https://api.example.com/v1/libraries/lib-1/search?q=  Quantum%20%25  &limit=20", {
      headers: { Authorization: `Bearer ${jwt()}` },
    }), env, "req-search");
    const body = await response.json() as { results: Array<Record<string, unknown>> };
    const requestedUrl = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      itemId: "item-1",
      sourceType: "item",
      snippet: "Quantum entanglement",
      permissionSnapshot: { libraryId: "lib-1", itemId: "item-1", canRead: true },
    });
    expect(requestedUrl).toContain("library_id=eq.lib-1");
    expect(requestedUrl).toContain("or=title.ilike");
    expect(requestedUrl).not.toContain("%25%25");
    fetchMock.mockRestore();
  });

  it("completes an authenticated R2 multipart upload and serves protected content", async () => {
    const uploadedParts = new Map<number, ArrayBuffer>();
    const object = new TextEncoder().encode("remote content").buffer;
    const objectDigest = await crypto.subtle.digest("SHA-256", object);
    const objectSha256 = Array.from(new Uint8Array(objectDigest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const bucket = {
      createMultipartUpload: async (key: string) => ({
        uploadId: "r2-upload-1",
        key,
        uploadPart: async (partNumber: number, data: ArrayBuffer) => {
          uploadedParts.set(partNumber, data);
          return { etag: `etag-${partNumber}` };
        },
        complete: async () => undefined,
        abort: async () => undefined,
      }),
      resumeMultipartUpload: (key: string, uploadId: string) => ({
        uploadId,
        key,
        uploadPart: async (partNumber: number, data: ArrayBuffer) => {
          uploadedParts.set(partNumber, data);
          return { etag: `etag-${partNumber}` };
        },
        complete: async () => undefined,
        abort: async () => undefined,
      }),
      get: async () => ({ body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(object)); controller.close(); } }), httpMetadata: { contentType: "text/plain", contentLength: object.byteLength } }),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/library_members?") || url.includes("/library_members?")) return new Response(JSON.stringify([{ role: "editor", status: "active" }]), { status: 200 });
      if (url.includes("/cloud_upload_sessions") && method === "POST") return new Response(JSON.stringify([{ id: "upload-session-1" }]), { status: 201 });
      if (url.includes("/cloud_upload_sessions")) return new Response(JSON.stringify([{ expires_at: new Date(Date.now() + 3600000).toISOString(), descriptor: { libraryId: "lib-1", key: "libraries/lib-1/blobs/key", uploadId: "r2-upload-1", fileName: "研究笔记.txt", mimeType: "text/plain", sizeBytes: object.byteLength } }]), { status: 200 });
      if (url.includes("/blobs?select=id")) return new Response("[]", { status: 200 });
      if (url.endsWith("/blobs") && method === "POST") return new Response(JSON.stringify([{ id: "blob-1" }]), { status: 201 });
      if (url.includes("/blobs?select=*") || url.includes("/blobs?select=%2A") || url.includes("/blobs?select=id%2Csha256")) return new Response(JSON.stringify([{ id: "blob-1", sha256: objectSha256, storage_key: "libraries/lib-1/blobs/key", mime_type: "text/plain" }]), { status: 200 });
      return new Response("[]", { status: 200 });
    });
    const envWithR2 = { ...env, LIBRARY_BLOBS: bucket };
    const createResponse = await handleRequest(new Request("https://api.example.com/v1/libraries/lib-1/uploads", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt()}`, "content-type": "application/json" },
      body: JSON.stringify({ fileName: "研究笔记.txt", mimeType: "text/plain", sizeBytes: object.byteLength }),
    }), envWithR2, "req-upload");
    const session = await createResponse.json() as { uploadId: string };

    const partResponse = await handleRequest(new Request(`https://api.example.com/v1/libraries/lib-1/uploads/${session.uploadId}/parts/1`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${jwt()}` },
      body: object,
    }), envWithR2, "req-part");
    const completeResponse = await handleRequest(new Request(`https://api.example.com/v1/libraries/lib-1/uploads/${session.uploadId}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt()}`, "content-type": "application/json" },
      body: JSON.stringify({ sha256: objectSha256, parts: [{ partNumber: 1, etag: "etag-1" }] }),
    }), envWithR2, "req-complete");
    const contentResponse = await handleRequest(new Request("https://api.example.com/v1/libraries/lib-1/blobs/blob-1/content", {
      headers: { Authorization: `Bearer ${jwt()}` },
    }), envWithR2, "req-content");

    expect(createResponse.status).toBe(201);
    expect(partResponse.status).toBe(200);
    expect(completeResponse.status).toBe(201);
    expect(await completeResponse.json()).toEqual({ blobId: "blob-1" });
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toBe("text/plain");
    expect(uploadedParts.get(1)?.byteLength).toBe(object.byteLength);
    fetchMock.mockRestore();
  });

  it("maps annotation comments and rejects blank bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return new Response(JSON.stringify([{ id: "comment-1", annotation_id: "ann-1", author_id: "user-1", body: "Useful", created_at: "2026-08-30T00:00:00.000Z" }]), { status: 201 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const create = await handleRequest(new Request("https://api.example.com/v1/annotations/ann-1/comments", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt()}`, "content-type": "application/json" },
      body: JSON.stringify({ body: "Useful" }),
    }), env, "req-comment");
    const blank = await handleRequest(new Request("https://api.example.com/v1/annotations/ann-1/comments", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt()}`, "content-type": "application/json" },
      body: JSON.stringify({ body: "   " }),
    }), env, "req-comment-invalid");
    const list = await handleRequest(new Request("https://api.example.com/v1/annotations/ann-1/comments", {
      headers: { Authorization: `Bearer ${jwt()}` },
    }), env, "req-comment-list");

    expect(create.status).toBe(201);
    expect(await create.json()).toMatchObject({ id: "comment-1", annotationId: "ann-1" });
    expect(blank.status).toBe(400);
    expect(list.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
