// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProtocolServer, PROFILE_A, TEST_PASSWORD } from "../../../../workers/shared-library-api/test-support/protocol-server";
import { CloudLibraryWorkspaceController, type CloudWorkspaceSnapshot } from "../cloud-workspace";
import { ApiTransport } from "../api-transport";
import { defaultSha256Hex } from "../blob-store";
import type { CloudPersistence } from "../cloud-persistence";
import type { SharedLibraryItemContent } from "../content-store";
import type { CloudLibraryConnection } from "../connection";

describe("20MiB private Storage with real HTTP and PostgreSQL RLS", () => {
  let server: Awaited<ReturnType<typeof createProtocolServer>>;
  let connection: CloudLibraryConnection;
  let token: string;
  beforeAll(async () => {
    server = await createProtocolServer({ storageBackend: "supabase" });
    connection = { id: "large-fixture", name: "Synthetic", apiUrl: server.apiUrl, supabaseUrl: server.authUrl, publicKey: "sb_publishable_fixture", maxFileBytes: 20 * 1024 * 1024 };
    const login = await fetch(`${server.authUrl}/auth/v1/token`, { method: "POST", body: JSON.stringify({ email: "a@cloud.test", password: TEST_PASSWORD }) });
    token = (await login.json()).access_token;
  }, 120000);
  afterAll(async () => { await server?.close(); });

  it("restores a durable negotiated session after a lost persisted response, then downloads identical PDF bytes", async () => {
    let saved: CloudWorkspaceSnapshot | null = null;
    const contents = new Map<string, SharedLibraryItemContent>();
    const persistence: CloudPersistence<CloudWorkspaceSnapshot> = {
      load: async () => structuredClone(saved), content: async key => structuredClone(contents.get(key) ?? null),
      async commit(next, entries = []) { saved = structuredClone(next); for (const entry of entries) if (entry.content) contents.set(entry.key, structuredClone(entry.content)); else contents.delete(entry.key); },
    };
    const transport = () => new ApiTransport({ baseUrl: connection.apiUrl, getAccessToken: async () => token });
    const controller = new CloudLibraryWorkspaceController(connection, PROFILE_A, persistence, transport());
    await controller.initialize();
    const library = await controller.createLibrary("20MiB synthetic PDF");
    const data = new Uint8Array(connection.maxFileBytes); data.set(new TextEncoder().encode("%PDF-1.7\n%synthetic only\n")); data[data.length - 1] = 71;
    const item = await controller.createItem({ libraryId: library.id, name: "synthetic-20MiB.pdf", kind: "pdf" }, { kind: "binary", data: data.buffer, mimeType: "application/pdf", updatedAt: "2026-10-17T00:00:00Z" });
    server.loseNextPartResponse();
    await controller.sync();
    expect(controller.getSnapshot().outbox).toHaveLength(1);
    expect(controller.getSnapshot().outbox[0].upload?.partSize).toBe(data.byteLength);
    expect(controller.getSnapshot().outbox[0].parts).toBeUndefined();
    expect((await server.db.query("select count(*)::int as count from storage.objects")).rows[0].count).toBe(1);
    controller.dispose();

    const reopened = new CloudLibraryWorkspaceController(connection, PROFILE_A, persistence, transport());
    await reopened.initialize(); await reopened.sync();
    expect(reopened.getSnapshot().outbox).toEqual([]);
    expect(reopened.getStatus()).toMatchObject({ status: "synced", pending: 0 });
    expect(server.partCalls()).toBe(2);
    const remote = await reopened.readContent(library.id, item.id);
    expect(remote?.kind).toBe("binary");
    expect(await defaultSha256Hex((remote as { data: ArrayBuffer }).data)).toBe(await defaultSha256Hex(data.buffer));
    expect((await server.db.query("select state from public.cloud_upload_sessions")).rows).toEqual([{ state: "complete" }]);
    const health = await transport().request({ method: "GET", path: `/v1/libraries/${library.id}/health` });
    expect(health.body).toMatchObject({ schemaVersion: "202610170001", bucketPrivate: true, bucketMaxFileBytes: connection.maxFileBytes, expiredUploads: 0, activeUploads: 0 });
    reopened.dispose();
  }, 120000);

  it("physically cleans a conflicting pending object and retries with a fresh durable session", async () => {
    let saved: CloudWorkspaceSnapshot | null = null;
    const contents = new Map<string, SharedLibraryItemContent>();
    const persistence: CloudPersistence<CloudWorkspaceSnapshot> = {
      load: async () => structuredClone(saved), content: async key => structuredClone(contents.get(key) ?? null),
      async commit(next, entries = []) { saved = structuredClone(next); for (const entry of entries) if (entry.content) contents.set(entry.key, structuredClone(entry.content)); else contents.delete(entry.key); },
    };
    let injected = false, failAbort = true;
    const transport = new ApiTransport({ baseUrl: connection.apiUrl, getAccessToken: async () => token, fetchImpl: async (url, init) => {
      if (failAbort && init.method === "POST" && url.endsWith("/abort")) { failAbort = false; return new Response(JSON.stringify({ error: { code: "STORAGE_UNAVAILABLE", message: "synthetic abort unavailable", retryable: true } }), { status: 503 }); }
      if (!injected && init.method === "PUT" && url.includes("/parts/1")) {
        injected = true;
        const wrong = new Uint8Array((init.body as ArrayBuffer).slice(0)); wrong[0] ^= 1;
        const persisted = await fetch(url, { ...init, body: wrong }); expect(persisted.status).toBe(200); await persisted.arrayBuffer();
      }
      return fetch(url, init);
    } });
    const controller = new CloudLibraryWorkspaceController(connection, PROFILE_A, persistence, transport);
    await controller.initialize();
    const library = await controller.createLibrary("conflict cleanup fixture");
    const data = new TextEncoder().encode("synthetic immutable bytes").buffer;
    const item = await controller.createItem({ libraryId: library.id, name: "conflict.txt", kind: "data" }, { kind: "binary", data, mimeType: "application/octet-stream", updatedAt: "2026-10-17T00:00:00Z" });
    await controller.sync();
    const failed = controller.getSnapshot().outbox[0];
    expect(failed.state).toBe("failed");
    expect((await server.db.query("select state from public.cloud_upload_sessions where id=$1", [failed.upload!.uploadId])).rows).toEqual([{ state: "aborted" }]);
    expect((await server.db.query("select count(*)::int as count from storage.objects where name like $1", [`libraries/${library.id}/blobs/%`])).rows[0].count).toBe(0);
    await expect(controller.retry(failed.id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(controller.getSnapshot().outbox[0].id).toBe(failed.id);
    expect(controller.getSnapshot().outbox[0].upload?.uploadId).toBe(failed.upload!.uploadId);
    await controller.retry(failed.id);
    expect(controller.getSnapshot().outbox[0].id).not.toBe(failed.id);
    expect(controller.getSnapshot().outbox[0].upload).toBeUndefined();
    await controller.sync();
    expect(controller.getSnapshot().outbox).toEqual([]);
    expect(await defaultSha256Hex((await controller.readContent(library.id, item.id) as { data: ArrayBuffer }).data)).toBe(await defaultSha256Hex(data));
    controller.dispose();
  }, 120000);
});
