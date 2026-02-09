"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCw, Maximize2, Download, Move, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationNavigation } from "../../hooks/use-annotation-navigation";

interface ImageViewerProps {
  content: ArrayBuffer;
  fileName: string;
  mimeType: string;
}

type FitMode = "fit" | "width" | "height" | "actual";

/**
 * Image Viewer component
 * Displays images with zoom, rotate, pan, and fullscreen controls
 * Optimized for large images and long images
 */
export function ImageViewer({ content, fileName, mimeType }: ImageViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
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
        setTimeout(() => setHighlightedRegion(null), 3000);
      },
    },
  });

  // Create object URL from ArrayBuffer
  useEffect(() => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    setImageUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [content, mimeType]);

  // Calculate fit zoom based on container and image size
  const calculateFitZoom = useCallback(() => {
    if (!imageContainerRef.current || naturalSize.width === 0) return 1;
    
    const container = imageContainerRef.current;
    const containerWidth = container.clientWidth - 48; // padding
    const containerHeight = container.clientHeight - 48;
    
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
  }, [naturalSize, fitMode, rotation]);

  // Update zoom when fit mode or natural size changes
  useEffect(() => {
    const newZoom = calculateFitZoom();
    setZoom(newZoom);
    setPanOffset({ x: 0, y: 0 });
  }, [calculateFitZoom]);

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

  const handleZoomIn = () => {
    setZoom((z) => Math.min(z * 1.25, 10));
    setFitMode("actual"); // Switch to manual zoom mode
  };
  
  const handleZoomOut = () => {
    setZoom((z) => Math.max(z / 1.25, 0.05));
    setFitMode("actual");
  };
  
  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
  };
  
  const handleReset = () => {
    setRotation(0);
    setFitMode("fit");
    setPanOffset({ x: 0, y: 0 });
  };

  const handleFitMode = (mode: FitMode) => {
    setFitMode(mode);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleDownload = () => {
    if (imageUrl) {
      const a = document.createElement("a");
      a.href = imageUrl;
      a.download = fileName;
      a.click();
    }
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  // Handle wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.05, Math.min(10, z * factor)));
      setFitMode("actual");
    }
  };

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

  // Format file size info
  const formatSize = () => {
    if (naturalSize.width === 0) return "";
    const { width, height } = naturalSize;
    const megapixels = (width * height) / 1000000;
    return `${width} × ${height} (${megapixels.toFixed(1)} MP)`;
  };

  // Determine if image is "large" or has unusual aspect ratio
  const isLargeImage = naturalSize.width > 2000 || naturalSize.height > 2000;
  const aspectRatio = naturalSize.height / naturalSize.width;
  const isUnusualAspect = aspectRatio > 1.5 || aspectRatio < 0.67;

  if (!imageUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading image...</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{fileName}</span>
          {naturalSize.width > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatSize()}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1 flex-wrap">
          {/* Fit mode buttons */}
          <div className="flex items-center border rounded-md overflow-hidden mr-2">
            <Button
              variant={fitMode === "fit" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none h-7 px-2 text-xs"
              onClick={() => handleFitMode("fit")}
              title="Fit to view"
            >
              <Minimize2 className="h-3 w-3 mr-1" />
              Fit
            </Button>
            <Button
              variant={fitMode === "width" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none h-7 px-2 text-xs border-l"
              onClick={() => handleFitMode("width")}
              title="Fit to width"
            >
              W
            </Button>
            <Button
              variant={fitMode === "height" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none h-7 px-2 text-xs border-l"
              onClick={() => handleFitMode("height")}
              title="Fit to height"
            >
              H
            </Button>
            <Button
              variant={fitMode === "actual" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none h-7 px-2 text-xs border-l"
              onClick={() => handleFitMode("actual")}
              title="Actual size (100%)"
            >
              1:1
            </Button>
          </div>

          {/* Zoom controls */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} title="Zoom Out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-[3.5rem] text-center text-xs text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} title="Zoom In">
            <ZoomIn className="h-4 w-4" />
          </Button>
          
          <div className="mx-1 h-4 w-px bg-border" />
          
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRotate} title="Rotate 90°">
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleFullscreen} title="Fullscreen">
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="Download">
            <Download className="h-4 w-4" />
          </Button>
          
          <div className="mx-1 h-4 w-px bg-border" />
          
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleReset}>
            Reset
          </Button>
        </div>
      </div>

      {/* Hint for large/unusual aspect ratio images */}
      {(isLargeImage || isUnusualAspect) && (
        <div className="flex items-center justify-center gap-2 bg-muted/30 px-4 py-1 text-xs text-muted-foreground">
          <Move className="h-3 w-3" />
          <span>Drag to pan • Ctrl+Scroll to zoom</span>
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
