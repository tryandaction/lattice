"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { aiOrchestrator } from "@/lib/ai/orchestrator";
import { X, Send, Square, Plus, Trash2, MessageSquare, Copy, Check, GitCompareArrows, Bot, FileText, ShieldCheck, Wand2, ChevronDown, ChevronRight, Link2, FolderPen, FileOutput, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/renderers/markdown-renderer";
import { useI18n } from "@/hooks/use-i18n";
import { MentionAutocomplete } from "./mention-autocomplete";
import { DiffPreview } from "./diff-preview";
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
  toEvidenceNavigationTarget,
  writeDraftArtifactToTarget,
} from "@/lib/ai/workbench-actions";
import type {
  AiDraftArtifactType,
  AiDraftWriteMode,
  AiRuntimeSettings,
  EvidenceRef,
} from "@/lib/ai/types";
import { toast } from "sonner";

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

export function AiChatPanel() {
  const isOpen = useAiChatStore((s) => s.isOpen);
  const setOpen = useAiChatStore((s) => s.setOpen);
  const loadConversations = useAiChatStore((s) => s.loadConversations);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      <ChatHeader onClose={() => setOpen(false)} />
      <ChatMessages />
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

function EvidenceList({ refs }: { refs: EvidenceRef[] }) {
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());

  const handleNavigate = useCallback(async (ref: EvidenceRef) => {
    const success = await navigateLink(toEvidenceNavigationTarget(ref), {
      paneId: activePaneId,
      rootHandle,
      currentFilePath: activeTab?.filePath,
    });

    if (!success) {
      toast.error("无法定位证据", {
        description: ref.locator,
      });
    }
  }, [activePaneId, activeTab?.filePath, rootHandle]);

  if (refs.length === 0) return null;

  return (
    <div className="mt-2 rounded border border-border/60 bg-background/60 p-2">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="h-3 w-3" />
        Evidence
      </div>
      <div className="space-y-1">
        {refs.slice(0, 6).map((ref) => (
          <button
            key={`${ref.kind}:${ref.locator}`}
            onClick={() => void handleNavigate(ref)}
            className="w-full rounded border border-transparent px-2 py-1 text-left text-[11px] leading-relaxed text-muted-foreground hover:border-border/60 hover:bg-accent/50"
            type="button"
          >
            <div className="flex items-center gap-1 font-medium text-foreground">
              <Link2 className="h-3 w-3 text-muted-foreground" />
              <span className="truncate">{ref.label}</span>
            </div>
            <div className="truncate">{ref.locator}</div>
            {ref.preview && (
              <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground/80">{ref.preview}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContextSources({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {labels.slice(0, 6).map((label) => (
        <span
          key={label}
          className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function FollowUpActions({
  messageId,
  content,
  filePath,
  contentForFile,
  evidenceRefs,
  draftSuggestion,
}: {
  messageId: string;
  content: string;
  filePath?: string;
  contentForFile?: string;
  evidenceRefs: EvidenceRef[];
  draftSuggestion?: { type: string; title: string };
}) {
  const createDraft = useAiWorkbenchStore((state) => state.createDraft);
  const addProposal = useAiWorkbenchStore((state) => state.addProposal);
  const settings = useSettingsStore((state) => state.settings);
  const [draftSaved, setDraftSaved] = useState(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalDone, setProposalDone] = useState(false);

  const handleCreateDraft = useCallback(() => {
    createDraft({
      type: (draftSuggestion?.type as AiDraftArtifactType | undefined) ?? "paper_note",
      title: draftSuggestion?.title || `AI Draft ${messageId}`,
      sourceRefs: evidenceRefs,
      content,
    });
    setDraftSaved(true);
  }, [content, createDraft, draftSuggestion?.title, draftSuggestion?.type, evidenceRefs, messageId]);

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
      addProposal(proposal);
      setProposalDone(true);
    } finally {
      setProposalBusy(false);
    }
  }, [addProposal, content, contentForFile, evidenceRefs, filePath, settings]);

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        onClick={handleCreateDraft}
        className="inline-flex items-center gap-1 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-foreground hover:bg-accent"
        disabled={draftSaved}
      >
        <FileText className="h-3 w-3" />
        {draftSaved ? "已保存草稿" : "保存为草稿"}
      </button>
      <button
        onClick={() => void handleProposeTask()}
        className="inline-flex items-center gap-1 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
        disabled={proposalBusy || proposalDone}
      >
        <Wand2 className="h-3 w-3" />
        {proposalDone ? "已生成计划" : proposalBusy ? "生成中..." : "生成整理计划"}
      </button>
    </div>
  );
}

function draftStatusLabel(status: string): string {
  switch (status) {
    case "applied":
      return "已写回";
    case "approved":
      return "已批准";
    case "discarded":
      return "已丢弃";
    default:
      return "草稿";
  }
}

function proposalStatusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "已批准";
    case "discarded":
      return "已拒绝";
    default:
      return "待审批";
  }
}

function WorkbenchPanel() {
  const drafts = useAiWorkbenchStore((state) => state.drafts);
  const proposals = useAiWorkbenchStore((state) => state.proposals);
  const createDraft = useAiWorkbenchStore((state) => state.createDraft);
  const updateDraftStatus = useAiWorkbenchStore((state) => state.updateDraftStatus);
  const updateDraftWriteConfig = useAiWorkbenchStore((state) => state.updateDraftWriteConfig);
  const markDraftApplied = useAiWorkbenchStore((state) => state.markDraftApplied);
  const updateProposalStatus = useAiWorkbenchStore((state) => state.updateProposalStatus);
  const toggleProposalApproval = useAiWorkbenchStore((state) => state.toggleProposalApproval);
  const toggleProposalWriteSelection = useAiWorkbenchStore((state) => state.toggleProposalWriteSelection);
  const markProposalDraftTargets = useAiWorkbenchStore((state) => state.markProposalDraftTargets);
  const clearProposal = useAiWorkbenchStore((state) => state.clearProposal);
  const loadWorkbench = useAiWorkbenchStore((state) => state.loadWorkbench);
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const [expanded, setExpanded] = useState(false);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [expandedProposalIds, setExpandedProposalIds] = useState<string[]>([]);

  useEffect(() => {
    if (drafts.length > 0 || proposals.length > 0) {
      setExpanded(true);
    }
  }, [drafts.length, proposals.length]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  const handleApplyDraft = useCallback(async (draftId: string) => {
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft || !rootHandle) {
      toast.error("无法写回草稿", {
        description: "当前工作区不可写或草稿不存在。",
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
      toast.success("草稿已写回工作区", {
        description: result.path,
      });
    } catch (error) {
      toast.error("草稿写回失败", {
        description: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      setBusyDraftId(null);
    }
  }, [activePaneId, drafts, markDraftApplied, openFileInPane, rootHandle]);

  const handleOpenDraftTarget = useCallback(async (targetPath: string) => {
    const success = await navigateLink(targetPath, {
      paneId: activePaneId,
      rootHandle,
    });
    if (!success) {
      toast.error("无法打开草稿目标", {
        description: targetPath,
      });
    }
  }, [activePaneId, rootHandle]);

  const toggleProposalExpanded = useCallback((proposalId: string) => {
    setExpandedProposalIds((current) =>
      current.includes(proposalId)
        ? current.filter((item) => item !== proposalId)
        : [...current, proposalId]
    );
  }, []);

  const handleCreateProposalDraft = useCallback((proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return;
    }

    createDraft({
      type: "task_plan",
      title: `Plan - ${proposal.summary.slice(0, 80)}`,
      sourceRefs: proposal.sourceRefs,
      content: formatTaskProposalDraftContent(proposal),
      writeMode: "create",
    });
    toast.success("计划已保存为草稿", {
      description: proposal.summary,
    });
  }, [createDraft, proposals]);

  const handleApproveProposal = useCallback((proposalId: string) => {
    updateProposalStatus(proposalId, "approved");
    toast.success("计划已批准");
  }, [updateProposalStatus]);

  const handleDiscardProposal = useCallback((proposalId: string) => {
    updateProposalStatus(proposalId, "discarded");
    toast("计划已标记为拒绝");
  }, [updateProposalStatus]);

  const handleCreateTargetDrafts = useCallback((proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return;
    }

    const draftsToCreate = buildDraftArtifactsFromProposal(proposal);
    if (draftsToCreate.length === 0) {
      toast("没有新的目标草稿可生成", {
        description: "请先勾选 planned writes，或已生成过对应草稿。",
      });
      return;
    }

    const generatedTargets: string[] = [];
    draftsToCreate.forEach((draft) => {
      createDraft(draft);
      if (draft.targetPath) {
        generatedTargets.push(draft.targetPath);
      }
    });

    if (proposal.status === "pending") {
      updateProposalStatus(proposalId, "approved");
    }
    markProposalDraftTargets(proposalId, generatedTargets);
    toast.success(`已生成 ${draftsToCreate.length} 份目标草稿`, {
      description: proposal.summary,
    });
  }, [createDraft, markProposalDraftTargets, proposals, updateProposalStatus]);

  const handleApplyProposalDrafts = useCallback(async (proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal || !rootHandle) {
      toast.error("无法批量写回目标草稿", {
        description: "当前工作区不可写或计划不存在。",
      });
      return;
    }

    const targetDrafts = getProposalTargetDrafts(proposal, drafts);
    if (targetDrafts.length === 0) {
      toast("当前计划还没有生成目标草稿");
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
        toast.success(`已写回 ${successes.length} 份目标草稿`, {
          description: failures.length > 0
            ? `${failures.length} 份草稿写回失败，请逐条检查。`
            : proposal.summary,
        });
      } else {
        toast.error("目标草稿批量写回失败", {
          description: failures[0]?.error ?? "未知错误",
        });
      }
    } finally {
      setBusyProposalId(null);
    }
  }, [activePaneId, drafts, markDraftApplied, openFileInPane, proposals, rootHandle]);

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
          <span>AI Workbench</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{drafts.length} 草稿</span>
          <span>{proposals.length} 计划</span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>
      {expanded && (
        <div className="max-h-64 space-y-3 overflow-y-auto border-t border-border/60 px-3 py-3">
          {drafts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <FileOutput className="h-3 w-3" />
                Drafts
              </div>
              {drafts.map((draft) => (
                <div key={draft.id} className="rounded border border-border/60 bg-background/60 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">{draft.title}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {draftStatusLabel(draft.status)} · {draft.sourceRefs.length} 证据
                      </div>
                    </div>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {draft.type}
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
                          ? "append 需要填写现有 Markdown 目标路径。"
                          : `留空将自动写入 ${buildDraftArtifactDefaultPath(draft)}。`}
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
                        {busyDraftId === draft.id ? "写回中..." : "批准并写回"}
                      </button>
                    )}
                    {draft.status === "applied" && draft.targetPath && (
                      <button
                        type="button"
                        onClick={() => void handleOpenDraftTarget(draft.targetPath!)}
                        className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent"
                      >
                        打开目标
                      </button>
                    )}
                    {draft.status !== "discarded" && (
                      <button
                        type="button"
                        onClick={() => updateDraftStatus(draft.id, "discarded")}
                        className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        丢弃
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
                Proposals
              </div>
              {proposals.map((proposal) => (
                <div key={proposal.id} className="rounded border border-border/60 bg-background/60 p-2">
                  {(() => {
                    const draftSummary = summarizeProposalTargetDrafts(proposal, drafts);
                    return (
                      <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{proposal.summary}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {proposal.steps.length} steps · {proposal.plannedWrites.length} planned writes · {proposal.sourceRefs.length} 证据
                      </div>
                      {proposal.generatedDraftTargets.length > 0 && (
                        <div className="mt-1 text-[10px] text-muted-foreground/80">
                          已生成 {proposal.generatedDraftTargets.length} 份目标草稿
                        </div>
                      )}
                      {draftSummary.total > 0 && (
                        <div className="mt-1 text-[10px] text-muted-foreground/80">
                          目标草稿：待写回 {draftSummary.ready} · 已写回 {draftSummary.applied} · 阻塞 {draftSummary.blocked}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {proposalStatusLabel(proposal.status)}
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
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Steps</div>
                        <div className="space-y-1">
                          {proposal.steps.map((step, index) => (
                            <div key={step.id} className="rounded border border-border/50 px-2 py-1.5 text-[11px]">
                              <div className="font-medium text-foreground">{index + 1}. {step.title}</div>
                              <div className="mt-0.5 text-muted-foreground">{step.description}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Required Approvals</div>
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
                          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Planned Writes</div>
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
                          onClick={() => handleCreateProposalDraft(proposal.id)}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent"
                          disabled={proposal.status === "discarded"}
                        >
                          生成计划草稿
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreateTargetDrafts(proposal.id)}
                          disabled={
                            proposal.status === "discarded" ||
                            !proposal.requiredApprovals.every((approval) => proposal.confirmedApprovals.includes(approval)) ||
                            proposal.approvedWrites.length === 0 ||
                            proposal.plannedWrites
                              .filter((write) => proposal.approvedWrites.includes(write.targetPath))
                              .every((write) => proposal.generatedDraftTargets.includes(write.targetPath))
                          }
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          生成目标草稿
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleApplyProposalDrafts(proposal.id)}
                          disabled={busyProposalId === proposal.id || draftSummary.ready === 0}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          {busyProposalId === proposal.id ? "批量写回中..." : "批量写回目标草稿"}
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
                          批准计划
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscardProposal(proposal.id)}
                          disabled={proposal.status === "discarded"}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                        >
                          拒绝计划
                        </button>
                        <button
                          type="button"
                          onClick={() => clearProposal(proposal.id)}
                          className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                        >
                          关闭
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

function ChatMessages() {
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
              : "bg-muted mr-4"
          )}
        >
          <div className="text-[10px] text-muted-foreground mb-1 uppercase">
            {msg.role === "user" ? t('chat.you') : t('chat.ai')}
          </div>
          {msg.role === "assistant" ? (
            <>
              <div className="text-xs leading-relaxed ai-chat-markdown [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                <MarkdownRenderer content={msg.content} className="text-xs" />
                {msg.isStreaming && <span className="animate-pulse">▊</span>}
              </div>
              {msg.model && (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  <span>{msg.model.providerName}</span>
                  {msg.model.model && <span>· {msg.model.model}</span>}
                  <span>· {msg.model.source === "local" ? "本地模型" : "云模型"}</span>
                </div>
              )}
              <ContextSources labels={(msg.promptContext?.nodes ?? []).map((node) => node.label)} />
              <EvidenceList refs={msg.evidenceRefs ?? []} />
              {msg.usage && (
                <div className="text-[9px] text-muted-foreground/60 mt-1">
                  {msg.usage.totalTokens} tokens ({msg.usage.promptTokens}→{msg.usage.completionTokens})
                </div>
              )}
              {!msg.isStreaming && msg.content && (
                <div className="flex items-center gap-1 mt-1">
                  <CopyMessageButton text={msg.content} />
                  {extractCodeBlocks(msg.content).length > 0 && activeTab && (
                    <button
                      onClick={() => {
                        const blocks = extractCodeBlocks(msg.content);
                        if (blocks.length > 0) {
                          setDiffState(diffState?.msgId === msg.id ? null : { msgId: msg.id, code: blocks[0].code });
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Preview Changes"
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
        </div>
      ))}
    </div>
  );
}

function ChatInput() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
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
  const settings = useSettingsStore((s) => s.settings);
  const activeTab = useWorkspaceStore((s) => s.getActiveTab());
  const rootHandle = useWorkspaceStore((s) => s.rootHandle);
  const getCachedContent = useContentCacheStore((s) => s.getContent);
  const getAnnotationsForFile = useAnnotationStore((s) => s.getAnnotationsForFile);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");

    const historyBeforeSend = getMessagesForApi();

    // Resolve @mentions before sending
    const mentions = parseMentions(text);
    addUserMessage(text); // Show original text in UI
    const msgId = startAssistantMessage();
    const controller = new AbortController();
    setGenerating(true, controller);

    try {
      if (!settings.aiEnabled) {
        setAssistantError(msgId, "AI is disabled. Go to Settings → AI to enable it.");
        return;
      }

      const activeContent = await resolveActiveFileContent(
        activeTab,
        activeTab ? (typeof getCachedContent(activeTab.id)?.content === "string" ? getCachedContent(activeTab.id)?.content as string : null) : null,
      );

      const resolvedMentions = mentions.length > 0 && rootHandle
        ? await resolveMentions(mentions, {
            currentSelection: typeof window !== "undefined" ? window.getSelection()?.toString() ?? "" : "",
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
        mention.evidenceRef ? [mention.evidenceRef] : []
      );

      const annotations = activeTab?.filePath
        ? getAnnotationsForFile(deriveFileId(activeTab.filePath)).map(migrateLegacyAnnotation)
        : [];

      const result = await aiOrchestrator.runChat({
        prompt: text,
        history: historyBeforeSend,
        settings: toRuntimeSettings(settings),
        filePath: activeTab?.filePath,
        content: activeContent,
        references,
        annotations,
        query: text,
        explicitEvidenceRefs: explicitEvidenceRefs.length > 0 ? explicitEvidenceRefs : undefined,
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
    getCachedContent,
    rootHandle,
    getAnnotationsForFile,
    appendToAssistantMessage,
    finishAssistantMessage,
    setAssistantError,
    setAssistantMetadata,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-2 relative">
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          position={mentionPos}
          onSelect={(mention) => {
            // Replace the @query with the selected mention
            const textarea = textareaRef.current;
            if (textarea) {
              const cursorPos = textarea.selectionStart;
              const textBefore = input.slice(0, cursorPos);
              const textAfter = input.slice(cursorPos);
              const atIdx = textBefore.lastIndexOf('@');
              const newText = textBefore.slice(0, atIdx) + mention + ' ' + textAfter;
              setInput(newText);
            }
            setMentionQuery(null);
          }}
          onClose={() => setMentionQuery(null)}
        />
      )}
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
            onClick={handleSend}
            disabled={!input.trim()}
            className="rounded-md bg-primary/10 p-2 text-primary hover:bg-primary/20 disabled:opacity-30 transition-colors"
            title={t('chat.send')}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
