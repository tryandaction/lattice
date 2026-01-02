"use client";

import { useDroppable } from "@dnd-kit/core";
import type { PaneId, SplitDirection } from "@/types/layout";
import { cn } from "@/lib/utils";

export type DropZonePosition = 'left' | 'right' | 'top' | 'bottom';

export interface DropZoneProps {
  paneId: PaneId;
  position: DropZonePosition;
  isVisible: boolean;
}

// Map position to split direction
const positionToDirection: Record<DropZonePosition, SplitDirection> = {
  left: 'horizontal',
  right: 'horizontal',
  top: 'vertical',
  bottom: 'vertical',
};

/**
 * Drop Zone Component
 * 
 * Shows a visual indicator at the edge of a pane where a tab can be dropped
 * to create a new split in that direction.
 */
export function DropZone({ paneId, position, isVisible }: DropZoneProps) {
  const direction = positionToDirection[position];

  const { setNodeRef, isOver } = useDroppable({
    id: `drop-zone-${paneId}-${position}`,
    data: {
      type: 'drop-zone',
      paneId,
      direction,
      position,
    },
    disabled: !isVisible,
  });

  if (!isVisible) {
    return null;
  }

  // Position styles for each edge
  const positionStyles: Record<DropZonePosition, string> = {
    left: "left-0 top-0 bottom-0 w-16",
    right: "right-0 top-0 bottom-0 w-16",
    top: "top-0 left-0 right-0 h-16",
    bottom: "bottom-0 left-0 right-0 h-16",
  };

  // Preview styles showing where the new pane will appear
  const previewStyles: Record<DropZonePosition, string> = {
    left: "left-0 top-0 bottom-0 w-1/2",
    right: "right-0 top-0 bottom-0 w-1/2",
    top: "top-0 left-0 right-0 h-1/2",
    bottom: "bottom-0 left-0 right-0 h-1/2",
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute z-20 transition-all duration-150",
        positionStyles[position],
        isOver ? "opacity-100" : "opacity-0 hover:opacity-50"
      )}
    >
      {/* Drop indicator */}
      <div
        className={cn(
          "absolute transition-all duration-150",
          previewStyles[position],
          isOver
            ? "bg-blue-500/30 border-2 border-blue-500 border-dashed"
            : "bg-blue-500/10"
        )}
      />
      
      {/* Label */}
      {isOver && (
        <div
          className={cn(
            "absolute flex items-center justify-center",
            previewStyles[position]
          )}
        >
          <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded shadow">
            Split {position === 'left' || position === 'right' ? 'Horizontal' : 'Vertical'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Drop Zones Container
 * 
 * Renders all four drop zones for a pane.
 */
export interface DropZonesProps {
  paneId: PaneId;
  isVisible: boolean;
}

export function DropZones({ paneId, isVisible }: DropZonesProps) {
  return (
    <>
      <DropZone paneId={paneId} position="left" isVisible={isVisible} />
      <DropZone paneId={paneId} position="right" isVisible={isVisible} />
      <DropZone paneId={paneId} position="top" isVisible={isVisible} />
      <DropZone paneId={paneId} position="bottom" isVisible={isVisible} />
    </>
  );
}
