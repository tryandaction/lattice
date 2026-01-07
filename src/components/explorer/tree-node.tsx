"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import type { TreeNode, FileNode, DirectoryNode } from "@/types/file-system";
import { isFileNode, isDirectoryNode } from "@/types/file-system";
import { getFileIcon } from "@/lib/constants";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileSystem } from "@/hooks/use-file-system";
import { getAllPaneIds, findPane } from "@/lib/layout-utils";
import { cn } from "@/lib/utils";
import { FileContextMenu, DeleteConfirmDialog } from "./file-context-menu";

interface TreeNodeProps {
  node: TreeNode;
  depth: number;
}

/**
 * Recursive tree node component
 * Renders either a file or directory with appropriate styling and interactions
 */
export function TreeNodeComponent({ node, depth }: TreeNodeProps) {
  if (isFileNode(node)) {
    return <FileNodeComponent node={node} depth={depth} />;
  }

  if (isDirectoryNode(node)) {
    return <DirectoryNodeComponent node={node} depth={depth} />;
  }

  return null;
}

interface FileNodeProps {
  node: FileNode;
  depth: number;
}

/**
 * File node component
 * Displays file with appropriate icon and handles click to open file
 */
function FileNodeComponent({ node, depth }: FileNodeProps) {
  const Icon = getFileIcon(node.extension);
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const closeTabsByPath = useWorkspaceStore((state) => state.closeTabsByPath);
  const updateTabPath = useWorkspaceStore((state) => state.updateTabPath);
  const layout = useWorkspaceStore((state) => state.layout);
  const { deleteFile, renameFile } = useFileSystem();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if this file is open in any pane
  const { isOpenInActivePane, openCount } = useMemo(() => {
    const paneIds = getAllPaneIds(layout.root);
    let count = 0;
    let inActive = false;

    for (const paneId of paneIds) {
      const pane = findPane(layout.root, paneId);
      if (pane) {
        const isOpen = pane.tabs.some(tab => tab.filePath === node.path);
        if (isOpen) {
          count++;
          if (paneId === layout.activePaneId) {
            inActive = true;
          }
        }
      }
    }

    return { isOpenInActivePane: inActive, openCount: count };
  }, [layout.root, layout.activePaneId, node.path]);

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension
      const dotIndex = renameValue.lastIndexOf('.');
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [isRenaming]);

  const handleClick = () => {
    if (isRenaming) return;
    
    // Clear any pending double-click timeout
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    
    // Delay single click action to allow double-click detection
    clickTimeoutRef.current = setTimeout(() => {
      openFileInActivePane(node.handle, node.path);
    }, 200);
  };

  const handleDoubleClick = () => {
    // Clear single click timeout
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    
    // Enter rename mode
    setRenameValue(node.name);
    setRenameError(null);
    setIsRenaming(true);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRename = useCallback(async () => {
    const trimmedName = renameValue.trim();
    
    // Validate
    if (!trimmedName) {
      setRenameError("Name cannot be empty");
      return;
    }
    
    if (trimmedName === node.name) {
      setIsRenaming(false);
      return;
    }

    const result = await renameFile(node.path, trimmedName);
    
    if (result.success) {
      // Update any open tabs with the new path
      if (result.path) {
        updateTabPath(node.path, result.path);
      }
      setIsRenaming(false);
    } else {
      setRenameError(result.error || "Failed to rename");
    }
  }, [renameValue, node.name, node.path, renameFile, updateTabPath]);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsRenaming(false);
      setRenameError(null);
    }
  };

  const handleRenameBlur = () => {
    // Small delay to allow click on error message
    setTimeout(() => {
      if (isRenaming) {
        handleRename();
      }
    }, 100);
  };

  const handleDelete = useCallback(async () => {
    // Close any open tabs for this file first
    closeTabsByPath(node.path);
    // Delete the file
    await deleteFile(node.path);
    setShowDeleteConfirm(false);
  }, [node.path, closeTabsByPath, deleteFile]);

  const startRename = useCallback(() => {
    setRenameValue(node.name);
    setRenameError(null);
    setIsRenaming(true);
  }, [node.name]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      {isRenaming ? (
        <div
          className="flex flex-col px-2 py-0.5"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => {
                setRenameValue(e.target.value);
                setRenameError(null);
              }}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
              className={cn(
                "flex-1 bg-background border rounded px-1 py-0.5 text-sm",
                "focus:outline-none focus:ring-1 focus:ring-primary",
                renameError && "border-destructive focus:ring-destructive"
              )}
            />
          </div>
          {renameError && (
            <span className="text-xs text-destructive mt-0.5 ml-6">{renameError}</span>
          )}
        </div>
      ) : (
        <button
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          className={cn(
            "flex w-full items-center gap-2 px-2 py-1 text-left text-sm",
            "hover:bg-accent/50 transition-colors",
            "focus:outline-none focus:bg-accent",
            isOpenInActivePane && "bg-accent",
            !isOpenInActivePane && openCount > 0 && "bg-accent/30"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
          {openCount > 1 && (
            <span className="ml-auto text-xs text-muted-foreground">{openCount}</span>
          )}
        </button>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={() => {
            setContextMenu(null);
            startRename();
          }}
          onDelete={() => {
            setContextMenu(null);
            setShowDeleteConfirm(true);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <DeleteConfirmDialog
          fileName={node.name}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}

interface DirectoryNodeProps {
  node: DirectoryNode;
  depth: number;
}

/**
 * Directory node component
 * Displays folder with expand/collapse functionality
 */
function DirectoryNodeComponent({ node, depth }: DirectoryNodeProps) {
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);

  const handleToggle = () => {
    toggleDirectory(node.path);
  };

  const ChevronIcon = node.isExpanded ? ChevronDown : ChevronRight;
  const FolderIcon = node.isExpanded ? FolderOpen : Folder;

  return (
    <div>
      <button
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-1 px-2 py-1 text-left text-sm",
          "hover:bg-accent/50 transition-colors",
          "focus:outline-none focus:bg-accent"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <ChevronIcon className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
          node.isExpanded && "transform rotate-0"
        )} />
        <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{node.name}</span>
        <span className="ml-auto font-scientific text-muted-foreground">
          {node.children.length}
        </span>
      </button>

      {/* Children container - render only when expanded */}
      {node.isExpanded && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {node.children.map((child) => (
            <TreeNodeComponent
              key={child.path}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
