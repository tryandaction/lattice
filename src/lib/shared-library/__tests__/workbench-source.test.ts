// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudFileTab, readCloudFileTab, saveCloudFileTab } from "../workbench-source";
import { resetCloudWorkspaceHost, setCloudWorkspaceProvider } from "@/lib/cloud-workspace-host";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { loadWorkbenchSession, saveWorkbenchSession } from "@/lib/layout-persistence";
import type { CloudLibraryResource, CloudLibrarySourceProvider } from "../source-provider";
import { findPane } from "@/lib/layout-utils";
import { acknowledgeWorkspaceTabSave, saveWorkspaceTabContent } from "@/lib/workspace-save";
import { useContentCacheStore } from "@/stores/content-cache-store";

const resource: CloudLibraryResource = { id: "cloud-identity", libraryId: "lib", itemId: "item", versionId: "v1", name: "note.md", kind: "markdown", path: "cloud://cloud-identity", role: "editor", content: { kind: "text", text: "# Cloud source", mimeType: "text/markdown", updatedAt: "2026-10-12" } };
function setup() {
  const provider: CloudLibrarySourceProvider = { scope: "account-A", read: vi.fn(async () => resource), save: vi.fn(), list: vi.fn(), search: vi.fn() };
  setCloudWorkspaceProvider(provider);
  return { provider, tab: createCloudFileTab(resource, provider.scope!) };
}
describe("cloud documents in the shared workbench", () => {
  beforeEach(() => { resetCloudWorkspaceHost(); useWorkspaceStore.getState().resetWorkbenchState(false); localStorage.clear(); });
  it("uses the regular tab/pane layout alongside local files, including split and move", () => {
    const { tab } = setup(); const store = useWorkspaceStore.getState();
    store.openFileInPane("pane-initial", { kind: "file", name: "local.md" } as FileSystemFileHandle, "local.md");
    store.openCloudFileInPane("pane-initial", resource, tab.cloud.scope);
    store.openCloudFileInPane("pane-initial", resource, tab.cloud.scope);
    expect(findPane(useWorkspaceStore.getState().layout.root, "pane-initial")?.tabs).toHaveLength(2);
    const other = store.splitPane("pane-initial", "horizontal");
    expect(other).toBeTruthy();
    if (!other) throw new Error("Missing split pane");
    store.moveTabToPane("pane-initial", 1, other);
    expect(findPane(useWorkspaceStore.getState().layout.root, other)?.tabs[0].kind).toBe("cloud-file");
    expect(findPane(useWorkspaceStore.getState().layout.root, "pane-initial")?.tabs[0].fileName).toBe("local.md");
  });
  it("blocks another account before loading or saving cached document identity", async () => {
    const { provider, tab } = setup();
    setCloudWorkspaceProvider({ ...provider, scope: "account-B" });
    await expect(readCloudFileTab(tab)).rejects.toThrow("账号已切换");
    await expect(saveCloudFileTab(tab, "new text")).rejects.toThrow("账号已切换");
    expect(provider.read).not.toHaveBeenCalled(); expect(provider.save).not.toHaveBeenCalled();
  });
  it("rejects a response after the connection changed during I/O", async () => {
    const { provider, tab } = setup();
    vi.mocked(provider.read).mockImplementation(async () => { setCloudWorkspaceProvider({ ...provider }); return resource; });
    await expect(readCloudFileTab(tab)).rejects.toThrow("身份已变化");
  });
  it("saves with the viewed base revision, then advances the next save's revision", async () => {
    const { provider, tab } = setup();
    vi.mocked(provider.read).mockResolvedValue({ ...resource, versionId: "v2" });
    const saved = await saveCloudFileTab(tab, "# Edited");
    expect(provider.save).toHaveBeenCalledWith("lib", "item", expect.objectContaining({ text: "# Edited" }), undefined, "v1");
    expect(saved.cloud.versionId).toBe("v2");
  });
  it("does not adopt a collaborator's later revision as the base of our saved draft", async () => {
    const { provider, tab } = setup();
    vi.mocked(provider.save).mockResolvedValue("v2-ours");
    vi.mocked(provider.read).mockResolvedValue({ ...resource, versionId: "v3-theirs" });
    expect((await saveCloudFileTab(tab, "ours")).cloud.versionId).toBe("v2-ours");
    expect(provider.read).not.toHaveBeenCalled();
  });
  it("keeps newer edits dirty when a saved tab moved to another pane during the request", () => {
    const { tab } = setup(); const store = useWorkspaceStore.getState();
    store.openCloudFileInPane("pane-initial", resource, tab.cloud.scope);
    const opened = findPane(useWorkspaceStore.getState().layout.root, "pane-initial")!.tabs[0];
    useContentCacheStore.getState().setContent(opened.id, "draft sent", "base");
    const other = store.splitPane("pane-initial", "horizontal")!;
    store.moveTabToPane("pane-initial", 0, other);
    useContentCacheStore.getState().setContent(opened.id, "new edits typed while saving", "base");
    acknowledgeWorkspaceTabSave(opened.id, "draft sent");
    expect(useContentCacheStore.getState().getContent(opened.id)).toMatchObject({ content: "new edits typed while saving", originalContent: "draft sent", isDirty: true });
    expect(findPane(useWorkspaceStore.getState().layout.root, other)!.tabs[0].isDirty).toBe(true);
  });
  it("serializes repeated save clicks against the last committed local queue revision", async () => {
    const { provider, tab } = setup(); const store = useWorkspaceStore.getState();
    store.openCloudFileInPane("pane-initial", resource, tab.cloud.scope);
    const opened = findPane(useWorkspaceStore.getState().layout.root, "pane-initial")!.tabs[0];
    if (opened.kind !== "cloud-file") throw new Error("Wrong source");
    let next = 1;
    vi.mocked(provider.save).mockImplementation(async () => `v${++next}`);
    await Promise.all([
      saveWorkspaceTabContent({ tab: opened, content: "first", rootHandle: null }),
      saveWorkspaceTabContent({ tab: opened, content: "second", rootHandle: null }),
    ]);
    expect(vi.mocked(provider.save).mock.calls.map(call => call[4])).toEqual(["v1", "v2"]);
  });
  it("restores a cloud-only layout without a local file handle and reauthorizes before display", async () => {
    const { tab, provider } = setup();
    await saveWorkbenchSession("cloud-test", null, { root: { type: "pane", id: "pane-cloud", tabs: [tab], activeTabIndex: 0 }, activePaneId: "pane-cloud" }, false);
    const restored = await loadWorkbenchSession("cloud-test", null, null);
    const nextTab = findPane(restored!.layout.root, "pane-cloud")!.tabs[0];
    expect(nextTab.kind).toBe("cloud-file"); expect(nextTab).not.toHaveProperty("fileHandle"); expect(nextTab).not.toHaveProperty("content");
    expect(provider.read).not.toHaveBeenCalled();
    if (nextTab.kind !== "cloud-file") throw new Error("Wrong source");
    expect(nextTab.cloud.role).toBe("viewer");
    await readCloudFileTab(nextTab);
    expect(provider.read).toHaveBeenCalledWith("lib", "item", undefined);
  });
});
