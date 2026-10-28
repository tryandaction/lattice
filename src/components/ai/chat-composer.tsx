"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bot, Save, Send, SlidersHorizontal, Square, Wand2, X } from "lucide-react";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { useAiPdfCompanionStore } from "@/stores/ai-pdf-companion-store";
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAiComposerInput } from '@/hooks/use-ai-composer-input';
import { captureAgentDocumentSources, snapshotAgentDocumentSources, shouldReadConversationDocuments, wantsDocumentReading, resolveAuthorizedDocumentHandle, conversationOpenFileTabs } from '@/lib/ai/document-source-capture';
import type { ResearchAgentRunInput } from '@/lib/ai/research-agent';
import { agentToolSourceReads } from '@/lib/ai/agent-tool-broker';
import { validateChatSources } from '@/lib/ai/chat-source-validation';
import { estimateLongInputBudget, processLongInput, LongInputProcessingError } from '@/lib/ai/long-input';
import { isAgentDocumentPath, openAgentDocumentSource, type AgentDocumentSource } from '@/lib/ai/document-source';
import type { AgentSourceSnapshot, AuthorizedSourceIndex, AgentSourceRead } from '@/lib/ai/source-index';
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { aiOrchestrator } from "@/lib/ai/orchestrator";
import { aiContextGraph } from "@/lib/ai/context-graph";
import { conversationDocumentPaths, latestConversationDocumentContext } from '@/lib/ai/conversation-documents';
import { hasNamedDocumentReference, isCurrentDocumentReference, isDocumentComparison, isPreviousDocumentReference, startsNewDocumentTopic, requestsIndependentAnswer } from '@/lib/ai/document-reference-intent';
import { resolveConversationSourceTargets, type ConversationSourceTargets } from '@/lib/ai/conversation-source-targeting';
import { resolveCloudConversationTargets } from '@/lib/ai/cloud-conversation-targeting';
import { bindConversationSources, type ConversationSourceBinding } from '@/lib/ai/conversation-source-binding';
import { cloudAiLabels } from '@/lib/shared-library/cloud-ai-labels';
import { CloudSourceSelection } from './cloud-source-selection';
import { cloudComposerInput, withCloudComposerQuestion } from '@/lib/ai/cloud-composer-input';
import { isBroadDocumentExplanation, isDocumentFollowup, isShortContinuationAck, isTrivialQuery, isWholeDocumentRequest, isWholeDirectoryRequest } from '@/lib/ai/request-intent';
import { IncompleteAnswerError, InterruptedAnswerError } from '@/lib/ai/answer-execution';
import { requestsCodeExecution, parsePdfMarkdownChildRequest } from '@/lib/ai/task-outcome';
import { parseWorkspaceFileTask, prepareWorkspaceFileTask, resolvePdfChildTargetRevision } from '@/lib/ai/workspace-file-task';
import { routeModel } from '@/lib/ai/model-router';
import { effectiveOutputTokenCeiling } from '@/lib/ai/output-budget';
import { initKeyStorage } from '@/lib/ai/key-storage';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { RequestProgress } from './request-progress';
import { AgentRuntimeSelector } from './agent-runtime-settings';
import { HarnessExecutionTimeline } from './harness-execution-timeline';
import { useAiHarnessStore } from '@/stores/ai-harness-store';
import { describeHarnessFailure } from '@/lib/ai/harness/runtime-error';
import { harnessToolNameToLattice } from '@/lib/ai/harness/tool-broker';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { createLatticeHarnessToolRuntime, type HarnessReviewDraft } from '@/lib/ai/harness/lattice-source-tools';
import { cloudHarnessWorkspaceSpec, prepareHarnessConversationContext, harnessAnswerEvent, runHarnessDocumentReadingLoop } from '@/lib/ai/harness/conversation-context';
import { createAuthorizedSourceIndex } from '@/lib/ai/source-index';
import { bindCloudPdfChildDraft } from '@/lib/ai/lattice-skills/cloud-pdf-child-skill';
import { getCloudWorkspaceSnapshot, subscribeCloudWorkspaceHost } from '@/lib/cloud-workspace-host';
import { captureActiveCloudAgentDocumentSources, captureCloudAgentDocumentSources, captureSelectedCloudAgentDocumentSources, parseCloudSourceSelections, validateCloudAgentSourceSnapshots } from '@/lib/ai/cloud-source';
import type { CloudAgentSourceSnapshot, CloudAgentSourceSelection } from '@/lib/ai/cloud-source';
import { createCloudDirectoryResearchAdapter } from '@/lib/ai/cloud-directory-source';
import { ChatAttachments, useChatAttachmentInput } from './chat-attachments';
import { useAiAttachmentStore } from '@/stores/ai-attachment-store';
import { captureRequestAttachments, requestAttachmentIds, withAttachmentTools } from '@/lib/ai/attachment-request';
import { captureChatAttachments, chatAttachmentDocumentPath, type CapturedChatAttachments, type ChatAttachmentRef } from '@/lib/ai/chat-attachments';
import { parseSourceSelections } from '@/lib/ai/source-index';
import { checkpointObjective, reusableDocumentReading } from '@/lib/ai/document-followup';
import { documentContinuationForReply, recentDocumentTaskSessions, resolveResearchContinuation } from '@/lib/ai/conversation-task-context';
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { MentionAutocomplete } from "./mention-autocomplete";
import { getActiveMentionQuery } from "@/lib/ai/mention-browser";
import { PromptPicker } from "@/components/prompt/prompt-picker";
import { PromptEditorDialog } from "@/components/prompt/prompt-editor-dialog";
import { Portal } from "@/components/ui/portal";
import { parseMentions, resolveMentions } from "@/lib/ai/mention-resolver";
import { deriveFileId } from "@/lib/annotation-storage";
import { migrateLegacyAnnotation } from "@/lib/annotation-migration";
import type { PromptContextValues, PromptTemplate } from "@/lib/prompt/types";
import { renderPromptTemplate } from "@/lib/prompt/render";
import { runResearchAgentForChat } from "@/lib/ai/research-agent-chat-runner";
import { getResearchAgentWorkflow, inferResearchAgentWorkflow, listResearchAgentWorkflows } from "@/lib/ai/research-agent-workflows";
import { ResearchWorkflowSelector } from "./research-workflow-selector";
import {
  buildAgentComposerViewModel,
  type AgentComposerEffort,
  type AgentComposerMode,
  type AgentComposerViewModel,
} from "@/lib/ai/agent-composer-view-model";
import {
  buildWorkspaceSummary,
  buildVisiblePdfPageContext,
  formatAnnotationContext,
  getRequestedPdfPages,
  getVisiblePdfPageContext,
  isPdfPath,
  readWorkspaceFile,
  resolveActiveFileContent,
  toRuntimeSettings,
} from "./ai-chat-context";

interface ChatPromptContextOptions {
  includeCurrentFileContent: boolean;
  includeAnnotations: boolean;
  includeWorkspaceSummary: boolean;
}

function ensureVisibleAssistantText(text: string, mode: "chat" | "agent"): string {
  const normalized = text.trim();
  if (normalized) {
    return normalized;
  }
  return mode === "agent"
    ? "Research Agent did not return a readable answer. Please retry the question."
    : "The model returned an empty answer. Please retry the question.";
}

const DEFAULT_CHAT_PROMPT_CONTEXT_OPTIONS: ChatPromptContextOptions = {
  includeCurrentFileContent: true,
  includeAnnotations: true,
  includeWorkspaceSummary: false,
};

