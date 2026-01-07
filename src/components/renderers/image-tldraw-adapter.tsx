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
  TLShape,
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
  MousePointer2,
  Pencil,
  Square,
  Type,
  Minus,
  ArrowRight,
  Eraser,
  Hand,
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

const SAVE_DEBOUNCE_MS = 500;

// ============================================================================
// Utility Functions
// ============================================================================

function editorShapesToTldrawShapes(editor: Editor): TldrawShape[] {
  const shapes = editor.getCurrentPageShapes();
  return shapes
    .filter(shape => shape.type !== 'image')
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
    style: { color: '#000000', type: 'ink' },
    content: JSON.stringify(serialized),
    author,
  };
}

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
  const [currentTool, setCurrentTool] = useState('select');
  const [highlightedRegion, setHighlightedRegion] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAnnotationIdRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  const imageSetupDoneRef = useRef(false);

  // Create data URL from ArrayBuffer
  useEffect(() => {
    const blob = new Blob([content], { type: mimeType });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageUrl(dataUrl);
      const img = new Image();
      img.onload = () => setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => setTldrawError(new Error('Failed to load image'));
      img.src = dataUrl;
    };
    reader.onerror = () => setTldrawError(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  }, [content, mimeType]);

  // Navigation handler
  useAnnotationNavigation({
    handlers: {
      onImageNavigate: (x, y, width, height) => {
        setHighlightedRegion({ x, y, width, height });
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

  useEffect(() => {
    currentAnnotationIdRef.current = imageAnnotation?.id || null;
  }, [imageAnnotation]);

  // Handle editor mount
  const handleMount = useCallback((editorInstance: Editor) => {
    setEditor(editorInstance);
    imageSetupDoneRef.current = false;
    
    // Listen for tool changes
    editorInstance.store.listen(() => {
      setCurrentTool(editorInstance.getCurrentToolId());
    }, { source: 'user', scope: 'session' });

    // Protect background from selection (Bug 1 fix)
    const backgroundId = createShapeId('background');
    editorInstance.store.listen(() => {
      const selectedIds = editorInstance.getSelectedShapeIds();
      if (selectedIds.includes(backgroundId)) {
        // Remove background from selection
        editorInstance.setSelectedShapes(selectedIds.filter(id => id !== backgroundId));
      }
    }, { source: 'user', scope: 'session' });

    // Override deleteShapes to protect background (Bug 1 fix)
    const originalDeleteShapes = editorInstance.deleteShapes.bind(editorInstance);
    editorInstance.deleteShapes = (shapesOrIds: TLShapeId[] | TLShape[]) => {
      // Convert to IDs if shapes were passed
      const ids = shapesOrIds.map(item => 
        typeof item === 'string' ? item : (item as TLShape).id
      );
      const filteredIds = ids.filter(id => id !== backgroundId);
      if (filteredIds.length !== ids.length) {
        console.warn('[ImageTldraw] Prevented background deletion');
      }
      if (filteredIds.length === 0) return editorInstance;
      return originalDeleteShapes(filteredIds);
    };
  }, []);

  // Set up background image
  useEffect(() => {
    if (!editor || !imageUrl || imageSize.width === 0 || imageSetupDoneRef.current) return;

    const timer = setTimeout(() => {
      try {
        const existingShapes = editor.getCurrentPageShapes();
        const hasBackground = existingShapes.some(s => s.id === createShapeId('background'));
        if (hasBackground) {
          imageSetupDoneRef.current = true;
          setIsReady(true);
          return;
        }

        const assetId: TLAssetId = AssetRecordType.createId('background-image');
        const existingAsset = editor.getAsset(assetId);
        if (!existingAsset) {
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
        }

        const shapeId: TLShapeId = createShapeId('background');
        editor.createShape<TLImageShape>({
          id: shapeId,
          type: 'image',
          x: 0,
          y: 0,
          isLocked: true,
          props: { assetId, w: imageSize.width, h: imageSize.height },
        });

        editor.sendToBack([shapeId]);
        editor.zoomToFit();
        
        imageSetupDoneRef.current = true;
        setIsReady(true);
      } catch (err) {
        console.error('Failed to set up Tldraw canvas:', err);
        setTldrawError(err instanceof Error ? err : new Error('Failed to initialize canvas'));
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [editor, imageUrl, imageSize, fileName, mimeType]);

  // Restore shapes from annotation
  useEffect(() => {
    if (!editor || !isReady || !imageAnnotation || imageSize.width === 0) return;
    if (isRestoringRef.current) return;
    
    isRestoringRef.current = true;
    try {
      const shapes = extractShapesFromAnnotation(imageAnnotation, imageSize.width, imageSize.height);
      if (shapes.length > 0) {
        shapes.forEach(shape => {
          const existing = editor.getShape(shape.id as TLShapeId);
          if (!existing) {
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
          }
        });
      }
    } catch (err) {
      console.error('Failed to restore shapes:', err);
    } finally {
      isRestoringRef.current = false;
    }
  }, [editor, isReady, imageAnnotation, imageSize]);

  // Debounced save
  const saveShapes = useCallback(() => {
    if (!editor || imageSize.width === 0 || isRestoringRef.current) return;
    const shapes = editorShapesToTldrawShapes(editor);
    
    if (shapes.length === 0) {
      if (currentAnnotationIdRef.current) {
        deleteAnnotation(currentAnnotationIdRef.current);
        currentAnnotationIdRef.current = null;
      }
      return;
    }
    
    const annotationData = createImageAnnotation(shapes, imageSize.width, imageSize.height, 'user');
    if (!annotationData) return;
    
    if (currentAnnotationIdRef.current) {
      updateAnnotation(currentAnnotationIdRef.current, annotationData);
    } else {
      const newId = addAnnotation(annotationData);
      currentAnnotationIdRef.current = newId;
    }
  }, [editor, imageSize, addAnnotation, updateAnnotation, deleteAnnotation]);

  // Subscribe to store changes
  useEffect(() => {
    if (!editor || !isReady) return;

    const unsubscribe = editor.store.listen(() => {
      if (isRestoringRef.current) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(saveShapes, SAVE_DEBOUNCE_MS);
    }, { source: 'user', scope: 'document' });

    return () => {
      unsubscribe();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [editor, isReady, saveShapes]);

  // Background image existence check and auto-recovery
  // This ensures the background image is recreated if it gets lost during operations
  useEffect(() => {
    if (!editor || !isReady || !imageUrl || imageSize.width === 0) return;

    const checkBackgroundExists = () => {
      try {
        const shapes = editor.getCurrentPageShapes();
        const backgroundId = createShapeId('background');
        const hasBackground = shapes.some(s => s.id === backgroundId);

        if (!hasBackground) {
          console.warn('[ImageTldraw] Background image lost, recreating...');
          imageSetupDoneRef.current = false;

          // Recreate the background
          const assetId: TLAssetId = AssetRecordType.createId('background-image');
          const existingAsset = editor.getAsset(assetId);

          if (!existingAsset) {
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
          }

          editor.createShape<TLImageShape>({
            id: backgroundId,
            type: 'image',
            x: 0,
            y: 0,
            isLocked: true,
            props: { assetId, w: imageSize.width, h: imageSize.height },
          });

          editor.sendToBack([backgroundId]);
          imageSetupDoneRef.current = true;
        }
      } catch (err) {
        console.error('[ImageTldraw] Error checking/recreating background:', err);
      }
    };

    // Check periodically and after any store change
    const interval = setInterval(checkBackgroundExists, 2000);

    // Also listen to store changes for immediate recovery
    const unsubscribe = editor.store.listen(() => {
      // Debounce the check slightly to avoid excessive calls
      setTimeout(checkBackgroundExists, 100);
    }, { source: 'all', scope: 'document' });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [editor, isReady, imageUrl, imageSize, fileName, mimeType]);

  // Tool handlers
  const setTool = (toolId: string) => editor?.setCurrentTool(toolId);
  const handleZoomIn = () => editor?.zoomIn();
  const handleZoomOut = () => editor?.zoomOut();
  const handleUndo = () => editor?.undo();
  const handleRedo = () => editor?.redo();
  
  const handleClearAll = () => {
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes().filter(s => s.type !== 'image').map(s => s.id);
    if (shapes.length > 0) editor.deleteShapes(shapes);
  };

  const handleDownload = () => {
    if (imageUrl) {
      const a = document.createElement('a');
      a.href = imageUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
      {/* Unified Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-2 py-1.5 gap-2 flex-wrap">
        {/* Left: File info */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-muted-foreground truncate max-w-[150px]">{fileName}</span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{imageSize.width} × {imageSize.height}</span>
        </div>

        {/* Center: Drawing Tools */}
        <div className="flex items-center gap-0.5">
          <Button variant={currentTool === 'select' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('select')} title="Select (V)">
            <MousePointer2 className="h-4 w-4" />
          </Button>
          <Button variant={currentTool === 'hand' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('hand')} title="Hand (H)">
            <Hand className="h-4 w-4" />
          </Button>
          
          <div className="mx-1 h-4 w-px bg-border" />
          
          <Button variant={currentTool === 'draw' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('draw')} title="Draw (D)">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant={currentTool === 'eraser' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('eraser')} title="Eraser (E)">
            <Eraser className="h-4 w-4" />
          </Button>
          
          <div className="mx-1 h-4 w-px bg-border" />
          
          <Button variant={currentTool === 'geo' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('geo')} title="Rectangle (R)">
            <Square className="h-4 w-4" />
          </Button>
          <Button variant={currentTool === 'line' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('line')} title="Line (L)">
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant={currentTool === 'arrow' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('arrow')} title="Arrow (A)">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant={currentTool === 'text' ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool('text')} title="Text (T)">
            <Type className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleUndo} title="Undo">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRedo} title="Redo">
            <Redo2 className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={handleClearAll} title="Clear all">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="Download">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tldraw Canvas - Hide default UI */}
      <div className="flex-1 relative">
        <Tldraw onMount={handleMount} inferDarkMode hideUi={true} />
        
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