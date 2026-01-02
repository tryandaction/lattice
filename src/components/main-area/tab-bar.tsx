"use client";

import { useRef, useEffect } from "react";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { TabState, PaneId } from "@/types/layout";
import { Tab } from "./tab";
import { cn } from "@/lib/utils";

export interface TabBarProps {
  paneId: PaneId;
  tabs: TabState[];
  activeTabIndex: number;
  onTabClick: (index: number) => void;
  onTabClose: (index: number) => void;
}

/**
 * Tab Bar Component
 * 
 * Displays a horizontal list of tabs with scrolling support.
 * Handles tab selection, close actions, and drag-and-drop reordering.
 */
export function TabBar({
  paneId,
  tabs,
  activeTabIndex,
  onTabClick,
  onTabClose,
}: TabBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Set up droppable for receiving tabs from other panes
  const { setNodeRef, isOver } = useDroppable({
    id: `tab-bar-${paneId}`,
    data: {
      type: 'tab-bar',
      paneId,
      index: tabs.length, // Drop at end by default
    },
  });

  // Scroll active tab into view when it changes
  useEffect(() => {
    if (scrollContainerRef.current && activeTabIndex >= 0) {
      const container = scrollContainerRef.current;
      const activeTab = container.children[activeTabIndex] as HTMLElement;
      if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeTabIndex]);

  if (tabs.length === 0) {
    return (
      <div 
        ref={setNodeRef}
        className={cn(
          "flex h-9 items-center border-b border-border bg-muted/30 px-2",
          isOver && "bg-blue-500/10 border-blue-500/50"
        )}
      >
        <span className="text-xs text-muted-foreground">
          {isOver ? "Drop here" : "No files open"}
        </span>
      </div>
    );
  }

  // Get tab IDs for sortable context
  const tabIds = tabs.map(tab => tab.id);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        // Also set the scroll container ref
        if (scrollContainerRef.current !== node) {
          (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      }}
      className={cn(
        "flex h-9 items-end gap-0 overflow-x-auto border-b border-border bg-muted/30",
        "scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent",
        isOver && "bg-blue-500/10"
      )}
      data-pane-id={paneId}
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={index === activeTabIndex}
            index={index}
            paneId={paneId}
            onClick={() => onTabClick(index)}
            onClose={() => onTabClose(index)}
          />
        ))}
      </SortableContext>
    </div>
  );
}
