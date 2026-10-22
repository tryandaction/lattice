"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  FilePlus2,
  FileQuestion,
  FolderOpen,
  Link2,
  Library as LibraryIcon,
  Loader2,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ItemWorkspaceRegistry,
  itemWorkspaceRegistry,
  type ItemWorkspaceItem,
} from "@/lib/shared-library/item-workspace";
import { ItemWorkspaceShell } from "./item-workspace-shell";
import { useSharedLibraryStore } from "@/stores/shared-library-store";
import { useSharedLibrarySyncStore } from "@/stores/shared-library-sync-store";
import type { Item, ItemKind } from "@/lib/shared-library/domain";
import type { SharedLibraryItemContent } from "@/lib/shared-library/content-store";
import { parseSharedLibraryPath } from "@/lib/shared-library/cloud-navigation";
export { parseSharedLibraryPath } from "@/lib/shared-library/cloud-navigation";

export interface LibraryShellProps {
  store?: typeof useSharedLibraryStore;
  registry?: ItemWorkspaceRegistry;
  initialLibraryId?: string;
  initialItemId?: string;
  contentLoader?: (itemId: string) => Promise<SharedLibraryItemContent | null>;
}



function toWorkspaceItem(
  item: Item,
  annotations: readonly import("@/lib/shared-library/domain").Annotation[],
  comments: readonly import("@/lib/shared-library/domain").AnnotationComment[],
  onCreatePageNote: (page: number, body: string) => Promise<void>,
  onCreateComment: (annotationId: string, parentId: string | undefined, body: string) => Promise<void>,
  onSaveContent: (content: SharedLibraryItemContent) => Promise<void>,
  contentLoader?: (itemId: string) => Promise<SharedLibraryItemContent | null>,
): ItemWorkspaceItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    libraryId: item.libraryId,
    versionId: item.currentVersionId,
    fileName: item.canonicalName,
    filePath: item.canonicalName,
    extras: {
      itemId: item.id,
      sourceUrl: item.sourceUrl,
      annotations,
      comments,
      onCreatePageNote,
      onCreateComment,
      onSaveContent,
      ...(contentLoader ? { contentLoader } : {}),
    },
  };
}

function slugifyItemName(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "untitled-item";
}

function pushSharedLibraryUrl(libraryId?: string | null, itemId?: string | null): void {
  if (typeof window === "undefined") return;
  const nextPath = libraryId
    ? `/library/${encodeURIComponent(libraryId)}${itemId ? `/item/${encodeURIComponent(itemId)}` : ""}`
    : "/library";
  if (`${window.location.pathname}${window.location.search}` === nextPath) return;
  window.history.pushState({}, "", nextPath);
}

function inferItemKind(file: File): ItemKind {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "text/markdown" || name.endsWith(".md")) return "markdown";
  if (name.endsWith(".ipynb")) return "notebook";
  if (file.type.startsWith("image/")) return "image";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx") || name.endsWith(".ppt")) return "pptx";
  if (file.type.startsWith("text/") || /\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|json|yaml|yml|txt)$/i.test(name)) return "code";
  return "data";
}

/**
 * Web shared-library shell: library list -> library detail (items) -> item
 * workspace. The item workspace is rendered by the generic
 * `ItemWorkspaceShell` from the shared-library item workspace model, so every
 * item kind mounts the viewer its adapter contributes.
 */
