"use client";

import { useMemo, useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, FileQuestion } from "lucide-react";
import { getRendererForExtension, getFileExtension, getImageMimeType, RendererType, isEditableCodeFile } from "@/lib/file-utils";
import dynamic from "next/dynamic";
import type { PaneId } from "@/stores/workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { normalizeScientificText } from "@/lib/markdown-converter";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { t } from "@/lib/i18n";
import { buildExecutionScopeId } from "@/lib/runner/execution-scope";
import { isTauriHost } from "@/lib/storage-adapter";
import { resolvePdfDocumentBinding } from "@/lib/pdf-document-binding";
import type { ResolvedPdfDocumentBinding } from "@/lib/pdf-document-binding";
import type { BinaryViewerContent, BufferViewerContent, ViewerContent } from "@/types/viewer-content";

/**
 * LRU cache for normalizeScientificText results.
 * Avoids re-running expensive regex chains on every render when content hasn't changed.
 */
const normalizeCache = new Map<string, string>();
const NORMALIZE_CACHE_MAX = 20;

function cachedNormalizeScientificText(raw: string): string {
  const cached = normalizeCache.get(raw);
  if (cached !== undefined) return cached;
  const result = normalizeScientificText(raw);
  if (normalizeCache.size >= NORMALIZE_CACHE_MAX) {
    // Evict oldest entry
    const firstKey = normalizeCache.keys().next().value;
    if (firstKey !== undefined) normalizeCache.delete(firstKey);
  }
  normalizeCache.set(raw, result);
  return result;
}

interface AdaptivePDFRendererProps {
  source: BinaryViewerContent;
  fileName: string;
  fileHandle?: FileSystemFileHandle;
  rootHandle?: FileSystemDirectoryHandle | null;
  paneId: PaneId;
  fileId: string;
  filePath: string;
}

function AdaptivePDFRenderer({
  source,
  fileName,
  fileHandle,
  rootHandle,
  paneId,
  fileId,
  filePath,
}: AdaptivePDFRendererProps) {
  const workspaceIdentity = useWorkspaceStore((state) => state.workspaceIdentity);
  const hasAnnotationContext = Boolean(fileHandle && rootHandle);
  const isDesktopRuntime = isTauriHost();
  const activePdfKey = `${fileId}:${filePath}`;

  const [requestedAnnotationModeKey, setRequestedAnnotationModeKey] = useState<string | null>(null);
  const [bindingByKey, setBindingByKey] = useState<Record<string, ResolvedPdfDocumentBinding | null>>({});
  const [annotationPresenceByKey, setAnnotationPresenceByKey] = useState<Record<string, boolean>>({});
  const resolvedBinding = bindingByKey[activePdfKey] ?? null;
  const hasPersistedAnnotations = annotationPresenceByKey[activePdfKey] ?? false;
  const renderMode: "viewer" | "highlighter" = (
    hasAnnotationContext ||
    requestedAnnotationModeKey === activePdfKey ||
    (!isDesktopRuntime && hasPersistedAnnotations)
  ) ? "highlighter" : "viewer";

  useEffect(() => {
    if (!rootHandle || !fileHandle) {
      return;
    }

    let cancelled = false;

    const detectPersistedAnnotations = async () => {
      try {
        const binding = await resolvePdfDocumentBinding({
          rootHandle,
          fileHandle,
          filePath,
          fileName,
          workspaceIdentity,
          fileType: "pdf",
        });
        const pdfAnnotations = binding.annotationFile.annotations.filter((annotation) => annotation.target.type === "pdf");
        const detected = pdfAnnotations.length > 0;
        if (!cancelled) {
          setBindingByKey((current) => ({
            ...current,
            [activePdfKey]: binding,
          }));
          setAnnotationPresenceByKey((current) => (
            current[activePdfKey] === detected
              ? current
              : {
                  ...current,
                  [activePdfKey]: detected,
                }
          ));
        }
      } catch {
        // Detection failure falls back to the lightweight viewer path.
      }
    };

    void detectPersistedAnnotations();

    return () => {
      cancelled = true;
    };
  }, [activePdfKey, fileHandle, fileName, filePath, hasAnnotationContext, isDesktopRuntime, rootHandle, workspaceIdentity]);

  const handleRequestAnnotationMode = useCallback(() => {
    if (!hasAnnotationContext) {
      return;
    }
    setRequestedAnnotationModeKey(activePdfKey);
  }, [activePdfKey, hasAnnotationContext]);

  if (renderMode === "highlighter" && fileHandle && rootHandle) {
    return (
      <PDFHighlighterAdapter
        source={source}
        fileName={fileName}
        fileHandle={fileHandle}
        rootHandle={rootHandle}
        paneId={paneId}
        fileId={fileId}
        filePath={filePath}
        binding={resolvedBinding}
      />
    );
  }

  return (
    <PDFViewer
      source={source}
      fileName={fileName}
      documentId={activePdfKey}
      fileHandle={fileHandle}
      paneId={paneId}
      canAnnotate={hasAnnotationContext}
      hasPersistedAnnotations={hasPersistedAnnotations}
      onRequestAnnotationMode={handleRequestAnnotationMode}
    />
  );
}

