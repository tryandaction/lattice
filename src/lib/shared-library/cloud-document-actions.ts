import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { notifyWorkspaceFileChanged } from "@/lib/workspace-file-revisions";
import type { CloudFileTabState, LayoutNode } from "@/types/layout";

function copies(source: CloudFileTabState): CloudFileTabState[] {
  const result: CloudFileTabState[] = [];
  const visit = (node: LayoutNode) => {
    if (node.type === "split") { node.children.forEach(visit); return; }
    for (const tab of node.tabs) if (tab.kind === "cloud-file" && tab.cloud.scope === source.cloud.scope &&
      tab.cloud.libraryId === source.cloud.libraryId && tab.cloud.itemId === source.cloud.itemId) result.push(tab);
  };
  visit(useWorkspaceStore.getState().layout.root);
  return result;
}
const dirty = (tab: CloudFileTabState) => tab.isDirty || useContentCacheStore.getState().hasUnsavedChanges(tab.id);
export function cloudDocumentHasDrafts(source: CloudFileTabState): boolean { return dirty(source) || copies(source).some(dirty); }

/** A collaborator update can reload every clean copy without replacing any draft. */
export function refreshCloudDocumentViews(source: CloudFileTabState): { refreshed: number; preservedDrafts: number } {
  let refreshed = 0; let preservedDrafts = 0;
  for (const tab of copies(source)) {
    if (dirty(tab)) { preservedDrafts++; continue; }
    notifyWorkspaceFileChanged(tab.id); refreshed++;
  }
  return { refreshed, preservedDrafts };
}
