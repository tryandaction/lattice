"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Download,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Loader2,
  Move,
  RotateCw,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useAnnotationNavigation } from "../../hooks/use-annotation-navigation";
import { useObjectUrl } from "@/hooks/use-object-url";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { CommandBarState, PaneId } from "@/types/layout";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import { exportFile } from "@/lib/export-adapter";
import {
  buildEditPreviewState,
  buildExportOperationsFromPreview,
  exportEditedBlobFromSourceBlob,
  saveImageCopyToWorkspace,
} from "@/lib/image-editor";
import type { ImageEditOperation } from "@/lib/image-editor";
import type { BinaryViewerContent } from "@/types/viewer-content";

interface ImageViewerProps {
  source: BinaryViewerContent;
  fileName: string;
  mimeType: string;
  paneId?: PaneId;
  filePath?: string;
  rootHandle?: FileSystemDirectoryHandle | null;
}

type FitMode = "fit" | "width" | "height" | "actual";
type ExportMimeType = "image/png" | "image/jpeg" | "image/webp";

interface ImageAdjustState {
  brightness: number;
  contrast: number;
}

interface ImageCropMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const EMPTY_CROP_MARGINS: ImageCropMargins = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

/**
 * Image Viewer component
 * Displays images with zoom, rotate, pan, and fullscreen controls
 * Optimized for large images and long images
 */