/**
 * Loading state component
 */
function LoadingState({ message = t("viewer.loading.file") }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="mt-4 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Error state component
 */
function ErrorState({ error }: { error: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="mt-4 text-sm text-destructive">{error}</p>
    </div>
  );
}

/**
 * Empty pane placeholder
 */
function EmptyPanePlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <FileQuestion className="h-12 w-12 text-muted-foreground/40" />
      <p className="mt-4 text-sm text-muted-foreground">
        {t("viewer.empty.openHere")}
      </p>
    </div>
  );
}

// Lazy load renderers to minimize bundle size
const ObsidianMarkdownViewer = dynamic(
  () => import("@/components/editor/obsidian-markdown-viewer").then((mod) => mod.ObsidianMarkdownViewer),
  { loading: () => <LoadingState message={t("viewer.loading.viewer")} />, ssr: false }
);

const MarkdownRenderer = dynamic(
  () => import("@/components/renderers/markdown-renderer").then((mod) => mod.MarkdownRenderer),
  { loading: () => <LoadingState message={t("viewer.loading.markdown")} />, ssr: false }
);

const PDFViewer = dynamic(
  () => import("@/components/renderers/pdf-viewer").then((mod) => mod.PDFViewer),
  { loading: () => null, ssr: false }
);

// PDF Highlighter Adapter for annotation support
const PDFHighlighterAdapter = dynamic(
  () => import("@/components/renderers/pdf-highlighter-adapter").then((mod) => mod.PDFHighlighterAdapter),
  { loading: () => null, ssr: false }
);

const JupyterRenderer = dynamic(
  () => import("@/components/renderers/jupyter-renderer").then((mod) => mod.JupyterRenderer),
  { loading: () => <LoadingState message={t("viewer.loading.jupyter")} />, ssr: false }
);

const NotebookEditor = dynamic(
  () => import("@/components/notebook/notebook-editor").then((mod) => mod.NotebookEditor),
  { loading: () => <LoadingState message={t("viewer.loading.notebook")} />, ssr: false }
);

const CodeReader = dynamic(
  () => import("@/components/renderers/code-reader").then((mod) => mod.CodeReader),
  { loading: () => <LoadingState message={t("viewer.loading.viewer")} />, ssr: false }
);

const WordViewer = dynamic(
  () => import("@/components/renderers/word-viewer").then((mod) => mod.WordViewer),
  { loading: () => <LoadingState message={t("viewer.loading.word")} />, ssr: false }
);

const PowerPointViewer = dynamic(
  () => import("@/components/renderers/powerpoint-viewer").then((mod) => mod.PowerPointViewer),
  { loading: () => <LoadingState message={t("viewer.loading.ppt")} />, ssr: false }
);

