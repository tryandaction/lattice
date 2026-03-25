"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileText, Image as ImageIcon, MessageSquareText } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useI18n } from "@/hooks/use-i18n";
import { generateFileId, loadAnnotationsFromDisk } from "@/lib/universal-annotation-storage";
import { detectFileType } from "@/lib/universal-annotation-storage";
import { loadPdfItemManifest } from "@/lib/pdf-item";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { isDirectoryNode, isFileNode, type FileNode, type TreeNode } from "@/types/file-system";
import type { AnnotationItem } from "@/types/universal-annotation";
import { useSettingsStore } from "@/stores/settings-store";

interface AnnotationFileGroup {
  path: string;
  fileName: string;
  extension: string;
  annotations: AnnotationItem[];
}

type AnnotationScope = "all" | "current";
type AnnotationSort = "latest" | "count" | "name";

function collectWorkspaceFiles(node: TreeNode | null): FileNode[] {
  if (!node) return [];
  if (isFileNode(node)) {
    if (node.isVirtual) {
      return [];
    }
    return [node];
  }
  if (isDirectoryNode(node)) {
    return node.children.flatMap((child) => collectWorkspaceFiles(child));
  }
  return [];
}

function isAnnotatableExtension(extension: string): boolean {
  return ["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "md", "txt", "py", "js", "jsx", "ts", "tsx", "json", "html", "css"].includes(extension);
}

function buildAnnotationTargetPath(group: AnnotationFileGroup, annotation: AnnotationItem): string {
  if (annotation.target.type === "pdf") {
    return `${group.path}#annotation=${annotation.id}`;
  }
  if (annotation.target.type === "code_line") {
    return `${group.path}#line=${annotation.target.line}`;
  }
  return group.path;
}

export function AnnotationsActivityPanel() {
  const { t } = useI18n();
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const annotationsPanelScope = useSettingsStore((state) => state.settings.annotationsPanelScope);
  const annotationsPanelSort = useSettingsStore((state) => state.settings.annotationsPanelSort);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const files = useMemo(() => collectWorkspaceFiles(fileTree.root), [fileTree.root]);
  const [isLoading, setIsLoading] = useState(false);
  const [groups, setGroups] = useState<AnnotationFileGroup[]>([]);
  const [scope, setScope] = useState<AnnotationScope>(annotationsPanelScope);
  const [sortBy, setSortBy] = useState<AnnotationSort>(annotationsPanelSort);

  useEffect(() => {
    setScope(annotationsPanelScope);
  }, [annotationsPanelScope]);

  useEffect(() => {
    setSortBy(annotationsPanelSort);
  }, [annotationsPanelSort]);

  useEffect(() => {
    if (scope !== annotationsPanelScope) {
      void updateSetting("annotationsPanelScope", scope);
    }
  }, [annotationsPanelScope, scope, updateSetting]);

  useEffect(() => {
    if (sortBy !== annotationsPanelSort) {
      void updateSetting("annotationsPanelSort", sortBy);
    }
  }, [annotationsPanelSort, sortBy, updateSetting]);

  useEffect(() => {
    if (!rootHandle || files.length === 0) {
      setGroups([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      const nextGroups: AnnotationFileGroup[] = [];

      for (const file of files) {
        if (!isAnnotatableExtension(file.extension)) {
          continue;
        }

        try {
          const annotationType = detectFileType(file.path);
          if (annotationType === "unknown" || annotationType === "pptx" || annotationType === "html") {
            continue;
          }

          const fileId = file.extension === "pdf"
            ? (await loadPdfItemManifest(rootHandle, generateFileId(file.path), file.path)).itemId
            : generateFileId(file.path);
          const annotationFile = await loadAnnotationsFromDisk(fileId, rootHandle, annotationType);
          if (annotationFile.annotations.length === 0) {
            continue;
          }

          nextGroups.push({
            path: file.path,
            fileName: file.name,
            extension: file.extension,
            annotations: annotationFile.annotations.sort((left, right) => right.createdAt - left.createdAt),
          });
        } catch {
          continue;
        }
      }

      if (!cancelled) {
        nextGroups.sort((left, right) => right.annotations.length - left.annotations.length || left.fileName.localeCompare(right.fileName));
        setGroups(nextGroups);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, rootHandle]);

  const visibleGroups = useMemo(() => {
    const filtered = scope === "current" && activeTab?.filePath
      ? groups.filter((group) => group.path === activeTab.filePath)
      : groups;

    const next = [...filtered];
    next.sort((left, right) => {
      if (sortBy === "name") {
        return left.fileName.localeCompare(right.fileName);
      }
      if (sortBy === "count") {
        return right.annotations.length - left.annotations.length || left.fileName.localeCompare(right.fileName);
      }
      const leftLatest = left.annotations[0]?.createdAt ?? 0;
      const rightLatest = right.annotations[0]?.createdAt ?? 0;
      return rightLatest - leftLatest || left.fileName.localeCompare(right.fileName);
    });
    return next;
  }, [activeTab?.filePath, groups, scope, sortBy]);

  const visibleAnnotationCount = useMemo(
    () => visibleGroups.reduce((sum, group) => sum + group.annotations.length, 0),
    [visibleGroups],
  );

  const handleOpenAnnotation = async (group: AnnotationFileGroup, annotation: AnnotationItem) => {
    if (!rootHandle) {
      return;
    }

    await navigateLink(buildAnnotationTargetPath(group, annotation), {
      paneId: activePaneId,
      rootHandle,
    });
  };

  const handleOpenFile = async (group: AnnotationFileGroup) => {
    if (!rootHandle) {
      return;
    }

    await navigateLink(group.path, {
      paneId: activePaneId,
      rootHandle,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("workbench.annotations.panelTitle")}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="rounded-lg border border-border bg-background px-3 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <span>{t("workbench.annotations.panelTitle")}</span>
          </div>

          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t("workbench.annotations.count")}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {isLoading ? "..." : visibleAnnotationCount}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setScope("all")}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${scope === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("workbench.annotations.scope.all")}
              </button>
              <button
                type="button"
                onClick={() => setScope("current")}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${scope === "current" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("workbench.annotations.scope.current")}
              </button>
            </div>

            <div className="flex items-center rounded-md border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setSortBy("latest")}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${sortBy === "latest" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("workbench.annotations.sort.latest")}
              </button>
              <button
                type="button"
                onClick={() => setSortBy("count")}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${sortBy === "count" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("workbench.annotations.sort.count")}
              </button>
              <button
                type="button"
                onClick={() => setSortBy("name")}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${sortBy === "name" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("workbench.annotations.sort.name")}
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t("workbench.annotations.recent")}
            </div>
            {isLoading ? (
              <div className="mt-2 text-sm text-muted-foreground">{t("workbench.annotations.loading")}</div>
            ) : visibleGroups.length > 0 ? (
              <div className="mt-2 space-y-3">
                {visibleGroups.map((group) => (
                  <div key={group.path} className="rounded-md border border-border bg-background">
                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          {group.extension === "pdf" ? <FileText className="h-4 w-4 text-muted-foreground" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
                          <span className="truncate">{group.fileName}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">{group.path}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
                          {group.annotations.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleOpenFile(group)}
                          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {t("workbench.search.openFile")}
                        </button>
                      </div>
                    </div>

                    <div className="px-2 py-2">
                      {group.annotations.slice(0, 4).map((annotation) => (
                        <button
                          key={annotation.id}
                          type="button"
                          onClick={() => void handleOpenAnnotation(group, annotation)}
                          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-muted-foreground">
                              {new Date(annotation.createdAt).toLocaleString()}
                            </div>
                            <div className="mt-1 text-sm text-foreground/85">
                              {(annotation.comment || annotation.content || annotation.id).slice(0, 140)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                {scope === "current" ? t("workbench.annotations.empty") : t("workbench.annotations.emptyWorkspace")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnnotationsActivityPanel;
