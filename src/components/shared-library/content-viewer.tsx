"use client";

import { useI18n } from "@/hooks/use-i18n";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileQuestion, Loader2 } from "lucide-react";
import type { PaneId } from "@/types/layout";
import type { BinaryViewerContent } from "@/types/viewer-content";
import type { ItemWorkspaceItem } from "@/lib/shared-library/item-workspace";
import type { SharedLibraryItemContent } from "@/lib/shared-library/content-store";
import type { CloudPdfDocument } from "@/lib/shared-library/cloud-pdf";
import { FileViewer } from "@/components/main-area/universal-file-viewer";
import { getFileExtension, getRendererForExtension } from "@/lib/file-utils";
import { cloudArrayBuffer, cloudContentFromBytes } from "@/lib/shared-library/file-content";

const PDFViewer = dynamic(() => import("@/components/renderers/pdf-viewer").then((module) => module.PDFViewer), { ssr: false });
// Host owns the renderer implementation; this prop seam never substitutes local file handles.
const CloudPDFHighlighter = dynamic(() => import("@/components/renderers/pdf-highlighter-adapter").then(module => module.PDFHighlighterAdapter), { ssr: false });
const MarkdownRenderer = dynamic(() => import("@/components/renderers/markdown-renderer").then((module) => module.MarkdownRenderer), { ssr: false });
const CodeReader = dynamic(() => import("@/components/renderers/code-reader").then((module) => module.CodeReader), { ssr: false });
const WordViewer = dynamic(() => import("@/components/renderers/word-viewer").then((module) => module.WordViewer), { ssr: false });
const PowerPointViewer = dynamic(() => import("@/components/renderers/powerpoint-viewer").then((module) => module.PowerPointViewer), { ssr: false });
const HTMLViewer = dynamic(() => import("@/components/renderers/html-viewer").then((module) => module.HTMLViewer), { ssr: false });
const ImageViewer = dynamic(() => import("@/components/renderers/image-viewer").then((module) => module.ImageViewer), { ssr: false });
const JupyterRenderer = dynamic(() => import("@/components/renderers/jupyter-renderer").then((module) => module.JupyterRenderer), { ssr: false });
const ObsidianMarkdownViewer = dynamic(() => import("@/components/editor/obsidian-markdown-viewer").then((module) => module.ObsidianMarkdownViewer), { ssr: false });
const CodeEditorViewer = dynamic(() => import("@/components/renderers/code-editor-viewer").then((module) => module.CodeEditorViewer), { ssr: false });

const SHARED_PANE_ID = "pane-shared-library" as PaneId;
type CloudDraftStore = Record<string, { source: string; draft: string }>;

function getContent(item: ItemWorkspaceItem): SharedLibraryItemContent | null {
  const candidate = item.extras?.content;
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as { kind?: unknown; text?: unknown; data?: unknown };
  if (record.kind === "text" && typeof record.text === "string") return candidate as SharedLibraryItemContent;
  if (record.kind === "binary") {
    const data = cloudArrayBuffer(record.data);
    if (data) return { ...candidate as SharedLibraryItemContent, kind: "binary", data };
  }
  return null;
}

function getBinary(content: SharedLibraryItemContent): BinaryViewerContent {
  return {
    kind: "buffer",
    data: content.kind === "binary" ? content.data : new TextEncoder().encode(content.text).buffer,
  };
}

function LoadingContent() {
  const { t } = useI18n();
  return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /><span>{t("cloud.content.loading")}</span></div>;
}

