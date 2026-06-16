"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Pin,
  PinOff,
  X,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import {
  approveAgentToolRequest,
  rejectAgentToolRequest,
  type WriteMemoryToolArgs,
} from "@/lib/ai/agent-tool-broker";
import type { AgentPendingApproval } from "@/lib/ai/agent-session";
import {
  buildAgentMemoryReviewViewModel,
  evaluateAgentMemoryLifecycle,
  formatAgentMemoryCitation,
  type AgentMemoryEntry,
  type AgentMemoryLifecycleAction,
  type AgentMemoryLifecycleStatus,
  type AgentMemoryReviewRecommendation,
} from "@/lib/ai/agent-memory";
import { buildAgentReviewQueueViewModel } from "@/lib/ai/agent-review-queue-view-model";
import { buildAgentSessionAuditViewModel } from "@/lib/ai/agent-session-audit-view-model";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { useAgentMemoryStore } from "@/stores/agent-memory-store";

function scopeTone(scope: AgentMemoryEntry["scope"]): string {
  switch (scope) {
    case "user":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "workspace":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "project":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "conversation":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function isWriteMemoryArgs(value: unknown): value is WriteMemoryToolArgs {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { memory?: unknown };
  if (!record.memory || typeof record.memory !== "object") {
    return false;
  }
  const memory = record.memory as { title?: unknown; content?: unknown; scope?: unknown };
  return typeof memory.title === "string" &&
    typeof memory.content === "string" &&
    typeof memory.scope === "string";
}

function memoryApprovalArgs(approval: AgentPendingApproval): WriteMemoryToolArgs | null {
  return isWriteMemoryArgs(approval.request.args) ? approval.request.args : null;
}

interface PendingMemoryApprovalView {
  approval: AgentPendingApproval;
  sessionId: string;
  sessionTitle: string;
  isActiveSession: boolean;
}

function formatFingerprint(fingerprint?: string): string | null {
  if (!fingerprint) {
    return null;
  }
  return fingerprint.length > 18 ? `...${fingerprint.slice(-14)}` : fingerprint;
}

function lifecycleTone(status: AgentMemoryLifecycleStatus): string {
  switch (status) {
    case "healthy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "stale":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "weak":
    case "review":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "disabled":
    case "deleted":
      return "border-border/70 bg-muted/40 text-muted-foreground";
  }
}

function lifecycleLabelKey(status: AgentMemoryLifecycleStatus): TranslationKey {
  switch (status) {
    case "healthy":
      return "chat.agentMemory.lifecycle.healthy";
    case "stale":
      return "chat.agentMemory.lifecycle.stale";
    case "weak":
      return "chat.agentMemory.lifecycle.weak";
    case "review":
      return "chat.agentMemory.lifecycle.review";
    case "disabled":
      return "chat.agentMemory.lifecycle.disabled";
    case "deleted":
      return "chat.agentMemory.lifecycle.deleted";
  }
}

function lifecycleActionLabelKey(action: AgentMemoryLifecycleAction): TranslationKey {
  switch (action) {
    case "keep":
      return "chat.agentMemory.lifecycleAction.keep";
    case "review":
      return "chat.agentMemory.lifecycleAction.review";
    case "refresh":
      return "chat.agentMemory.lifecycleAction.refresh";
    case "disable":
      return "chat.agentMemory.lifecycleAction.disable";
    case "restore":
      return "chat.agentMemory.lifecycleAction.restore";
  }
}

function recommendationTone(recommendation: AgentMemoryReviewRecommendation): string {
  switch (recommendation) {
    case "approve":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "review":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "reject":
      return "border-border/70 bg-muted/40 text-muted-foreground";
  }
}

function recommendationLabelKey(recommendation: AgentMemoryReviewRecommendation): TranslationKey {
  switch (recommendation) {
    case "approve":
      return "chat.agentMemory.recommendation.approve";
    case "review":
      return "chat.agentMemory.recommendation.review";
    case "reject":
      return "chat.agentMemory.recommendation.reject";
  }
}

export function AgentMemoryPanel() {
  const { t } = useI18n();
  const entries = useAgentMemoryStore((state) => state.entries);
  const loaded = useAgentMemoryStore((state) => state.loaded);
  const loadMemories = useAgentMemoryStore((state) => state.loadMemories);
  const setPinned = useAgentMemoryStore((state) => state.setPinned);
  const disableMemory = useAgentMemoryStore((state) => state.disableMemory);
  const deleteMemory = useAgentMemoryStore((state) => state.deleteMemory);
  const restoreMemory = useAgentMemoryStore((state) => state.restoreMemory);
  const sessions = useAgentSessionStore((state) => state.sessions);
  const activeSessionId = useAgentSessionStore((state) => state.activeSessionId);
  const focusTarget = useAgentSessionStore((state) => state.focusTarget);
  const consumeFocusTarget = useAgentSessionStore((state) => state.consumeFocusTarget);
  const [expandedWhenEmpty, setExpandedWhenEmpty] = useState(false);
  const [collapsedWithEntries, setCollapsedWithEntries] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) {
      void loadMemories();
    }
  }, [loadMemories, loaded]);

  useEffect(() => {
    if (focusTarget === "memory") {
      setCollapsedWithEntries(false);
      setExpandedWhenEmpty(true);
      consumeFocusTarget("memory");
    }
  }, [consumeFocusTarget, focusTarget]);

  const visibleEntries = useMemo(
    () => entries.filter((entry) => entry.status !== "deleted"),
    [entries],
  );
  const activeEntries = visibleEntries.filter((entry) => entry.status === "active");
  const disabledEntries = visibleEntries.filter((entry) => entry.status === "disabled");
  const pendingMemoryApprovals = useMemo(
    () => sessions
      .flatMap((session): PendingMemoryApprovalView[] => (session.pendingApprovals ?? [])
        .filter((approval) =>
          approval.status === "pending" &&
          approval.toolName === "memory.write" &&
          memoryApprovalArgs(approval),
        )
        .map((approval) => ({
          approval,
          sessionId: session.id,
          sessionTitle: session.title,
          isActiveSession: Boolean(activeSessionId && session.id === activeSessionId),
        })))
      .sort((a, b) => {
        if (a.isActiveSession !== b.isActiveSession) {
          return a.isActiveSession ? -1 : 1;
        }
        return (b.approval.updatedAt || b.approval.createdAt) - (a.approval.updatedAt || a.approval.createdAt);
      }),
    [activeSessionId, sessions],
  );
  const activeSessionAudit = useMemo(() => {
    const activeSession = activeSessionId
      ? sessions.find((session) => session.id === activeSessionId) ?? null
      : null;
    return activeSession ? buildAgentSessionAuditViewModel(activeSession) : null;
  }, [activeSessionId, sessions]);
  const reviewQueue = useMemo(
    () => buildAgentReviewQueueViewModel(sessions, activeSessionId),
    [activeSessionId, sessions],
  );
  const activeSessionPendingCount = reviewQueue.activeSessionPendingMemoryApprovalCount;
  const otherSessionPendingCount = reviewQueue.otherSessionPendingMemoryApprovalCount;
  const selectedEntry = visibleEntries.find((entry) => entry.id === selectedId) ?? visibleEntries[0] ?? null;
  const selectedLifecycle = selectedEntry ? evaluateAgentMemoryLifecycle(selectedEntry) : null;
  const hasPanelContent = visibleEntries.length > 0 || pendingMemoryApprovals.length > 0;
  const isExpanded = hasPanelContent ? !collapsedWithEntries : expandedWhenEmpty;

  if (!loaded && visibleEntries.length === 0) {
    return null;
  }

  const copyCitation = async (entry: AgentMemoryEntry) => {
    try {
      await navigator.clipboard.writeText(formatAgentMemoryCitation(entry));
      toast.success(t("chat.agentMemory.copied"));
    } catch (error) {
      toast.error(t("chat.agentMemory.copyFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const approveMemory = async (approval: AgentPendingApproval) => {
    setBusyApprovalId(approval.id);
    try {
      await approveAgentToolRequest(approval.id, {
        approvalNote: "Approved from Agent Memory panel.",
      });
      toast.success(t("chat.agentMemory.suggestionApproved"));
    } catch (error) {
      toast.error(t("chat.agentMemory.suggestionApproveFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyApprovalId(null);
    }
  };

  const rejectMemory = (approval: AgentPendingApproval) => {
    setBusyApprovalId(approval.id);
    try {
      rejectAgentToolRequest(approval.id, "User rejected the memory suggestion from Agent Memory panel.");
      toast.success(t("chat.agentMemory.suggestionRejected"));
    } catch (error) {
      toast.error(t("chat.agentMemory.suggestionRejectFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyApprovalId(null);
    }
  };

  return (
    <div className="border-t border-border bg-background/95">
      <button
        type="button"
        onClick={() => {
          if (hasPanelContent) {
            setCollapsedWithEntries((value) => !value);
            return;
          }
          setExpandedWhenEmpty((value) => !value);
        }}
        aria-expanded={isExpanded}
        aria-controls="agent-memory-panel-body"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{t("chat.agentMemory.title")}</span>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">
            {t("chat.agentMemory.count", { count: visibleEntries.length })}
          </span>
          {pendingMemoryApprovals.length > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
              {t("chat.agentMemory.pendingCount", { count: pendingMemoryApprovals.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {disabledEntries.length > 0 && (
            <span>{t("chat.agentMemory.disabledCount", { count: disabledEntries.length })}</span>
          )}
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>

      {isExpanded && (
        <div id="agent-memory-panel-body" className="max-h-72 space-y-3 overflow-y-auto border-t border-border/60 px-3 py-3">
          {pendingMemoryApprovals.length > 0 && (
            <section className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("chat.agentMemory.suggestions")}
              </div>
              {activeSessionPendingCount > 0 && (
                <div
                  className="rounded border border-border/50 bg-background/60 px-2 py-1.5 text-[10px] text-muted-foreground"
                  data-testid="agent-memory-active-run-audit"
                >
                  <div>
                    {t("chat.agentMemory.activeSessionFocus", {
                      count: activeSessionPendingCount,
                      otherCount: otherSessionPendingCount,
                    })}
                  </div>
                  {activeSessionAudit && (
                    <div className="mt-0.5 truncate">
                      {[
                        activeSessionAudit.workflowLabel
                          ? `${t("chat.agentMemory.runWorkflow")}: ${activeSessionAudit.workflowLabel}`
                          : null,
                        `${t("chat.agentMemory.runPlan")}: ${activeSessionAudit.plan.completedStepCount}/${activeSessionAudit.plan.stepCount}`,
                        `${t("chat.agentMemory.runEvidence")}: ${activeSessionAudit.evidenceCount}`,
                        `${t("chat.agentMemory.runMemory")}: ${activeSessionAudit.pendingMemoryApprovalCount}`,
                      ].filter(Boolean).join(" / ")}
                    </div>
                  )}
                </div>
              )}
              <div className="grid gap-1.5">
                {pendingMemoryApprovals.map((item) => {
                  const { approval } = item;
                  const args = memoryApprovalArgs(approval);
                  if (!args) {
                    return null;
                  }
                  const memory = args.memory;
                  const busy = busyApprovalId === approval.id;
                  const sourceFingerprint = formatFingerprint(memory.source.fingerprint);
                  const review = buildAgentMemoryReviewViewModel(args);
                  return (
                    <div
                      key={approval.id}
                      className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {item.isActiveSession && (
                              <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                                {t("chat.agentMemory.currentRun")}
                              </span>
                            )}
                            <span className={cn(
                              "rounded-full border px-1.5 py-0.5 text-[9px]",
                              recommendationTone(review.recommendation),
                            )}>
                              {t(recommendationLabelKey(review.recommendation))}
                              {review.confidencePercent !== null ? ` ${review.confidencePercent}%` : ""}
                            </span>
                            <span className={cn(
                              "rounded-full border px-1.5 py-0.5 text-[9px]",
                              scopeTone(memory.scope),
                            )}>
                              {memory.scope}
                            </span>
                            {review.candidateKind && (
                              <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                {review.candidateKind}
                              </span>
                            )}
                            <span className="truncate text-[11px] font-medium text-foreground">
                              {review.title}
                            </span>
                          </div>
                          <div className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">
                            {review.contentPreview}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground/80">
                            {t("chat.agentMemory.suggestionReason")}: {review.primaryReason}
                          </div>
                          {(review.evidenceLine || review.riskLine || review.policyLine || review.recoveryLine) && (
                            <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground/80">
                              {review.evidenceLine && (
                                <div className="line-clamp-2">
                                  {t("chat.agentMemory.reviewEvidence")}: {review.evidenceLine}
                                </div>
                              )}
                              {review.riskLine && (
                                <div className="line-clamp-2">
                                  {t("chat.agentMemory.reviewRisk")}: {review.riskLine}
                                </div>
                              )}
                              {review.policyLine && (
                                <div className="line-clamp-2">
                                  {t("chat.agentMemory.reviewPolicy")}: {review.policyLine}
                                </div>
                              )}
                              {review.recoveryLine && (
                                <div className="line-clamp-2">
                                  {t("chat.agentMemory.reviewRecovery")}: {review.recoveryLine}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground/80">
                            <div>{item.sessionTitle}</div>
                            <div className="truncate">{t("chat.agentMemory.source")}: {review.provenanceLine}</div>
                            {sourceFingerprint && (
                              <div className="truncate">
                                {t("chat.agentMemory.sourceFingerprint")}: {sourceFingerprint}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => void approveMemory(approval)}
                            disabled={busy}
                            className="rounded border border-emerald-500/30 bg-emerald-500/10 p-1 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
                            title={t("chat.agentMemory.approveSuggestion")}
                            aria-label={t("chat.agentMemory.approveSuggestion")}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => rejectMemory(approval)}
                            disabled={busy}
                            className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
                            title={t("chat.agentMemory.rejectSuggestion")}
                            aria-label={t("chat.agentMemory.rejectSuggestion")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {visibleEntries.length === 0 ? (
            <div className="rounded border border-border/50 bg-background/60 px-2 py-3 text-center text-[11px] text-muted-foreground">
              {pendingMemoryApprovals.length > 0 ? t("chat.agentMemory.noSaved") : t("chat.agentMemory.empty")}
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                {visibleEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    aria-current={selectedEntry?.id === entry.id ? "true" : undefined}
                    className={cn(
                      "rounded border px-2 py-1.5 text-left transition-colors",
                      selectedEntry?.id === entry.id
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/50 bg-background/60 hover:bg-accent/40",
                    )}
                  >
                    {(() => {
                      const lifecycle = evaluateAgentMemoryLifecycle(entry);
                      return (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn(
                              "rounded-full border px-1.5 py-0.5 text-[9px]",
                              scopeTone(entry.scope),
                            )}>
                              {entry.scope}
                            </span>
                            {entry.candidateKind && (
                              <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                {entry.candidateKind}
                              </span>
                            )}
                            <span className={cn(
                              "rounded-full border px-1.5 py-0.5 text-[9px]",
                              lifecycleTone(lifecycle.status),
                            )}>
                              {t(lifecycleLabelKey(lifecycle.status))}
                            </span>
                            <span className="truncate text-[11px] font-medium text-foreground">
                              {entry.title}
                            </span>
                            {entry.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                            {entry.content}
                          </div>
                        </>
                      );
                    })()}
                  </button>
                ))}
              </div>

              {selectedEntry && (
                <div className="rounded border border-border/60 bg-background/70 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{selectedEntry.title}</div>
                      <div className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                        {selectedEntry.content}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setPinned(selectedEntry.id, !selectedEntry.pinned)}
                        className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                        title={selectedEntry.pinned ? t("chat.agentMemory.unpin") : t("chat.agentMemory.pin")}
                        aria-label={selectedEntry.pinned ? t("chat.agentMemory.unpin") : t("chat.agentMemory.pin")}
                      >
                        {selectedEntry.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyCitation(selectedEntry)}
                        className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                        title={t("chat.agentMemory.cite")}
                        aria-label={t("chat.agentMemory.cite")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {selectedEntry.status === "disabled" ? (
                        <button
                          type="button"
                          onClick={() => restoreMemory(selectedEntry.id)}
                          className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                          title={t("chat.agentMemory.restore")}
                          aria-label={t("chat.agentMemory.restore")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => disableMemory(selectedEntry.id)}
                          className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                          title={t("chat.agentMemory.disable")}
                          aria-label={t("chat.agentMemory.disable")}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteMemory(selectedEntry.id)}
                        className="rounded border border-destructive/30 bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"
                        title={t("chat.agentMemory.delete")}
                        aria-label={t("chat.agentMemory.delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
                    {selectedEntry.candidateKind && (
                      <div>{t("chat.agentMemory.reviewKind")}: {selectedEntry.candidateKind}</div>
                    )}
                    {selectedLifecycle && (
                      <div>
                        {t("chat.agentMemory.lifecycle")}: {t(lifecycleLabelKey(selectedLifecycle.status))}
                        {` / ${t(lifecycleActionLabelKey(selectedLifecycle.recommendedAction))}`}
                        {selectedLifecycle.reasons.length > 0 ? ` / ${selectedLifecycle.reasons.slice(0, 3).join(', ')}` : ''}
                      </div>
                    )}
                    <div>{t("chat.agentMemory.source")}: {selectedEntry.source.label}</div>
                    {selectedEntry.source.locator && (
                      <div className="truncate">{selectedEntry.source.locator}</div>
                    )}
                    <div>{t("chat.agentMemory.updated")}: {formatTimestamp(selectedEntry.updatedAt)}</div>
                  </div>
                </div>
              )}
            </>
          )}

          {activeEntries.length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              {t("chat.agentMemory.activeCount", { count: activeEntries.length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
