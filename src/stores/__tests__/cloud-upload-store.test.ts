import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudWorkbenchStore } from "../cloud-workbench-store";
import { CloudLibraryWorkspaceController, type CloudWorkspaceSnapshot } from "@/lib/shared-library/cloud-workspace";
import type { CloudPersistence } from "@/lib/shared-library/cloud-persistence";
import type { SharedLibraryItemContent } from "@/lib/shared-library/content-store";
import { ApiTransport } from "@/lib/shared-library/api-transport";

async function fixture(maxFileBytes = 20) {
  let online = false;
  const saved: CloudWorkspaceSnapshot = { schema: 1, revision: 0, libraries: [], items: [], versions: [], annotations: [], comments: [], outbox: [], roles: { library: { role: "owner", verifiedAt: Date.now() } }, revoked: [], cursors: {} };
  const contents = new Map<string, SharedLibraryItemContent>();
  const persistence: CloudPersistence<CloudWorkspaceSnapshot> = {
    load: async () => saved,
    content: async key => contents.get(key) ?? null,
    commit: async (_next, entries = []) => { for (const entry of entries) if (entry.content) contents.set(entry.key, entry.content); else contents.delete(entry.key); },
  };
  const transport = new ApiTransport({ baseUrl: "http://127.0.0.1:9999", getAccessToken: async () => "unused", fetchImpl: async (input, init) => {
    const url = new URL(input); const path = url.pathname;
    let data: unknown = {};
    if (path.endsWith("/members/me")) data = { userId: "user", role: "owner", status: "active" };
    else if (path.endsWith("/blobs/find")) data = { blobId: "deduplicated-blob" };
    else if (path.endsWith("/versions")) {
      const body = JSON.parse(String(init.body));
      data = { id: body.id, itemId: path.split("/").at(-2), versionNumber: 1, manifest: body.manifest, contentHash: body.contentHash, createdBy: "user", createdAt: "now", blobId: body.blobId };
    } else if (path.endsWith("/changes")) data = { changes: [], cursor: url.searchParams.get("cursor") ?? "0", hasMore: false };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  const controller = new CloudLibraryWorkspaceController({ id: "upload-fixture", name: "Upload", apiUrl: "http://127.0.0.1:9999", supabaseUrl: "http://127.0.0.1:9998", publicKey: "public", maxFileBytes }, "user", persistence, transport, () => online);
  await controller.initialize();
  const store = useCloudWorkbenchStore.getState(); store.bindController(controller); await store.selectLibrary("library");
  return { controller, setOnline(value: boolean) { online = value; } };
}
const file = (name: string, text = "hello") => new NodeFile([text], name, { type: "text/markdown" }) as unknown as File;

describe("ordinary cloud upload queue", () => {
  beforeEach(() => { vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); useCloudWorkbenchStore.getState().bindController(null); });
  afterEach(() => { useCloudWorkbenchStore.getState().bindController(null); vi.restoreAllMocks(); });

  it("reports locally queued files without claiming cloud success while offline", async () => {
    const { controller } = await fixture();
    await useCloudWorkbenchStore.getState().uploadFiles([file("note.md")]);
    expect(controller.getSnapshot().outbox).toHaveLength(2);
    expect(useCloudWorkbenchStore.getState().uploadEntries).toMatchObject([{ path: "note.md", state: "queued", libraryId: "library" }]);
    expect(useCloudWorkbenchStore.getState().uploadProgress).toContain("等待同步");
  });

  it("imports valid files and shows a per-file error without reading an oversized file", async () => {
    await fixture(5);
    const large = file("large.md", "too large"); const read = vi.spyOn(large, "arrayBuffer");
    await useCloudWorkbenchStore.getState().uploadFiles([large, file("small.md", "ok")]);
    expect(useCloudWorkbenchStore.getState().uploadEntries.map(entry => [entry.path, entry.state])).toEqual([["large.md", "failed"], ["small.md", "queued"]]);
    expect(read).not.toHaveBeenCalled();
  });

  it("retries a local read failure without duplicating files already in the durable queue", async () => {
    const { controller } = await fixture(); const broken = file("retry.md");
    vi.spyOn(broken, "arrayBuffer").mockRejectedValueOnce(new Error("read denied"));
    await useCloudWorkbenchStore.getState().uploadFiles([file("saved.md"), broken]);
    expect(useCloudWorkbenchStore.getState().uploadEntries.map(entry => entry.state)).toEqual(["queued", "failed"]);
    await useCloudWorkbenchStore.getState().retryUpload();
    expect(controller.getSnapshot().items.map(item => item.canonicalName)).toEqual(["saved.md", "retry.md"]);
    expect(useCloudWorkbenchStore.getState().uploadEntries.map(entry => entry.state)).toEqual(["queued", "queued"]);
  });

  it("retains unprocessed files after cancel and never saves their bytes", async () => {
    const { controller } = await fixture(); const waiting = file("waiting.md"); let finish!: (value: ArrayBuffer) => void;
    vi.spyOn(waiting, "arrayBuffer").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const later = file("later.md"); const readLater = vi.spyOn(later, "arrayBuffer");
    const uploading = useCloudWorkbenchStore.getState().uploadFiles([waiting, later]);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    useCloudWorkbenchStore.getState().cancelUpload(); finish(new ArrayBuffer(1)); await uploading;
    expect(controller.getSnapshot().items).toEqual([]);
    expect(readLater).not.toHaveBeenCalled();
    expect(useCloudWorkbenchStore.getState().uploadEntries.map(entry => entry.state)).toEqual(["cancelled", "cancelled"]);
  });

  it("keeps same-name originals and records collisions as a visible failure", async () => {
    const { controller } = await fixture();
    await useCloudWorkbenchStore.getState().uploadFiles([file("note.md", "first")]);
    const original = controller.getSnapshot().items[0];
    await useCloudWorkbenchStore.getState().uploadFiles([file("note.md", "next")]);
    expect(controller.getSnapshot().items).toHaveLength(1);
    expect(controller.getSnapshot().items[0].id).toBe(original.id);
    expect(useCloudWorkbenchStore.getState().uploadEntries).toMatchObject([{ state: "failed", error: expect.stringContaining("同名文件") }]);
  });

  it("reports cloud success only after the durable outbox operation completes", async () => {
    const { controller, setOnline } = await fixture();
    await useCloudWorkbenchStore.getState().uploadFiles([file("online.md")]);
    expect(useCloudWorkbenchStore.getState().uploadEntries[0].state).toBe("queued");
    setOnline(true); await controller.sync();
    expect(controller.getSnapshot().outbox).toHaveLength(0);
    expect(useCloudWorkbenchStore.getState().uploadEntries[0].state).toBe("synced");
  });

  it("pauses the selected batch and resumes persisted work without duplicating its item", async () => {
    const { controller } = await fixture();
    await useCloudWorkbenchStore.getState().uploadFiles([file("resume.md")]);
    useCloudWorkbenchStore.getState().cancelUpload();
    await vi.waitFor(() => expect(useCloudWorkbenchStore.getState().uploadEntries[0].state).toBe("paused"));
    expect(controller.getSnapshot().items).toHaveLength(1);
    await useCloudWorkbenchStore.getState().retryUpload();
    expect(controller.getSnapshot().items).toHaveLength(1);
    expect(useCloudWorkbenchStore.getState().uploadEntries[0].state).toBe("queued");
  });
});