const HTMLViewer = dynamic(
  () => import("@/components/renderers/html-viewer").then((mod) => mod.HTMLViewer),
  { loading: () => <LoadingState message={t("viewer.loading.html")} />, ssr: false }
);

const ImageViewer = dynamic(
  () => import("@/components/renderers/image-viewer").then((mod) => mod.ImageViewer),
  { loading: () => <LoadingState message={t("viewer.loading.image")} />, ssr: false }
);

// Image Tldraw Adapter for annotation support
const ImageTldrawAdapter = dynamic(
  () => import("@/components/renderers/image-tldraw-adapter").then((mod) => mod.ImageTldrawAdapter),
  { loading: () => <LoadingState message={t("viewer.loading.imageEditor")} />, ssr: false }
);

const UnsupportedFile = dynamic(
  () => import("@/components/renderers/unsupported-file").then((mod) => mod.UnsupportedFile),
  { loading: () => <LoadingState message={t("viewer.loading.viewer")} />, ssr: false }
);

// CodeEditorViewer for editable code files (Requirements 4.1-4.4)
const CodeEditorViewer = dynamic(
  () => import("@/components/renderers/code-editor-viewer").then((mod) => mod.CodeEditorViewer),
  { loading: () => <LoadingState message={t("viewer.loading.code")} />, ssr: false }
);

// HandwritingViewer for handwriting note files
const HandwritingViewer = dynamic(
  () => import("@/components/renderers/handwriting-viewer").then((mod) => mod.HandwritingViewer),
  { loading: () => <LoadingState message={t("viewer.loading.handwriting")} />, ssr: false }
);

/**
 * File viewer router - renders appropriate component based on file type
 */
