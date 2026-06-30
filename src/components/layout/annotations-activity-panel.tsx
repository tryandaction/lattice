"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Highlighter, Image as ImageIcon, MessageSquareText, Search, Underline } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useI18n } from "@/hooks/use-i18n";
import { generateFileId, loadAnnotationsFromDisk } from "@/lib/universal-annotation-storage";
import { detectFileType } from "@/lib/universal-annotation-storage";
import { loadPdfItemManifest } from "@/lib/pdf-item";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { isDirectoryNode, isFileNode, type FileNode, type TreeNode } from "@/types/file-system";
import { getCanonicalPdfAnnotationText, type AnnotationItem } from "@/types/universal-annotation";
import { useSettingsStore } from "@/stores/settings-store";
import { resolveHighlightColor } from "@/lib/annotation-colors";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";

interface AnnotationFileGroup {
  path: string;
  fileName: string;
  extension: string;
  annotations: AnnotationItem[];
}

type AnnotationScope = "all" | "current";
type AnnotationSort = "latest" | "count" | "name";

const ANNOTATION_TYPE_LABEL_KEYS: Record<AnnotationItem["style"]["type"], TranslationKey> = {
  highlight: "workbench.annotations.type.highlight",
  underline: "workbench.annotations.type.underline",
  area: "workbench.annotations.type.area",
  ink: "workbench.annotations.type.ink",
  text: "workbench.annotations.type.text",
};

const ANNOTATION_SORT_LABEL_KEYS: Record<AnnotationSort, TranslationKey> = {
  latest: "workbench.annotations.sort.latest",
  count: "workbench.annotations.sort.count",
  name: "workbench.annotations.sort.name",
};

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

function getAnnotationDisplayText(annotation: AnnotationItem): string {
  return getCanonicalPdfAnnotationText(annotation) ?? annotation.content?.trim() ?? annotation.comment?.trim() ?? annotation.id;
}

function getAnnotationLocationKey(annotation: AnnotationItem): TranslationKey {
  if (annotation.target.type === "image") {
    return "workbench.annotations.location.area";
  }
  return "workbench.annotations.location.anchor";
}

function getAnnotationSearchText(group: AnnotationFileGroup, annotation: AnnotationItem): string {
  const location = annotation.target.type === "pdf"
    ? `page ${annotation.target.page}`
    : annotation.target.type === "code_line"
      ? `line ${annotation.target.line}`
      : annotation.target.type;
  return [
    group.fileName,
    group.path,
    annotation.id,
    annotation.style.type,
    annotation.style.color,
    getAnnotationDisplayText(annotation),
    annotation.comment,
    annotation.tags?.join(" "),
    location,
  ].filter(Boolean).join(" ").toLowerCase();
}

function filterGroupAnnotations(group: AnnotationFileGroup, query: string): AnnotationFileGroup | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return group;
  }

  const annotations = group.annotations.filter((annotation) => (
    getAnnotationSearchText(group, annotation).includes(normalizedQuery)
  ));
  return annotations.length > 0 ? { ...group, annotations } : null;
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
  const [query, setQuery] = useState("");

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

    const searchFiltered = filtered.flatMap((group) => {
      const match = filterGroupAnnotations(group, query);
      return match ? [match] : [];
    });

    const next = [...searchFiltered];
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
  }, [activeTab?.filePath, groups, query, scope, sortBy]);

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

  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t("workbench.annotations.panelTitle")}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {isLoading
                  ? t("workbench.annotations.loading")
                  : t("workbench.annotations.matchCount", { count: visibleAnnotationCount })}
              </div>
            </div>
          </div>
          <div className="rounded-md bg-muted px-2 py-1 text-sm font-semibold text-foreground">
            {isLoading ? "..." : visibleAnnotationCount}
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("workbench.annotations.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md bg-muted p-0.5">
            {(["all", "current"] as const).map((nextScope) => (
              <button
                key={nextScope}
                type="button"
                onClick={() => setScope(nextScope)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  scope === nextScope
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(nextScope === "all" ? "workbench.annotations.scope.all" : "workbench.annotations.scope.current")}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-md bg-muted p-0.5">
            {(["latest", "count", "name"] as const).map((nextSort) => (
              <button
                key={nextSort}
                type="button"
                onClick={() => setSortBy(nextSort)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  sortBy === nextSort
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(ANNOTATION_SORT_LABEL_KEYS[nextSort])}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("workbench.annotations.loading")}</div>
        ) : visibleGroups.length > 0 ? (
          <div className="space-y-5">
            {visibleGroups.map((group) => (
              <section key={group.path} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {group.extension === "pdf" ? (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{group.fileName}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {group.annotations.length}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{group.path}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleOpenFile(group)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t("workbench.search.openFile")}
                  </button>
                </div>

                <div className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/70 bg-background">
                  {group.annotations.map((annotation) => {
                    const color = resolveHighlightColor(annotation.style.color);
                    const text = getAnnotationDisplayText(annotation);
                    const locationKey = getAnnotationLocationKey(annotation);
                    const typeIcon = annotation.style.type === "underline"
                      ? <Underline className="h-3.5 w-3.5" />
                      : <Highlighter className="h-3.5 w-3.5" />;
                    return (
                      <button
                        key={annotation.id}
                        type="button"
                        onClick={() => void handleOpenAnnotation(group, annotation)}
                        className="group flex w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/70 focus-visible:bg-accent focus-visible:outline-none"
                      >
                        <span
                          className="mt-1 h-auto w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                            <span className="inline-flex items-center gap-1" style={{ color }}>
                              {typeIcon}
                              {t(ANNOTATION_TYPE_LABEL_KEYS[annotation.style.type])}
                            </span>
                            <span>
                              {annotation.target.type === "pdf"
                                ? t("workbench.annotations.location.page", { page: annotation.target.page })
                                : annotation.target.type === "code_line"
                                  ? t("workbench.annotations.location.line", { line: annotation.target.line })
                                  : t(locationKey)}
                            </span>
                            <span>{new Date(annotation.createdAt).toLocaleString()}</span>
                          </span>
                          <span className="mt-1.5 block whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                            {text}
                          </span>
                          {annotation.comment ? (
                            <span className="mt-2 block rounded-md bg-muted/50 px-2 py-1.5 text-xs leading-5 text-muted-foreground">
                              {annotation.comment}
                            </span>
                          ) : null}
                          {annotation.tags && annotation.tags.length > 0 ? (
                            <span className="mt-2 flex flex-wrap gap-1">
                              {annotation.tags.map((tag) => (
                                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {tag}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            {hasQuery
              ? t("workbench.annotations.emptySearch")
              : scope === "current"
                ? t("workbench.annotations.empty")
                : t("workbench.annotations.emptyWorkspace")}
          </div>
        )}
      </div>
    </div>
  );
}

export default AnnotationsActivityPanel;
