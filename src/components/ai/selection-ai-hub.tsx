"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, History, ListTodo, Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionAiStore } from "@/stores/selection-ai-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import type { SelectionAiMode, SelectionContext } from "@/lib/ai/selection-context";
import { defaultPromptForSelectionMode } from "@/lib/ai/selection-context";
import { runSelectionAiMode } from "@/lib/ai/selection-actions";
import { buildSelectionOrigin, getSelectionModeMeta } from "@/lib/ai/selection-ui";
import type { AiRuntimeSettings } from "@/lib/ai/types";
import type { PromptTemplate } from "@/lib/prompt/types";
import { buildSelectionPromptContextValues } from "@/lib/prompt/context-builders";
import { executePromptTemplateForSurface } from "@/lib/prompt/surface-actions";
import { localizePromptTemplates } from "@/lib/prompt/builtin-templates";
import { PromptPicker } from "@/components/prompt/prompt-picker";
import { PromptEditorDialog } from "@/components/prompt/prompt-editor-dialog";
import { PromptRunSheet } from "@/components/prompt/prompt-run-sheet";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";

interface SelectionAiHubProps {
  context: SelectionContext | null;
  initialMode?: SelectionAiMode | null;
  returnFocusTo?: HTMLElement | null;
  runMode?: typeof runSelectionAiMode;
  onClose: () => void;
}

const MODE_ICONS: Record<SelectionAiMode, typeof Sparkles> = {
  chat: MessageSquare,
  agent: Bot,
  plan: ListTodo,
};

const MODE_ORDER: SelectionAiMode[] = ["chat", "agent", "plan"];

const MODE_OUTPUT_ALLOWLIST = {
  chat: ["chat", "structured-chat"],
  agent: ["chat", "structured-chat", "draft"],
  plan: ["proposal", "draft"],
} as const;

function templateMatchesMode(mode: SelectionAiMode, template: PromptTemplate): boolean {
  return MODE_OUTPUT_ALLOWLIST[mode].some((outputMode) => outputMode === template.outputMode);
}

function toRuntimeSettings(settings: ReturnType<typeof useSettingsStore.getState>["settings"]): AiRuntimeSettings {
  return {
    aiEnabled: settings.aiEnabled,
    providerId: (settings.aiProvider as AiRuntimeSettings["providerId"]) ?? null,
    model: settings.aiModel,
    temperature: settings.aiTemperature,
    maxTokens: settings.aiMaxTokens,
    systemPrompt: settings.aiSystemPrompt,
    preferLocal: settings.aiProvider === "ollama",
    agentOmittedSummaryEnabled: settings.aiAgentOmittedSummaryEnabled,
  };
}

