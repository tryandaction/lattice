"use client";

import { useCallback, useState } from "react";
import { X, XCircle, Save, FileX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaneId, TabState } from "@/stores/workspace-store";

interface TabContextMenuProps {
  paneId: PaneId;
  tabIndex: number;
  tab: TabState;
  position: { x: number; y: number };
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onCloseSaved: () => void;
}

/**
 * Context menu for tab operations
 */
export function TabContextMenu({
  paneId: _paneId,
  tabIndex: _tabIndex,
  tab: _tab,
  position,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseSaved,
}: TabContextMenuProps) {
  return (
    <>
      {/* Backdrop to close menu */}
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
      />
      
      {/* Menu */}
      <div
        className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg"
        style={{ left: position.x, top: position.y }}
      >
        <button
          onClick={() => {
            onCloseTab();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-accent"
        >
          <X className="h-4 w-4" />
          <span>Close</span>
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+W</span>
        </button>
        
        <button
          onClick={() => {
            onCloseOthers();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-accent"
        >
          <XCircle className="h-4 w-4" />
          <span>Close Others</span>
        </button>
        
        <div className="my-1 border-t border-border" />
        
        <button
          onClick={() => {
            onCloseSaved();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Save className="h-4 w-4" />
          <span>Close Saved</span>
        </button>
        
        <button
          onClick={() => {
            onCloseAll();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-accent text-destructive"
        >
          <FileX className="h-4 w-4" />
          <span>Close All</span>
        </button>
      </div>
    </>
  );
}

interface UnsavedTabsDialogProps {
  unsavedTabs: TabState[];
  onSaveAll: () => Promise<void>;
  onDiscardAll: () => void;
  onCancel: () => void;
}

/**
 * Dialog shown when closing tabs with unsaved changes
 */
export function UnsavedTabsDialog({
  unsavedTabs,
  onSaveAll,
  onDiscardAll,
  onCancel,
}: UnsavedTabsDialogProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSaveAll();
    } finally {
      setIsSaving(false);
    }
  }, [onSaveAll]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
      
      {/* Dialog */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Unsaved Changes</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The following files have unsaved changes:
        </p>
        
        <ul className="mt-3 max-h-40 overflow-auto rounded border border-border bg-muted/30 p-2">
          {unsavedTabs.map((tab) => (
            <li key={tab.filePath} className="flex items-center gap-2 py-1 text-sm">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="truncate">{tab.fileName}</span>
            </li>
          ))}
        </ul>
        
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={onDiscardAll}
            className="rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
          >
            Discard All
          </button>
          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className={cn(
              "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90",
              isSaving && "opacity-50 cursor-not-allowed"
            )}
          >
            {isSaving ? "Saving..." : "Save All"}
          </button>
        </div>
      </div>
    </>
  );
}
