import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { findPane } from "@/lib/layout-utils";
import { getWorkspaceFileRevision } from "@/lib/workspace-file-revisions";
import { cloudDocumentHasDrafts, refreshCloudDocumentViews } from "../cloud-document-actions";
import type { CloudLibraryResource } from "../source-provider";
import type { CloudFileTabState } from "@/types/layout";

const resource: CloudLibraryResource = { id: "document", libraryId: "library", itemId: "file", versionId: "v1", name: "shared.md", kind: "markdown", path: "cloud://document", role: "editor", content: null };
describe("cloud collaboration draft protection", () => {
  beforeEach(() => { useWorkspaceStore.getState().resetWorkbenchState(false); useContentCacheStore.getState().clearCache(); });
  function open() {
    const workspace = useWorkspaceStore.getState();
    workspace.openCloudFileInPane("pane-initial", resource, "account-A");
    const first = findPane(useWorkspaceStore.getState().layout.root, "pane-initial")!.tabs[0] as CloudFileTabState;
    const other = workspace.splitPane("pane-initial", "horizontal")!;
    workspace.openCloudFileInPane(other, resource, "account-A");
    const second = findPane(useWorkspaceStore.getState().layout.root, other)!.tabs[0] as CloudFileTabState;
    return { first, second };
  }
  it("detects an unsaved copy in another pane and preserves it when refreshing", () => {
    const { first, second } = open();
    useContentCacheStore.getState().setContent(second.id, "unsaved", "base");
    expect(cloudDocumentHasDrafts(first)).toBe(true);
    const old = getWorkspaceFileRevision(second.id);
    const result = refreshCloudDocumentViews(first);
    expect(result).toEqual({ refreshed: 1, preservedDrafts: 1 });
    expect(getWorkspaceFileRevision(second.id)).toBe(old);
    expect(useContentCacheStore.getState().getContent(second.id)?.content).toBe("unsaved");
  });
  it("refreshes all clean panes for one account without touching another account", () => {
    const { first, second } = open();
    const other = useWorkspaceStore.getState().splitPane("pane-initial", "vertical")!;
    useWorkspaceStore.getState().openCloudFileInPane(other, resource, "account-B");
    const foreign = findPane(useWorkspaceStore.getState().layout.root, other)!.tabs[0];
    const before = [first, second, foreign].map(tab => getWorkspaceFileRevision(tab.id));
    expect(refreshCloudDocumentViews(first)).toEqual({ refreshed: 2, preservedDrafts: 0 });
    expect(getWorkspaceFileRevision(first.id)).toBe(before[0] + 1);
    expect(getWorkspaceFileRevision(second.id)).toBe(before[1] + 1);
    expect(getWorkspaceFileRevision(foreign.id)).toBe(before[2]);
  });
});
