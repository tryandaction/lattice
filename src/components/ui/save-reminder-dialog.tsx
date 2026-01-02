"use client";

import { useState } from "react";
import { AlertTriangle, Save, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SaveReminderDialogProps {
  isOpen: boolean;
  fileName: string;
  onSave: () => Promise<void>;
  onDontSave: () => void;
  onCancel: () => void;
}

/**
 * Save Reminder Dialog
 * 
 * Displays a modal dialog when user attempts to close a tab with unsaved changes.
 * Offers three options: Save, Don't Save, and Cancel.
 */
export function SaveReminderDialog({
  isOpen,
  fileName,
  onSave,
  onDontSave,
  onCancel,
}: SaveReminderDialogProps) {
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } catch (error) {
      console.error("Failed to save:", error);
      // Keep dialog open on error
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && !isSaving) {
      handleSave();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">
              保存更改？
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              文件 "<span className="font-medium text-foreground">{fileName}</span>" 有未保存的更改。
            </p>
          </div>
        </div>

        {/* Message */}
        <p className="mt-4 text-sm text-muted-foreground">
          如果不保存，您的更改将会丢失。
        </p>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
              "border border-border bg-background text-foreground",
              "hover:bg-muted transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <X className="h-4 w-4" />
            取消
          </button>

          <button
            onClick={onDontSave}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
              "border border-destructive/50 bg-destructive/10 text-destructive",
              "hover:bg-destructive/20 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Trash2 className="h-4 w-4" />
            不保存
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Save className="h-4 w-4" />
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
