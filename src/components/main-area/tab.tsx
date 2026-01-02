"use client";

import { X } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TabState, PaneId, TabDragData } from "@/types/layout";
import { getFileIcon } from "@/lib/constants";
import { getFileExtension } from "@/lib/file-utils";
import { cn } from "@/lib/utils";

export interface TabProps {
  tab: TabState;
  isActive: boolean;
  index: number;
  paneId: PaneId;
  onClick: () => void;
  onClose: () => void;
  isDraggable?: boolean;
}

/**
 * Tab Component
 * 
 * Displays a single tab with file icon, name, dirty indicator, and close button.
 * Supports drag-and-drop for reordering and moving between panes.
 */
export function Tab({
  tab,
  isActive,
  index,
  paneId,
  onClick,
  onClose,
  isDraggable = true,
}: TabProps) {
  const extension = getFileExtension(tab.fileName);
  const Icon = getFileIcon(extension);

  // Set up sortable for drag-and-drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.id,
    data: {
      type: 'tab',
      paneId,
      tabIndex: index,
      tab,
    } as TabDragData,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Let parent handle the save reminder dialog
    onClose();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group flex h-8 min-w-0 max-w-[180px] cursor-pointer items-center gap-1.5 border-r border-border px-2",
        "transition-colors duration-100",
        isActive
          ? "bg-background border-t-2 border-t-blue-500"
          : "bg-muted/50 hover:bg-muted border-t-2 border-t-transparent",
        isDragging && "opacity-50 shadow-lg z-50"
      )}
      onClick={onClick}
      title={tab.filePath}
    >
      {/* File Icon */}
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      
      {/* File Name */}
      <span className={cn(
        "truncate text-xs",
        isActive ? "text-foreground" : "text-muted-foreground"
      )}>
        {tab.fileName}
      </span>
      
      {/* Dirty Indicator */}
      {tab.isDirty && (
        <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" title="Unsaved changes" />
      )}
      
      {/* Close Button */}
      <button
        onClick={handleClose}
        className={cn(
          "ml-auto shrink-0 rounded p-0.5 transition-colors",
          "opacity-0 group-hover:opacity-100",
          isActive && "opacity-100",
          "hover:bg-accent"
        )}
        title="Close"
      >
        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
      </button>
    </div>
  );
}
