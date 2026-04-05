"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Move } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useAnnotationNavigation } from "../../hooks/use-annotation-navigation";
import { useObjectUrl } from "@/hooks/use-object-url";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { CommandBarState, PaneId } from "@/types/layout";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import type { BinaryViewerContent } from "@/types/viewer-content";

interface ImageViewerProps {
  source: BinaryViewerContent;
  fileName: string;
  mimeType: string;
  paneId?: PaneId;
  filePath?: string;
}

type FitMode = "fit" | "width" | "height" | "actual";

/**
 * Image Viewer component
 * Displays images with zoom, rotate, pan, and fullscreen controls
 * Optimized for large images and long images
 */
export function ImageViewer({ source, fileName, mimeType, paneId, filePath }: ImageViewerProps) {
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
          id: "download",
          label: t("viewer.image.command.download"),
          priority: 23,
          group: "secondary",
          onTrigger: handleDownload,
        },
        {
          id: "fullscreen",
          label: t("viewer.image.command.fullscreen"),
          priority: 24,
          group: "secondary",
          onTrigger: handleFullscreen,
        },
        {
          id: "reset",
          label: t("viewer.image.command.reset"),
          priority: 25,
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
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: "center center",
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
          {highlightedRegion && naturalSize.width > 0 && (
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
      </div>
    </div>
  );
}
