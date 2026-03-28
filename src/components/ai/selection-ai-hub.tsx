"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, History, ListTodo, Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionAiStore } from "@/stores/selection-ai-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import type { SelectionAiMode, SelectionContext } from "@/lib/ai/selection-context";
import { defaultPromptForSelectionMode } from "@/lib/ai/selection-context";
import { runSelectionAiMode } from "@/lib/ai/selection-actions";
import { getSelectionModeMeta } from "@/lib/ai/selection-ui";
import type { AiRuntimeSettings } from "@/lib/ai/types";
import type { PromptTemplate } from "@/lib/prompt/types";
import { buildSelectionOrigin } from "@/lib/ai/selection-ui";
import { buildSelectionPromptContextValues } from "@/lib/prompt/context-builders";
import { executePromptTemplateForSurface } from "@/lib/prompt/surface-actions";
import { PromptPicker } from "@/components/prompt/prompt-picker";
import { PromptEditorDialog } from "@/components/prompt/prompt-editor-dialog";
import { PromptRunSheet } from "@/components/prompt/prompt-run-sheet";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  };
}

export function SelectionAiHub({ context, initialMode = null, returnFocusTo, runMode, onClose }: SelectionAiHubProps) {
  const settings = useSettingsStore((state) => state.settings);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
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

  const modeMeta = getSelectionModeMeta(mode);
  const placeholder = useMemo(() => {
    if (!context) return "";
    return defaultPromptForSelectionMode(mode, context);
  }, [context, mode]);

  const filteredRecentPrompts = useMemo(
    () => recentPrompts.filter((item) => item.mode === mode).slice(0, 4),
    [mode, recentPrompts],
  );
  const selectionTemplates = useMemo(
    () =>
      getTemplatesForSurface("selection").filter((template) => templateMatchesMode(mode, template)),
    [getTemplatesForSurface, mode],
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
      });

      if (prompt.trim()) {
        rememberPrompt(mode, prompt);
      }
      setPreferredMode(mode);

      toast.success(
        result.kind === "proposal" ? "已生成整理计划" : mode === "agent" ? "已启动深度分析" : "已发送到快速问答",
        {
          description: result.title,
        },
      );
      onClose();
      returnFocusTo?.focus?.();
    } catch (error) {
      toast.error("AI 执行失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunning(false);
    }
  }, [
    context,
    isRunning,
    mode,
    onClose,
    promptByMode,
    selectedTemplateByMode,
    rememberPrompt,
    returnFocusTo,
    runMode,
    setPreferredMode,
    settings,
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
      });

      if (payload.renderedPrompt.trim()) {
        rememberPrompt(mode, payload.renderedPrompt);
      }
      setPreferredMode(mode);

      toast.success(
        result.kind === "proposal"
          ? "已生成整理计划"
          : result.kind === "draft"
            ? "已生成草稿"
            : mode === "agent"
              ? "已启动深度分析"
              : "已发送到快速问答",
        {
          description: result.title,
        },
      );
      onClose();
      returnFocusTo?.focus?.();
    } catch (error) {
      toast.error("AI 执行失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunning(false);
    }
  }, [context, mode, onClose, promptRunState, rememberPrompt, returnFocusTo, setPreferredMode, settings, workspaceRootPath]);

  useEffect(() => {
    if (!context) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        returnFocusTo?.focus?.();
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
  }, [context, handleModeChange, handleSubmit, onClose, returnFocusTo]);

  if (!context) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 px-4" onClick={() => {
      onClose();
      returnFocusTo?.focus?.();
    }}>
      <PromptPicker
        isOpen={isPromptPickerOpen}
        surface="selection"
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
      <div
        className="w-full max-w-5xl rounded-3xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Selection AI Hub</div>
            <h2 className="mt-1 text-xl font-semibold">{context.sourceLabel}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {context.contextSummary ?? "围绕当前选区发起快速问答、深度分析或直接生成整理计划。"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              onClose();
              returnFocusTo?.focus?.();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1.05fr_1.15fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Selected Text</span>
                <span className="rounded-full bg-background px-2 py-0.5 normal-case text-[11px] text-foreground">
                  {context.evidenceRefs.length} 个 evidence
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
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Local Context</div>
                <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {context.contextText}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {MODE_ORDER.map((candidate) => {
                const meta = getSelectionModeMeta(candidate);
                const Icon = MODE_ICONS[candidate];
                const active = mode === candidate;
                return (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => handleModeChange(candidate)}
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
                执行去向：{modeMeta.executionTarget}
              </div>
            </div>

            <div className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Prompt Templates</div>
                <button
                  type="button"
                  onClick={() => setPromptPickerOpen(true)}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-[11px] text-foreground hover:bg-accent"
                >
                  选择模板
                </button>
              </div>
              {selectedTemplateByMode[mode] && (
                <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
                  当前模板：{selectedTemplateByMode[mode]?.title}
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
                      selectedTemplateByMode[mode]?.id === template.id
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
                <span>Recent Prompts</span>
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
                  当前模式还没有最近使用的提示。成功提交后的非空 prompt 会自动记录在这里。
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">你的问题 / 指令</label>
              <textarea
                ref={textareaRef}
                value={promptByMode[mode]}
                onChange={(event) => setPromptByMode((current) => ({ ...current, [mode]: event.target.value }))}
                placeholder={selectedTemplateByMode[mode]?.title ? `可选：补充对模板的额外要求` : placeholder}
                className="min-h-[180px] w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm outline-none transition-colors focus:border-primary"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{selectedTemplateByMode[mode] ? "已选择模板，输入内容会作为补充说明。" : "留空会使用当前模式默认提示。"} Alt+1/2/3 切模式，Ctrl/Cmd+Enter 提交。</span>
                <span>{modeMeta.executionTarget}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <div className="text-xs text-muted-foreground">
            当前模式：{modeMeta.label}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                returnFocusTo?.focus?.();
              }}
              disabled={isRunning}
            >
              取消
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={isRunning}>
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isRunning ? modeMeta.runningLabel : modeMeta.submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SelectionAiHub;