export function LibraryShell({
  store = useSharedLibraryStore,
  registry = itemWorkspaceRegistry,
  initialLibraryId,
  initialItemId,
  contentLoader,
}: LibraryShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const pathParams = useMemo(() => parseSharedLibraryPath(pathname), [pathname]);
  const resolvedInitialLibraryId = initialLibraryId && initialLibraryId !== "__index__"
    ? initialLibraryId
    : pathParams.libraryId;
  const resolvedInitialItemId = initialItemId && initialItemId !== "__index__"
    ? initialItemId
    : pathParams.itemId;
  const libraries = store((state) => state.libraries);
  const items = store((state) => state.items);
  const activeLibraryId = store((state) => state.activeLibraryId);
  const activeItemId = store((state) => state.activeItemId);
  const isLoading = store((state) => state.isLoading);
  const error = store((state) => state.error);
  const loadLibraries = store((state) => state.loadLibraries);
  const openLibrary = store((state) => state.openLibrary);
  const openItem = store((state) => state.openItem);
  const closeItem = store((state) => state.closeItem);
  const closeLibrary = store((state) => state.closeLibrary);
  const createLibrary = store((state) => state.createLibrary);
  const createItem = store((state) => state.createItem);
  const createItemWithContent = store((state) => state.createItemWithContent);
  const saveItemContent = store((state) => state.saveItemContent);
  const ensureCurrentVersion = store((state) => state.ensureCurrentVersion);
  const loadAnnotations = store((state) => state.loadAnnotations);
  const createAnnotation = store((state) => state.createAnnotation);
  const annotationsByItemId = store((state) => state.annotationsByItemId);
  const commentsByAnnotationId = store((state) => state.commentsByAnnotationId);
  const loadComments = store((state) => state.loadComments);
  const createComment = store((state) => state.createComment);

  const syncStatus = useSharedLibrarySyncStore((state) => state.status);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemKind, setItemKind] = useState<ItemKind>("markdown");
  const [itemTitle, setItemTitle] = useState("");
  const [itemContent, setItemContent] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemFormError, setItemFormError] = useState<string | null>(null);
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [itemQuery, setItemQuery] = useState("");

  const navigateToLibrary = useCallback((libraryId: string) => {
    pushSharedLibraryUrl(libraryId);
    void openLibrary(libraryId);
  }, [openLibrary]);

  const navigateToItem = useCallback((itemId: string) => {
    if (activeLibraryId) pushSharedLibraryUrl(activeLibraryId, itemId);
    openItem(itemId);
  }, [activeLibraryId, openItem]);

  const navigateBackToLibrary = useCallback(() => {
    pushSharedLibraryUrl(activeLibraryId);
    closeItem();
  }, [activeLibraryId, closeItem]);

  const navigateBackToLibraries = useCallback(() => {
    pushSharedLibraryUrl();
    closeLibrary();
  }, [closeLibrary]);

  useEffect(() => {
    void (async () => {
      await loadLibraries();
      if (resolvedInitialLibraryId) {
        await openLibrary(resolvedInitialLibraryId);
        if (resolvedInitialItemId) {
          openItem(resolvedInitialItemId);
        }
      }
    })();
  }, [loadLibraries, openLibrary, openItem, resolvedInitialLibraryId, resolvedInitialItemId]);

  useEffect(() => {
    if (activeItemId) void loadAnnotations(activeItemId);
  }, [activeItemId, loadAnnotations]);

  useEffect(() => {
    const annotations = activeItemId ? annotationsByItemId[activeItemId] ?? [] : [];
    let cancelled = false;
    const annotationIds = annotations.map((annotation) => annotation.id);
    const loadInBatches = async () => {
      const batchSize = 8;
      for (let index = 0; index < annotationIds.length && !cancelled; index += batchSize) {
        await Promise.all(annotationIds.slice(index, index + batchSize).map((annotationId) => loadComments(annotationId)));
      }
    };
    void loadInBatches();
    return () => {
      cancelled = true;
    };
  }, [activeItemId, annotationsByItemId, loadComments]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const next = parseSharedLibraryPath(window.location.pathname);
      if (!next.libraryId) {
        closeLibrary();
        return;
      }
      if (next.libraryId !== activeLibraryId) {
        void openLibrary(next.libraryId).then(() => {
          if (next.itemId) openItem(next.itemId);
        });
        return;
      }
      if (next.itemId) openItem(next.itemId);
      else closeItem();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [activeLibraryId, closeItem, closeLibrary, openItem, openLibrary]);

  const activeLibrary = useMemo(
    () => libraries.find((library) => library.id === activeLibraryId) ?? null,
    [activeLibraryId, libraries],
  );
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) ?? null,
    [activeItemId, items],
  );
  const visibleItems = useMemo(() => {
    const needle = itemQuery.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.title} ${item.canonicalName} ${item.kind} ${t(`cloud.library.kind.${item.kind}`)}`.toLowerCase().includes(needle));
  }, [itemQuery, items, t]);

  const handleCreatePageNote = useCallback(async (page: number, body: string) => {
    if (!activeItemId) return;
    const currentItem = items.find((entry) => entry.id === activeItemId);
    if (!currentItem) throw new Error(t("cloud.library.item.unavailable"));
    const versionId = await ensureCurrentVersion(activeItemId);
    await createAnnotation({
      itemId: currentItem.id,
      versionId,
      kind: "comment",
      target: { locatorType: "pdf-page", locator: { page } },
      style: {},
      body: { text: body },
    });
  }, [activeItemId, createAnnotation, ensureCurrentVersion, items, t]);

  const handleCreateComment = useCallback(async (annotationId: string, parentId: string | undefined, body: string) => {
    await createComment({ annotationId, parentId, body });
  }, [createComment]);

  const handleSaveItemContent = useCallback(async (content: SharedLibraryItemContent) => {
    if (!activeItemId) throw new Error(t("cloud.library.item.noActive"));
    await saveItemContent(activeItemId, content);
  }, [activeItemId, saveItemContent, t]);

  const activeComments = useMemo(
    () => {
      const annotationIds = (activeItemId ? annotationsByItemId[activeItemId] : [])?.map((annotation) => annotation.id) ?? [];
      return annotationIds.flatMap((annotationId) => commentsByAnnotationId[annotationId] ?? []);
    },
    [activeItemId, annotationsByItemId, commentsByAnnotationId],
  );

  const handleCreateLibrary = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    await createLibrary({ name });
    setNewName("");
    setShowCreateForm(false);
  }, [createLibrary, newName]);

  const handleCreateItem = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeLibraryId) return;
    const title = itemTitle.trim() || itemFile?.name.replace(/\.[^.]+$/, "") || t("cloud.library.item.untitled");
    const canonicalName = slugifyItemName(title);
    setIsCreatingItem(true);
    setItemFormError(null);
    try {
      if (itemKind === "web_snapshot") {
        const url = itemUrl.trim();
        if (!url) throw new Error(t("cloud.library.item.urlRequired"));
        new URL(url);
        await createItem({
          libraryId: activeLibraryId,
          kind: itemKind,
          title,
          canonicalName,
          sourceUrl: url,
          metadata: { sourceUrl: url, snapshotState: "url-only" },
        });
      } else {
        let content: SharedLibraryItemContent;
        if (itemFile) {
          content = {
            kind: "binary",
            mimeType: itemFile.type || "application/octet-stream",
            data: await itemFile.arrayBuffer(),
            updatedAt: new Date().toISOString(),
          };
        } else {
          content = {
            kind: "text",
            mimeType: itemKind === "markdown" ? "text/markdown" : "text/plain",
            text: itemContent || (itemKind === "markdown" ? `# ${title}\n\n` : ""),
            updatedAt: new Date().toISOString(),
          };
        }
        await createItemWithContent({
          libraryId: activeLibraryId,
          kind: itemKind,
          title,
          canonicalName: itemFile?.name || canonicalName,
          metadata: { mimeType: content.mimeType },
        }, content);
      }
      setShowItemForm(false);
      setItemTitle("");
      setItemContent("");
      setItemUrl("");
      setItemFile(null);
    } catch (error) {
      setItemFormError(error instanceof Error ? error.message : t("cloud.library.item.createFailed"));
    } finally {
      setIsCreatingItem(false);
    }
  }, [activeLibraryId, createItem, createItemWithContent, itemContent, itemFile, itemKind, itemTitle, itemUrl, t]);

  // Item workspace view.
  if (activeItem && activeLibrary) {
    return (
      <div
        className="flex h-full flex-col"
        data-testid="library-item-workspace"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={navigateBackToLibrary}
            data-testid="back-to-library"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">{activeLibrary.name}</span>
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">
            {activeItem.title}
          </div>
          <span className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(`cloud.library.kind.${activeItem.kind}`)}
          </span>
        </header>
        <div className="min-h-0 flex-1">
          <ItemWorkspaceShell item={toWorkspaceItem(activeItem, annotationsByItemId[activeItem.id] ?? [], activeComments, handleCreatePageNote, handleCreateComment, handleSaveItemContent, contentLoader)} registry={registry} />
        </div>
      </div>
    );
  }

  // Library detail view.
  if (activeLibrary) {
    return (
      <div className="flex h-full flex-col" data-testid="library-detail">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={navigateBackToLibraries}
            data-testid="back-to-libraries"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">{t("cloud.library.back")}</span>
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">
            {activeLibrary.name}
          </div>
          <span className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t(`cloud.library.sync.${syncStatus}`)}
          </span>
          <Button type="button" size="sm" onClick={() => { setShowItemForm(true); setItemFormError(null); }}>
            <Plus className="h-4 w-4" />
            <span className="ml-1">{t("cloud.library.item.add")}</span>
          </Button>
        </header>

        {error ? (
          <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {showItemForm ? (
          <form onSubmit={(event) => void handleCreateItem(event)} className="shrink-0 border-b border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium"><FilePlus2 className="h-4 w-4" /> {t("cloud.library.item.formTitle")}</div>
              <Button type="button" variant="ghost" size="icon" aria-label={t("cloud.library.item.closeForm")} onClick={() => setShowItemForm(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium">{t("cloud.library.item.title")}<input aria-label={t("cloud.library.item.title")} value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder={t("cloud.library.item.titlePlaceholder")} /></label>
              <label className="grid gap-1 text-xs font-medium">{t("cloud.library.item.type")}<select aria-label={t("cloud.library.item.type")} value={itemKind} onChange={(event) => { setItemKind(event.target.value as ItemKind); setItemFile(null); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                <option value="markdown">{t("cloud.library.kind.markdown")}</option><option value="code">{t("cloud.library.kind.code")}</option><option value="notebook">{t("cloud.library.kind.notebook")}</option><option value="pdf">{t("cloud.library.kind.pdf")}</option><option value="docx">{t("cloud.library.kind.docx")}</option><option value="pptx">{t("cloud.library.kind.pptx")}</option><option value="image">{t("cloud.library.kind.image")}</option><option value="web_snapshot">{t("cloud.library.kind.web_snapshot")}</option><option value="data">{t("cloud.library.kind.data")}</option>
              </select></label>
            </div>
            {itemKind === "web_snapshot" ? <label className="mt-2 grid gap-1 text-xs font-medium"><span className="flex items-center gap-1"><Link2 className="h-3 w-3" /> {t("cloud.library.item.sourceUrl")}</span><input aria-label={t("cloud.library.item.sourceUrl")} type="url" value={itemUrl} onChange={(event) => setItemUrl(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder="https://example.org/article" /></label> : (
              <>
                <label className="mt-2 grid gap-1 text-xs font-medium">{t("cloud.library.item.file")}<input aria-label={t("cloud.library.item.upload")} type="file" onChange={(event) => { const file = event.target.files?.[0] ?? null; setItemFile(file); if (file && !itemTitle) { setItemTitle(file.name.replace(/\.[^.]+$/, "")); setItemKind(inferItemKind(file)); } }} className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-primary file:px-2 file:py-1 file:text-primary-foreground" /></label>
                {!itemFile && <label className="mt-2 grid gap-1 text-xs font-medium">{t("cloud.library.item.content")}<textarea aria-label={t("cloud.library.item.content")} value={itemContent} onChange={(event) => setItemContent(event.target.value)} className="min-h-24 resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm" placeholder={t("cloud.library.item.contentPlaceholder")} /></label>}
              </>
            )}
            {itemFormError ? <div role="alert" className="mt-2 text-xs text-destructive">{itemFormError}</div> : null}
            <div className="mt-3 flex items-center justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setShowItemForm(false)}>{t("common.cancel")}</Button><Button type="submit" size="sm" disabled={isCreatingItem}>{isCreatingItem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}<span className="ml-1">{t("cloud.library.item.create")}</span></Button></div>
          </form>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" /><input aria-label={t("cloud.library.item.search")} value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder={t("cloud.library.item.searchPlaceholder")} /></div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("cloud.library.item.loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground"><FileQuestion className="h-10 w-10" /><div className="text-sm">{t("cloud.library.item.empty")}</div><Button type="button" size="sm" onClick={() => setShowItemForm(true)}><Plus className="h-4 w-4" /><span className="ml-1">{t("cloud.library.item.addFirst")}</span></Button></div>
          ) : visibleItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("cloud.library.item.noMatch")}</div>
          ) : (
            <ul className="grid gap-2">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => navigateToItem(item.id)}
                    data-testid="item-row"
                    className="flex w-full items-center gap-2 rounded-md border border-border bg-background/80 px-3 py-2 text-left transition-colors hover:bg-accent/40"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.title}
                    </span>
                    <span className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t(`cloud.library.kind.${item.kind}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Library list view.
  return (
    <div className="flex h-full flex-col" data-testid="library-list">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LibraryIcon className="h-4 w-4 text-muted-foreground" />
          {t("cloud.library.title")}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCreateForm((value) => !value)}
        >
          <Plus className="h-4 w-4" />
          <span className="ml-1">{t("cloud.library.add")}</span>
        </Button>
      </header>

      {showCreateForm ? (
        <div className="border-b border-border bg-muted/20 px-3 py-2">
          <label
            className="mb-1 block text-xs font-medium"
            htmlFor="library-name"
          >
            {t("cloud.library.name")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="library-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCreateLibrary();
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder={t("cloud.library.namePlaceholder")}
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void handleCreateLibrary()}
            >
              {t("cloud.library.create")}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("cloud.library.loading")}
          </div>
        ) : libraries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <FileQuestion className="h-10 w-10" />
            <div className="text-sm">
              {t("cloud.library.empty")}
            </div>
          </div>
        ) : (
          <ul className="grid gap-2">
            {libraries.map((library) => (
              <li key={library.id}>
                <button
                  type="button"
                  onClick={() => navigateToLibrary(library.id)}
                  data-testid="library-card"
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-background/80 px-3 py-3 text-left transition-colors hover:bg-accent/40"
                >
                  <LibraryIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {library.name}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      /{library.slug}
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`cloud.library.visibility.${library.visibility}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default LibraryShell;
