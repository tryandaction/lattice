import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudCollaborationToolbar } from "../cloud-collaboration-toolbar";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { CloudLibraryWorkspaceController } from "@/lib/shared-library/cloud-workspace";
import type { CloudFileTabState } from "@/types/layout";

vi.mock("../cloud-ai-button", () => ({ CloudAiButton: () => <button>云端 AI</button> }));
const tab: CloudFileTabState = { id: "document-tab", kind: "cloud-file", fileName: "note.md", filePath: "cloud://file", isDirty: false, scrollPosition: 0,
  cloud: { scope: "account-A", resourceId: "resource", libraryId: "file-library", itemId: "file", versionId: "v2", role: "editor" } };
function setup({ pending = false, dirty = false } = {}) {
  const snapshot = { roles: { "file-library": { role: "editor", verifiedAt: Date.now() } }, revoked: [], items: [{ id: "file", libraryId: "file-library", currentVersionId: "v2" }],
    outbox: pending ? [{ itemId: "file", libraryId: "file-library", state: "pending" }] : [], memberNames: { "file-library": { alice: "小林" } } };
  const controller = { getSnapshot: () => snapshot, members: vi.fn(async () => []),
    listVersions: vi.fn(async () => [{ id: "v1", itemId: "file", versionNumber: 1, createdBy: "alice", createdAt: "2026-10-26T08:00:00Z", contentHash: "hash", manifest: {} }]),
    readVersion: vi.fn(async () => ({ kind: "text", text: "historical text", mimeType: "text/plain", updatedAt: "" })), restoreVersion: vi.fn(async () => "v3"), sync: vi.fn(async () => {}),
  } as unknown as CloudLibraryWorkspaceController;
  const selectLibrary = vi.fn(async (libraryId: string) => { useCloudWorkbenchStore.setState({ libraryId }); });
  useCloudWorkbenchStore.setState({ controller, scope: "account-A", provider: null, libraryId: "different-library", revision: 0, status: { status: "synced", error: null, pending: 0 }, managementOpen: false, selectLibrary });
  render(<CloudCollaborationToolbar tab={{ ...tab, isDirty: dirty }} content={{ kind: "text", text: "current" }} />);
  return { controller, selectLibrary };
}
describe("cloud collaboration controls", () => {
  beforeEach(() => { useWorkspaceStore.getState().resetWorkbenchState(false); useContentCacheStore.getState().clearCache(); useCloudWorkbenchStore.setState({ requestedVersionHistory: null }); });
  afterEach(cleanup);
  it("opens the exact history version requested by an activity record", async () => {
    const { controller } = setup();
    act(() => useCloudWorkbenchStore.getState().requestVersionHistory('file-library', 'file', 'v1'));
    await screen.findByText('historical text');
    expect(controller.readVersion).toHaveBeenCalledWith('file-library', 'file', 'v1', expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: '关闭历史' }));
    expect(useCloudWorkbenchStore.getState().requestedVersionHistory).toBeNull();
  });
  it("opens sharing for the document library even when the explorer selected another library", async () => {
    const { selectLibrary } = setup();
    fireEvent.click(screen.getByRole("button", { name: "共享与成员" }));
    await waitFor(() => expect(useCloudWorkbenchStore.getState().managementOpen).toBe(true));
    expect(selectLibrary).toHaveBeenCalledWith("file-library");
    expect(useCloudWorkbenchStore.getState().managementSection).toBe("members");
  });
  it("does not label a durable local save as remotely synced", () => {
    setup({ pending: true });
    expect(screen.getByText("已保存到本机，等待同步")).toBeTruthy();
    expect(screen.queryByText("已同步")).toBeNull();
  });
  it("does not open a different library's member list after the explorer changes during refresh", async () => {
    const { selectLibrary } = setup();
    let finish!: () => void;
    selectLibrary.mockImplementation(async libraryId => {
      useCloudWorkbenchStore.setState({ libraryId });
      await new Promise<void>(resolve => { finish = resolve; });
    });
    fireEvent.click(screen.getByRole("button", { name: "共享与成员" }));
    useCloudWorkbenchStore.setState({ libraryId: "different-library" });
    finish();
    await waitFor(() => expect((screen.getByRole("button", { name: "共享与成员" }) as HTMLButtonElement).disabled).toBe(false));
    expect(useCloudWorkbenchStore.getState().managementOpen).toBe(false);
  });
  it("allows history preview but blocks restore while an editor draft is unsaved", async () => {
    const { controller } = setup({ dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /v1.*小林/ }));
    await screen.findByText("historical text");
    expect((screen.getByRole("button", { name: "恢复此版本" }) as HTMLButtonElement).disabled).toBe(true);
    expect(controller.restoreVersion).not.toHaveBeenCalled();
  });
  it("cancels an in-flight restore when the user starts a new editor draft", async () => {
    const { controller } = setup();
    vi.mocked(controller.restoreVersion).mockImplementation(async (_library, _item, _version, _expected, signal) => {
      useContentCacheStore.getState().setContent(tab.id, "new draft while restoring", "base");
      expect(signal?.aborted).toBe(true);
      throw signal?.reason;
    });
    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /v1.*小林/ }));
    await screen.findByText("historical text");
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复为新版本" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("未保存修改");
    expect(useContentCacheStore.getState().getContent(tab.id)?.content).toBe("new draft while restoring");
    expect(controller.sync).not.toHaveBeenCalled();
  });
});
