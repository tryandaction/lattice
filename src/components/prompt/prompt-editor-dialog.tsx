"use client";

import { useMemo, useState } from "react";
import { Save, X } from "lucide-react";
import type {
  PromptCategory,
  PromptContextSlot,
  PromptOutputMode,
  PromptSurface,
  PromptTemplate,
} from "@/lib/prompt/types";
import { useI18n } from "@/hooks/use-i18n";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";

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
  const { t } = useI18n();
  const upsertTemplate = usePromptTemplateStore((state) => state.upsertTemplate);
  const isEditing = Boolean(template && !template.builtin);
  const [title, setTitle] = useState(() => template?.title ?? "");
  const [description, setDescription] = useState(() => template?.description ?? "");
  const [category, setCategory] = useState<PromptCategory>(() => template?.category ?? "reading");
  const [systemPrompt, setSystemPrompt] = useState(() => template?.systemPrompt ?? "");
  const [userPrompt, setUserPrompt] = useState(() => template?.userPrompt ?? seedUserPrompt ?? "");
  const [surfaces, setSurfaces] = useState<PromptSurface[]>(() => template?.surfaces ?? [surface]);
  const [outputMode, setOutputMode] = useState<PromptOutputMode>(() => template?.outputMode ?? "chat");
  const [requiredContext, setRequiredContext] = useState<PromptContextSlot[]>(() => template?.requiredContext ?? []);
  const [optionalContext, setOptionalContext] = useState<PromptContextSlot[]>(() => template?.optionalContext ?? []);
  const [preferredProvider, setPreferredProvider] = useState(() => template?.preferredProvider ?? "");
  const [preferredModel, setPreferredModel] = useState(() => template?.preferredModel ?? "");
  const [pinned, setPinned] = useState(() => Boolean(template?.pinned));

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
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 px-4">
      <div className="w-full max-w-4xl rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("prompt.editor.title")}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{dialogTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-5 px-6 py-5 lg:grid-cols-2">
          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
            <label className="block">
              <div className="mb-1 text-sm font-medium">{t("prompt.editor.field.userPrompt")}</div>
              <textarea
                value={userPrompt}
                onChange={(event) => setUserPrompt(event.target.value)}
                className="min-h-[160px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t("prompt.editor.field.userPromptPlaceholder")}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium">{t("prompt.editor.field.requiredContext")}</div>
                <div className="space-y-2 rounded-lg border border-border p-3">
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
                <div className="space-y-2 rounded-lg border border-border p-3">
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

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => setPinned(event.target.checked)}
              />
              <span>{t("prompt.editor.field.pinned")}</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
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
    </div>
  );
}

export default PromptEditorDialog;