export function ImageViewer({ source, fileName, mimeType, paneId, filePath, rootHandle }: ImageViewerProps) {
  const { t } = useI18n();
  const bufferSource = source.kind === "buffer" ? source.data : null;
  const imageBlob = useMemo(
    () => (bufferSource ? new Blob([bufferSource], { type: mimeType }) : null),
    [bufferSource, mimeType],
  );
  const generatedImageUrl = useObjectUrl(imageBlob);
  const imageUrl = source.kind === "desktop-url" ? source.url : generatedImageUrl;
  const [manualZoom, setManualZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [fitMode, setFitMode] = useState<FitMode>("fit");
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isEditTrayOpen, setIsEditTrayOpen] = useState(false);
  const [editOperations, setEditOperations] = useState<ImageEditOperation[]>([]);
  const [adjustments, setAdjustments] = useState<ImageAdjustState>({
    brightness: 0,
    contrast: 0,
  });
  const [cropMargins, setCropMargins] = useState<ImageCropMargins>(EMPTY_CROP_MARGINS);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [isExportingEdit, setIsExportingEdit] = useState(false);
  const [editExportError, setEditExportError] = useState<string | null>(null);
  const [isComparingOriginal, setIsComparingOriginal] = useState(false);
  const [lastExportedFileName, setLastExportedFileName] = useState<string | null>(null);
  const [highlightedRegion, setHighlightedRegion] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const persistedViewStateKey = buildPersistedFileViewStateKey({
    kind: "image",
    workspaceKey,
    workspaceRootPath,
    filePath,
    fallbackName: fileName,
  });

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) {
      return;
    }

    const updateContainerSize = () => {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    const frameId = window.requestAnimationFrame(updateContainerSize);
    const observer = new ResizeObserver(updateContainerSize);
    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  // Universal annotation navigation support
  useAnnotationNavigation({
    handlers: {
      onImageNavigate: (x, y, width, height, _annotationId) => {
        // Highlight the region and pan to center it
        setHighlightedRegion({ x, y, width, height });
        
        // Calculate pan offset to center the region
        if (imageContainerRef.current && naturalSize.width > 0) {
          const container = imageContainerRef.current;
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight;
          
          // Convert percentage to pixel coordinates
          const regionCenterX = (x + width / 2) / 100 * naturalSize.width * zoom;
          const regionCenterY = (y + height / 2) / 100 * naturalSize.height * zoom;
          
          // Calculate offset to center the region
          const offsetX = containerWidth / 2 - regionCenterX;
          const offsetY = containerHeight / 2 - regionCenterY;
          
          setPanOffset({ x: offsetX, y: offsetY });
        }
        
        // Clear highlight after 3 seconds
        if (highlightTimeoutRef.current) {
          window.clearTimeout(highlightTimeoutRef.current);
        }
        highlightTimeoutRef.current = window.setTimeout(() => {
          setHighlightedRegion(null);
          highlightTimeoutRef.current = null;
        }, 3000);
      },
    },
  });

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  usePersistedViewState({
    storageKey: persistedViewStateKey,
    containerRef: imageContainerRef,
    viewState: {
      fitMode,
      manualZoom,
      rotation,
      panOffset,
    },
    applyViewState: (persisted) => {
      if (persisted?.fitMode === "fit" || persisted?.fitMode === "width" || persisted?.fitMode === "height" || persisted?.fitMode === "actual") {
        setFitMode(persisted.fitMode);
      }
      if (typeof persisted?.manualZoom === "number") {
        setManualZoom(persisted.manualZoom);
      }
      if (typeof persisted?.rotation === "number") {
        setRotation(persisted.rotation);
      }
      const nextPanOffset = persisted?.panOffset as { x?: number; y?: number } | undefined;
      if (typeof nextPanOffset?.x === "number" && typeof nextPanOffset?.y === "number") {
        setPanOffset({ x: nextPanOffset.x, y: nextPanOffset.y });
      }
    },
  });

  // Calculate fit zoom based on container and image size
  const calculateFitZoom = useCallback(() => {
    if (containerSize.width === 0 || containerSize.height === 0 || naturalSize.width === 0) return 1;
    
    const containerWidth = containerSize.width - 48; // padding
    const containerHeight = containerSize.height - 48;
    
    const { width, height } = naturalSize;
    
    // Account for rotation (swap dimensions for 90/270 degrees)
    const isRotated = rotation === 90 || rotation === 270;
    const effectiveWidth = isRotated ? height : width;
    const effectiveHeight = isRotated ? width : height;
    
    switch (fitMode) {
      case "fit":
        return Math.min(
          containerWidth / effectiveWidth,
          containerHeight / effectiveHeight,
          1 // Don't upscale small images
        );
      case "width":
        return containerWidth / effectiveWidth;
      case "height":
        return containerHeight / effectiveHeight;
      case "actual":
        return 1;
      default:
        return 1;
    }
  }, [containerSize.height, containerSize.width, naturalSize, fitMode, rotation]);
  const zoom = fitMode === "actual" ? manualZoom : calculateFitZoom();
  const adjustmentOperation = useMemo<ImageEditOperation | null>(() => {
    if (adjustments.brightness === 0 && adjustments.contrast === 0) {
      return null;
    }
    return {
      type: "adjust",
      brightness: adjustments.brightness,
      contrast: adjustments.contrast,
    };
  }, [adjustments.brightness, adjustments.contrast]);
  const cropOperation = useMemo<ImageEditOperation | null>(() => {
    if (!hasCropMargins(cropMargins)) {
      return null;
    }
    return {
      type: "crop",
      rect: cropMarginsToRect(cropMargins),
    };
  }, [cropMargins]);
  const effectiveEditOperations = useMemo(
    () => [
      ...(cropOperation ? [cropOperation] : []),
      ...editOperations,
      ...(adjustmentOperation ? [adjustmentOperation] : []),
    ],
    [adjustmentOperation, cropOperation, editOperations],
  );
  const hasEditOperations = effectiveEditOperations.length > 0;
  const editPreview = useMemo(
    () => buildEditPreviewState(effectiveEditOperations),
    [effectiveEditOperations],
  );
  const exportEditOperations = useMemo(
    () => buildExportOperationsFromPreview(editPreview),
    [editPreview],
  );
  const exportEditOperationCount = exportEditOperations.length;

  const handleImageLoad = () => {
    if (imageRef.current) {
      const { naturalWidth, naturalHeight } = imageRef.current;
      setNaturalSize({ width: naturalWidth, height: naturalHeight });
      
      // Auto-select best fit mode based on aspect ratio
      const aspectRatio = naturalHeight / naturalWidth;
      if (aspectRatio > 1.5 || aspectRatio < 0.67) {
        // Long image (tall or wide) - fit to width for consistent reading
        setFitMode("width");
      } else {
        setFitMode("fit");
      }
    }
  };

  const handleZoomIn = useCallback(() => {
    setManualZoom((z) => Math.min(z * 1.25, 10));
    setFitMode("actual"); // Switch to manual zoom mode
  }, []);
  
  const handleZoomOut = useCallback(() => {
    setManualZoom((z) => Math.max(z / 1.25, 0.05));
    setFitMode("actual");
  }, []);
  
  const handleRotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);
  
  const handleReset = useCallback(() => {
    setRotation(0);
    setFitMode("fit");
    setManualZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleFitMode = useCallback((mode: FitMode) => {
    setFitMode(mode);
    if (mode === "actual") {
      setManualZoom(1);
    }
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleDownload = useCallback(() => {
    if (imageUrl) {
      const a = document.createElement("a");
      a.href = imageUrl;
      a.download = fileName;
      a.click();
    }
  }, [fileName, imageUrl]);

  const handleToggleEditTray = useCallback(() => {
    setIsEditTrayOpen((open) => !open);
    setEditExportError(null);
  }, []);

  const handleAppendEditOperation = useCallback((operation: ImageEditOperation) => {
    setEditOperations((operations) => [...operations, operation]);
    setIsComparingOriginal(false);
    setEditExportError(null);
    setLastExportedFileName(null);
  }, []);

  const handleUndoEditOperation = useCallback(() => {
    setEditOperations((operations) => operations.slice(0, -1));
    setIsComparingOriginal(false);
    setEditExportError(null);
    setLastExportedFileName(null);
  }, []);

  const handleResetEdits = useCallback(() => {
    setEditOperations([]);
    setAdjustments({ brightness: 0, contrast: 0 });
    setCropMargins(EMPTY_CROP_MARGINS);
    setIsCropOpen(false);
    setIsComparingOriginal(false);
    setEditExportError(null);
    setLastExportedFileName(null);
  }, []);

  const handleAdjustmentChange = useCallback((key: keyof ImageAdjustState, value: number) => {
    setAdjustments((current) => ({
      ...current,
      [key]: value,
    }));
    setIsComparingOriginal(false);
    setEditExportError(null);
    setLastExportedFileName(null);
  }, []);

  const handleCropMarginChange = useCallback((key: keyof ImageCropMargins, value: number) => {
    setCropMargins((current) => normalizeCropMargins({
      ...current,
      [key]: value,
    }));
    setIsComparingOriginal(false);
    setEditExportError(null);
    setLastExportedFileName(null);
  }, []);

  const handleToggleOriginalCompare = useCallback(() => {
    if (!hasEditOperations) {
      setIsComparingOriginal(false);
      return;
    }
    setIsComparingOriginal((value) => !value);
  }, [hasEditOperations]);

  const getSourceBlobForEdit = useCallback(async () => {
    if (imageBlob) {
      return imageBlob;
    }
    if (!imageUrl) {
      throw new Error("Image source is unavailable");
    }
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error("Failed to load image source");
    }
    return response.blob();
  }, [imageBlob, imageUrl]);

  const handleExportEditedCopy = useCallback(async () => {
    if (!hasEditOperations || isExportingEdit) {
      return;
    }

    setIsExportingEdit(true);
    setEditExportError(null);

    try {
      const sourceBlob = await getSourceBlobForEdit();
      const exportMimeType = getExportMimeType(mimeType);
      const editedBlob = await exportEditedBlobFromSourceBlob({
        sourceBlob,
        operations: exportEditOperations,
        mimeType: exportMimeType,
        quality: exportMimeType === "image/png" ? undefined : 0.92,
      });
      const editedFileName = buildEditedFileName(fileName, exportMimeType);
      if (rootHandle) {
        try {
          const workspaceResult = await saveImageCopyToWorkspace({
            rootHandle,
            sourceFilePath: filePath,
            defaultFileName: editedFileName,
            blob: editedBlob,
          });
          setLastExportedFileName(workspaceResult.filePath);
          return;
        } catch {
          // Fall through to the native/browser export path when workspace write is unavailable.
        }
      }

      const result = await exportFile(editedBlob, {
        defaultFileName: editedFileName,
        filters: [buildExportFilter(exportMimeType)],
      });
      if (result.cancelled) {
        return;
      }
      if (!result.success) {
        throw new Error(result.error ?? "Export failed");
      }
      setLastExportedFileName(result.filePath ?? editedFileName);
    } catch {
      setEditExportError(t("viewer.image.edit.exportFailed"));
    } finally {
      setIsExportingEdit(false);
    }
  }, [
    exportEditOperations,
    fileName,
    getSourceBlobForEdit,
    hasEditOperations,
    isExportingEdit,
    mimeType,
    rootHandle,
    t,
  ]);

  const handleFullscreen = useCallback(() => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  }, []);

  // Handle wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setManualZoom((z) => Math.max(0.05, Math.min(10, z * factor)));
      setFitMode("actual");
    }
  };

  const commandBarState = useMemo<CommandBarState>(() => {
    const breadcrumbs = (filePath ?? fileName).split("/").filter(Boolean).map((segment) => ({ label: segment }));
    return {
      breadcrumbs,
      actions: [
        {
          id: "fit",
          label: t("viewer.image.command.fit"),
          priority: 10,
          group: "primary",
          disabled: fitMode === "fit",
          onTrigger: () => handleFitMode("fit"),
        },
        {
          id: "fit-width",
          label: t("viewer.image.command.fitWidth"),
          priority: 11,
          group: "secondary",
          disabled: fitMode === "width",
          onTrigger: () => handleFitMode("width"),
        },
        {
          id: "fit-height",
          label: t("viewer.image.command.fitHeight"),
          priority: 12,
          group: "secondary",
          disabled: fitMode === "height",
          onTrigger: () => handleFitMode("height"),
        },
        {
          id: "actual-size",
          label: t("viewer.image.command.actualSize"),
          priority: 13,
          group: "secondary",
          disabled: fitMode === "actual" && manualZoom === 1,
          onTrigger: () => handleFitMode("actual"),
        },
        {
          id: "zoom-out",
          label: t("viewer.image.command.zoomOut"),
          priority: 20,
          group: "secondary",
          onTrigger: handleZoomOut,
        },
        {
          id: "zoom-in",
          label: t("viewer.image.command.zoomIn"),
          priority: 21,
          group: "secondary",
          onTrigger: handleZoomIn,
        },
        {
          id: "rotate",
          label: t("viewer.image.command.rotate"),
          priority: 22,
          group: "secondary",
          onTrigger: handleRotate,
        },
        {
          id: "edit",
          label: t("viewer.image.command.edit"),
          priority: 23,
          group: "secondary",
          onTrigger: handleToggleEditTray,
        },
        {
          id: "download",
          label: t("viewer.image.command.download"),
          priority: 24,
          group: "secondary",
          onTrigger: handleDownload,
        },
        {
          id: "fullscreen",
          label: t("viewer.image.command.fullscreen"),
          priority: 25,
          group: "secondary",
          onTrigger: handleFullscreen,
        },
        {
          id: "reset",
          label: t("viewer.image.command.reset"),
          priority: 26,
          group: "secondary",
          onTrigger: handleReset,
        },
      ],
    };
  }, [
    fileName,
    filePath,
    fitMode,
    handleDownload,
    handleFitMode,
    handleFullscreen,
    handleReset,
    handleRotate,
    handleToggleEditTray,
    handleZoomIn,
    handleZoomOut,
    manualZoom,
    t,
  ]);

  usePaneCommandBar({
    paneId,
    state: paneId ? commandBarState : null,
  });

  // Pan handlers for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) { // Left click only
      setIsPanning(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleMouseLeave = () => {
    setIsPanning(false);
  };

  // Determine if image is "large" or has unusual aspect ratio
  const isLargeImage = naturalSize.width > 2000 || naturalSize.height > 2000;
  const aspectRatio = naturalSize.height / naturalSize.width;
  const isUnusualAspect = aspectRatio > 1.5 || aspectRatio < 0.67;
  const visibleEditPreview = isComparingOriginal
    ? { crop: null, rotation: 0, flipX: false, flipY: false, brightness: 0, contrast: 0 }
    : editPreview;
  const imageTransform = `scale(${zoom}) rotate(${(rotation + visibleEditPreview.rotation) % 360}deg) scale(${visibleEditPreview.flipX ? -1 : 1}, ${visibleEditPreview.flipY ? -1 : 1})`;
  const imageFilter = `brightness(${Math.max(0, 1 + visibleEditPreview.brightness)}) contrast(${Math.max(0, 1 + visibleEditPreview.contrast)})`;
  const imageClipPath = !isComparingOriginal && editPreview.crop
    ? `inset(${editPreview.crop.top}% ${editPreview.crop.right}% ${editPreview.crop.bottom}% ${editPreview.crop.left}%)`
    : "none";

  if (!imageUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">{t("viewer.image.loading")}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-background">
      {/* Hint for large/unusual aspect ratio images */}
      {(isLargeImage || isUnusualAspect) && (
        <div className="flex items-center justify-center gap-2 bg-muted/30 px-4 py-1 text-xs text-muted-foreground">
          <Move className="h-3 w-3" />
          <span>{t("viewer.image.hint.panZoom")}</span>
        </div>
      )}

      {/* Image container */}
      <div
        ref={imageContainerRef}
        className="flex flex-1 items-center justify-center overflow-auto bg-[#1a1a1a] p-6 relative"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
      >
        <Button
          type="button"
          variant={isEditTrayOpen ? "secondary" : "ghost"}
          size="icon"
          className="absolute right-4 top-4 z-20 h-8 w-8 border border-white/10 bg-background/80 shadow-sm backdrop-blur hover:bg-background"
          title={t("viewer.image.command.edit")}
          aria-label={t("viewer.image.command.edit")}
          data-testid="image-edit-toggle"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            handleToggleEditTray();
          }}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>

        <div
          className="relative"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            transition: isPanning ? "none" : "transform 0.1s ease-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt={fileName}
            onLoad={handleImageLoad}
            className="max-h-none max-w-none select-none"
            style={{
              transform: imageTransform,
              transformOrigin: "center center",
              filter: imageFilter,
              clipPath: imageClipPath,
              transition: "transform 0.15s ease-out",
              // Checkerboard background for transparent images
              backgroundImage: mimeType === "image/png" || mimeType === "image/svg+xml" || mimeType === "image/webp"
                ? "linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)"
                : "none",
              backgroundSize: "20px 20px",
              backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            }}
            draggable={false}
          />
          
          {/* Annotation highlight overlay */}
          {highlightedRegion && !hasEditOperations && naturalSize.width > 0 && (
            <div
              className="absolute pointer-events-none border-2 border-primary bg-primary/20 animate-pulse"
              style={{
                left: `${(highlightedRegion.x / 100) * naturalSize.width * zoom}px`,
                top: `${(highlightedRegion.y / 100) * naturalSize.height * zoom}px`,
                width: `${(highlightedRegion.width / 100) * naturalSize.width * zoom}px`,
                height: `${(highlightedRegion.height / 100) * naturalSize.height * zoom}px`,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: "center center",
              }}
            />
          )}
        </div>

        {isEditTrayOpen && (
          <div
            className="absolute inset-x-0 bottom-0 z-20 border-t border-border/70 bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.22)] backdrop-blur"
            data-testid="image-edit-tray"
            onMouseDown={(event) => event.stopPropagation()}
            onMouseMove={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("viewer.image.edit.rotate")}
                  aria-label={t("viewer.image.edit.rotate")}
                  data-testid="image-edit-rotate"
                  onClick={() => handleAppendEditOperation({ type: "rotate", degrees: 90 })}
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("viewer.image.edit.flipHorizontal")}
                  aria-label={t("viewer.image.edit.flipHorizontal")}
                  data-testid="image-edit-flip-horizontal"
                  onClick={() => handleAppendEditOperation({ type: "flip", axis: "horizontal" })}
                >
                  <FlipHorizontal className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("viewer.image.edit.flipVertical")}
                  aria-label={t("viewer.image.edit.flipVertical")}
                  data-testid="image-edit-flip-vertical"
                  onClick={() => handleAppendEditOperation({ type: "flip", axis: "vertical" })}
                >
                  <FlipVertical className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("viewer.image.edit.undo")}
                  aria-label={t("viewer.image.edit.undo")}
                  data-testid="image-edit-undo"
                  disabled={editOperations.length === 0}
                  onClick={handleUndoEditOperation}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={isCropOpen ? "secondary" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  title={t("viewer.image.edit.crop")}
                  aria-label={t("viewer.image.edit.crop")}
                  data-testid="image-edit-crop-toggle"
                  onClick={() => setIsCropOpen((open) => !open)}
                >
                  <Crop className="h-4 w-4" />
                </Button>
              </div>

              <div className="h-8 w-px bg-border" />

              {isCropOpen && (
                <>
                  <ImageEditSlider
                    label={t("viewer.image.edit.cropTop")}
                    value={cropMargins.top}
                    min={0}
                    max={80}
                    step={1}
                    displayValue={Math.round(cropMargins.top)}
                    onChange={(value) => handleCropMarginChange("top", value)}
                    testId="image-edit-crop-top"
                  />
                  <ImageEditSlider
                    label={t("viewer.image.edit.cropRight")}
                    value={cropMargins.right}
                    min={0}
                    max={80}
                    step={1}
                    displayValue={Math.round(cropMargins.right)}
                    onChange={(value) => handleCropMarginChange("right", value)}
                    testId="image-edit-crop-right"
                  />
                  <ImageEditSlider
                    label={t("viewer.image.edit.cropBottom")}
                    value={cropMargins.bottom}
                    min={0}
                    max={80}
                    step={1}
                    displayValue={Math.round(cropMargins.bottom)}
                    onChange={(value) => handleCropMarginChange("bottom", value)}
                    testId="image-edit-crop-bottom"
                  />
                  <ImageEditSlider
                    label={t("viewer.image.edit.cropLeft")}
                    value={cropMargins.left}
                    min={0}
                    max={80}
                    step={1}
                    displayValue={Math.round(cropMargins.left)}
                    onChange={(value) => handleCropMarginChange("left", value)}
                    testId="image-edit-crop-left"
                  />

                  <div className="h-8 w-px bg-border" />
                </>
              )}

              <ImageEditSlider
                label={t("viewer.image.edit.brightness")}
                value={adjustments.brightness}
                min={-1}
                max={1}
                step={0.05}
                displayValue={Math.round(adjustments.brightness * 100)}
                onChange={(value) => handleAdjustmentChange("brightness", value)}
                testId="image-edit-brightness"
              />
              <ImageEditSlider
                label={t("viewer.image.edit.contrast")}
                value={adjustments.contrast}
                min={-1}
                max={1}
                step={0.05}
                displayValue={Math.round(adjustments.contrast * 100)}
                onChange={(value) => handleAdjustmentChange("contrast", value)}
                testId="image-edit-contrast"
              />

              <div className="ml-auto flex items-center gap-2">
                {editExportError && (
                  <span className="max-w-48 truncate text-xs text-destructive" data-testid="image-edit-error">
                    {editExportError}
                  </span>
                )}
                {!editExportError && lastExportedFileName && (
                  <span className="max-w-48 truncate text-xs text-muted-foreground" data-testid="image-edit-export-success">
                    {t("viewer.image.edit.exported").replace("{fileName}", lastExportedFileName)}
                  </span>
                )}
                {hasEditOperations && (
                  <span className="text-xs text-muted-foreground" data-testid="image-edit-count">
                    {t("viewer.image.edit.pending").replace("{count}", String(exportEditOperationCount))}
                  </span>
                )}
                <Button
                  type="button"
                  variant={isComparingOriginal ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  data-testid="image-edit-compare"
                  disabled={!hasEditOperations}
                  onClick={handleToggleOriginalCompare}
                >
                  <span>{isComparingOriginal ? t("viewer.image.edit.showEdited") : t("viewer.image.edit.showOriginal")}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("viewer.image.edit.reset")}
                  aria-label={t("viewer.image.edit.reset")}
                  data-testid="image-edit-reset"
                  disabled={!hasEditOperations}
                  onClick={handleResetEdits}
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8"
                  data-testid="image-edit-export"
                  disabled={!hasEditOperations || isExportingEdit}
                  onClick={handleExportEditedCopy}
                >
                  {isExportingEdit ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span>{t("viewer.image.edit.export")}</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageEditSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  return (
    <label className="flex min-w-40 flex-1 items-center gap-2 text-xs text-muted-foreground">
      <span className="w-14 shrink-0 text-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        className="h-1.5 min-w-24 flex-1 accent-primary"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="w-9 shrink-0 text-right tabular-nums">{displayValue}</span>
    </label>
  );
}

function getExportMimeType(mimeType: string): ExportMimeType {
  if (mimeType === "image/jpeg" || mimeType === "image/webp") {
    return mimeType;
  }
  return "image/png";
}

function buildExportFilter(mimeType: ExportMimeType): { name: string; extensions: string[]; mimeType: ExportMimeType } {
  if (mimeType === "image/jpeg") {
    return { name: "JPEG image", extensions: ["jpg", "jpeg"], mimeType };
  }
  if (mimeType === "image/webp") {
    return { name: "WebP image", extensions: ["webp"], mimeType };
  }
  return { name: "PNG image", extensions: ["png"], mimeType };
}

function buildEditedFileName(fileName: string, mimeType: ExportMimeType): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const baseName = fileName.replace(/\.[^.]+$/, "");
  return `${baseName || "image"}-edited.${extension}`;
}

