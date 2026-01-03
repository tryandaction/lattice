"use client";

/**
 * Image Tldraw Adapter
 * 
 * Provides non-destructive drawing on images using Tldraw.
 * Shapes are stored in the annotation sidecar JSON, not the image file.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Tldraw,
  Editor,
  TLShapeId,
  createShapeId,
  TLAssetId,
  AssetRecordType,
  TLImageShape,
} from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import {
  ZoomIn,
  ZoomOut,
  Loader2,
  Undo2,
  Redo2,
  Trash2,
  Download,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationSystem } from "@/hooks/use-annotation-system";
import { useAnnotationNavigation } from "@/hooks/use-annotation-navigation";
import {
  serializeShapes,
  deserializeShapes,
  calculateShapesBoundingBox,
  isValidTldrawShapeData,
  type TldrawShape,
  type TldrawShapeData,
} from "@/lib/tldraw-serialization";
import type { AnnotationItem, ImageTarget } from "@/types/universal-annotation";
import { ImageViewer } from "./image-viewer";

// ============================================================================
// Types
// ============================================================================

interface ImageTldrawAdapterProps {
  content: ArrayBuffer;
  fileName: string;
  mimeType: string;
  fileHandle: FileSystemFileHandle;
  rootHandle: FileSystemDirectoryHandle;
}

// Debounce delay for saving shapes (ms)
const SAVE_DEBOUNCE_MS = 500;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Converts Tldraw editor shapes to our serialization format
 */
function editorShapesToTldrawShapes(editor: Editor): TldrawShape[] {
  const shapes = editor.getCurrentPageShapes();
  
  return shapes
    .filter(shape => shape.type !== 'image') // Exclude background image
    .map(shape => ({
      id: shape.id,
      type: shape.type,
      x: shape.x,
      y: shape.y,
      props: shape.props as Record<string, unknown>,
      rotation: shape.rotation,
      isLocked: shape.isLocked,
      opacity: shape.opacity,
    }));
}

/**
 * Creates an annotation from Tldraw shapes
 */
function createImageAnnotation(
  shapes: TldrawShape[],
  imageWidth: number,
  imageHeight: number,
  author: string
): Omit<AnnotationItem, 'id' | 'createdAt'> | null {
  if (shapes.length === 0) return null;
  
  const serialized = serializeShapes(shapes, imageWidth, imageHeight);
  const bbox = calculateShapesBoundingBox(serialized.shapes);
  
  if (!bbox) return null;
  
  return {
    target: {
      type: 'image',
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height,
    } as ImageTarget,
    style: {
      color: '#000000',
      type: 'ink',
    },
    content: JSON.stringify(serialized),
    author,
  };
}

/**
 * Extracts Tldraw shapes from annotation content
 */
