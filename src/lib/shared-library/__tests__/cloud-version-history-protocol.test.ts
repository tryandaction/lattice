// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProtocolServer, PROFILE_A, TEST_PASSWORD } from "../../../../workers/shared-library-api/test-support/protocol-server";
import { ApiTransport } from "../api-transport";
import type { CloudPersistence } from "../cloud-persistence";
import { CloudLibraryWorkspaceController, type CloudWorkspaceSnapshot } from "../cloud-workspace";
import type { SharedLibraryItemContent } from "../content-store";

describe("cloud version history ordinary HTTP workflow", () => {
  let server: Awaited<ReturnType<typeof createProtocolServer>>;
  beforeAll(async () => { server = await createProtocolServer(); }, 120000);
  afterAll(async () => { await server?.close(); });

  it("lists and downloads old content, then commits restoration as a new immutable version", async () => {
    const login = await fetch(`${server.authUrl}/auth/v1/token`, { method: "POST", body: JSON.stringify({ email: "a@cloud.test", password: TEST_PASSWORD }) });
    const token = (await login.json()).access_token;
    let snapshot: CloudWorkspaceSnapshot | null = null;
    const contents = new Map<string, SharedLibraryItemContent>();
    const persistence: CloudPersistence<CloudWorkspaceSnapshot> = {
      load: async () => structuredClone(snapshot), content: async key => structuredClone(contents.get(key) ?? null),
      async commit(next, entries = []) { snapshot = structuredClone(next); for (const entry of entries) if (entry.content) contents.set(entry.key, structuredClone(entry.content)); else contents.delete(entry.key); },
    };
    const connection = { id: "history-protocol", name: "History", apiUrl: server.apiUrl, supabaseUrl: server.authUrl, publicKey: "sb_publishable_fixture", maxFileBytes: 1024 * 1024 };
    const controller = new CloudLibraryWorkspaceController(connection, PROFILE_A, persistence, new ApiTransport({ baseUrl: connection.apiUrl, getAccessToken: async () => token }));
    try {
      await controller.initialize();
      const library = await controller.createLibrary("历史版本普通流程");
      const content = (text: string): SharedLibraryItemContent => ({ kind: "text", text, mimeType: "text/markdown", updatedAt: new Date().toISOString() });
      const item = await controller.createItem({ libraryId: library.id, name: "history.md", kind: "markdown" }, content("# Original"));
      await controller.sync(); expect(controller.getStatus().pending).toBe(0);
      const next = await controller.save(library.id, item.id, content("# Collaborator revision"), item.currentVersionId);
      await controller.sync(); expect(controller.getStatus().pending).toBe(0);
      const versions = await controller.listVersions(library.id, item.id);
      expect(versions.map(version => version.versionNumber)).toEqual([2, 1]);
      const original = versions[1];
      expect(await controller.readVersion(library.id, item.id, original.id)).toMatchObject({ kind: "text", text: "# Original" });
      const restored = await controller.restoreVersion(library.id, item.id, original.id, next!);
      expect(restored).not.toBe(original.id);
      await controller.sync(); expect(controller.getStatus()).toMatchObject({ status: "synced", pending: 0 });
      const history = await controller.listVersions(library.id, item.id);
      expect(history).toHaveLength(3);
      expect(history[0]).toMatchObject({ id: restored, versionNumber: 3, baseVersionId: next, contentHash: original.contentHash, manifest: { restoredFromVersionId: original.id } });
      expect(history.slice(1)).toEqual(versions);
      expect(await controller.readContent(library.id, item.id)).toMatchObject({ text: "# Original" });
    } finally { controller.dispose(); }
  });
});
