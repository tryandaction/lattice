"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Loader2,
  PlayCircle,
  ShieldCheck,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { AgentRunReport } from "./agent-run-report";
import { cn } from "@/lib/utils";
import {
  approveAgentToolRequest,
  rejectAgentToolRequest,
  type AgentToolExecutionOptions,
} from "@/lib/ai/agent-tool-broker";
import { reconcileResearchAgentPendingApprovals } from "@/lib/ai/research-agent";
import { runCodeWithWorkspaceRunner } from "@/lib/ai/agent-runner-tool";
import {
  buildAgentSessionDebugBundle,
  serializeAgentSessionDebugBundle,
} from "@/lib/ai/agent-session-debug-bundle";
import { buildAgentReviewQueueViewModel } from "@/lib/ai/agent-review-queue-view-model";
import {
  auditMetadataNumber,
  auditMetadataString,
  buildAgentSessionAuditViewModel,
  type AgentSessionAuditViewModel,
} from "@/lib/ai/agent-session-audit-view-model";
import { focusAgentSession } from "@/lib/ai/agent-session-focus";
import { buildAgentRunReportViewModel } from "@/lib/ai/agent-run-report-view-model";
import type {
  AgentPendingApproval,
  AgentPendingApprovalStatus,
  AgentSession,
  AgentSessionStatus,
  AgentTraceEvent,
  AgentTraceEventKind,
} from "@/lib/ai/agent-session";
import type { AgentPermissionLevel } from "@/lib/ai/agent-policy";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAgentSessionStore } from "@/stores/agent-session-store";

type PlanStepStatus = "pending" | "running" | "completed" | "blocked" | "failed";

interface AgentPlanStepView {
  id: string;
  title: string;
  status: PlanStepStatus;
  toolName: string | null;
  message: string;
  timestamp: number;
}

interface AgentPlanView {
  source: string | null;
  warningCount: number;
  warnings: string[];
  plannerPromptPreview: string | null;
  plannerRawOutputPreview: string | null;
  steps: AgentPlanStepView[];
}

interface AgentLineageView {
  sourceSessionId: string | null;
  sourceCompactionId: string | null;
  sourceSummary: string | null;
  sourceSession: AgentSession | null;
  childSessions: AgentSession[];
}

const TOOL_CONTRACT_METADATA_KEYS = new Set([
  "toolLabel",
  "toolDescription",
  "toolArgsSummary",
  "toolResultSummary",
]);

function statusTone(status: AgentSessionStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "cancelled":
      return "border-muted-foreground/30 bg-muted/60 text-muted-foreground";
    case "waiting_approval":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "running":
      return "border-primary/30 bg-primary/10 text-primary";
    default:
      return "border-border/70 bg-background/80 text-muted-foreground";
  }
}

function approvalStatusTone(status: AgentPendingApprovalStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "rejected":
      return "border-muted-foreground/30 bg-muted/60 text-muted-foreground";
    case "executing":
    case "approved":
      return "border-primary/30 bg-primary/10 text-primary";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

function planStepTone(status: PlanStepStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "blocked":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "running":
      return "border-primary/30 bg-primary/10 text-primary";
    default:
      return "border-border/70 bg-background/80 text-muted-foreground";
  }
}

interface ToolResultInspectorProps {
  schemaVersion: number | null;
  status: string | null;
  summary: string | null;
  preview: string | null;
  metrics: string | null;
  artifacts: string | null;
  diagnostics: string | null;
}

