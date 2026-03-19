"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Link2, ShieldCheck, X } from "lucide-react";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { toEvidenceNavigationTarget } from "@/lib/ai/workbench-actions";
import {
  buildEvidencePanelState,
  buildEvidenceDraftSeedForGroup,
  buildEvidenceDraftSeedForLeaf,
  buildEvidenceDraftSeedForSelection,
  buildEvidenceProposalPrompt,
  buildEvidenceProposalPromptForSelection,
} from "@/lib/ai/evidence-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ChatMessage } from "@/stores/ai-chat-store";
import { toast } from "sonner";

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
  const firstLine = message.content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "AI Response";
  return firstLine.slice(0, 48);
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
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [selectedLeafLocators, setSelectedLeafLocators] = useState<Record<string, boolean>>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [proposalBusyKeys, setProposalBusyKeys] = useState<Record<string, boolean>>({});
  const [proposalDoneKeys, setProposalDoneKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedPaths({});
    setSelectedLeafLocators({});
  }, [message?.id]);

  const panelState = buildEvidencePanelState({
    evidenceRefs: message?.evidenceRefs,
    contextNodes: message?.promptContext?.nodes,
  });

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
  const selectedLeaves = panelState.referenceGroups
    .flatMap((group) => group.leaves)
    .filter((leaf) => selectedLeafLocators[leaf.locator]);

  return (
    <div className="border-b border-border bg-background/95 px-3 py-3">
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

        {panelState.referenceGroups.length > 0 && (
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
                      const seed = buildEvidenceDraftSeedForSelection(selectedLeaves);
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
                    onClick={async () => {
                      if (!onProposeTask) {
                        return;
                      }
                      setProposalBusyKeys((current) => ({ ...current, "selection:multi": true }));
                      try {
                        await onProposeTask({
                          prompt: buildEvidenceProposalPromptForSelection(selectedLeaves),
                          refs: selectedLeaves.map((leaf) => ({
                            kind: leaf.kind,
                            label: leaf.label,
                            locator: leaf.locator,
                            preview: leaf.preview,
                          })),
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
            <div className="space-y-2">
              {panelState.referenceGroups.map((group) => {
                const isExpanded = expandedPaths[group.path] ?? true;
                const groupDraftSaved = savedKeys[`group:${group.path}`] ?? false;
                const groupProposalBusy = proposalBusyKeys[`group:${group.path}`] ?? false;
                const groupProposalDone = proposalDoneKeys[`group:${group.path}`] ?? false;
                return (
                  <div key={group.path} className="rounded border border-border/50">
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => setExpandedPaths((current) => ({
                          ...current,
                          [group.path]: !isExpanded,
                        }))}
                        className="flex min-w-0 flex-1 items-center justify-between text-left hover:text-foreground"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium text-foreground">{group.title}</div>
                          <div className="truncate text-[10px] text-muted-foreground">{group.path}</div>
                        </div>
                        <div className="ml-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{group.leaves.length}</span>
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </div>
                      </button>
                      <div className="ml-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const seed = buildEvidenceDraftSeedForGroup(group);
                            onCreateDraft?.(seed);
                            setSavedKeys((current) => ({ ...current, [`group:${group.path}`]: true }));
                          }}
                          className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
                          disabled={groupDraftSaved || !onCreateDraft}
                        >
                          {groupDraftSaved ? "已保存" : "草稿"}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!onProposeTask) {
                              return;
                            }
                            setProposalBusyKeys((current) => ({ ...current, [`group:${group.path}`]: true }));
                            try {
                              await onProposeTask({
                                prompt: buildEvidenceProposalPrompt(group),
                                refs: group.leaves.map((leaf) => ({
                                  kind: leaf.kind,
                                  label: leaf.label,
                                  locator: leaf.locator,
                                  preview: leaf.preview,
                                })),
                              });
                              setProposalDoneKeys((current) => ({ ...current, [`group:${group.path}`]: true }));
                            } finally {
                              setProposalBusyKeys((current) => ({ ...current, [`group:${group.path}`]: false }));
                            }
                          }}
                          className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
                          disabled={groupProposalBusy || groupProposalDone || !onProposeTask}
                        >
                          {groupProposalDone ? "已生成" : groupProposalBusy ? "生成中..." : "计划"}
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="space-y-1 border-t border-border/40 px-2 py-2">
                        {group.leaves.map((leaf) => (
                          <div key={leaf.id} className="rounded border border-border/40 px-2 py-1.5">
                            <div className="mb-2 flex items-center justify-between">
                              <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={selectedLeafLocators[leaf.locator] ?? false}
                                  onChange={() => setSelectedLeafLocators((current) => ({
                                    ...current,
                                    [leaf.locator]: !current[leaf.locator],
                                  }))}
                                  className="h-3.5 w-3.5 rounded border-border"
                                />
                                选择此证据
                              </label>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleNavigate(toEvidenceNavigationTarget({
                                kind: leaf.kind,
                                label: leaf.label,
                                locator: leaf.locator,
                                preview: leaf.preview,
                              }))}
                              className="w-full text-left hover:text-foreground"
                            >
                              <div className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                                <Link2 className="h-3 w-3 text-muted-foreground" />
                                <span className="truncate">{leaf.label}</span>
                              </div>
                              <div className="truncate text-[10px] text-muted-foreground">{leaf.locator}</div>
                              {leaf.preview && (
                                <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground/80">{leaf.preview}</div>
                              )}
                            </button>
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  const seed = buildEvidenceDraftSeedForLeaf(leaf);
                                  onCreateDraft?.(seed);
                                  setSavedKeys((current) => ({ ...current, [`leaf:${leaf.locator}`]: true }));
                                }}
                                className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
                                disabled={(savedKeys[`leaf:${leaf.locator}`] ?? false) || !onCreateDraft}
                              >
                                {(savedKeys[`leaf:${leaf.locator}`] ?? false) ? "已保存" : "保存草稿"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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

        {message.evidenceRefs && message.evidenceRefs.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              References
            </div>
            <div className="space-y-1">
              {message.evidenceRefs.map((ref) => (
                <button
                  key={`${ref.kind}:${ref.locator}`}
                  type="button"
                  onClick={() => void handleNavigate(toEvidenceNavigationTarget(ref))}
                  className="w-full rounded border border-border/50 px-2 py-1.5 text-left hover:bg-accent/40"
                >
                  <div className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                    <Link2 className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate">{ref.label}</span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{ref.locator}</div>
                  {ref.preview && (
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground/80">{ref.preview}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
