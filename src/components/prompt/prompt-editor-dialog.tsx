"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Save, X } from "lucide-react";
import type {
  PromptCategory,
  PromptContextSlot,
  PromptOutputMode,
  PromptSurface,
  PromptTemplate,
} from "@/lib/prompt/types";
import { useI18n } from "@/hooks/use-i18n";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { localizePromptTemplate } from "@/lib/prompt/builtin-templates";
import { cn } from "@/lib/utils";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";

const CATEGORY_OPTIONS: PromptCategory[] = [
  "reading",
  "writing",
  "comparison",
  "planning",
  "code",
  "notebook",
  "export",
  "annotation",
];

const SURFACE_OPTIONS: PromptSurface[] = ["chat", "selection", "evidence", "workbench", "command"];
const OUTPUT_OPTIONS: PromptOutputMode[] = ["chat", "structured-chat", "draft", "proposal", "target-draft-set"];
const CONTEXT_SLOT_OPTIONS: PromptContextSlot[] = [
  "selected_text",
  "current_file",
  "current_file_content",
  "pdf_annotations",
  "selected_evidence",
  "active_draft",
  "active_proposal",
  "workspace_summary",
];

interface PromptEditorDialogProps {
  isOpen: boolean;
  surface: PromptSurface;
  template?: PromptTemplate | null;
  seedUserPrompt?: string;
  onClose: () => void;
}

