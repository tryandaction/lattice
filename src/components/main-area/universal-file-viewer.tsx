"use client";

import { Loader2, AlertCircle, FileQuestion } from "lucide-react";
import { getRendererForExtension, getFileExtension, getImageMimeType, RendererType, isEditableCodeFile } from "@/lib/file-utils";
import dynamic from "next/dynamic";
import type { PaneId } from "@/stores/workspace-store";
import { normalizeScientificText } from "@/lib/markdown-converter";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * Loading state component
 */
function LoadingState({ message = "Loading file..." }: { message?: string }) {
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
        Click a file in the sidebar to open it here
      </p>
    </div>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isExternalUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("//")) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

function resolveRelativePath(basePath: string, targetPath: string): string {
  const baseParts = normalizePath(basePath).split("/").filter(Boolean);
  baseParts.pop(); // remove filename

  const targetParts = normalizePath(targetPath).split("/").filter(Boolean);
  const resolvedParts = [...baseParts];
  for (const part of targetParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolvedParts.length > 0) resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }
  return resolvedParts.join("/");
}

function splitLinkTarget(target: string): { path: string; heading?: string } {
  if (target.startsWith("#")) {
    return { path: "", heading: target.slice(1) };
  }
  const [path, heading] = target.split("#");
  return { path: path ?? "", heading };
}

function hasFileExtension(path: string): boolean {
  return /\.[^/.]+$/.test(path);
}

async function resolveFileHandle(
  root: FileSystemDirectoryHandle,
  filePath: string
): Promise<FileSystemFileHandle> {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  let current: FileSystemDirectoryHandle | FileSystemFileHandle = root;
  const startIndex = parts[0] === root.name ? 1 : 0;
  for (let i = startIndex; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      current = await (current as FileSystemDirectoryHandle).getFileHandle(part);
    } else {
      current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(part);
    }
  }
  return current as FileSystemFileHandle;
}

// Lazy load renderers to minimize bundle size
const ObsidianMarkdownViewer = dynamic(
  () => import("@/components/editor/obsidian-markdown-viewer").then((mod) => mod.ObsidianMarkdownViewer),
  { loading: () => <LoadingState message="Loading viewer..." />, ssr: false }
);

const MarkdownRenderer = dynamic(
  () => import("@/components/renderers/markdown-renderer").then((mod) => mod.MarkdownRenderer),
  { loading: () => <LoadingState message="Loading Markdown renderer..." />, ssr: false }
);

const PDFViewer = dynamic(
  () => import("@/components/renderers/pdf-viewer").then((mod) => mod.PDFViewer),
  { loading: () => <LoadingState message="Loading PDF viewer..." />, ssr: false }
);

// PDF Highlighter Adapter for annotation support
const PDFHighlighterAdapter = dynamic(
  () => import("@/components/renderers/pdf-highlighter-adapter").then((mod) => mod.PDFHighlighterAdapter),
  { loading: () => <LoadingState message="Loading PDF viewer with annotations..." />, ssr: false }
);

const JupyterRenderer = dynamic(
  () => import("@/components/renderers/jupyter-renderer").then((mod) => mod.JupyterRenderer),
  { loading: () => <LoadingState message="Loading Jupyter renderer..." />, ssr: false }
);

const NotebookEditor = dynamic(
  () => import("@/components/notebook/notebook-editor").then((mod) => mod.NotebookEditor),
  { loading: () => <LoadingState message="Loading notebook editor..." />, ssr: false }
);

const CodeReader = dynamic(
  () => import("@/components/renderers/code-reader").then((mod) => mod.CodeReader),
  { loading: () => <LoadingState message="Loading code reader..." />, ssr: false }
);

const WordViewer = dynamic(
  () => import("@/components/renderers/word-viewer").then((mod) => mod.WordViewer),
  { loading: () => <LoadingState message="Loading Word viewer..." />, ssr: false }
);

const PowerPointViewer = dynamic(
  () => import("@/components/renderers/powerpoint-viewer").then((mod) => mod.PowerPointViewer),
  { loading: () => <LoadingState message="Loading PowerPoint viewer..." />, ssr: false }
);

const HTMLViewer = dynamic(
  () => import("@/components/renderers/html-viewer").then((mod) => mod.HTMLViewer),
  { loading: () => <LoadingState message="Loading HTML viewer..." />, ssr: false }
);