function FileViewer({
  content,
  fileName,
  rendererType,
  fileHandle,
  rootHandle,
  onContentChange,
  onSave,
  fileId,
  filePath,
  onNavigateToFile,
  paneId,
  executionScopeId,
}: {
  content: ViewerContent;
  fileName: string;
  rendererType: RendererType;
  fileHandle?: FileSystemFileHandle;
  rootHandle?: FileSystemDirectoryHandle | null;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  fileId?: string;
  filePath?: string;
  onNavigateToFile?: (target: string) => void;
  paneId: PaneId;
  executionScopeId: string;
}) {
  const extension = getFileExtension(fileName);
  const viewerKey = fileId || fileName;
  const isSystemIndexFile = fileName === "_annotations.md" || fileName === "_overview.md";
  const decodeBufferToText = (buffer: ArrayBuffer) => new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const getTextContent = () => {
    if (content.kind === "text") {
      return content.text;
    }

    if (content.kind === "buffer") {
      return decodeBufferToText(content.data);
    }

    return "";
  };
  const getBinaryContent = (): BufferViewerContent | null => {
    return content.kind === "buffer" ? content : null;
  };
  
  switch (rendererType) {
    case "markdown": {
      // Ensure content is a string for markdown/text editors
      let textContent: string;
      if (content.kind === "buffer") {
        // Check if it's binary data first
        const bytes = new Uint8Array(content.data);
        const isPng = bytes.length > 4 &&
                      bytes[0] === 0x89 && bytes[1] === 0x50 &&
                      bytes[2] === 0x4E && bytes[3] === 0x47;
        const isJpeg = bytes.length > 2 && bytes[0] === 0xFF && bytes[1] === 0xD8;
        const isGif = bytes.length > 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
        const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

        if (isPng || isJpeg || isGif || isPdf) {
          return (
            <div className="flex h-full flex-col items-center justify-center bg-background p-8">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="mt-4 text-sm text-destructive">
                {t("viewer.error.binaryText")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("viewer.error.binaryTextDescription", { fileName })}
              </p>
            </div>
          );
        }

        // Use non-fatal decoder to avoid throwing errors
        textContent = decodeBufferToText(content.data);
      } else {
        textContent = getTextContent();
      }

      // Normalize content: convert HTML to Markdown, fix LaTeX delimiters, etc.
      // Uses LRU cache to avoid re-running expensive regex chains on unchanged content
      const normalizedContent = cachedNormalizeScientificText(textContent);

      if (isSystemIndexFile) {
        return (
          <div className="h-full overflow-auto px-6 py-4">
            <MarkdownRenderer
              key={viewerKey}
              content={normalizedContent}
              fileName={fileName}
              paneId={paneId}
              filePath={filePath}
              rootHandle={rootHandle}
              variant="system-index"
              enableCodeExecution={false}
            />
          </div>
        );
      }

      // Use ObsidianMarkdownViewer for Obsidian-like experience (default render, click to edit)
      if (onContentChange) {
        // CRITICAL: Use fileId as key to force re-mount when switching between different files
        // This prevents content mixing between tabs/panes
        const viewerKey = fileId || fileName;
        return (
          <ObsidianMarkdownViewer
            key={viewerKey} // Force re-mount on file change
            content={normalizedContent}
            onChange={onContentChange}
            fileName={fileName}
            fileId={fileId} // Pass fileId for internal tracking
            onSave={onSave}
            onNavigateToFile={onNavigateToFile}
            paneId={paneId}
            rootHandle={rootHandle}
            filePath={filePath}
            variant="document"
            initialMode={undefined}
          />
        );
      }
      // Fallback to read-only renderer if no onChange handler
      return (
        <MarkdownRenderer
          key={viewerKey}
          content={normalizedContent}
          fileName={fileName}
          paneId={paneId}
          filePath={filePath}
          rootHandle={rootHandle}
          variant={isSystemIndexFile ? "system-index" : "document"}
          enableCodeExecution={false}
        />
      );
    }
    case "pdf":
      if (content.kind === "text") {
        return <ErrorState error={t("viewer.error.binaryText")} />;
      }
      return (
        <AdaptivePDFRenderer
          key={viewerKey}
          source={content}
          fileName={fileName}
          fileHandle={fileHandle}
          rootHandle={rootHandle}
          paneId={paneId}
          fileId={fileId ?? fileName}
          filePath={filePath ?? fileName}
        />
      );
    case "jupyter": {
      // Ensure content is a string for notebook editors
      const notebookContent = getTextContent() || "{}";

      // Use NotebookEditor for editable notebooks
      if (onContentChange) {
        return (
          <NotebookEditor
            content={notebookContent}
            fileName={fileName}
            onContentChange={onContentChange}
            onSave={onSave}
            paneId={paneId}
            tabId={fileId || fileName}
            filePath={filePath ?? fileName}
            executionScopeId={executionScopeId}
          />
        );
      }
      // Fallback to read-only renderer
      return (
        <JupyterRenderer
          content={notebookContent}
          fileName={fileName}
          paneId={paneId}
          filePath={filePath ?? fileName}
          rootHandle={rootHandle}
        />
      );
    }
    case "code": {
      // Ensure content is a string for code editors
      const codeContent = getTextContent();

      // Use CodeEditorViewer for editable code files (Requirements 4.1-4.4)
      if (onContentChange && isEditableCodeFile(extension)) {
        return (
          <CodeEditorViewer
            content={codeContent}
            fileName={fileName}
            onContentChange={onContentChange}
            onSave={onSave}
            paneId={paneId}
            tabId={fileId || fileName}
            filePath={filePath ?? fileName}
            executionScopeId={executionScopeId}
          />
        );
      }
      // Fallback to read-only CodeReader for non-editable code files
      return <CodeReader content={codeContent} fileName={fileName} paneId={paneId} filePath={filePath ?? fileName} />;
    }
    case "word":
      return <WordViewer content={getBinaryContent()?.data ?? new ArrayBuffer(0)} fileName={fileName} paneId={paneId} filePath={filePath ?? fileName} />;
    case "powerpoint":
      return <PowerPointViewer content={getBinaryContent()?.data ?? new ArrayBuffer(0)} fileName={fileName} />;
    case "html": {
      // Ensure content is a string for HTML viewer
      const htmlContent = getTextContent();
      return <HTMLViewer content={htmlContent} fileName={fileName} paneId={paneId} filePath={filePath ?? fileName} />;
    }
    case "image":
      if (content.kind === "text") {
        return <ErrorState error={t("viewer.error.binaryText")} />;
      }
      if (content.kind === "desktop-url") {
        return (
          <ImageViewer
            key={viewerKey}
            source={content}
            fileName={fileName}
            mimeType={content.mimeType ?? getImageMimeType(extension)}
            paneId={paneId}
            filePath={filePath ?? fileName}
          />
        );
      }
      // Use ImageTldrawAdapter if we have file handles for annotation support
      if (fileHandle && rootHandle && content.kind === "buffer") {
        return (
          <ImageTldrawAdapter
            key={viewerKey}
            content={content.data}
            fileName={fileName}
            mimeType={getImageMimeType(extension)}
            fileHandle={fileHandle}
            rootHandle={rootHandle}
            filePath={filePath}
            paneId={paneId}
          />
        );
      }
      // Fallback to basic image viewer
      return (
        <ImageViewer
          key={viewerKey}
          source={content}
          fileName={fileName}
          mimeType={getImageMimeType(extension)}
          paneId={paneId}
          filePath={filePath ?? fileName}
        />
      );
    case "handwriting": {
      // Ensure content is a string for handwriting editor
      const handwritingContent = getTextContent();
      return (
        <HandwritingViewer
          filePath={fileName}
          content={handwritingContent}
          onChange={onContentChange}
          onSave={onSave}
          readOnly={!onContentChange}
        />
      );
    }
    case "unsupported":
    default:
      return <UnsupportedFile fileName={fileName} />;
  }
}

