"use client";

import { useRef, useEffect, useLayoutEffect } from "react";
import { Trash2, Pencil, FilePlus, FolderPlus, Copy, Scissors, ClipboardPaste } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileContextMenuProps {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  isDirectory?: boolean;
  actions?: Array<{
    label: string;
    onSelect: () => void;
    tone?: "default" | "destructive";
  }>;
}

/**
 * Context menu for file operations
 * Adjusts position to stay within viewport bounds
 */
export function FileContextMenu({
  x,
  y,
  onRename,
  onDelete,
  onClose,
  onNewFile,
  onNewFolder,
  onCopy,
  onCut,
  onPaste,
  canPaste = false,
  isDirectory,
  actions = [],
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to stay within viewport
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Prevent going off right edge
    if (x + menuRect.width > viewportWidth) {
      adjustedX = viewportWidth - menuRect.width - 8;
    }

    // Prevent going off bottom edge
    if (y + menuRect.height > viewportHeight) {
      adjustedY = viewportHeight - menuRect.height - 8;
    }

    // Ensure not going off left or top edge
    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [x, y]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
      style={{ left: x, top: y }}
    >
      {isDirectory && onNewFile && (
        <button
          onClick={() => {
            onNewFile();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            "hover:bg-accent transition-colors",
            "focus:outline-none focus:bg-accent"
          )}
        >
          <FilePlus className="h-4 w-4" />
          <span>New File</span>
        </button>
      )}
      {isDirectory && onNewFolder && (
        <button
          onClick={() => {
            onNewFolder();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            "hover:bg-accent transition-colors",
            "focus:outline-none focus:bg-accent"
          )}
        >
          <FolderPlus className="h-4 w-4" />
          <span>New Folder</span>
        </button>
      )}
      {(isDirectory && (onNewFile || onNewFolder)) && (
        <div className="my-1 h-px bg-border" />
      )}
      {isDirectory && onPaste && (
        <button
          onClick={() => {
            onPaste();
            onClose();
          }}
          disabled={!canPaste}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            "hover:bg-accent transition-colors",
            "focus:outline-none focus:bg-accent",
            !canPaste && "cursor-not-allowed opacity-50"
          )}
        >
          <ClipboardPaste className="h-4 w-4" />
          <span>Paste</span>
        </button>
      )}
      {(isDirectory && (onNewFile || onNewFolder || onPaste)) && (
        <div className="my-1 h-px bg-border" />
      )}
      {onCopy && (
        <button
          onClick={() => {
            onCopy();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            "hover:bg-accent transition-colors",
            "focus:outline-none focus:bg-accent"
          )}
        >
          <Copy className="h-4 w-4" />
          <span>Copy</span>
        </button>
      )}
      {onCut && (
        <button
          onClick={() => {
            onCut();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            "hover:bg-accent transition-colors",
            "focus:outline-none focus:bg-accent"
          )}
        >
          <Scissors className="h-4 w-4" />
          <span>Cut</span>
        </button>
      )}
      {(onCopy || onCut) && (
        <div className="my-1 h-px bg-border" />
      )}
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => {
            action.onSelect();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors",
            action.tone === "destructive"
              ? "hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
              : "hover:bg-accent focus:bg-accent",
            "focus:outline-none"
          )}
        >
          <span>{action.label}</span>
        </button>
      ))}
      {actions.length > 0 && (
        <div className="my-1 h-px bg-border" />
      )}
      <button
        onClick={() => {
          onRename();
          onClose();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
          "hover:bg-accent transition-colors",
          "focus:outline-none focus:bg-accent"
        )}
      >
        <Pencil className="h-4 w-4" />
        <span>Rename</span>
      </button>
      <button
        onClick={() => {
          onDelete();
          onClose();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
          "hover:bg-destructive/10 hover:text-destructive transition-colors",
          "focus:outline-none focus:bg-destructive/10 focus:text-destructive"
        )}
      >
        <Trash2 className="h-4 w-4" />
        <span>Delete</span>
      </button>
    </div>
  );
}

interface DeleteConfirmDialogProps {
  fileName: string;
  itemType?: "file" | "folder";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for file deletion
 */
export function DeleteConfirmDialog({ fileName, itemType = "file", onConfirm, onCancel }: DeleteConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        <h3 className="text-lg font-semibold">{itemType === "folder" ? "Delete Folder" : "Delete File"}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Are you sure you want to delete <span className="font-medium text-foreground">{fileName}</span>?
          This action cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
