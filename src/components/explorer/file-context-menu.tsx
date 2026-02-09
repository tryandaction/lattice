"use client";

import { useState, useRef, useEffect } from "react";
import { Trash2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileContextMenuProps {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Context menu for file operations
 * Adjusts position to stay within viewport bounds
 */
export function FileContextMenu({ x, y, onRename, onDelete, onClose }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
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

      if (adjustedX !== x || adjustedY !== y) {
        setPosition({ x: adjustedX, y: adjustedY });
      }
    }
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
      style={{ left: position.x, top: position.y }}
    >
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
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for file deletion
 */
export function DeleteConfirmDialog({ fileName, onConfirm, onCancel }: DeleteConfirmDialogProps) {
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
        <h3 className="text-lg font-semibold">Delete File</h3>
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
