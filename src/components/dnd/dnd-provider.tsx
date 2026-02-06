"use client";

import { useState, useCallback, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { TabDragData, SplitDirection, PaneId } from "@/types/layout";
import { Tab } from "@/components/main-area/tab";

interface DndProviderProps {
  children: ReactNode;
}

// Context for tracking drag state
export interface DragState {
  isDragging: boolean;
  activeTab: TabDragData | null;
  overPaneId: PaneId | null;
  overDropZone: SplitDirection | 'center' | null;
}

/**
 * DnD Provider Component
 * 
 * Wraps the application with drag-and-drop context.
 * Handles tab dragging between panes and to drop zones.
 */
export function DndProvider({ children }: DndProviderProps) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    activeTab: null,
    overPaneId: null,
    overDropZone: null,
  });

  const reorderTabs = useWorkspaceStore((state) => state.reorderTabs);
  const moveTabToPane = useWorkspaceStore((state) => state.moveTabToPane);
  const moveTabToNewSplit = useWorkspaceStore((state) => state.moveTabToNewSplit);

  // Configure sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const dragData = active.data.current as TabDragData | undefined;

    if (dragData?.type === 'tab') {
      setDragState({
        isDragging: true,
        activeTab: dragData,
        overPaneId: null,
        overDropZone: null,
      });
    }
  }, []);

  // Handle drag over
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;

    if (!over) {
      setDragState(prev => ({
        ...prev,
        overPaneId: null,
        overDropZone: null,
      }));
      return;
    }

    const overData = over.data.current as {
      type: string;
      paneId?: PaneId;
      direction?: SplitDirection;
      index?: number;
    } | undefined;

    if (overData?.type === 'tab-bar' && overData.paneId) {
      setDragState(prev => ({
        ...prev,
        overPaneId: overData.paneId!,
        overDropZone: 'center',
      }));
    } else if (overData?.type === 'drop-zone' && overData.paneId && overData.direction) {
      setDragState(prev => ({
        ...prev,
        overPaneId: overData.paneId!,
        overDropZone: overData.direction!,
      }));
    }
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    setDragState({
      isDragging: false,
      activeTab: null,
      overPaneId: null,
      overDropZone: null,
    });

    if (!over) return;

    const dragData = active.data.current as TabDragData | undefined;
    if (!dragData || dragData.type !== 'tab') return;

    const overData = over.data.current as {
      type: string;
      paneId?: PaneId;
      direction?: SplitDirection;
      index?: number;
    } | undefined;

    if (!overData) return;

    // Handle drop on tab bar (reorder or move)
    if (overData.type === 'tab-bar' && overData.paneId) {
      if (dragData.paneId === overData.paneId) {
        // Reorder within same pane
        const toIndex = overData.index ?? 0;
        if (dragData.tabIndex !== toIndex) {
          reorderTabs(dragData.paneId, dragData.tabIndex, toIndex);
        }
      } else {
        // Move to different pane
        moveTabToPane(dragData.paneId, dragData.tabIndex, overData.paneId);
      }
    }
    // Handle drop on split zone (create new split)
    else if (overData.type === 'drop-zone' && overData.paneId && overData.direction) {
      moveTabToNewSplit(
        dragData.paneId,
        dragData.tabIndex,
        overData.paneId,
        overData.direction
      );
    }
  }, [reorderTabs, moveTabToPane, moveTabToNewSplit]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {children}
      
      {/* Drag Overlay - shows the dragged tab */}
      <DragOverlay>
        {dragState.activeTab && (
          <div className="opacity-80 shadow-lg">
            <Tab
              tab={dragState.activeTab.tab}
              isActive={true}
              isPaneActive={true}
              index={dragState.activeTab.tabIndex}
              paneId={dragState.activeTab.paneId}
              onClick={() => {}}
              onClose={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// DragState is already exported via the interface declaration above