function ComposerToolbar({
  view,
  profiles,
  activeProfileId,
  activeModelId,
  modelOptions,
  onModeChange,
  onProfileChange,
  onModelChange,
  onOpenPromptPicker,
  onToggleAdvanced,
  submitControl,
  runtimeLabel,
  disabled = false,
}: {
  view: AgentComposerViewModel;
  profiles: Array<{ id: string; name: string }>;
  activeProfileId: string | null;
  activeModelId: string;
  modelOptions: Array<{ id: string; name: string }>;
  onModeChange: (mode: AgentComposerMode) => void;
  onProfileChange: (profileId: string) => void;
  onModelChange: (modelId: string) => void;
  onOpenPromptPicker: () => void;
  onToggleAdvanced: () => void;
  submitControl: ReactNode;
  runtimeLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 border-t border-border/60 px-2 py-1.5" data-testid="ai-chat-composer-toolbar">
      {!runtimeLabel ? <><div className="inline-flex shrink-0 rounded border border-border/70 bg-muted/20 p-0.5" aria-label={t("chat.mode")}>
        <button
          type="button"
          onClick={() => onModeChange("chat")}
          aria-pressed={view.mode === "chat"}
          data-testid="ai-chat-mode-chat"
          className={cn(
            "rounded px-2 py-0.5 text-[10px] transition-colors",
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
            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors",
            view.isAgentMode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          title={t("chat.researchAgent.hint")}
        >
          <Bot className="h-3 w-3" />
          Agent
        </button>
      </div></> : null}
      <AgentRuntimeSelector profiles={profiles} activeProfileId={activeProfileId} modelOptions={modelOptions} activeModelId={activeModelId} onProfileChange={onProfileChange} onModelChange={onModelChange} disabled={disabled} />
      <button
        type="button"
        onClick={onOpenPromptPicker}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        data-testid="ai-chat-templates"
        title={t("prompt.chat.open")}
        aria-label={t("prompt.chat.open")}
      >
        <Wand2 className="h-3.5 w-3.5" />
      </button>
      {!runtimeLabel && view.isAgentMode && (
        <button
          type="button"
          onClick={onToggleAdvanced}
          aria-expanded={view.advancedOpen}
          aria-controls="ai-chat-agent-advanced-panel"
          data-testid="ai-chat-agent-advanced-toggle"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("chat.agentAdvanced")}
          aria-label={t("chat.agentAdvanced")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      )}
      {submitControl}
    </div>
  );
}

function ComposerAdvancedPanel({
  view,
  input,
  onSuggestMemoryChange,
  onClearWorkflow,
  onSaveCurrentPrompt,
  onEffortChange,
  includePdfScoped,
}: {
  view: AgentComposerViewModel;
  input: string;
  onSuggestMemoryChange: (checked: boolean) => void;
  onClearWorkflow: () => void;
  onSaveCurrentPrompt: () => void;
  onEffortChange: (effort: AgentComposerEffort) => void;
  includePdfScoped: boolean;
}) {
  const { t } = useI18n();

  if (!view.advancedOpen) {
    return null;
  }

  return (
    <div
      id="ai-chat-agent-advanced-panel"
      data-testid="ai-chat-agent-advanced-panel"
      className="absolute bottom-[calc(100%+0.5rem)] left-2 right-2 z-30 flex max-h-[60vh] flex-wrap items-center gap-2 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-lg"
    >
      <div className="w-full"><ResearchWorkflowSelector includePdfScoped={includePdfScoped} /></div>
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

export function ChatComposer() {
  const { locale, t } = useI18n();
  const cloudHost = useSyncExternalStore(subscribeCloudWorkspaceHost, getCloudWorkspaceSnapshot, getCloudWorkspaceSnapshot);
  const currentCloudSource = cloudHost.active && cloudHost.provider && cloudHost.resource ? cloudHost.resource : null;
  const [input, setInput] = useAiComposerInput();
  const cloudInput = useMemo(() => cloudComposerInput(input), [input]);
  const question = cloudInput.question;
  const setQuestion = useCallback((value: string) => setInput(current => withCloudComposerQuestion(current, value)), [setInput]);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [isPromptPickerOpen, setPromptPickerOpen] = useState(false);
  const [promptEditorState, setPromptEditorState] = useState<{
    template?: PromptTemplate | null;
    seedUserPrompt?: string;
  } | null>(null);
  const inputMode = useAiChatStore((s) => s.composerMode);
  const persistedContinuation = useAiChatStore((s) => s.conversations.find(conversation => conversation.id === s.activeConversationId)?.draft?.continuation ?? null);
  const setInputMode = useAiChatStore((s) => s.setComposerMode);
  const [agentEffort, setAgentEffort] = useState<"low" | "medium" | "high">("medium");
  const [showAgentAdvanced, setShowAgentAdvanced] = useState(false);
  const [suggestMemoryForRun, setSuggestMemoryForRun] = useState(false);
  const [submitComposerDraft, setSubmitComposerDraft] = useState<string | null>(null);
  const activeConversationId = useAiChatStore(state => state.activeConversationId);
  const cloudSourceScope = useAiChatStore(state => {
    const workspace = state.conversations.find(conversation => conversation.id === state.activeConversationId)?.workspace;
    return workspace?.workspaceKey.startsWith('cloud:') ? workspace.permissionScope : undefined;
  });
  const pendingAttachments = useAiAttachmentStore(state => state.attachmentsByConversation[activeConversationId ?? '']?.some(ref => ref.status === 'pending') ?? false);
  const attachmentBusy = useAiAttachmentStore(state => Boolean(state.busyByConversation[activeConversationId ?? '']));
  const isGenerating = useAiChatStore((s) => s.isGenerating);
  const attachmentInput = useChatAttachmentInput(activeConversationId, isGenerating);
  const runtimeEngine = useAiHarnessStore(state => state.config.engine);
  const persistenceError = useAiChatStore(state => state.persistenceError);
  const hydrationError = useAiChatStore(state => state.hydrationError);
  const stopGenerating = useAiChatStore((s) => s.stopGenerating);
  const addUserMessage = useAiChatStore((s) => s.addUserMessage);
  const startAssistantMessage = useAiChatStore((s) => s.startAssistantMessage);
  const appendToAssistantMessage = useAiChatStore((s) => s.appendToAssistantMessage);
  const finishAssistantMessage = useAiChatStore((s) => s.finishAssistantMessage);
  const setAssistantError = useAiChatStore((s) => s.setAssistantError);
  const setAssistantMetadata = useAiChatStore((s) => s.setAssistantMetadata);
  const setRequestProgress = useAiChatStore((s) => s.setRequestProgress);
  const setGenerating = useAiChatStore((s) => s.setGenerating);
  const getMessagesForApi = useAiChatStore((s) => s.getMessagesForApi);
  const selectedResearchWorkflowId = useAiChatStore((s) => s.selectedResearchWorkflowId);
  const noteConfigOverrides = useAiChatStore((s) => s.noteConfigOverrides);
  const loadWorkflowConfig = useAiChatStore((s) => s.loadWorkflowConfig);
  const setResearchWorkflow = useAiChatStore((s) => s.setResearchWorkflow);
  const settings = useSettingsStore((s) => s.settings);
  const aiProfiles = useAiProviderProfileStore((state) => state.profiles);
  const activeAiProfileId = useAiProviderProfileStore((state) => state.activeProfileId);
  const setActiveAiProfile = useAiProviderProfileStore((state) => state.setActiveProfile);
  const setDefaultAiModel = useAiProviderProfileStore((state) => state.setDefaultModel);
  const activeAiProfile = useAiProviderProfileStore((state) => state.profiles.find((profile) => profile.id === state.activeProfileId) ?? null);
  const activePaneId = useWorkspaceStore((s) => s.layout.activePaneId);
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
  const mentionCaretRef = useRef<{ value: string; position: number } | null>(null);
  const composingRef = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  useLayoutEffect(() => {
    const pending = mentionCaretRef.current;
    mentionCaretRef.current = null;
    if (!pending || pending.value !== question || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(pending.position, pending.position);
  }, [question]);
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
  const runtimeSettings = useMemo(() => toRuntimeSettings(settings, inputMode === "agent" ? "agent" : "chat", activeAiProfile), [activeAiProfile, inputMode, settings]);
  const configuredModel = activeAiProfile?.models.find(model => model.id === runtimeSettings.model);
  const inputBudget = useMemo(() => estimateLongInputBudget({ input, model: configuredModel ?? { id: runtimeSettings.model ?? '', contextWindow: 0 }, systemPrompt: runtimeSettings.systemPrompt }), [input, configuredModel, runtimeSettings.model, runtimeSettings.systemPrompt]);
  const modelOptions = useMemo(
    () => (activeAiProfile?.models ?? []).map((model) => ({ id: model.id, name: model.name || model.id })),
    [activeAiProfile?.models],
  );
  const activeModelId = runtimeSettings.model && modelOptions.some((model) => model.id === runtimeSettings.model)
    ? runtimeSettings.model
    : "";
  const composerView = useMemo(() => buildAgentComposerViewModel({
    mode: inputMode,
    effort: agentEffort,
    inputText: input || (pendingAttachments ? '分析附件' : ''),
    isGenerating: isGenerating || attachmentBusy,
    selectedWorkflowLabel: selectedResearchWorkflow?.title ?? null,
    providerId: runtimeSettings.providerId,
    modelId: runtimeSettings.model,
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
    runtimeSettings.model,
    runtimeSettings.providerId,
    showAgentAdvanced,
    suggestMemoryForRun,
    t,
    pendingAttachments,
    attachmentBusy,
  ]);

  const requestAttachmentRefs = useCallback((text: string): ChatAttachmentRef[] => {
    const chat = useAiChatStore.getState();
    const id = chat.activeConversationId;
    if (!id) return [];
    const available = useAiAttachmentStore.getState().attachmentsByConversation[id] ?? [];
    const ids = new Set(chat.getConversationDraft()?.attachmentIds ?? requestAttachmentIds(text, available, chat.getActiveConversation()?.messages ?? []));
    return available.filter(ref => ids.has(ref.id));
  }, []);

  const captureAttachmentsForRequest = useCallback(async (text: string, conversationId: string, signal: AbortSignal): Promise<CapturedChatAttachments | null> => {
    const current = () => useAiChatStore.getState().activeConversationId === conversationId;
    const latest = useAiChatStore.getState().getActiveConversation()?.messages.findLast(message => message.role === 'user');
    const captured = latest?.content === text && latest.attachments?.length
      ? await captureChatAttachments({ conversationId, attachmentIds: latest.attachments.map(ref => ref.id), signal, isCurrent: current })
      : await captureRequestAttachments({ query: text, conversationId, available: useAiAttachmentStore.getState().attachmentsByConversation[conversationId] ?? [],
        messages: useAiChatStore.getState().getActiveConversation()?.messages ?? [], signal, isCurrent: current });
    if (captured) {
      try { await useAiAttachmentStore.getState().markSent(conversationId, captured.refs.map(ref => ref.id), { signal, isCurrent: current }); }
      catch (error) { await captured.close(); throw error; }
    }
    return captured;
  }, []);

  useEffect(() => {
    void loadPromptState();
  }, [loadPromptState]);

  useEffect(() => {
    void loadWorkflowConfig();
  }, [loadWorkflowConfig]);

  useEffect(() => {
    if (!composerDraft) {
      return;
    }
    const draft = consumeComposerDraft();
    if (!draft) {
      return;
    }
    const draftConversationId = useAiChatStore.getState().setConversationDraft(draft);
    setInputMode(draft.mode ?? "agent");
    setSubmitComposerDraft(draft.submit ? draftConversationId : null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerDraft, consumeComposerDraft]);

  const sourceBindingForRequest = useCallback((query: string): ConversationSourceBinding => {
    const conversation = useAiChatStore.getState().getActiveConversation();
    const legacyWorkspaceKey = conversation?.workspace?.workspaceKey ?? '';
    return { ...bindConversationSources({
    query, messages: conversation?.messages ?? [], legacyWorkspaceKey, conversationWorkspace: conversation?.workspace,
    localWorkspaceKey: workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '', activeCloud: cloudHost.active,
    activeCloudLibraryId: currentCloudSource?.libraryId, providerScope: cloudHost.provider?.scope,
    activeLocalPath: activeTab?.filePath, activeCloudName: currentCloudSource?.name,
    }), legacyWorkspaceKey };
  }, [workspaceKey, workspaceRootPath, rootHandle?.name, cloudHost.active, cloudHost.provider, currentCloudSource, activeTab?.filePath]);

  const documentPathsForRequest = useCallback((query = '', binding = sourceBindingForRequest(query)) => {
    const messages = useAiChatStore.getState().getActiveConversation()?.messages ?? [];
    const activePath = binding.kind === 'cloud' ? currentCloudSource?.libraryId === binding.workspaceKey.slice(6) ? currentCloudSource.id : undefined
      : !cloudHost.active ? activeTab?.filePath ?? activeTab?.fileName : undefined;
    return conversationDocumentPaths(messages, binding.workspaceKey, activePath, binding.legacyWorkspaceKey ?? '');
  }, [cloudHost.active, currentCloudSource, activeTab?.filePath, activeTab?.fileName, sourceBindingForRequest]);

  const resolveRequestSources = useCallback(async (query: string, signal?: AbortSignal, binding = sourceBindingForRequest(query)): Promise<ConversationSourceTargets & { cloudSelections?: CloudAgentSourceSelection[] }> => {
    const messages = useAiChatStore.getState().getActiveConversation()?.messages ?? [];
    // The bound prior source is retained even when the confirmation contains no noun.
    if (binding.referentPaths?.length && isShortContinuationAck(query)) query = '继续';
    if (binding.kind === 'cloud') {
      if (!cloudHost.provider) throw new Error('云库连接不可用，请重新登录后继续。');
      if (binding.providerScope !== cloudHost.provider.scope) throw new Error('先前云来源的账号或权限范围已变化，请重新连接原账号。');
      const known = messages.filter(message => !message.isStreaming).flatMap(message => message.documentContext?.cloudSnapshots ?? [])
        .filter(snapshot => snapshot.providerScope === cloudHost.provider?.scope && snapshot.cloudIdentity.libraryId === binding.workspaceKey.slice(6));
      const prior = [...new Map([...known].reverse().map(snapshot => [snapshot.path, snapshot])).values()];
      const referentPaths = binding.referentPaths ?? [...messages].reverse().find(message => !message.isStreaming && message.documentContext?.workspaceKey === binding.workspaceKey && message.documentContext?.cloudSnapshots?.some(snapshot => snapshot.providerScope === cloudHost.provider?.scope))?.documentContext?.paths;
      const target = await resolveCloudConversationTargets({ query, provider: cloudHost.provider, knownSnapshots: prior, activeResource: currentCloudSource?.libraryId === binding.workspaceKey.slice(6) ? currentCloudSource : null, referentPaths, signal });
      return { paths: target.paths, reason: target.reason, cloudSelections: target.selections };
    }
    const key = workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '';
    if (binding.workspaceKey !== key) throw new Error('请回到先前文档所属的本地工作区后继续。');
    const latestContext = latestConversationDocumentContext(messages, binding.legacyWorkspaceKey ?? '');
    if (!startsNewDocumentTopic(query) && isCurrentDocumentReference(query) && isPreviousDocumentReference(query) && isDocumentComparison(query)
      && latestContext?.paths.length && latestContext.workspaceKey !== key) throw new Error('先前论文属于原工作区，请回到原工作区或重新明确选择比较来源。');
    const referentPaths = binding.referentPaths ?? (latestContext?.workspaceKey === key ? latestContext.paths : []);
    return resolveConversationSourceTargets({ query, knownPaths: conversationDocumentPaths(messages, key, undefined, binding.legacyWorkspaceKey ?? ''), referentPaths, relocateReferents: binding.relocateReferents,
      activePath: !cloudHost.active ? activeTab?.filePath ?? activeTab?.fileName : undefined, rootHandle, workspaceRootPath, workspaceKey: key, signal, includeActiveDocumentContext: true });
  }, [cloudHost.active, cloudHost.provider, currentCloudSource, workspaceKey, workspaceRootPath, rootHandle, activeTab, sourceBindingForRequest]);

  const revalidateHistory = useCallback(async (conversationId: string | null, signal: AbortSignal, scopeKey?: string) => {
    const state = useAiChatStore.getState();
    const host = getCloudWorkspaceSnapshot();
    const providerScope = host.provider?.scope;
    const key = scopeKey ?? (host.active ? `cloud:${host.resource?.libraryId ?? 'unselected'}` : workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '');
    const conversation = state.conversations.find(item => item.id === conversationId) ?? null;
    const assertCloudScope = () => {
      if (key.startsWith('cloud:') && (!host.provider || getCloudWorkspaceSnapshot().provider !== host.provider || host.provider.scope !== providerScope
        || conversation?.workspace?.workspaceKey.startsWith('cloud:') && conversation.workspace.permissionScope && conversation.workspace.permissionScope !== providerScope)) {
        throw new Error(cloudAiLabels(locale).scopeChanged);
      }
    };
    assertCloudScope();
    const validation = await validateChatSources({ conversation, workspaceKey: key, rootHandle, activeTab, openTabs: conversationOpenFileTabs(useWorkspaceStore.getState().layout.root), signal, cloudProvider: host.provider });
    signal.throwIfAborted();
    assertCloudScope();
    const binding = { workspaceKey: key, ...(key.startsWith('cloud:') ? { libraryId: key.slice(6), permissionScope: host.provider?.scope ?? null } : {}) };
    state.setConversationWorkspace(binding, conversationId ?? undefined);
    state.markConversationSourcesValidated(binding, conversationId ?? undefined, validation.validMessageIds);
    setSourceNotice(validation.notice);
    return state.getMessagesForApi(conversationId ?? undefined);
  }, [workspaceKey, workspaceRootPath, rootHandle, activeTab, locale]);

  const buildChatContextSnapshot = useCallback(async (options?: {
    includeCurrentFileContent?: boolean;
    includeAnnotations?: boolean;
    includeWorkspaceSummary?: boolean;
    includeImplicitDocumentContext?: boolean;
    onSourceRead?: (file: File, path: string, details?: { version: string; totalPages: number }) => Promise<void>;
    documentPathsOverride?: readonly string[];
    sourceBinding?: ConversationSourceBinding;
  }, query = "") => {
    if ((options?.sourceBinding?.kind ?? (cloudHost.active ? 'cloud' : 'local')) === 'cloud') {
      return { filePath: currentCloudSource?.id, activeContent: null, annotations: [], documentPaths: currentCloudSource ? [currentCloudSource.id] : [],
        contextValues: { selected_text: null, current_file: currentCloudSource?.id ?? null, current_file_content: null, pdf_annotations: null, workspace_summary: currentCloudSource ? `Cloud library: ${currentCloudSource.libraryId}` : null } satisfies PromptContextValues };
    }
    const includeImplicit = options?.includeImplicitDocumentContext !== false;
    const selectedText = includeImplicit && typeof window !== "undefined" ? window.getSelection()?.toString().trim() ?? "" : "";
    const documentPaths = options?.documentPathsOverride ? [...options.documentPathsOverride] : documentPathsForRequest();
    const filePath = includeImplicit ? documentPaths.at(0) : undefined;
    const sourceTab = conversationOpenFileTabs(useWorkspaceStore.getState().layout.root).find(tab => (tab.filePath ?? tab.fileName) === filePath) ?? ((activeTab?.filePath ?? activeTab?.fileName) === filePath ? activeTab : null);
    const sourceIsActive = Boolean(filePath && (activeTab?.filePath ?? activeTab?.fileName) === filePath);
    const cachedContent = sourceTab ? (typeof getCachedContent(sourceTab.id)?.content === "string" ? getCachedContent(sourceTab.id)?.content as string : null) : null;
    const fileOptions = { preferredPdfPages: [...getRequestedPdfPages(query), ...(isPdfPath(filePath) ? [getVisiblePdfPageContext(activePaneId)?.page ?? 0] : [])], onSourceRead: options?.onSourceRead };
    const activeContent = includeImplicit && options?.includeCurrentFileContent && !isTrivialQuery(query)
        ? await resolveActiveFileContent(sourceTab, isPdfPath(filePath) ? null : cachedContent, {
          onSourceRead: options?.onSourceRead,
          preferredPdfPages: [
            ...getRequestedPdfPages(query),
            ...(isPdfPath(filePath) ? [getVisiblePdfPageContext(activePaneId)?.page ?? 0] : []),
          ],
        })
        ?? (filePath && rootHandle ? await readWorkspaceFile(rootHandle, filePath, fileOptions) : buildVisiblePdfPageContext(filePath, activePaneId))
      : undefined;

    const annotations = includeImplicit && sourceIsActive && options?.includeAnnotations && !isTrivialQuery(query) && activeTab?.filePath
      ? getAnnotationsForFile(deriveFileId(activeTab.filePath)).map(migrateLegacyAnnotation)
      : [];

    if (options?.includeCurrentFileContent && !isTrivialQuery(query) && filePath && activeContent == null && !annotations.length) throw new Error('无法访问先前提供的文档，请重新打开原文件：' + filePath);

    return {
      filePath,
      documentPaths,
      activeContent: activeContent ?? null,
      annotations,
      contextValues: {
        selected_text: selectedText || null,
        current_file: filePath ?? null,
        current_file_content: activeContent ?? null,
        pdf_annotations: options?.includeAnnotations ? formatAnnotationContext(annotations) : null,
        workspace_summary: options?.includeWorkspaceSummary ? buildWorkspaceSummary(rootHandle, activeTab?.filePath) : null,
      } satisfies PromptContextValues,
    };
  }, [cloudHost.active, currentCloudSource, activePaneId, activeTab, documentPathsForRequest, getAnnotationsForFile, getCachedContent, rootHandle]);

  const prepareChatExecution = useCallback(async (promptText: string, options?: {
    includeCurrentFileContent?: boolean;
    includeAnnotations?: boolean;
    includeWorkspaceSummary?: boolean;
    includeImplicitDocumentContext?: boolean;
    documentPathsOverride?: readonly string[];
    sourceBinding?: ConversationSourceBinding;
  }) => {
    const documentSnapshots = new Map<string, AgentSourceSnapshot>();
    let sourceBytes = 0;
    const onSourceRead = async (file: File, path: string, details?: { version: string; totalPages: number }) => {
      if (!isAgentDocumentPath(path)) return;
      if (!documentSnapshots.has(path)) sourceBytes += file.size;
      if (sourceBytes > 32_000_000 || documentSnapshots.size >= 100 && !documentSnapshots.has(path)) throw new Error('聊天来源超过读取预算，请选择相关文件或按目录分批读取；原输入已完整保留。');
      if (details) {
        if (documentSnapshots.get(path)?.version && documentSnapshots.get(path)!.version !== details.version) throw new Error('来源在准备上下文期间发生修改，请重新读取：' + path);
        const key = workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '';
        documentSnapshots.set(path, { workspaceKey: key, path, version: details.version, kind: 'pdf', unitLabel: 'page', totalUnits: details.totalPages, sourceId: `lattice-workspace:${encodeURIComponent(key)}:${encodeURIComponent(path)}` });
        return;
      }
      const source = await openAgentDocumentSource(file, path);
      try {
        if (documentSnapshots.get(path)?.version && documentSnapshots.get(path)!.version !== source.version) throw new Error('来源在准备上下文期间发生修改，请重新读取：' + path);
        documentSnapshots.set(path, snapshotAgentDocumentSources([source], workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '')[0]);
      }
      finally { await source.close(); }
    };
    const snapshot = await buildChatContextSnapshot({ ...options, onSourceRead }, promptText);
    const mentions = parseMentions(promptText);
    const isCloudRequest = (options?.sourceBinding?.kind ?? (cloudHost.active ? 'cloud' : 'local')) === 'cloud';
    const resolvedMentions = mentions.length > 0 && rootHandle && !isCloudRequest
      ? await resolveMentions(mentions, {
          currentSelection: snapshot.contextValues.selected_text ?? "",
          readFile: (path) => readWorkspaceFile(rootHandle, path, { onSourceRead }),
        })
      : [];

    const readableMentions = await Promise.all(resolvedMentions.map(async (mention) => {
      const path = mention.path ?? mention.target;
      if (!rootHandle || mention.type !== "file" || !isPdfPath(path)) return mention;
      try {
        const page = mention.fragment?.match(/^page=(\d+)$/)?.[1];
        const content = await readWorkspaceFile(rootHandle, path, {
          onSourceRead,
          preferredPdfPages: [...(page ? [Number(page)] : []), ...getRequestedPdfPages(promptText)],
        });
        return {
          ...mention,
          resolved: content,
          // Page evidence is built from the text actually supplied, never a binary placeholder.
          evidenceRef: mention.evidenceRef?.kind === "pdf_annotation" ? mention.evidenceRef : undefined,
        };
      } catch {
        return { ...mention, resolved: `[Error reading: ${path}]`, evidenceRef: undefined };
      }
    }));

    const references = readableMentions
      .filter((mention) => mention.type === "file" && mention.resolved && !mention.resolved.startsWith("[Error"))
      .map((mention) => ({
        path: mention.path ?? mention.target,
        content: mention.resolved ?? "",
      }));

    if (rootHandle && !isCloudRequest && options?.includeImplicitDocumentContext !== false && !isTrivialQuery(promptText) && options?.includeCurrentFileContent) {
      for (const path of snapshot.documentPaths.slice(1)) {
        if (!references.some(reference => reference.path === path)) {
          references.push({ path, content: await readWorkspaceFile(rootHandle, path, { preferredPdfPages: getRequestedPdfPages(promptText), onSourceRead }) });
        }
      }
    }

    const explicitEvidenceRefs = readableMentions.flatMap((mention) =>
      mention.evidenceRef ? [mention.evidenceRef] : [],
    );

    return {
      ...snapshot,
      documentPaths: [...new Set([...(snapshot.filePath ? [snapshot.filePath] : []), ...references.map(reference => reference.path), ...snapshot.documentPaths])],
      references,
      documentSnapshots: Array.from(documentSnapshots.values()),
      explicitEvidenceRefs: explicitEvidenceRefs.length > 0 ? explicitEvidenceRefs : undefined,
    };
  }, [buildChatContextSnapshot, rootHandle, cloudHost.active, workspaceKey, workspaceRootPath]);

  const preservePreparedContextMetadata = useCallback((
    messageId: string,
    preparedContext: Awaited<ReturnType<typeof prepareChatExecution>> | null,
    documentContext?: { workspaceKey: string; paths: string[] },
  ) => {
    if (!preparedContext) {
      return;
    }

    const promptContext = aiContextGraph.buildPromptContext({
      filePath: preparedContext.filePath,
      content: preparedContext.activeContent ?? undefined,
      selection: preparedContext.contextValues.selected_text ?? undefined,
      references: preparedContext.references,
      annotations: preparedContext.annotations,
      explicitEvidenceRefs: preparedContext.explicitEvidenceRefs,
    });
    setAssistantMetadata(messageId, {
      evidenceRefs: promptContext.evidenceRefs,
      promptContext,
      documentContext: documentContext ?? { workspaceKey: workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '', paths: preparedContext.documentSnapshots.map(snapshot => snapshot.path), snapshots: preparedContext.documentSnapshots },
    });
  }, [setAssistantMetadata, workspaceKey, workspaceRootPath, rootHandle?.name]);

  const handleSend = useCallback(async () => {
    const text = input || (pendingAttachments ? '请分析附件。' : '');
    const capturedAttachmentRefs = requestAttachmentRefs(text);
    if (!text.trim() || isGenerating) return;
    const previousMessages = useAiChatStore.getState().getActiveConversation()?.messages ?? [];
    const requestBinding: ConversationSourceBinding = requestAttachmentRefs(text).length ? { kind: 'local', workspaceKey: workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '' } : sourceBindingForRequest(text);
    const requestDocumentPaths = documentPathsForRequest(text, requestBinding);
    const latestUserTask = previousMessages.findLast(message => message.role === 'user' && !isTrivialQuery(message.content))?.content ?? '';
    const switchedTopic = /换(?:个|一个)?话题|新(?:的)?(?:话题|问题|任务)|\b(?:new|different)\s+(?:topic|question|task)|\bswitch topics\b/iu.test(latestUserTask);
    const followsDocument = !switchedTopic && (recentDocumentTaskSessions(previousMessages, id => useAgentSessionStore.getState().getSession(id)).length > 0 || previousMessages.some(message => message.documentContext?.paths.length));
    const topicSwitch = /换(?:个|一个)?话题|新(?:的)?(?:话题|问题|任务)|\b(?:new|different)\s+(?:topic|question|task)|\bswitch topics\b/iu.test(text);
    const implicitDepthFollowup = isDocumentFollowup(text, { hasDocumentContext: true }) && !wantsDocumentReading(text, undefined, { hasDocumentContext: false });
    const includeImplicitDocumentContext = !topicSwitch && !(implicitDepthFollowup && !followsDocument);
    setInput("");

    let historyBeforeSend = getMessagesForApi();
    const requestConversationId = useAiChatStore.getState().activeConversationId;
    const requestRuntimeSettings = toRuntimeSettings(settings, "chat", activeAiProfile);
    addUserMessage(text, { attachments: capturedAttachmentRefs });
    const msgId = startAssistantMessage({ requestMode: "chat" });
    const controller = new AbortController();
    setGenerating(true, controller);
    setAssistantMetadata(msgId, { documentContext: { workspaceKey: requestBinding.workspaceKey, paths: requestDocumentPaths } });
    let preparedContext: Awaited<ReturnType<typeof prepareChatExecution>> | null = null;
    let capturedAttachments: CapturedChatAttachments | null = null;

    try {
      if (!settings.aiEnabled) {
        setAssistantError(msgId, "AI is disabled. Go to Settings > AI to enable it.");
        return;
      }

      capturedAttachments = requestConversationId ? await captureAttachmentsForRequest(text, requestConversationId, controller.signal) : null;
      const target = capturedAttachments ? { paths: [] } : await resolveRequestSources(text, controller.signal, requestBinding);
      historyBeforeSend = await revalidateHistory(requestConversationId, controller.signal, requestBinding.workspaceKey);
      const execution = await prepareChatExecution(text, { ...DEFAULT_CHAT_PROMPT_CONTEXT_OPTIONS, includeImplicitDocumentContext: capturedAttachments ? false : includeImplicitDocumentContext, documentPathsOverride: target.paths, sourceBinding: requestBinding });
      preparedContext = execution;
      preservePreparedContextMetadata(msgId, execution);

      const chatRequest = {
        prompt: text,
        history: historyBeforeSend,
        settings: requestRuntimeSettings,
        filePath: execution.filePath,
        content: execution.activeContent ?? undefined,
        selection: execution.contextValues.selected_text ?? undefined,
        references: execution.references,
        annotations: execution.annotations,
        explicitEvidenceRefs: execution.explicitEvidenceRefs,
        signal: controller.signal,
        availableDocuments: execution.documentPaths,
        images: capturedAttachments?.imageParts,
        onProgress: (progress: import('@/lib/ai/request-lifecycle').AiRequestProgress) => setRequestProgress(msgId, progress),
      };
      const result = settings.aiStreamingEnabled && typeof aiOrchestrator.runChatStreaming === "function"
        ? await aiOrchestrator.runChatStreaming(chatRequest, (delta) => {
            appendToAssistantMessage(msgId, delta);
          })
        : await aiOrchestrator.runChat(chatRequest);

      if (controller.signal.aborted) {
        finishAssistantMessage(msgId);
        return;
      }

      finishAssistantMessage(msgId, ensureVisibleAssistantText(result.text, "chat"));
      setAssistantMetadata(msgId, {
        model: result.model,
        promptProfile: { mode: "chat", prompt: requestRuntimeSettings.systemPrompt },
        evidenceRefs: result.evidenceRefs,
        promptContext: result.context,
        followUpActions: result.followUpActions,
        draftSuggestion: result.draftSuggestion,
      });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        if (err instanceof InterruptedAnswerError) useAiChatStore.getState().retainInterruptedAssistantDraft(msgId, err.partialText);
        finishAssistantMessage(msgId);
      } else {
        setAssistantError(msgId, (err as Error).message ?? "Request failed", err instanceof IncompleteAnswerError ? err.partialText : undefined);
        preservePreparedContextMetadata(msgId, preparedContext);
      }
    } finally { await capturedAttachments?.close(); }
  }, [
    input,
    isGenerating,
    getMessagesForApi,
    addUserMessage,
    activeAiProfile,
    startAssistantMessage,
    setGenerating,
    settings,
    activeTab,
    prepareChatExecution,
    preservePreparedContextMetadata,
    appendToAssistantMessage,
    finishAssistantMessage,
    setAssistantError,
    setAssistantMetadata,
    setRequestProgress,
    documentPathsForRequest,
    workspaceKey,
    workspaceRootPath,
    rootHandle?.name,
    revalidateHistory,
    resolveRequestSources,
    sourceBindingForRequest,
    pendingAttachments,
    requestAttachmentRefs,
    captureAttachmentsForRequest,
  ]);

  const handleResearchAgentRun = useCallback(async (automaticChat = false) => {
    const text = input || (pendingAttachments ? '请分析附件。' : '');
    const capturedAttachmentRefs = requestAttachmentRefs(text);
    if (!text.trim() || isGenerating) return;
    const previousMessages = useAiChatStore.getState().getActiveConversation()?.messages ?? [];
    const continuation = useAiChatStore.getState().getConversationDraft()?.continuation
      ?? documentContinuationForReply(text, previousMessages, id => useAgentSessionStore.getState().getSession(id)) ?? null;
    const naturalContinuation = resolveResearchContinuation(text, previousMessages);
    const requestBinding: ConversationSourceBinding = requestAttachmentRefs(text).length ? { kind: 'local', workspaceKey: workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '' } : sourceBindingForRequest(text);
    if (!automaticChat && selectedResearchWorkflowId) useAiChatStore.getState().setResearchWorkflow(null);
    setInput("");

    let historyBeforeSend = getMessagesForApi();
    const requestConversationId = useAiChatStore.getState().activeConversationId;
    addUserMessage(text, { attachments: capturedAttachmentRefs });
    const msgId = startAssistantMessage({ requestMode: automaticChat ? 'chat' : 'agent' });
    const controller = new AbortController();
    setGenerating(true, controller);
    const requestRuntimeSettings = toRuntimeSettings(settings, automaticChat ? 'chat' : 'agent', activeAiProfile);
    let preparedContext: Awaited<ReturnType<typeof prepareChatExecution>> | null = null;
    let documentSources: AgentDocumentSource[] = [];
    let preparedAnswer: string | undefined;
    let sourceToolIndex: AuthorizedSourceIndex | null = null;
    let cloudSnapshots: CloudAgentSourceSnapshot[] | undefined;
    let capturedAttachments: CapturedChatAttachments | null = null;
    let documentDirectory: ResearchAgentRunInput['documentDirectory'];
    const sessions = useAgentSessionStore.getState();
    let contextualSource = false;
    const previous = continuation?.sourceSessionId ? sessions.getSession(continuation.sourceSessionId) : null;
    const approvedRequest = continuation?.approvalResume ? previous?.executionContinuation?.request : undefined;
    const documentTask = continuation?.documentResume || continuation?.documentRestart ? previous?.documentResearch : undefined;
    const readingContinuation = continuation?.documentResume ? documentTask : undefined;
    // A recovery request belongs to its checkpoint, even if opening that source
    // fails before preparation. Never persist the unrelated active tab as its source.
    let requestDocumentPaths = documentTask ? documentTask.checkpoint.sources.map(source => source.path) : documentPathsForRequest(text, requestBinding);
    let selectedCloudSources = parseCloudSourceSelections(text);
    if (documentTask?.directory?.cloud) selectedCloudSources = documentTask.directory.cloud.selections.map(({ libraryId, itemId, kind }) => ({ libraryId, itemId, kind }));
    let requestWorkspaceKey = documentTask?.workspaceKey ?? requestBinding.workspaceKey;
    const requestIsCloud = requestWorkspaceKey.startsWith('cloud:');
    const documentContext = { workspaceKey: requestWorkspaceKey, paths: requestDocumentPaths };
    let documentReadingObjective = documentTask ? checkpointObjective(documentTask.checkpoint) : undefined;
    const restoredWorkflowId = listResearchAgentWorkflows({ includePdfScoped: true }).find(workflow => workflow.id === (documentTask?.workflowId ?? approvedRequest?.workflowId))?.id;
    const workflowExplicit = !automaticChat && Boolean(restoredWorkflowId || selectedResearchWorkflowId);
    let chosenWorkflow = automaticChat ? (requestsCodeExecution(text) ? 'notebook-analysis' : 'paper-reading') : restoredWorkflowId ?? selectedResearchWorkflowId ?? inferResearchAgentWorkflow({ task: text, query: text, filePath: requestDocumentPaths[0], hasDocumentContext: requestDocumentPaths.length > 0 });
    let folderSelections = documentTask?.directory?.selections.filter(source => source.kind === 'folder') ?? parseSourceSelections(text).filter(source => source.kind === 'folder');
    let folderRetrieval = !documentTask && (requestIsCloud ? selectedCloudSources.some(selection => selection.kind === 'folder') : folderSelections.length > 0) && !isWholeDocumentRequest(text);
    let fullReading = !continuation?.approvalResume && !folderRetrieval && Boolean(documentTask || currentCloudSource || selectedCloudSources.length || folderSelections.length || wantsDocumentReading(text, chosenWorkflow, { hasDocumentContext: requestDocumentPaths.length > 0, workflowExplicit }));
    const sessionId = (readingContinuation || continuation?.approvalResume) && previous ? previous.id : sessions.createSession({ profile: 'research', task: text, title: text.slice(0, 80) });
    setAssistantMetadata(msgId, { agentResult: { sessionId, workflowLabel: getResearchAgentWorkflow(chosenWorkflow).title }, documentContext });

    try {
      if (continuation?.approvalResume && !approvedRequest) throw new Error('未找到已批准执行任务的原始上下文，请从原任务重新开始。');
      if (documentTask && requestConversationId && requestDocumentPaths.some(path => path.startsWith('attachments/'))) {
        const checkpointMessageIndex = previousMessages.findIndex(message => message.agentResult?.sessionId === continuation?.sourceSessionId);
        const sourceMessage = checkpointMessageIndex >= 0 ? previousMessages.slice(0, checkpointMessageIndex).findLast(message => message.role === 'user')
          : previousMessages.findLast(message => message.attachments?.some(ref => requestDocumentPaths.includes(chatAttachmentDocumentPath(ref))));
        const refs = (sourceMessage?.attachments ?? []).filter(ref => ref.conversationId === requestConversationId);
        if (!refs.length) throw new Error('原附件记录无法访问，阅读进度保留；请重新上传原文件。');
        capturedAttachments = await captureChatAttachments({ conversationId: requestConversationId, attachmentIds: [...new Set(refs.map(ref => ref.id))], signal: controller.signal,
          isCurrent: () => useAiChatStore.getState().activeConversationId === requestConversationId });
        fullReading = true;
      }
      if (!documentTask && !approvedRequest) {
        capturedAttachments = requestConversationId ? await captureAttachmentsForRequest(text, requestConversationId, controller.signal) : null;
        const explicitSources = parseSourceSelections(text);
        const workspaceTarget = !capturedAttachments || explicitSources.length ? await resolveRequestSources(text, controller.signal, requestBinding) : null;
        const target: ConversationSourceTargets & { cloudSelections?: CloudAgentSourceSelection[] } = capturedAttachments
          ? { ...workspaceTarget, paths: [...capturedAttachments.sources.map(source => source.path), ...(workspaceTarget?.paths ?? [])], reason: 'attachments' }
          : workspaceTarget!;
        requestDocumentPaths = target.paths;
        // The open document is an available source, not a request to read it in full.
        contextualSource = !workflowExplicit && (target.reason === 'active-document-context' || Boolean(naturalContinuation)) && Boolean(rootHandle) && !requestIsCloud;
        documentContext.paths = target.paths;
        if (target.cloudSelections?.length) { selectedCloudSources = target.cloudSelections; requestWorkspaceKey = `cloud:${selectedCloudSources[0].libraryId}`; documentContext.workspaceKey = requestWorkspaceKey; }
        folderSelections = target.selections?.filter(selection => selection.kind === 'folder') ?? folderSelections;
        folderRetrieval = (requestIsCloud ? selectedCloudSources.some(selection => selection.kind === 'folder') : folderSelections.length > 0) && !isWholeDocumentRequest(text);
        if (!automaticChat && !restoredWorkflowId && !selectedResearchWorkflowId) chosenWorkflow = inferResearchAgentWorkflow({ task: text, query: text, filePath: requestDocumentPaths[0], hasDocumentContext: requestDocumentPaths.length > 0 });
        const broadCurrentDocumentRequest = isWholeDocumentRequest(text) || isBroadDocumentExplanation(text);
        fullReading = !continuation?.approvalResume && !folderRetrieval && (!contextualSource || broadCurrentDocumentRequest)
          && Boolean(capturedAttachments?.sources.length || selectedCloudSources.length || folderSelections.length
            || requestDocumentPaths.length && wantsDocumentReading(text, chosenWorkflow, { hasDocumentContext: true, workflowExplicit }));
        setAssistantMetadata(msgId, { documentContext });
      }
      if ((continuation?.documentResume || continuation?.documentRestart) && !documentTask) throw new Error('未找到原阅读任务，请重新选择要阅读的文件。');
      if (readingContinuation && previous) sessions.resumeDocumentSession(previous.id);
      if (!settings.aiEnabled) {
        sessions.failSession(sessionId, 'AI is disabled.');
        setAssistantError(msgId, "AI is disabled. Go to Settings > AI to enable it.");
        return;
      }

      historyBeforeSend = await revalidateHistory(requestConversationId, controller.signal, requestWorkspaceKey);

      if (fullReading) {
        if (documentTask?.workspaceKey && requestDocumentPaths.some(path => !path.startsWith('attachments/')) && !requestIsCloud
          && documentTask.workspaceKey !== (workspaceKey ?? workspaceRootPath ?? rootHandle?.name)) throw new Error('请回到这项任务原来的工作区后继续，避免读取同名的其他文件。');
        if (capturedAttachments?.sources.length) {
          documentSources = capturedAttachments.sources;
          const localPaths = requestDocumentPaths.filter(path => !path.startsWith('attachments/'));
          if (localPaths.length) documentSources = [...documentSources, ...await captureAgentDocumentSources({ activeTab: null, openTabs: conversationOpenFileTabs(useWorkspaceStore.getState().layout.root),
            rootHandle, query: '', contextPaths: localPaths, signal: controller.signal })];
        }
        else {
        if (requestIsCloud && !requestDocumentPaths.length && selectedCloudSources.length === 0) throw new Error('请先选择云库文件或引用对话中已有的云来源。');
        if (documentTask?.workspaceKey && !documentTask.workspaceKey.startsWith('cloud:') && documentTask.workspaceKey !== (workspaceKey ?? workspaceRootPath ?? rootHandle?.name)) throw new Error('请回到这项任务原来的工作区后继续，避免读取同名的其他文件。');
        // The saved checkpoint must have a durable chat entry from which to resume,
        // even when the first batch finishes before the ordinary save debounce.
        await useAiChatStore.getState().flushConversations();
        if (requestWorkspaceKey.startsWith('cloud:')) {
          const host = getCloudWorkspaceSnapshot();
          if (!host.provider) throw new Error('云来源连接已失效，请重新登录并选择来源。');
          if (documentTask?.directory?.cloud) {
            const provider = host.provider, scope = provider.scope;
            const expectedScope = documentTask.directory.cloud.providerScope;
            documentDirectory = await createCloudDirectoryResearchAdapter({ provider,
              selections: documentTask.directory.cloud.selections.map(({ libraryId, itemId, kind }) => ({ libraryId, itemId, kind })),
              checkpoint: documentTask.directory.cloud, signal: controller.signal,
              isCurrent: () => { const current = getCloudWorkspaceSnapshot(); return current.provider === provider
                && provider.scope === scope && scope === expectedScope
                && useAiChatStore.getState().activeConversationId === requestConversationId; },
            });
            if (documentDirectory.workspaceKey !== requestWorkspaceKey) throw new Error('原云目录属于其他共享库；请切换回原共享库后继续。');
          } else if (documentTask) {
            const saved = Array.from(new Map(previousMessages.flatMap(message => message.documentContext?.cloudSnapshots ?? []).filter(snapshot => requestDocumentPaths.includes(snapshot.path)).map(snapshot => [snapshot.path, snapshot])).values());
            if (!saved.length) throw new Error('旧云任务缺少稳定来源身份，请重新选择源文件。');
            cloudSnapshots = [];
            for (const snapshot of saved) {
              const resource = await host.provider.read(snapshot.cloudIdentity.libraryId, snapshot.cloudIdentity.itemId);
              const captured = await captureCloudAgentDocumentSources({ provider: host.provider, resource, signal: controller.signal, isCurrent: () => getCloudWorkspaceSnapshot().provider === host.provider });
              documentSources.push(...captured.sources); cloudSnapshots.push(...captured.snapshots);
            }
          } else if (selectedCloudSources.some(selection => selection.kind === 'folder')) {
            const provider = host.provider, scope = provider.scope;
            documentDirectory = await createCloudDirectoryResearchAdapter({ provider, selections: selectedCloudSources,
              signal: controller.signal, isCurrent: () => { const current = getCloudWorkspaceSnapshot(); return current.provider === provider
                && provider.scope === scope && scope === requestBinding.providerScope
                && useAiChatStore.getState().activeConversationId === requestConversationId; } });
            if (documentDirectory.workspaceKey !== requestWorkspaceKey) throw new Error('所选云目录不属于当前共享库。');
          } else if (selectedCloudSources.length) {
            const selectedProvider = host.provider;
            const selectedScope = selectedProvider.scope;
            const captured = await captureSelectedCloudAgentDocumentSources({ provider: selectedProvider, selections: selectedCloudSources, signal: controller.signal,
              isCurrent: () => getCloudWorkspaceSnapshot().provider === selectedProvider && selectedProvider.scope === selectedScope });
            documentSources = captured.sources; cloudSnapshots = captured.snapshots;
          } else {
            const captured = await captureActiveCloudAgentDocumentSources({ signal: controller.signal });
            if (!captured) throw new Error('云当前资源已改变，请重新选择来源。');
            documentSources = captured.sources; cloudSnapshots = captured.snapshots;
          }
        } else if (folderSelections.length) {
          if (!rootHandle) throw new Error('目录阅读需要重新授权原工作区。');
          const requestRoot = rootHandle;
          documentDirectory = { rootHandle: requestRoot,
            selections: documentTask?.directory?.selections ?? [...new Map([...parseSourceSelections(text), ...folderSelections].map(source => [`${source.kind}:${source.path}`, source])).values()],
            isCurrent: () => { const current = useWorkspaceStore.getState(); return current.rootHandle === requestRoot
              && (current.workspaceIdentity?.workspaceKey ?? current.workspaceRootPath ?? current.rootHandle?.name) === requestWorkspaceKey
              && useAiChatStore.getState().activeConversationId === requestConversationId; },
          };
        } else documentSources = await captureAgentDocumentSources({ activeTab, openTabs: conversationOpenFileTabs(useWorkspaceStore.getState().layout.root), rootHandle, query: text, contextPaths: requestDocumentPaths, contextSelections: [...parseSourceSelections(text), ...folderSelections], resumePaths: documentTask ? requestDocumentPaths : undefined, signal: controller.signal });
        }
        if (!documentDirectory?.cloud) setAssistantMetadata(msgId, { documentContext: { workspaceKey: requestWorkspaceKey, paths: documentSources.map(source => source.path), ...(cloudSnapshots ? { cloudSnapshots } : { snapshots: snapshotAgentDocumentSources(documentSources, requestWorkspaceKey) }) } });
        if (automaticChat && !documentTask && !documentDirectory) {
          const candidates = recentDocumentTaskSessions(previousMessages, id => sessions.getSession(id));
          const reusable = reusableDocumentReading(text, candidates, documentSources, requestWorkspaceKey);
          if (reusable) {
            await sessions.saveDocumentResearch(sessionId, reusable.state);
            documentReadingObjective = reusable.objective;
          }
        }
      }
      const execution = approvedRequest ? {
        filePath: approvedRequest.filePath,
        documentPaths: [...new Set([approvedRequest.filePath, ...(approvedRequest.references ?? []).map(reference => reference.path)].filter((path): path is string => Boolean(path)))],
        activeContent: approvedRequest.content ?? '', annotations: [], references: approvedRequest.references ?? [], explicitEvidenceRefs: approvedRequest.explicitEvidenceRefs, documentSnapshots: [] as AgentSourceSnapshot[],
        contextValues: { selected_text: approvedRequest.selection ?? null, current_file: approvedRequest.filePath ?? null, current_file_content: approvedRequest.content ?? null, pdf_annotations: null, workspace_summary: null } satisfies PromptContextValues,
      } : fullReading || contextualSource ? {
        filePath: documentSources[0]?.path ?? requestDocumentPaths[0],
        documentPaths: documentSources.length ? documentSources.map(source => source.path) : requestDocumentPaths,
        activeContent: '', annotations: [], references: [], explicitEvidenceRefs: undefined, documentSnapshots: [] as AgentSourceSnapshot[],
        contextValues: { selected_text: null, current_file: documentSources[0]?.path ?? requestDocumentPaths[0] ?? null, current_file_content: null, pdf_annotations: null, workspace_summary: null } satisfies PromptContextValues,
      } : await prepareChatExecution(folderRetrieval ? '' : text, {
        includeImplicitDocumentContext: !folderRetrieval && !capturedAttachments,
        includeCurrentFileContent: !folderRetrieval && !capturedAttachments,
        includeAnnotations: !folderRetrieval && !capturedAttachments,
        includeWorkspaceSummary: !folderRetrieval && !capturedAttachments,
        documentPathsOverride: folderRetrieval ? [] : requestDocumentPaths,
        sourceBinding: { ...requestBinding, workspaceKey: requestWorkspaceKey, kind: requestIsCloud ? 'cloud' : 'local' },
      });
      preparedContext = execution;
      const apiCloudProvider = requestIsCloud ? getCloudWorkspaceSnapshot().provider : null;
      const isApiToolCurrent = () => {
        if (useAiChatStore.getState().activeConversationId !== requestConversationId) return false;
        if (requestIsCloud) {
          const current = getCloudWorkspaceSnapshot();
          return Boolean(apiCloudProvider && current.provider === apiCloudProvider && apiCloudProvider.scope === requestBinding.providerScope
            && (!current.active || !current.resource || current.resource.libraryId === requestWorkspaceKey.slice(6)));
        }
        const current = useWorkspaceStore.getState();
        return current.rootHandle === rootHandle &&
          (current.workspaceIdentity?.workspaceKey ?? current.workspaceRootPath ?? current.rootHandle?.name) === requestWorkspaceKey;
      };
      const assertApiToolScope = () => {
        controller.signal.throwIfAborted();
        if (!isApiToolCurrent()) throw new Error('当前请求的工作区或云库授权已改变，source/PDF 工具未执行。');
      };
      const explicitSourceSelections = parseSourceSelections(text);
      const sourceSelections = [...new Map([...explicitSourceSelections, ...folderSelections,
        ...(!folderSelections.length ? requestDocumentPaths.filter(path => !path.startsWith('attachments/')).map(path => ({ kind: 'file' as const, path })) : [])]
        .map(source => [`${source.kind}:${source.path}`, source])).values()];
      // Opening a workspace authorizes on-demand discovery there. The active or
      // historical document remains the preferred target, not a file-only tool fence.
      // Explicit file/folder selections and attachment-only requests keep their scope.
      const localToolSelections = explicitSourceSelections.length ? explicitSourceSelections
        : folderSelections.length ? folderSelections : [{ kind: 'folder' as const, path: '.' }];
      sourceToolIndex = rootHandle && !requestIsCloud && (!capturedAttachments || sourceSelections.length) ? createAuthorizedSourceIndex({ rootHandle, workspaceKey: requestWorkspaceKey,
        selections: localToolSelections }) : null;
      const onApiDraft = async (draft: HarnessReviewDraft) => {
        assertApiToolScope();
        const draftId = useAiWorkbenchStore.getState().createDraft({ ...draft, originMessageId: msgId });
        setAssistantMetadata(msgId, { workspaceDraftId: draftId });
        await useAiChatStore.getState().flushConversations();
        return draftId;
      };
      const apiCloudSelections = selectedCloudSources.length ? selectedCloudSources : (cloudSnapshots ?? []).map(snapshot => ({ kind: 'file' as const,
        libraryId: snapshot.cloudIdentity.libraryId, itemId: snapshot.cloudIdentity.itemId }));
      const apiCloudFile = apiCloudSelections.find(selection => selection.kind === 'file');
      const apiCloudResource = requestIsCloud && apiCloudProvider && apiCloudFile
        ? await apiCloudProvider.read(apiCloudFile.libraryId, apiCloudFile.itemId, controller.signal) : null;
      if (requestIsCloud) assertApiToolScope();
      const sourceTools = requestIsCloud && apiCloudProvider ? createLatticeHarnessToolRuntime({ kind: 'cloud',
        getProvider: () => getCloudWorkspaceSnapshot().provider, selections: apiCloudSelections, getActiveResource: () => apiCloudResource,
        isCurrent: isApiToolCurrent, onDraft: onApiDraft })
        : sourceToolIndex && rootHandle ? createLatticeHarnessToolRuntime({ kind: 'local', index: sourceToolIndex, root: rootHandle, workspaceKey: requestWorkspaceKey,
          getActivePath: () => requestDocumentPaths[0] ?? (!folderRetrieval ? activeTab?.filePath : null),
          isCurrent: isApiToolCurrent, onDraft: onApiDraft }) : null;
      const mergedTools = capturedAttachments?.sources.length ? withAttachmentTools({ runtime: sourceTools, sources: capturedAttachments.sources, workspaceKey: requestWorkspaceKey,
        isCurrent: () => useAiChatStore.getState().activeConversationId === requestConversationId }) : sourceTools;
      const apiToolRuntime = mergedTools ? { tools: mergedTools.tools, sourceSelections,
        ...(!requestIsCloud && sourceToolIndex ? { authorizedSourceSelections: localToolSelections } : {}), requireSourceDiscovery: folderRetrieval,
        execute: async (name: string, args: unknown, signal?: AbortSignal) => {
        if (!capturedAttachments) assertApiToolScope();
        const result = await mergedTools.execute(name, args, signal);
        if (!capturedAttachments) assertApiToolScope();
        const reads = agentToolSourceReads(name, result);
        if (reads.length) {
          const message = useAiChatStore.getState().conversations.find(conversation => conversation.id === requestConversationId)?.messages.find(message => message.id === msgId);
          const snapshots = [...(message?.documentContext?.snapshots ?? []), ...(message?.documentContext?.cloudSnapshots ?? []), ...reads.map(read => read.snapshot)];
          const unique = [...new Map(snapshots.map(snapshot => [snapshot.path + ':' + snapshot.version, snapshot])).values()];
          const cloudReads: CloudAgentSourceSnapshot[] = unique.flatMap(snapshot => snapshot.cloudIdentity
            ? [{ ...snapshot, cloudIdentity: snapshot.cloudIdentity, providerScope: requestBinding.providerScope ?? undefined }] : []);
          setAssistantMetadata(msgId, { documentContext: { workspaceKey: requestWorkspaceKey, paths: unique.map(snapshot => snapshot.path),
            ...(requestIsCloud ? { cloudSnapshots: cloudReads } : { snapshots: unique }) } });
        }
        return result;
      } } : undefined;

      if (controller.signal.aborted) {
        const state = sessions.getSession(sessionId);
        if (state && state.status !== 'cancelled' && state.status !== 'failed' && state.status !== 'completed') sessions.cancelSession(sessionId);
        finishAssistantMessage(msgId);
        return;
      }

      const result = await runResearchAgentForChat({
        apiToolRuntime,
        images: capturedAttachments?.imageParts,
        sourceSelections,
        requireSourceDiscovery: folderRetrieval,
        sessionId,
        documentSources: documentSources.length ? documentSources : undefined,
        documentDirectory,
        documentReadingObjective,
        responseMode: automaticChat || (!selectedResearchWorkflowId && chosenWorkflow !== 'pdf-annotation') ? 'conversation' : undefined,
        settings: requestRuntimeSettings,
        ...(automaticChat ? { workflowId: chosenWorkflow } : restoredWorkflowId ? { workflowId: restoredWorkflowId } : selectedResearchWorkflowId ? { workflowId: selectedResearchWorkflowId } : {}),
        history: historyBeforeSend,
        onProgress: progress => setRequestProgress(msgId, progress),
        onAnswerDelta: chosenWorkflow === 'pdf-annotation' ? undefined : delta => appendToAssistantMessage(msgId, delta),
        noteConfigOverrides,
        // Recover the accepted next action independently of evidence history.
        // Source revalidation may intentionally omit an unverified old answer.
        task: naturalContinuation ? `执行已确认的下一步：${naturalContinuation.nextAction}` : text,
        title: `Research Agent: ${text.slice(0, 80)}`,
        query: naturalContinuation?.query ?? text,
        sourceIntentQuery: naturalContinuation?.sourceIntentQuery ?? text,
        filePath: documentSources[0]?.path ?? execution.filePath,
        content: execution.activeContent ?? "",
        selection: execution.contextValues.selected_text ?? undefined,
        references: execution.references,
        explicitEvidenceRefs: execution.explicitEvidenceRefs,
        workspaceKey: requestWorkspaceKey,
        includeWorkspaceSummary: !requestIsCloud && !folderRetrieval && !capturedAttachments && sourceSelections.some(selection => selection.kind === 'folder' && selection.path === '.'),
        suggestMemory: suggestMemoryForRun,
        continuation: documentTask ? undefined : continuation ?? undefined,
        plannerSignal: controller.signal,
        compact: true,
        maxObservationReplans: composerView.effortConfig.maxObservationReplans,
        maxReadToolSteps: composerView.effortConfig.maxReadToolSteps,
        ...(composerView.effortConfig.contextBudgetProfileId ? { contextBudgetProfileId: composerView.effortConfig.contextBudgetProfileId } : {}),
      });

      if (documentDirectory) {
        const directory = sessions.getSession(sessionId)?.documentResearch?.directory;
        const snapshots = directory?.files.flatMap(file => file.snapshot ? [file.snapshot] : []) ?? [];
        if (documentDirectory.cloud) {
          cloudSnapshots = snapshots.filter((source): source is CloudAgentSourceSnapshot => Boolean(source.cloudIdentity))
            .map(source => ({ ...source, cloudIdentity: source.cloudIdentity!, providerScope: source.providerScope ?? documentDirectory?.cloud?.providerScope }));
          setAssistantMetadata(msgId, { documentContext: { workspaceKey: requestWorkspaceKey,
            paths: cloudSnapshots.map(source => source.path), cloudSnapshots } });
        } else setAssistantMetadata(msgId, { documentContext: { workspaceKey: requestWorkspaceKey, paths: snapshots.map(source => source.path), snapshots } });
      }

      if (controller.signal.aborted) {
        finishAssistantMessage(msgId);
        return;
      }

      if (result.annotationProposal?.length) {
        useAiPdfCompanionStore.getState().setTransientAnnotations(result.annotationProposal, msgId);
      }
      preparedAnswer = ensureVisibleAssistantText(result.chatText, 'agent');
      if (cloudSnapshots && parsePdfMarkdownChildRequest(text)) {
        const host = getCloudWorkspaceSnapshot();
        const pdfSnapshots = cloudSnapshots.filter(snapshot => snapshot.kind === 'pdf');
        if (!host.provider || host.provider !== cloudHost.provider || host.provider.scope !== requestBinding.providerScope || pdfSnapshots.length !== 1 || !result.draftSuggestion) {
          throw new Error('云 PDF 子文件需要一个已读取的父 PDF 和有效云连接；本次回答保留，未生成本地草稿。');
        }
        result.draftSuggestion = await bindCloudPdfChildDraft({ provider: host.provider, snapshot: pdfSnapshots[0], task: text,
          draft: result.draftSuggestion, signal: controller.signal,
          isCurrent: () => getCloudWorkspaceSnapshot().provider === host.provider && host.provider?.scope === requestBinding.providerScope });
      } else if (result.draftSuggestion?.pdfChildTarget) {
        if (!rootHandle) throw new Error('PDF 所属工作区已关闭，回答保留；请回到原工作区生成子文件。');
        if (useWorkspaceStore.getState().rootHandle !== rootHandle) throw new Error('工作区已切换，回答保留；请回到原 PDF 工作区。');
        const directorySnapshots = sessions.getSession(sessionId)?.documentResearch?.directory?.files.flatMap(file => file.snapshot ? [file.snapshot] : []) ?? [];
        const snapshots = [...snapshotAgentDocumentSources(documentSources, requestWorkspaceKey), ...execution.documentSnapshots, ...directorySnapshots];
        const child = result.draftSuggestion.pdfChildTarget;
        const snapshot = snapshots.find(source => source.path === child.sourcePath);
        if (!snapshot) throw new Error('PDF 子文件缺少已读取的源版本，回答保留；请重新选择父 PDF。');
        result.draftSuggestion.pdfChildTarget = await resolvePdfChildTargetRevision({ root: rootHandle, child, snapshot, signal: controller.signal });
      }
      controller.signal.throwIfAborted();
      finishAssistantMessage(msgId, preparedAnswer);
      setAssistantMetadata(msgId, {
        model: result.plannerModelInfo ?? undefined,
        promptProfile: { mode: automaticChat ? "chat" : "agent", prompt: requestRuntimeSettings.systemPrompt },
        evidenceRefs: result.result.promptContext.evidenceRefs,
        promptContext: result.result.promptContext,
        followUpActions: result.followUpActions,
        draftSuggestion: result.draftSuggestion,
        agentResult: result.agentResult,
      });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        const state = sessions.getSession(sessionId);
        if (state && state.status !== 'cancelled' && state.status !== 'failed' && state.status !== 'completed') sessions.cancelSession(sessionId);
        if (err instanceof InterruptedAnswerError) useAiChatStore.getState().retainInterruptedAssistantDraft(msgId, err.partialText);
        finishAssistantMessage(msgId);
      } else {
        const state = sessions.getSession(sessionId);
        const errorMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Research agent failed';
        if (state && state.status !== 'failed' && state.status !== 'cancelled' && state.status !== 'completed') sessions.failSession(sessionId, errorMessage);
        setAssistantError(msgId, errorMessage, err instanceof IncompleteAnswerError ? err.partialText : preparedAnswer);
        preservePreparedContextMetadata(msgId, preparedContext, documentTask ? documentContext : undefined);
      }
    } finally {
      sourceToolIndex?.invalidate();
      await Promise.allSettled(documentSources.map(source => source.close()));
      await capturedAttachments?.close();
    }
  }, [
    activeTab,
    addUserMessage,
    activeAiProfile,
    composerView.effortConfig,
    appendToAssistantMessage,
    finishAssistantMessage,
    input,
    isGenerating,
    documentPathsForRequest,
    getMessagesForApi,
    setRequestProgress,
    prepareChatExecution,
    preservePreparedContextMetadata,
    rootHandle,
    selectedResearchWorkflowId,
    noteConfigOverrides,
    setAssistantError,
    setAssistantMetadata,
    setGenerating,
    settings,
    startAssistantMessage,
    suggestMemoryForRun,
    workspaceKey,
    workspaceRootPath,
    revalidateHistory,
    currentCloudSource,
    resolveRequestSources,
    sourceBindingForRequest,
    cloudHost.provider,
    persistedContinuation,
    pendingAttachments,
    requestAttachmentRefs,
    captureAttachmentsForRequest,
  ]);

  const handleLongInput = useCallback(async () => {
    if (!input.trim() || isGenerating) return;
    setBudgetError(null);
    const state = useAiChatStore.getState();
    const conversationId = state.activeConversationId ?? state.newConversation();
    const original = input;
    const controller = new AbortController();
    const requestRuntime = toRuntimeSettings(settings, 'chat', activeAiProfile);
    const resume = state.getLongInputResume(undefined, conversationId);
    let messageId: string | null = null;
    const startedAt = Date.now();
    try {
      const selection = routeModel('chat', requestRuntime);
      const models = await selection.provider.getAvailableModels();
      const model = configuredModel ?? models.find(model => model.id === requestRuntime.model) ?? models[0];
      if (!model?.contextWindow) throw new Error('模型上下文上限尚未确认，请选择有上下文配置的模型。原草稿已完整保留。');
      const history = await revalidateHistory(conversationId, controller.signal);
      const budget = estimateLongInputBudget({ input: original, model, systemPrompt: requestRuntime.systemPrompt, history });
      if (!budget.requiresBatching) throw new Error('当前完整输入在此模型估计预算内，请直接发送。');
      if (useAiChatStore.getState().isGenerating || useAiChatStore.getState().activeConversationId !== conversationId) return;
      state.addUserMessage(original);
      messageId = state.startAssistantMessage({ requestMode: 'agent' });
      state.setGenerating(true, controller);
      setInput('');
      const sessionId = `long-input:${messageId}`;
      const result = await processLongInput({ input: original, instruction: '识别完整长输入中用户明确的任务和约束并完成回答，保留公式、代码及表格的含义；缺少细节时说明限制。', model,
        systemPrompt: requestRuntime.systemPrompt, history, generate: selection.provider.generate.bind(selection.provider), signal: controller.signal,
        checkpoint: resume?.input === original ? resume.checkpoint : undefined,
        onCheckpoint: async checkpoint => {
          const current = useAiChatStore.getState();
          current.setAssistantMetadata(messageId!, { agentResult: { sessionId, inputCheckpoint: checkpoint, deliveryStatus: checkpoint.status === 'completed' ? 'ready_for_review' : 'partial' } });
          current.setRequestProgress(messageId!, { phase: checkpoint.status === 'completed' ? 'validating' : 'receiving', startedAt, lastActivityAt: Date.now(), attempt: checkpoint.completed.length + 1 });
          await current.flushConversations();
        },
      });
      controller.signal.throwIfAborted();
      state.finishAssistantMessage(messageId, result.text);
      state.setAssistantMetadata(messageId, { model: selection.modelInfo, agentResult: { sessionId, inputCheckpoint: result.checkpoint, deliveryStatus: 'ready_for_review' } });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      if (!messageId) { setBudgetError(error); return; }
      if (cause instanceof LongInputProcessingError) state.setAssistantMetadata(messageId, { agentResult: { sessionId: `long-input:${messageId}`, inputCheckpoint: cause.checkpoint, deliveryStatus: 'partial' } });
      if (controller.signal.aborted) state.finishAssistantMessage(messageId);
      else state.setAssistantError(messageId, error);
    }
  }, [input, isGenerating, settings, activeAiProfile, configuredModel, setInput, revalidateHistory]);

  const handleHarnessTurn = useCallback(async () => {
    const text = input || (pendingAttachments ? '请分析附件。' : '');
    if (!text.trim() || isGenerating) return;
    setBudgetError(null);
    const attachmentRefs = requestAttachmentRefs(text);
    const requestBinding: ConversationSourceBinding = attachmentRefs.length ? { kind: 'local', workspaceKey: workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '' } : sourceBindingForRequest(text);
    const requestIsCloud = requestBinding.kind === 'cloud';
    if (!requestIsCloud && !attachmentRefs.length && (!workspaceRootPath || !rootHandle)) { setBudgetError('请先打开工作区或上传文件。原草稿已保留。'); return; }
    const chat = useAiChatStore.getState();
    const conversationId = chat.activeConversationId ?? chat.newConversation();
    const controller = new AbortController();
    chat.addUserMessage(text, { attachments: attachmentRefs });
    const messageId = chat.startAssistantMessage({ requestMode: 'agent' });
    chat.setGenerating(true, controller);
    setInput('');
    const key = requestBinding.workspaceKey;
    const provider = requestIsCloud ? cloudHost.provider : null;
    const isCurrent = () => {
      if (requestIsCloud) {
        const cloud = getCloudWorkspaceSnapshot();
        return Boolean(provider && cloud.provider === provider && provider.scope === requestBinding.providerScope
          && (!cloud.active || !cloud.resource || cloud.resource.libraryId === key.slice(6)));
      }
      return useWorkspaceStore.getState().rootHandle === rootHandle
        && (useWorkspaceStore.getState().workspaceIdentity?.workspaceKey ?? workspaceRootPath ?? rootHandle?.name ?? '') === key;
    };
    let index: AuthorizedSourceIndex | null = null;
    let capturedAttachments: CapturedChatAttachments | null = null;
    try {
      await chat.flushConversations();
      capturedAttachments = await captureAttachmentsForRequest(text, conversationId, controller.signal);
      const explicitSources = parseSourceSelections(text);
      const workspaceTarget = !capturedAttachments || explicitSources.length ? await resolveRequestSources(text, controller.signal, requestBinding) : null;
      const target: ConversationSourceTargets & { cloudSelections?: CloudAgentSourceSelection[] } = capturedAttachments
        ? { ...workspaceTarget, paths: [...capturedAttachments.sources.map(source => source.path), ...(workspaceTarget?.paths ?? [])], reason: 'attachments' }
        : workspaceTarget!;
      const history = await revalidateHistory(conversationId, controller.signal, key);
      const onDraft = async (draft: HarnessReviewDraft) => {
        controller.signal.throwIfAborted();
        if (!isCurrent() || useAiChatStore.getState().activeConversationId !== conversationId) throw new Error('会话或来源权限已改变，本次未生成写入草稿。');
        const draftId = useAiWorkbenchStore.getState().createDraft(draft);
        chat.setAssistantMetadata(messageId, { workspaceDraftId: draftId });
        await chat.flushConversations();
        return draftId;
      };
      const cloudSelections = target.cloudSelections?.length ? target.cloudSelections : currentCloudSource?.libraryId === key.slice(6)
        ? [{ kind: currentCloudSource.kind === 'folder' ? 'folder' as const : 'file' as const, libraryId: currentCloudSource.libraryId, itemId: currentCloudSource.itemId }] : [];
      const selectedCloud = cloudSelections.find(selection => selection.kind === 'file');
      const capturedCloud = requestIsCloud && provider && selectedCloud && !isTrivialQuery(text)
        ? await provider.read(selectedCloud.libraryId, selectedCloud.itemId, controller.signal) : currentCloudSource;
      if (!isCurrent()) throw new Error('工作区或云库授权范围已改变，本次请求未执行。');
      const targetFolders = target.selections?.filter(source => source.kind === 'folder') ?? [];
      if (!requestIsCloud && rootHandle && (!capturedAttachments || explicitSources.length)) index = createAuthorizedSourceIndex({ rootHandle, workspaceKey: key,
        selections: explicitSources.length ? explicitSources : targetFolders.length ? targetFolders : [{ kind: 'folder', path: '.' }] });
      const baseTools = requestIsCloud ? createLatticeHarnessToolRuntime({ kind: 'cloud', getProvider: () => getCloudWorkspaceSnapshot().provider,
        selections: cloudSelections, getActiveResource: () => capturedCloud, isCurrent, onDraft })
        : index && rootHandle ? createLatticeHarnessToolRuntime({ kind: 'local', index, root: rootHandle, workspaceKey: key,
          getActivePath: () => target.paths[0] ?? requestBinding.referentPaths?.[0] ?? activeTab?.filePath, isCurrent, onDraft }) : null;
      const tools = capturedAttachments?.sources.length ? withAttachmentTools({ runtime: baseTools, sources: capturedAttachments.sources, workspaceKey: key, isCurrent }) : baseTools;
      const snapshots = new Map<string, AgentSourceSnapshot>();
      const rememberReads = (reads: readonly AgentSourceRead[]) => {
        for (const read of reads) snapshots.set(read.snapshot.path, read.snapshot);
        if (!snapshots.size) return;
        const all = [...snapshots.values()];
        const cloudSnapshots: CloudAgentSourceSnapshot[] = all.flatMap(snapshot => snapshot.cloudIdentity
          ? [{ ...snapshot, cloudIdentity: snapshot.cloudIdentity, providerScope: requestBinding.providerScope ?? undefined }] : []);
        chat.setAssistantMetadata(messageId, { documentContext: { workspaceKey: key, paths: all.map(snapshot => snapshot.path),
          ...(requestIsCloud ? { cloudSnapshots } : { snapshots: all }) } });
      };
      await useAgentMemoryStore.getState().loadMemories();
      const prepared = await prepareHarnessConversationContext({ text, history, paths: target.paths, workspaceKey: key, conversationId,
        memories: useAgentMemoryStore.getState().persistenceError ? [] : useAgentMemoryStore.getState().entries,
        execute: tools?.execute ?? (async () => { throw new Error('当前没有可读取来源。'); }), signal: controller.signal });
      rememberReads(prepared.reads);
      const nativeWorkspace = requestIsCloud ? await cloudHarnessWorkspaceSpec(provider?.scope, key.slice(6))
        : workspaceRootPath ?? await cloudHarnessWorkspaceSpec(`attachments:${conversationId}`, 'uploads');
      const fullDocumentRead = target.paths.length > 0 && !isTrivialQuery(text)
        && (isWholeDocumentRequest(text) || isBroadDocumentExplanation(text));
      const readTurn = async (turnText: string, turn: number) => {
        const turnReads: AgentSourceRead[] = [];
        const answer = await useAiHarnessStore.getState().sendTurn({ conversationId, workspace: nativeWorkspace, text: turnText,
        images: turn === 0 ? capturedAttachments?.imageParts.map(part => ({ data: part.data!, mimeType: part.mimeType! })) : undefined, signal: controller.signal,
        onBeforeTurn: async () => {
          controller.signal.throwIfAborted();
          if (useAiChatStore.getState().activeConversationId !== conversationId || !isCurrent()) throw new Error('对话、账号或来源范围已改变，已取消发送原文档内容。请在当前来源下重新提问。');
          if (requestIsCloud && provider) {
            const captured = [...snapshots.values()].filter((snapshot): snapshot is CloudAgentSourceSnapshot => Boolean(snapshot.cloudIdentity));
            const validation = await validateCloudAgentSourceSnapshots({ provider: getCloudWorkspaceSnapshot().provider, snapshots: captured, signal: controller.signal });
            if (validation.invalid.length || !isCurrent()) throw new Error('云文档版本、权限或账号范围在连接期间已改变，已取消发送原文档内容。请重新选择来源。');
          } else if (index) {
            const validation = await index.validateSnapshots([...snapshots.values()].filter(snapshot => !snapshot.path.startsWith('attachments/')), controller.signal);
            if (validation.invalid.length || !isCurrent()) throw new Error('本地文档版本、权限或来源在连接期间已改变，已取消发送原文档内容。请重新提问。');
          }
        },
        onEvent: event => {
          const harness = useAiHarnessStore.getState();
          const connection = harness.connections[conversationId];
          const session = harness.sessions[conversationId];
          const scoped = Boolean(connection && event.connectionId === connection.connectionId
            && (!event.sessionId || !session?.sessionId || event.sessionId === session.sessionId)
            && (!event.turnId || !session?.turnId || event.turnId === session.turnId));
          if (scoped && fullDocumentRead && turn > 0 && event.kind === 'started' && !controller.signal.aborted) {
            chat.replaceAssistantDraft(messageId, '');
          }
          const answer = harnessAnswerEvent(event);
          if (scoped && answer && !controller.signal.aborted) {
            if (answer.mode === 'append') chat.appendToAssistantMessage(messageId, answer.text);
            else chat.replaceAssistantDraft(messageId, answer.text);
          }
        },
        onToolCall: async call => {
          try {
            controller.signal.throwIfAborted();
            if (!isCurrent()) throw new Error('工作区或云库授权范围已改变，本次工具请求未执行。');
            if (!tools) throw new Error('该请求只有图像输入，没有授权文档工具。');
            const result = await tools.execute(harnessToolNameToLattice(call.tool), call.arguments, controller.signal);
            controller.signal.throwIfAborted();
            const name = harnessToolNameToLattice(call.tool);
            const reads = agentToolSourceReads(name, result);
            turnReads.push(...reads);
            rememberReads(reads);
            return { success: true, text: JSON.stringify(result) };
          } catch (cause) { return { success: false, text: cause instanceof Error ? cause.message : String(cause) }; }
        },
        });
        return { answer, reads: turnReads };
      };
      const reading = await runHarnessDocumentReadingLoop({ query: text, paths: target.paths, initialPrompt: prepared.prompt,
        initialReads: prepared.reads, signal: controller.signal,
        sendTurn: async (prompt, options) => {
          const turn = await readTurn(prompt, options.turn);
          options.recordReads(turn.reads);
          return turn.answer;
        },
      });
      if (fullDocumentRead && !reading.complete) {
        const incomplete = reading.coverage.map(item => `${item.path}: 已读 ${item.readUnits.length}/${item.totalUnits ?? '?'} 页/节；待读 ${item.totalUnits === null ? '尚未核实页数' : item.pendingUnits.join(', ') || '无'}；无法读取 ${item.unreadableUnits.map(unit => unit.unit).join(', ') || '无'}${item.versionChanged ? '；读取期间来源版本发生变化，覆盖作废' : ''}`).join('\n');
        const message = `全文读取未完成，已保留当前回答草稿；未将部分页面结果标记为完整讲解。${incomplete ? `\n${incomplete}` : '\n没有获得可核验的实际页码覆盖。'} 请继续读取或缩小任务范围。`;
        chat.setAssistantMetadata(messageId, { agentResult: { sessionId: `harness:${conversationId}`, deliveryStatus: 'partial', warnings: [message] } });
        chat.setAssistantError(messageId, message, reading.text);
        return;
      }
      controller.signal.throwIfAborted();
      chat.finishAssistantMessage(messageId, reading.text || '本机 Agent 已完成本次执行，未提供回答文本。请查看实际执行事件。');
      const config = useAiHarnessStore.getState().config;
      chat.setAssistantMetadata(messageId, { model: { providerId: 'custom', providerName: config.engine === 'codex' ? '本机 Codex' : '本机 Claude Code', model: config.model ?? null, source: 'local' } });
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) chat.finishAssistantMessage(messageId);
      else chat.setAssistantError(messageId, describeHarnessFailure(cause));
    } finally { index?.invalidate(); await capturedAttachments?.close(); }
  }, [input, isGenerating, workspaceKey, workspaceRootPath, rootHandle, activeTab?.filePath, setInput, resolveRequestSources, revalidateHistory, sourceBindingForRequest, cloudHost.provider, currentCloudSource,
    pendingAttachments, requestAttachmentRefs, captureAttachmentsForRequest]);

  const applyPromptTemplateToInput = useCallback(async (template: PromptTemplate) => {
    setPromptPickerOpen(false);
    const snapshot = await buildChatContextSnapshot(DEFAULT_CHAT_PROMPT_CONTEXT_OPTIONS);
    const rendered = renderPromptTemplate(template, snapshot.contextValues, locale);
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
  }, [buildChatContextSnapshot, locale, rememberTemplateUsage, workspaceKey, workspaceRootPath]);

  const handleFileTask = useCallback(async () => {
    const task = input.trim();
    if (!task || isGenerating) return;
    const controller = new AbortController();
    addUserMessage(task);
    setInput('');
    setGenerating(true, controller);
    const id = startAssistantMessage({ requestMode: inputMode });
    try {
      const request = parseWorkspaceFileTask(task, activeTab?.filePath);
      if (!request || !rootHandle) throw new Error('请先打开文件所属工作区，再执行文件操作。');
      if (!settings.aiEnabled && !request.empty) throw new Error('请先启用 AI。');
      if (request.operation === 'update' && activeTab?.isDirty) throw new Error('当前文件有未保存修改，请先保存再生成编辑建议。');
      const requestRoot = rootHandle;
      const requestKey = workspaceKey ?? workspaceRootPath ?? rootHandle.name;
      if (!request.empty) {
        await initKeyStorage();
        await useAiProviderProfileStore.getState().hydrate();
      }
      await useAiWorkbenchStore.getState().loadWorkbench();
      const fileProfile = useAiProviderProfileStore.getState().getActiveProfile();
      if (!request.empty && (request.operation === 'update' || request.pdfParent) && fileProfile?.privacy.sendCurrentFile === false) throw new Error('当前连接禁止发送文件内容，请先在该连接的隐私设置中允许，再生成文件编辑建议。');
      const runtime = toRuntimeSettings(useSettingsStore.getState().settings, inputMode, useAiProviderProfileStore.getState().getActiveProfile());
      let sourceContext: { text: string; sourceRefs: import('@/lib/ai/types').EvidenceRef[]; snapshot: AgentSourceSnapshot } | undefined;
      if (request.pdfParent && !request.empty) {
        const parentHandle = await resolveAuthorizedDocumentHandle(requestRoot, request.pdfParent);
        const parentFile = await parentHandle.getFile();
        if (parentFile.size > 32_000_000) throw new Error('父 PDF 超过单次子文件生成的读取预算，请先按章节分析，再生成子文件。');
        const source = await openAgentDocumentSource(parentFile, request.pdfParent, controller.signal);
        try {
          const units: string[] = [];
          const refs: import('@/lib/ai/types').EvidenceRef[] = [];
          let sourceCharacters = 0;
          for (let unit = 1; unit <= source.totalUnits; unit += 1) {
            const read = await source.readUnit(unit, controller.signal);
            if (read.status === 'text' && read.text) {
              sourceCharacters += read.text.length;
              if (sourceCharacters > 120_000) throw new Error('父 PDF 正文超过单次子文件生成的上下文预算，请先分批分析相关章节；未截断正文或写入文件。');
              units.push(`--- ${source.unitLabel} ${unit} ---\n${read.text}`);
              refs.push({ kind: 'pdf_page', label: `${request.pdfParent} p.${unit}`, locator: read.locator ?? `${request.pdfParent}#page=${unit}`, preview: read.text.slice(0, 240), anchor: { page: unit, snippet: read.text.slice(0, 240) } });
            }
          }
          if (!units.length) throw new Error('PDF 没有可读取的文本内容，未生成子文件。');
          const snapshot: AgentSourceSnapshot = { workspaceKey: requestKey, sourceId: request.pdfParent, path: request.pdfParent,
            version: source.version, kind: 'pdf', totalUnits: source.totalUnits, unitLabel: source.unitLabel };
          sourceContext = { text: `[Verified PDF source ${request.pdfParent}; version ${source.version}]\n${units.join('\n\n')}`, sourceRefs: refs, snapshot };
          setAssistantMetadata(id, { evidenceRefs: refs, documentContext: { workspaceKey: requestKey, paths: [request.pdfParent], snapshots: [snapshot] } });
        } finally { await source.close(); }
      }
      const fileSelection = request.empty ? null : routeModel('task_proposal', runtime);
      const draft = await prepareWorkspaceFileTask({
        task, request, root: requestRoot, workspaceKey: requestKey, sourceContext, signal: controller.signal,
        outputTokenCeiling: effectiveOutputTokenCeiling(runtime.maxTokens, fileSelection?.provider.getMaxOutputTokens?.(fileSelection.modelInfo.model)),
        generate: async (messages, options) => {
          const selected = fileSelection!;
          setRequestProgress(id, { phase: 'waiting', startedAt: Date.now(), lastActivityAt: Date.now(), attempt: 1 });
          return selected.provider.generate(messages, { ...options, model: selected.modelInfo.model ?? undefined, onProgress: progress => setRequestProgress(id, progress) });
        },
      });
      if (controller.signal.aborted) return;
      const state = useWorkspaceStore.getState();
      if (state.rootHandle !== requestRoot) throw new Error('工作区已切换，本次建议未保存，请回到原工作区重试。');
      const workspaceDraftId = useAiWorkbenchStore.getState().createDraft({ ...draft, originMessageId: id });
      setAssistantMetadata(id, { workspaceDraftId });
      finishAssistantMessage(id, `已准备${request.operation === 'update' ? '文件修改' : '新文件'}：${draft.targetPath}。请在下方工作区查看完整内容${request.operation === 'update' ? '和差异' : ''}并点击保存。`);
    } catch (error) {
      if (!controller.signal.aborted) setAssistantError(id, error instanceof Error ? error.message : String(error));
    } finally {
      if (controller.signal.aborted) finishAssistantMessage(id);
      if (useAiChatStore.getState().activeAssistantMessageId === id) setGenerating(false);
    }
  }, [input, isGenerating, inputMode, activeTab?.filePath, activeTab?.isDirty, rootHandle, workspaceKey, workspaceRootPath, settings.aiEnabled, addUserMessage, setGenerating, startAssistantMessage, setRequestProgress, finishAssistantMessage, setAssistantError, setAssistantMetadata]);

  const submitInput = useCallback(() => {
    setBudgetError(null);
    if (attachmentBusy) return;
    const sourceBinding = sourceBindingForRequest(input);
    const cloud = getCloudWorkspaceSnapshot();
    const savedWorkspace = useAiChatStore.getState().getActiveConversation()?.workspace;
    if (sourceBinding.kind === 'cloud' && savedWorkspace?.workspaceKey.startsWith('cloud:') && savedWorkspace.permissionScope
      && (!cloud.provider || sourceBinding.providerScope !== cloud.provider.scope || savedWorkspace.permissionScope !== cloud.provider.scope)) {
      setSourceNotice(cloudAiLabels(locale).scopeChanged);
      return;
    }
    if (runtimeEngine !== 'api') { void handleHarnessTurn(); return; }
    if (requestAttachmentRefs(input).some(ref => ref.kind !== 'image')) { void handleResearchAgentRun(composerView.submitIntent !== 'agent'); return; }
    if (inputBudget.requiresBatching) { setBudgetError('完整输入超过当前模型的预计上下文预算。请分批处理全文，或引用文件按需读取；原正文与草稿已保留。'); return; }
    const requestBinding = sourceBindingForRequest(input);
    if (requestBinding.kind === 'local' && rootHandle && isWholeDirectoryRequest(input)) { void handleResearchAgentRun(composerView.submitIntent !== 'agent'); return; }
    const priorMessages = useAiChatStore.getState().getActiveConversation()?.messages ?? [];
    if (resolveResearchContinuation(input, priorMessages) || documentContinuationForReply(input, priorMessages, id => useAgentSessionStore.getState().getSession(id))) {
      void handleResearchAgentRun(composerView.submitIntent !== 'agent'); return;
    }
    if (requestBinding.kind === 'local' && /(?:^|[\s"'`“「《])(?:[a-z]:[\\/]|\/(?!\/)[\p{L}\p{N}_])/iu.test(input)) { void handleResearchAgentRun(composerView.submitIntent !== 'agent'); return; }
    if ((requestBinding.kind === 'cloud' && documentPathsForRequest(input).length && !isTrivialQuery(input)) || parseCloudSourceSelections(input).length) { void handleResearchAgentRun(true); return; }
    if (requestBinding.kind === 'local' && rootHandle && /(?:工作区|文件夹|目录|所有文件|workspace|folder|directory)/iu.test(input) && /(?:搜索|查找|找出|定位|search|find|locate|compare|对比)/iu.test(input)) { void handleResearchAgentRun(true); return; }
    try {
      if (parseWorkspaceFileTask(input, activeTab?.filePath)) { void handleFileTask(); return; }
    } catch { void handleFileTask(); return; }
    if (composerView.submitIntent === "agent") {
      void handleResearchAgentRun();
      return;
    }
    const messages = useAiChatStore.getState().getActiveConversation()?.messages ?? [];
    const sessions = useAgentSessionStore.getState();
    const requestDocumentPaths = documentPathsForRequest(input);
    const explicitDocumentRequest = parseSourceSelections(input).some(source => source.kind === 'folder')
      || wantsDocumentReading(input, undefined, { hasDocumentContext: false })
      || requestDocumentPaths.length > 0 && isBroadDocumentExplanation(input);
    const followsRecentDocument = Boolean(requestBinding.referentPaths?.length) || recentDocumentTaskSessions(messages, id => sessions.getSession(id)).length > 0;
    if (persistedContinuation?.documentResume || persistedContinuation?.documentRestart || persistedContinuation?.approvalResume || requestsCodeExecution(input) || parseSourceSelections(input).some(source => source.kind === 'folder') || (shouldReadConversationDocuments(input, documentPathsForRequest(input)) && (explicitDocumentRequest || followsRecentDocument))) {
      void handleResearchAgentRun(true);
      return;
    }
    if (requestBinding.kind === 'local' && rootHandle && activeTab?.filePath && isAgentDocumentPath(activeTab.filePath)
      && !requestBinding.referentPaths?.length && !hasNamedDocumentReference(input) && !isCurrentDocumentReference(input) && !isPreviousDocumentReference(input)
      && !isTrivialQuery(input) && !startsNewDocumentTopic(input) && !requestsIndependentAnswer(input)) {
      void handleResearchAgentRun(true);
      return;
    }
    void handleSend();
  }, [runtimeEngine, handleHarnessTurn, inputBudget, rootHandle, activeTab, handleFileTask, composerView.submitIntent, persistedContinuation, documentPathsForRequest, sourceBindingForRequest, input, handleResearchAgentRun, handleSend, attachmentBusy, requestAttachmentRefs, locale]);

  useEffect(() => {
    if (!submitComposerDraft || !input.trim() || isGenerating) {
      return;
    }
    setSubmitComposerDraft(null);
    if (submitComposerDraft !== activeConversationId) return;
    submitInput();
  }, [activeConversationId, input, isGenerating, submitComposerDraft, submitInput]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      if (mentionQuery !== null) return;
      e.preventDefault();
      submitInput();
    }
  };

  return (
    <div className="relative border-t border-border p-2" data-testid="ai-chat-composer" onDrop={attachmentInput.onDrop} onDragOver={attachmentInput.onDragOver} onPaste={attachmentInput.onPaste}>
      <RequestProgress />
      <HarnessExecutionTimeline key={activeConversationId} />
      <ChatAttachments conversationId={activeConversationId} disabled={isGenerating} />
      {cloudHost.active || cloudInput.mentions.length ? <CloudSourceSelection
        key={`${activeConversationId}:${cloudHost.provider?.scope}`}
        host={cloudHost} input={input} onInputChange={setInput} disabled={isGenerating} expectedScope={cloudSourceScope}
      /> : null}
      {sourceNotice ? <p role="status" data-testid="ai-source-validation-notice" className="px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">{sourceNotice}</p> : null}
      {persistenceError ? <div role="alert" className="px-2 py-1 text-[11px] text-destructive">会话保存／恢复失败：{persistenceError} <button type="button" className="underline" onClick={() => void (hydrationError ? useAiChatStore.getState().loadConversations() : useAiChatStore.getState().flushConversations()).catch(() => {})}>重试</button></div> : null}
      {input.length > 1000 ? <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground" data-testid="ai-input-budget">
        <span>完整正文 {input.length.toLocaleString()} 字符 · 预计 {inputBudget.estimatedInputTokens.toLocaleString()} tokens{inputBudget.contextWindow ? ` · 可用约 ${inputBudget.availableInputTokens.toLocaleString()}` : ' · 模型上限待确认'}</span>
        {runtimeEngine === 'api' && (inputBudget.requiresBatching || input.length > 32000) ? <button type="button" disabled={isGenerating} data-testid="ai-long-input-process" className="rounded border border-border px-2 py-1" onClick={() => void handleLongInput()}>分批处理全文</button> : null}
      </div> : null}
      {budgetError ? <p role="alert" className="px-2 py-1 text-[11px] text-destructive">{budgetError}</p> : null}
      <Portal>
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
      </Portal>
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          anchorRef={textareaRef}
          onSelect={(selection) => {
            // Replace the @query with the selected mention
            const textarea = textareaRef.current;
            if (textarea) {
              const cursorPos = textarea.selectionStart;
              const textBefore = question.slice(0, cursorPos);
              const textAfter = question.slice(cursorPos);
              const atIdx = textBefore.lastIndexOf('@');
              const suffix = selection.continueSelection ? '' : ' ';
              const newText = textBefore.slice(0, atIdx) + selection.value + suffix + textAfter;
              mentionCaretRef.current = { value: cloudComposerInput(newText).question, position: cloudComposerInput(textBefore.slice(0, atIdx) + selection.value + suffix).question.length };
              setQuestion(newText);
            }
            setMentionQuery(selection.continueSelection ? selection.nextQuery : null);
          }}
          onClose={() => setMentionQuery(null)}
        />
      )}
      {runtimeEngine === 'api' ? <ComposerAdvancedPanel
        view={composerView}
        input={input}
        onSuggestMemoryChange={setSuggestMemoryForRun}
        onClearWorkflow={() => setResearchWorkflow(null)}
        onSaveCurrentPrompt={() => setPromptEditorState({ seedUserPrompt: input })}
        onEffortChange={setAgentEffort}
        includePdfScoped={Boolean(activeTab?.filePath && isPdfPath(activeTab.filePath))}
      /> : null}
      <div
        className="overflow-hidden rounded-lg border border-border bg-background shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30"
        data-testid="ai-chat-composer-surface"
        style={{ containerType: 'inline-size' }}
      >
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(e) => {
            const val = e.target.value;
            const visible = cloudComposerInput(val).question;
            const caret = cloudComposerInput(val.slice(0, e.target.selectionStart)).question.length;
            if (visible !== val) mentionCaretRef.current = { value: visible, position: caret };
            setQuestion(val);
            setMentionQuery(getActiveMentionQuery(visible, caret));
          }}
          onSelect={e => setMentionQuery(getActiveMentionQuery(e.currentTarget.value, e.currentTarget.selectionStart))}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder={t('chat.placeholder')}
          rows={question.includes('\n') || question.length > 500 ? 6 : 2}
          aria-label={t('chat.placeholder')}
          data-testid="ai-chat-input"
          className="min-h-12 max-h-64 w-full resize-y overflow-y-auto bg-transparent px-3 pb-2 pt-3 text-xs focus:outline-none"
          disabled={isGenerating}
        />
        <ComposerToolbar
          view={composerView}
          disabled={isGenerating}
          runtimeLabel={runtimeEngine === 'api' ? undefined : runtimeEngine}
          profiles={aiProfiles}
          activeProfileId={activeAiProfileId}
          activeModelId={activeModelId}
          modelOptions={modelOptions}
          onModeChange={setInputMode}
          onProfileChange={(profileId) => setActiveAiProfile(profileId || null)}
          onModelChange={(modelId) => {
            if (activeAiProfileId && modelId) setDefaultAiModel(activeAiProfileId, modelId);
          }}
          onOpenPromptPicker={() => setPromptPickerOpen(true)}
          onToggleAdvanced={() => setShowAgentAdvanced((open) => !open)}
          submitControl={isGenerating ? (
            <button
              onClick={stopGenerating}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
              data-testid="ai-chat-stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={submitInput}
              disabled={!composerView.canSubmit}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-60"
              title={composerView.isAgentMode ? t("chat.researchAgent.hint") : t('chat.send')}
              aria-label={composerView.isAgentMode ? t("chat.researchAgent.hint") : t('chat.send')}
              data-testid="ai-chat-submit"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        />
      </div>
    </div>
  );
}
