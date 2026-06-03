"use client";

import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Copy, Files, PanelRightClose, Save, X } from "lucide-react";
import type { TabState, PaneId } from "@/types/layout";
import { Tab } from "./tab";
import { cn } from "@/lib/utils";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";
import { useI18n } from "@/hooks/use-i18n";
import { WorkbenchContextMenu, type WorkbenchMenuAction } from "@/components/ui/workbench-context-menu";

export interface TabBarProps {
  paneId: PaneId;
  tabs: TabState[];
  activeTabIndex: number;
  isPaneActive: boolean;
  onTabClick: (index: number) => void;
  onTabClose: (index: number) => void;
  onCloseOtherTabs?: (index: number) => void;
  onCloseTabsToRight?: (index: number) => void;
  onCloseSavedTabs?: () => void;
  onCloseAllTabs?: () => void;
  onCopyTabPath?: (tab: TabState) => void;
}

export function TabBar({
  paneId,
  tabs,
  activeTabIndex,
  isPaneActive,
  onTabClick,
  onTabClose,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseSavedTabs,
  onCloseAllTabs,
  onCopyTabPath,
}: TabBarProps) {
  const { t } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [menuState, setMenuState] = useState<{ x: number; y: number; tabIndex: number } | null>(null);
  const safeActiveIndex =
    activeTabIndex >= 0 && activeTabIndex < tabs.length ? activeTabIndex : -1;

  const { setNodeRef, isOver } = useDroppable({
    id: `tab-bar-${paneId}`,
    data: {
      type: "tab-bar",
      paneId,
      index: tabs.length,
    },
  });

  useEffect(() => {
    if (scrollContainerRef.current && safeActiveIndex >= 0) {
      const container = scrollContainerRef.current;
      const activeTabId = tabs[safeActiveIndex]?.id;
      const activeTab = activeTabId
        ? container.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`)
        : null;
      activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [safeActiveIndex, tabs]);

  const handleViewportRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    scrollContainerRef.current = node;
  }, [setNodeRef]);

  const tabIds = tabs.map((tab) => tab.id);
  const menuTab = menuState ? tabs[menuState.tabIndex] : null;
  const hasSavedTabs = tabs.some((tab) => !tab.isDirty);
  const menuActions = useMemo<WorkbenchMenuAction[]>(() => {
    if (!menuState || !menuTab) return [];
    const tabsToRight = Math.max(0, tabs.length - menuState.tabIndex - 1);
    return [
      {
        id: "close",
        label: t("tab.context.close"),
        icon: <X className="h-4 w-4" />,
        shortcut: "Ctrl+W",
        onSelect: () => onTabClose(menuState.tabIndex),
      },
      {
        id: "close-others",
        label: t("tab.context.closeOthers"),
        icon: <Files className="h-4 w-4" />,
        disabled: tabs.length <= 1 || !onCloseOtherTabs,
        onSelect: () => onCloseOtherTabs?.(menuState.tabIndex),
      },
      {
        id: "close-right",
        label: t("tab.context.closeRight"),
        icon: <PanelRightClose className="h-4 w-4" />,
        disabled: tabsToRight === 0 || !onCloseTabsToRight,
        onSelect: () => onCloseTabsToRight?.(menuState.tabIndex),
      },
      {
        id: "close-saved",
        label: t("tab.context.closeSaved"),
        icon: <Save className="h-4 w-4" />,
        disabled: !hasSavedTabs || !onCloseSavedTabs,
        separatorBefore: true,
        onSelect: () => onCloseSavedTabs?.(),
      },
      {
        id: "close-all",
        label: t("tab.context.closeAll"),
        icon: <X className="h-4 w-4" />,
        disabled: tabs.length === 0 || !onCloseAllTabs,
        onSelect: () => onCloseAllTabs?.(),
      },
      {
        id: "copy-path",
        label: t("tab.context.copyPath"),
        icon: <Copy className="h-4 w-4" />,
        separatorBefore: true,
        disabled: !onCopyTabPath,
        onSelect: () => onCopyTabPath?.(menuTab),
      },
    ];
  }, [
    hasSavedTabs,
    menuState,
    menuTab,
    onCloseAllTabs,
    onCloseOtherTabs,
    onCloseSavedTabs,
    onCloseTabsToRight,
    onCopyTabPath,
    onTabClose,
    t,
    tabs.length,
  ]);

  if (tabs.length === 0) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex h-9 items-center bg-[var(--workbench-panel-subtle)] px-2",
          isOver && "bg-blue-500/10 border-blue-500/50"
        )}
        data-desktop-webview-safe-zone="true"
      >
        <span className="text-xs text-muted-foreground">
          {isOver ? t("tab.dropHere") : t("tab.empty")}
        </span>
      </div>
    );
  }

  return (
    <>
      <HorizontalScrollStrip
        viewportRef={handleViewportRef}
        className={cn("h-10", isOver && "bg-blue-500/10")}
        viewportClassName={cn("h-10 pb-1", isOver && "bg-blue-500/10")}
        contentClassName="h-9 min-w-full w-max items-end gap-0"
        viewportProps={{ "data-pane-id": paneId, "data-desktop-webview-safe-zone": "true" }}
        ariaLabel={t("tab.openTabs")}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, index) => (
            <Tab
              key={tab.id}
              tab={tab}
              isActive={index === safeActiveIndex}
              isPaneActive={isPaneActive}
              index={index}
              paneId={paneId}
              onClick={() => onTabClick(index)}
              onClose={() => onTabClose(index)}
              onContextMenu={(event) => setMenuState({ x: event.clientX, y: event.clientY, tabIndex: index })}
            />
          ))}
        </SortableContext>
      </HorizontalScrollStrip>
      {menuState && (
        <WorkbenchContextMenu
          x={menuState.x}
          y={menuState.y}
          actions={menuActions}
          onClose={() => setMenuState(null)}
        />
      )}
    </>
  );
}
