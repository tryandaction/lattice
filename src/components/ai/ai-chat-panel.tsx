"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAiChatStore, type ChatConversation, type ChatMessage } from "@/stores/ai-chat-store";
import { createConversationMetadataSelector, hasMessageEvidence } from "./chat-conversation-metadata";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { aiOrchestrator } from "@/lib/ai/orchestrator";
import { Check, History, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { EvidencePanel, type EvidenceNavigationAttempt } from "./evidence-panel";
import { AgentTracePanel } from "./agent-trace-panel";
import { AgentMemoryPanel } from "./agent-memory-panel";
import type { EvidenceRef } from "@/lib/ai/types";
import { useAiPdfCompanionStore } from "@/stores/ai-pdf-companion-store";
import { toast } from "sonner";
import { AIWorkspaceShell } from "./ai-workspace-shell";
import { AgentStatusStrip } from "./agent-status-strip";
import { AgentInspector, type AgentInspectorTab } from "./agent-inspector";
import { ChatTimeline } from "./chat-timeline";
import { ChatComposer } from "./chat-composer";
import { ScheduledTaskPanel } from "./scheduled-task-panel";
import { useScheduledTaskStore } from "@/stores/scheduled-task-store";
import { resolveActiveFileContent, toRuntimeSettings } from "./ai-chat-context";
import { navigateLinkDetailed } from "@/lib/link-router/navigate-link";
import { canonicalCitationPath } from "@/lib/ai/citation-contract";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { measureLatticePerformanceAsync } from "@/lib/performance/performance-metrics";
import { getCloudWorkspaceSnapshot, openCloudWorkspaceResource } from "@/lib/cloud-workspace-host";
import { verifyCloudAgentCitation } from "@/lib/ai/cloud-source";
import type { NavigationResult } from "@/lib/link-router/types";

export { readFileForAiContext } from "./ai-chat-context";
import {
  WorkbenchQueue,
  createWorkbenchDraftWithTrace,
  createWorkbenchProposalWithTrace,
} from "./workbench-queue";

const EMPTY_CONVERSATIONS: ChatConversation[] = [];
const EMPTY_MESSAGES: ChatMessage[] = [];

export function AiChatPanel({
  className,
  onClose,
  loadPersistedState = true,
}: {
  className?: string;
  onClose?: () => void;
  loadPersistedState?: boolean;
} = {}) {
  const { t } = useI18n();
  const isOpen = useAiChatStore((s) => s.isOpen);
  const setOpen = useAiChatStore((s) => s.setOpen);
  const loadConversations = useAiChatStore((s) => s.loadConversations);
  const settings = useSettingsStore((state) => state.settings);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const getCachedContent = useContentCacheStore((state) => state.getContent);
  const metadataSelector = useMemo(() => createConversationMetadataSelector(), []);
  const { conversationId, evidenceMessageCount, workbenchActionCount } = useAiChatStore(metadataSelector);
  const [isEvidencePanelOpen, setEvidencePanelOpen] = useState(false);
  const [focusedEvidenceMessageId, setFocusedEvidenceMessageId] = useState<string | null>(null);
  const [evidenceNavigationAttempt, setEvidenceNavigationAttempt] = useState<EvidenceNavigationAttempt | null>(null);
  const navigationOutcome = useLinkNavigationStore((state) => evidenceNavigationAttempt
    ? state.outcomesByRequestId[evidenceNavigationAttempt.result.requestId] : undefined);
  const evidenceNavigationSequence = useRef(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversations = useAiChatStore((state) => historyOpen ? state.conversations : EMPTY_CONVERSATIONS);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [activeInspectorTab, setActiveInspectorTab] = useState<AgentInspectorTab>("trace");
  const openDocumentWorkbench = useCallback(() => {
    setActiveInspectorTab('workbench');
    setInspectorOpen(true);
  }, []);
  const previousPendingApprovalCount = useRef(0);
  const pendingApprovalCount = useAgentSessionStore((state) => state.sessions.reduce(
    (total, session) => total + (session.pendingApprovals ?? []).filter((approval) => approval.status === "pending").length, 0,
  ));
  const focusTarget = useAgentSessionStore((state) => state.focusTarget);
  const drafts = useAiWorkbenchStore((state) => state.drafts);
  const proposals = useAiWorkbenchStore((state) => state.proposals);
  const highlightedProposalId = useAiWorkbenchStore((state) => state.highlightedProposalId);
  const newConversation = useAiChatStore((state) => state.newConversation);
  const setActiveConversation = useAiChatStore((state) => state.setActiveConversation);
  const renameConversation = useAiChatStore((state) => state.renameConversation);
  const deleteConversation = useAiChatStore((state) => state.deleteConversation);
  const clearAllHistory = useAiChatStore((state) => state.clearAllHistory);
  const scheduledTaskCount = useScheduledTaskStore((state) => state.tasks.length);
  const clearTransientAnnotations = useAiPdfCompanionStore((state) => state.clear);
  const hydrateScheduledTasks = useScheduledTaskStore((state) => state.hydrate);

  useEffect(() => {
    if (loadPersistedState) {
      void loadConversations();
      void useAgentSessionStore.getState().loadSessions();
    }
  }, [loadConversations, loadPersistedState]);

  useEffect(() => {
    void hydrateScheduledTasks();
  }, [hydrateScheduledTasks]);

  const evidenceMessages = useAiChatStore(useShallow((state) => isEvidencePanelOpen
    ? (state.conversations.find(item => item.id === state.activeConversationId)?.messages ?? EMPTY_MESSAGES).filter(hasMessageEvidence)
    : EMPTY_MESSAGES));

  const openEvidenceReference = useCallback(async (messageId: string, ref?: EvidenceRef) => {
    const sequence = ++evidenceNavigationSequence.current;

    if (!ref) {
      setEvidenceNavigationAttempt(null);
      setFocusedEvidenceMessageId(messageId);
      setEvidencePanelOpen(true);
      setActiveInspectorTab("evidence");
      setInspectorOpen(true);
      return;
    }

    // A source click keeps the answer visible; the inspector is for explicit
    // review or navigation failures, not an extra step before opening a file.
    setFocusedEvidenceMessageId(messageId);
    if (ref.cloudIdentity) {
      const host = getCloudWorkspaceSnapshot();
      const identity = ref.cloudIdentity;
      const requestId = `cloud-evidence-${sequence}`;
      let result: NavigationResult;
      try {
        if (!host.active || !host.provider) throw new Error('云来源连接已退出，请重新打开云工作区。');
        await verifyCloudAgentCitation({ provider: host.provider, identity });
        if (sequence !== evidenceNavigationSequence.current) return;
        if (getCloudWorkspaceSnapshot().provider !== host.provider || !getCloudWorkspaceSnapshot().active) {
          throw new Error('云来源连接已变化，请重新打开云工作区。');
        }
        const ok = await openCloudWorkspaceResource({
          libraryId: identity.libraryId, itemId: identity.itemId,
          anchor: { page: ref.anchor?.page, line: ref.anchor?.lineStart, cellId: ref.anchor?.cellId, snippet: ref.anchor?.snippet },
        });
        result = { ok, success: ok, requestId, status: ok ? 'success' : 'unsupported_target' };
        if (!ok) toast.error('当前云阅读器无法打开该来源。');
      } catch (error) {
        result = { ok: false, success: false, requestId, status: 'file_not_found' };
        toast.error(error instanceof Error ? error.message : '云来源打开失败。');
      }
      if (sequence !== evidenceNavigationSequence.current) return;
      setEvidenceNavigationAttempt({ locator: ref.locator, anchor: ref.anchor, ref, result });
      if (!result.ok) {
        setEvidencePanelOpen(true);
        setActiveInspectorTab('evidence');
        setInspectorOpen(true);
      }
      return;
    }

    // Read navigation state at click time. Resizing/switching a document must not
    // invalidate every historical message's citation callback and Markdown tree.
    const workspace = useWorkspaceStore.getState();
    const { rootHandle, workspaceRootHandle, workspaceRootHistory, workspaceRootPath } = workspace;
    const activeTab = workspace.getActiveTab();
    const currentFileHandle = activeTab?.kind === "file" ? activeTab.fileHandle : null;

    const resolvedRoot = workspace.findWorkspaceRootForPath(canonicalCitationPath(ref.locator)) ?? workspaceRootHandle ?? rootHandle;
    const historyRoots = Array.from(workspaceRootHistory.values());
    const rootCandidates = Array.from(workspaceRootHistory.entries()).map(([pathPrefix, handle]) => ({
      handle,
      pathPrefix,
    }));
    if (workspaceRootHandle && workspaceRootPath) {
      rootCandidates.unshift({ handle: workspaceRootHandle, pathPrefix: workspaceRootPath });
    }

    const result = await measureLatticePerformanceAsync('navigation-dispatch', () => navigateLinkDetailed(ref.locator, {
      paneId: workspace.layout.activePaneId,
      rootHandle: resolvedRoot,
      rootHandles: [workspaceRootHandle, rootHandle, ...historyRoots],
      rootCandidates,
      currentFilePath: activeTab?.filePath,
      currentFileHandle,
      evidenceAnchor: ref.anchor,
      pathMode: "workspace",
    }), { locator: ref.locator, page: ref.anchor?.page ?? 0 });
    if (sequence !== evidenceNavigationSequence.current) return;
    setEvidenceNavigationAttempt({ locator: ref.locator, anchor: ref.anchor, ref, result });
    if (!result.ok) {
      setFocusedEvidenceMessageId(messageId);
      setEvidencePanelOpen(true);
      setActiveInspectorTab("evidence");
      setInspectorOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!navigationOutcome || navigationOutcome.status === "success") return;
    setEvidencePanelOpen(true);
    setActiveInspectorTab("evidence");
    setInspectorOpen(true);
  }, [navigationOutcome]);

  const isEvidencePanelVisible = isEvidencePanelOpen && evidenceMessageCount > 0;

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
    if (focusTarget === "trace" || focusTarget === "memory") {
      startTransition(() => {
        setActiveInspectorTab(focusTarget);
        setInspectorOpen(true);
      });
    }
  }, [focusTarget]);

  useEffect(() => {
    if (pendingApprovalCount > previousPendingApprovalCount.current) {
      setActiveInspectorTab("trace");
      setInspectorOpen(true);
    }
    previousPendingApprovalCount.current = pendingApprovalCount;
  }, [pendingApprovalCount]);

  useEffect(() => {
    if (!highlightedProposalId) return;
    startTransition(() => {
      setActiveInspectorTab("workbench");
      setInspectorOpen(true);
    });
  }, [highlightedProposalId]);

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
      task: t("ai.evidence.workbench.createDraftTask", { title: input.title }),
      title: input.title,
      evidenceRefs: input.refs ?? [],
      approvalNote: t("ai.evidence.workbench.createDraftApproval"),
    }).catch((error) => {
      toast.error(t("ai.evidence.workbench.createDraftFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  }, [t]);

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
      task: t("ai.evidence.workbench.createProposalTask", { prompt: input.prompt.slice(0, 80) }),
      title: t("ai.evidence.workbench.createProposalTitle"),
      approvalNote: t("ai.evidence.workbench.createProposalApproval"),
    });
  }, [activeTab, getCachedContent, settings, t]);

  if (!isOpen) return null;

  const closePanel = () => {
    if (onClose) {
      onClose();
      return;
    }
    setOpen(false);
  };

  const startNewConversation = () => {
    setEvidencePanelOpen(false);
    setFocusedEvidenceMessageId(null);
    setEvidenceNavigationAttempt(null);
    setInspectorOpen(false);
    clearTransientAnnotations();
    newConversation();
  };

  const evidencePanel = (
    <>
      <EvidencePanel
      message={selectedEvidenceMessage}
      messages={evidenceMessages}
      selectedMessageId={selectedEvidenceMessage?.id ?? null}
      onSelectMessage={setFocusedEvidenceMessageId}
      onCreateDraft={handleCreateEvidenceDraft}
      onProposeTask={handleProposeEvidenceTask}
      navigationAttempt={evidenceNavigationAttempt}
      onClose={() => {
        setEvidencePanelOpen(false);
        setInspectorOpen(false);
      }}
      />
    </>
  );

  return (
    <AIWorkspaceShell
      className={className}
      header={(
        <ChatHeader
          onClose={closePanel}
          onNewChat={startNewConversation}
          conversations={conversations}
          activeConversationId={conversationId}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((open) => !open)}
          onSelectConversation={(id) => { setActiveConversation(id); setHistoryOpen(false); }}
          renameId={renameId}
          renameDraft={renameDraft}
          onStartRename={(id, title) => { setRenameId(id); setRenameDraft(title); }}
          onRenameDraftChange={setRenameDraft}
          onCommitRename={() => { if (renameId) renameConversation(renameId, renameDraft); setRenameId(null); }}
          onDeleteConversation={(id) => {
            deleteConversation(id);
            setRenameId(null);
            setEvidencePanelOpen(false);
            setInspectorOpen(false);
            setFocusedEvidenceMessageId(null);
            setEvidenceNavigationAttempt(null);
            clearTransientAnnotations();
          }}
          onClearHistory={() => {
            clearAllHistory();
            setHistoryOpen(false);
            setRenameId(null);
            setEvidencePanelOpen(false);
            setInspectorOpen(false);
            setFocusedEvidenceMessageId(null);
            setEvidenceNavigationAttempt(null);
            clearTransientAnnotations();
          }}
        />
      )}
      status={
        <AgentStatusStrip
          onOpenReview={() => {
            if (evidenceMessageCount > 0) {
              setEvidencePanelOpen(true);
              setActiveInspectorTab("evidence");
            } else {
              setActiveInspectorTab("trace");
            }
            setInspectorOpen(true);
          }}
          onReviewApprovals={() => {
            setActiveInspectorTab("trace");
            setInspectorOpen(true);
          }}
        />
      }
      body={(
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="ai-workspace-body-content">
          <div className="min-h-0 flex-1 overflow-hidden">
            {inspectorOpen ? (
              <AgentInspector
                open
                activeTab={activeInspectorTab}
                pendingApprovalCount={pendingApprovalCount}
                evidenceCount={evidenceMessageCount}
                draftCount={drafts.length}
                proposalCount={proposals.length}
          workbenchActionCount={workbenchActionCount}
          scheduledTaskCount={scheduledTaskCount}
                onOpenChange={setInspectorOpen}
                onTabChange={(tab) => {
                  setActiveInspectorTab(tab);
                  if (tab === "evidence" && evidenceMessageCount > 0) {
                    setEvidencePanelOpen(true);
                  }
                }}
                panels={{
                  memory: <AgentMemoryPanel loadPersisted={loadPersistedState} />,
                  trace: <AgentTracePanel loadPersisted={loadPersistedState} />,
                  evidence: evidencePanel,
            workbench: <WorkbenchQueue loadPersisted={loadPersistedState} />,
            scheduled: <ScheduledTaskPanel />,
                }}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden" data-testid="ai-conversation-workspace">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="ai-chat-message-frame">
                  <ChatTimeline
                    onOpenEvidence={openEvidenceReference}
                    onOpenWorkbench={openDocumentWorkbench}
                    selectedEvidenceMessageId={selectedEvidenceMessage?.id ?? null}
                    isEvidencePanelOpen={false}
                  />
                </div>
              </div>
            )}
          </div>
          <ChatComposer />
        </div>
      )}
    />
  );
}

