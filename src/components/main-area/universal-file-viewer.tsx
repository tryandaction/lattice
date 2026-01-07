"use client";

import { useState, useCallback } from "react";
import { Loader2, AlertCircle, FileQuestion, Edit3, Eye } from "lucide-react";
import { getRendererForExtension, getFileExtension, getImageMimeType, RendererType, isEditableCodeFile } from "@/lib/file-utils";
import dynamic from "next/dynamic";
import type { PaneId } from "@/stores/workspace-store";

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

// Lazy load renderers to minimize bundle size
const AdvancedMarkdownEditor = dynamic(
  () => import("@/components/editor/advanced-markdown-editor").then((mod) => mod.AdvancedMarkdownEditor),
  { loading: () => <LoadingState message="Loading editor..." />, ssr: false }
);

const ObsidianMarkdownViewer = dynamic(
  () => import("@/components/editor/obsidian-markdown-viewer").then((mod) => mod.ObsidianMarkdownViewer),
  { loading: () => <LoadingState message="Loading viewer..." />, ssr: false }
);

const TiptapEditor = dynamic(
  () => import("@/components/renderers/tiptap-editor").then((mod) => mod.TiptapEditor),
  { loading: () => <LoadingState message="Loading editor..." />, ssr: false }
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
}: {
  content: string | ArrayBuffer;
  fileName: string;
  rendererType: RendererType;
  fileHandle?: FileSystemFileHandle;
  rootHandle?: FileSystemDirectoryHandle | null;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
}) {
  const extension = getFileExtension(fileName);
  
  switch (rendererType) {
    case "markdown": {
      // Ensure content is a string for markdown/text editors
      let textContent: string;
      if (content instanceof ArrayBuffer) {
        console.warn('[FileViewer] Markdown received ArrayBuffer, converting to string');
        try {
          textContent = new TextDecoder('utf-8').decode(content);
        } catch (e) {
          console.error('[FileViewer] Failed to decode ArrayBuffer:', e);
          textContent = '';
        }
      } else {
        textContent = content;
      }

      // Use ObsidianMarkdownViewer for Obsidian-like experience (default render, click to edit)
      if (onContentChange) {
        return (
          <ObsidianMarkdownViewer
            content={textContent}
            onChange={onContentChange}
            fileName={fileName}
            onSave={onSave}
          />
        );
      }
      // Fallback to read-only renderer if no onChange handler
      return <MarkdownRenderer content={textContent} fileName={fileName} />;
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
            content={content as ArrayBuffer}
            fileName={fileName}
            mimeType={getImageMimeType(extension)}
            fileHandle={fileHandle}
            rootHandle={rootHandle}
          />
        );
      }
      // Fallback to basic image viewer
      return <ImageViewer content={content as ArrayBuffer} fileName={fileName} mimeType={getImageMimeType(extension)} />;
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
}: UniversalFileViewerProps) {
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
      />
    </div>
  );
}
