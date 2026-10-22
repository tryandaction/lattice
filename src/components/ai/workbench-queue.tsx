"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileOutput, FolderPen, GitCompareArrows, ListTodo, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { useAiChatStore, type ChatMessage } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileSystem } from "@/hooks/use-file-system";
import { executeUserApprovedAgentTool } from "@/lib/ai/agent-tool-broker";
import { aiOrchestrator } from "@/lib/ai/orchestrator";
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
import { createWorkspaceWriteGuard } from '@/lib/ai/workspace-write-guard';
import { preparePlannedFileDraft } from '@/lib/ai/workspace-file-task';
import { initKeyStorage } from '@/lib/ai/key-storage';
import { useAiProviderProfileStore } from '@/stores/ai-provider-profile-store';
import { routeModel } from '@/lib/ai/model-router';
import { effectiveOutputTokenCeiling } from '@/lib/ai/output-budget';
import { buildCodingProposalViewModel, type CodingProposalViewModel } from "@/lib/ai/coding-proposal-view-model";
import type { AiDraftArtifact, AiDraftWriteMode, AiTaskProposal, EvidenceRef, SelectionAiOrigin } from "@/lib/ai/types";
import { buildAiResultViewModel } from "@/lib/ai/result-view-model";
import { toRuntimeSettings } from "./ai-chat-context";
import { DiffPreview } from './diff-preview';
import { getCloudWorkspaceSnapshot, setCloudWorkspaceResource } from '@/lib/cloud-workspace-host';
import { applyReviewedCloudPdfChildProposal, cloudPdfChildProposalApproval } from '@/lib/ai/lattice-skills/cloud-pdf-child-skill';
import { applyReviewedCloudFileProposal, cloudFileProposalApproval } from '@/lib/ai/harness/cloud-file-proposal';

