"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Copy, ExternalLink, FileText, RefreshCcw, ShieldCheck } from "lucide-react";
import { navigateLinkDetailed } from "@/lib/link-router/navigate-link";
import type { NavigationResult } from "@/lib/link-router/types";
import { buildCitationContract, canonicalCitationPath } from "@/lib/ai/citation-contract";
import { toEvidenceNavigationTarget } from "@/lib/ai/workbench-actions";
import {
  buildEvidencePanelState,
  buildEvidenceDraftSeedForLeaf,
  buildEvidenceDraftSeedForSelection,
  buildEvidenceProposalPromptForSelection,
} from "@/lib/ai/evidence-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import type { ChatMessage } from "@/stores/ai-chat-store";
import type { PromptTemplate } from "@/lib/prompt/types";
import type { EvidenceRef } from "@/lib/ai/types";
import { toast } from "sonner";
import { buildAiResultViewModel } from "@/lib/ai/result-view-model";
import { buildReferenceBrowserNodesFromEvidence, collectReferenceBrowserLeaves, type ReferenceBrowserNode } from "@/lib/ai/reference-browser";
import { PromptPicker } from "@/components/prompt/prompt-picker";
import { PromptEditorDialog } from "@/components/prompt/prompt-editor-dialog";
import { PromptRunSheet } from "@/components/prompt/prompt-run-sheet";
import { buildEvidencePromptContextValues } from "@/lib/prompt/context-builders";
import { executePromptTemplateForSurface } from "@/lib/prompt/surface-actions";
import { useI18n } from "@/hooks/use-i18n";
import { ReferenceBrowser } from "./reference-browser";
import { toRuntimeSettings } from "./ai-chat-context";

export interface EvidencePanelProps {
  message: ChatMessage | null;
  messages?: ChatMessage[];
  selectedMessageId?: string | null;
  onSelectMessage?: (messageId: string) => void;
  onCreateDraft?: (input: { title: string; content: string; refs: ChatMessage["evidenceRefs"] }) => void;
  onProposeTask?: (input: { prompt: string; refs: ChatMessage["evidenceRefs"] }) => Promise<void>;
  onClose: () => void;
  navigationAttempt?: EvidenceNavigationAttempt | null;
}

export interface EvidenceNavigationAttempt {
  locator: string;
  anchor?: EvidenceRef["anchor"];
  ref?: EvidenceRef;
  result: NavigationResult;
}

function messageLabel(message: ChatMessage, fallback: string): string {
  const summary = buildAiResultViewModel(message).summaryLabel;
  const generic = new Set([
    "conclusion",
    "结论",
    "evidence",
    "证据",
    "next actions",
    "下一步",
  ]);
  const lines = message.content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s*/u, "").replace(/^[-*]\s+/u, "").trim())
    .filter(Boolean);
  const meaningful = lines.find((line) => !generic.has(line.toLocaleLowerCase())) ?? summary;
  return meaningful.slice(0, 72) || fallback;
}

function compactLocatorLabel(locator: string): string {
  const path = locator.split("#", 1)[0]?.replace(/\\/g, "/") ?? locator;
  return path.split("/").filter(Boolean).pop() ?? locator;
}

function compactSourceLabel(label: string, locator: string): string {
  return /[\\/]/.test(label) ? compactLocatorLabel(label) : label || compactLocatorLabel(locator);
}