const ImageViewer = dynamic(
  () => import("@/components/renderers/image-viewer").then((mod) => mod.ImageViewer),
  { loading: () => <LoadingState message="Loading image viewer..." />, ssr: false }
);

// Image Tldraw Adapter for annotation support
const ImageTldrawAdapter = dynamic(
  () => import("@/components/renderers/image-tldraw-adapter").then((mod) => mod.ImageTldrawAdapter),
  { loading: () => <LoadingState message="Loading image editor..." />, ssr: false }
);

const UnsupportedFile = dynamic(
  () => import("@/components/renderers/unsupported-file").then((mod) => mod.UnsupportedFile),
  { loading: () => <LoadingState message="Loading..." />, ssr: false }
);

// CodeEditorViewer for editable code files (Requirements 4.1-4.4)
const CodeEditorViewer = dynamic(
  () => import("@/components/renderers/code-editor-viewer").then((mod) => mod.CodeEditorViewer),
  { loading: () => <LoadingState message="Loading code editor..." />, ssr: false }
);

// HandwritingViewer for handwriting note files
const HandwritingViewer = dynamic(
  () => import("@/components/renderers/handwriting-viewer").then((mod) => mod.HandwritingViewer),
  { loading: () => <LoadingState message="Loading handwriting editor..." />, ssr: false }
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
}: {
  content: string | ArrayBuffer;
  fileName: string;
  rendererType: RendererType;
  fileHandle?: FileSystemFileHandle;
  rootHandle?: FileSystemDirectoryHandle | null;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  fileId?: string;
  filePath?: string;
  onNavigateToFile?: (target: string) => void;
}) {
  const extension = getFileExtension(fileName);
  const viewerKey = fileId || fileName;
  
  switch (rendererType) {
    case "markdown": {
      // Ensure content is a string for markdown/text editors
      let textContent: string;
      if (content instanceof ArrayBuffer) {
        // Check if it's binary data first
        const bytes = new Uint8Array(content);
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
                This file appears to contain binary data, not text.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                File: {fileName}
              </p>
            </div>
          );
        }

        // Use non-fatal decoder to avoid throwing errors
        const decoder = new TextDecoder('utf-8', { fatal: false });
        textContent = decoder.decode(content);
      } else {
        textContent = content;
      }

      // Normalize content: convert HTML to Markdown, fix LaTeX delimiters, etc.
      const normalizedContent = normalizeScientificText(textContent);

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
            rootHandle={rootHandle}
            filePath={filePath}
          />
        );
      }
      // Fallback to read-only renderer if no onChange handler
      return <MarkdownRenderer key={viewerKey} content={normalizedContent} fileName={fileName} />;
    }
    case "pdf":
      // Use PDFHighlighterAdapter if we have file handles for annotation support
      if (fileHandle && rootHandle) {
        return (
          <PDFHighlighterAdapter
            content={content as ArrayBuffer}
            fileName={fileName}
            fileHandle={fileHandle}
            rootHandle={rootHandle}
          />
        );
      }
      // Fallback to basic PDF viewer
      return <PDFViewer content={content as ArrayBuffer} fileName={fileName} />;
    case "jupyter": {
      // Ensure content is a string for notebook editors
      let notebookContent: string;
      if (content instanceof ArrayBuffer) {
        console.warn('[FileViewer] Jupyter received ArrayBuffer, converting to string');
        try {
          notebookContent = new TextDecoder('utf-8').decode(content);
        } catch (e) {
          console.error('[FileViewer] Failed to decode ArrayBuffer:', e);
          notebookContent = '{}';
        }
      } else {
        notebookContent = content;
      }

      // Use NotebookEditor for editable notebooks
      if (onContentChange) {
        return (
          <NotebookEditor
            content={notebookContent}
            fileName={fileName}
            onContentChange={onContentChange}
            onSave={onSave}
          />
        );
      }
      // Fallback to read-only renderer
      return <JupyterRenderer content={notebookContent} fileName={fileName} />;
    }
    case "code": {
      // Ensure content is a string for code editors
      let codeContent: string;
      if (content instanceof ArrayBuffer) {
        console.warn('[FileViewer] Code received ArrayBuffer, converting to string');
        try {
          codeContent = new TextDecoder('utf-8').decode(content);
        } catch (e) {
          console.error('[FileViewer] Failed to decode ArrayBuffer:', e);
          codeContent = '';
        }
      } else {
        codeContent = content;
      }

      // Use CodeEditorViewer for editable code files (Requirements 4.1-4.4)
      if (onContentChange && isEditableCodeFile(extension)) {
        return (
          <CodeEditorViewer
            content={codeContent}
            fileName={fileName}
            onContentChange={onContentChange}
            onSave={onSave}
          />
        );
      }
      // Fallback to read-only CodeReader for non-editable code files
      return <CodeReader content={codeContent} fileName={fileName} />;
    }
    case "word":
      return <WordViewer content={content as ArrayBuffer} fileName={fileName} />;
    case "powerpoint":
      return <PowerPointViewer content={content as ArrayBuffer} fileName={fileName} />;
    case "html": {
      // Ensure content is a string for HTML viewer
      let htmlContent: string;
      if (content instanceof ArrayBuffer) {
        console.warn('[FileViewer] HTML received ArrayBuffer, converting to string');
        try {
          htmlContent = new TextDecoder('utf-8').decode(content);
        } catch (e) {
          console.error('[FileViewer] Failed to decode ArrayBuffer:', e);
          htmlContent = '';
        }
      } else {
        htmlContent = content;
      }
      return <HTMLViewer content={htmlContent} fileName={fileName} />;
    }
    case "image":
      // Use ImageTldrawAdapter if we have file handles for annotation support
      if (fileHandle && rootHandle) {
        return (
          <ImageTldrawAdapter
            key={viewerKey}
            content={content as ArrayBuffer}
            fileName={fileName}
            mimeType={getImageMimeType(extension)}
            fileHandle={fileHandle}
            rootHandle={rootHandle}
          />
        );
      }
      // Fallback to basic image viewer
      return <ImageViewer key={viewerKey} content={content as ArrayBuffer} fileName={fileName} mimeType={getImageMimeType(extension)} />;
    case "handwriting": {
      // Ensure content is a string for handwriting editor
      let handwritingContent: string;
      if (content instanceof ArrayBuffer) {
        try {
          handwritingContent = new TextDecoder('utf-8').decode(content);
        } catch (e) {
          console.error('[FileViewer] Failed to decode ArrayBuffer:', e);
          handwritingContent = '';
        }
      } else {
        handwritingContent = content;
      }
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
  content: string | ArrayBuffer | null;
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
  // paneId is kept for future use (e.g., pane-specific settings)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);

  const handleNavigateToFile = async (target: string) => {
    const decodedTarget = safeDecode(target.trim());
    if (!decodedTarget) return;

    if (isExternalUrl(decodedTarget)) {
      window.open(decodedTarget, "_blank", "noopener,noreferrer");
      return;
    }

    const { path, heading } = splitLinkTarget(decodedTarget);
    if (!path) {
      // Heading-only navigation is handled by the markdown viewer.
      if (heading) return;
      return;
    }

    if (!rootHandle) return;

    const resolvedPath = path.startsWith("/")
      ? normalizePath(path.slice(1))
      : filePath
        ? resolveRelativePath(filePath, path)
        : normalizePath(path);

    const candidatePaths: string[] = [];
    if (resolvedPath) {
      candidatePaths.push(resolvedPath);
      if (!hasFileExtension(resolvedPath)) {
        candidatePaths.push(`${resolvedPath}.md`);
      }
    }

    for (const candidate of candidatePaths) {
      try {
        const resolvedHandle = await resolveFileHandle(rootHandle, candidate);
        openFileInActivePane(resolvedHandle, candidate);
        return;
      } catch {
        // try next candidate
      }
    }

    console.warn("Failed to resolve link target:", decodedTarget);
  };
  // No file selected - show empty placeholder
  if (!handle) {
    return <EmptyPanePlaceholder />;
  }

  // Loading state
  if (isLoading) {
    return <LoadingState message="Reading file..." />;
  }

  // Error state
  if (error) {
    return <ErrorState error={error} />;
  }

  // No content yet (shouldn't happen if not loading/error, but handle gracefully)
  if (!content) {
    return <LoadingState message="Preparing content..." />;
  }

  const fileName = handle.name;
  const extension = getFileExtension(fileName);
  const rendererType = getRendererForExtension(extension);

  return (
    <div className="h-full overflow-auto bg-background">
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
      />
    </div>
  );
}