function ToolResultInspector({
  schemaVersion,
  status,
  summary,
  preview,
  metrics,
  artifacts,
  diagnostics,
}: ToolResultInspectorProps) {
  const { t } = useI18n();
  const fields = [
    summary ? { label: t("chat.agentTrace.resultSummary"), value: summary, tone: "text-sky-950 dark:text-sky-50" } : null,
    metrics ? { label: t("chat.agentTrace.resultMetrics"), value: metrics, tone: "text-sky-900 dark:text-sky-100" } : null,
    artifacts ? { label: t("chat.agentTrace.resultArtifacts"), value: artifacts, tone: "text-sky-900 dark:text-sky-100" } : null,
    diagnostics ? { label: t("chat.agentTrace.resultDiagnostics"), value: diagnostics, tone: "text-amber-900 dark:text-amber-100" } : null,
    preview ? { label: t("chat.agentTrace.resultPreview"), value: preview, tone: "text-sky-900/80 dark:text-sky-100/80" } : null,
  ].filter((field): field is { label: string; value: string; tone: string } => Boolean(field));

  return (
    <div className="mt-1 rounded border border-sky-500/20 bg-sky-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-sky-900 dark:text-sky-100">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{t("chat.agentTrace.resultSchema")}</span>
        {status && (
          <span className="rounded-full border border-sky-500/25 bg-background/60 px-1.5 py-0.5 text-[9px]">
            {t("chat.agentTrace.resultStatus")}: {status}
          </span>
        )}
        {schemaVersion !== null && (
          <span className="rounded-full border border-sky-500/25 bg-background/60 px-1.5 py-0.5 text-[9px]">
            v{schemaVersion}
          </span>
        )}
      </div>
      {fields.length > 0 && (
        <div className="mt-1 grid gap-1">
          {fields.map((field) => (
            <div key={field.label} className="grid gap-0.5 sm:grid-cols-[88px_1fr]">
              <span className="font-medium text-sky-950 dark:text-sky-50">{field.label}</span>
              <span className={cn("line-clamp-2 break-words", field.tone)}>{field.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function eventIcon(event: AgentTraceEvent) {
  switch (event.kind) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "error":
      return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    case "approval_required":
      return <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />;
    case "approval_granted":
      return <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />;
    case "cancelled":
      return <Square className="h-3.5 w-3.5 text-muted-foreground" />;
    case "session_started":
      return <PlayCircle className="h-3.5 w-3.5 text-primary" />;
    default:
      return <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
}

function summarizePendingApprovals(session: AgentSession): number {
  return (session.pendingApprovals ?? []).filter((approval) => approval.status === "pending").length;
}

function isResearchAgentSession(session: AgentSession): boolean {
  return session.trace.some((event) =>
    event.kind === "planning" &&
    (
      event.metadata?.agentKind === "research_agent" ||
      typeof event.metadata?.planSource === "string" ||
      typeof event.metadata?.planStepCount === "number"
    ),
  );
}

function statusLabelKey(status: AgentSessionStatus) {
  switch (status) {
    case "queued":
      return "chat.agentTrace.status.queued";
    case "running":
      return "chat.agentTrace.status.running";
    case "waiting_approval":
      return "chat.agentTrace.status.waitingApproval";
    case "completed":
      return "chat.agentTrace.status.completed";
    case "failed":
      return "chat.agentTrace.status.failed";
    case "cancelled":
      return "chat.agentTrace.status.cancelled";
  }
}

function eventLabelKey(kind: AgentTraceEventKind) {
  switch (kind) {
    case "session_started":
      return "chat.agentTrace.event.sessionStarted";
    case "planning":
      return "chat.agentTrace.event.planning";
    case "context_resolved":
      return "chat.agentTrace.event.contextResolved";
    case "tool_requested":
      return "chat.agentTrace.event.toolRequested";
    case "approval_required":
      return "chat.agentTrace.event.approvalRequired";
    case "approval_granted":
      return "chat.agentTrace.event.approvalGranted";
    case "tool_result":
      return "chat.agentTrace.event.toolResult";
    case "draft_created":
      return "chat.agentTrace.event.draftCreated";
    case "proposal_created":
      return "chat.agentTrace.event.proposalCreated";
    case "writeback_applied":
      return "chat.agentTrace.event.writebackApplied";
    case "memory_updated":
      return "chat.agentTrace.event.memoryUpdated";
    case "error":
      return "chat.agentTrace.event.error";
    case "completed":
      return "chat.agentTrace.event.completed";
    case "cancelled":
      return "chat.agentTrace.event.cancelled";
  }
  return "chat.agentTrace.event.error";
}

function permissionLabelKey(permission: AgentPermissionLevel) {
  switch (permission) {
    case "auto":
      return "chat.agentTrace.permission.auto";
    case "ask":
      return "chat.agentTrace.permission.ask";
    case "deny":
      return "chat.agentTrace.permission.deny";
  }
}

function approvalStatusLabelKey(status: AgentPendingApprovalStatus) {
  switch (status) {
    case "pending":
      return "chat.agentTrace.approvalStatus.pending";
    case "approved":
      return "chat.agentTrace.approvalStatus.approved";
    case "rejected":
      return "chat.agentTrace.approvalStatus.rejected";
    case "executing":
      return "chat.agentTrace.approvalStatus.executing";
    case "completed":
      return "chat.agentTrace.approvalStatus.completed";
    case "failed":
      return "chat.agentTrace.approvalStatus.failed";
  }
}

function metadataString(event: AgentTraceEvent, key: string): string | null {
  return auditMetadataString(event, key);
}

function metadataNumber(event: AgentTraceEvent, key: string): number | null {
  return auditMetadataNumber(event, key);
}

function isPlanStepStatus(value: string | null): value is PlanStepStatus {
  return value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed";
}

function derivePlanView(session: AgentSession): AgentPlanView | null {
  const planCreated = session.trace.find((event) =>
    event.kind === "planning" && typeof event.metadata?.planSource === "string" && typeof event.metadata?.planStepCount === "number"
  );
  const warningEvents = session.trace.filter((event) =>
    event.kind === "planning" && typeof event.metadata?.planWarningCount === "number" && metadataNumber(event, "planWarningCount")! > 0
  );
  const warningEvent = warningEvents.find((event) => /warning|fell back|fallback/i.test(event.message)) ?? warningEvents[0];
  const stepsById = new Map<string, AgentPlanStepView>();

  for (const event of session.trace) {
    const stepId = metadataString(event, "planStepId");
    const status = metadataString(event, "planStepStatus");
    if (!stepId || !isPlanStepStatus(status)) {
      continue;
    }

    const existing = stepsById.get(stepId);
    const title = event.message
      .replace(/^Completed plan step:\s*/i, "")
      .replace(/^Running plan step:\s*/i, "")
      .replace(/^Failed plan step:\s*/i, "")
      .replace(/^Plan step blocked on approval:\s*/i, "")
      .replace(/^Plan step \w+:\s*/i, "")
      .replace(/\.$/, "")
      .trim() || stepId;

    stepsById.set(stepId, {
      id: stepId,
      title: existing?.title && existing.title !== stepId ? existing.title : title,
      status,
      toolName: metadataString(event, "toolName"),
      message: event.message,
      timestamp: event.timestamp,
    });
  }

  const source = metadataString(planCreated ?? ({} as AgentTraceEvent), "planSource");
  const warningCount = metadataNumber(warningEvent ?? planCreated ?? ({} as AgentTraceEvent), "planWarningCount") ?? 0;
  const plannerPromptPreview = metadataString(planCreated ?? ({} as AgentTraceEvent), "plannerPromptPreview");
  const plannerRawOutputPreview = metadataString(planCreated ?? ({} as AgentTraceEvent), "plannerRawOutputPreview");
  const warnings = warningEvent
    ? [warningEvent.message.replace(/^Research plan fell back to defaults:\s*/i, "").trim()]
    : [];

  if (!planCreated && stepsById.size === 0 && warnings.length === 0 && !plannerPromptPreview && !plannerRawOutputPreview) {
    return null;
  }

  return {
    source,
    warningCount,
    warnings,
    plannerPromptPreview,
    plannerRawOutputPreview,
    steps: [...stepsById.values()].sort((left, right) => left.timestamp - right.timestamp),
  };
}

function deriveLineageView(session: AgentSession, sessions: AgentSession[]): AgentLineageView | null {
  const planCreated = session.trace.find((event) =>
    event.kind === "planning" && typeof event.metadata?.planSource === "string"
  );
  const sourceSessionId = metadataString(planCreated ?? ({} as AgentTraceEvent), "continuationSourceSessionId");
  const sourceCompactionId = metadataString(planCreated ?? ({} as AgentTraceEvent), "continuationCompactionId");
  const sourceSummary = metadataString(planCreated ?? ({} as AgentTraceEvent), "continuationSourceSummary");
  const sourceSession = sourceSessionId
    ? sessions.find((candidate) => candidate.id === sourceSessionId) ?? null
    : null;
  const childSessions = sessions.filter((candidate) =>
    candidate.id !== session.id &&
    candidate.trace.some((event) =>
      event.kind === "planning" &&
      metadataString(event, "continuationSourceSessionId") === session.id,
    ),
  );

  if (!sourceSessionId && childSessions.length === 0) {
    return null;
  }

  return {
    sourceSessionId,
    sourceCompactionId,
    sourceSummary,
    sourceSession,
    childSessions,
  };
}

function formatMetadata(metadata: AgentTraceEvent["metadata"]): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }
  return JSON.stringify(metadata, null, 2);
}

function omitToolContractMetadata(
  metadata: AgentTraceEvent["metadata"],
): AgentTraceEvent["metadata"] | undefined {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(([key]) => !TOOL_CONTRACT_METADATA_KEYS.has(key));
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as AgentTraceEvent["metadata"];
}

function AgentTraceEventRow({ event }: { event: AgentTraceEvent }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const resultPreview = metadataString(event, "resultPreview");
  const resultSchemaVersion = metadataNumber(event, "resultSchemaVersion");
  const resultStatus = metadataString(event, "resultStatus");
  const resultSummary = metadataString(event, "resultSummary");
  const resultMetricsPreview = metadataString(event, "resultMetricsPreview");
  const resultArtifactsPreview = metadataString(event, "resultArtifactsPreview");
  const resultDiagnosticsPreview = metadataString(event, "resultDiagnosticsPreview");
  const errorCategory = metadataString(event, "errorCategory");
  const errorStage = metadataString(event, "errorStage");
  const errorRecoveryHint = metadataString(event, "errorRecoveryHint");
  const hasResultSchemaAudit = Boolean(
    resultSchemaVersion !== null ||
    resultStatus ||
    resultSummary ||
    resultMetricsPreview ||
    resultArtifactsPreview ||
    resultDiagnosticsPreview,
  );
  const omittedContextCount = metadataNumber(event, "omittedContextCount");
  const omittedContextTokens = metadataNumber(event, "omittedContextTokens");
  const omittedContextPreview = metadataString(event, "omittedContextPreview");
  const omittedContextAutoSummary = metadataString(event, "omittedContextAutoSummary");
  const omittedContextModelSummary = metadataString(event, "omittedContextModelSummary");
  const omittedContextModelSummaryStatus = metadataString(event, "omittedContextModelSummaryStatus");
  const omittedContextModelSummaryWarning = metadataString(event, "omittedContextModelSummaryWarning");
  const omittedContextModelSummaryQualityStatus = metadataString(event, "omittedContextModelSummaryQualityStatus");
  const omittedContextModelSummaryQualityScore = metadataNumber(event, "omittedContextModelSummaryQualityScore");
  const omittedContextModelSummaryQualitySummary = metadataString(event, "omittedContextModelSummaryQualitySummary");
  const omittedContextSemanticPreview = metadataString(event, "omittedContextSemanticPreview");
  const omittedContextRecoveryHints = metadataString(event, "omittedContextRecoveryHints");
  const omittedContextRecoveryPriority = metadataString(event, "omittedContextRecoveryPriority");
  const omittedContextRecoveryPlan = metadataString(event, "omittedContextRecoveryPlan");
  const continuationRecoverySummary = metadataString(event, "continuationRecoverySummary");
  const continuationRecoveredEvidenceCount = metadataNumber(event, "continuationRecoveredEvidenceCount");
  const continuationRecoveryIncluded = event.metadata?.continuationRecoveryIncluded === true;
  const continuationRecoveryHintsPreview = metadataString(event, "continuationRecoveryHintsPreview");
  const continuationRecoveryPriorityPreview = metadataString(event, "continuationRecoveryPriorityPreview");
  const continuationRecoveryPlanPreview = metadataString(event, "continuationRecoveryPlanPreview");
  const continuationRecoveryAutoSummaryPreview = metadataString(event, "continuationRecoveryAutoSummaryPreview");
  const continuationRecoveryModelSummaryPreview = metadataString(event, "continuationRecoveryModelSummaryPreview");
  const continuationRecoverySemanticPreview = metadataString(event, "continuationRecoverySemanticPreview");
  const continuationRecoveryReadPathCount = metadataNumber(event, "continuationRecoveryReadPathCount");
  const continuationRecoveryReadPathsPreview = metadataString(event, "continuationRecoveryReadPathsPreview");
  const hasContinuationRecoveryAudit = Boolean(
    continuationRecoverySummary ||
    continuationRecoveryHintsPreview ||
    continuationRecoveryPriorityPreview ||
    continuationRecoveryPlanPreview ||
    continuationRecoveryAutoSummaryPreview ||
    continuationRecoveryModelSummaryPreview ||
    continuationRecoverySemanticPreview ||
    continuationRecoveryReadPathsPreview ||
    continuationRecoveryIncluded ||
    (continuationRecoveredEvidenceCount !== null && continuationRecoveredEvidenceCount > 0),
  );
  const observationCount = metadataNumber(event, "observationCount");
  const observationReplanIteration = metadataNumber(event, "observationReplanIteration");
  const observationReplanBudget = metadataNumber(event, "observationReplanBudget");
  const observationReplanStopReason = metadataString(event, "observationReplanStopReason");
  const observationQualitySummary = metadataString(event, "observationQualitySummary");
  const observationDuplicateCount = metadataNumber(event, "observationDuplicateCount");
  const observationLowValueCount = metadataNumber(event, "observationLowValueCount");
  const observationRecoveryRecommendation = metadataString(event, "observationRecoveryRecommendation");
  const recoveryObservationCount = metadataNumber(event, "recoveryObservationCount");
  const recoveryObservationLocatorsPreview = metadataString(event, "recoveryObservationLocatorsPreview");
  const recoveryQualityStatus = metadataString(event, "recoveryQualityStatus");
  const recoveryQualitySummary = metadataString(event, "recoveryQualitySummary");
  const recoveryQualityMissingLocators = metadataString(event, "recoveryQualityMissingLocators");
  const recoveredContextDigestSummary = metadataString(event, "recoveredContextDigestSummary");
  const recoveredContextDigestAnswerPreview = metadataString(event, "recoveredContextDigestAnswerPreview");
  const recoveredContextUsefulCount = metadataNumber(event, "recoveredContextUsefulCount");
  const recoveredContextLowValueCount = metadataNumber(event, "recoveredContextLowValueCount");
  const updatedStepIds = metadataString(event, "updatedStepIds");
  const ignoredStepIds = metadataString(event, "ignoredStepIds");
  const observationsPreview = metadataString(event, "observationsPreview");
  const restored = event.metadata?.restored === true;
  const resolvedPromptPreview = metadataString(event, "resolvedPromptPreview");
  const answerPreview = metadataString(event, "answerPreview");
  const restoredSynthesisPreview = metadataString(event, "restoredSynthesisPreview");
  const approvalToolName = metadataString(event, "approvalToolName");
  const approvalId = metadataString(event, "approvalId");
  const hasRestoreAudit = restored || Boolean(resolvedPromptPreview || answerPreview || restoredSynthesisPreview);
  const hasApprovalResumeAudit = Boolean(restoredSynthesisPreview && (approvalToolName || approvalId));
  const memorySuggestionStatus = metadataString(event, "memorySuggestionStatus");
  const memorySuggestionReason = metadataString(event, "memorySuggestionReason");
  const memorySuggestionReasonCode = metadataString(event, "memorySuggestionReasonCode");
  const memorySuggestionConfidence = metadataNumber(event, "memorySuggestionConfidence");
  const memorySuggestionPolicyDecision = metadataString(event, "memorySuggestionPolicyDecision");
  const memorySuggestionPolicySummary = metadataString(event, "memorySuggestionPolicySummary");
  const memorySuggestionPolicyReasons = metadataString(event, "memorySuggestionPolicyReasons");
  const memorySuggestionCandidateKind = metadataString(event, "memorySuggestionCandidateKind");
  const memorySuggestionScope = metadataString(event, "memorySuggestionScope");
  const memorySuggestionTitle = metadataString(event, "memorySuggestionTitle");
  const memorySuggestionDuplicateMemoryId = metadataString(event, "memorySuggestionDuplicateMemoryId");
  const memorySuggestionSourceFingerprint = metadataString(event, "memorySuggestionSourceFingerprint");
  const memorySuggestionContextPackId = metadataString(event, "memorySuggestionContextPackId");
  const memorySuggestionOmittedContextCount = metadataNumber(event, "memorySuggestionOmittedContextCount");
  const memorySuggestionOmittedContextPreview = metadataString(event, "memorySuggestionOmittedContextPreview");
  const memorySuggestionOmittedAutoSummary = metadataString(event, "memorySuggestionOmittedAutoSummary");
  const memorySuggestionOmittedModelSummary = metadataString(event, "memorySuggestionOmittedModelSummary");
  const memorySuggestionRecoveryObservationCount = metadataNumber(event, "memorySuggestionRecoveryObservationCount");
  const memorySuggestionRecoveryObservationPreview = metadataString(event, "memorySuggestionRecoveryObservationPreview");
  const memorySuggestionRecoveredContextDigest = metadataString(event, "memorySuggestionRecoveredContextDigest");
  const memorySuggestionApplicability = metadataString(event, "memorySuggestionApplicability");
  const memorySuggestionEvidenceSummary = metadataString(event, "memorySuggestionEvidenceSummary");
  const memorySuggestionCaution = metadataString(event, "memorySuggestionCaution");
  const memorySuggestionAnswerPreview = metadataString(event, "memorySuggestionAnswerPreview");
  const hasMemorySuggestionAudit = Boolean(memorySuggestionStatus);
  const memoryCount = metadataNumber(event, "memoryCount");
  const memoryIdsPreview = metadataString(event, "memoryIdsPreview") ?? metadataString(event, "memorySnapshotIdsPreview");
  const memoryQueryScopes = metadataString(event, "memoryQueryScopes");
  const memoryQueryWorkspaceKey = metadataString(event, "memoryQueryWorkspaceKey");
  const memoryQueryProjectKey = metadataString(event, "memoryQueryProjectKey");
  const memoryQueryConversationId = metadataString(event, "memoryQueryConversationId");
  const memoryQueryLimit = metadataNumber(event, "memoryQueryLimit");
  const memoryCandidateCount = metadataNumber(event, "memoryCandidateCount");
  const memoryRankingQueryPreview = metadataString(event, "memoryRankingQueryPreview");
  const memoryRankedPreview = metadataString(event, "memoryRankedPreview");
  const memoryLifecycleSummary = metadataString(event, "memoryLifecycleSummary");
  const memoryLifecyclePreview = metadataString(event, "memoryLifecyclePreview");
  const contextPackId = metadataString(event, "contextPackId");
  const hasMemoryReadAudit = (
    memoryIdsPreview !== null ||
    memoryRankedPreview !== null ||
    memoryLifecycleSummary !== null ||
    memoryLifecyclePreview !== null ||
    (
      contextPackId !== null &&
      memoryCount !== null &&
      Boolean(memoryQueryScopes || memoryQueryWorkspaceKey || memoryQueryProjectKey || memoryQueryConversationId || memoryQueryLimit !== null || memoryCandidateCount !== null)
    )
  );
  const toolLabel = metadataString(event, "toolLabel");
  const toolDescription = metadataString(event, "toolDescription");
  const toolArgsSummary = metadataString(event, "toolArgsSummary");
  const toolResultSummary = metadataString(event, "toolResultSummary");
  const hasToolContract = Boolean(toolLabel || toolDescription || toolArgsSummary || toolResultSummary);
  const metadataForDetails = omitToolContractMetadata(event.metadata);
  const hasDetails = Boolean(
    event.tool ||
    event.evidenceRefs?.length ||
    event.error ||
    hasToolContract ||
    (metadataForDetails && Object.keys(metadataForDetails).length > 0),
  );
  return (
    <div className="rounded border border-border/50 bg-background/70 px-2 py-1.5" data-event-id={event.id}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{eventIcon(event)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-foreground">
              {t(eventLabelKey(event.kind))}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatTime(event.timestamp)}
            </span>
            {event.decision && (
              <span className={cn(
                "rounded-full border px-1.5 py-0.5 text-[9px]",
                event.decision.permission === "ask"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : event.decision.permission === "deny"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border/60 text-muted-foreground",
              )}>
                {t(permissionLabelKey(event.decision.permission))}
              </span>
            )}
            {metadataString(event, "planStepStatus") && (
              <span className={cn(
                "rounded-full border px-1.5 py-0.5 text-[9px]",
                planStepTone(metadataString(event, "planStepStatus") as PlanStepStatus),
              )}>
                {metadataString(event, "planStepStatus")}
              </span>
            )}
          </div>
          <div className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
            {event.message}
          </div>
          {hasRestoreAudit && (
            <div className="mt-1 rounded border border-emerald-500/25 bg-emerald-500/5 px-2 py-1 text-[10px] leading-relaxed text-emerald-900 dark:text-emerald-100">
              <div className="font-medium">{t("chat.agentTrace.restoreAudit")}</div>
              <div className="text-emerald-900/80 dark:text-emerald-100/80">
                {t(hasApprovalResumeAudit
                  ? "chat.agentTrace.approvalResumeSummary"
                  : "chat.agentTrace.restoreAuditSummary")}
              </div>
              {(approvalToolName || approvalId) && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.approval")}: </span>
                  {[approvalToolName, approvalId].filter(Boolean).join(" / ")}
                </div>
              )}
              {resultPreview && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.resultPreview")}: </span>
                  {resultPreview}
                </div>
              )}
              {resolvedPromptPreview && (
                <div className="mt-0.5 line-clamp-2 text-emerald-900/80 dark:text-emerald-100/80">
                  <span className="font-medium">{t("chat.agentTrace.evidenceContext")}: </span>
                  {resolvedPromptPreview}
                </div>
              )}
              {answerPreview && (
                <div className="mt-0.5 line-clamp-2 text-emerald-900/80 dark:text-emerald-100/80">
                  <span className="font-medium">{t("chat.agentTrace.answerPreview")}: </span>
                  {answerPreview}
                </div>
              )}
              {restoredSynthesisPreview && (
                <div className="mt-0.5 line-clamp-2 text-emerald-900/80 dark:text-emerald-100/80">
                  <span className="font-medium">{t("chat.agentTrace.synthesisPreview")}: </span>
                  {restoredSynthesisPreview}
                </div>
              )}
            </div>
          )}
          {hasContinuationRecoveryAudit && (
            <div className="mt-1 rounded border border-cyan-500/25 bg-cyan-500/5 px-2 py-1 text-[10px] leading-relaxed text-cyan-900 dark:text-cyan-100">
              <div className="font-medium">{t("chat.agentTrace.continuationRecovery")}</div>
              <div className="text-cyan-900/80 dark:text-cyan-100/80">
                {t("chat.agentTrace.continuationRecoverySummary", {
                  count: continuationRecoveredEvidenceCount ?? 0,
                })}
              </div>
              {continuationRecoverySummary && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoveredSummary")}: </span>
                  {continuationRecoverySummary}
                </div>
              )}
              {continuationRecoveryHintsPreview && (
                <div className="mt-0.5 line-clamp-2 text-cyan-900/80 dark:text-cyan-100/80">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoveryHints")}: </span>
                  {continuationRecoveryHintsPreview}
                </div>
              )}
              {continuationRecoveryPriorityPreview && (
                <div className="mt-0.5 line-clamp-2 text-cyan-900/80 dark:text-cyan-100/80">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoveryPriority")}: </span>
                  {continuationRecoveryPriorityPreview}
                </div>
              )}
              {continuationRecoveryPlanPreview && (
                <div className="mt-0.5 line-clamp-2 text-cyan-900/80 dark:text-cyan-100/80">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoveryPlan")}: </span>
                  {continuationRecoveryPlanPreview}
                </div>
              )}
              {continuationRecoveryAutoSummaryPreview && (
                <div className="mt-0.5 line-clamp-2 text-cyan-900/80 dark:text-cyan-100/80">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoveryAutoSummary")}: </span>
                  {continuationRecoveryAutoSummaryPreview}
                </div>
              )}
              {continuationRecoveryModelSummaryPreview && (
                <div className="mt-0.5 line-clamp-2 text-cyan-900/80 dark:text-cyan-100/80">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoveryModelSummary")}: </span>
                  {continuationRecoveryModelSummaryPreview}
                </div>
              )}
              {continuationRecoveryReadPathsPreview && (
                <div className="mt-0.5 line-clamp-2 text-cyan-900/80 dark:text-cyan-100/80">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoveryReads")}: </span>
                  {continuationRecoveryReadPathCount !== null
                    ? `${continuationRecoveryReadPathCount}: ${continuationRecoveryReadPathsPreview}`
                    : continuationRecoveryReadPathsPreview}
                </div>
              )}
              {continuationRecoverySemanticPreview && (
                <div className="mt-0.5 line-clamp-2 text-cyan-900/80 dark:text-cyan-100/80">
                  <span className="font-medium">{t("chat.agentTrace.continuationRecoverySemantic")}: </span>
                  {continuationRecoverySemanticPreview}
                </div>
              )}
            </div>
          )}
          {observationCount !== null && observationCount > 0 && (
            <div className="mt-1 rounded border border-sky-500/25 bg-sky-500/5 px-2 py-1 text-[10px] leading-relaxed text-sky-900 dark:text-sky-100">
              <div className="font-medium">{t("chat.agentTrace.observationReplan")}</div>
              <div>
                {t("chat.agentTrace.observationReplanSummary", { count: observationCount })}
              </div>
              {observationReplanIteration !== null && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.observationReplanIteration")}: </span>
                  {observationReplanIteration}
                  {observationReplanBudget !== null ? ` / ${observationReplanBudget}` : ''}
                </div>
              )}
              {observationReplanStopReason && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.observationReplanStopReason")}: </span>
                  {observationReplanStopReason}
                </div>
              )}
              {observationQualitySummary && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.observationQuality")}: </span>
                  {observationQualitySummary}
                </div>
              )}
              {(observationDuplicateCount !== null || observationLowValueCount !== null) && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.observationQualityCounts")}: </span>
                  {[
                    observationDuplicateCount !== null ? `duplicates=${observationDuplicateCount}` : null,
                    observationLowValueCount !== null ? `lowValue=${observationLowValueCount}` : null,
                  ].filter(Boolean).join(" / ")}
                </div>
              )}
              {recoveryObservationLocatorsPreview && (
                <div className="mt-0.5 line-clamp-2 text-sky-900/80 dark:text-sky-100/80">
                  <span className="font-medium">{t("chat.agentTrace.recoveryObservations")}: </span>
                  {recoveryObservationCount !== null
                    ? `${recoveryObservationCount}: ${recoveryObservationLocatorsPreview}`
                    : recoveryObservationLocatorsPreview}
                </div>
              )}
              {(recoveryQualityStatus || recoveryQualitySummary) && (
                <div className="mt-0.5 line-clamp-2 text-sky-900/80 dark:text-sky-100/80">
                  <span className="font-medium">{t("chat.agentTrace.recoveryQuality")}: </span>
                  {[recoveryQualityStatus, recoveryQualitySummary, recoveryQualityMissingLocators ? `missing=${recoveryQualityMissingLocators}` : null]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
              )}
              {(recoveredContextDigestSummary || recoveredContextDigestAnswerPreview) && (
                <div className="mt-0.5 line-clamp-2 text-sky-900/80 dark:text-sky-100/80">
                  <span className="font-medium">{t("chat.agentTrace.recoveredContextDigest")}: </span>
                  {[
                    recoveredContextDigestSummary,
                    recoveredContextUsefulCount !== null ? `useful=${recoveredContextUsefulCount}` : null,
                    recoveredContextLowValueCount !== null ? `lowValue=${recoveredContextLowValueCount}` : null,
                    recoveredContextDigestAnswerPreview,
                  ].filter(Boolean).join(" / ")}
                </div>
              )}
              {updatedStepIds && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.updatedSteps")}: </span>
                  {updatedStepIds}
                </div>
              )}
              {ignoredStepIds && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.ignoredSteps")}: </span>
                  {ignoredStepIds}
                </div>
              )}
              {observationsPreview && (
                <div className="mt-0.5 line-clamp-2 text-sky-900/80 dark:text-sky-100/80">
                  <span className="font-medium">{t("chat.agentTrace.observationsPreview")}: </span>
                  {observationsPreview}
                </div>
              )}
              {observationRecoveryRecommendation && (
                <div className="mt-0.5 line-clamp-2 text-sky-950 dark:text-sky-50">
                  <span className="font-medium">{t("chat.agentTrace.observationRecoveryRecommendation")}: </span>
                  {observationRecoveryRecommendation}
                </div>
              )}
            </div>
          )}
          {hasMemorySuggestionAudit && (
            <div className={cn(
              "mt-1 rounded border px-2 py-1 text-[10px] leading-relaxed",
              memorySuggestionStatus === "accepted"
                ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100"
                : "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
            )}>
              <div className="font-medium">{t("chat.agentTrace.memorySuggestion")}</div>
              <div className={cn(
                memorySuggestionStatus === "accepted"
                  ? "text-emerald-900/80 dark:text-emerald-100/80"
                  : "text-muted-foreground",
              )}>
                {t(memorySuggestionStatus === "accepted"
                  ? "chat.agentTrace.memorySuggestionAccepted"
                  : "chat.agentTrace.memorySuggestionSkipped")}
              </div>
              {(memorySuggestionTitle || memorySuggestionScope || memorySuggestionConfidence !== null) && (
                <div className="mt-0.5">
                  {memorySuggestionTitle && (
                    <span className="font-medium">{memorySuggestionTitle}</span>
                  )}
                  {memorySuggestionScope && (
                    <span> / {memorySuggestionScope}</span>
                  )}
                  {memorySuggestionConfidence !== null && (
                    <span> / {t("chat.agentTrace.memoryConfidence", { count: memorySuggestionConfidence })}</span>
                  )}
                  {memorySuggestionCandidateKind && (
                    <span> / {memorySuggestionCandidateKind}</span>
                  )}
                </div>
              )}
              {memorySuggestionReason && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryReason")}: </span>
                  {memorySuggestionReason}
                </div>
              )}
              {memorySuggestionReasonCode && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.memoryReasonCode")}: </span>
                  {memorySuggestionReasonCode}
                </div>
              )}
              {(memorySuggestionPolicyDecision || memorySuggestionPolicySummary || memorySuggestionPolicyReasons) && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryPolicy")}: </span>
                  {[memorySuggestionPolicyDecision, memorySuggestionPolicySummary, memorySuggestionPolicyReasons]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
              )}
              {memorySuggestionAnswerPreview && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryAnswerPreview")}: </span>
                  {memorySuggestionAnswerPreview}
                </div>
              )}
              {memorySuggestionApplicability && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryApplicability")}: </span>
                  {memorySuggestionApplicability}
                </div>
              )}
              {memorySuggestionEvidenceSummary && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryEvidenceSummary")}: </span>
                  {memorySuggestionEvidenceSummary}
                </div>
              )}
              {memorySuggestionCaution && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryCaution")}: </span>
                  {memorySuggestionCaution}
                </div>
              )}
              {(memorySuggestionContextPackId || memorySuggestionOmittedContextCount !== null) && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.memoryContextPack")}: </span>
                  {[
                    memorySuggestionContextPackId,
                    memorySuggestionOmittedContextCount !== null
                      ? t("chat.agentTrace.memoryOmittedCount", { count: memorySuggestionOmittedContextCount })
                      : null,
                  ].filter(Boolean).join(" / ")}
                </div>
              )}
              {memorySuggestionOmittedContextPreview && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryOmittedPreview")}: </span>
                  {memorySuggestionOmittedContextPreview}
                </div>
              )}
              {memorySuggestionOmittedAutoSummary && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryOmittedAutoSummary")}: </span>
                  {memorySuggestionOmittedAutoSummary}
                </div>
              )}
              {memorySuggestionOmittedModelSummary && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryOmittedModelSummary")}: </span>
                  {memorySuggestionOmittedModelSummary}
                </div>
              )}
              {memorySuggestionRecoveryObservationPreview && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryRecoveryObservations")}: </span>
                  {memorySuggestionRecoveryObservationCount !== null
                    ? `${memorySuggestionRecoveryObservationCount}: ${memorySuggestionRecoveryObservationPreview}`
                    : memorySuggestionRecoveryObservationPreview}
                </div>
              )}
              {memorySuggestionRecoveredContextDigest && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryRecoveredContextDigest")}: </span>
                  {memorySuggestionRecoveredContextDigest}
                </div>
              )}
              {memorySuggestionDuplicateMemoryId && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.memoryDuplicate")}: </span>
                  {memorySuggestionDuplicateMemoryId}
                </div>
              )}
              {memorySuggestionSourceFingerprint && (
                <div className="mt-0.5 truncate">
                  <span className="font-medium">{t("chat.agentTrace.memorySourceFingerprint")}: </span>
                  {memorySuggestionSourceFingerprint}
                </div>
              )}
            </div>
          )}
          {hasMemoryReadAudit && (
            <div className="mt-1 rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[10px] leading-relaxed text-violet-900 dark:text-violet-100">
              <div className="font-medium">{t("chat.agentTrace.memoryRead")}</div>
              <div className="text-violet-900/80 dark:text-violet-100/80">
                {t("chat.agentTrace.memoryReadSummary", { count: memoryCount ?? 0 })}
              </div>
              {memoryIdsPreview && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryIds")}: </span>
                  {memoryIdsPreview}
                </div>
              )}
              {memoryRankedPreview && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryRanking")}: </span>
                  {memoryRankedPreview}
                </div>
              )}
              {memoryLifecycleSummary && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.memoryLifecycle")}: </span>
                  {memoryLifecycleSummary}
                </div>
              )}
              {memoryLifecyclePreview && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryLifecycleReview")}: </span>
                  {memoryLifecyclePreview}
                </div>
              )}
              {memoryRankingQueryPreview && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryRankingQuery")}: </span>
                  {memoryRankingQueryPreview}
                </div>
              )}
              {memoryQueryScopes && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.memoryScopes")}: </span>
                  {memoryQueryScopes}
                </div>
              )}
              {(memoryQueryWorkspaceKey || memoryQueryProjectKey || memoryQueryConversationId) && (
                <div className="mt-0.5 line-clamp-2">
                  <span className="font-medium">{t("chat.agentTrace.memoryFilters")}: </span>
                  {[
                    memoryQueryWorkspaceKey ? `workspace=${memoryQueryWorkspaceKey}` : null,
                    memoryQueryProjectKey ? `project=${memoryQueryProjectKey}` : null,
                    memoryQueryConversationId ? `conversation=${memoryQueryConversationId}` : null,
                  ].filter(Boolean).join(" / ")}
                </div>
              )}
              {memoryQueryLimit !== null && (
                <div className="mt-0.5">
                  <span className="font-medium">{t("chat.agentTrace.memoryLimit")}: </span>
                  {memoryCandidateCount !== null ? `${memoryCount ?? 0}/${memoryCandidateCount} / ${memoryQueryLimit}` : memoryQueryLimit}
                </div>
              )}
            </div>
          )}
          {omittedContextCount !== null && omittedContextCount > 0 && (
            <div className="mt-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] leading-relaxed text-amber-800 dark:text-amber-200">
              <div className="font-medium">{t("chat.agentTrace.omittedContext")}</div>
              <div>
                {t("chat.agentTrace.omittedContextSummary", {
                  count: omittedContextCount,
                  tokens: omittedContextTokens ?? 0,
                })}
              </div>
              {omittedContextPreview && (
                <div className="mt-0.5 text-amber-900/80 dark:text-amber-100/80">
                  {omittedContextPreview}
                </div>
              )}
              {omittedContextAutoSummary && (
                <div className="mt-0.5 line-clamp-2 text-amber-900/80 dark:text-amber-100/80">
                  <span className="font-medium">{t("chat.agentTrace.omittedAutoSummary")}: </span>
                  {omittedContextAutoSummary}
                </div>
              )}
              {(omittedContextModelSummary || omittedContextModelSummaryStatus || omittedContextModelSummaryWarning) && (
                <div className="mt-0.5 line-clamp-2 text-amber-900/80 dark:text-amber-100/80">
                  <span className="font-medium">{t("chat.agentTrace.omittedModelSummary")}: </span>
                  {[omittedContextModelSummaryStatus, omittedContextModelSummary, omittedContextModelSummaryWarning]
                    .filter((value): value is string => Boolean(value))
                    .join(" / ")}
                </div>
              )}
              {(omittedContextModelSummaryQualityStatus || omittedContextModelSummaryQualitySummary) && (
                <div className="mt-0.5 line-clamp-2 text-amber-900/80 dark:text-amber-100/80">
                  <span className="font-medium">{t("chat.agentTrace.omittedModelSummaryQuality")}: </span>
                  {[
                    omittedContextModelSummaryQualityStatus,
                    omittedContextModelSummaryQualityScore !== null ? `${omittedContextModelSummaryQualityScore}` : null,
                    omittedContextModelSummaryQualitySummary,
                  ].filter(Boolean).join(" / ")}
                </div>
              )}
              {omittedContextSemanticPreview && (
                <div className="mt-0.5 line-clamp-2 text-amber-900/80 dark:text-amber-100/80">
                  {omittedContextSemanticPreview}
                </div>
              )}
              {omittedContextRecoveryHints && (
                <div className="mt-0.5 line-clamp-2 text-amber-900/80 dark:text-amber-100/80">
                  {omittedContextRecoveryHints}
                </div>
              )}
              {omittedContextRecoveryPriority && (
                <div className="mt-0.5 line-clamp-2 text-amber-900/80 dark:text-amber-100/80">
                  <span className="font-medium">{t("chat.agentTrace.omittedRecoveryPriority")}: </span>
                  {omittedContextRecoveryPriority}
                </div>
              )}
              {omittedContextRecoveryPlan && (
                <div className="mt-0.5 line-clamp-2 text-amber-900/80 dark:text-amber-100/80">
                  <span className="font-medium">{t("chat.agentTrace.omittedRecoveryPlan")}: </span>
                  {omittedContextRecoveryPlan}
                </div>
              )}
            </div>
          )}
          {event.tool && (
            <div className="mt-1 rounded border border-border/40 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">{event.tool.toolName}</span>
              <span> / {event.tool.capability}</span>
              {event.tool.argumentsPreview && (
                <span> / {event.tool.argumentsPreview}</span>
              )}
            </div>
          )}
          {event.targetPath && (
            <div className="mt-1 truncate text-[10px] text-muted-foreground">
              {event.targetPath}
            </div>
          )}
          {resultPreview && !hasRestoreAudit && !hasResultSchemaAudit && (
            <div className="mt-1 line-clamp-2 rounded border border-border/40 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              {resultPreview}
            </div>
          )}
          {hasResultSchemaAudit && (
            <ToolResultInspector
              schemaVersion={resultSchemaVersion}
              status={resultStatus}
              summary={resultSummary}
              preview={resultPreview}
              metrics={resultMetricsPreview}
              artifacts={resultArtifactsPreview}
              diagnostics={resultDiagnosticsPreview}
            />
          )}
          {event.error && (
            <div className="mt-1 rounded border border-destructive/20 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
              {event.error}
              {(errorCategory || errorStage || errorRecoveryHint) && (
                <div className="mt-1 text-destructive/80">
                  {[
                    errorCategory ? `${t("chat.agentTrace.errorCategory")}: ${errorCategory}` : null,
                    errorStage ? `${t("chat.agentTrace.errorStage")}: ${errorStage}` : null,
                    errorRecoveryHint ? `${t("chat.agentTrace.errorRecovery")}: ${errorRecoveryHint}` : null,
                  ].filter(Boolean).join(" / ")}
                </div>
              )}
            </div>
          )}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t("chat.agentTrace.details")}
            </button>
          )}
          {expanded && hasDetails && (
            <div className="mt-1 space-y-1 rounded border border-border/40 bg-muted/20 p-2 text-[10px] text-muted-foreground">
              {event.evidenceRefs?.length ? (
                <div>{t("chat.evidenceCount", { count: event.evidenceRefs.length })}</div>
              ) : null}
              {hasToolContract && (
                <div className="rounded border border-border/40 bg-background/60 p-2">
                  <div className="font-medium text-foreground">{t("chat.agentTrace.toolContract")}</div>
                  {(toolLabel || toolDescription) && (
                    <div className="mt-0.5 whitespace-pre-wrap break-words">
                      {toolLabel && <span className="font-medium text-foreground">{toolLabel}</span>}
                      {toolLabel && toolDescription ? <span> · </span> : null}
                      {toolDescription}
                    </div>
                  )}
                  {toolArgsSummary && (
                    <div className="mt-0.5 whitespace-pre-wrap break-words">
                      <span className="font-medium text-foreground">{t("chat.agentTrace.toolArguments")}: </span>
                      {toolArgsSummary}
                    </div>
                  )}
                  {toolResultSummary && (
                    <div className="mt-0.5 whitespace-pre-wrap break-words">
                      <span className="font-medium text-foreground">{t("chat.agentTrace.resultContract")}: </span>
                      {toolResultSummary}
                    </div>
                  )}
                </div>
              )}
              {event.tool?.argumentsPreview && (
                <div>
                  <div className="font-medium text-foreground">{t("chat.agentTrace.arguments")}</div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words">{event.tool.argumentsPreview}</div>
                </div>
              )}
              {metadataForDetails && Object.keys(metadataForDetails).length > 0 && (
                <div>
                  <div className="font-medium text-foreground">{t("chat.agentTrace.metadata")}</div>
                  <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-1">
                    {formatMetadata(metadataForDetails)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentPlanPanel({ plan }: { plan: AgentPlanView }) {
  const { t } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasPlannerDetails = Boolean(plan.plannerPromptPreview || plan.plannerRawOutputPreview);

  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-background/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {t("chat.agentTrace.plan")}
        </div>
        <div className="flex items-center gap-1">
          {plan.source && (
            <span className="rounded-full border border-border/60 bg-background/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {t("chat.agentTrace.planSource", { source: plan.source })}
            </span>
          )}
          {plan.warningCount > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-300">
              {t("chat.agentTrace.planWarnings", { count: plan.warningCount })}
            </span>
          )}
        </div>
      </div>
      {plan.warnings.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
          {plan.warnings.join(" ")}
        </div>
      )}
      {hasPlannerDetails && (
        <div className="rounded border border-border/50 bg-background/70 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            aria-expanded={detailsOpen}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {t("chat.agentTrace.plannerDetails")}
          </button>
          {detailsOpen && (
            <div className="mt-1 space-y-2 text-[10px] text-muted-foreground">
              {plan.plannerPromptPreview && (
                <div>
                  <div className="font-medium text-foreground">{t("chat.agentTrace.plannerPrompt")}</div>
                  <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2">
                    {plan.plannerPromptPreview}
                  </pre>
                </div>
              )}
              {plan.plannerRawOutputPreview && (
                <div>
                  <div className="font-medium text-foreground">{t("chat.agentTrace.plannerRawOutput")}</div>
                  <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2">
                    {plan.plannerRawOutputPreview}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {plan.steps.length > 0 ? (
        <div className="space-y-1">
          {plan.steps.map((step) => (
            <div key={step.id} className="rounded border border-border/50 bg-background/70 px-2 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-foreground">{step.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    <span>{step.id}</span>
                    {step.toolName && <span>{step.toolName}</span>}
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]", planStepTone(step.status))}>
                  {step.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-border/50 bg-background/60 px-2 py-2 text-[11px] text-muted-foreground">
          {t("chat.agentTrace.emptyPlan")}
        </div>
      )}
    </div>
  );
}

function AgentRunSummaryPanel({ summary }: { summary: AgentSessionAuditViewModel }) {
  const { t } = useI18n();
  const items = [
    summary.workflowLabel
      ? { key: "workflow", label: t("chat.agentTrace.summary.workflow"), value: summary.workflowLabel }
      : null,
    {
      key: "plan",
      label: t("chat.agentTrace.summary.plan"),
      value: `${summary.plan.completedStepCount}/${summary.plan.stepCount}`,
    },
    {
      key: "tools",
      label: t("chat.agentTrace.summary.tools"),
      value: `${summary.toolCallCount}/${summary.uniqueToolCount}`,
    },
    {
      key: "evidence",
      label: t("chat.agentTrace.summary.evidence"),
      value: String(summary.evidenceCount),
    },
    {
      key: "approvals",
      label: t("chat.agentTrace.summary.approvals"),
      value: `${summary.completedApprovalCount}/${summary.approvalCount}`,
      detail: summary.pendingApprovalCount > 0
        ? t("chat.agentTrace.summary.pending", { count: summary.pendingApprovalCount })
        : null,
    },
    summary.omittedContextCount > 0
      ? {
          key: "omitted",
          label: t("chat.agentTrace.summary.omitted"),
          value: String(summary.omittedContextCount),
          detail: t("chat.agentTrace.summary.tokens", { count: summary.omittedContextTokens }),
        }
      : null,
    summary.memorySuggestionCount > 0
      ? {
          key: "memory",
          label: t("chat.agentTrace.summary.memory"),
          value: String(summary.memorySuggestionCount),
        }
      : null,
  ].filter((item): item is { key: string; label: string; value: string; detail?: string | null } => Boolean(item));

  return (
    <div className="rounded border border-border/60 bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("chat.agentTrace.summary.title")}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.key} className="rounded border border-border/40 bg-muted/20 px-2 py-1">
            <div className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
            <div className="mt-0.5 truncate text-[11px] font-medium text-foreground">{item.value}</div>
            {item.detail && (
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.detail}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentLineagePanel({
  lineage,
  onSelectSession,
}: {
  lineage: AgentLineageView;
  onSelectSession: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("chat.agentTrace.lineage")}
      </div>
      {lineage.sourceSessionId && (
        <div className="rounded border border-border/50 bg-background/70 px-2 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("chat.agentTrace.continuedFrom")}
          </div>
          <button
            type="button"
            onClick={() => onSelectSession(lineage.sourceSessionId!)}
            className="mt-0.5 block max-w-full truncate text-left text-[11px] font-medium text-foreground hover:underline"
          >
            {lineage.sourceSession?.title ?? lineage.sourceSessionId}
          </button>
          {lineage.sourceCompactionId && (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{lineage.sourceCompactionId}</div>
          )}
          {lineage.sourceSummary && (
            <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
              {lineage.sourceSummary}
            </div>
          )}
        </div>
      )}
      {lineage.childSessions.length > 0 && (
        <div className="rounded border border-border/50 bg-background/70 px-2 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("chat.agentTrace.continuedBy")}
          </div>
          <div className="mt-1 grid gap-1">
            {lineage.childSessions.slice(0, 4).map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onSelectSession(child.id)}
                className="truncate text-left text-[11px] text-foreground hover:underline"
              >
                {child.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildCompactionContinuationPrompt(session: AgentSession, compaction: AgentSession["compactions"][number]): string {
  const sourceKinds = compaction.sourceEventKinds.length > 0
    ? compaction.sourceEventKinds.join(", ")
    : "none";
  const evidence = compaction.evidenceRefs.length > 0
    ? compaction.evidenceRefs.slice(0, 6).map((ref) => `- ${ref.label} (${ref.locator})`).join("\n")
    : "- none";

  return [
    `Continue the Research Agent session "${session.title}".`,
    `Original task: ${session.task}`,
    `Session id: ${session.id}`,
    `Compaction summary: ${compaction.summary}`,
    `Compacted events: ${compaction.compactedEventCount}`,
    `Retained events: ${compaction.retainedEventIds.length}`,
    `Compacted source kinds: ${sourceKinds}`,
    "Use the retained trace, evidence, and current workspace context to continue from this point. Do not repeat completed work unless needed for verification.",
    "Evidence preserved from compacted trace:",
    evidence,
  ].join("\n");
}

function AgentCompactionPanel({ session }: { session: AgentSession }) {
  const { t } = useI18n();
  const fillContinuationPrompt = (compaction: AgentSession["compactions"][number]) => {
    useAiChatStore.getState().setOpen(true);
    useAiChatStore.getState().setComposerDraft({
      text: buildCompactionContinuationPrompt(session, compaction),
      mode: "agent",
      continuation: {
        sourceSessionId: session.id,
        compactionId: compaction.id,
        sourceSummary: compaction.summary,
      },
    });
    toast.success(t("chat.agentTrace.continuationFilled"));
  };
  const copyContinuationPrompt = async (compaction: AgentSession["compactions"][number]) => {
    try {
      await navigator.clipboard.writeText(buildCompactionContinuationPrompt(session, compaction));
      toast.success(t("chat.agentTrace.continuationCopied"));
    } catch (error) {
      toast.error(t("chat.agentTrace.continuationCopyFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (!session.compactions.length) {
    return null;
  }

  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("chat.agentTrace.compactions")}
      </div>
      {session.compactions.map((compaction) => (
        <div key={compaction.id} className="rounded border border-border/50 bg-background/70 px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-[11px] leading-relaxed text-foreground">{compaction.summary}</div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => fillContinuationPrompt(compaction)}
                className="rounded border border-primary/30 bg-primary/10 p-1 text-primary hover:bg-primary/15"
                title={t("chat.agentTrace.fillContinuationPrompt")}
                aria-label={t("chat.agentTrace.fillContinuationPrompt")}
              >
                <PlayCircle className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void copyContinuationPrompt(compaction)}
                className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={t("chat.agentTrace.copyContinuationPrompt")}
                aria-label={t("chat.agentTrace.copyContinuationPrompt")}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span>{t("chat.agentTrace.compactedEvents", { count: compaction.compactedEventCount })}</span>
            <span>{t("chat.agentTrace.retainedEvents", { count: compaction.retainedEventIds.length })}</span>
            <span>{t("chat.evidenceCount", { count: compaction.evidenceRefs.length })}</span>
          </div>
          {compaction.sourceEventKinds.length > 0 && (
            <div className="mt-1 text-[10px] text-muted-foreground/80">
              {t("chat.agentTrace.sourceKinds")}: {compaction.sourceEventKinds.join(", ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AgentSessionButton({
  session,
  selected,
  onClick,
}: {
  session: AgentSession;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const approvals = summarizePendingApprovals(session);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full rounded border px-2 py-1.5 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/5"
          : "border-border/50 bg-background/60 hover:bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-foreground">{session.title}</span>
        <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]", statusTone(session.status))}>
          {t(statusLabelKey(session.status))}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{session.profile}</span>
        <span>{t("chat.agentTrace.eventCount", { count: session.trace.length })}</span>
        {approvals > 0 && <span>{t("chat.agentTrace.pendingApprovals", { count: approvals })}</span>}
      </div>
    </button>
  );
}

function PendingApprovalCard({
  approval,
  busy,
  onApprove,
  onReject,
  readOnly = false,
}: {
  approval: AgentPendingApproval;
  busy: boolean;
  onApprove: (approval: AgentPendingApproval) => void;
  onReject: (approval: AgentPendingApproval) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const toolTitle = approval.toolLabel ?? approval.toolName;
  const approvalArgs = approval.request.args;
  const approvalCode = approvalArgs && typeof approvalArgs === "object" && "code" in approvalArgs
    ? (approvalArgs as { code?: unknown }).code
    : null;
  const isCodingQaApproval = approval.toolLabel === "Approval-gated QA Runner" ||
    (approval.toolName === "runner.runCode" && typeof approvalCode === "string" && approvalCode.includes("Coding QA Runner Plan"));
  const hasToolContract = Boolean(
    approval.toolDescription ||
    approval.toolArgsSummary ||
    approval.toolResultSummary,
  );

  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-foreground">{toolTitle}</span>
            <span className="rounded-full border border-amber-500/30 bg-background/70 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-300">
              {approval.capability}
            </span>
            <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px]", approvalStatusTone(approval.status))}>
              {t(approvalStatusLabelKey(approval.status))}
            </span>
          </div>
          {approval.toolLabel && approval.toolLabel !== approval.toolName && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">{approval.toolName}</div>
          )}
          {hasToolContract && (
            <div className="mt-1 rounded border border-border/40 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
              {approval.toolDescription && (
                <div className="whitespace-pre-wrap break-words">{approval.toolDescription}</div>
              )}
              {approval.toolArgsSummary && (
                <div className="mt-0.5 whitespace-pre-wrap break-words">
                  <span className="font-medium text-foreground">{t("chat.agentTrace.toolArguments")}: </span>
                  {approval.toolArgsSummary}
                </div>
              )}
              {approval.toolResultSummary && (
                <div className="mt-0.5 whitespace-pre-wrap break-words">
                  <span className="font-medium text-foreground">{t("chat.agentTrace.resultContract")}: </span>
                  {approval.toolResultSummary}
                </div>
              )}
            </div>
          )}
          {approval.argumentsPreview && (
            <div className="mt-1 line-clamp-3 rounded border border-border/40 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
              <div className="font-medium text-foreground">{t("chat.agentTrace.arguments")}</div>
              {approval.argumentsPreview}
            </div>
          )}
          {approval.resultPreview && (
            <div className="mt-1 line-clamp-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[10px] text-emerald-700 dark:text-emerald-300">
              <div className="font-medium">{t("chat.agentTrace.resultPreview")}</div>
              {approval.resultPreview}
            </div>
          )}
          {approval.error && (
            <div className="mt-1 line-clamp-3 rounded border border-destructive/20 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
              {approval.error}
            </div>
          )}
          {isCodingQaApproval && (
            <a
              href="/agent-protocol#qa-evidence"
              className="mt-1 inline-flex rounded border border-border/60 bg-background/70 px-2 py-1 text-[10px] font-medium text-primary hover:bg-accent"
            >
              Open QA evidence import
            </a>
          )}
        </div>
        {!readOnly && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => onApprove(approval)}
              disabled={busy}
              className="rounded border border-emerald-500/30 bg-emerald-500/10 p-1 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
              title={t("chat.agentTrace.approve")}
              aria-label={t("chat.agentTrace.approve")}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => onReject(approval)}
              disabled={busy}
              className="rounded border border-destructive/30 bg-destructive/10 p-1 text-destructive hover:bg-destructive/20 disabled:opacity-50"
              title={t("chat.agentTrace.reject")}
              aria-label={t("chat.agentTrace.reject")}
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentTracePanel({
  runCode = runCodeWithWorkspaceRunner,
}: {
  runCode?: AgentToolExecutionOptions["runCode"];
} = {}) {
  const { t } = useI18n();
  const sessions = useAgentSessionStore((state) => state.sessions);
  const activeSessionId = useAgentSessionStore((state) => state.activeSessionId);
  const focusTarget = useAgentSessionStore((state) => state.focusTarget);
  const setActiveSession = useAgentSessionStore((state) => state.setActiveSession);
  const focusSession = useAgentSessionStore((state) => state.focusSession);
  const consumeFocusTarget = useAgentSessionStore((state) => state.consumeFocusTarget);
  const cancelSession = useAgentSessionStore((state) => state.cancelSession);
  const deleteSession = useAgentSessionStore((state) => state.deleteSession);
  const loadSessions = useAgentSessionStore((state) => state.loadSessions);
  const [expanded, setExpanded] = useState(false);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [focusedTraceSection, setFocusedTraceSection] = useState<"approvals" | null>(null);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (sessions.length > 0) {
      setExpanded(true);
    }
  }, [sessions.length]);

  useEffect(() => {
    if (focusTarget === "trace") {
      setExpanded(true);
      consumeFocusTarget("trace");
    }
  }, [consumeFocusTarget, focusTarget]);

  const activeSession = useMemo(() => (
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null
  ), [activeSessionId, sessions]);

  const reviewQueue = useMemo(
    () => buildAgentReviewQueueViewModel(sessions, activeSession?.id ?? activeSessionId),
    [activeSession?.id, activeSessionId, sessions],
  );

  if (sessions.length === 0) {
    return null;
  }

  const pendingApprovals = reviewQueue.activeSessionPendingApprovalCount;
  const pendingApprovalItems = activeSession
    ? (activeSession.pendingApprovals ?? []).filter((approval) => approval.status === "pending")
    : [];
  const processedApprovalItems = activeSession
    ? (activeSession.pendingApprovals ?? [])
        .filter((approval) => approval.status !== "pending")
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, 3)
    : [];
  const runSummaryView = activeSession ? buildAgentSessionAuditViewModel(activeSession) : null;
  const runReportView = activeSession && runSummaryView
    ? buildAgentRunReportViewModel(activeSession, runSummaryView, reviewQueue)
    : null;
  const planView = activeSession ? derivePlanView(activeSession) : null;
  const lineageView = activeSession ? deriveLineageView(activeSession, sessions) : null;

  const handleApprove = async (approval: AgentPendingApproval) => {
    setBusyApprovalId(approval.id);
    try {
      const result = await approveAgentToolRequest(approval.id, {
        approvalNote: "Approved from Agent Trace panel.",
        runCode,
      });
      if (result.status === "failed" || result.status === "denied") {
        toast.error(t("chat.agentTrace.approveFailed"), {
          description: result.error,
        });
      } else if (result.status === "completed" && activeSession && isResearchAgentSession(activeSession)) {
        reconcileResearchAgentPendingApprovals({
          sessionId: activeSession.id,
          now: Date.now(),
        });
      }
    } catch (error) {
      toast.error(t("chat.agentTrace.approveFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyApprovalId(null);
    }
  };

  const handleReject = (approval: AgentPendingApproval) => {
    try {
      rejectAgentToolRequest(approval.id, "User rejected the tool request from Agent Trace.");
    } catch (error) {
      toast.error(t("chat.agentTrace.rejectFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCopyDebugBundle = async (session: AgentSession) => {
    try {
      const bundle = buildAgentSessionDebugBundle(session);
      await navigator.clipboard.writeText(serializeAgentSessionDebugBundle(bundle));
      toast.success(t("chat.agentTrace.debugBundleCopied"));
    } catch (error) {
      toast.error(t("chat.agentTrace.debugBundleCopyFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="border-t border-border bg-background/95">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls="agent-trace-panel-body"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{t("chat.agentTrace.title")}</span>
          {activeSession && (
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", statusTone(activeSession.status))}>
              {t(statusLabelKey(activeSession.status))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{t("chat.agentTrace.sessions", { count: sessions.length })}</span>
          {pendingApprovals > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
              {t("chat.agentTrace.pendingApprovals", { count: pendingApprovals })}
            </span>
          )}
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>
      {expanded && activeSession && (
        <div id="agent-trace-panel-body" className="max-h-72 space-y-3 overflow-y-auto border-t border-border/60 px-3 py-3">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("chat.agentTrace.recentRuns")}
            </div>
            <div className="grid gap-1">
              {sessions.slice(0, 5).map((session) => (
                <AgentSessionButton
                  key={session.id}
                  session={session}
                  selected={session.id === activeSession.id}
                  onClick={() => setActiveSession(session.id)}
                />
              ))}
            </div>
          </div>

          <div className="rounded border border-border/60 bg-background/60 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">{activeSession.title}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {activeSession.task}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <span>{activeSession.profile}</span>
                  <span>{t("chat.evidenceCount", { count: activeSession.evidenceRefs.length })}</span>
                  <span>{t("chat.agentTrace.eventCount", { count: activeSession.trace.length })}</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => void handleCopyDebugBundle(activeSession)}
                  className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                  title={t("chat.agentTrace.copyDebugBundle")}
                  aria-label={t("chat.agentTrace.copyDebugBundle")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {(activeSession.status === "running" || activeSession.status === "waiting_approval") && (
                  <button
                    type="button"
                    onClick={() => cancelSession(activeSession.id)}
                    className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                    title={t("chat.agentTrace.cancel")}
                    aria-label={t("chat.agentTrace.cancel")}
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteSession(activeSession.id)}
                  className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
                  title={t("chat.agentTrace.delete")}
                  aria-label={t("chat.agentTrace.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {runSummaryView && <AgentRunSummaryPanel summary={runSummaryView} />}
          {runReportView && (
            <AgentRunReport
              report={runReportView}
              onAction={(action) => {
                if (action.kind === "review_memory") {
                  setFocusedTraceSection(null);
                  focusAgentSession({ focusSession }, runReportView.sessionId, "memory");
                  return;
                }
                if (action.kind === "review_approvals") {
                  setExpanded(true);
                  setFocusedTraceSection("approvals");
                  return;
                }
                setFocusedTraceSection(null);
                setExpanded(true);
              }}
            />
          )}
          {lineageView && <AgentLineagePanel lineage={lineageView} onSelectSession={setActiveSession} />}

          {pendingApprovalItems.length > 0 && (
            <div
              data-testid="agent-trace-pending-approvals"
              data-focused={focusedTraceSection === "approvals" ? "true" : undefined}
              className={cn(
                "space-y-1.5 rounded p-1",
                focusedTraceSection === "approvals" && "border border-amber-500/40 bg-amber-500/5",
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("chat.agentTrace.pendingApprovalTitle")}
              </div>
              {pendingApprovalItems.map((approval) => (
                <PendingApprovalCard
                  key={approval.id}
                  approval={approval}
                  busy={busyApprovalId === approval.id}
                  onApprove={(item) => void handleApprove(item)}
                  onReject={handleReject}
                />
              ))}
            </div>
          )}

          {processedApprovalItems.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("chat.agentTrace.approvalResultsTitle")}
              </div>
              {processedApprovalItems.map((approval) => (
                <PendingApprovalCard
                  key={approval.id}
                  approval={approval}
                  busy={false}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  readOnly
                />
              ))}
            </div>
          )}

          {planView && <AgentPlanPanel plan={planView} />}

          <AgentCompactionPanel session={activeSession} />

          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("chat.agentTrace.timeline")}
            </div>
            {activeSession.trace.length > 0 ? (
              activeSession.trace.map((event) => (
                <AgentTraceEventRow key={event.id} event={event} />
              ))
            ) : (
              <div className="rounded border border-border/50 bg-background/60 px-2 py-3 text-center text-[11px] text-muted-foreground">
                {t("chat.agentTrace.emptyTimeline")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
