"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, Hash, Link2, TextSelect } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReferenceBrowserNode } from "@/lib/ai/reference-browser";

interface ReferenceBrowserProps {
  nodes: ReferenceBrowserNode[];
  activeNodeId?: string | null;
  emptyLabel?: string;
  headerTitle?: string;
  headerSubtitle?: string;
  onActivateNode?: (node: ReferenceBrowserNode) => void;
  onToggleNode?: (nodeId: string) => void;
  expandedNodeIds?: Record<string, boolean>;
  renderNodeActions?: (node: ReferenceBrowserNode) => ReactNode;
  showSelectionCheckbox?: boolean;
  selectedLeafIds?: Record<string, boolean>;
  onToggleLeafSelection?: (node: ReferenceBrowserNode) => void;
  className?: string;
}

function iconForNode(node: ReferenceBrowserNode) {
  switch (node.kind) {
    case "selection":
      return <TextSelect className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    case "group":
      return <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    case "file":
      return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    default:
      return <Hash className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  }
}

function ReferenceBrowserNodeRow({
  node,
  depth,
  index,
  activeNodeId,
  expandedNodeIds,
  onActivateNode,
  onToggleNode,
  renderNodeActions,
  showSelectionCheckbox,
  selectedLeafIds,
  onToggleLeafSelection,
}: Omit<ReferenceBrowserProps, "nodes" | "emptyLabel" | "headerTitle" | "headerSubtitle" | "className"> & {
  node: ReferenceBrowserNode;
  depth: number;
  index: number;
}) {
  const isGroup = node.kind === "group" && node.children && node.children.length > 0;
  const isExpanded = isGroup ? (expandedNodeIds?.[node.id] ?? true) : false;
  const isSelected = selectedLeafIds?.[node.locator ?? node.id] ?? false;

  return (
    <div className="space-y-1">
      <div
        data-reference-browser-index={depth === 0 ? index : undefined}
        className={cn(
          "rounded border border-border/50 bg-background/60 px-2 py-1.5",
          activeNodeId === node.id && "border-primary/40 bg-primary/5",
        )}
        style={{ marginLeft: depth * 10 }}
      >
        <div className="flex items-start gap-2">
          {showSelectionCheckbox && !isGroup && onToggleLeafSelection ? (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleLeafSelection(node)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-border"
            />
          ) : null}
          {iconForNode(node)}
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                if (isGroup) {
                  onToggleNode?.(node.id);
                } else {
                  onActivateNode?.(node);
                }
              }}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-foreground">{node.label}</div>
                {node.description ? (
                  <div className="truncate text-[10px] text-muted-foreground">{node.description}</div>
                ) : null}
                {node.preview ? (
                  <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground/80">{node.preview}</div>
                ) : null}
              </div>
              {isGroup ? (
                isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : null}
            </button>
            {renderNodeActions ? (
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {renderNodeActions(node)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {isGroup && isExpanded ? (
        <div className="space-y-1">
          {node.children!.map((child) => (
            <ReferenceBrowserNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              index={index}
              activeNodeId={activeNodeId}
              expandedNodeIds={expandedNodeIds}
              onActivateNode={onActivateNode}
              onToggleNode={onToggleNode}
              renderNodeActions={renderNodeActions}
              showSelectionCheckbox={showSelectionCheckbox}
              selectedLeafIds={selectedLeafIds}
              onToggleLeafSelection={onToggleLeafSelection}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ReferenceBrowser({
  nodes,
  activeNodeId = null,
  emptyLabel = "当前没有可浏览的引用项。",
  headerTitle,
  headerSubtitle,
  onActivateNode,
  onToggleNode,
  expandedNodeIds,
  renderNodeActions,
  showSelectionCheckbox = false,
  selectedLeafIds,
  onToggleLeafSelection,
  className,
}: ReferenceBrowserProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {headerTitle ? (
        <div className="border-b border-border/50 px-1 pb-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{headerTitle}</div>
          {headerSubtitle ? (
            <div className="mt-1 text-xs text-foreground truncate">{headerSubtitle}</div>
          ) : null}
        </div>
      ) : null}
      {nodes.length === 0 ? (
        <div className="rounded border border-border/50 px-3 py-4 text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-1">
          {nodes.map((node, index) => (
            <ReferenceBrowserNodeRow
              key={node.id}
              node={node}
              depth={0}
              index={index}
              activeNodeId={activeNodeId}
              expandedNodeIds={expandedNodeIds}
              onActivateNode={onActivateNode}
              onToggleNode={onToggleNode}
              renderNodeActions={renderNodeActions}
              showSelectionCheckbox={showSelectionCheckbox}
              selectedLeafIds={selectedLeafIds}
              onToggleLeafSelection={onToggleLeafSelection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ReferenceBrowser;