function ChatHeader({
  onClose,
  onNewChat,
  conversations,
  activeConversationId,
  historyOpen,
  onToggleHistory,
  onSelectConversation,
  renameId,
  renameDraft,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onDeleteConversation,
  onClearHistory,
}: {
  onClose: () => void;
  onNewChat: () => void;
  conversations: Array<{ id: string; title: string }>;
  activeConversationId: string | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onSelectConversation: (id: string) => void;
  renameId: string | null;
  renameDraft: string;
  onStartRename: (id: string, title: string) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onDeleteConversation: (id: string) => void;
  onClearHistory: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="relative flex items-center justify-between border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span
          className="text-xs font-semibold text-foreground"
          data-testid="ai-workspace-title"
        >
          {t('chat.workspace.title')}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleHistory}
          className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
          title={t('chat.history.title')}
          aria-label={t('chat.history.title')}
          aria-expanded={historyOpen}
          data-testid="ai-workspace-history-toggle"
        >
          <History className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onNewChat}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t('chat.newChat')}
          aria-label={t('chat.newChat')}
          data-testid="ai-workspace-new-chat"
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t('common.close')}
          aria-label={t("chat.workspace.collapse")}
          data-testid="ai-workspace-collapse-button"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
      {historyOpen && (
        <div className="absolute right-2 top-10 z-40 w-[min(360px,calc(100vw-1rem))] rounded-md border border-border bg-popover p-2 shadow-lg" data-testid="ai-workspace-history-menu">
          <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium text-muted-foreground">
            <span>{t('chat.history.title')}</span>
            <button type="button" onClick={onClearHistory} className="text-[10px] text-destructive hover:underline" data-testid="ai-workspace-history-clear">{t('chat.history.clear')}</button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {conversations.length === 0 ? <div className="px-1 py-3 text-xs text-muted-foreground">{t('chat.history.empty')}</div> : conversations.map((conversation) => (
              <div key={conversation.id} className="flex items-center gap-1 rounded px-1 py-1 hover:bg-accent/60" data-testid={`ai-workspace-history-row-${conversation.id}`}>
                {renameId === conversation.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => onRenameDraftChange(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") onCommitRename(); if (event.key === "Escape") onStartRename("", ""); }}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-xs"
                    data-testid="ai-workspace-history-rename-input"
                  />
                ) : (
                  <button type="button" onClick={() => onSelectConversation(conversation.id)} className="min-w-0 flex-1 truncate px-1 text-left text-xs" aria-current={activeConversationId === conversation.id ? "true" : undefined}>{conversation.title}</button>
                )}
                {renameId === conversation.id ? (
                  <button type="button" onClick={onCommitRename} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent" title={t('chat.history.saveRename')} aria-label={t('chat.history.saveRename')}><Check className="h-3 w-3" /></button>
                ) : (
                  <button type="button" onClick={() => onStartRename(conversation.id, conversation.title)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent" title={t('explorer.context.rename')} aria-label={t('explorer.context.rename')}><Pencil className="h-3 w-3" /></button>
                )}
                <button type="button" onClick={() => onDeleteConversation(conversation.id)} className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10" title={t("chat.deleteChat")} aria-label={t("chat.deleteChat")}><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
