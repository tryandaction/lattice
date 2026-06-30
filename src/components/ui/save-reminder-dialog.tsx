"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Save, Trash2, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";

export interface SaveReminderDialogProps {
  isOpen: boolean;
  fileName: string;
  onSave: () => Promise<void>;
  onDontSave: () => void;
  onCancel: () => void;
}

export function SaveReminderDialog({
  isOpen,
  fileName,
  onSave,
  onDontSave,
  onCancel,
}: SaveReminderDialogProps) {
  const { t } = useI18n();
  const [isSaving, setIsSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousActiveElement?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } catch (error) {
      console.error("Failed to save:", error);
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "Enter" && !isSaving) {
      event.preventDefault();
      void handleSave();
    }
  };

  return createPortal(
    <div
      className={cn("fixed inset-0 flex items-center justify-center overflow-y-auto px-4 py-6", UI_LAYER_CLASS.dialog)}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-reminder-title"
        aria-describedby="save-reminder-description"
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl outline-none max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="save-reminder-title" className="text-lg font-semibold text-foreground">
              {t("saveReminder.title")}
            </h2>
            <p id="save-reminder-description" className="mt-1 text-sm text-muted-foreground">
              {t("saveReminder.description", { fileName })}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          {t("saveReminder.warning")}
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
              "border border-border bg-background text-foreground hover:bg-muted transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <X className="h-4 w-4" />
            {t("common.cancel")}
          </button>

          <button
            type="button"
            onClick={onDontSave}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
              "border border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Trash2 className="h-4 w-4" />
            {t("saveReminder.dontSave")}
          </button>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
              "hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Save className="h-4 w-4" />
            {isSaving ? t("tab.context.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
