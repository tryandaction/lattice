"use client";

import { Bot, MessageSquare, PanelRightOpen, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "@/hooks/use-i18n";
import type { AgentSessionStatus } from "@/lib/ai/agent-session";
import type { TranslationKey } from "@/lib/i18n";
import { useAiChatStore, type AgentResultMetadata } from "@/stores/ai-chat-store";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { createConversationMetadataSelector } from "./chat-conversation-metadata";

function statusLabelKey(status: AgentSessionStatus, deliveryStatus?: AgentResultMetadata['deliveryStatus'] | null): TranslationKey {
  switch (status) {
    case "queued":
      return "chat.agentTrace.status.queued";
    case "running":
      return "chat.agentTrace.status.running";
    case "waiting_approval":
      return "chat.agentTrace.status.waitingApproval";
    case "completed":
      if (deliveryStatus === 'partial') return 'chat.agentTrace.status.partial';
      if (deliveryStatus === 'ready_for_review') return 'chat.agentTrace.status.readyForReview';
      return "chat.agentTrace.status.completed";
    case "failed":
      return "chat.agentTrace.status.failed";
    case "cancelled":
      return "chat.agentTrace.status.cancelled";
  }
}

export function AgentStatusStrip({
  onOpenReview,
  onReviewApprovals,
}: {
  onOpenReview?: () => void;
  onReviewApprovals?: () => void;
}) {
  const { t } = useI18n();
  const metadataSelector = useMemo(() => createConversationMetadataSelector(), []);
  const { messageSessionId, contextCount, sourceCount, deliveryStatus } = useAiChatStore(metadataSelector);
  const currentRequestActive = useAiChatStore(state => state.isGenerating && state.conversations.find(item => item.id === state.activeConversationId)?.messages.some(message => message.id === state.activeAssistantMessageId));
  const { sessionStatus, readingStatus, readCount, totalCount, directoryPhase, discoveryComplete, directoryCount, directoryRead, directoryPending, directoryFailed, directoryNoText, directoryIncomplete } = useAgentSessionStore(useShallow((state) => {
    const session = messageSessionId ? state.sessions.find(item => item.id === messageSessionId) : undefined;
    const reading = session?.documentResearch;
    const directory = reading?.directory;
    const counts = directory?.files.reduce((result, file) => { result[file.status]++; return result; }, { complete: 0, pending: 0, reading: 0, failed: 0, no_text: 0 });
    return {
      sessionStatus: session?.status,
      readingStatus: reading?.status,
      readCount: reading?.checkpoint.coverage.reduce((sum, item) => sum + item.readUnits.length, 0) ?? 0,
      totalCount: reading?.checkpoint.coverage.reduce((sum, item) => sum + item.totalUnits, 0) ?? 0,
      directoryPhase: directory?.phase,
      discoveryComplete: Boolean(directory?.manifest?.complete),
      directoryCount: directory?.files.length ?? 0,
      directoryRead: counts?.complete ?? 0,
      directoryPending: (counts?.pending ?? 0) + (counts?.reading ?? 0),
      directoryFailed: counts?.failed ?? 0,
      directoryNoText: counts?.no_text ?? 0,
      directoryIncomplete: Boolean(directory && (!directory.manifest?.complete || !directory.files.length || directory.phase !== 'ready'
        || directory.files.some(file => file.status !== 'complete') || reading?.checkpoint.evidenceIssues?.length)),
    };
  }));
  const pendingApprovalCount = useAgentSessionStore((state) => state.sessions.reduce(
    (total, session) => total + (session.pendingApprovals ?? []).filter((approval) => approval.status === "pending").length,
    0,
  ));
  const displayStatus = currentRequestActive ? 'running' : sessionStatus;
  const contextLabel = sourceCount > 0 ? t('chat.workspace.referencedSources', { count: sourceCount }) : t('chat.contextCount', { count: contextCount });
  const readingLabel = directoryPhase ? t(discoveryComplete ? 'chat.documentReading.directory.shortCoverage' : 'chat.documentReading.directory.shortDiscovering', { read: directoryRead, total: directoryCount })
    : t('chat.documentReading.shortCoverage', { read: readCount, total: totalCount });
  const coverageLabel = directoryPhase ? t('chat.documentReading.directory.counts', { discovered: directoryCount, read: directoryRead, pending: directoryPending, failed: directoryFailed, noText: directoryNoText })
    : t('chat.documentReading.coverageLabel');
  const phaseKey: TranslationKey | null = currentRequestActive && directoryPhase === 'discovering' ? 'chat.documentReading.directory.discovering'
    : currentRequestActive && directoryPhase === 'reducing' ? 'chat.documentReading.directory.reducing' : null;

  return (
    <div
      className="flex min-h-8 items-center gap-3 overflow-x-auto border-b border-border/70 px-3 py-1 text-[10px] text-muted-foreground"
      data-testid="agent-status-strip"
    >
      <span className="inline-flex shrink-0 items-center gap-1" title={displayStatus ?? "idle"} data-testid="agent-status-state">
        {displayStatus ? <Bot className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
        {phaseKey ? t(phaseKey) : !currentRequestActive && readingStatus === 'paused' ? t('chat.documentReading.paused') : displayStatus ? t(statusLabelKey(displayStatus, directoryIncomplete && displayStatus === 'completed' ? 'partial' : deliveryStatus)) : t("chat.workspace.idle")}
      </span>
      {(readingStatus || sourceCount > 0 || contextCount > 0) && <span className="inline-flex shrink-0 items-center gap-1" title={readingStatus ? coverageLabel : contextLabel} data-testid="agent-status-context">
        <span>{readingStatus ? readingLabel : contextLabel}</span>
      </span>}
      <button
        type="button"
        onClick={onOpenReview}
        className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent hover:text-foreground"
        data-testid="agent-status-open-review"
        title={t("chat.workspace.expandInspector")}
        aria-label={t("chat.workspace.expandInspector")}
      >
        <PanelRightOpen className="h-3 w-3" />
      </button>
      {pendingApprovalCount > 0 ? <button
        type="button"
        onClick={onReviewApprovals}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
        data-testid="agent-status-review-approvals"
        title={t("chat.workspace.pendingApprovals", { count: pendingApprovalCount })}
        aria-label={t("chat.workspace.pendingApprovals", { count: pendingApprovalCount })}
      >
        <ShieldCheck className="h-3 w-3" />
        <span data-testid="agent-status-pending-approvals">{pendingApprovalCount}</span>
      </button> : null}
    </div>
  );
}