export function EvidencePanel({
  message,
  messages = [],
  selectedMessageId = null,
  onSelectMessage,
  onCreateDraft,
  onProposeTask,
  navigationAttempt = null,
}: EvidencePanelProps) {
  const { locale, t } = useI18n();
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const workspaceRootHandle = useWorkspaceStore((state) => state.workspaceRootHandle);
  const workspaceRootHistory = useWorkspaceStore((state) => state.workspaceRootHistory);
  const findWorkspaceRootForPath = useWorkspaceStore((state) => state.findWorkspaceRootForPath);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const currentFileHandle = activeTab?.kind === "file" ? activeTab.fileHandle : null;
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const settings = useSettingsStore((state) => state.settings);
  const getCachedContent = useContentCacheStore((state) => state.getContent);
  const loadPromptState = usePromptTemplateStore((state) => state.loadPromptState);
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [selectedLeafLocators, setSelectedLeafLocators] = useState<Record<string, boolean>>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [proposalBusyKeys, setProposalBusyKeys] = useState<Record<string, boolean>>({});
  const [proposalDoneKeys, setProposalDoneKeys] = useState<Record<string, boolean>>({});
  const [promptPickerState, setPromptPickerState] = useState<{
    refs: NonNullable<ChatMessage["evidenceRefs"]>;
    label: string;
  } | null>(null);
  const [promptRunState, setPromptRunState] = useState<{
    template: PromptTemplate;
    refs: NonNullable<ChatMessage["evidenceRefs"]>;
    label: string;
  } | null>(null);
  const [promptEditorState, setPromptEditorState] = useState<{
    template?: PromptTemplate | null;
  } | null>(null);
  const [navigationError, setNavigationError] = useState<EvidenceNavigationAttempt | null>(null);
  const [pendingNavigationAttempt, setPendingNavigationAttempt] = useState<EvidenceNavigationAttempt | null>(null);
  const navigationOutcome = useLinkNavigationStore((state) => (
    pendingNavigationAttempt
      ? state.outcomesByRequestId[pendingNavigationAttempt.result.requestId]
      : undefined
  ));
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setExpandedPaths({});
    setSelectedLeafLocators({});
    setNavigationError(null);
    setPendingNavigationAttempt(null);
    setDetailsOpen(false);
  }, [message?.id]);

  useEffect(() => {
    if (!navigationAttempt) return;
    if (!navigationAttempt.result.ok) {
      setNavigationError(navigationAttempt);
      setPendingNavigationAttempt(null);
      return;
    }
    if (navigationAttempt.result.status === "pending") {
      setPendingNavigationAttempt(navigationAttempt);
    }
  }, [navigationAttempt]);

  useEffect(() => {
    if (!pendingNavigationAttempt || !navigationOutcome) return;
    if (navigationOutcome.status !== "success") {
      setNavigationError({
        ...pendingNavigationAttempt,
        result: {
          ...pendingNavigationAttempt.result,
          ok: false,
          status: navigationOutcome.status,
        },
      });
    }
    setPendingNavigationAttempt(null);
  }, [navigationOutcome, pendingNavigationAttempt]);

  useEffect(() => {
    void loadPromptState();
  }, [loadPromptState]);

  const panelState = useMemo(() => buildEvidencePanelState({
    evidenceRefs: message?.evidenceRefs,
    contextNodes: message?.promptContext?.nodes,
  }), [message?.evidenceRefs, message?.promptContext?.nodes]);
  const referenceNodes = useMemo(() => buildReferenceBrowserNodesFromEvidence(
    message?.evidenceRefs,
    message?.promptContext?.nodes,
  ), [message?.evidenceRefs, message?.promptContext?.nodes]);
  const messageRows = useMemo(() => messages.map(candidate => ({
    message: candidate,
    label: messageLabel(candidate, t("ai.evidence.panel.response")),
    counts: buildEvidencePanelState({ evidenceRefs: candidate.evidenceRefs, contextNodes: candidate.promptContext?.nodes }),
  })), [messages, t]);

  const handleNavigate = useCallback(async (locator: string, anchor?: EvidenceRef["anchor"], ref?: EvidenceRef) => {
    setNavigationError(null);
    const resolvedRoot = findWorkspaceRootForPath(canonicalCitationPath(locator)) ?? workspaceRootHandle ?? rootHandle;
    const historyRoots = Array.from(workspaceRootHistory.values());
    const rootCandidates = Array.from(workspaceRootHistory.entries()).map(([pathPrefix, handle]) => ({
      handle,
      pathPrefix,
    }));
    if (workspaceRootHandle && workspaceRootPath) {
      rootCandidates.unshift({ handle: workspaceRootHandle, pathPrefix: workspaceRootPath });
    }
    try {
      const result = await navigateLinkDetailed(locator, {
        paneId: activePaneId,
        rootHandle: resolvedRoot,
        rootHandles: [workspaceRootHandle, rootHandle, ...historyRoots],
        rootCandidates,
        currentFilePath: activeTab?.filePath,
        currentFileHandle,
        evidenceAnchor: anchor,
        pathMode: "workspace",
      });

      if (!result.ok) {
        setNavigationError({ locator, anchor, ref, result });
        setPendingNavigationAttempt(null);
      } else if (result.status === "pending") {
        setPendingNavigationAttempt({ locator, anchor, ref, result });
      } else {
        setPendingNavigationAttempt(null);
      }
    } catch {
      setNavigationError({
        locator,
        anchor,
        ref,
        result: { ok: false, success: false, requestId: "nav-error", status: "unsupported_target" },
      });
    }
  }, [activePaneId, activeTab?.filePath, currentFileHandle, findWorkspaceRootForPath, rootHandle, workspaceRootHandle, workspaceRootHistory, workspaceRootPath]);

  const activeContent = activeTab
    ? (() => {
        const cached = getCachedContent(activeTab.id);
        return typeof cached?.content === "string" ? cached.content : null;
      })()
    : null;

  const handlePromptRunConfirm = useCallback(async (payload: {
    renderedPrompt: string;
    renderedSystemPrompt?: string;
    contextSummary: string;
  }) => {
    if (!promptRunState) {
      return;
    }

    try {
      const result = await executePromptTemplateForSurface({
        template: promptRunState.template,
        surface: "evidence",
        settings: toRuntimeSettings(settings),
        contextValues: buildEvidencePromptContextValues({
          evidenceRefs: promptRunState.refs,
          currentFile: activeTab?.filePath ?? activeTab?.fileName ?? null,
          currentFileContent: activeContent,
          workspaceSummary: promptRunState.label,
        }),
        workspaceKey,
        workspaceRootPath,
        renderedPrompt: payload.renderedPrompt,
        renderedSystemPrompt: payload.renderedSystemPrompt,
        contextSummary: payload.contextSummary,
        filePath: activeTab?.filePath,
        content: activeContent ?? undefined,
        query: payload.renderedPrompt,
        explicitEvidenceRefs: promptRunState.refs,
        locale,
      });

      toast.success(
        result.kind === "proposal"
          ? t("prompt.run.toast.proposalCreated")
          : result.kind === "draft"
            ? t("prompt.run.toast.draftCreated")
            : t("ai.evidence.toast.sentToChat"),
        { description: result.title },
      );
    } catch (error) {
      toast.error(t("prompt.run.toast.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPromptRunState(null);
    }
  }, [activeContent, activeTab?.fileName, activeTab?.filePath, locale, promptRunState, settings, t, workspaceKey, workspaceRootPath]);

  if (!message && messages.length === 0) {
    return null;
  }

  if (!message) {
    return (
      <div className="border-b border-border bg-background/95 px-3 py-3">
        <div className="rounded border border-border/60 bg-background/70 px-3 py-4 text-xs text-muted-foreground">
          {t("ai.evidence.panel.empty")}
        </div>
      </div>
    );
  }

  const selectedLeaves = collectReferenceBrowserLeaves(referenceNodes)
    .filter((leaf) => leaf.locator && selectedLeafLocators[leaf.locator]);
  const summarySources = referenceNodes.filter((node) => node.kind === "group" && node.locator);
  const navigationErrorCitation = navigationError
    ? buildCitationContract(navigationError.ref ?? {
        kind: "file",
        label: navigationError.locator,
        locator: navigationError.locator,
        anchor: navigationError.anchor,
      })
    : null;

  const renderReferenceNodeActions = (node: ReferenceBrowserNode) => {
    if (node.kind === "group" && node.children?.length) {
      const groupLeaves = collectReferenceBrowserLeaves([node]);
      const groupDraftSaved = savedKeys[`group:${node.locator}`] ?? false;
      const groupProposalBusy = proposalBusyKeys[`group:${node.locator}`] ?? false;
      const groupProposalDone = proposalDoneKeys[`group:${node.locator}`] ?? false;

      return (
        <>
          <button
            type="button"
            onClick={() => {
              const seed = buildEvidenceDraftSeedForSelection(groupLeaves.map((leaf) => ({
                id: leaf.id,
                kind: leaf.evidenceRef!.kind,
                label: leaf.label,
                locator: leaf.locator!,
                preview: leaf.preview,
              })));
              onCreateDraft?.(seed);
              setSavedKeys((current) => ({ ...current, [`group:${node.locator}`]: true }));
            }}
            className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
            disabled={groupDraftSaved || !onCreateDraft}
          >
            {groupDraftSaved ? t("ai.evidence.panel.saved") : t("ai.evidence.panel.saveDraft")}
          </button>
          <button
            type="button"
            onClick={() => {
              setPromptPickerState({
                refs: groupLeaves.map((leaf) => leaf.evidenceRef!).filter(Boolean),
                label: node.label,
              });
            }}
            className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30"
          >
            {t("ai.evidence.panel.useTemplate")}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!onProposeTask) {
                return;
              }
              setProposalBusyKeys((current) => ({ ...current, [`group:${node.locator}`]: true }));
              try {
                await onProposeTask({
                  prompt: buildEvidenceProposalPromptForSelection(groupLeaves.map((leaf) => ({
                    id: leaf.id,
                    kind: leaf.evidenceRef!.kind,
                    label: leaf.label,
                    locator: leaf.locator!,
                    preview: leaf.preview,
                  }))),
                  refs: groupLeaves.map((leaf) => leaf.evidenceRef!),
                });
                setProposalDoneKeys((current) => ({ ...current, [`group:${node.locator}`]: true }));
              } finally {
                setProposalBusyKeys((current) => ({ ...current, [`group:${node.locator}`]: false }));
              }
            }}
            className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
            disabled={groupProposalBusy || groupProposalDone || !onProposeTask}
          >
            {groupProposalDone ? t("ai.evidence.panel.generated") : groupProposalBusy ? t("ai.evidence.panel.generating") : t("ai.evidence.panel.plan")}
          </button>
        </>
      );
    }

    if (node.evidenceRef) {
      const draftSavedForLeaf = savedKeys[`leaf:${node.locator}`] ?? false;
      return (
        <>
          <button
            type="button"
            onClick={() => {
              const seed = buildEvidenceDraftSeedForLeaf({
                id: node.id,
                kind: node.evidenceRef!.kind,
                label: node.label,
                locator: node.locator!,
                preview: node.preview,
              });
              onCreateDraft?.(seed);
              setSavedKeys((current) => ({ ...current, [`leaf:${node.locator}`]: true }));
            }}
            className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
            disabled={draftSavedForLeaf || !onCreateDraft}
          >
            {draftSavedForLeaf ? t("ai.evidence.panel.saved") : t("ai.evidence.panel.saveDraft")}
          </button>
          <button
            type="button"
            onClick={() => {
              setPromptPickerState({
                refs: [node.evidenceRef!],
                label: node.label,
              });
            }}
            className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30"
          >
            {t("ai.evidence.panel.useTemplate")}
          </button>
        </>
      );
    }

    return null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PromptPicker
        isOpen={Boolean(promptPickerState)}
        surface="evidence"
        workspaceKey={workspaceKey}
        workspaceRootPath={workspaceRootPath}
        currentInput=""
        onClose={() => setPromptPickerState(null)}
        onSelectTemplate={(template) => {
          if (promptPickerState) {
            setPromptRunState({
              template,
              refs: promptPickerState.refs,
              label: promptPickerState.label,
            });
          }
          setPromptPickerState(null);
        }}
        onCreateTemplate={() => {
          setPromptPickerState(null);
          setPromptEditorState({});
        }}
        onEditTemplate={(template) => {
          setPromptPickerState(null);
          setPromptEditorState({ template });
        }}
      />
      <PromptEditorDialog
        key={`evidence-prompt-editor:${promptEditorState?.template?.id ?? "new"}`}
        isOpen={Boolean(promptEditorState)}
        surface="evidence"
        template={promptEditorState?.template ?? null}
        onClose={() => setPromptEditorState(null)}
      />
      <PromptRunSheet
        key={`evidence-prompt-run:${promptRunState?.template.id ?? "none"}:${promptRunState?.label ?? ""}`}
        isOpen={Boolean(promptRunState)}
        surface="evidence"
        template={promptRunState?.template ?? null}
        contextValues={promptRunState ? buildEvidencePromptContextValues({
          evidenceRefs: promptRunState.refs,
          currentFile: activeTab?.filePath ?? activeTab?.fileName ?? null,
          currentFileContent: activeContent,
          workspaceSummary: promptRunState.label,
        }) : {}}
        onClose={() => setPromptRunState(null)}
        onConfirm={(payload) => void handlePromptRunConfirm(payload)}
      />
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate text-xs text-muted-foreground" data-testid="evidence-review-counts">
          {t("ai.evidence.panel.sourceCount", { count: panelState.sourceCount })} · {t("ai.evidence.panel.passageCount", { count: panelState.evidenceCount })}
        </span>
        <button
          type="button"
          data-testid="evidence-review-details-toggle"
          onClick={() => setDetailsOpen((current) => !current)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-expanded={detailsOpen}
          title={t("ai.evidence.panel.referenceTree")}
        >
          {t("ai.evidence.panel.details")}
          {detailsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {navigationError && (
        <div
          data-testid="evidence-navigation-error"
          className="mx-3 mt-3 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {navigationErrorCitation
                ? navigationErrorCitation.displayTitle === navigationErrorCitation.basename
                  ? navigationErrorCitation.displayTitle
                  : `${navigationErrorCitation.displayTitle} · ${navigationErrorCitation.basename}`
                : null}
            </div>
            <div
              data-testid="evidence-navigation-location"
              className="truncate text-muted-foreground"
              title={navigationError.locator}
            >
              {navigationErrorCitation?.location.page
                ? t("ai.evidence.panel.page", { page: navigationErrorCitation.location.page })
                : compactLocatorLabel(navigationError.locator)}
            </div>
            {navigationErrorCitation?.boundedQuote ? (
              <div data-testid="evidence-navigation-quote" className="mt-0.5 truncate text-muted-foreground">
                “{navigationErrorCitation.boundedQuote}”
              </div>
            ) : null}
            <div data-testid="evidence-navigation-status" className="mt-0.5 text-amber-700">
              {t(`ai.evidence.navigation.${navigationError.result.status}`)}
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="evidence-navigation-open-source"
                onClick={() => navigationErrorCitation && void handleNavigate(navigationErrorCitation.canonicalPath)}
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                {t("ai.evidence.panel.openSource")}
              </button>
              <button
                type="button"
                data-testid="evidence-navigation-copy-reference"
                onClick={() => void navigator.clipboard?.writeText(navigationError.locator)}
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                {t("ai.evidence.panel.copyReference")}
              </button>
            </div>
          </div>
          <button
            type="button"
            data-testid="evidence-navigation-retry"
            onClick={() => void handleNavigate(navigationError.locator, navigationError.anchor, navigationError.ref)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("ai.evidence.panel.retry")}
            title={t("ai.evidence.panel.retry")}
          >
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!detailsOpen && (
          <div data-testid="evidence-source-summary" className="space-y-1.5">
            {summarySources.map((source) => {
              const firstPassage = source.children?.find((child) => child.locator);
              const passageCount = source.passageCount ?? source.children?.length ?? 0;
              return (
              <button
                key={source.id}
                type="button"
                onClick={() => {
                  if (firstPassage?.locator) {
                    void handleNavigate(firstPassage.locator, firstPassage.evidenceRef?.anchor, firstPassage.evidenceRef);
                  }
                }}
                title={passageCount === 1 ? firstPassage?.locator : source.locator}
                data-testid={`evidence-source-row-${source.id}`}
                data-passage-count={passageCount}
                className="flex h-9 w-full items-center gap-2 rounded px-2 text-left hover:bg-accent/60"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {compactSourceLabel(source.label, source.locator!)}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {t("ai.evidence.panel.passageCount", { count: passageCount })}
                </span>
              </button>
              );
            })}
          </div>
        )}

        {detailsOpen && <div className="space-y-3" data-testid="evidence-review-details">
        {messages.length > 1 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("ai.evidence.panel.messages")}
            </div>
            <div className="space-y-1">
              {messageRows.map(({ message: candidate, label, counts }) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onSelectMessage?.(candidate.id)}
                  className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition-colors ${
                    selectedMessageId === candidate.id
                      ? "border-border bg-background/80 text-foreground"
                      : "border-border/50 text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  <div className="truncate font-medium">{label}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground/80">
                    {t("ai.evidence.panel.sourceCount", { count: counts.sourceCount })} · {t("ai.evidence.panel.passageCount", { count: counts.evidenceCount })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {referenceNodes.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("ai.evidence.panel.referenceTree")}
            </div>
            {selectedLeaves.length > 0 && (
              <div className="mb-2 rounded border border-border/50 bg-background/70 px-2 py-2">
                <div className="mb-2 text-[10px] text-muted-foreground">
                  {t("ai.evidence.panel.selectedEvidence", { count: selectedLeaves.length })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const seed = buildEvidenceDraftSeedForSelection(selectedLeaves.map((leaf) => ({
                        id: leaf.id,
                        kind: leaf.evidenceRef!.kind,
                        label: leaf.label,
                        locator: leaf.locator!,
                        preview: leaf.preview,
                      })));
                      onCreateDraft?.(seed);
                      setSavedKeys((current) => ({ ...current, "selection:multi": true }));
                    }}
                    className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
                    disabled={(savedKeys["selection:multi"] ?? false) || !onCreateDraft}
                  >
                    {(savedKeys["selection:multi"] ?? false) ? t("ai.evidence.panel.saved") : t("ai.evidence.panel.saveSelectedDraft")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPromptPickerState({
                        refs: selectedLeaves.map((leaf) => leaf.evidenceRef!).filter(Boolean),
                        label: t("ai.evidence.panel.selectedEvidence", { count: selectedLeaves.length }),
                      });
                    }}
                    className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30"
                  >
                    {t("ai.evidence.panel.useTemplate")}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!onProposeTask) {
                        return;
                      }
                      setProposalBusyKeys((current) => ({ ...current, "selection:multi": true }));
                      try {
                        await onProposeTask({
                          prompt: buildEvidenceProposalPromptForSelection(selectedLeaves.map((leaf) => ({
                            id: leaf.id,
                            kind: leaf.evidenceRef!.kind,
                            label: leaf.label,
                            locator: leaf.locator!,
                            preview: leaf.preview,
                          }))),
                          refs: selectedLeaves.map((leaf) => leaf.evidenceRef!),
                        });
                        setProposalDoneKeys((current) => ({ ...current, "selection:multi": true }));
                      } finally {
                        setProposalBusyKeys((current) => ({ ...current, "selection:multi": false }));
                      }
                    }}
                    className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
                    disabled={(proposalBusyKeys["selection:multi"] ?? false) || (proposalDoneKeys["selection:multi"] ?? false) || !onProposeTask}
                  >
                    {(proposalDoneKeys["selection:multi"] ?? false)
                      ? t("prompt.run.toast.proposalCreated")
                      : (proposalBusyKeys["selection:multi"] ?? false)
                        ? t("ai.evidence.panel.generating")
                        : t("ai.evidence.panel.generateSelectedPlan")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLeafLocators({})}
                    className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30"
                  >
                    {t("ai.evidence.panel.clearSelection")}
                  </button>
                </div>
              </div>
            )}
            <ReferenceBrowser
              nodes={referenceNodes}
              emptyLabel={t("ai.evidence.panel.noReferences")}
              expandedNodeIds={expandedPaths}
              onToggleNode={(nodeId) => setExpandedPaths((current) => ({
                ...current,
                [nodeId]: !(current[nodeId] ?? false),
              }))}
              onActivateNode={(node) => {
                if (node.evidenceRef) {
                  void handleNavigate(toEvidenceNavigationTarget(node.evidenceRef), node.evidenceRef.anchor, node.evidenceRef);
                }
              }}
              renderNodeActions={renderReferenceNodeActions}
              showSelectionCheckbox={true}
              selectedLeafIds={selectedLeafLocators}
              onToggleLeafSelection={(node) => {
                const locator = node.locator ?? node.id;
                setSelectedLeafLocators((current) => ({
                  ...current,
                  [locator]: !current[locator],
                }));
              }}
            />
          </div>
        )}

        {panelState.contextGroups.length > 0 && (
          <div className="space-y-2">
            {panelState.contextGroups.map((group) => (
              <div key={group.kind}>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </div>
                <div className="space-y-1">
                  {group.nodes.slice(0, 6).map((node) => {
                    const target = node.evidenceRef ? toEvidenceNavigationTarget(node.evidenceRef) : null;
                    const content = (
                      <>
                        <div className="truncate text-[11px] font-medium text-foreground">{node.label}</div>
                        <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{node.content}</div>
                      </>
                    );

                    if (!target) {
                      return (
                        <div key={node.id} className="rounded border border-border/50 px-2 py-1.5">
                          {content}
                        </div>
                      );
                    }

                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => void handleNavigate(target, node.evidenceRef?.anchor, node.evidenceRef)}
                        className="w-full rounded border border-border/50 px-2 py-1.5 text-left hover:bg-accent/40"
                      >
                        {content}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>}
      </div>
    </div>
  );
}