/**
 * Props for UniversalFileViewer
 */
export interface UniversalFileViewerProps {
  paneId: PaneId;
  handle: FileSystemFileHandle | null;
  rootHandle?: FileSystemDirectoryHandle | null;
  content: ViewerContent | null;
  isLoading: boolean;
  error: string | null;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  fileId?: string; // Unique identifier for the file (e.g., tab.id)
  filePath?: string; // Full path relative to workspace root
}

/**
 * Universal File Viewer Component
 * 
 * A reusable component that displays any supported file type.
 * Each instance maintains isolated state and can be used in multiple panes.
 */
export function UniversalFileViewer({
  paneId,
  handle,
  rootHandle,
  content,
  isLoading,
  error,
  onContentChange,
  onSave,
  fileId, // Unique identifier for the file
  filePath,
}: UniversalFileViewerProps) {
  const handleNavigateToFile = useCallback(async (target: string) => {
    const success = await navigateLink(target, {
      paneId,
      rootHandle,
      currentFilePath: filePath,
    });

    if (!success) {
      console.warn("Failed to resolve link target:", target);
    }
  }, [paneId, rootHandle, filePath]);

  const executionScopeId = useMemo(() => buildExecutionScopeId({
    paneId,
    tabId: fileId || handle?.name || "",
  }), [paneId, fileId, handle?.name]);
  // No file selected - show empty placeholder
  if (!handle) {
    return <EmptyPanePlaceholder />;
  }

  // Loading state
  if (isLoading) {
    return <LoadingState message={t("viewer.loading.reading")} />;
  }

  // Error state
  if (error) {
    return <ErrorState error={error} />;
  }

  // No content yet (shouldn't happen if not loading/error, but handle gracefully)
  if (!content) {
    return <LoadingState message={t("viewer.loading.preparing")} />;
  }

  const fileName = handle.name;
  const extension = getFileExtension(fileName);
  const rendererType = getRendererForExtension(extension);

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
      <FileViewer
        content={content}
        fileName={fileName}
        rendererType={rendererType}
        fileHandle={handle}
        rootHandle={rootHandle}
        onContentChange={onContentChange}
        onSave={onSave}
        fileId={fileId}
        filePath={filePath}
        onNavigateToFile={handleNavigateToFile}
        paneId={paneId}
        executionScopeId={executionScopeId}
      />
    </div>
  );
}