function MissingContent({ item }: { item: ItemWorkspaceItem }) {
  const { t } = useI18n();
  const sourceUrl = typeof item.extras?.sourceUrl === "string" ? item.extras.sourceUrl : null;
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
    {sourceUrl ? <AlertCircle className="h-8 w-8" /> : <FileQuestion className="h-8 w-8" />}
    <div className="text-sm font-medium text-foreground">{item.title}</div>
    {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-primary underline underline-offset-4">{t("cloud.content.openSource")}</a> : <div className="max-w-sm text-xs">{t("cloud.content.missing")}</div>}
  </div>;
}

function BinaryDownload({ content, fileName }: { content: SharedLibraryItemContent; fileName: string }) {
  const { t } = useI18n();
  const data = content.kind === "binary" ? content.data : new TextEncoder().encode(content.text).buffer;
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm"><FileQuestion className="size-8 text-muted-foreground" /><p>{fileName}</p><p className="text-xs text-muted-foreground">{content.mimeType} · {t("cloud.content.binary", { bytes: data.byteLength })}</p><button className="rounded border border-border px-3 py-2 hover:bg-accent" onClick={() => { const url = URL.createObjectURL(new Blob([data], { type: content.mimeType })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{t("cloud.content.download")}</button></div>;
}

function CloudEditorFrame({ children, save }: { children: React.ReactNode; save: () => Promise<void> }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; message: string } | null>(null); const [saving, setSaving] = useState(false);
  async function persist() { setSaving(true); setStatus(null); try { await save(); setStatus({ kind: "saved" }); } catch (error) { setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) }); } finally { setSaving(false); } }
  return <div className="flex h-full min-h-0 flex-col"><div className="flex items-center justify-end gap-2 border-b border-border px-2 py-1 text-xs"><span role="status" className="text-muted-foreground">{status?.kind === "saved" ? t("cloud.content.saved") : status?.message}</span><button className="rounded border border-border px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={saving} onClick={() => void persist()}>{saving ? t("cloud.content.saving") : t("cloud.content.save")}</button></div><div className="min-h-0 flex-1">{children}</div></div>;
}

function SharedMarkdownEditor({
  content,
  fileName,
  filePath,
  itemId,
  paneId,
  mimeType,
  onSaveContent,
  draftStore,
}: {
  content: string;
  fileName: string;
  filePath: string;
  itemId: string;
  paneId: PaneId;
  mimeType: string;
  onSaveContent: (next: SharedLibraryItemContent) => Promise<void>;
  draftStore?: CloudDraftStore;
}) {
  const [draft, setDraft] = useState(() => draftStore?.[itemId]?.source === content ? draftStore[itemId].draft : content);
  const currentDraft = useRef(draft);
  const loadedContent = useRef(content);
  useEffect(() => {
    // Activity restarts Effects when a tab becomes visible; only a new source
    // version may replace its unsaved draft.
    if (loadedContent.current === content) return;
    loadedContent.current = content; currentDraft.current = content; setDraft(content);
  }, [content]);
  return <CloudEditorFrame save={() => onSaveContent({ kind: "text", mimeType, text: currentDraft.current, updatedAt: new Date().toISOString() })}><ObsidianMarkdownViewer
    content={draft}
    onChange={value => { currentDraft.current = value; if (draftStore) draftStore[itemId] = { source: content, draft: value }; setDraft(value); }}
    fileName={fileName}
    fileId={itemId}
    filePath={filePath}
    paneId={paneId}
    initialMode="live"
    onSave={() => onSaveContent({ kind: "text", mimeType, text: currentDraft.current, updatedAt: new Date().toISOString() })}
  /></CloudEditorFrame>;
}

function SharedCodeEditor({
  content,
  fileName,
  filePath,
  itemId,
  paneId,
  mimeType,
  onSaveContent,
  draftStore,
}: {
  content: string;
  fileName: string;
  filePath: string;
  itemId: string;
  paneId: PaneId;
  mimeType: string;
  onSaveContent: (next: SharedLibraryItemContent) => Promise<void>;
  draftStore?: CloudDraftStore;
}) {
  const [draft, setDraft] = useState(() => draftStore?.[itemId]?.source === content ? draftStore[itemId].draft : content);
  const loadedContent = useRef(content);
  useEffect(() => { if (loadedContent.current !== content) { loadedContent.current = content; setDraft(content); } }, [content]);
  return <CloudEditorFrame save={() => onSaveContent({ kind: "text", mimeType, text: draft, updatedAt: new Date().toISOString() })}><CodeEditorViewer
    content={draft}
    fileName={fileName}
    paneId={paneId}
    tabId={itemId}
    filePath={filePath}
    executionScopeId={`shared-library:${itemId}`}
    executionMode="inline-only"
    onContentChange={value => { if (draftStore) draftStore[itemId] = { source: content, draft: value }; setDraft(value); }}
    onSave={() => onSaveContent({ kind: "text", mimeType, text: draft, updatedAt: new Date().toISOString() })}
  /></CloudEditorFrame>;
}

