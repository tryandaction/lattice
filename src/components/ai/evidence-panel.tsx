"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, ShieldCheck, X } from "lucide-react";
import { navigateLink } from "@/lib/link-router/navigate-link";
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
import type { ChatMessage } from "@/stores/ai-chat-store";
import type { PromptTemplate } from "@/lib/prompt/types";
import type { AiRuntimeSettings } from "@/lib/ai/types";
import { toast } from "sonner";
import { buildAiResultViewModel } from "@/lib/ai/result-view-model";
import { buildReferenceBrowserNodesFromEvidence, collectReferenceBrowserLeaves, type ReferenceBrowserNode } from "@/lib/ai/reference-browser";
import { PromptPicker } from "@/components/prompt/prompt-picker";
import { PromptEditorDialog } from "@/components/prompt/prompt-editor-dialog";
import { PromptRunSheet } from "@/components/prompt/prompt-run-sheet";
import { buildEvidencePromptContextValues } from "@/lib/prompt/context-builders";
import { executePromptTemplateForSurface } from "@/lib/prompt/surface-actions";
import { ReferenceBrowser } from "./reference-browser";

export interface EvidencePanelProps {
  message: ChatMessage | null;
  messages?: ChatMessage[];
  selectedMessageId?: string | null;
  onSelectMessage?: (messageId: string) => void;
  onCreateDraft?: (input: { title: string; content: string; refs: ChatMessage["evidenceRefs"] }) => void;
  onProposeTask?: (input: { prompt: string; refs: ChatMessage["evidenceRefs"] }) => Promise<void>;
  onClose: () => void;
}

function messageLabel(message: ChatMessage): string {
  return buildAiResultViewModel(message).summaryLabel;
}