export async function createWorkbenchDraftWithTrace(input: {
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

export async function createWorkbenchProposalWithTrace(input: {
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

function MessageWorkbenchActions({
  message,
  filePath,
  contentForFile,
}: {
  message: ChatMessage;
  filePath?: string;
  contentForFile?: string;
}) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const [draftSaved, setDraftSaved] = useState(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalDone, setProposalDone] = useState(false);
  const hasDraftAction = (message.followUpActions ?? []).some((action) => action.kind === "create_draft");
  const hasProposalAction = (message.followUpActions ?? []).some((action) => action.kind === "propose_task");

  const handleCreateDraft = useCallback(async () => {
    try {
      await createWorkbenchDraftWithTrace({
        draft: {
          type: message.draftSuggestion?.type ?? "paper_note",
          templateId: message.draftSuggestion?.templateId,
          title: message.draftSuggestion?.title || `AI Draft ${message.id}`,
          sourceRefs: message.evidenceRefs ?? [],
          content: message.draftSuggestion?.content ?? message.content,
          targetPath: message.draftSuggestion?.targetPath,
          pdfChildTarget: message.draftSuggestion?.pdfChildTarget,
          cloudPdfChildProposal: message.draftSuggestion?.cloudPdfChildProposal,
          ...(message.draftSuggestion?.cloudPdfChildProposal ? { contentFormat: 'raw' as const } : {}),
          writeMode: message.draftSuggestion?.writeMode,
          originMessageId: message.id,
        },
        task: t("ai.chat.workbench.createDraftTask", { messageId: message.id }),
        title: message.draftSuggestion?.title || `AI Draft ${message.id}`,
        evidenceRefs: message.evidenceRefs ?? [],
        approvalNote: t("ai.chat.workbench.createDraftApproval"),
      });
      setDraftSaved(true);
    } catch (error) {
      toast.error(t("ai.chat.workbench.createDraftFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [message, t]);

  const handleProposeTask = useCallback(async () => {
    setProposalBusy(true);
    try {
      const proposal = await aiOrchestrator.proposeTask({
        prompt: message.content,
        filePath,
        content: contentForFile,
        explicitEvidenceRefs: message.evidenceRefs ?? [],
        settings: toRuntimeSettings(settings),
      });
      await createWorkbenchProposalWithTrace({
        proposal,
        task: `Create proposal from message ${message.id}`,
        title: proposal.summary,
        approvalNote: t("ai.chat.workbench.createProposalApproval"),
      });
      setProposalDone(true);
    } catch (error) {
      toast.error(t("ai.chat.workbench.createProposalFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProposalBusy(false);
    }
  }, [contentForFile, filePath, message, settings, t]);

  return (
    <div className="flex items-center gap-2 border-t border-border/50 py-2 first:border-t-0" data-testid="ai-chat-follow-up-actions">
      <div className="min-w-0 flex-1 truncate text-xs text-foreground">
        {buildAiResultViewModel(message).summaryLabel}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {hasDraftAction ? (
          <button
            type="button"
            onClick={() => void handleCreateDraft()}
            data-testid="ai-chat-follow-up-save-draft"
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
            disabled={draftSaved}
          >
            <FileOutput className="h-3 w-3" aria-hidden="true" />
            {draftSaved ? t("chat.workbench.draftSaved") : t("chat.workbench.saveDraft")}
          </button>
        ) : null}
        {hasProposalAction ? (
          <button
            type="button"
            onClick={() => void handleProposeTask()}
            data-testid="ai-chat-follow-up-generate-proposal"
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
            disabled={proposalBusy || proposalDone}
          >
            <ListTodo className="h-3 w-3" aria-hidden="true" />
            {proposalDone ? t("chat.workbench.proposalReady") : proposalBusy ? t("chat.workbench.generating") : t("chat.workbench.generateProposal")}
          </button>
        ) : null}
      </div>
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

export function SelectionOriginBadge({
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

function CodingProposalList({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "warning" | "danger";
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1 text-[11px] leading-relaxed">
        {items.map((item) => (
          <li
            key={`${title}:${item}`}
            className={cn(
              "break-words border-l pl-2",
              tone === "danger" && "border-destructive/40 text-destructive",
              tone === "warning" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
              tone === "default" && "border-border/70 text-muted-foreground",
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CodingProposalReviewSurface({ view }: { view: CodingProposalViewModel }) {
  const { t } = useI18n();
  const allowedCount = view.qa.allowed.length;
  const suggestedCount = view.qa.suggested.length;
  const rejectedCount = view.qa.rejected.length;

  return (
    <div
      data-testid="coding-proposal-review-surface"
      className="border-y border-sky-500/20 bg-sky-500/5 px-2 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-sky-950 dark:text-sky-50">
          <GitCompareArrows className="h-3.5 w-3.5 shrink-0" />
          <span>{t("chat.workbench.codingReview.title")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-sky-900/80 dark:text-sky-100/80">
          <span className="rounded-full border border-sky-500/25 bg-background/60 px-1.5 py-0.5">
            {t("chat.workbench.codingReview.files", { count: view.targetFiles.length })}
          </span>
          <span className="rounded-full border border-sky-500/25 bg-background/60 px-1.5 py-0.5">
            {t("chat.workbench.codingReview.qa", {
              allowed: allowedCount,
              suggested: suggestedCount,
              rejected: rejectedCount,
            })}
          </span>
        </div>
      </div>

      {view.hasRejectedQaCommands && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{t("chat.workbench.codingReview.rejectedWarning")}</span>
        </div>
      )}

      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <CodingProposalList
          title={t("chat.workbench.codingReview.targetFiles")}
          items={view.targetFiles}
        />
        <CodingProposalList
          title={t("chat.workbench.codingReview.patchPreview")}
          items={view.patchPreview}
        />
        <CodingProposalList
          title={t("chat.workbench.codingReview.risks")}
          items={view.risks}
          tone="warning"
        />
        <CodingProposalList
          title={t("chat.workbench.codingReview.approvalPath")}
          items={view.approvalPath}
        />
      </div>

      {(allowedCount > 0 || suggestedCount > 0 || rejectedCount > 0 || view.qa.executionBoundary.length > 0) && (
        <div className="mt-3 border-t border-sky-500/15 pt-2">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <ListTodo className="h-3 w-3" />
            {t("chat.workbench.codingReview.qaPlan")}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <CodingProposalList
              title={t("chat.workbench.codingReview.allowedQa")}
              items={view.qa.allowed}
            />
            <CodingProposalList
              title={t("chat.workbench.codingReview.suggestedQa")}
              items={view.qa.suggested}
            />
            <CodingProposalList
              title={t("chat.workbench.codingReview.rejectedQa")}
              items={view.qa.rejected}
              tone="danger"
            />
            <CodingProposalList
              title={t("chat.workbench.codingReview.executionBoundary")}
              items={view.qa.executionBoundary}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkbenchQueue({ loadPersisted = true }: { loadPersisted?: boolean } = {}) {
  const { t } = useI18n();
  const { hydratePdfVirtualChildren } = useFileSystem();
  const activeConversation = useAiChatStore((state) => state.getActiveConversation());
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
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const activeContent = useContentCacheStore((state) => {
    if (!activeTab) return null;
    const cached = state.getContent(activeTab.id);
    return typeof cached?.content === "string" ? cached.content : null;
  });
  const [expanded, setExpanded] = useState(() => drafts.some(draft => (draft.contentFormat === 'raw' || draft.cloudPdfChildProposal) && draft.status === 'draft'));
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const preparationController = useRef<AbortController | null>(null);
  useEffect(() => () => preparationController.current?.abort(), [rootHandle]);
  const [expandedProposalIds, setExpandedProposalIds] = useState<string[]>([]);
  const proposalCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const standaloneDrafts = useMemo(
    () => drafts.filter((draft) => !draft.originProposalId),
    [drafts],
  );
  const actionMessages = useMemo(
    () => (activeConversation?.messages ?? []).filter((message) =>
      message.role === "assistant" &&
      !message.isStreaming &&
      Boolean(message.content) &&
      (message.followUpActions?.some((action) => action.kind === "create_draft" || action.kind === "propose_task") ?? false)
    ),
    [activeConversation?.messages],
  );

  useEffect(() => {
    if (loadPersisted) {
      void loadWorkbench();
    }
  }, [loadPersisted, loadWorkbench]);

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
    if (!draft || !draft.cloudPdfChildProposal && !draft.cloudFileProposal && !rootHandle) {
      toast.error(t("chat.workbench.toast.applyDraftUnavailable"), {
        description: t("chat.workbench.toast.workspaceUnavailable"),
      });
      return;
    }

    setBusyDraftId(draftId);
    try {
      if (draft.cloudPdfChildProposal || draft.cloudFileProposal) {
        const provider = getCloudWorkspaceSnapshot().provider;
        const proposal = draft.cloudPdfChildProposal ?? draft.cloudFileProposal!;
        const content = typeof proposal.content === 'string' ? proposal.content : proposal.content.kind === 'text' ? proposal.content.text : undefined;
        if (content === undefined || draft.content !== content || draft.targetPath !== proposal.targetPath || draft.writeMode !== proposal.mode) throw new Error('云提案内容或目标已改变，请重新生成并审查。');
        const isCurrent = () => getCloudWorkspaceSnapshot().provider === provider;
        const result = draft.cloudPdfChildProposal
          ? await applyReviewedCloudPdfChildProposal({ provider, proposal: draft.cloudPdfChildProposal, approval: cloudPdfChildProposalApproval(draft.cloudPdfChildProposal), isCurrent })
          : await applyReviewedCloudFileProposal({ provider, proposal: draft.cloudFileProposal!, approval: cloudFileProposalApproval(draft.cloudFileProposal!), isCurrent });
        const href = `/library?library=${encodeURIComponent(result.libraryId)}&item=${encodeURIComponent(result.itemId)}`;
        markDraftApplied(draftId, href, proposal.mode);
        try {
          if (provider && getCloudWorkspaceSnapshot().provider === provider) {
            const resource = await provider.read(result.libraryId, result.itemId);
            if (getCloudWorkspaceSnapshot().provider === provider) setCloudWorkspaceResource(resource);
          }
        } catch (error) {
          toast.error('云文件已保存，打开结果失败。', { description: error instanceof Error ? error.message : String(error) });
        }
        toast.success(t("chat.workbench.toast.applyDraftSuccess"), { description: href });
        return;
      }
      if (!rootHandle) throw new Error('请重新授权原工作区。');
      const writeMode = draft.writeMode ?? "create";
      const targetPath = draft.targetPath?.trim() || undefined;
      const guard = createWorkspaceWriteGuard(rootHandle);
      const result = await writeDraftArtifactToTarget(rootHandle, draft, {
        beforeWrite: guard.beforeWrite,
        targetPath,
        writeMode,
        workspaceKey: useWorkspaceStore.getState().workspaceIdentity?.workspaceKey ?? useWorkspaceStore.getState().workspaceRootPath ?? rootHandle.name,
      });
      markDraftApplied(draftId, result.path, writeMode);
      try {
        await guard.refresh(result.path, result.handle);
      } catch (error) {
        console.warn('File saved, but open views could not refresh:', error);
      }
      if (result.parentPdfPath) {
        try {
          await hydratePdfVirtualChildren(result.parentPdfPath, { force: true, expand: true });
        } catch (error) {
          console.warn('PDF child saved, but virtual children could not refresh:', error);
        }
      }
      if (useWorkspaceStore.getState().rootHandle === rootHandle) openFileInPane(activePaneId, result.handle, result.path);
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
  }, [activePaneId, drafts, hydratePdfVirtualChildren, markDraftApplied, openFileInPane, rootHandle, t]);

  const handleOpenDraftTarget = useCallback(async (targetPath: string) => {
    if (targetPath.startsWith('/library?')) {
      const params = new URLSearchParams(targetPath.split('?', 2)[1].split('#', 1)[0]);
      const provider = getCloudWorkspaceSnapshot().provider;
      try {
        if (!provider || !params.get('library') || !params.get('item')) throw new Error('云资源需要重新登录并授权。');
        const resource = await provider.read(params.get('library')!, params.get('item')!);
        if (getCloudWorkspaceSnapshot().provider !== provider) throw new Error('云库身份已改变。');
        setCloudWorkspaceResource(resource);
      } catch (error) { toast.error(t("chat.workbench.toast.openDraftFailed"), { description: error instanceof Error ? error.message : String(error) }); }
      return;
    }
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
    if (!proposal || busyProposalId) {
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
    const controller = new AbortController();
    preparationController.current = controller;
    setBusyProposalId(proposalId);
    try {
      for (const draft of draftsToCreate) {
        let prepared = draft as Omit<AiDraftArtifact, 'id' | 'createdAt' | 'status'>;
        if (draft.writeMode !== 'append') {
          if (!rootHandle) throw new Error('请先打开计划文件所属工作区。');
          const guard = createWorkspaceWriteGuard(rootHandle);
          guard.beforeWrite(draft.targetPath!);
          await initKeyStorage();
          await useAiProviderProfileStore.getState().hydrate();
          const profile = useAiProviderProfileStore.getState().getActiveProfile();
          const settings = useSettingsStore.getState().settings;
          if (!settings.aiEnabled) throw new Error('请先启用 AI。');
          if (draft.writeMode === 'update' && profile?.privacy.sendCurrentFile === false) throw new Error('当前连接禁止发送文件内容，请在连接隐私设置中允许后再生成修改。');
          const runtime = toRuntimeSettings(settings, 'agent', profile);
          const selected = routeModel('task_proposal', runtime);
          prepared = await preparePlannedFileDraft({ draft, proposalSummary: proposal.summary, root: rootHandle,
            workspaceKey: useWorkspaceStore.getState().workspaceIdentity?.workspaceKey ?? useWorkspaceStore.getState().workspaceRootPath ?? rootHandle.name,
            signal: controller.signal,
            outputTokenCeiling: effectiveOutputTokenCeiling(runtime.maxTokens, selected.provider.getMaxOutputTokens?.(selected.modelInfo.model)),
            generate: (messages, options) => selected.provider.generate(messages, { ...options, model: selected.modelInfo.model ?? undefined }),
          });
          guard.beforeWrite(draft.targetPath!);
        }
        controller.signal.throwIfAborted();
        await createWorkbenchDraftWithTrace({
          draft: prepared,
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
      if (generatedTargets.length) markProposalDraftTargets(proposalId, generatedTargets);
      toast.error(t("prompt.run.toast.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (preparationController.current === controller) preparationController.current = null;
      setBusyProposalId(null);
    }
  }, [busyProposalId, rootHandle, markProposalDraftTargets, proposals, t, updateProposalStatus]);

  const handleApplyProposalDrafts = useCallback(async (proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (busyProposalId) return;
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
      const guard = createWorkspaceWriteGuard(rootHandle);
      const results = await applyDraftArtifactsToWorkspace(rootHandle, targetDrafts, {
        workspaceKey: useWorkspaceStore.getState().workspaceIdentity?.workspaceKey ?? useWorkspaceStore.getState().workspaceRootPath ?? rootHandle.name,
        beforeWrite: guard.beforeWrite,
      });
      const successes = results.filter((result) => result.ok);
      const failures = results.filter((result) => !result.ok);

      successes.forEach((result) => {
        const draft = targetDrafts.find((item) => item.id === result.draftId);
        if (draft && result.path) {
          markDraftApplied(draft.id, result.path, result.writeMode);
        }
      });
      for (const result of successes) {
        if (result.path && result.handle) {
          try { await guard.refresh(result.path, result.handle); }
          catch (error) { console.warn('File saved, but open views could not refresh:', error); }
        }
        if (!result.parentPdfPath || !result.path) continue;
        try {
          await hydratePdfVirtualChildren(result.parentPdfPath, { force: true, expand: true });
        } catch (error) {
          console.warn('PDF child saved, but virtual children could not refresh:', error);
        }
      }

      const firstSuccess = successes[0];
      if (firstSuccess?.handle && firstSuccess.path && useWorkspaceStore.getState().rootHandle === rootHandle) {
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
  }, [activePaneId, busyProposalId, drafts, hydratePdfVirtualChildren, markDraftApplied, openFileInPane, proposals, rootHandle, t]);

  if (drafts.length === 0 && proposals.length === 0 && actionMessages.length === 0) {
    return null;
  }

  const pendingApprovalCount = proposals.reduce(
    (total, proposal) => total + (proposal.status === "pending"
      ? proposal.requiredApprovals.filter((approval) => !proposal.confirmedApprovals.includes(approval)).length
      : 0),
    0,
  );

  return (
      <div className="bg-background/95" data-testid="workbench-queue">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        data-testid="workbench-queue-toggle"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FolderPen className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{t("chat.workbench.title")}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{t("chat.workbench.drafts", { count: drafts.length })}</span>
          <span>{t("chat.workbench.proposals", { count: proposals.length })}</span>
          {actionMessages.length > 0 ? <span>{actionMessages.length} actions</span> : null}
          {pendingApprovalCount > 0 ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
              {t("chat.workspace.pendingApprovals", { count: pendingApprovalCount })}
            </span>
          ) : null}
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {actionMessages.length > 0 && (
            <div data-testid="workbench-message-actions">
              {actionMessages.map((message) => (
                <MessageWorkbenchActions
                  key={message.id}
                  message={message}
                  filePath={activeTab?.filePath}
                  contentForFile={activeContent ?? undefined}
                />
              ))}
            </div>
          )}
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
                      <div className="truncate text-xs font-medium text-foreground" data-testid="workbench-draft-title">{draft.title}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {draftStatusLabel(draft.status, t)} / {t("chat.evidenceCount", { count: draft.sourceRefs.length })}
                      </div>
                    </div>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {draft.templateId ?? draft.type}
                    </span>
                  </div>
                  {draft.cloudPdfChildProposal && <div className="mt-2 rounded border p-2 text-[11px]" data-testid="workbench-cloud-review-versions">
                    <div>父 PDF：{draft.cloudPdfChildProposal.parent.name}</div>
                    <div>父文件版本：<span>{draft.cloudPdfChildProposal.parent.versionId}</span></div>
                    {draft.cloudPdfChildProposal.child && <div>子文件版本：<span>{draft.cloudPdfChildProposal.child.versionId}</span></div>}
                    <div className="break-all">云库：{draft.cloudPdfChildProposal.parent.libraryId} / 文件：{draft.cloudPdfChildProposal.fileName}</div>
                  </div>}
                  {draft.cloudFileProposal && <div className="mt-2 rounded border p-2 text-[11px]" data-testid="workbench-cloud-review-versions">
                    <div>云文件：{draft.cloudFileProposal.fileName}</div>
                    <div>{draft.cloudFileProposal.mode === 'create' ? '目录版本' : '原文件版本'}：<span>{draft.cloudFileProposal.resource.versionId ?? '已核对目录身份'}</span></div>
                    <div className="break-all">云库：{draft.cloudFileProposal.resource.libraryId}</div>
                  </div>}
                  {draft.contentFormat === 'raw' || draft.cloudPdfChildProposal || draft.cloudFileProposal ? <details open={Boolean(draft.cloudPdfChildProposal || draft.cloudFileProposal)} className="mt-2 text-[11px]" data-testid="workbench-draft-content">
                    <summary className="cursor-pointer text-muted-foreground">{draft.writeMode === 'update' ? '查看修改差异' : '查看完整内容'}</summary>
                    {draft.writeMode === 'update' && typeof draft.fileChange?.expectedContent === 'string'
                      ? <DiffPreview original={draft.fileChange.expectedContent} modified={draft.content} />
                      : <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border p-2">{draft.content || '空文件'}</pre>}
                  </details> : <div className="mt-2 line-clamp-3 text-[11px] text-muted-foreground" data-testid="workbench-draft-content">{draft.content}</div>}
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
                          className="h-8 min-w-0 truncate rounded border border-border/70 bg-background/80 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/70"
                          data-testid="workbench-draft-path"
                          disabled={draft.status === "applied" || draft.writeMode === 'update' || Boolean(draft.cloudPdfChildProposal || draft.cloudFileProposal)}
                        />
                        <select
                          value={draft.writeMode ?? "create"}
                          onChange={(event) =>
                            updateDraftWriteConfig(draft.id, {
                              writeMode: event.target.value as AiDraftWriteMode,
                            })
                          }
                          className="h-8 rounded border border-border/70 bg-background/80 px-2 text-[11px] text-foreground"
                          disabled={draft.status === "applied" || draft.contentFormat === 'raw' || Boolean(draft.cloudPdfChildProposal || draft.cloudFileProposal)}
                        >
                          <option value="create">create</option>
                          <option value="append">append</option>
                          <option value="update">update</option>
                        </select>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {draft.writeMode === 'update' ? '保存前核对原文件版本；文件已变化时会停止写入。' : (draft.writeMode ?? "create") === "append"
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
                    const codingProposalView = buildCodingProposalViewModel(proposal);
                    return (
                      <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="line-clamp-2 break-words text-xs font-medium text-foreground" data-testid="workbench-proposal-title">{proposal.summary}</div>
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
                        aria-label={
                          expandedProposalIds.includes(proposal.id)
                            ? t("chat.workbench.collapseProposal")
                            : t("chat.workbench.expandProposal")
                        }
                        title={
                          expandedProposalIds.includes(proposal.id)
                            ? t("chat.workbench.collapseProposal")
                            : t("chat.workbench.expandProposal")
                        }
                      >
                        {expandedProposalIds.includes(proposal.id)
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  {expandedProposalIds.includes(proposal.id) && (
                    <div className="mt-3 space-y-3">
                      {codingProposalView && (
                        <CodingProposalReviewSurface view={codingProposalView} />
                      )}

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
