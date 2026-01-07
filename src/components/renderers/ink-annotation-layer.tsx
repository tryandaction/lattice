"use client";

import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useStylusInput, type StylusPoint } from '@/hooks/use-stylus-input';
import { useInkAnnotationStore, useStrokesForPage, useCurrentTool, useCurrentStyle } from '@/stores/ink-annotation-store';
import { InkRenderer, LiveStrokePreview, EraserPreview } from './ink-renderer';
import { InkColorPicker } from './ink-color-picker';
import type { InkPoint } from '@/types/ink-annotation';
import { stylusPointToInkPoint, isPointInStrokeBounds } from '@/types/ink-annotation';

// ============================================================================
// Types
// ============================================================================

interface InkAnnotationLayerProps {
  /** File ID for this document */
  fileId: string;
  /** Page number (1-indexed) */
  page: number;
  /** Layer width in pixels */
  width: number;
  /** Layer height in pixels */
  height: number;
  /** Whether ink mode is active */
  isActive?: boolean;
  /** Callback when ink mode should be toggled */
  onToggleActive?: (active: boolean) => void;
  /** Custom class name */
  className?: string;
}

// ============================================================================
// Context Menu Component
// ============================================================================

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onColorChange: (color: string) => void;
  currentColor: string;
}

function InkContextMenu({ x, y, onClose, onColorChange, currentColor }: ContextMenuProps) {
  return (
    <>
      {/* Backdrop to close menu */}
      <div 
        className="fixed inset-0 z-50" 
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      
      {/* Context menu */}
      <div
        className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]"
        style={{ left: x, top: y }}
      >
        <div className="text-xs font-medium text-muted-foreground mb-2 px-2">
          Ink Color
        </div>
        <InkColorPicker
          currentColor={currentColor}
          onColorChange={(color: string) => {
            onColorChange(color);
            onClose();
          }}
          variant="expanded"
        />
      </div>
    </>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * InkAnnotationLayer - Overlay for handwriting/ink annotations
 * 
 * Features:
 * - Captures stylus input with pressure sensitivity
 * - Renders existing strokes
 * - Live preview of current stroke
 * - Eraser tool support
 * - Palm rejection
 * - Right-click context menu for color selection
 * 
 * Requirements: 9.1, 9.5, 12.1, 12.4
 */
export function InkAnnotationLayer({
  fileId,
  page,
  width,
  height,
  isActive = false,
  className,
}: InkAnnotationLayerProps) {
  // Store hooks
  const strokes = useStrokesForPage(fileId, page);
  const currentTool = useCurrentTool();
  const currentStyle = useCurrentStyle();
  const { addStroke, removeStroke, setCurrentStyle } = useInkAnnotationStore();

  // Local state
  const [currentPoints, setCurrentPoints] = useState<InkPoint[]>([]);
  const [eraserPosition, setEraserPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const strokeStartTimeRef = useRef<number>(0);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle color change from context menu
  const handleColorChange = useCallback((color: string) => {
    setCurrentStyle({ color });
  }, [setCurrentStyle]);

  // Convert stylus points to ink points
  const convertPoints = useCallback((points: StylusPoint[]): InkPoint[] => {
    return points.map(point => 
      stylusPointToInkPoint(point, width, height, strokeStartTimeRef.current)
    );
  }, [width, height]);

  // Handle stroke start
  const handleStrokeStart = useCallback((point: StylusPoint) => {
    if (currentTool === 'eraser') {
      // Start erasing
      const normalizedX = point.x / width;
      const normalizedY = point.y / height;
      setEraserPosition({ x: point.x, y: point.y });
      
      // Check for strokes to erase
      for (const stroke of strokes) {
        if (isPointInStrokeBounds(normalizedX, normalizedY, stroke.bounds, 0.02)) {
          // Check if point is actually near the stroke
          const isNear = stroke.points.some(p => {
            const dx = p.x - normalizedX;
            const dy = p.y - normalizedY;
            return Math.sqrt(dx * dx + dy * dy) < 0.03;
          });
          
          if (isNear) {
            removeStroke(fileId, page, stroke.id);
          }
        }
      }
    } else {
      // Start drawing
      strokeStartTimeRef.current = point.timestamp;
      const inkPoint = stylusPointToInkPoint(point, width, height, strokeStartTimeRef.current);
      setCurrentPoints([inkPoint]);
    }
  }, [currentTool, width, height, strokes, fileId, page, removeStroke]);

  // Handle stroke move
  const handleStrokeMove = useCallback((points: StylusPoint[]) => {
    if (currentTool === 'eraser') {
      // Update eraser position and check for strokes
      const lastPoint = points[points.length - 1];
      setEraserPosition({ x: lastPoint.x, y: lastPoint.y });
      
      const normalizedX = lastPoint.x / width;
      const normalizedY = lastPoint.y / height;
      
      for (const stroke of strokes) {
        if (isPointInStrokeBounds(normalizedX, normalizedY, stroke.bounds, 0.02)) {
          const isNear = stroke.points.some(p => {
            const dx = p.x - normalizedX;
            const dy = p.y - normalizedY;
            return Math.sqrt(dx * dx + dy * dy) < 0.03;
          });
          
          if (isNear) {
            removeStroke(fileId, page, stroke.id);
          }
        }
      }
    } else {
      // Add points to current stroke
      const newPoints = convertPoints(points);
      setCurrentPoints(prev => [...prev, ...newPoints]);
    }
  }, [currentTool, width, height, strokes, fileId, page, removeStroke, convertPoints]);

  // Handle stroke end
  const handleStrokeEnd = useCallback(() => {
    if (currentTool === 'eraser') {
      setEraserPosition(null);
    } else {
      // Finalize stroke
      if (currentPoints.length > 0) {
        addStroke(fileId, page, currentPoints);
      }
      setCurrentPoints([]);
    }
  }, [currentTool, currentPoints, fileId, page, addStroke]);

  // Handle stroke cancel
  const handleStrokeCancel = useCallback(() => {
    setCurrentPoints([]);
    setEraserPosition(null);
  }, []);

  // Set up stylus input
  const { ref, state } = useStylusInput<HTMLDivElement>({
    onStrokeStart: handleStrokeStart,
    onStrokeMove: handleStrokeMove,
    onStrokeEnd: handleStrokeEnd,
    onStrokeCancel: handleStrokeCancel,
    enablePalmRejection: true,
    penOnly: false, // Allow touch for testing
  });

  // Don't render if not active
  if (!isActive) {
    return null;
  }

  return (
    <div
      ref={ref}
      className={cn(
        'absolute inset-0',
        'touch-none', // Prevent default touch behavior
        currentTool === 'eraser' ? 'cursor-crosshair' : 'cursor-crosshair',
        className
      )}
      style={{
        width,
        height,
      }}
      onContextMenu={handleContextMenu}
    >
      {/* Existing strokes */}
      <InkRenderer
        strokes={strokes}
        width={width}
        height={height}
        variableWidth={true}
      />

      {/* Live stroke preview */}
      {currentPoints.length > 0 && currentTool !== 'eraser' && (
        <LiveStrokePreview
          points={currentPoints}
          width={width}
          height={height}
          color={currentStyle.color}
          strokeWidth={currentStyle.width}
          opacity={currentStyle.opacity}
          variableWidth={currentStyle.pressureSensitivity}
          smoothing={currentStyle.smoothing}
        />
      )}

      {/* Eraser preview */}
      {currentTool === 'eraser' && (
        <EraserPreview
          position={eraserPosition}
          size={20}
          width={width}
          height={height}
        />
      )}

      {/* Palm rejection indicator */}
      {state.isPalmRejectionActive && (
        <div className="absolute top-2 right-2 px-2 py-1 bg-yellow-500/80 text-yellow-900 text-xs rounded">
          Palm detected
        </div>
      )}

      {/* Context menu for color selection */}
      {contextMenu && (
        <InkContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onColorChange={handleColorChange}
          currentColor={currentStyle.color}
        />
      )}
    </div>
  );
}

// ============================================================================
// Ink Session Indicator
// ============================================================================

interface InkSessionIndicatorProps {
  isActive: boolean;
  tool: string;
  onToggle: () => void;
  className?: string;
}

/**
 * Shows the current ink session status
 */
export function InkSessionIndicator({
  isActive,
  tool,
  onToggle,
  className,
}: InkSessionIndicatorProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm',
        'transition-colors',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/80',
        className
      )}
    >
      <span className={cn(
        'w-2 h-2 rounded-full',
        isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'
      )} />
      <span>{isActive ? `Drawing (${tool})` : 'Ink Off'}</span>
    </button>
  );
}

export default InkAnnotationLayer;
