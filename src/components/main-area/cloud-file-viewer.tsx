"use client";

import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import type { CloudFileTabState, PaneId } from "@/types/layout";
import type { ViewerContent } from "@/types/viewer-content";
import { FileViewer } from "./universal-file-viewer";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { can } from "@/lib/shared-library/permissions";
import { persistCloudPdfAnnotations, toLegacyAnnotation, type CloudPdfDocument } from "@/lib/shared-library/cloud-pdf";
import { getFileExtension, getRendererForExtension } from "@/lib/file-utils";
import { openCloudRelativeLink } from "@/lib/shared-library/workbench-links";
import { findClosestAnchorHref } from "@/lib/link-router/link-click";
import { AssetSourceContext } from "@/lib/asset-source-context";
import { createCloudAssetResolver } from "@/lib/shared-library/workbench-assets";

/** Source capabilities only. Tabs, panes, editors and viewer controls belong to the workbench. */
export function CloudFileViewer({ tab, content, paneId, isActive, onContentChange, onSave }: {
  tab: CloudFileTabState; content: ViewerContent; paneId: PaneId; isActive: boolean;
  onContentChange?: (content: string) => void; onSave?: () => Promise<void>;
}) {
  const controller = useCloudWorkbenchStore(state => state.controller);
  const scope = useCloudWorkbenchStore(state => state.scope);
  const revision = useCloudWorkbenchStore(state => state.revision);
  const provider = useCloudWorkbenchStore(state => state.provider);
  const assetSource = useMemo(() => provider && controller ? {
    identity: `${tab.cloud.scope}:${tab.cloud.resourceId}:${tab.cloud.versionId ?? ""}`,
    resolveAsset: createCloudAssetResolver({ provider, libraryId: tab.cloud.libraryId, itemId: tab.cloud.itemId,
      getItems: () => controller.getSnapshot().items,
      isCurrent: () => useCloudWorkbenchStore.getState().provider === provider && useCloudWorkbenchStore.getState().scope === tab.cloud.scope,
    }),
  } : null, [provider, controller, tab.cloud.scope, tab.cloud.resourceId, tab.cloud.versionId, tab.cloud.libraryId, tab.cloud.itemId]);
  const renderer = getRendererForExtension(getFileExtension(tab.fileName));
  useEffect(() => {
    if (controller && scope === tab.cloud.scope && renderer === "pdf") {
      void controller.annotations(tab.cloud.libraryId, tab.cloud.itemId).catch(error => toast.error(String(error)));
      void controller.members(tab.cloud.libraryId).catch(() => {});
    }
  }, [controller, scope, renderer, tab.cloud.scope, tab.cloud.libraryId, tab.cloud.itemId]);
  const sharedDocument = useMemo<CloudPdfDocument | undefined>(() => {
    void revision;
    if (!controller || scope !== tab.cloud.scope || renderer !== "pdf") return undefined;
    const state = controller.getSnapshot();
    const role = state.roles[tab.cloud.libraryId]?.role ?? "viewer";
    const descendants = state.items.filter(item => {
      if (item.libraryId !== tab.cloud.libraryId || item.status !== "active") return false;
      let parent = item.metadata.parentItemId; const seen = new Set<string>();
      while (typeof parent === "string" && !seen.has(parent)) { if (parent === tab.cloud.itemId) return true; seen.add(parent); parent = state.items.find(candidate => candidate.id === parent)?.metadata.parentItemId; }
      return false;
    });
    const guard = () => { const current = useCloudWorkbenchStore.getState(); if (current.controller !== controller || current.scope !== tab.cloud.scope) throw new Error("云端账号或连接已切换。"); };
    return {
      identity: `${tab.cloud.resourceId}:${tab.cloud.versionId ?? "unversioned"}`,
      sourceVersion: tab.cloud.versionId, authorId: controller.userId,
      authorNames: state.memberNames?.[tab.cloud.libraryId],
      canAnnotate: !state.revoked.includes(tab.cloud.libraryId) && can(role, "annotation.create"),
      annotations: state.annotations.filter(annotation => annotation.itemId === tab.cloud.itemId && annotation.kind !== "comment" && annotation.versionId === tab.cloud.versionId).map(toLegacyAnnotation),
      workspace: {
        children: descendants.map(item => ({ id: item.id, parentId: typeof item.metadata.parentItemId === "string" ? item.metadata.parentItemId : undefined, name: item.canonicalName, kind: item.kind })),
        canCreate: !state.revoked.includes(tab.cloud.libraryId) && can(role, "item.create"),
        onOpenChild: async (id, targetPane) => { guard(); if (!descendants.some(child => child.id === id)) throw new Error("此文件不是当前 PDF 的研究子文件。"); await useCloudWorkbenchStore.getState().openItem(id, { libraryId: tab.cloud.libraryId, paneId: targetPane }); },
        onCreateChild: async (kind, targetPane) => {
          guard(); if (!tab.cloud.versionId) throw new Error("PDF 尚未保存可用版本。");
          const existing = new Set(state.items.filter(item => item.metadata.parentItemId === tab.cloud.itemId && item.status === "active").map(item => item.canonicalName.toLocaleLowerCase()));
          const base = kind === "note" ? "Untitled" : "Lab Notebook"; const extension = kind === "note" ? "md" : "ipynb"; let name = `${base}.${extension}`; let index = 2;
          while (existing.has(name.toLocaleLowerCase())) name = `${base} ${index++}.${extension}`;
          const item = await controller.createChild(tab.cloud.libraryId, tab.cloud.itemId, { name, kind: kind === "note" ? "markdown" : "notebook", expectedParentVersion: tab.cloud.versionId, content: { kind: "text", text: kind === "note" ? `# ${base}\n` : JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }), mimeType: kind === "note" ? "text/markdown" : "application/x-ipynb+json", updatedAt: new Date().toISOString() } });
          guard(); void controller.sync(); await useCloudWorkbenchStore.getState().openItem(item.id, { libraryId: tab.cloud.libraryId, paneId: targetPane });
        },
        onDeleteChild: can(role, "item.delete") ? async id => { guard(); if (!descendants.some(child => child.id === id)) throw new Error("无效的研究子文件。"); await controller.trashItem(tab.cloud.libraryId, id); guard(); void controller.sync(); } : undefined,
        onRevealChildren: () => { guard(); const source = useCloudWorkbenchStore.getState(); source.setActive(true); source.setSelectedFolderId(tab.cloud.itemId); },
      },
      onPersist: (upserts, removes) => persistCloudPdfAnnotations(controller, tab.cloud.libraryId, tab.cloud.itemId, upserts, removes, tab.cloud.versionId),
    };
    // revision publishes annotation/sync changes without replacing the controller.
  }, [controller, scope, renderer, tab.cloud, revision]);
  const navigate = useCallback((target: string) => {
    void openCloudRelativeLink(tab, target, paneId).catch(error => toast.error(error instanceof Error ? error.message : String(error)));
  }, [tab, paneId]);

  if (renderer === "unsupported") return <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
    <p>{tab.fileName}</p><p className="text-muted-foreground">此格式暂不支持预览，原文件已保留。</p>
    <button className="rounded border border-border px-3 py-2 hover:bg-accent" onClick={() => {
      if (content.kind !== "buffer" && content.kind !== "text") return;
      const url = URL.createObjectURL(new Blob([content.kind === "buffer" ? content.data : content.text], { type: tab.cloud.mimeType }));
      const link = document.createElement("a"); link.href = url; link.download = tab.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>下载原文件</button>
  </div>;

  return <AssetSourceContext.Provider value={assetSource}><div className="h-full min-h-0 min-w-0 overflow-hidden bg-background" onClick={event => {
    const href = findClosestAnchorHref(event.target);
    if (!href || event.defaultPrevented) return;
    event.preventDefault(); event.stopPropagation(); navigate(href);
  }}>
    <FileViewer tab={tab} content={content} fileName={tab.fileName} rendererType={renderer}
      fileId={tab.id} filePath={tab.filePath} paneId={paneId} executionScopeId={`cloud:${tab.id}`}
      isActive={isActive} onContentChange={onContentChange} onSave={onSave} onNavigateToFile={navigate}
      sharedDocument={sharedDocument} />
  </div></AssetSourceContext.Provider>;
}