export function SharedLibraryContentViewer({ item }: { item: ItemWorkspaceItem }) {
  const contentState = item.extras?.contentState;
  if (contentState === "loading" || contentState === "idle") return <LoadingContent />;
  const stored = getContent(item);
  if (!stored) return <MissingContent item={item} />;
  const fileName = item.fileName ?? item.title;
  const content = stored.kind === "binary" ? cloudContentFromBytes(fileName, stored.data, stored.mimeType, stored.updatedAt) : stored;
  const filePath = item.filePath ?? fileName;
  const resourceId = typeof item.extras?.resourceId === "string" ? item.extras.resourceId : item.id;
  const paneId = (typeof item.extras?.paneId === "string" ? item.extras.paneId : SHARED_PANE_ID) as PaneId;
  const cloudPdf = item.extras?.cloudPdf as CloudPdfDocument | undefined;
  const renderer = getRendererForExtension(getFileExtension(fileName));
  const text = content.kind === "text" ? content.text : "";
  const onSaveContent = item.extras?.onSaveContent as ((next: SharedLibraryItemContent) => Promise<void>) | undefined;
  const draftStore = item.extras?.draftStore as CloudDraftStore | undefined;
  if (content.kind === "binary" && ["markdown", "code", "jupyter", "html", "handwriting"].includes(renderer)) return <BinaryDownload content={content} fileName={fileName} />;

  if (renderer === "pdf" && cloudPdf) return <CloudPDFHighlighter source={getBinary(content)} fileName={fileName} paneId={paneId} fileId={resourceId} filePath={filePath} sharedDocument={cloudPdf} />;
  if (renderer === "markdown" && onSaveContent) return <SharedMarkdownEditor content={text} fileName={fileName} filePath={filePath} itemId={resourceId} paneId={paneId} mimeType={content.mimeType} onSaveContent={onSaveContent} draftStore={draftStore} />;
  if (renderer === "code" && onSaveContent) return <SharedCodeEditor content={text} fileName={fileName} filePath={filePath} itemId={resourceId} paneId={paneId} mimeType={content.mimeType} onSaveContent={onSaveContent} draftStore={draftStore} />;
  if (renderer !== "unsupported") return <FileViewer tab={{ id: resourceId }} content={content.kind === "text" ? { kind: "text", text } : getBinary(content)} fileName={fileName} rendererType={renderer} fileId={resourceId} filePath={filePath} paneId={paneId} executionScopeId={`shared-library:${resourceId}`} isActive />;

  switch (item.kind) {
    case "pdf": return cloudPdf ? <CloudPDFHighlighter source={getBinary(content)} fileName={fileName} paneId={paneId} fileId={resourceId} filePath={filePath} sharedDocument={cloudPdf} /> : <PDFViewer source={getBinary(content)} documentId={resourceId} fileName={fileName} paneId={paneId} canAnnotate={false} hasPersistedAnnotations={false} />;
    case "markdown": return onSaveContent
      ? <SharedMarkdownEditor content={text} fileName={fileName} filePath={filePath} itemId={resourceId} paneId={paneId} mimeType={content.mimeType} onSaveContent={onSaveContent} />
      : <div className="h-full overflow-auto px-6 py-4"><MarkdownRenderer content={text} fileName={fileName} paneId={SHARED_PANE_ID} filePath={filePath} enableCodeExecution={false} /></div>;
    case "code": return onSaveContent
      ? <SharedCodeEditor content={text} fileName={fileName} filePath={filePath} itemId={resourceId} paneId={paneId} mimeType={content.mimeType} onSaveContent={onSaveContent} />
      : <CodeReader content={text} fileName={fileName} paneId={SHARED_PANE_ID} filePath={filePath} />;
    case "notebook": return <JupyterRenderer content={text} fileName={fileName} paneId={SHARED_PANE_ID} filePath={filePath} />;
    case "docx": return <WordViewer content={content.kind === "binary" ? content.data : new TextEncoder().encode(text).buffer} fileName={fileName} paneId={SHARED_PANE_ID} filePath={filePath} />;
    case "pptx": return <PowerPointViewer content={content.kind === "binary" ? content.data : new TextEncoder().encode(text).buffer} fileName={fileName} />;
    case "image": return <ImageViewer source={getBinary(content)} fileName={fileName} mimeType={content.mimeType} paneId={SHARED_PANE_ID} filePath={filePath} />;
    case "web_snapshot": return content.kind === "text" ? <HTMLViewer content={text} fileName={fileName} paneId={SHARED_PANE_ID} filePath={filePath} /> : <MissingContent item={item} />;
    case "data": return content.kind === "binary" ? <BinaryDownload content={content} fileName={fileName} /> : <CodeReader content={text} fileName={fileName} paneId={paneId} filePath={filePath} />;
    default: return <MissingContent item={item} />;
  }
}