export function EvidencePanel({
  message,
  messages = [],
  selectedMessageId = null,
  onSelectMessage,
  onCreateDraft,
  onProposeTask,
  onClose,
}: EvidencePanelProps) {
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
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

  useEffect(() => {
    setExpandedPaths({});
    setSelectedLeafLocators({});
  }, [message?.id]);

  useEffect(() => {
    void loadPromptState();
  }, [loadPromptState]);

  const panelState = buildEvidencePanelState({
    evidenceRefs: message?.evidenceRefs,
    contextNodes: message?.promptContext?.nodes,
  });
  const referenceNodes = buildReferenceBrowserNodesFromEvidence(
    message?.evidenceRefs,
    message?.promptContext?.nodes,
  );

  const handleNavigate = useCallback(async (locator: string) => {
    const success = await navigateLink(locator, {
      paneId: activePaneId,
      rootHandle,
      currentFilePath: activeTab?.filePath,
    });

    if (!success) {
      toast.error("无法定位证据", {
        description: locator,
      });
    }
  }, [activePaneId, activeTab?.filePath, rootHandle]);

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
        settings: {
          aiEnabled: settings.aiEnabled,
          providerId: (settings.aiProvider as AiRuntimeSettings["providerId"]) ?? null,
          model: settings.aiModel,
          temperature: settings.aiTemperature,
          maxTokens: settings.aiMaxTokens,
          systemPrompt: settings.aiSystemPrompt,
          preferLocal: settings.aiProvider === "ollama",
        } satisfies AiRuntimeSettings,
        contextValues: buildEvidencePromptContextValues({
          evidenceRefs: promptRunState.refs,
          currentFile: activeTab?.filePath ?? activeTab?.fileName ?? null,
          currentFileContent: activeContent,
          workspaceSummary: promptRunState.label,
        }),
        workspaceRootPath,
        renderedPrompt: payload.renderedPrompt,
        renderedSystemPrompt: payload.renderedSystemPrompt,
        contextSummary: payload.contextSummary,
        filePath: activeTab?.filePath,
        content: activeContent ?? undefined,
        query: payload.renderedPrompt,
        explicitEvidenceRefs: promptRunState.refs,
      });

      toast.success(
        result.kind === "proposal"
          ? "已生成计划"
          : result.kind === "draft"
            ? "已生成草稿"
            : "已发送到 AI Chat",
        { description: result.title },
      );
    } catch (error) {
      toast.error("模板执行失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPromptRunState(null);
    }
  }, [activeContent, activeTab?.fileName, activeTab?.filePath, promptRunState, settings.aiEnabled, settings.aiMaxTokens, settings.aiModel, settings.aiProvider, settings.aiSystemPrompt, settings.aiTemperature, workspaceRootPath]);

  if (!message && messages.length === 0) {
    return null;
  }

  if (!message) {
    return (
      <div className="border-b border-border bg-background/95 px-3 py-3">
        <div className="rounded border border-border/60 bg-background/70 px-3 py-4 text-xs text-muted-foreground">
          选择一条带证据的 assistant 回复后，可在这里统一浏览引用树、上下文和后续动作。
        </div>
      </div>
    );
  }

  const draftSaved = savedKeys[`message:${message.id}`] ?? false;
  const proposalBusy = proposalBusyKeys[`message:${message.id}`] ?? false;
  const proposalDone = proposalDoneKeys[`message:${message.id}`] ?? false;
  const selectedLeaves = collectReferenceBrowserLeaves(referenceNodes)
    .filter((leaf) => leaf.locator && selectedLeafLocators[leaf.locator]);

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
            {groupDraftSaved ? "已保存" : "草稿"}
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
            模板
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
            {groupProposalDone ? "已生成" : groupProposalBusy ? "生成中..." : "计划"}
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
            {draftSavedForLeaf ? "已保存" : "保存草稿"}
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
            模板
          </button>
        </>
      );
    }

    return null;
  };

  return (
    <div className="border-b border-border bg-background/95 px-3 py-3">
      <PromptPicker
        isOpen={Boolean(promptPickerState)}
        surface="evidence"
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
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Evidence Panel</span>
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              {panelState.evidenceCount} 证据
            </span>
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              {panelState.contextCount} 上下文
            </span>
          </div>
          {message.model && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Bot className="h-3 w-3" />
              <span>{message.model.providerName}</span>
              {message.model.model && <span>· {message.model.model}</span>}
              <span>· {message.model.source === "local" ? "本地模型" : "云模型"}</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onCreateDraft?.({
                  title: message.draftSuggestion?.title || `AI Draft ${message.id}`,
                  content: message.content,
                  refs: message.evidenceRefs ?? [],
                });
                setSavedKeys((current) => ({ ...current, [`message:${message.id}`]: true }));
              }}
              className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
              disabled={draftSaved || !onCreateDraft}
            >
              {draftSaved ? "已保存草稿" : "保存为草稿"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPromptPickerState({
                  refs: message.evidenceRefs ?? [],
                  label: messageLabel(message),
                });
              }}
              className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent"
              disabled={(message.evidenceRefs?.length ?? 0) === 0}
            >
              使用模板
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!onProposeTask) {
                  return;
                }
                setProposalBusyKeys((current) => ({ ...current, [`message:${message.id}`]: true }));
                try {
                  await onProposeTask({
                    prompt: message.content,
                    refs: message.evidenceRefs ?? [],
                  });
                  setProposalDoneKeys((current) => ({ ...current, [`message:${message.id}`]: true }));
                } finally {
                  setProposalBusyKeys((current) => ({ ...current, [`message:${message.id}`]: false }));
                }
              }}
              className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
              disabled={proposalBusy || proposalDone || !onProposeTask}
            >
              {proposalDone ? "已生成计划" : proposalBusy ? "生成中..." : "生成整理计划"}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border/70 bg-background/70 p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-56 space-y-3 overflow-y-auto">
        {messages.length > 1 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Messages
            </div>
            <div className="space-y-1">
              {messages.map((candidate) => (
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
                  <div className="truncate font-medium">{messageLabel(candidate)}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground/80">
                    {(candidate.evidenceRefs?.length ?? 0)} 证据 · {(candidate.promptContext?.nodes?.length ?? 0)} 上下文
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {referenceNodes.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Reference Tree
            </div>
            {selectedLeaves.length > 0 && (
              <div className="mb-2 rounded border border-border/50 bg-background/70 px-2 py-2">
                <div className="mb-2 text-[10px] text-muted-foreground">
                  已选 {selectedLeaves.length} 条证据
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
                    {(savedKeys["selection:multi"] ?? false) ? "已保存" : "保存选中草稿"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPromptPickerState({
                        refs: selectedLeaves.map((leaf) => leaf.evidenceRef!).filter(Boolean),
                        label: `已选 ${selectedLeaves.length} 条证据`,
                      });
                    }}
                    className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30"
                  >
                    使用模板
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
                      ? "已生成计划"
                      : (proposalBusyKeys["selection:multi"] ?? false)
                        ? "生成中..."
                        : "生成选中计划"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLeafLocators({})}
                    className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30"
                  >
                    清空选择
                  </button>
                </div>
              </div>
            )}
            <ReferenceBrowser
              nodes={referenceNodes}
              expandedNodeIds={expandedPaths}
              onToggleNode={(nodeId) => setExpandedPaths((current) => ({
                ...current,
                [nodeId]: !(current[nodeId] ?? true),
              }))}
              onActivateNode={(node) => {
                if (node.evidenceRef) {
                  void handleNavigate(toEvidenceNavigationTarget(node.evidenceRef));
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
                        onClick={() => void handleNavigate(target)}
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
      </div>
    </div>
  );
}
