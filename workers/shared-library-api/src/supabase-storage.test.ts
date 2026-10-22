import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest, type SharedLibraryWorkerEnv } from "./index";

const token = `${btoa("{}")}\.${btoa(JSON.stringify({ sub: "user-1" }))}.signature`;
const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_ANON_KEY: "public-key", BLOB_BACKEND: "supabase" } as SharedLibraryWorkerEnv;
const base = "https://worker.example/v1/libraries/lib-1";
const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
const bytes = new TextEncoder().encode("persisted private content").buffer;

function fixture() {
  let descriptor: Record<string, unknown> | undefined;
  let state = "active";
  let stored: ArrayBuffer | undefined;
  let blob: Record<string, unknown> | undefined;
  let role = "editor";
  let cleanupFails = false;
  let finalizeFails = false;
  let quotaFails = false;
  let expired = false;
  let releaseIgnored = false;
  let deletionIgnored = false;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ url, init });
    const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes("/library_members?")) return ok([{ role }]);
    if (url.includes("/cloud_upload_sessions") && method === "POST") {
      if (quotaFails) return ok({ code: "P0001" }, 400);
      descriptor = JSON.parse(String(init?.body)).descriptor;
      return ok([], 201);
    }
    if (url.includes("/cloud_upload_sessions") && method === "PATCH") {
      if (releaseIgnored) return ok([]);
      state = JSON.parse(String(init?.body)).state; return ok([{ id: "session-id", state }]);
    }
    if (url.includes("/cloud_upload_sessions")) {
      if (url.includes("expires_at=lt.") && !expired) return ok([]);
      return ok(descriptor ? [{ id: "session-id", descriptor, state, expires_at: new Date(Date.now() + (expired ? -60000 : 60000)).toISOString() }] : []);
    }
    if (url.includes("/storage/v1/object/authenticated/")) return stored ? new Response(stored, { headers: { "content-type": "text/plain" } }) : ok({ error: "not found" }, 404);
    if (url.endsWith("/storage/v1/object/lattice-shared-library") && method === "DELETE") {
      if (cleanupFails) return ok({ error: "offline" }, 503);
      if (!deletionIgnored) stored = undefined;
      return ok([]);
    }
    if (url.includes("/storage/v1/object/lattice-shared-library/") && method === "POST") {
      if (stored) return ok({ statusCode: "409", error: "Duplicate" }, 400);
      stored = await new Response(init?.body).arrayBuffer();
      return ok({ Key: "stored" }, 200);
    }
    if (url.includes("/rpc/cloud_complete_storage_upload")) {
      if (finalizeFails) return ok({ code: "fixture_failure" }, 503);
      blob = { id: "blob-1", storage_key: descriptor?.key, sha256: JSON.parse(String(init?.body)).p_sha256, storage_backend: "supabase", mime_type: "text/plain" };
      state = "complete";
      return ok("blob-1");
    }
    if (url.includes("/blobs?")) return ok(blob ? [blob] : []);
    return ok([]);
  });
  return { calls, stored: () => stored, state: () => state, setRole: (value: string) => { role = value; }, failCleanup: () => { cleanupFails = true; }, failFinalize: () => { finalizeFails = true; }, failQuota: () => { quotaFails = true; }, expire: () => { expired = true; }, ignoreRelease: () => { releaseIgnored = true; }, ignoreDeletion: () => { deletionIgnored = true; } };
}

async function start(sizeBytes = bytes.byteLength, idempotencyKey?: string) {
  const response = await handleRequest(new Request(`${base}/uploads`, { method: "POST", headers: { ...headers, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }, body: JSON.stringify({ fileName: "synthetic.pdf", mimeType: "application/pdf", sizeBytes }) }), env, "init");
  return { response, body: await response.json() as { uploadId: string; partSize: number } };
}

afterEach(() => vi.restoreAllMocks());

