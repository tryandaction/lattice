/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchSession } from "../use-workbench-session";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import type { CloudFileTabState, LayoutState } from "@/types/layout";

const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/layout-persistence", () => ({ loadWorkbenchSessionStaged: persistence.load, saveWorkbenchSession: persistence.save }));
vi.mock("@/lib/desktop-window", () => ({ registerDesktopWindowCloseHandler: () => () => {} }));
vi.mock("@/stores/cloud-workbench-store", () => ({ useCloudWorkbenchStore: (select: (state: { scope: string }) => unknown) => select({ scope: "account-a" }) }));

const cloudTab = (id: string): CloudFileTabState => ({
  id, kind: "cloud-file", fileName: "draft.md", filePath: "cloud://synthetic-resource", isDirty: false, scrollPosition: 0,
  cloud: { scope: "account-a", resourceId: "synthetic-resource", libraryId: "library", itemId: "item", versionId: "v1", role: "editor" },
});
const layout = (id: string): LayoutState => ({ activePaneId: "pane-cloud", root: { type: "pane", id: "pane-cloud", activeTabIndex: 0, tabs: [cloudTab(id)] } });

describe("staged workbench restoration preserves active drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContentCacheStore.getState().clearCache();
    useWorkspaceStore.setState({ rootHandle: null, workspaceRootHandle: null, workspaceRootPath: null, workspaceIdentity: null, sidebarCollapsed: false,
      layout: { activePaneId: "pane-cloud", root: { type: "pane", id: "pane-cloud", activeTabIndex: -1, tabs: [] } } });
  });

  it.each(["tab dirty", "cache-only dirty"])("does not replace the first restored cloud tab after %s is entered", async (dirtySource) => {
    let finish!: (value: { layout: LayoutState; sidebarCollapsed: boolean }) => void;
    const complete = new Promise<{ layout: LayoutState; sidebarCollapsed: boolean }>(resolve => { finish = resolve; });
    persistence.load.mockResolvedValue({ initial: { layout: layout("initial-tab"), sidebarCollapsed: false }, complete });
    const { unmount } = renderHook(useWorkbenchSession);
    await waitFor(() => {
      const root = useWorkspaceStore.getState().layout.root;
      expect(root.type === "pane" && root.tabs[0]?.id).toBe("initial-tab");
    });
    act(() => {
      useContentCacheStore.getState().setContent("initial-tab", "new unsaved cloud text", "original cloud text");
      if (dirtySource === "tab dirty") useWorkspaceStore.getState().setTabDirty("pane-cloud", 0, true);
    });
    await act(async () => { finish({ layout: layout("complete-tab"), sidebarCollapsed: false }); await complete; });
    const root = useWorkspaceStore.getState().layout.root;
    expect(root.type === "pane" && root.tabs[0]?.id).toBe("initial-tab");
    expect(useContentCacheStore.getState().getContent("initial-tab")?.content).toBe("new unsaved cloud text");
    expect(useContentCacheStore.getState().hasUnsavedChanges("initial-tab")).toBe(true);
    unmount();
  });
});
