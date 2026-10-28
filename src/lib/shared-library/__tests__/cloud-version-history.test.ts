// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiTransport } from "../api-transport";
import { CloudPersistenceConflict, type CloudPersistence } from "../cloud-persistence";
import { CloudLibraryWorkspaceController, type CloudWorkspaceSnapshot } from "../cloud-workspace";
import type { SharedLibraryItemContent } from "../content-store";
import type { Annotation, Item, ItemVersion, LibraryRole } from "../domain";

const timestamp = "2026-10-27T00:00:00Z";
const text = (value: string): SharedLibraryItemContent => ({ kind: "text", text: value, mimeType: "text/markdown", updatedAt: timestamp });
const contentBytes = (content: SharedLibraryItemContent) => content.kind === "text" ? new TextEncoder().encode(content.text) : new Uint8Array(content.data);
const hash = (content: SharedLibraryItemContent) => createHash("sha256").update(contentBytes(content)).digest("hex");
const json = (value: unknown, status = 200) => new Response(JSON.stringify({ data: value }), { status, headers: { "content-type": "application/json" } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(options: { name?: string; older?: SharedLibraryItemContent; newer?: SharedLibraryItemContent } = {}) {
  const older = options.older ?? text("# First version");
  const newer = options.newer ?? text("# Current version");
  const versions: ItemVersion[] = [
    { id: "version-1", itemId: "item", versionNumber: 1, blobId: "blob-1", manifest: { mimeType: older.mimeType }, contentHash: hash(older), createdBy: "collaborator", createdAt: timestamp },
    { id: "version-2", itemId: "item", versionNumber: 2, blobId: "blob-2", manifest: { mimeType: newer.mimeType }, contentHash: hash(newer), createdBy: "user", baseVersionId: "version-1", createdAt: "2026-10-27T01:00:00Z" },
  ];
  const item: Item = { id: "item", libraryId: "library", title: options.name ?? "note.md", canonicalName: options.name ?? "note.md", kind: "markdown", metadata: {}, currentVersionId: "version-2", contentHash: hash(newer), status: "active", createdBy: "user", createdAt: timestamp, updatedAt: timestamp };
  const initial: CloudWorkspaceSnapshot = { schema: 1, revision: 0, libraries: [], items: [item], versions: [], annotations: [], comments: [], outbox: [], roles: { library: { role: "owner", verifiedAt: Date.now() } }, revoked: [], cursors: {} };
  let saved = structuredClone(initial);
  const contents = new Map<string, SharedLibraryItemContent>();
  const persistence: CloudPersistence<CloudWorkspaceSnapshot> = {
    load: async () => structuredClone(saved),
    content: async key => structuredClone(contents.get(key) ?? null),
    async commit(next, entries = [], expectedRevision, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (expectedRevision !== undefined && saved.revision !== expectedRevision) throw new CloudPersistenceConflict();
      saved = structuredClone(next);
      for (const entry of entries) if (entry.content) contents.set(entry.key, structuredClone(entry.content)); else contents.delete(entry.key);
    },
  };
  const remote = {
    online: true,
    role: "owner" as LibraryRole,
    item: structuredClone(item), versions: structuredClone(versions), annotations: [] as Annotation[],
    blobs: new Map([["blob-1", contentBytes(older).slice().buffer], ["blob-2", contentBytes(newer).slice().buffer]]),
    requests: [] as string[],
    intercept: undefined as ((path: string, init: RequestInit) => Promise<Response | undefined>) | undefined,
  };
  const transport = new ApiTransport({ baseUrl: "https://cloud.test", getAccessToken: async () => "fixture-session", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    remote.requests.push(`${init.method} ${path}`);
    if (!remote.online) throw new TypeError("offline");
    const intercepted = await remote.intercept?.(path, init);
    if (intercepted) return intercepted;
    if (path.endsWith("/members/me")) return json({ libraryId: "library", userId: "user", role: remote.role, status: "active", joinedAt: timestamp });
    if (path === "/v1/items/item") return json(remote.item);
    if (path === "/v1/items/item/versions" && init.method === "GET") return json(remote.versions);
    if (path.startsWith("/v1/libraries/library/blobs/") && path.endsWith("/content")) return new Response(remote.blobs.get(path.split("/").at(-2)!)!.slice(0));
    if (path === "/v1/libraries/library/blobs/find") return json({ blobId: remote.versions.find(version => version.contentHash === new URL(url).searchParams.get("hash"))?.blobId });
    if (path === "/v1/items/item/versions" && init.method === "POST") {
      const input = JSON.parse(String(init.body));
      if (input.baseVersionId !== remote.item.currentVersionId) return new Response(JSON.stringify({ error: { code: "SYNC_CONFLICT", message: "Remote version changed" } }), { status: 409 });
      const version: ItemVersion = { ...input, itemId: "item", versionNumber: remote.versions.length + 1, createdBy: "user", createdAt: timestamp };
      remote.versions.push(version);
      remote.item = { ...remote.item, currentVersionId: version.id, contentHash: version.contentHash };
      return json(version, 201);
    }
    if (path === "/v1/items/item/index-text") return json({});
    if (path === "/v1/libraries/library/changes") return json({ changes: [], cursor: "0", hasMore: false });
    if (path === "/v1/items/item/annotations") return json(remote.annotations);
    if (path === "/v1/items/item/annotation-mutations") {
      const input = JSON.parse(String(init.body));
      remote.annotations = [...remote.annotations.filter(annotation => annotation.id !== input.annotation.id), input.annotation];
      return json(input.annotation);
    }
    throw new Error(`Unexpected fixture route: ${init.method} ${path}`);
  } });
  const connection = { id: "history-fixture", name: "History", apiUrl: "https://cloud.test", supabaseUrl: "https://auth.test", publicKey: "sb_publishable_fixture", maxFileBytes: 1024 * 1024 };
  const reopen = async () => {
    const controller = new CloudLibraryWorkspaceController(connection, "user", persistence, transport, () => remote.online);
    await controller.initialize();
    return controller;
  };
  return { controller: await reopen(), remote, contents, persistence, reopen };
}

describe("cloud version history", () => {
  it("persists versions in newest-first order for offline reopen without changing current content", async () => {
    const { controller, remote, reopen } = await fixture();
    const versions = await controller.listVersions("library", "item");
    expect(versions.map(version => version.id)).toEqual(["version-2", "version-1"]);
    expect(controller.getSnapshot().items[0].currentVersionId).toBe("version-2");
    versions[0].manifest.mimeType = "changed by caller";
    controller.dispose(); remote.online = false;
    const reopened = await reopen(); const requests = remote.requests.length;
    expect((await reopened.listVersions("library", "item"))[0].manifest.mimeType).toBe("text/markdown");
    expect(remote.requests).toHaveLength(requests);
  });

  it("caches an old text version and only serves downloaded historical bytes offline", async () => {
    const { controller, remote, reopen } = await fixture();
    expect(await controller.readVersion("library", "item", "version-1")).toMatchObject({ kind: "text", text: "# First version" });
    expect(controller.getSnapshot().items[0].currentVersionId).toBe("version-2");
    controller.dispose(); remote.online = false;
    const reopened = await reopen(); const requests = remote.requests.length;
    expect(await reopened.readVersion("library", "item", "version-1")).toMatchObject({ text: "# First version" });
    await expect(reopened.readVersion("library", "item", "version-2")).rejects.toThrow(/缓存|离线/);
    expect(remote.requests).toHaveLength(requests);
  });

  it("preserves every byte of a historical binary file", async () => {
    const older: SharedLibraryItemContent = { kind: "binary", data: new Uint8Array([0, 255, 128, 10]).buffer, mimeType: "application/octet-stream", updatedAt: timestamp };
    const { controller } = await fixture({ name: "research.bin", older });
    const content = await controller.readVersion("library", "item", "version-1");
    expect(content.kind).toBe("binary");
    if (content.kind === "binary") expect([...new Uint8Array(content.data)]).toEqual([0, 255, 128, 10]);
  });

  it("rejects inconsistent item ownership in version metadata before caching it", async () => {
    const { controller, remote } = await fixture();
    remote.versions[0].itemId = "other-item";
    await expect(controller.listVersions("library", "item")).rejects.toThrow(/归属|条目|版本/);
    expect(controller.getSnapshot().versions).toEqual([]);
  });

  it("rejects content corruption without caching or replacing the current version", async () => {
    const { controller, remote, contents } = await fixture();
    remote.blobs.set("blob-1", new TextEncoder().encode("incomplete download").buffer);
    await expect(controller.readVersion("library", "item", "version-1")).rejects.toThrow(/hash/);
    expect(contents.size).toBe(0);
    expect(controller.getSnapshot().items[0].currentVersionId).toBe("version-2");
  });

  it("creates a durable new version from history using the current version as its CAS base", async () => {
    const { controller, remote, reopen } = await fixture();
    const historical = structuredClone(remote.versions);
    const restored = await controller.restoreVersion("library", "item", "version-1", "version-2");
    expect(restored).toBeTruthy(); expect(restored).not.toBe("version-1"); expect(restored).not.toBe("version-2");
    expect(controller.getSnapshot().outbox[0]).toMatchObject({ baseVersionId: "version-2", versionId: restored, restoredFromVersionId: "version-1" });
    expect(remote.versions).toEqual(historical);
    expect(await controller.readContent("library", "item")).toMatchObject({ text: "# First version" });
    controller.dispose(); const reopened = await reopen();
    expect(reopened.getSnapshot().outbox).toHaveLength(1);
    await reopened.sync();
    expect(reopened.getStatus()).toMatchObject({ status: "synced", pending: 0 });
    expect(remote.versions.slice(0, 2)).toEqual(historical);
    expect(remote.versions[2]).toMatchObject({ id: restored, baseVersionId: "version-2", contentHash: historical[0].contentHash, manifest: { restoredFromVersionId: "version-1" } });
  });

  it("records an explicit restore even when the historical content matches the current bytes", async () => {
    const { controller } = await fixture({ newer: text("# First version") });
    const restored = await controller.restoreVersion("library", "item", "version-1", "version-2");
    expect(restored).not.toBe("version-2");
    expect(controller.getSnapshot().outbox).toHaveLength(1);
  });

  it("rejects a restore while local edits are waiting to sync and retains those edits", async () => {
    const { controller } = await fixture();
    const localVersion = await controller.save("library", "item", text("# Unsynced draft"));
    await expect(controller.restoreVersion("library", "item", "version-1", localVersion!)).rejects.toThrow(/同步|本地|冲突/);
    expect(controller.getSnapshot().outbox).toHaveLength(1);
    expect(await controller.readContent("library", "item")).toMatchObject({ text: "# Unsynced draft" });
  });

  it("requires a fresh writable role and a live connection before restoring", async () => {
    const { controller, remote } = await fixture();
    await controller.listVersions("library", "item"); remote.role = "viewer";
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow(/权限|角色/);
    remote.online = false;
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow(/联网|离线/);
    expect(controller.getSnapshot().outbox).toEqual([]);
  });

  it("refuses a changed current version without replacing the new collaborator content", async () => {
    const { controller, remote } = await fixture();
    remote.item.currentVersionId = "version-3";
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow(/版本.*变|变化/);
    expect(controller.getSnapshot().outbox).toEqual([]);
    expect(remote.item.currentVersionId).toBe("version-3");
  });

  it("rechecks the current version after downloading historical content", async () => {
    const { controller, remote } = await fixture();
    remote.intercept = async path => { if (path.endsWith("/blob-1/content")) remote.item.currentVersionId = "version-3"; return undefined; };
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow(/版本.*变|变化/);
    expect(controller.getSnapshot().outbox).toEqual([]);
  });

  it("keeps a restore as a conflict when a collaborator commits before its queued CAS upload", async () => {
    const { controller, remote } = await fixture();
    const restored = await controller.restoreVersion("library", "item", "version-1", "version-2");
    remote.item.currentVersionId = "collaborator-version";
    await controller.sync();
    expect(controller.getStatus().status).toBe("conflicted");
    expect(controller.getSnapshot().outbox).toMatchObject([{ versionId: restored, state: "conflicted", remoteVersionId: "collaborator-version" }]);
    expect(remote.item.currentVersionId).toBe("collaborator-version");
    expect(remote.versions).toHaveLength(2);
    expect(remote.requests.filter(request => request === "POST /v1/items/item/versions")).toHaveLength(0);
    expect(await controller.readContent("library", "item")).toMatchObject({ text: "# First version" });
  });

  it("retains another window's durable edit when restoration rebases its persistence snapshot", async () => {
    const { controller, remote, reopen, persistence } = await fixture();
    const other = await reopen();
    remote.intercept = async path => { if (path.endsWith("/blob-1/content")) { remote.intercept = undefined; await other.save("library", "item", text("# Other window draft")); } return undefined; };
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow(/同步|本地|版本/);
    expect((await persistence.load())?.outbox).toHaveLength(1);
    expect(await controller.readContent("library", "item")).toMatchObject({ text: "# Other window draft" });
  });

  it("refuses stale offline authorization even when the requested history is cached", async () => {
    const { controller, remote, reopen, persistence } = await fixture();
    await controller.readVersion("library", "item", "version-1");
    const saved = (await persistence.load())!;
    saved.revision += 1;
    saved.roles.library.verifiedAt = Date.now() - 25 * 3600_000;
    await persistence.commit(saved);
    controller.dispose(); remote.online = false;
    const reopened = await reopen();
    await expect(reopened.readVersion("library", "item", "version-1")).rejects.toThrow(/授权.*过期/);
  });

  it("does not enqueue a restore when durable storage rejects the new version", async () => {
    const { controller, persistence } = await fixture();
    const commit = persistence.commit;
    persistence.commit = async (snapshot, ...args) => {
      if (snapshot.outbox.some(entry => entry.restoredFromVersionId)) throw new Error("Disk is full");
      return commit(snapshot, ...args);
    };
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow("Disk is full");
    expect(controller.getSnapshot().items[0].currentVersionId).toBe("version-2");
    expect(controller.getSnapshot().outbox).toEqual([]);
    expect((await persistence.load())?.outbox).toEqual([]);
  });

  it("cancels a restore inside its delayed durable commit without publishing or retaining an outbox entry", async () => {
    const { controller, persistence } = await fixture();
    const started = deferred<void>(); const finish = deferred<void>(); const abort = new AbortController();
    const commit = persistence.commit;
    persistence.commit = async (snapshot, ...args) => {
      if (snapshot.outbox.some(entry => entry.restoredFromVersionId)) { started.resolve(); await finish.promise; }
      return commit(snapshot, ...args);
    };
    let publishedRestore = false;
    controller.subscribe(() => { if (controller.getSnapshot().outbox.some(entry => entry.restoredFromVersionId)) publishedRestore = true; });
    const pending = controller.restoreVersion("library", "item", "version-1", "version-2", abort.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await started.promise; abort.abort(); finish.resolve();
    await rejection;
    expect((await persistence.load())?.outbox).toEqual([]);
    expect(controller.getSnapshot().outbox).toEqual([]);
    expect(controller.getSnapshot().items[0].currentVersionId).toBe("version-2");
    expect(publishedRestore).toBe(false);
  });

  it("reports success when cancellation arrives after restoration was atomically committed", async () => {
    const { controller, persistence } = await fixture();
    const abort = new AbortController(); const commit = persistence.commit;
    persistence.commit = async (snapshot, ...args) => {
      await commit(snapshot, ...args);
      if (snapshot.outbox.some(entry => entry.restoredFromVersionId)) abort.abort();
    };
    const restored = await controller.restoreVersion("library", "item", "version-1", "version-2", abort.signal);
    expect(restored).toBeTruthy();
    expect(controller.getSnapshot().outbox).toMatchObject([{ versionId: restored }]);
    expect((await persistence.load())?.items[0].currentVersionId).toBe(restored);
  });

  it("checks cancellation before retrying a restore after a persistence CAS conflict", async () => {
    const { controller, persistence } = await fixture();
    const abort = new AbortController(); const commit = persistence.commit; let attempts = 0;
    persistence.commit = async (snapshot, ...args) => {
      if (snapshot.outbox.some(entry => entry.restoredFromVersionId)) { attempts++; abort.abort(); throw new CloudPersistenceConflict(); }
      return commit(snapshot, ...args);
    };
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2", abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(attempts).toBe(1);
    expect((await persistence.load())?.outbox).toEqual([]);
  });

  it("does not overwrite an edit saved while a historical download is in flight", async () => {
    const { controller, remote } = await fixture();
    remote.intercept = async path => { if (path.endsWith("/blob-1/content")) { remote.intercept = undefined; await controller.save("library", "item", text("# Concurrent local draft")); } return undefined; };
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow(/同步|本地|版本/);
    expect(controller.getSnapshot().outbox).toHaveLength(1);
    expect(await controller.readContent("library", "item")).toMatchObject({ text: "# Concurrent local draft" });
  });

  it.each(["abort", "dispose"] as const)("does not publish a historical download after %s", async action => {
    const { controller, remote, contents } = await fixture();
    const started = deferred<void>(); const finish = deferred<Response | undefined>(); const abort = new AbortController();
    remote.intercept = async path => { if (path.endsWith("/blob-1/content")) { started.resolve(); return finish.promise; } return undefined; };
    const pending = controller.readVersion("library", "item", "version-1", abort.signal);
    const rejection = expect(pending).rejects.toThrow();
    await started.promise;
    if (action === "abort") abort.abort(); else controller.dispose();
    finish.resolve(undefined);
    await rejection;
    expect(contents.size).toBe(0);
  });
});

describe("cloud annotation pending projection", () => {
  const annotation: Annotation = { id: "annotation", itemId: "item", versionId: "version-2", authorId: "user", kind: "comment", target: { locatorType: "code-line", locator: { line: 1 } }, style: {}, body: { text: "Remote comment" }, status: "active", revision: 1, createdAt: timestamp, updatedAt: timestamp };

  it("retains pending annotation edits and deletions during a remote list refresh", async () => {
    const { controller, remote } = await fixture(); remote.annotations = [annotation];
    await controller.annotations("library", "item");
    await controller.persistAnnotations("library", "item", [{ ...annotation, body: { text: "Unsynced comment" } }], []);
    expect(await controller.annotations("library", "item")).toMatchObject([{ body: { text: "Unsynced comment" } }]);
    await controller.persistAnnotations("library", "item", [], [annotation.id]);
    expect(await controller.annotations("library", "item")).toEqual([]);
    expect(controller.getSnapshot().outbox).toHaveLength(2);
    await expect(controller.restoreVersion("library", "item", "version-1", "version-2")).rejects.toThrow(/同步|本地|冲突/);
  });

  it("keeps an annotation saved after an older list request started even after its outbox drains", async () => {
    const { controller, remote } = await fixture(); remote.annotations = [annotation];
    await controller.annotations("library", "item");
    const started = deferred<void>(); const finish = deferred<Response | undefined>();
    remote.intercept = async path => { if (path.endsWith("/annotations")) { remote.intercept = undefined; started.resolve(); return finish.promise; } return undefined; };
    const staleRead = controller.annotations("library", "item");
    await started.promise;
    await controller.persistAnnotations("library", "item", [{ ...annotation, body: { text: "Saved during refresh" } }], []);
    await controller.sync();
    expect(controller.getSnapshot().outbox).toEqual([]);
    finish.resolve(json([annotation]));
    expect(await staleRead).toMatchObject([{ body: { text: "Saved during refresh" } }]);
  });
});
