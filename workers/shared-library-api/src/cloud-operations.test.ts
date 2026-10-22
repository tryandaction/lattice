// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluateCloudHealth, checkCloudHealth } from "../../../scripts/cloud-library-health.mjs";
import { exportCloudObjects, verifyCloudObjectBackup } from "../../../scripts/cloud-library-object-backup.mjs";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer, type RequestListener } from "node:http";

const usage = { usedBytes: 10, reservedBytes: 10, maxStorageBytes: 100 };
const healthy = { schemaVersion: "202610170001", bucketPrivate: true, bucketMaxFileBytes: 20971520, maxFileBytes: 20971520, expiredUploads: 0, usage: { ...usage, supabaseService: usage } };

describe("operator health and capacity probe", () => {
  it("warns on reserved capacity and abandoned sessions without claiming a production monitor exists", () => {
    expect(evaluateCloudHealth(healthy)).toEqual({ status: "ok", issues: [] });
    expect(evaluateCloudHealth({ ...healthy, expiredUploads: 2, usage: { ...healthy.usage, reservedBytes: 70 } })).toMatchObject({ status: "warning", issues: [{ code: "EXPIRED_UPLOADS" }, { code: "CAPACITY", scope: "library" }] });
    expect(evaluateCloudHealth({ ...healthy, usage: { ...healthy.usage, supabaseService: { ...usage, usedBytes: 90 } } })).toMatchObject({ status: "critical", issues: [{ code: "CAPACITY", scope: "service" }] });
  });
  it("fails closed on a missing private bucket or stale deployment", () => {
    expect(evaluateCloudHealth({ ...healthy, bucketPrivate: false }).status).toBe("critical");
    expect(evaluateCloudHealth({ ...healthy, bucketMaxFileBytes: 5242880 }).status).toBe("critical");
    expect(evaluateCloudHealth({ ...healthy, schemaVersion: "old" }).status).toBe("critical");
  });
  it("keeps the user credential out of status output", async () => {
    let received: string | null = null;
    const result = await checkCloudHealth({ apiUrl: "https://fixture.example", libraryId: "fixture-lib", accessToken: "fixture-secret", fetchImpl: async (_url, init) => {
      received = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify(healthy), { headers: { "x-request-id": "fixture-request" } });
    } });
    expect(received).toBe("Bearer fixture-secret");
    expect(result).toMatchObject({ status: "ok", requestId: "fixture-request" });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
  it("exports only authenticated immutable object bytes and detects backup corruption", async () => {
    const bytes = new TextEncoder().encode("synthetic object backup");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const directory = resolve(await mkdtemp(resolve(".lattice-build/cloud-object-backup-fixture-")), "backup");
    const result = await exportCloudObjects({ supabaseUrl: "https://fixture.example", publicKey: "public-fixture", accessToken: "private-fixture", libraryId: "lib-fixture", output: directory,
      fetchImpl: async (url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-fixture");
        return String(url).includes("/rest/v1/") ? new Response(JSON.stringify([{ id: "blob-fixture", storage_key: "libraries/lib-fixture/blobs/object", storage_backend: "supabase", size_bytes: bytes.byteLength, sha256 }])) : new Response(bytes);
      },
    });
    expect(result).toEqual({ status: "passed", objects: 1, totalBytes: bytes.byteLength });
    expect(await verifyCloudObjectBackup(directory)).toEqual({ status: "passed", objects: 1 });
    await writeFile(resolve(directory, "objects", `${sha256}.bin`), "corrupted");
    await expect(verifyCloudObjectBackup(directory)).rejects.toThrow("Backup integrity mismatch");
  });
});

async function withLocalServer(handler: RequestListener, run: (apiUrl: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

describe("local operator failure boundaries", () => {
  it("rejects malformed upload counters and a truthy non-boolean bucket flag", () => {
    expect(evaluateCloudHealth({ ...healthy, expiredUploads: -1 }).status).toBe("critical");
    expect(evaluateCloudHealth({ ...healthy, expiredUploads: undefined }).status).toBe("critical");
    expect(evaluateCloudHealth({ ...healthy, bucketPrivate: "true" }).status).toBe("critical");
    expect(evaluateCloudHealth(null).status).toBe("critical");
  });

  it("records a timed-out response body as a failed check with a timestamp and request id", async () => {
    await withLocalServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "local-timeout" });
      response.write("{");
      setTimeout(() => response.end(JSON.stringify(healthy).slice(1)), 120);
    }, async apiUrl => {
      const result = await checkCloudHealth({ apiUrl, libraryId: "local", accessToken: "synthetic", timeoutMs: 30 });
      expect(result).toMatchObject({ status: "critical", issues: [{ code: "PROBE_TIMEOUT" }], requestId: "local-timeout" });
      expect(result.checkedAt).toMatch(/^\d{4}-/);
      expect(result.elapsedMs).toBeLessThan(110);
    });
  });

  it("honors caller cancellation without returning a healthy result", async () => {
    const controller = new AbortController();
    controller.abort();
    await withLocalServer((_request, response) => response.end(JSON.stringify(healthy)), async apiUrl => {
      const result = await checkCloudHealth({ apiUrl, libraryId: "local", accessToken: "synthetic", signal: controller.signal });
      expect(result).toMatchObject({ status: "critical", issues: [{ code: "PROBE_CANCELLED" }] });
      expect(result.checkedAt).toMatch(/^\d{4}-/);
    });
  });

  it("keeps authentication failures distinct from retryable network failures", async () => {
    await withLocalServer((_request, response) => {
      response.writeHead(401, { "x-request-id": "local-expired" }); response.end("expired synthetic token");
    }, async apiUrl => {
      const result = await checkCloudHealth({ apiUrl, libraryId: "local", accessToken: "synthetic" });
      expect(result).toMatchObject({ status: "critical", issues: [{ code: "AUTHENTICATION_FAILED", httpStatus: 401 }], requestId: "local-expired" });
      expect(result.checkedAt).toMatch(/^\d{4}-/);
      expect(JSON.stringify(result)).not.toContain("synthetic");
    });
  });

  it("does not log a credential reflected in an upstream request id", async () => {
    await withLocalServer((_request, response) => {
      response.writeHead(200, { "x-request-id": "synthetic-secret" }); response.end(JSON.stringify(healthy));
    }, async apiUrl => {
      const result = await checkCloudHealth({ apiUrl, libraryId: "local", accessToken: "synthetic-secret" });
      expect(result.status).toBe("ok");
      expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    });
  });

  it("rejects duplicate blob metadata before declaring an object backup complete", async () => {
    const bytes = Buffer.from("duplicate fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const row = { id: "duplicate", storage_key: "libraries/local/blobs/key", storage_backend: "supabase", size_bytes: bytes.length, sha256 };
    const output = resolve(await mkdtemp(resolve(".lattice-build/cloud-duplicate-fixture-")), "backup");
    await withLocalServer((request, response) => response.end(request.url?.startsWith("/rest/") ? JSON.stringify([row, row]) : bytes), async supabaseUrl => {
      await expect(exportCloudObjects({ supabaseUrl, publicKey: "synthetic", accessToken: "synthetic", libraryId: "local", output })).rejects.toThrow(/duplicate/i);
    });
    await expect(readFile(resolve(output, "manifest.json"))).rejects.toThrow();
  });

  it("refuses a restore manifest key that would normalize outside the library blob prefix", async () => {
    const output = await mkdtemp(resolve(".lattice-build/cloud-path-fixture-"));
    const bytes = Buffer.from("path fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(resolve(output, "objects"));
    await writeFile(resolve(output, "objects", `${sha256}.bin`), bytes);
    await writeFile(resolve(output, "manifest.json"), JSON.stringify({ version: 1, complete: true, libraryId: "local", objects: [{ id: "path", storage_key: "libraries/local/blobs/../../escape", storage_backend: "supabase", size_bytes: bytes.length, sha256 }] }));
    await expect(verifyCloudObjectBackup(output)).rejects.toThrow(/descriptor|path/i);
  });

  it("refuses a symlinked objects directory even when external bytes match the hash", async () => {
    const output = await mkdtemp(resolve(".lattice-build/cloud-link-fixture-"));
    const external = await mkdtemp(resolve(".lattice-build/cloud-external-fixture-"));
    const bytes = Buffer.from("external fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(resolve(external, `${sha256}.bin`), bytes);
    await symlink(external, resolve(output, "objects"), "junction");
    await writeFile(resolve(output, "manifest.json"), JSON.stringify({ version: 1, complete: true, libraryId: "local", objects: [{ id: "linked", storage_key: "libraries/local/blobs/key", storage_backend: "supabase", size_bytes: bytes.length, sha256 }] }));
    await expect(verifyCloudObjectBackup(output)).rejects.toThrow(/symbolic|symlink|path/i);
  });

  it("leaves no complete manifest when the second downloaded object fails integrity", async () => {
    const bytes = Buffer.from("first valid fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const first = { id: "first", storage_key: "libraries/local/blobs/first", storage_backend: "supabase", size_bytes: bytes.length, sha256 };
    const second = { ...first, id: "second", storage_key: "libraries/local/blobs/second" };
    const output = resolve(await mkdtemp(resolve(".lattice-build/cloud-partial-fixture-")), "backup");
    await withLocalServer((request, response) => response.end(request.url?.startsWith("/rest/") ? JSON.stringify([first, second]) : request.url?.endsWith("/first") ? bytes : "corrupted"), async supabaseUrl => {
      await expect(exportCloudObjects({ supabaseUrl, publicKey: "synthetic", accessToken: "synthetic", libraryId: "local", output })).rejects.toThrow(/integrity/i);
    });
    expect(await readFile(resolve(output, "objects", `${sha256}.bin`))).toEqual(bytes);
    await expect(readFile(resolve(output, "manifest.json"))).rejects.toThrow();
    await expect(verifyCloudObjectBackup(output)).rejects.toThrow();
  });
});