describe("Supabase private storage backend", () => {
  it("persists one part, retries without overwriting, atomically registers the blob and authorizes viewer downloads", async () => {
    const f = fixture();
    const { response, body } = await start();
    expect(response.status).toBe(201);
    const partRequest = () => new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes });
    const first = await handleRequest(partRequest(), env, "part");
    const part = await first.json();
    expect(first.status).toBe(200);
    expect(f.stored()).toEqual(bytes);
    expect((await handleRequest(partRequest(), env, "retry")).status).toBe(200);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const complete = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/complete`, { method: "POST", headers, body: JSON.stringify({ sha256, parts: [part] }) }), env, "complete");
    expect(complete.status).toBe(201);
    expect(await complete.json()).toEqual({ blobId: "blob-1" });
    expect(f.state()).toBe("complete");
    f.setRole("viewer");
    const download = await handleRequest(new Request(`${base}/blobs/blob-1/content`, { headers }), env, "download");
    expect(await download.text()).toBe("persisted private content");
    expect((await start()).response.status).toBe(403);
    for (const call of f.calls) {
      expect(new Headers(call.init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      expect(new Headers(call.init?.headers).get("apikey")).toBe("public-key");
    }
    expect(f.calls.some(c => c.url.includes("/rpc/cloud_complete_storage_upload"))).toBe(true);
  });

  it("negotiates and verifies a common 20MiB PDF with idempotent full-object retries", async () => {
    const f = fixture();
    const object = new Uint8Array(20 * 1024 * 1024); object.set(new TextEncoder().encode("%PDF-1.7\n%synthetic fixture\n"));
    const { response, body } = await start(20 * 1024 * 1024);
    expect(response.status).toBe(201);
    expect(body.uploadId).toBeTruthy();
    expect(body.partSize).toBe(object.byteLength);
    const put = () => handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: object }), env, "large-part");
    const first = await put();
    expect(first.status).toBe(200);
    const part = await first.json() as { partNumber: number; etag: string };
    expect((await put()).status).toBe(200);
    expect(f.stored()?.byteLength).toBe(object.byteLength);
    const complete = () => handleRequest(new Request(`${base}/uploads/${body.uploadId}/complete`, { method: "POST", headers, body: JSON.stringify({ sha256: part.etag, parts: [part] }) }), env, "large-complete");
    expect((await complete()).status).toBe(201);
    expect(f.state()).toBe("complete");
    f.expire(); // A lost completion response remains replayable after the TTL.
    expect((await complete()).status).toBe(200);
  });

  it("rejects files over 20MiB and rejects truncated negotiated parts before Storage", async () => {
    const f = fixture();
    expect((await start(20 * 1024 * 1024 + 1)).response.status).toBe(413);
    const { body } = await start(20 * 1024 * 1024);
    const short = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: new ArrayBuffer(5 * 1024 * 1024) }), env, "short");
    expect(short.status).toBe(400);
    expect(f.stored()).toBeUndefined();
  });

  it("returns the durable negotiated part size on initialize replay after a client crash", async () => {
    fixture();
    const key = "11111111-1111-4111-8111-111111111111";
    const first = await start(20 * 1024 * 1024, key);
    const replay = await start(20 * 1024 * 1024, key);
    expect(first.body.partSize).toBe(20 * 1024 * 1024);
    expect(replay.body).toMatchObject({ uploadId: key, partSize: first.body.partSize });
  });

  it("keeps the upload reservation when abort cannot delete persisted bytes", async () => {
    const f = fixture();
    const { body } = await start();
    await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    f.failCleanup();
    const abort = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/abort`, { method: "POST", headers }), env, "abort");
    expect(abort.status).toBe(503);
    expect(f.stored()).toEqual(bytes);
    expect(f.state()).toBe("active");
  });

  it("retains durable content and the session when atomic metadata finalization fails", async () => {
    const f = fixture();
    const { body } = await start();
    const partResponse = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    const part = await partResponse.json() as { etag: string };
    f.failFinalize();
    const response = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/complete`, { method: "POST", headers, body: JSON.stringify({ sha256: part.etag, parts: [part] }) }), env, "complete");
    expect(response.status).toBe(503);
    expect(f.state()).toBe("active");
    expect(f.stored()).toEqual(bytes);
  });

  it("rejects changed bytes on part retry and prevents false integrity completion", async () => {
    const f = fixture();
    const { body } = await start();
    await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    const changed = new Uint8Array(bytes.slice(0)); changed[0] ^= 1;
    const retry = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: changed }), env, "retry");
    expect(retry.status).toBe(422);
    expect(f.stored()).toBeUndefined();
    expect(f.state()).toBe("aborted");
    const removal = f.calls.findIndex(call => call.init?.method === "DELETE");
    const verification = f.calls.findIndex((call, index) => index > removal && call.url.includes("/object/authenticated/"));
    const release = f.calls.findIndex(call => call.init?.method === "PATCH");
    expect(removal).toBeGreaterThan(-1);
    expect(verification).toBeGreaterThan(removal);
    expect(release).toBeGreaterThan(verification);
    expect((await handleRequest(new Request(`${base}/uploads/${body.uploadId}/complete`, { method: "POST", headers, body: JSON.stringify({ sha256: "f".repeat(64), parts: [{ partNumber: 1, etag: "f".repeat(64) }] }) }), env, "aborted-complete")).status).toBe(410);
  });

  it("cleans persisted bytes after completion integrity failure", async () => {
    const f = fixture();
    const { body } = await start();
    await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    const sha256 = "f".repeat(64);
    const complete = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/complete`, { method: "POST", headers, body: JSON.stringify({ sha256, parts: [{ partNumber: 1, etag: sha256 }] }) }), env, "complete");
    expect(complete.status).toBe(422);
    expect(f.calls.some(c => c.url.includes("/rpc/cloud_complete_storage_upload"))).toBe(false);
    expect(f.stored()).toBeUndefined();
    expect(f.state()).toBe("aborted");
  });

  it("retains the upload identity and reservation if conflict physical cleanup fails", async () => {
    const f = fixture();
    const { body } = await start();
    await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    f.failCleanup();
    const changed = new Uint8Array(bytes.slice(0)); changed[0] ^= 1;
    const retry = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: changed }), env, "retry");
    expect(retry.status).toBe(503);
    expect(f.stored()).toEqual(bytes);
    expect(f.state()).toBe("active");
    expect(f.calls.some(call => call.init?.method === "PATCH")).toBe(false);
  });
  it("does not release a conflict reservation when Storage reports success without deleting bytes", async () => {
    const f = fixture(); const { body } = await start();
    await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    f.ignoreDeletion();
    const changed = new Uint8Array(bytes.slice(0)); changed[0] ^= 1;
    const retry = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: changed }), env, "retry");
    expect(retry.status).toBe(503);
    expect(f.stored()).toEqual(bytes); expect(f.state()).toBe("active");
    expect(f.calls.some(call => call.init?.method === "PATCH")).toBe(false);
  });
  it("never deletes committed content when a later part replay contains different bytes", async () => {
    const f = fixture(); const { body } = await start();
    const response = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    const part = await response.json() as { partNumber: number; etag: string };
    expect((await handleRequest(new Request(`${base}/uploads/${body.uploadId}/complete`, { method: "POST", headers, body: JSON.stringify({ sha256: part.etag, parts: [part] }) }), env, "complete")).status).toBe(201);
    const changed = new Uint8Array(bytes.slice(0)); changed[0] ^= 1;
    expect((await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: changed }), env, "retry")).status).toBe(410);
    expect(f.stored()).toEqual(bytes); expect(f.state()).toBe("complete");
    expect(f.calls.some(call => call.init?.method === "DELETE")).toBe(false);
  });

  it("returns capacity rejection before storing bytes", async () => {
    const f = fixture(); f.failQuota();
    const { response } = await start();
    expect(response.status).toBe(413);
    expect(f.stored()).toBeUndefined();
    expect(f.calls.some(c => c.url.includes("/storage/v1/"))).toBe(false);
  });

  it("cleans expired sessions through Storage API before releasing their reservation", async () => {
    const f = fixture();
    const { body } = await start();
    await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    f.expire();
    expect((await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "late")).status).toBe(410);
    const cleanup = await handleRequest(new Request(`${base}/uploads/cleanup`, { method: "POST", headers }), env, "cleanup");
    expect(await cleanup.json()).toEqual({ cleaned: 1, batchLimit: 25 });
    expect(f.stored()).toBeUndefined();
    expect(f.state()).toBe("aborted");
    const removal = f.calls.findIndex(c => c.init?.method === "DELETE");
    const release = f.calls.findIndex(c => c.init?.method === "PATCH");
    expect(removal).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(removal);
  });

  it("requires database confirmation before reporting a reservation released", async () => {
    const f = fixture();
    const { body } = await start();
    await handleRequest(new Request(`${base}/uploads/${body.uploadId}/parts/1`, { method: "PUT", headers, body: bytes }), env, "part");
    f.ignoreRelease();
    const abort = await handleRequest(new Request(`${base}/uploads/${body.uploadId}/abort`, { method: "POST", headers }), env, "abort");
    expect(abort.status).toBe(503);
    expect(f.stored()).toBeUndefined();
    expect(f.state()).toBe("active");
  });
});