export function SelectionAiHub({ context, initialMode = null, returnFocusTo, runMode, onClose }: SelectionAiHubProps) {
  const { locale, t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const preferredMode = useSelectionAiStore((state) => state.preferredMode);
  const recentPrompts = useSelectionAiStore((state) => state.recentPrompts);
  const setPreferredMode = useSelectionAiStore((state) => state.setPreferredMode);
  const rememberPrompt = useSelectionAiStore((state) => state.rememberPrompt);
  const loadPromptState = usePromptTemplateStore((state) => state.loadPromptState);
  const getTemplatesForSurface = usePromptTemplateStore((state) => state.getTemplatesForSurface);
  const [mode, setMode] = useState<SelectionAiMode>(initialMode ?? preferredMode);
  const [promptByMode, setPromptByMode] = useState<Record<SelectionAiMode, string>>({
    chat: "",
    agent: "",
    plan: "",
  });
  const [selectedTemplateByMode, setSelectedTemplateByMode] = useState<Record<SelectionAiMode, PromptTemplate | null>>({
    chat: null,
    agent: null,
    plan: null,
  });
  const [isPromptPickerOpen, setPromptPickerOpen] = useState(false);
  const [promptEditorState, setPromptEditorState] = useState<{
    template?: PromptTemplate | null;
    seedUserPrompt?: string;
  } | null>(null);
  const [promptRunState, setPromptRunState] = useState<{
    template: PromptTemplate;
    additionalInstruction?: string;
  } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contextIdentity = useMemo(
    () => (context ? `${context.filePath ?? context.fileName}:${context.selectedText}` : null),
    [context],
  );
  const initialHubMode = initialMode ?? preferredMode;

  const modeMeta = getSelectionModeMeta(mode, locale);
  const placeholder = useMemo(() => {
    if (!context) return "";
    return defaultPromptForSelectionMode(mode, context, locale);
  }, [context, locale, mode]);

  const filteredRecentPrompts = useMemo(
    () => recentPrompts.filter((item) => item.mode === mode).slice(0, 4),
    [mode, recentPrompts],
  );
  const selectionTemplates = useMemo(
    () => localizePromptTemplates(getTemplatesForSurface("selection"), locale)
      .filter((template) => templateMatchesMode(mode, template)),
    [getTemplatesForSurface, locale, mode],
  );

  useEffect(() => {
    void loadPromptState();
  }, [loadPromptState]);

  useEffect(() => {
    if (!context) {
      return;
    }

    setMode(initialHubMode);
    if (initialMode) {
      setPreferredMode(initialMode);
    }
  }, [context, contextIdentity, initialHubMode, initialMode, setPreferredMode]);

  useEffect(() => {
    if (!context) return;
    const rafId = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [contextIdentity, context]);

  const handleModeChange = useCallback((nextMode: SelectionAiMode) => {
    setMode(nextMode);
    setPreferredMode(nextMode);
  }, [setPreferredMode]);

  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    returnFocusTo?.focus?.();
  }, [onClose, returnFocusTo]);

  const showRunSuccess = useCallback((kind: "chat" | "draft" | "proposal") => {
    if (kind === "proposal") {
      toast.success(t("ai.selection.toast.proposalCreated"));
      return;
    }
    if (kind === "draft") {
      toast.success(t("prompt.run.toast.draftCreated"));
      return;
    }
    toast.success(mode === "agent" ? t("ai.selection.toast.agentStarted") : t("ai.selection.toast.quickSent"));
  }, [mode, t]);

  const handleSubmit = useCallback(async () => {
    if (!context || isRunning) {
      return;
    }

    const selectedTemplate = selectedTemplateByMode[mode];
    if (selectedTemplate) {
      setPromptRunState({
        template: selectedTemplate,
        additionalInstruction: promptByMode[mode].trim() || undefined,
      });
      return;
    }

    setIsRunning(true);
    try {
      const prompt = promptByMode[mode];
      const executeMode = runMode ?? runSelectionAiMode;
      const result = await executeMode({
        context,
        mode,
        prompt,
        settings: toRuntimeSettings(settings),
        locale,
      });

      if (prompt.trim()) {
        rememberPrompt(mode, prompt);
      }
      setPreferredMode(mode);

      showRunSuccess(result.kind === "proposal" ? "proposal" : "chat");
      closeAndRestoreFocus();
    } catch (error) {
      toast.error(t("ai.selection.toast.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunning(false);
    }
  }, [
    closeAndRestoreFocus,
    context,
    isRunning,
    locale,
    mode,
    promptByMode,
    rememberPrompt,
    runMode,
    selectedTemplateByMode,
    setPreferredMode,
    settings,
    showRunSuccess,
    t,
  ]);

  const handlePromptTemplateConfirm = useCallback(async (payload: {
    renderedPrompt: string;
    renderedSystemPrompt?: string;
    contextSummary: string;
  }) => {
    if (!context || !promptRunState) {
      return;
    }

    const origin = buildSelectionOrigin(context, mode);
    setPromptRunState(null);
    setIsRunning(true);
    try {
      const result = await executePromptTemplateForSurface({
        template: promptRunState.template,
        surface: "selection",
        settings: toRuntimeSettings(settings),
        contextValues: buildSelectionPromptContextValues(context),
        workspaceKey,
        workspaceRootPath,
        renderedPrompt: payload.renderedPrompt,
        renderedSystemPrompt: payload.renderedSystemPrompt,
        contextSummary: payload.contextSummary,
        filePath: context.filePath,
        content: context.contextText ?? context.selectedText,
        selection: context.selectedText,
        query: payload.renderedPrompt,
        explicitEvidenceRefs: context.evidenceRefs,
        origin,
        locale,
      });

      if (payload.renderedPrompt.trim()) {
        rememberPrompt(mode, payload.renderedPrompt);
      }
      setPreferredMode(mode);

      showRunSuccess(result.kind);
      closeAndRestoreFocus();
    } catch (error) {
      toast.error(t("ai.selection.toast.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunning(false);
    }
  }, [
    closeAndRestoreFocus,
    context,
    locale,
    mode,
    promptRunState,
    rememberPrompt,
    setPreferredMode,
    settings,
    showRunSuccess,
    t,
    workspaceKey,
    workspaceRootPath,
  ]);

  useEffect(() => {
    if (!context) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSubmit();
        return;
      }

      if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "1") {
          event.preventDefault();
          handleModeChange("chat");
        } else if (event.key === "2") {
          event.preventDefault();
          handleModeChange("agent");
        } else if (event.key === "3") {
          event.preventDefault();
          handleModeChange("plan");
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeAndRestoreFocus, context, handleModeChange, handleSubmit]);

  if (!context) {
    return null;
  }

  const selectedTemplate = selectedTemplateByMode[mode];
  const promptHint = selectedTemplate
    ? t("ai.selection.promptHint.templateSelected")
    : t("ai.selection.promptHint.default");

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 flex w-full max-w-[34rem] flex-col border-l border-border bg-background shadow-2xl sm:w-[min(34rem,calc(100vw-4rem))]",
        UI_LAYER_CLASS.dialogElevated,
      )}
      role="dialog"
      aria-modal="false"
      aria-label={t("ai.selection.aria")}
      data-testid="selection-ai-dock"
    >
      <PromptPicker
        isOpen={isPromptPickerOpen}
        surface="selection"
        workspaceKey={workspaceKey}
        workspaceRootPath={workspaceRootPath}
        currentInput={promptByMode[mode]}
        onClose={() => setPromptPickerOpen(false)}
        onSelectTemplate={(template) => {
          setSelectedTemplateByMode((current) => ({ ...current, [mode]: template }));
          setPromptPickerOpen(false);
        }}
        onCreateTemplate={(seed) => {
          setPromptPickerOpen(false);
          setPromptEditorState({ seedUserPrompt: seed?.userPrompt ?? promptByMode[mode] });
        }}
        onEditTemplate={(template) => {
          setPromptPickerOpen(false);
          setPromptEditorState({ template });
        }}
      />
      <PromptEditorDialog
        key={`selection-prompt-editor:${promptEditorState?.template?.id ?? "new"}:${promptEditorState?.seedUserPrompt ?? ""}`}
        isOpen={Boolean(promptEditorState)}
        surface="selection"
        template={promptEditorState?.template ?? null}
        seedUserPrompt={promptEditorState?.seedUserPrompt}
        onClose={() => setPromptEditorState(null)}
      />
      <PromptRunSheet
        key={`selection-prompt-run:${promptRunState?.template.id ?? "none"}:${promptRunState?.additionalInstruction ?? ""}:${context?.filePath ?? context?.fileName ?? ""}:${context?.selectedText ?? ""}`}
        isOpen={Boolean(promptRunState && context)}
        surface="selection"
        template={promptRunState?.template ?? null}
        contextValues={context ? buildSelectionPromptContextValues(context) : {}}
        initialPromptAppend={promptRunState?.additionalInstruction}
        onClose={() => setPromptRunState(null)}
        onConfirm={(payload) => void handlePromptTemplateConfirm(payload)}
      />
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <div className="flex items-start justify-between border-b border-border px-4 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("ai.selection.title")}
            </div>
            <h2 className="mt-1 text-xl font-semibold text-foreground">{context.sourceLabel}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {context.contextSummary ?? t("ai.selection.defaultSummary")}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={closeAndRestoreFocus} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>{t("ai.selection.selectedText")}</span>
                <span className="rounded-full bg-background px-2 py-0.5 normal-case text-[11px] text-foreground">
                  {t("ai.selection.evidenceCount", { count: context.evidenceRefs.length })}
                </span>
                {context.anchor?.blockLabel && (
                  <span className="rounded-full bg-background px-2 py-0.5 normal-case text-[11px] text-foreground">
                    {context.anchor.blockLabel}
                  </span>
                )}
              </div>
              <div className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {context.selectedText}
              </div>
            </div>

            {context.contextText && (
              <div className="rounded-2xl border border-border bg-background p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("ai.selection.localContext")}
                </div>
                <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {context.contextText}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {MODE_ORDER.map((candidate) => {
                const meta = getSelectionModeMeta(candidate, locale);
                const Icon = MODE_ICONS[candidate];
                const active = mode === candidate;
                return (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => handleModeChange(candidate)}
                    data-testid={`selection-ai-mode-${candidate}`}
                    className={cn(
                      "rounded-2xl border px-3 py-3 text-left transition-colors",
                      active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{meta.shortLabel}</span>
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {meta.label}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                {mode === "chat" && <MessageSquare className="h-4 w-4 text-muted-foreground" />}
                {mode === "agent" && <Bot className="h-4 w-4 text-muted-foreground" />}
                {mode === "plan" && <ListTodo className="h-4 w-4 text-muted-foreground" />}
                <span>{modeMeta.label}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {modeMeta.description}
              </p>
              <div className="mt-2 rounded-xl bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                {t("ai.selection.executionTarget", { target: modeMeta.executionTarget })}
              </div>
            </div>

            <div className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{t("prompt.picker.title")}</div>
                <button
                  type="button"
                  onClick={() => setPromptPickerOpen(true)}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-[11px] text-foreground hover:bg-accent"
                >
                  {t("ai.selection.chooseTemplate")}
                </button>
              </div>
              {selectedTemplate && (
                <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
                  {t("ai.selection.currentTemplate", { title: selectedTemplate.title })}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {selectionTemplates.slice(0, 6).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplateByMode((current) => ({ ...current, [mode]: template }))}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[11px]",
                      selectedTemplate?.id === template.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    {template.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4 text-muted-foreground" />
                <span>{t("ai.selection.recentPrompts")}</span>
              </div>
              {filteredRecentPrompts.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {filteredRecentPrompts.map((item) => (
                    <button
                      key={`${item.mode}:${item.createdAt}`}
                      type="button"
                      onClick={() => setPromptByMode((current) => ({ ...current, [mode]: item.prompt }))}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-[11px] text-foreground hover:bg-accent"
                    >
                      {item.prompt}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("ai.selection.noRecentPrompts")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("ai.selection.inputLabel")}</label>
              <textarea
                ref={textareaRef}
                value={promptByMode[mode]}
                onChange={(event) => setPromptByMode((current) => ({ ...current, [mode]: event.target.value }))}
                placeholder={selectedTemplate ? t("ai.selection.templateInstructionPlaceholder") : placeholder}
                className="min-h-[180px] w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{promptHint} {t("ai.selection.shortcutHint")}</span>
                <span>{modeMeta.executionTarget}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">
            {t("ai.selection.currentMode", { mode: modeMeta.label })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={closeAndRestoreFocus}
              disabled={isRunning}
              data-testid="selection-ai-cancel"
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={isRunning} data-testid="selection-ai-submit">
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isRunning ? modeMeta.runningLabel : modeMeta.submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default SelectionAiHub;
