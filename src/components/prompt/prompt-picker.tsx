"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Sparkles, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import type { PromptSurface, PromptTemplate } from "@/lib/prompt/types";

interface PromptPickerProps {
  isOpen: boolean;
  surface: PromptSurface;
  workspaceKey?: string | null;
  workspaceRootPath?: string | null;
  currentInput: string;
  onClose: () => void;
  onSelectTemplate: (template: PromptTemplate) => void;
  onCreateTemplate: (seed?: { userPrompt?: string }) => void;
  onEditTemplate: (template: PromptTemplate) => void;
}

export function PromptPicker({
  isOpen,
  surface,
  workspaceKey,
  workspaceRootPath,
  currentInput,
  onClose,
  onSelectTemplate,
  onCreateTemplate,
  onEditTemplate,
}: PromptPickerProps) {
  const { t } = useI18n();
  const loadPromptState = usePromptTemplateStore((state) => state.loadPromptState);
  const getTemplatesForSurface = usePromptTemplateStore((state) => state.getTemplatesForSurface);
  const getRecentTemplates = usePromptTemplateStore((state) => state.getRecentTemplates);
  const getRecentRuns = usePromptTemplateStore((state) => state.getRecentRuns);
  const getTemplateById = usePromptTemplateStore((state) => state.getTemplateById);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useEffect(() => {
    if (isOpen) {
      void loadPromptState();
    }
  }, [isOpen, loadPromptState]);

  const recentTemplates = useMemo(
    () => getRecentTemplates(surface, {
      workspaceKey,
      workspaceRootPath,
    }),
    [getRecentTemplates, surface, workspaceKey, workspaceRootPath],
  );

  const allTemplates = useMemo(() => {
    const templates = getTemplatesForSurface(surface);
    if (categoryFilter === "all") {
      return templates;
    }

    return templates.filter((template) => template.category === categoryFilter);
  }, [categoryFilter, getTemplatesForSurface, surface]);

  const categories = useMemo(
    () => Array.from(new Set(getTemplatesForSurface(surface).map((template) => template.category))),
    [getTemplatesForSurface, surface],
  );
  const recentRuns = useMemo(() => getRecentRuns(surface).slice(0, 6), [getRecentRuns, surface]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[140] flex items-start justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-6 md:pt-20"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-6rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("prompt.picker.title")}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{t("prompt.picker.subtitle")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onCreateTemplate()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
              {t("prompt.picker.new")}
            </button>
            <button
              type="button"
              onClick={() => onCreateTemplate({ userPrompt: currentInput })}
              disabled={!currentInput.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t("prompt.picker.saveCurrent")}
            </button>
          </div>

          {recentTemplates.length > 0 && (
            <section>
              <div className="mb-2 text-sm font-medium text-foreground">{t("prompt.picker.recent")}</div>
              <div className="grid gap-2">
                {recentTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onSelectTemplate(template)}
                    className="rounded-xl border border-border bg-background px-4 py-3 text-left hover:bg-accent/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{template.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{template.description}</div>
                      </div>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        {t(`prompt.output.${template.outputMode}`)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {recentRuns.length > 0 && (
            <section>
              <div className="mb-2 text-sm font-medium text-foreground">{t("prompt.picker.runs")}</div>
              <div className="grid gap-2">
                {recentRuns.map((run) => (
                  <div key={run.id} className="rounded-xl border border-border bg-background px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                          {run.templateId ? (getTemplateById(run.templateId)?.title ?? run.templateId) : t("prompt.picker.adHoc")}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {run.contextSummary || t("prompt.run.contextEmpty")}
                        </div>
                      </div>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        {t(`prompt.output.${run.outputMode}`)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{t("prompt.picker.allTemplates")}</span>
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className={`rounded-full border px-3 py-1 text-xs ${
                  categoryFilter === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {t("prompt.picker.categoryAll")}
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    categoryFilter === category ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {t(`prompt.category.${category}`)}
                </button>
              ))}
            </div>
            <div className="grid gap-2">
              {allTemplates.map((template) => (
                <div
                  key={template.id}
                  className="rounded-xl border border-border bg-background px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectTemplate(template)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{template.title}</span>
                        {template.pinned && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                            {t("prompt.picker.pinned")}
                          </span>
                        )}
                        {template.builtin && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                            {t("prompt.picker.builtin")}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{template.description}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                        <span>{t(`prompt.category.${template.category}`)}</span>
                        <span>·</span>
                        <span>{t(`prompt.output.${template.outputMode}`)}</span>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditTemplate(template)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                      >
                        {template.builtin ? t("prompt.picker.duplicate") : t("common.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectTemplate(template)}
                        className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                      >
                        {t("prompt.picker.use")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PromptPicker;
