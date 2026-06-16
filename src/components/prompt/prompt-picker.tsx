"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Sparkles, X } from "lucide-react";
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

function PromptTemplateRow({
  template,
  onSelect,
  onEdit,
}: {
  template: PromptTemplate;
  onSelect: (template: PromptTemplate) => void;
  onEdit: (template: PromptTemplate) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(template)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(template);
        }
      }}
      className="group flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{template.title}</span>
          {template.pinned && (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {t("prompt.picker.pinned")}
            </span>
          )}
          {template.builtin && (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {t("prompt.picker.builtin")}
            </span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{template.description}</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground/80">
          <span>{t(`prompt.category.${template.category}`)}</span>
          <span>·</span>
          <span>{t(`prompt.output.${template.outputMode}`)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(template);
        }}
        className="rounded-md p-1.5 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title={template.builtin ? t("prompt.picker.duplicate") : t("common.edit")}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
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

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      className="fixed inset-y-0 right-0 z-[190] flex w-full max-w-[24rem] flex-col border-l border-border bg-background shadow-xl sm:w-[min(24rem,calc(100vw-4rem))]"
      role="dialog"
      aria-modal="false"
      aria-label={t("prompt.picker.title")}
      data-testid="prompt-picker-dock"
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("prompt.picker.title")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onCreateTemplate()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-foreground hover:bg-accent"
              title={t("prompt.picker.new")}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("prompt.picker.new")}
            </button>
            <button
              type="button"
              onClick={() => onCreateTemplate({ userPrompt: currentInput })}
              disabled={!currentInput.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
              title={t("prompt.picker.saveCurrent")}
            >
              <Save className="h-3.5 w-3.5" />
              {t("prompt.picker.saveCurrent")}
            </button>
          </div>

          {recentTemplates.length > 0 && (
            <section>
              <div className="mb-2 text-sm font-medium text-foreground">{t("prompt.picker.recent")}</div>
              <div className="grid gap-1">
                {recentTemplates.map((template) => (
                  <PromptTemplateRow
                    key={template.id}
                    template={template}
                    onSelect={onSelectTemplate}
                    onEdit={onEditTemplate}
                  />
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
            <div className="grid gap-1">
              {allTemplates.map((template) => (
                <div
                  key={template.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectTemplate(template)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectTemplate(template);
                    }
                  }}
                  className="group cursor-pointer rounded-md border border-border/60 bg-background px-2.5 py-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate text-sm font-medium text-foreground">{template.title}</span>
                        {template.pinned && (
                          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            {t("prompt.picker.pinned")}
                          </span>
                        )}
                        {template.builtin && (
                          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            {t("prompt.picker.builtin")}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{template.description}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground/80">
                        <span>{t(`prompt.category.${template.category}`)}</span>
                        <span>·</span>
                        <span>{t(`prompt.output.${template.outputMode}`)}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditTemplate(template);
                        }}
                        className="rounded-md p-1.5 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                        title={template.builtin ? t("prompt.picker.duplicate") : t("common.edit")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </aside>
  );
}

export default PromptPicker;