export function PromptEditorDialog({
  isOpen,
  surface,
  template,
  seedUserPrompt,
  onClose,
}: PromptEditorDialogProps) {
  const { locale, t } = useI18n();
  const upsertTemplate = usePromptTemplateStore((state) => state.upsertTemplate);
  const localizedTemplate = useMemo(
    () => (template ? localizePromptTemplate(template, locale) : null),
    [locale, template],
  );
  const isEditing = Boolean(template && !template.builtin);
  const [title, setTitle] = useState(() => localizedTemplate?.title ?? "");
  const [description, setDescription] = useState(() => localizedTemplate?.description ?? "");
  const [category, setCategory] = useState<PromptCategory>(() => localizedTemplate?.category ?? "reading");
  const [systemPrompt, setSystemPrompt] = useState(() => localizedTemplate?.systemPrompt ?? "");
  const [userPrompt, setUserPrompt] = useState(() => localizedTemplate?.userPrompt ?? seedUserPrompt ?? "");
  const [surfaces, setSurfaces] = useState<PromptSurface[]>(() => localizedTemplate?.surfaces ?? [surface]);
  const [outputMode, setOutputMode] = useState<PromptOutputMode>(() => localizedTemplate?.outputMode ?? "chat");
  const [requiredContext, setRequiredContext] = useState<PromptContextSlot[]>(() => localizedTemplate?.requiredContext ?? []);
  const [optionalContext, setOptionalContext] = useState<PromptContextSlot[]>(() => localizedTemplate?.optionalContext ?? []);
  const [preferredProvider, setPreferredProvider] = useState(() => localizedTemplate?.preferredProvider ?? "");
  const [preferredModel, setPreferredModel] = useState(() => localizedTemplate?.preferredModel ?? "");
  const [pinned, setPinned] = useState(() => Boolean(localizedTemplate?.pinned));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const dialogTitle = useMemo(() => {
    if (isEditing) {
      return t("prompt.editor.edit");
    }
    if (template?.builtin) {
      return t("prompt.editor.duplicateBuiltin");
    }
    return t("prompt.editor.create");
  }, [isEditing, t, template?.builtin]);

  if (!isOpen) {
    return null;
  }

  const toggleSurface = (value: PromptSurface) => {
    setSurfaces((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  };

  const toggleContextSlot = (
    slot: PromptContextSlot,
    kind: "required" | "optional",
  ) => {
    if (kind === "required") {
      setRequiredContext((current) =>
        current.includes(slot) ? current.filter((item) => item !== slot) : [...current, slot],
      );
      if (optionalContext.includes(slot)) {
        setOptionalContext((current) => current.filter((item) => item !== slot));
      }
      return;
    }

    setOptionalContext((current) =>
      current.includes(slot) ? current.filter((item) => item !== slot) : [...current, slot],
    );
    if (requiredContext.includes(slot)) {
      setRequiredContext((current) => current.filter((item) => item !== slot));
    }
  };

  const handleSave = () => {
    if (!title.trim() || !userPrompt.trim() || surfaces.length === 0) {
      return;
    }

    upsertTemplate({
      ...(isEditing ? { id: template?.id } : {}),
      title: title.trim(),
      description: description.trim(),
      category,
      systemPrompt: systemPrompt.trim() || undefined,
      userPrompt: userPrompt.trim(),
      surfaces,
      outputMode,
      requiredContext,
      optionalContext,
      preferredProvider: preferredProvider.trim() || null,
      preferredModel: preferredModel.trim() || null,
      pinned,
    });
    onClose();
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 flex w-full max-w-[32rem] flex-col border-l border-border bg-background shadow-2xl sm:w-[min(32rem,calc(100vw-4rem))]",
        UI_LAYER_CLASS.dialogElevated,
      )}
      role="dialog"
      aria-modal="false"
      aria-label={t("prompt.editor.title")}
      data-testid="prompt-editor-dock"
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("prompt.editor.title")}
            </div>
            <h2 className="mt-1 text-sm font-medium text-foreground">{dialogTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <label className="block">
              <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.title")}</div>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t("prompt.editor.field.titlePlaceholder")}
              />
            </label>

            <label className="block">
              <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.description")}</div>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t("prompt.editor.field.descriptionPlaceholder")}
              />
            </label>

            <label className="block">
              <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.userPrompt")}</div>
              <textarea
                value={userPrompt}
                onChange={(event) => setUserPrompt(event.target.value)}
                className="min-h-[220px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t("prompt.editor.field.userPromptPlaceholder")}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => setPinned(event.target.checked)}
              />
              <span>{t("prompt.editor.field.pinned")}</span>
            </label>

            <button
              type="button"
              onClick={() => setShowAdvanced((open) => !open)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {t("prompt.editor.advanced")}
            </button>

            {showAdvanced && (
              <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                <label className="block">
                  <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.category")}</div>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value as PromptCategory)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {t(`prompt.category.${option}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <div className="mb-2 text-sm font-medium">{t("prompt.editor.field.surfaces")}</div>
                  <div className="flex flex-wrap gap-2">
                    {SURFACE_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleSurface(option)}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          surfaces.includes(option)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {t(`prompt.surface.${option}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.outputMode")}</div>
                  <select
                    value={outputMode}
                    onChange={(event) => setOutputMode(event.target.value as PromptOutputMode)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {OUTPUT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {t(`prompt.output.${option}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.systemPrompt")}</div>
                  <textarea
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    className="min-h-[120px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder={t("prompt.editor.field.systemPromptPlaceholder")}
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-sm font-medium">{t("prompt.editor.field.requiredContext")}</div>
                    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                      {CONTEXT_SLOT_OPTIONS.map((slot) => (
                        <label key={slot} className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={requiredContext.includes(slot)}
                            onChange={() => toggleContextSlot(slot, "required")}
                          />
                          <span>{t(`prompt.context.${slot}`)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-medium">{t("prompt.editor.field.optionalContext")}</div>
                    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                      {CONTEXT_SLOT_OPTIONS.map((slot) => (
                        <label key={slot} className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={optionalContext.includes(slot)}
                            onChange={() => toggleContextSlot(slot, "optional")}
                          />
                          <span>{t(`prompt.context.${slot}`)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <label className="block">
                  <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.preferredProvider")}</div>
                  <input
                    value={preferredProvider}
                    onChange={(event) => setPreferredProvider(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder={t("prompt.editor.field.preferredProviderPlaceholder")}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.preferredModel")}</div>
                  <input
                    value={preferredModel}
                    onChange={(event) => setPreferredModel(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder={t("prompt.editor.field.preferredModelPlaceholder")}
                  />
                </label>
              </div>
            )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Save className="h-4 w-4" />
            {t("common.save")}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default PromptEditorDialog;
