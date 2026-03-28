"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { renderPromptTemplate } from "@/lib/prompt/render";
import type {
  PromptContextSlot,
  PromptContextValues,
  PromptSurface,
  PromptTemplate,
} from "@/lib/prompt/types";

interface PromptRunContextControl {
  key: string;
  label: string;
  description: string;
  checked: boolean;
}

interface PromptRunSheetProps {
  isOpen: boolean;
  surface: PromptSurface;
  template: PromptTemplate | null;
  contextValues: PromptContextValues;
  contextControls?: PromptRunContextControl[];
  isContextUpdating?: boolean;
  initialPromptAppend?: string;
  onClose: () => void;
  onContextControlChange?: (key: string, checked: boolean) => void;
  onConfirm: (payload: {
    renderedPrompt: string;
    renderedSystemPrompt?: string;
    contextSummary: string;
  }) => void;
}

function formatContextSlots(t: ReturnType<typeof useI18n>["t"], slots: PromptContextSlot[]): string {
  return slots.map((slot) => t(`prompt.context.${slot}`)).join(", ");
}

export function PromptRunSheet({
  isOpen,
  surface,
  template,
  contextValues,
  contextControls,
  isContextUpdating = false,
  initialPromptAppend,
  onClose,
  onContextControlChange,
  onConfirm,
}: PromptRunSheetProps) {
  const { t } = useI18n();
  const rendered = useMemo(
    () => (template ? renderPromptTemplate(template, contextValues) : null),
    [contextValues, template],
  );
  const initialPrompt = useMemo(() => {
    if (!rendered) {
      return "";
    }

    const append = initialPromptAppend?.trim();
    if (!append) {
      return rendered.renderedPrompt;
    }

    return `${rendered.renderedPrompt}\n\n# Additional Instruction\n${append}`;
  }, [initialPromptAppend, rendered]);
  const [editablePrompt, setEditablePrompt] = useState(() => initialPrompt);
  const [editableSystemPrompt, setEditableSystemPrompt] = useState(() => rendered?.renderedSystemPrompt ?? "");

  useEffect(() => {
    setEditablePrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    setEditableSystemPrompt(rendered?.renderedSystemPrompt ?? "");
  }, [rendered?.renderedSystemPrompt]);

  if (!isOpen || !template || !rendered) {
    return null;
  }

  const canRun = !isContextUpdating && rendered.missingRequiredContext.length === 0;

  return (
    <div className="fixed inset-0 z-[160] flex items-end justify-end bg-black/45" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("prompt.run.title")}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{template.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`prompt.surface.${surface}`)} · {t(`prompt.output.${template.outputMode}`)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section>
            <div className="mb-2 text-sm font-medium text-foreground">{t("prompt.run.contextSummary")}</div>
            <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              {rendered.contextSummary || t("prompt.run.contextEmpty")}
            </div>
          </section>

          {contextControls && contextControls.length > 0 && onContextControlChange && (
            <section>
              <div className="mb-2 text-sm font-medium text-foreground">{t("prompt.run.contextControls")}</div>
              <div className="space-y-2 rounded-xl border border-border bg-muted/10 px-4 py-3">
                {contextControls.map((control) => (
                  <label key={control.key} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-border"
                      checked={control.checked}
                      onChange={(event) => onContextControlChange(control.key, event.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">{control.label}</span>
                      <span className="block text-xs text-muted-foreground">{control.description}</span>
                    </span>
                  </label>
                ))}
                {isContextUpdating && (
                  <div className="text-xs text-muted-foreground">{t("prompt.run.contextUpdating")}</div>
                )}
              </div>
            </section>
          )}

          {rendered.missingRequiredContext.length > 0 && (
            <section className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
              <div className="text-sm font-medium text-destructive">{t("prompt.run.missingRequired")}</div>
              <div className="mt-1 text-xs text-destructive/80">
                {formatContextSlots(t, rendered.missingRequiredContext)}
              </div>
            </section>
          )}

          {rendered.missingOptionalContext.length > 0 && (
            <section className="rounded-xl border border-border bg-muted/10 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{t("prompt.run.missingOptional")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatContextSlots(t, rendered.missingOptionalContext)}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 text-sm font-medium text-foreground">{t("prompt.run.systemPrompt")}</div>
            <textarea
              value={editableSystemPrompt}
              onChange={(event) => setEditableSystemPrompt(event.target.value)}
              className="min-h-[120px] w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
              placeholder={t("prompt.run.systemPromptPlaceholder")}
            />
          </section>

          <section>
            <div className="mb-2 text-sm font-medium text-foreground">{t("prompt.run.finalPrompt")}</div>
            <textarea
              value={editablePrompt}
              onChange={(event) => setEditablePrompt(event.target.value)}
              className="min-h-[260px] w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
            />
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
        <div className="text-xs text-muted-foreground">
            {t("prompt.run.readyState", { state: isContextUpdating ? t("prompt.run.contextUpdatingShort") : canRun ? t("prompt.run.ready") : t("prompt.run.blocked") })}
        </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => onConfirm({
                renderedPrompt: editablePrompt,
                renderedSystemPrompt: editableSystemPrompt.trim() || undefined,
                contextSummary: rendered.contextSummary,
              })}
              disabled={!canRun}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {t("prompt.run.execute")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PromptRunSheet;
