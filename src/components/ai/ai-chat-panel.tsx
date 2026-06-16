"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAiChatStore, type ChatMessage } from "@/stores/ai-chat-store";
import type { AiChatContinuationContext } from "@/stores/ai-chat-store";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { aiOrchestrator } from "@/lib/ai/orchestrator";
import { X, Send, Square, Plus, Trash2, MessageSquare, Copy, Check, GitCompareArrows, Bot, FileText, ShieldCheck, Wand2, ChevronDown, ChevronUp, ChevronRight, FolderPen, FileOutput, ListTodo, Save, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/renderers/markdown-renderer";
import { useI18n } from "@/hooks/use-i18n";
import { MentionAutocomplete } from "./mention-autocomplete";
import { DiffPreview } from "./diff-preview";
import { EvidencePanel } from "./evidence-panel";
import { AgentTracePanel } from "./agent-trace-panel";
import { AgentMemoryPanel } from "./agent-memory-panel";
import { PromptPicker } from "@/components/prompt/prompt-picker";
import { PromptEditorDialog } from "@/components/prompt/prompt-editor-dialog";
import { parseMentions, resolveMentions } from "@/lib/ai/mention-resolver";
import { extractCodeBlocks } from "@/lib/ai/diff-utils";
import { deriveFileId } from "@/lib/annotation-storage";
import { migrateLegacyAnnotation } from "@/lib/annotation-migration";
import { navigateLink } from "@/lib/link-router/navigate-link";
import {
  applyDraftArtifactsToWorkspace,
  buildDraftArtifactsFromProposal,
  buildDraftArtifactDefaultPath,
  formatTaskProposalDraftContent,
  getProposalTargetDrafts,
  summarizeProposalTargetDrafts,
  writeDraftArtifactToTarget,
} from "@/lib/ai/workbench-actions";
import type {
  AiDraftArtifact,
  AiDraftWriteMode,
  AiRuntimeSettings,
  AiTaskProposal,
  EvidenceRef,
  SelectionAiOrigin,
} from "@/lib/ai/types";
import type { PromptContextValues, PromptTemplate } from "@/lib/prompt/types";
import { renderPromptTemplate } from "@/lib/prompt/render";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { toast } from "sonner";
import { buildAiResultViewModel, type AiResultSectionViewModel, type AiResultViewModel } from "@/lib/ai/result-view-model";
import { isFileTabState } from "@/types/layout";
import { executeUserApprovedAgentTool } from "@/lib/ai/agent-tool-broker";
import { runResearchAgentForChat } from "@/lib/ai/research-agent-chat-runner";
import { getAllProviders } from "@/lib/ai/providers";
import type { AiProviderId } from "@/lib/ai/types";
import { getResearchAgentWorkflow } from "@/lib/ai/research-agent-workflows";
import {
  buildAgentComposerViewModel,
  type AgentComposerEffort,
  type AgentComposerMode,
  type AgentComposerViewModel,
} from "@/lib/ai/agent-composer-view-model";
import { focusAgentSession } from "@/lib/ai/agent-session-focus";

interface ChatPromptContextOptions {
  includeCurrentFileContent: boolean;
  includeAnnotations: boolean;
  includeWorkspaceSummary: boolean;
}

const DEFAULT_CHAT_PROMPT_CONTEXT_OPTIONS: ChatPromptContextOptions = {
  includeCurrentFileContent: false,
  includeAnnotations: false,
  includeWorkspaceSummary: false,
};

async function readWorkspaceFile(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<string> {
  const parts = filePath.split("/").filter(Boolean);
  let directory = rootHandle;
  for (let index = 0; index < parts.length - 1; index += 1) {
    directory = await directory.getDirectoryHandle(parts[index]);
  }
  const fileHandle = await directory.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return file.text();
}

async function resolveActiveFileContent(
  activeTab: ReturnType<typeof useWorkspaceStore.getState>["getActiveTab"] extends () => infer T ? T : never,
  activeContent: string | null,
): Promise<string | undefined> {
  if (typeof activeContent === "string") {
    return activeContent;
  }
  if (!activeTab) {
    return undefined;
  }
  if (!isFileTabState(activeTab)) {
    return activeContent ?? undefined;
  }
  try {
    const file = await activeTab.fileHandle.getFile();
    return await file.text();
  } catch {
    return undefined;
  }
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

function buildWorkspaceSummary(
  rootHandle: FileSystemDirectoryHandle | null,
  filePath: string | undefined,
): string | null {
  if (!rootHandle && !filePath) {
    return null;
  }

  return [
    rootHandle ? `Workspace: ${rootHandle.name}` : null,
    filePath ? `Active file: ${filePath}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

async function createWorkbenchDraftWithTrace(input: {
  draft: Omit<AiDraftArtifact, "id" | "createdAt" | "status">;
  task: string;
  title?: string;
  evidenceRefs?: EvidenceRef[];
  approvalNote?: string;
}): Promise<string> {
  const result = await executeUserApprovedAgentTool({
    name: "workbench.createDraft",
    args: { draft: input.draft },
  }, {
    profile: "research",
    task: input.task,
    title: input.title,
    evidenceRefs: input.evidenceRefs ?? input.draft.sourceRefs,
    approvalNote: input.approvalNote ?? "User explicitly requested draft creation from the AI workbench.",
  });

  const draftId = result.result?.draftId;
  if (!draftId) {
    throw new Error("Draft creation did not return an artifact id.");
  }
  return draftId;
}

async function createWorkbenchProposalWithTrace(input: {
  proposal: AiTaskProposal;
  task: string;
  title?: string;
  approvalNote?: string;
}): Promise<string> {
  const result = await executeUserApprovedAgentTool({
    name: "workbench.createProposal",
    args: { proposal: input.proposal },
  }, {
    profile: "research",
    task: input.task,
    title: input.title,
    evidenceRefs: input.proposal.sourceRefs,
    approvalNote: input.approvalNote ?? "User explicitly requested proposal creation from the AI workbench.",
  });

  const proposalId = result.result?.proposalId;
  if (!proposalId) {
    throw new Error("Proposal creation did not return an artifact id.");
  }
  return proposalId;
}

function formatAnnotationContext(
  annotations: Array<{
    target?: { type?: string; page?: number; line?: number };
    comment?: string;
    content?: string;
  }>,
): string | null {
  if (annotations.length === 0) {
    return null;
  }

  return annotations
    .slice(0, 20)
    .map((annotation, index) => {
      const targetLabel = annotation.target?.type === "pdf"
        ? `Page ${annotation.target.page ?? "?"}`
        : annotation.target?.type === "code_line"
          ? `Line ${annotation.target.line ?? "?"}`
          : annotation.target?.type ?? "annotation";
      const note = annotation.comment?.trim() || annotation.content?.trim() || "[no text]";
      return `${index + 1}. ${targetLabel}: ${note}`;
    })
    .join("\n");
}

export function AiChatPanel({
  className,
  onClose,
}: {
  className?: string;
  onClose?: () => void;
} = {}) {
  const isOpen = useAiChatStore((s) => s.isOpen);
  const setOpen = useAiChatStore((s) => s.setOpen);
  const loadConversations = useAiChatStore((s) => s.loadConversations);
  const settings = useSettingsStore((state) => state.settings);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const getCachedContent = useContentCacheStore((state) => state.getContent);
  const activeConversation = useAiChatStore((state) =>
    state.conversations.find((conversation) => conversation.id === state.activeConversationId) ?? null
  );
  const [isEvidencePanelOpen, setEvidencePanelOpen] = useState(false);
  const [focusedEvidenceMessageId, setFocusedEvidenceMessageId] = useState<string | null>(null);
  const lastAutoOpenedSelectionAgentId = useRef<string | null>(null);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const evidenceMessages = useMemo(
    () => (activeConversation?.messages ?? []).filter((message) =>
      message.role === "assistant" && ((message.evidenceRefs?.length ?? 0) > 0 || (message.promptContext?.nodes?.length ?? 0) > 0)
    ),
    [activeConversation?.messages]
  );

  const isEvidencePanelVisible = isEvidencePanelOpen && evidenceMessages.length > 0;

  const selectedEvidenceMessage = useMemo(() => {
    if (!isEvidencePanelVisible) {
      return null;
    }
    return (
      evidenceMessages.find((message) => message.id === focusedEvidenceMessageId) ??
      evidenceMessages[evidenceMessages.length - 1] ??
      null
    );
  }, [evidenceMessages, focusedEvidenceMessageId, isEvidencePanelVisible]);

  useEffect(() => {
    const candidate = (activeConversation?.messages ?? [])
      .filter((message) =>
        message.role === "assistant" &&
        message.origin?.kind === "selection-ai" &&
        message.origin.mode === "agent" &&
        (((message.evidenceRefs?.length ?? 0) > 0) || ((message.promptContext?.nodes?.length ?? 0) > 0))
      )
      .at(-1);

    if (!candidate || candidate.id === lastAutoOpenedSelectionAgentId.current) {
      return;
    }

    lastAutoOpenedSelectionAgentId.current = candidate.id;
    startTransition(() => {
      setFocusedEvidenceMessageId(candidate.id);
      setEvidencePanelOpen(true);
    });
  }, [activeConversation?.messages]);

  const handleCreateEvidenceDraft = useCallback((input: {
    title: string;
    content: string;
    refs: EvidenceRef[] | undefined;
  }) => {
    void createWorkbenchDraftWithTrace({
      draft: {
        type: "paper_note",
        title: input.title,
        sourceRefs: input.refs ?? [],
        content: input.content,
      },
      task: `Create evidence draft: ${input.title}`,
      title: input.title,
      evidenceRefs: input.refs ?? [],
      approvalNote: "User clicked save draft from the Evidence Panel.",
    }).catch((error) => {
      toast.error("Failed to create draft", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  }, []);

  const handleProposeEvidenceTask = useCallback(async (input: {
    prompt: string;
    refs: EvidenceRef[] | undefined;
  }) => {
    const activeContent = await resolveActiveFileContent(
      activeTab,
      activeTab ? (typeof getCachedContent(activeTab.id)?.content === "string" ? getCachedContent(activeTab.id)?.content as string : null) : null,
    );

    const proposal = await aiOrchestrator.proposeTask({
      prompt: input.prompt,
      filePath: activeTab?.filePath,
      content: activeContent,
      explicitEvidenceRefs: input.refs ?? [],
      settings: toRuntimeSettings(settings),
    });
    await createWorkbenchProposalWithTrace({
      proposal,
      task: `Create evidence proposal: ${input.prompt.slice(0, 80)}`,
      title: "Evidence proposal",
      approvalNote: "User clicked generate plan from the Evidence Panel.",
    });
  }, [activeTab, getCachedContent, settings]);

  if (!isOpen) return null;

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <ChatHeader onClose={() => {
        if (onClose) {
          onClose();
          return;
        }
        setOpen(false);
      }} />
      <EvidencePanel
        message={selectedEvidenceMessage}
        messages={evidenceMessages}
        selectedMessageId={selectedEvidenceMessage?.id ?? null}
        onSelectMessage={setFocusedEvidenceMessageId}
        onCreateDraft={handleCreateEvidenceDraft}
        onProposeTask={handleProposeEvidenceTask}
        onClose={() => setEvidencePanelOpen(false)}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatMessages
        onOpenEvidence={(messageId) => {
          if (isEvidencePanelVisible && selectedEvidenceMessage?.id === messageId) {
            setEvidencePanelOpen(false);
            return;
          }
          setFocusedEvidenceMessageId(messageId);
          setEvidencePanelOpen(true);
        }}
        selectedEvidenceMessageId={selectedEvidenceMessage?.id ?? null}
        isEvidencePanelOpen={isEvidencePanelVisible}
        />
      </div>
      <AgentMemoryPanel />
      <AgentTracePanel />
      <WorkbenchPanel />
      <ChatInput />
    </div>
  );
}

function ChatHeader({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const newConversation = useAiChatStore((s) => s.newConversation);
  const activeId = useAiChatStore((s) => s.activeConversationId);
  const deleteConv = useAiChatStore((s) => s.deleteConversation);

  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('chat.title')}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => newConversation()}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t('chat.newChat')}
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {activeId && (
          <button
            onClick={() => deleteConv(activeId)}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t('chat.deleteChat')}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t('common.close')}
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-all"
      title={copied ? t('chat.copied') : t('chat.copy')}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

function EvidenceSummaryButton({
  messageId,
  evidenceCount,
  contextCount,
  selected,
  open,
  onToggle,
}: {
  messageId: string;
  evidenceCount: number;
  contextCount: number;
  selected: boolean;
  open: boolean;
  onToggle: (messageId: string) => void;
}) {
  const { t } = useI18n();
  if (evidenceCount === 0 && contextCount === 0) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => onToggle(messageId)}
      className={cn(
        "mt-2 inline-flex items-center gap-2 rounded border px-2 py-1 text-[10px] text-muted-foreground transition-colors",
        selected
          ? "border-border bg-background/80 text-foreground"
          : "border-border/60 bg-background/50 hover:bg-accent/40"
      )}
    >
      <ShieldCheck className="h-3 w-3" />
      <span>{t("chat.evidenceCount", { count: evidenceCount })}</span>
      <span>/</span>
      <span>{t("chat.contextCount", { count: contextCount })}</span>
      {open && selected ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
    </button>
  );
}

function FollowUpActions({
  messageId,
  content,
  filePath,
  contentForFile,
  evidenceRefs,
  followUpActions,
  draftSuggestion,
}: {
  messageId: string;
  content: string;
  filePath?: string;
  contentForFile?: string;
  evidenceRefs: EvidenceRef[];
  followUpActions?: ChatMessage["followUpActions"];
  draftSuggestion?: ChatMessage["draftSuggestion"];
}) {
  const settings = useSettingsStore((state) => state.settings);
  const { t } = useI18n();
  const [draftSaved, setDraftSaved] = useState(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalDone, setProposalDone] = useState(false);
  const hasDraftAction = (followUpActions ?? []).some((action) => action.kind === "create_draft");
  const hasProposalAction = (followUpActions ?? []).some((action) => action.kind === "propose_task");

  const handleCreateDraft = useCallback(async () => {
    try {
      await createWorkbenchDraftWithTrace({
        draft: {
          type: draftSuggestion?.type ?? "paper_note",
          templateId: draftSuggestion?.templateId,
          title: draftSuggestion?.title || `AI Draft ${messageId}`,
          sourceRefs: evidenceRefs,
          content: draftSuggestion?.content ?? content,
          targetPath: draftSuggestion?.targetPath,
          writeMode: draftSuggestion?.writeMode,
          originMessageId: messageId,
        },
        task: `Create draft from message ${messageId}`,
        title: draftSuggestion?.title || `AI Draft ${messageId}`,
        evidenceRefs,
        approvalNote: "User clicked save draft from an AI chat message.",
      });
      setDraftSaved(true);
    } catch (error) {
      toast.error("Failed to create draft", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    content,
    draftSuggestion?.content,
    draftSuggestion?.targetPath,
    draftSuggestion?.templateId,
    draftSuggestion?.title,
    draftSuggestion?.type,
    draftSuggestion?.writeMode,
    evidenceRefs,
    messageId,
  ]);

  const handleProposeTask = useCallback(async () => {
    setProposalBusy(true);
    try {
      const proposal = await aiOrchestrator.proposeTask({
        prompt: content,
        filePath,
        content: contentForFile,
        explicitEvidenceRefs: evidenceRefs,
        settings: toRuntimeSettings(settings),
      });
      await createWorkbenchProposalWithTrace({
        proposal,
        task: `Create proposal from message ${messageId}`,
        title: proposal.summary,
        approvalNote: "User clicked generate proposal from an AI chat message.",
      });
      setProposalDone(true);
    } catch (error) {
      toast.error("Failed to create proposal", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProposalBusy(false);
    }
  }, [content, contentForFile, evidenceRefs, filePath, messageId, settings]);

  if (!hasDraftAction && !hasProposalAction) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {hasDraftAction ? (
        <button
          onClick={handleCreateDraft}
          data-testid="ai-chat-follow-up-save-draft"
          className="inline-flex items-center gap-1 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-foreground hover:bg-accent"
          disabled={draftSaved}
        >
          <FileText className="h-3 w-3" />
          {draftSaved ? t("chat.workbench.draftSaved") : t("chat.workbench.saveDraft")}
        </button>
      ) : null}
      {hasProposalAction ? (
        <button
          onClick={() => void handleProposeTask()}
          data-testid="ai-chat-follow-up-generate-proposal"
          className="inline-flex items-center gap-1 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
          disabled={proposalBusy || proposalDone}
        >
          <Wand2 className="h-3 w-3" />
          {proposalDone ? t("chat.workbench.proposalReady") : proposalBusy ? t("chat.workbench.generating") : t("chat.workbench.generateProposal")}
        </button>
      ) : null}
    </div>
  );
}

function draftStatusLabel(status: string, t: ReturnType<typeof useI18n>["t"]): string {
  switch (status) {
    case "applied":
      return t("chat.workbench.status.applied");
    case "approved":
      return t("chat.workbench.status.approved");
    case "discarded":
      return t("chat.workbench.status.discarded");
    default:
      return t("chat.workbench.status.draft");
  }
}

function proposalStatusLabel(status: string, t: ReturnType<typeof useI18n>["t"]): string {
  switch (status) {
    case "approved":
      return t("chat.workbench.status.approved");
    case "discarded":
      return t("chat.workbench.status.rejected");
    default:
      return t("chat.workbench.status.pending");
  }
}

function ComposerToolbar({
  view,
  isModelQuickSwitchOpen,
  draftProviderId,
  draftModelId,
  aiProviders,
  onModeChange,
  onToggleModelQuickSwitch,
  onDraftProviderChange,
  onDraftModelChange,
  onApplyModelQuickSwitch,
  onCloseModelQuickSwitch,
  onEffortChange,
  onOpenPromptPicker,
  onToggleAdvanced,
}: {
  view: AgentComposerViewModel;
  isModelQuickSwitchOpen: boolean;
  draftProviderId: AiProviderId | "";
  draftModelId: string;
  aiProviders: ReturnType<typeof getAllProviders>;
  onModeChange: (mode: AgentComposerMode) => void;
  onToggleModelQuickSwitch: () => void;
  onDraftProviderChange: (providerId: AiProviderId | "") => void;
  onDraftModelChange: (modelId: string) => void;
  onApplyModelQuickSwitch: () => void;
  onCloseModelQuickSwitch: () => void;
  onEffortChange: (effort: AgentComposerEffort) => void;
  onOpenPromptPicker: () => void;
  onToggleAdvanced: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5" aria-label={t("chat.mode")}>
        <button
          type="button"
          onClick={() => onModeChange("chat")}
          aria-pressed={view.mode === "chat"}
          data-testid="ai-chat-mode-chat"
          className={cn(
            "rounded px-2.5 py-1 text-[11px] transition-colors",
            view.mode === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={() => onModeChange("agent")}
          aria-pressed={view.isAgentMode}
          data-testid="ai-chat-mode-agent"
          className={cn(
            "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] transition-colors",
            view.isAgentMode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          title={t("chat.researchAgent.hint")}
        >
          <Bot className="h-3 w-3" />
          Agent
        </button>
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={onToggleModelQuickSwitch}
          className="min-w-0 max-w-[180px] truncate rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title={view.modelLabel}
          data-testid="ai-chat-model-switch"
        >
          {view.modelLabel}
        </button>
        {isModelQuickSwitchOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-md border border-border bg-popover p-2 shadow-lg">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("chat.model.quickSwitch")}
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] text-muted-foreground">
                {t("settings.ai.providerLabel")}
                <select
                  value={draftProviderId}
                  onChange={(event) => onDraftProviderChange(event.currentTarget.value as AiProviderId | "")}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="">{t("chat.model.auto")}</option>
                  {aiProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] text-muted-foreground">
                {t("settings.ai.modelLabel")}
                <input
                  type="text"
                  value={draftModelId}
                  onChange={(event) => onDraftModelChange(event.currentTarget.value)}
                  placeholder={t("settings.ai.modelPlaceholder")}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                />
              </label>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCloseModelQuickSwitch}
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={onApplyModelQuickSwitch}
                  className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90"
                >
                  {t("common.apply")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {view.isAgentMode && (
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5" aria-label={t("chat.agentEffort")}>
          {(["low", "medium", "high"] as const).map((effort) => (
            <button
              key={effort}
              type="button"
              onClick={() => onEffortChange(effort)}
              aria-pressed={view.effort === effort}
              data-testid={`ai-chat-agent-effort-${effort}`}
              className={cn(
                "rounded px-2 py-1 text-[11px] transition-colors",
                view.effort === effort ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              title={t(`chat.agentEffort.${effort}`)}
            >
              {t(`chat.agentEffort.${effort}`)}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onOpenPromptPicker}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground hover:bg-accent"
      >
        <Wand2 className="h-3.5 w-3.5" />
        {t("prompt.chat.open")}
      </button>
      {view.isAgentMode && (
        <button
          type="button"
          onClick={onToggleAdvanced}
          aria-expanded={view.advancedOpen}
          aria-controls="ai-chat-agent-advanced-panel"
          data-testid="ai-chat-agent-advanced-toggle"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {view.advancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {t("chat.agentAdvanced")}
        </button>
      )}
    </div>
  );
}

function ComposerAdvancedPanel({
  view,
  input,
  onSuggestMemoryChange,
  onClearWorkflow,
  onSaveCurrentPrompt,
}: {
  view: AgentComposerViewModel;
  input: string;
  onSuggestMemoryChange: (checked: boolean) => void;
  onClearWorkflow: () => void;
  onSaveCurrentPrompt: () => void;
}) {
  const { t } = useI18n();

  if (!view.advancedOpen) {
    return null;
  }

  return (
    <div
      id="ai-chat-agent-advanced-panel"
      data-testid="ai-chat-agent-advanced-panel"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5"
    >
      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={view.suggestMemory}
          onChange={(event) => onSuggestMemoryChange(event.currentTarget.checked)}
          className="h-3 w-3 accent-primary"
        />
        <span>{t("chat.researchAgent.memorySuggestions")}</span>
      </label>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="ai-chat-agent-workflow-label">
        <span>{t("chat.researchAgent.workflow")}: {view.workflowLabel}</span>
        <span className="rounded border border-border/60 px-1 text-[10px] uppercase tracking-wide">
          {view.workflowSelectionMode}
        </span>
        {view.canClearWorkflow && (
          <button
            type="button"
            onClick={onClearWorkflow}
            data-testid="ai-chat-agent-workflow-clear"
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t("common.clear")}
            aria-label={t("common.clear")}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onSaveCurrentPrompt}
        disabled={!input.trim()}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
      >
        <Save className="h-3 w-3" />
        {t("prompt.chat.saveCurrent")}
      </button>
    </div>
  );
}

function selectionOriginModeLabel(mode: SelectionAiOrigin["mode"], t: ReturnType<typeof useI18n>["t"]): string {
  switch (mode) {
    case "agent":
      return t("chat.selection.agent");
    case "plan":
      return t("chat.selection.plan");
    default:
      return t("chat.selection.quick");
  }
}

function SelectionOriginBadge({
  origin,
  compact = false,
}: {
  origin: SelectionAiOrigin;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={cn(
      "mt-1 rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]",
      compact && "mt-2",
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-primary">
          Selection AI / {selectionOriginModeLabel(origin.mode, t)}
        </span>
        <span className="text-foreground">{origin.sourceLabel}</span>
      </div>
      {!compact && (
        <div className="mt-1 text-muted-foreground">
          {t("chat.selection.preview", { preview: origin.selectionPreview })}
        </div>
      )}
    </div>
  );
}

function AgentResultSection({
  section,
  messageId,
  index,
}: {
  section: AiResultSectionViewModel;
  messageId: string;
  index: number;
}) {
  const isAnswer = section.title === "Answer" || section.kind === "conclusion";
  if (isAnswer) {
    return (
      <div className="text-xs leading-relaxed ai-chat-markdown [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
        <MarkdownRenderer content={section.content} className="text-xs" />
      </div>
    );
  }

  const contentLines = section.content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const isCompactAgentSection = section.title === "Run" || section.title === "Workbench" || section.title === "Plan" || section.title === "Observations";

  return (
    <div
      className={cn(
        "border-t border-border/60 pt-2",
        !isCompactAgentSection && "rounded-md border border-border/60 bg-background/60 p-2",
      )}
      data-agent-section={`${messageId}:${section.title}:${index}`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{section.title}</span>
        {section.title === "Observations" && contentLines[0]?.startsWith("Summary:") && (
          <span className="normal-case tracking-normal text-muted-foreground/70">
            {contentLines[0].replace(/^Summary:\s*/, "")}
          </span>
        )}
      </div>
      {section.title === "Observations" && contentLines[0]?.startsWith("Summary:") ? (
        <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          {contentLines.slice(1).map((line, lineIndex) => (
            <div key={`${messageId}:${section.title}:${index}:${lineIndex}`} className="break-words">
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] leading-relaxed ai-chat-markdown text-muted-foreground [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0.5">
          <MarkdownRenderer content={section.content} className="text-xs" />
        </div>
      )}
    </div>
  );
}

function AgentResultSections({
  resultView,
  messageId,
}: {
  resultView: AiResultViewModel;
  messageId: string;
}) {
  return (
    <div className="space-y-2">
      {resultView.sections.map((section, index) => (
        <AgentResultSection
          key={`${messageId}:${section.title}:${index}`}
          section={section}
          messageId={messageId}
          index={index}
        />
      ))}
    </div>
  );
}

function WorkbenchPanel() {
  const { t } = useI18n();
  const drafts = useAiWorkbenchStore((state) => state.drafts);
  const proposals = useAiWorkbenchStore((state) => state.proposals);
  const highlightedProposalId = useAiWorkbenchStore((state) => state.highlightedProposalId);
  const updateDraftStatus = useAiWorkbenchStore((state) => state.updateDraftStatus);
  const updateDraftWriteConfig = useAiWorkbenchStore((state) => state.updateDraftWriteConfig);
  const markDraftApplied = useAiWorkbenchStore((state) => state.markDraftApplied);
  const updateProposalStatus = useAiWorkbenchStore((state) => state.updateProposalStatus);
  const toggleProposalApproval = useAiWorkbenchStore((state) => state.toggleProposalApproval);
  const toggleProposalWriteSelection = useAiWorkbenchStore((state) => state.toggleProposalWriteSelection);
  const markProposalDraftTargets = useAiWorkbenchStore((state) => state.markProposalDraftTargets);
  const clearProposal = useAiWorkbenchStore((state) => state.clearProposal);
  const clearHighlightedProposal = useAiWorkbenchStore((state) => state.clearHighlightedProposal);
  const loadWorkbench = useAiWorkbenchStore((state) => state.loadWorkbench);
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const [expanded, setExpanded] = useState(false);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [expandedProposalIds, setExpandedProposalIds] = useState<string[]>([]);
  const proposalCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const standaloneDrafts = useMemo(
    () => drafts.filter((draft) => !draft.originProposalId),
    [drafts],
  );

  useEffect(() => {
    if (drafts.length > 0 || proposals.length > 0) {
      setExpanded(true);
    }
  }, [drafts.length, proposals.length]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  useEffect(() => {
    if (!highlightedProposalId) {
      return;
    }

    setExpanded(true);
    setExpandedProposalIds((current) => current.includes(highlightedProposalId)
      ? current
      : [...current, highlightedProposalId]);

    const rafId = window.requestAnimationFrame(() => {
      const targetCard = proposalCardRefs.current[highlightedProposalId];
      if (targetCard && typeof targetCard.scrollIntoView === "function") {
        targetCard.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    });
    const timer = window.setTimeout(() => {
      clearHighlightedProposal();
    }, 2200);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [clearHighlightedProposal, highlightedProposalId]);

  const handleApplyDraft = useCallback(async (draftId: string) => {
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft || !rootHandle) {
      toast.error(t("chat.workbench.toast.applyDraftUnavailable"), {
        description: t("chat.workbench.toast.workspaceUnavailable"),
      });
      return;
    }

    setBusyDraftId(draftId);
    try {
      const writeMode = draft.writeMode ?? "create";
      const targetPath = draft.targetPath?.trim() || undefined;
      const result = await writeDraftArtifactToTarget(rootHandle, draft, {
        targetPath,
        writeMode,
      });
      openFileInPane(activePaneId, result.handle, result.path);
      markDraftApplied(draftId, result.path, writeMode);
      toast.success(t("chat.workbench.toast.applyDraftSuccess"), {
        description: result.path,
      });
    } catch (error) {
      toast.error(t("chat.workbench.toast.applyDraftFailed"), {
        description: error instanceof Error ? error.message : t("common.unknownError"),
      });
    } finally {
      setBusyDraftId(null);
    }
  }, [activePaneId, drafts, markDraftApplied, openFileInPane, rootHandle, t]);

  const handleOpenDraftTarget = useCallback(async (targetPath: string) => {
    const success = await navigateLink(targetPath, {
      paneId: activePaneId,
      rootHandle,
    });
    if (!success) {
      toast.error(t("chat.workbench.toast.openDraftFailed"), {
        description: targetPath,
      });
    }
  }, [activePaneId, rootHandle, t]);

  const toggleProposalExpanded = useCallback((proposalId: string) => {
    setExpandedProposalIds((current) =>
      current.includes(proposalId)
        ? current.filter((item) => item !== proposalId)
        : [...current, proposalId]
    );
  }, []);

  const handleCreateProposalDraft = useCallback(async (proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return;
    }

    try {
      await createWorkbenchDraftWithTrace({
        draft: {
          type: "task_plan",
          templateId: "task-plan",
          title: `Plan - ${proposal.summary.slice(0, 80)}`,
          sourceRefs: proposal.sourceRefs,
          content: formatTaskProposalDraftContent(proposal),
          writeMode: "create",
          originProposalId: proposal.id,
        },
        task: `Create plan draft for proposal ${proposal.id}`,
        title: `Plan - ${proposal.summary.slice(0, 80)}`,
        evidenceRefs: proposal.sourceRefs,
        approvalNote: "User clicked generate plan draft in AI Workbench.",
      });
      toast.success(t("chat.workbench.toast.proposalDraftSaved"), {
        description: proposal.summary,
      });
    } catch (error) {
      toast.error(t("prompt.run.toast.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [proposals, t]);

  const handleApproveProposal = useCallback((proposalId: string) => {
    updateProposalStatus(proposalId, "approved");
    toast.success(t("chat.workbench.toast.proposalApproved"));
  }, [t, updateProposalStatus]);

  const handleDiscardProposal = useCallback((proposalId: string) => {
    updateProposalStatus(proposalId, "discarded");
    toast(t("chat.workbench.toast.proposalRejected"));
  }, [t, updateProposalStatus]);

  const handleCreateTargetDrafts = useCallback(async (proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return;
    }

    const draftsToCreate = buildDraftArtifactsFromProposal(proposal);
    if (draftsToCreate.length === 0) {
      toast(t("chat.workbench.toast.noTargetDrafts"), {
        description: t("chat.workbench.toast.noTargetDraftsDescription"),
      });
      return;
    }

    const generatedTargets: string[] = [];
    try {
      for (const draft of draftsToCreate) {
        await createWorkbenchDraftWithTrace({
          draft,
          task: `Create target draft for proposal ${proposal.id}`,
          title: draft.title,
          evidenceRefs: draft.sourceRefs,
          approvalNote: "User clicked generate target drafts in AI Workbench.",
        });
        if (draft.targetPath) {
          generatedTargets.push(draft.targetPath);
        }
      }

      if (proposal.status === "pending") {
        updateProposalStatus(proposalId, "approved");
      }
      markProposalDraftTargets(proposalId, generatedTargets);
      toast.success(t("chat.workbench.toast.generatedDrafts", { count: draftsToCreate.length }), {
        description: proposal.summary,
      });
    } catch (error) {
      toast.error(t("prompt.run.toast.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [markProposalDraftTargets, proposals, t, updateProposalStatus]);

  const handleApplyProposalDrafts = useCallback(async (proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal || !rootHandle) {
      toast.error(t("chat.workbench.toast.applyDraftsUnavailable"), {
        description: t("chat.workbench.toast.workspaceUnavailable"),
      });
      return;
    }

    const targetDrafts = getProposalTargetDrafts(proposal, drafts);
    if (targetDrafts.length === 0) {
      toast(t("chat.workbench.toast.noProposalDrafts"));
      return;
    }

    setBusyProposalId(proposalId);
    try {
      const results = await applyDraftArtifactsToWorkspace(rootHandle, targetDrafts);
      const successes = results.filter((result) => result.ok);
      const failures = results.filter((result) => !result.ok);

      successes.forEach((result) => {
        const draft = targetDrafts.find((item) => item.id === result.draftId);
        if (draft && result.path) {
          markDraftApplied(draft.id, result.path, result.writeMode);
        }
      });

      const firstSuccess = successes[0];
      if (firstSuccess?.handle && firstSuccess.path) {
        openFileInPane(activePaneId, firstSuccess.handle, firstSuccess.path);
      }

      if (successes.length > 0) {
        toast.success(t("chat.workbench.toast.appliedDrafts", { count: successes.length }), {
          description: failures.length > 0
            ? t("chat.workbench.toast.partialFailure", { count: failures.length })
            : proposal.summary,
        });
      } else {
        toast.error(t("chat.workbench.toast.applyDraftsFailed"), {
          description: failures[0]?.error ?? t("common.unknownError"),
        });
      }
    } finally {
      setBusyProposalId(null);
    }
  }, [activePaneId, drafts, markDraftApplied, openFileInPane, proposals, rootHandle, t]);

  if (drafts.length === 0 && proposals.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border bg-background/95">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FolderPen className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{t("chat.workbench.title")}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{t("chat.workbench.drafts", { count: drafts.length })}</span>
          <span>{t("chat.workbench.proposals", { count: proposals.length })}</span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>
      {expanded && (
        <div className="max-h-64 space-y-3 overflow-y-auto border-t border-border/60 px-3 py-3">
          {standaloneDrafts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <FileOutput className="h-3 w-3" />
                {t("chat.workbench.standaloneDrafts")}
              </div>
              {standaloneDrafts.map((draft) => (
                <div key={draft.id} className="rounded border border-border/60 bg-background/60 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">{draft.title}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {draftStatusLabel(draft.status, t)} / {t("chat.evidenceCount", { count: draft.sourceRefs.length })}
                      </div>
                    </div>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {draft.templateId ?? draft.type}
                    </span>
                  </div>
                  <div className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">
                    {draft.content}
                  </div>
                  {draft.status !== "discarded" && (
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          type="text"
                          value={draft.targetPath ?? ""}
                          onChange={(event) =>
                            updateDraftWriteConfig(draft.id, { targetPath: event.target.value })
                          }
                          placeholder={buildDraftArtifactDefaultPath(draft)}
                          className="h-8 rounded border border-border/70 bg-background/80 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/70"
                          disabled={draft.status === "applied"}
                        />
                        <select
                          value={draft.writeMode ?? "create"}
                          onChange={(event) =>
                            updateDraftWriteConfig(draft.id, {
                              writeMode: event.target.value as AiDraftWriteMode,
                            })
                          }
                          className="h-8 rounded border border-border/70 bg-background/80 px-2 text-[11px] text-foreground"
                          disabled={draft.status === "applied"}
                        >
                          <option value="create">create</option>
                          <option value="append">append</option>
                        </select>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {(draft.writeMode ?? "create") === "append"
                          ? t("chat.workbench.appendHint")
                          : t("chat.workbench.defaultPathHint", { path: buildDraftArtifactDefaultPath(draft) })}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.status !== "applied" && draft.status !== "discarded" && (
                      <button
                        type="button"
                        onClick={() => void handleApplyDraft(draft.id)}
                        disabled={
                          busyDraftId === draft.id ||
                          ((draft.writeMode ?? "create") === "append" && !(draft.targetPath?.trim()))
                        }
                        className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
                      >
                        {busyDraftId === draft.id ? t("chat.workbench.applying") : t("chat.workbench.approveAndApply")}
                      </button>
                    )}
                    {draft.status === "applied" && draft.targetPath && (
                      <button
                        type="button"
                        onClick={() => void handleOpenDraftTarget(draft.targetPath!)}
                        className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent"
                      >
                        {t("chat.workbench.openTarget")}
                      </button>
                    )}
                    {draft.status !== "discarded" && (
                      <button
                        type="button"
                        onClick={() => updateDraftStatus(draft.id, "discarded")}
                        className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        {t("chat.workbench.discard")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {proposals.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <ListTodo className="h-3 w-3" />
                {t("chat.workbench.proposalSection")}
              </div>
              {proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  ref={(node) => {
                    proposalCardRefs.current[proposal.id] = node;
                  }}
                  className={cn(
                    "rounded border border-border/60 bg-background/60 p-2 transition-colors",
                    proposal.id === highlightedProposalId && "border-primary/50 bg-primary/5 shadow-sm",
                  )}
                >
                  {(() => {
                    const draftSummary = summarizeProposalTargetDrafts(proposal, drafts);
                    const linkedDrafts = drafts.filter((draft) => draft.originProposalId === proposal.id);
                    return (
                      <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{proposal.summary}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {t("chat.workbench.proposalMeta", {
                          steps: proposal.steps.length,
                          writes: proposal.plannedWrites.length,
                          evidence: proposal.sourceRefs.length,
                        })}
                      </div>
                      {proposal.generatedDraftTargets.length > 0 && (
                        <div className="mt-1 text-[10px] text-muted-foreground/80">
                          {t("chat.workbench.generatedDrafts", { count: proposal.generatedDraftTargets.length })}
                        </div>
                      )}
                      {proposal.origin && (
                        <SelectionOriginBadge origin={proposal.origin} compact />
                      )}
                      {draftSummary.total > 0 && (
                        <div className="mt-1 text-[10px] text-muted-foreground/80">
                          {t("chat.workbench.draftSummary", {
                            ready: draftSummary.ready,
                            applied: draftSummary.applied,
                            blocked: draftSummary.blocked,
                          })}
                        </div>
                      )}
                      {linkedDrafts.length > 0 && (
                        <div className="mt-1 text-[10px] text-muted-foreground/80">
                          {t("chat.workbench.linkedDrafts", { count: linkedDrafts.length })}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {proposalStatusLabel(proposal.status, t)}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleProposalExpanded(proposal.id)}
                        className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                      >
                        {expandedProposalIds.includes(proposal.id)
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  {expandedProposalIds.includes(proposal.id) && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("chat.workbench.steps")}</div>
                        <div className="space-y-1">
                          {proposal.steps.map((step, index) => (
                            <div key={step.id} className="rounded border border-border/50 px-2 py-1.5 text-[11px]">
                              <div className="font-medium text-foreground">{index + 1}. {step.title}</div>
                              <div className="mt-0.5 text-muted-foreground">{step.description}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {linkedDrafts.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("chat.workbench.linkedDraftsTitle")}</div>
                          <div className="space-y-1">
                            {linkedDrafts.map((draft) => (
                              <div key={draft.id} className="rounded border border-border/50 px-2 py-1.5 text-[11px]">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-foreground">{draft.title}</div>
                                    <div className="truncate text-[10px] text-muted-foreground">
                                      {draft.targetPath ?? buildDraftArtifactDefaultPath(draft)}
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                                    {draftStatusLabel(draft.status, t)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("chat.workbench.requiredApprovals")}</div>
                        <div className="space-y-1">
                          {proposal.requiredApprovals.map((approval) => (
                            <label key={`${proposal.id}:${approval}`} className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5 text-[11px] text-foreground">
                              <input
                                type="checkbox"
                                checked={proposal.confirmedApprovals.includes(approval)}
                                onChange={() => toggleProposalApproval(proposal.id, approval)}
                                disabled={proposal.status !== "pending"}
                                className="h-3.5 w-3.5 rounded border-border"
                              />
                              <span>{approval}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {proposal.plannedWrites.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("chat.workbench.plannedWrites")}</div>
                          <div className="space-y-1">
                            {proposal.plannedWrites.map((write) => (
                              <label
                                key={`${proposal.id}:${write.targetPath}`}
                                className="flex gap-2 rounded border border-border/50 px-2 py-1.5 text-[11px]"
                              >
                                <input
                                  type="checkbox"
                                  checked={proposal.approvedWrites.includes(write.targetPath)}
                                  onChange={() => toggleProposalWriteSelection(proposal.id, write.targetPath)}
                                  disabled={proposal.status !== "pending"}
                                  className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                                />
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-foreground">{write.targetPath}</div>
                                  <div className="text-muted-foreground">{write.mode}</div>
                                  {write.contentPreview && (
                                    <div className="mt-0.5 line-clamp-2 text-muted-foreground/80">{write.contentPreview}</div>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleCreateProposalDraft(proposal.id)}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent"
                          disabled={proposal.status === "discarded"}
                        >
                          {t("chat.workbench.generatePlanDraft")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCreateTargetDrafts(proposal.id)}
                          disabled={
                            proposal.status === "discarded" ||
                            !proposal.requiredApprovals.every((approval) => proposal.confirmedApprovals.includes(approval)) ||
                            proposal.approvedWrites.length === 0 ||
                            proposal.plannedWrites
                              .filter((write) => proposal.approvedWrites.includes(write.targetPath))
                              .every((write) => proposal.generatedDraftTargets.includes(write.targetPath))
                          }
                          className={cn(
                            "rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50",
                            proposal.id === highlightedProposalId &&
                              proposal.origin?.kind === "selection-ai" &&
                              proposal.origin.mode === "plan" &&
                              "border-primary/50 bg-primary/10",
                          )}
                        >
                          {t("chat.workbench.generateTargetDrafts")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleApplyProposalDrafts(proposal.id)}
                          disabled={busyProposalId === proposal.id || draftSummary.ready === 0}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          {busyProposalId === proposal.id ? t("chat.workbench.bulkApplying") : t("chat.workbench.applyTargetDrafts")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveProposal(proposal.id)}
                          disabled={
                            proposal.status !== "pending" ||
                            !proposal.requiredApprovals.every((approval) => proposal.confirmedApprovals.includes(approval)) ||
                            (proposal.plannedWrites.length > 0 && proposal.approvedWrites.length === 0)
                          }
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          {t("chat.workbench.approveProposal")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscardProposal(proposal.id)}
                          disabled={proposal.status === "discarded"}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                        >
                          {t("chat.workbench.rejectProposal")}
                        </button>
                        <button
                          type="button"
                          onClick={() => clearProposal(proposal.id)}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                        >
                          {t("common.close")}
                        </button>
                      </div>
                    </div>
                  )}
                </>);
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatMessages({
  onOpenEvidence,
  selectedEvidenceMessageId,
  isEvidencePanelOpen,
}: {
  onOpenEvidence: (messageId: string) => void;
  selectedEvidenceMessageId: string | null;
  isEvidencePanelOpen: boolean;
}) {
  const { t } = useI18n();
  const conv = useAiChatStore((s) => s.getActiveConversation());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [diffState, setDiffState] = useState<{ msgId: string; code: string } | null>(null);
  const activeTab = useWorkspaceStore((s) => s.getActiveTab());
  const activeContent = useContentCacheStore((s) => {
    if (!activeTab) return null;
    const cached = s.getContent(activeTab.id);
    return typeof cached?.content === 'string' ? cached.content : null;
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conv?.messages]);

  if (!conv || conv.messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">
          {t('chat.empty')}
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {conv.messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "text-sm rounded-lg px-3 py-2 group relative",
            msg.role === "user"
              ? "bg-primary/10 ml-4"
              : "bg-muted mr-4",
            msg.origin?.kind === "selection-ai" && "ring-1 ring-primary/15"
          )}
        >
          {(() => {
            const resultView = msg.role === "assistant" ? buildAiResultViewModel(msg) : null;
            return (
              <>
          <div className="text-[10px] text-muted-foreground mb-1 uppercase">
            {msg.role === "user" ? t('chat.you') : t('chat.ai')}
          </div>
          {msg.origin?.kind === "selection-ai" && (
            <SelectionOriginBadge origin={msg.origin} />
          )}
          {msg.role === "assistant" ? (
            <>
              {resultView ? (
                <div className="space-y-2">
                  <AgentResultSections resultView={resultView} messageId={msg.id} />
                  {msg.isStreaming && <span className="animate-pulse text-xs">...</span>}
                </div>
              ) : (
                <div className="text-xs leading-relaxed ai-chat-markdown [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                  <MarkdownRenderer content={msg.content} className="text-xs" />
                  {msg.isStreaming && <span className="animate-pulse">...</span>}
                </div>
              )}
              {msg.model && (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  <span>{msg.model.providerName}</span>
                  {msg.model.model && <span>/ {msg.model.model}</span>}
                  <span>/ {msg.model.source === "local" ? t("chat.model.local") : t("chat.model.cloud")}</span>
                </div>
              )}
              <EvidenceSummaryButton
                messageId={msg.id}
                evidenceCount={resultView?.evidenceCount ?? 0}
                contextCount={resultView?.contextCount ?? 0}
                selected={selectedEvidenceMessageId === msg.id}
                open={isEvidencePanelOpen}
                onToggle={onOpenEvidence}
              />
              {msg.usage && (
                <div className="text-[9px] text-muted-foreground/60 mt-1">
                    {msg.usage.totalTokens} tokens ({msg.usage.promptTokens} -&gt; {msg.usage.completionTokens})
                </div>
              )}
              {!msg.isStreaming && msg.content && (
                <div className="flex items-center gap-1 mt-1">
                  <CopyMessageButton text={msg.content} />
                  {msg.agentResult?.sessionId && (
                    <button
                      onClick={() => {
                        focusAgentSession(useAgentSessionStore.getState(), msg.agentResult?.sessionId, "trace");
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={t("chat.agentResult.openTrace")}
                    >
                      <ListTodo className="w-3 h-3" />
                    </button>
                  )}
                  {msg.agentResult?.sessionId && msg.agentResult.memorySummary?.pendingSuggestionCount ? (
                    <button
                      onClick={() => {
                        focusAgentSession(useAgentSessionStore.getState(), msg.agentResult?.sessionId, "memory");
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={t("chat.agentResult.reviewMemory")}
                    >
                      <Database className="w-3 h-3" />
                    </button>
                  ) : null}
                  {extractCodeBlocks(msg.content).length > 0 && activeTab && (
                    <button
                      onClick={() => {
                        const blocks = extractCodeBlocks(msg.content);
                        if (blocks.length > 0) {
                          setDiffState(diffState?.msgId === msg.id ? null : { msgId: msg.id, code: blocks[0].code });
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={t("chat.previewChanges")}
                    >
                      <GitCompareArrows className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
              {!msg.isStreaming && msg.content && (
                <FollowUpActions
                  messageId={msg.id}
                  content={msg.content}
                  filePath={activeTab?.filePath}
                  contentForFile={activeContent ?? undefined}
                  evidenceRefs={msg.evidenceRefs ?? []}
                  followUpActions={msg.followUpActions}
                  draftSuggestion={msg.draftSuggestion}
                />
              )}
              {diffState?.msgId === msg.id && activeContent && activeTab && (
                <DiffPreview
                  original={activeContent}
                  modified={diffState.code}
                  onAccept={(result) => {
                    useContentCacheStore.getState().setContent(activeTab.id, result);
                    setDiffState(null);
                  }}
                  onReject={() => setDiffState(null)}
                  className="mt-2"
                />
              )}
            </>
          ) : (
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">
              {msg.content}
            </div>
          )}
          </>);
          })()}
        </div>
      ))}
    </div>
  );
}

function ChatInput() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [isPromptPickerOpen, setPromptPickerOpen] = useState(false);
  const [promptEditorState, setPromptEditorState] = useState<{
    template?: PromptTemplate | null;
    seedUserPrompt?: string;
  } | null>(null);
  const [inputMode, setInputMode] = useState<"chat" | "agent">("chat");
  const [agentEffort, setAgentEffort] = useState<"low" | "medium" | "high">("medium");
  const [showAgentAdvanced, setShowAgentAdvanced] = useState(false);
  const [isModelQuickSwitchOpen, setModelQuickSwitchOpen] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState<AiProviderId | "">("");
  const [draftModelId, setDraftModelId] = useState("");
  const [suggestMemoryForRun, setSuggestMemoryForRun] = useState(true);
  const [continuationForRun, setContinuationForRun] = useState<AiChatContinuationContext | null>(null);
  const isGenerating = useAiChatStore((s) => s.isGenerating);
  const stopGenerating = useAiChatStore((s) => s.stopGenerating);
  const addUserMessage = useAiChatStore((s) => s.addUserMessage);
  const startAssistantMessage = useAiChatStore((s) => s.startAssistantMessage);
  const appendToAssistantMessage = useAiChatStore((s) => s.appendToAssistantMessage);
  const finishAssistantMessage = useAiChatStore((s) => s.finishAssistantMessage);
  const setAssistantError = useAiChatStore((s) => s.setAssistantError);
  const setAssistantMetadata = useAiChatStore((s) => s.setAssistantMetadata);
  const setGenerating = useAiChatStore((s) => s.setGenerating);
  const getMessagesForApi = useAiChatStore((s) => s.getMessagesForApi);
  const selectedResearchWorkflowId = useAiChatStore((s) => s.selectedResearchWorkflowId);
  const setResearchWorkflow = useAiChatStore((s) => s.setResearchWorkflow);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const activeTab = useWorkspaceStore((s) => s.getActiveTab());
  const rootHandle = useWorkspaceStore((s) => s.rootHandle);
  const workspaceRootPath = useWorkspaceStore((s) => s.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((s) => s.workspaceIdentity?.workspaceKey ?? null);
  const getCachedContent = useContentCacheStore((s) => s.getContent);
  const getAnnotationsForFile = useAnnotationStore((s) => s.getAnnotationsForFile);
  const loadPromptState = usePromptTemplateStore((state) => state.loadPromptState);
  const rememberTemplateUsage = usePromptTemplateStore((state) => state.rememberTemplateUsage);
  const composerDraft = useAiChatStore((s) => s.composerDraft);
  const consumeComposerDraft = useAiChatStore((s) => s.consumeComposerDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });
  const aiProviders = useMemo(() => getAllProviders(), []);
  const selectedResearchWorkflow = useMemo(() => {
    if (!selectedResearchWorkflowId) {
      return null;
    }
    try {
      return getResearchAgentWorkflow(selectedResearchWorkflowId);
    } catch {
      return null;
    }
  }, [selectedResearchWorkflowId]);
  const composerView = useMemo(() => buildAgentComposerViewModel({
    mode: inputMode,
    effort: agentEffort,
    inputText: input,
    isGenerating,
    selectedWorkflowLabel: selectedResearchWorkflow?.title ?? null,
    providerId: settings.aiProvider,
    modelId: settings.aiModel,
    autoModelLabel: t("chat.model.auto"),
    autoWorkflowLabel: t("chat.workflow.auto"),
    advancedOpen: showAgentAdvanced,
    suggestMemory: suggestMemoryForRun,
  }), [
    agentEffort,
    input,
    inputMode,
    isGenerating,
    selectedResearchWorkflow?.title,
    settings.aiModel,
    settings.aiProvider,
    showAgentAdvanced,
    suggestMemoryForRun,
    t,
  ]);

  useEffect(() => {
    void loadPromptState();
  }, [loadPromptState]);

  useEffect(() => {
    if (!isModelQuickSwitchOpen) {
      return;
    }
    setDraftProviderId((settings.aiProvider as AiProviderId | null) ?? "");
    setDraftModelId(settings.aiModel ?? "");
  }, [isModelQuickSwitchOpen, settings.aiModel, settings.aiProvider]);

  useEffect(() => {
    if (!composerDraft) {
      return;
    }
    const draft = consumeComposerDraft();
    if (!draft) {
      return;
    }
    setInput(draft.text);
    setInputMode(draft.mode ?? "agent");
    setContinuationForRun(draft.continuation ?? null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerDraft, consumeComposerDraft]);

  const buildChatContextSnapshot = useCallback(async (options?: {
    includeCurrentFileContent?: boolean;
    includeAnnotations?: boolean;
    includeWorkspaceSummary?: boolean;
  }) => {
    const activeContent = options?.includeCurrentFileContent
      ? await resolveActiveFileContent(
          activeTab,
          activeTab ? (typeof getCachedContent(activeTab.id)?.content === "string" ? getCachedContent(activeTab.id)?.content as string : null) : null,
        )
      : undefined;

    const annotations = options?.includeAnnotations && activeTab?.filePath
      ? getAnnotationsForFile(deriveFileId(activeTab.filePath)).map(migrateLegacyAnnotation)
      : [];
    const selectedText = typeof window !== "undefined" ? window.getSelection()?.toString().trim() ?? "" : "";

    return {
      activeContent: activeContent ?? null,
      annotations,
      contextValues: {
        selected_text: selectedText || null,
        current_file: activeTab?.filePath ?? activeTab?.fileName ?? null,
        current_file_content: activeContent ?? null,
        pdf_annotations: options?.includeAnnotations ? formatAnnotationContext(annotations) : null,
        workspace_summary: options?.includeWorkspaceSummary ? buildWorkspaceSummary(rootHandle, activeTab?.filePath) : null,
      } satisfies PromptContextValues,
    };
  }, [activeTab, getAnnotationsForFile, getCachedContent, rootHandle]);

  const prepareChatExecution = useCallback(async (promptText: string, options?: {
    includeCurrentFileContent?: boolean;
    includeAnnotations?: boolean;
    includeWorkspaceSummary?: boolean;
  }) => {
    const snapshot = await buildChatContextSnapshot(options);
    const mentions = parseMentions(promptText);
    const resolvedMentions = mentions.length > 0 && rootHandle
      ? await resolveMentions(mentions, {
          currentSelection: snapshot.contextValues.selected_text ?? "",
          readFile: (path) => readWorkspaceFile(rootHandle, path),
        })
      : [];

    const references = resolvedMentions
      .filter((mention) => mention.type === "file" && mention.resolved && !mention.resolved.startsWith("[Error"))
      .map((mention) => ({
        path: mention.target,
        content: mention.resolved ?? "",
      }));

    const explicitEvidenceRefs = resolvedMentions.flatMap((mention) =>
      mention.evidenceRef ? [mention.evidenceRef] : [],
    );

    return {
      ...snapshot,
      references,
      explicitEvidenceRefs: explicitEvidenceRefs.length > 0 ? explicitEvidenceRefs : undefined,
    };
  }, [buildChatContextSnapshot, rootHandle]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");

    const historyBeforeSend = getMessagesForApi();
    addUserMessage(text); // Show original text in UI
    const msgId = startAssistantMessage();
    const controller = new AbortController();
    setGenerating(true, controller);

    try {
      if (!settings.aiEnabled) {
        setAssistantError(msgId, "AI is disabled. Go to Settings > AI to enable it.");
        return;
      }

      const execution = await prepareChatExecution(text, {
        includeCurrentFileContent: false,
        includeAnnotations: false,
        includeWorkspaceSummary: false,
      });

      const result = await aiOrchestrator.runChat({
        prompt: text,
        history: historyBeforeSend,
        settings: toRuntimeSettings(settings),
        filePath: activeTab?.filePath,
        content: undefined,
        references: execution.references,
        annotations: [],
        explicitEvidenceRefs: execution.explicitEvidenceRefs,
      });

      if (controller.signal.aborted) {
        finishAssistantMessage(msgId);
        return;
      }

      appendToAssistantMessage(msgId, result.text);
      finishAssistantMessage(msgId);
      setAssistantMetadata(msgId, {
        model: result.model,
        evidenceRefs: result.evidenceRefs,
        promptContext: result.context,
        followUpActions: result.followUpActions,
        draftSuggestion: result.draftSuggestion,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        finishAssistantMessage(msgId);
      } else {
        setAssistantError(msgId, (err as Error).message ?? "Request failed");
      }
    }
  }, [
    input,
    isGenerating,
    getMessagesForApi,
    addUserMessage,
    startAssistantMessage,
    setGenerating,
    settings,
    activeTab,
    prepareChatExecution,
    appendToAssistantMessage,
    finishAssistantMessage,
    setAssistantError,
    setAssistantMetadata,
  ]);

  const handleResearchAgentRun = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    const continuation = continuationForRun;
    setInput("");
    setContinuationForRun(null);

    addUserMessage(`[Research Agent] ${text}`);
    const msgId = startAssistantMessage();
    const controller = new AbortController();
    setGenerating(true, controller);

    try {
      if (!settings.aiEnabled) {
        setAssistantError(msgId, "AI is disabled. Go to Settings > AI to enable it.");
        return;
      }

      const execution = await prepareChatExecution(text, {
        includeCurrentFileContent: true,
        includeAnnotations: true,
        includeWorkspaceSummary: true,
      });

      if (controller.signal.aborted) {
        finishAssistantMessage(msgId);
        return;
      }

      const result = await runResearchAgentForChat({
        settings: toRuntimeSettings(settings),
        ...(selectedResearchWorkflowId ? { workflowId: selectedResearchWorkflowId } : {}),
        task: text,
        title: `Research Agent: ${text.slice(0, 80)}`,
        query: text,
        filePath: activeTab?.filePath ?? activeTab?.fileName,
        content: execution.activeContent ?? "",
        selection: execution.contextValues.selected_text ?? undefined,
        explicitEvidenceRefs: execution.explicitEvidenceRefs,
        workspaceKey: workspaceKey ?? workspaceRootPath ?? rootHandle?.name,
        includeWorkspaceSummary: Boolean(workspaceKey || workspaceRootPath || rootHandle),
        suggestMemory: suggestMemoryForRun,
        continuation: continuation ?? undefined,
        plannerSignal: controller.signal,
        compact: true,
        maxObservationReplans: composerView.effortConfig.maxObservationReplans,
        maxReadToolSteps: composerView.effortConfig.maxReadToolSteps,
        ...(composerView.effortConfig.contextBudgetProfileId ? { contextBudgetProfileId: composerView.effortConfig.contextBudgetProfileId } : {}),
      });

      if (controller.signal.aborted) {
        finishAssistantMessage(msgId);
        return;
      }

      appendToAssistantMessage(msgId, result.chatText);
      finishAssistantMessage(msgId);
      setAssistantMetadata(msgId, {
        model: result.plannerModelInfo ?? undefined,
        evidenceRefs: result.result.promptContext.evidenceRefs,
        promptContext: result.result.promptContext,
        followUpActions: result.followUpActions,
        draftSuggestion: result.draftSuggestion,
        agentResult: result.agentResult,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        finishAssistantMessage(msgId);
      } else {
        setAssistantError(msgId, (err as Error).message ?? "Research agent failed");
      }
    }
  }, [
    activeTab?.fileName,
    activeTab?.filePath,
    addUserMessage,
    composerView.effortConfig,
    appendToAssistantMessage,
    finishAssistantMessage,
    input,
    isGenerating,
    continuationForRun,
    prepareChatExecution,
    rootHandle,
    selectedResearchWorkflowId,
    setAssistantError,
    setAssistantMetadata,
    setGenerating,
    settings,
    startAssistantMessage,
    suggestMemoryForRun,
    workspaceKey,
    workspaceRootPath,
  ]);

  const applyPromptTemplateToInput = useCallback(async (template: PromptTemplate) => {
    setPromptPickerOpen(false);
    const snapshot = await buildChatContextSnapshot(DEFAULT_CHAT_PROMPT_CONTEXT_OPTIONS);
    const rendered = renderPromptTemplate(template, snapshot.contextValues);
    const prompt = rendered.renderedPrompt.trim();
    setInput((current) => {
      const existing = current.trim();
      if (!prompt) {
        return existing;
      }
      return existing ? `${prompt}\n\n${existing}` : prompt;
    });
    rememberTemplateUsage(template.id, "chat", {
      workspaceKey,
      workspaceRootPath,
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [buildChatContextSnapshot, rememberTemplateUsage, workspaceKey, workspaceRootPath]);

  const applyModelQuickSwitch = useCallback(async () => {
    await updateSettings({
      aiProvider: draftProviderId || null,
      aiModel: draftModelId.trim() || null,
    });
    setModelQuickSwitchOpen(false);
  }, [draftModelId, draftProviderId, updateSettings]);

  const submitInput = useCallback(() => {
    if (composerView.submitIntent === "agent") {
      void handleResearchAgentRun();
      return;
    }
    void handleSend();
  }, [composerView.submitIntent, handleResearchAgentRun, handleSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitInput();
    }
  };

  return (
    <div className="border-t border-border p-2 relative">
      <PromptPicker
        isOpen={isPromptPickerOpen}
        surface="chat"
        workspaceKey={workspaceKey}
        workspaceRootPath={workspaceRootPath}
        currentInput={input}
        onClose={() => setPromptPickerOpen(false)}
        onSelectTemplate={(template) => void applyPromptTemplateToInput(template)}
        onCreateTemplate={(seed) => {
          setPromptPickerOpen(false);
          setPromptEditorState({ seedUserPrompt: seed?.userPrompt });
        }}
        onEditTemplate={(template) => {
          setPromptPickerOpen(false);
          setPromptEditorState({ template });
        }}
      />
      <PromptEditorDialog
        key={`prompt-editor:${promptEditorState?.template?.id ?? "new"}:${promptEditorState?.seedUserPrompt ?? ""}`}
        isOpen={Boolean(promptEditorState)}
        surface="chat"
        template={promptEditorState?.template ?? null}
        seedUserPrompt={promptEditorState?.seedUserPrompt}
        onClose={() => setPromptEditorState(null)}
      />
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          position={mentionPos}
          onSelect={(selection) => {
            // Replace the @query with the selected mention
            const textarea = textareaRef.current;
            if (textarea) {
              const cursorPos = textarea.selectionStart;
              const textBefore = input.slice(0, cursorPos);
              const textAfter = input.slice(cursorPos);
              const atIdx = textBefore.lastIndexOf('@');
              const suffix = selection.continueSelection ? '' : ' ';
              const newText = textBefore.slice(0, atIdx) + selection.value + suffix + textAfter;
              setInput(newText);
              requestAnimationFrame(() => {
                textarea.focus();
                const nextCursor = (textBefore.slice(0, atIdx) + selection.value).length;
                textarea.setSelectionRange(nextCursor, nextCursor);
              });
            }
            setMentionQuery(selection.continueSelection ? selection.nextQuery : null);
          }}
          onClose={() => setMentionQuery(null)}
        />
      )}
      <ComposerToolbar
        view={composerView}
        isModelQuickSwitchOpen={isModelQuickSwitchOpen}
        draftProviderId={draftProviderId}
        draftModelId={draftModelId}
        aiProviders={aiProviders}
        onModeChange={setInputMode}
        onToggleModelQuickSwitch={() => setModelQuickSwitchOpen((open) => !open)}
        onDraftProviderChange={setDraftProviderId}
        onDraftModelChange={setDraftModelId}
        onApplyModelQuickSwitch={() => void applyModelQuickSwitch()}
        onCloseModelQuickSwitch={() => setModelQuickSwitchOpen(false)}
        onEffortChange={setAgentEffort}
        onOpenPromptPicker={() => setPromptPickerOpen(true)}
        onToggleAdvanced={() => setShowAgentAdvanced((open) => !open)}
      />
      <ComposerAdvancedPanel
        view={composerView}
        input={input}
        onSuggestMemoryChange={setSuggestMemoryForRun}
        onClearWorkflow={() => setResearchWorkflow(null)}
        onSaveCurrentPrompt={() => setPromptEditorState({ seedUserPrompt: input })}
      />
      <div className="flex items-end gap-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            const val = e.target.value;
            setInput(val);
            // Detect @mention trigger
            const cursorPos = e.target.selectionStart;
            const textBefore = val.slice(0, cursorPos);
            const atMatch = textBefore.match(/@(\S*)$/);
            if (atMatch) {
              setMentionQuery(atMatch[1]);
              setMentionPos({ top: 40, left: 8 });
            } else {
              setMentionQuery(null);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          rows={1}
          className="flex-1 resize-none rounded-md border border-border bg-muted/50 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isGenerating}
        />
        {isGenerating ? (
          <button
            onClick={stopGenerating}
            className="rounded-md bg-destructive/10 p-2 text-destructive hover:bg-destructive/20 transition-colors"
            title={t('chat.stop')}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={submitInput}
            disabled={!composerView.canSubmit}
            className="rounded-md bg-primary/10 p-2 text-primary hover:bg-primary/20 disabled:opacity-30 transition-colors"
            title={composerView.isAgentMode ? t("chat.researchAgent.hint") : t('chat.send')}
            data-testid="ai-chat-submit"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