function hasCropMargins(margins: ImageCropMargins): boolean {
  return margins.top > 0 || margins.right > 0 || margins.bottom > 0 || margins.left > 0;
}

function cropMarginsToRect(margins: ImageCropMargins) {
  const normalized = normalizeCropMargins(margins);
  return {
    x: normalized.left,
    y: normalized.top,
    width: Math.max(1, 100 - normalized.left - normalized.right),
    height: Math.max(1, 100 - normalized.top - normalized.bottom),
  };
}

function normalizeCropMargins(margins: ImageCropMargins): ImageCropMargins {
  const top = clampCropMargin(margins.top);
  const right = clampCropMargin(margins.right);
  const bottom = clampCropMargin(margins.bottom);
  const left = clampCropMargin(margins.left);
  const horizontalTotal = left + right;
  const verticalTotal = top + bottom;

  return {
    top: verticalTotal >= 99 ? (top / verticalTotal) * 98 : top,
    right: horizontalTotal >= 99 ? (right / horizontalTotal) * 98 : right,
    bottom: verticalTotal >= 99 ? (bottom / verticalTotal) * 98 : bottom,
    left: horizontalTotal >= 99 ? (left / horizontalTotal) * 98 : left,
  };
}

function clampCropMargin(value: number): number {
  return Math.max(0, Math.min(98, Number.isFinite(value) ? value : 0));
}
