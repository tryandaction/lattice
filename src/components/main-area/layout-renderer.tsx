"use client";

import { useCallback } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { PaneWrapper } from "./pane-wrapper";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { LayoutNode, PaneId, SplitNode } from "@/types/layout";
import { isPaneNode, isSplitNode } from "@/types/layout";

interface LayoutRendererProps {
  node: LayoutNode;
  activePaneId: PaneId;
}

/**
 * Layout Renderer Component
 * 
 * Recursively renders the layout tree structure.
 * - For PaneNode: renders PaneWrapper
 * - For SplitNode: renders ResizablePanelGroup with children
 */
export function LayoutRenderer({ node, activePaneId }: LayoutRendererProps) {
  if (isPaneNode(node)) {
    return (
      <PaneRenderer
        paneId={node.id}
        isActive={node.id === activePaneId}
      />
    );
  }

  if (isSplitNode(node)) {
    return (
      <SplitRenderer
        split={node}
        activePaneId={activePaneId}
      />
    );
  }

  return null;
}

interface PaneRendererProps {
  paneId: PaneId;
  isActive: boolean;
}

/**
 * Pane Renderer - wraps PaneWrapper with store connections
 */
function PaneRenderer({ paneId, isActive }: PaneRendererProps) {
  const setActivePaneId = useWorkspaceStore((state) => state.setActivePaneId);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const closePane = useWorkspaceStore((state) => state.closePane);

  const handleActivate = useCallback(() => {
    setActivePaneId(paneId);
  }, [paneId, setActivePaneId]);

  const handleSplitRight = useCallback(() => {
    splitPane(paneId, 'horizontal');
  }, [paneId, splitPane]);

  const handleSplitDown = useCallback(() => {
    splitPane(paneId, 'vertical');
  }, [paneId, splitPane]);

  const handleClose = useCallback(() => {
    closePane(paneId);
  }, [paneId, closePane]);

  return (
    <PaneWrapper
      paneId={paneId}
      isActive={isActive}
      onActivate={handleActivate}
      onSplitRight={handleSplitRight}
      onSplitDown={handleSplitDown}
      onClose={handleClose}
    />
  );
}

interface SplitRendererProps {
  split: SplitNode;
  activePaneId: PaneId;
}

/**
 * Split Renderer - renders ResizablePanelGroup with children
 */
function SplitRenderer({ split, activePaneId }: SplitRendererProps) {
  const resizePanes = useWorkspaceStore((state) => state.resizePanes);

  const handleResize = useCallback(
    (sizes: number[]) => {
      resizePanes(split.id, sizes);
    },
    [resizePanes, split.id]
  );

  return (
    <ResizablePanelGroup
      direction={split.direction}
      className="h-full w-full"
      sizes={split.sizes}
      onSizesChange={handleResize}
    >
      {split.children.map((child, index) => (
        <SplitChild
          key={child.id}
          child={child}
          size={split.sizes[index]}
          activePaneId={activePaneId}
          isLast={index === split.children.length - 1}
          index={index}
        />
      ))}
    </ResizablePanelGroup>
  );
}

interface SplitChildProps {
  child: LayoutNode;
  size: number;
  activePaneId: PaneId;
  isLast: boolean;
  index: number;
}

/**
 * Split Child - renders a single child in a split with handle
 */
function SplitChild({ child, size, activePaneId, isLast, index }: SplitChildProps) {
  return (
    <>
      <ResizablePanel
        defaultSize={size}
        minSize={10}
        className="h-full"
      >
        <LayoutRenderer node={child} activePaneId={activePaneId} />
      </ResizablePanel>
      {!isLast && <ResizableHandle withHandle index={index} />}
    </>
  );
}
