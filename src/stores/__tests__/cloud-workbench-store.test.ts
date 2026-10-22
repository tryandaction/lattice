import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudWorkbenchStore } from "../cloud-workbench-store";
import type { CloudLibraryWorkspaceController } from "@/lib/shared-library/cloud-workspace";
import type { Item } from "@/lib/shared-library/domain";
import { getCloudWorkspaceSnapshot } from "@/lib/cloud-workspace-host";

const workspace = vi.hoisted(() => ({ layout: { activePaneId: "real-pane" }, openCloudFileInPane: vi.fn() }));
vi.mock("@/stores/workspace-store", () => ({ useWorkspaceStore: { getState: () => workspace } }));

function controllerFixture() {
  const item: Item = { id: "file", libraryId: "library", canonicalName: "note.md", title: "note.md", kind: "markdown", metadata: {}, status: "active", createdBy: "user", createdAt: "now", updatedAt: "now" };
  const snapshot = { items: [item], libraries: [{ id: "library", name: "Lab" }], roles: { library: { role: "editor" } }, revoked: [], outbox: [] };
  const read = vi.fn(async () => ({ item, role: "editor", content: { kind: "text", text: "# Remote", mimeType: "text/markdown", updatedAt: "now" } }));
  const createItem = vi.fn(async (input: object) => ({ ...item, ...input }));
  const controller = { connection: { id: "fixture", apiUrl: "http://127.0.0.1:9999", supabaseUrl: "http://127.0.0.1:9998" }, userId: "user", subscribe: vi.fn(() => vi.fn()), getSnapshot: () => snapshot, getStatus: () => ({ status: "synced", error: null, pending: 0 }), refreshLibrary: vi.fn(async () => {}), readResource: read, createItem, sync: vi.fn(async () => {}), updateItem: vi.fn(async () => {}), trashItem: vi.fn(async () => {}) } as unknown as CloudLibraryWorkspaceController;
  return { controller, read, createItem };
}

describe("cloud workbench source store", () => {
  beforeEach(() => { useCloudWorkbenchStore.getState().bindController(null); useCloudWorkbenchStore.setState({ active: false }); workspace.openCloudFileInPane.mockClear(); });
  it("opens cloud bytes in the existing pane with a scope and no local handle", async () => {
    const { controller } = controllerFixture(); const store = useCloudWorkbenchStore.getState();
    store.bindController(controller); await store.selectLibrary("library");
    await store.openItem("file");
    expect(workspace.openCloudFileInPane).toHaveBeenCalledWith("real-pane", expect.objectContaining({ itemId: "file", content: { kind: "text", text: "# Remote", mimeType: "text/markdown", updatedAt: "now" } }), useCloudWorkbenchStore.getState().scope);
    expect(workspace.openCloudFileInPane.mock.calls[0][1]).not.toHaveProperty("fileHandle");
    store.setActive(false);
    expect(useCloudWorkbenchStore.getState().controller).toBe(controller);
    expect(getCloudWorkspaceSnapshot().provider).toBeTruthy();
  });
  it("does not open a response from a replaced identity", async () => {
    const { controller, read } = controllerFixture(); let finish: (value: Awaited<ReturnType<typeof read>>) => void = () => {};
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const store = useCloudWorkbenchStore.getState(); store.bindController(controller); await store.selectLibrary("library");
    const opening = store.openItem("file"); store.bindController(null);
    finish({ item: controller.getSnapshot().items[0], role: "editor", content: { kind: "text", text: "old", mimeType: "text/plain", updatedAt: "now" } });
    await expect(opening).rejects.toThrow("账号或连接已切换"); expect(workspace.openCloudFileInPane).not.toHaveBeenCalled();
  });
  it("treats explicit null as root and omitted parent as the selected folder", async () => {
    const { controller, createItem } = controllerFixture(); const store = useCloudWorkbenchStore.getState();
    store.bindController(controller); await store.selectLibrary("library"); store.setSelectedFolderId("selected-folder");
    await store.createFolder("Root", null); await store.createFolder("Nested");
    expect(createItem.mock.calls[0][0]).toMatchObject({ name: "Root", parentItemId: undefined });
    expect(createItem.mock.calls[1][0]).toMatchObject({ name: "Nested", parentItemId: "selected-folder" });
  });
  it("only stages the exact local entry until a destination is confirmed", () => {
    const getFile = vi.fn(); const values = vi.fn();
    const entry = { name: "paper.pdf", path: "papers/paper.pdf", storagePath: "papers/paper.pdf", kind: "file" as const, handle: { kind: "file", name: "paper.pdf", getFile } as unknown as FileSystemFileHandle, rootHandle: { values } as unknown as FileSystemDirectoryHandle };
    useCloudWorkbenchStore.getState().requestLocalUpload(entry);
    expect(useCloudWorkbenchStore.getState().pendingLocalUpload).toBe(entry);
    expect(useCloudWorkbenchStore.getState().managementOpen).toBe(true);
    expect(getFile).not.toHaveBeenCalled(); expect(values).not.toHaveBeenCalled();
    useCloudWorkbenchStore.getState().dismissLocalUpload();
    expect(useCloudWorkbenchStore.getState().pendingLocalUpload).toBeNull();
  });
});