function extractShapesFromAnnotation(
  annotation: AnnotationItem,
  canvasWidth: number,
  canvasHeight: number
): TldrawShape[] {
  if (!annotation.content) return [];
  
  try {
    const data = JSON.parse(annotation.content);
    if (!isValidTldrawShapeData(data)) return [];
    return deserializeShapes(data, canvasWidth, canvasHeight);
  } catch {
    return [];
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function ImageTldrawAdapter({
  content,
  fileName,
  mimeType,
  fileHandle,
  rootHandle,
}: ImageTldrawAdapterProps) {
  const {
    annotations,
    isLoading: annotationsLoading,
    error: annotationsError,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    getAnnotationsByTarget,
  } = useAnnotationSystem({
    fileHandle,
    rootHandle,
    fileType: 'image',
    author: 'user',
  });

  const [editor, setEditor] = useState<Editor | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [isReady, setIsReady] = useState(false);
  const [tldrawError, setTldrawError] = useState<Error | null>(null);
  const [highlightedRegion, setHighlightedRegion] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAnnotationIdRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);

  // Create blob URL from ArrayBuffer
  useEffect(() => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    setImageUrl(url);

    // Load image to get dimensions
    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      setTldrawError(new Error('Failed to load image'));
    };
    img.src = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [content, mimeType]);

  // Navigation handler
  useAnnotationNavigation({
    handlers: {
      onImageNavigate: (x, y, width, height, annotationId) => {
        setHighlightedRegion({ x, y, width, height });
        
        // Pan to the region if editor is available
        if (editor && imageSize.width > 0) {
          const centerX = (x + width / 2) / 100 * imageSize.width;
          const centerY = (y + height / 2) / 100 * imageSize.height;
          editor.centerOnPoint({ x: centerX, y: centerY });
        }
        
        setTimeout(() => setHighlightedRegion(null), 3000);
      },
    },
  });

  // Find existing image annotation
  const imageAnnotation = useMemo(() => {
    const imageAnnotations = getAnnotationsByTarget('image');
    return imageAnnotations.find(a => a.content && a.content.includes('"version":1'));
  }, [annotations, getAnnotationsByTarget]);

  // Store current annotation ID
  useEffect(() => {
    currentAnnotationIdRef.current = imageAnnotation?.id || null;
  }, [imageAnnotation]);

  // Handle editor mount
  const handleMount = useCallback((editorInstance: Editor) => {
    setEditor(editorInstance);
  }, []);

  // Set up background image when editor and image are ready
  useEffect(() => {
    if (!editor || !imageUrl || imageSize.width === 0) return;

    try {
      // Create asset for background image
      const assetId: TLAssetId = AssetRecordType.createId('background-image');
      
      editor.createAssets([{
        id: assetId,
        type: 'image',
        typeName: 'asset',
        props: {
          name: fileName,
          src: imageUrl,
          w: imageSize.width,
          h: imageSize.height,
          mimeType: mimeType,
          isAnimated: false,
        },
        meta: {},
      }]);

      // Create image shape as background
      const shapeId: TLShapeId = createShapeId('background');
      
      editor.createShape<TLImageShape>({
        id: shapeId,
        type: 'image',
        x: 0,
        y: 0,
        isLocked: true,
        props: {
          assetId,
          w: imageSize.width,
          h: imageSize.height,
        },
      });

      // Send to back and lock
      editor.sendToBack([shapeId]);

      // Zoom to fit
      editor.zoomToFit();
      
      setIsReady(true);
    } catch (err) {
      console.error('Failed to set up Tldraw canvas:', err);
      setTldrawError(err instanceof Error ? err : new Error('Failed to initialize canvas'));
    }
  }, [editor, imageUrl, imageSize, fileName, mimeType]);

  // Restore shapes from annotation when ready
  useEffect(() => {
    if (!editor || !isReady || !imageAnnotation || imageSize.width === 0) return;
    if (isRestoringRef.current) return;
    
    isRestoringRef.current = true;
    
    try {
      const shapes = extractShapesFromAnnotation(
        imageAnnotation,
        imageSize.width,
        imageSize.height
      );
      
      if (shapes.length > 0) {
        // Create shapes in editor
        shapes.forEach(shape => {
          editor.createShape({
            id: shape.id as TLShapeId,
            type: shape.type,
            x: shape.x,
            y: shape.y,
            props: shape.props,
            rotation: shape.rotation,
            isLocked: shape.isLocked,
            opacity: shape.opacity,
          });
        });
      }
    } catch (err) {
      console.error('Failed to restore shapes:', err);
    } finally {
      isRestoringRef.current = false;
    }
  }, [editor, isReady, imageAnnotation, imageSize]);

  // Debounced save function
  const saveShapes = useCallback(() => {
    if (!editor || imageSize.width === 0 || isRestoringRef.current) return;
    
    const shapes = editorShapesToTldrawShapes(editor);
    
    if (shapes.length === 0) {
      // Delete annotation if no shapes
      if (currentAnnotationIdRef.current) {
        deleteAnnotation(currentAnnotationIdRef.current);
        currentAnnotationIdRef.current = null;
      }
      return;
    }
    
    const annotationData = createImageAnnotation(
      shapes,
      imageSize.width,
      imageSize.height,
      'user'
    );
    
    if (!annotationData) return;
    
    if (currentAnnotationIdRef.current) {
      // Update existing annotation
      updateAnnotation(currentAnnotationIdRef.current, annotationData);
    } else {
      // Create new annotation
      const newId = addAnnotation(annotationData);
      currentAnnotationIdRef.current = newId;
    }
  }, [editor, imageSize, addAnnotation, updateAnnotation, deleteAnnotation]);

  // Subscribe to store changes
  useEffect(() => {
    if (!editor || !isReady) return;
    
    const unsubscribe = editor.store.listen(() => {
      if (isRestoringRef.current) return;
      
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Schedule save
      saveTimeoutRef.current = setTimeout(saveShapes, SAVE_DEBOUNCE_MS);
    }, { source: 'user', scope: 'document' });
    
    return () => {
      unsubscribe();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editor, isReady, saveShapes]);

  // Toolbar actions
  const handleZoomIn = () => editor?.zoomIn();
  const handleZoomOut = () => editor?.zoomOut();
  const handleUndo = () => editor?.undo();
  const handleRedo = () => editor?.redo();
  
  const handleClearAll = () => {
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes()
      .filter(s => s.type !== 'image')
      .map(s => s.id);
    if (shapes.length > 0) {
      editor.deleteShapes(shapes);
    }
  };

  const handleDownload = () => {
    if (imageUrl) {
      const a = document.createElement('a');
      a.href = imageUrl;
      a.download = fileName;
      a.click();
    }
  };

  // Error fallback
  if (tldrawError) {
    return (
      <div className="flex flex-col h-full">
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Drawing tools unavailable: {tldrawError.message}
        </div>
        <ImageViewer content={content} fileName={fileName} mimeType={mimeType} />
      </div>
    );
  }

  // Loading state
  if (!imageUrl || imageSize.width === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading image...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground truncate max-w-xs">
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground">
            {imageSize.width} × {imageSize.height}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleUndo}
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRedo}
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>

          <div className="mx-2 h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleZoomOut}
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleZoomIn}
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>

          <div className="mx-2 h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={handleClearAll}
            title="Clear all drawings"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDownload}
            title="Download original image"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Drawing hint */}
      <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800 px-4 py-1 text-xs text-blue-700 dark:text-blue-300">
        Use the toolbar on the left to draw. Your drawings are saved automatically.
      </div>

      {/* Tldraw Canvas */}
      <div className="flex-1 relative">
        <Tldraw
          onMount={handleMount}
          inferDarkMode
          hideUi={false}
          components={{
            // Hide some UI elements we don't need
            PageMenu: null,
            MainMenu: null,
            DebugMenu: null,
            DebugPanel: null,
          }}
        />
        
        {/* Highlight overlay for navigation */}
        {highlightedRegion && isReady && (
          <div
            className="absolute pointer-events-none border-2 border-primary bg-primary/20 animate-pulse z-50"
            style={{
              left: `${highlightedRegion.x}%`,
              top: `${highlightedRegion.y}%`,
              width: `${highlightedRegion.width}%`,
              height: `${highlightedRegion.height}%`,
            }}
          />
        )}
      </div>

      {annotationsError && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border-t border-yellow-200 dark:border-yellow-800 px-4 py-1 text-xs text-yellow-700 dark:text-yellow-300">
          Warning: {annotationsError}
        </div>
      )}
    </div>
  );
}

export default ImageTldrawAdapter;
