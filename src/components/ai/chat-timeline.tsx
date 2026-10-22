"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Database, GitCompareArrows, ListTodo, Pencil, ShieldCheck } from "lucide-react";
import { useAiChatStore, type ChatMessage } from "@/stores/ai-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/renderers/markdown-renderer";
import { DocumentReadingProgress } from './document-reading-progress';
import { AssistantMessageEditor } from './assistant-message-editor';
import { CopyAnswerButton } from './copy-answer-button';
import { useI18n } from "@/hooks/use-i18n";
import { PdfCompanionReview } from "./pdf-companion-review";
import { useAiPdfCompanionStore } from "@/stores/ai-pdf-companion-store";
import { DiffPreview } from "./diff-preview";
import { extractCodeBlocks } from "@/lib/ai/diff-utils";
import type { EvidenceRef } from "@/lib/ai/types";
import { buildAiResultViewModel, type AiResultSectionViewModel, type AiResultViewModel } from "@/lib/ai/result-view-model";
import { type CitationContract } from "@/lib/ai/citation-contract";
import { focusAgentSession } from "@/lib/ai/agent-session-focus";
import {
  SelectionOriginBadge,
} from "./workbench-queue";

const CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;

function EvidenceSummaryButton({
  messageId,
  evidenceCount,
  contextCount,
  selected,
  open,
  onToggle,
}: {
  messageId: string;
  evidenceCount: number;
  contextCount: number;
  selected: boolean;
  open: boolean;
  onToggle: (messageId: string) => void;
}) {
  const { t } = useI18n();
  if (evidenceCount === 0 && contextCount === 0) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="ai-chat-context-details"
      onClick={() => onToggle(messageId)}
      className={cn(
        "mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] text-muted-foreground transition-colors",
        selected
          ? "border-border bg-background/80 text-foreground"
          : "border-border/60 bg-background/50 hover:bg-accent/40"
      )}
    >
      <ShieldCheck className="h-3 w-3" />
      <span>{t("chat.contextCount", { count: Math.max(evidenceCount, contextCount) })}</span>
      {open && selected ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
    </button>
  );
}

function AgentResultSection({
  section,
  messageId,
  index,
  citationContracts,
  onCitationNavigate,
}: {
  section: AiResultSectionViewModel;
  messageId: string;
  index: number;
  citationContracts: CitationContract[];
  onCitationNavigate: (ref: EvidenceRef) => void;
}) {
  const isPrimary = ["Answer", "Conclusion", "Core idea", "Steps", "Example", "Next question"].includes(section.title)
    || ["conclusion", "concept", "steps", "example", "next_question"].includes(section.kind);
  if (isPrimary) {
    return (
      <div className="text-xs leading-relaxed ai-chat-markdown [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5" data-testid={`ai-chat-answer-section-${section.kind}`}>
        {section.title !== "Answer" && section.title !== "Conclusion" ? (
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{section.title}</div>
        ) : null}
        <MarkdownRenderer content={section.content} className="text-xs" linkPolicy="strict-ai" citationContracts={citationContracts} onCitationNavigate={onCitationNavigate} />
      </div>
    );
  }

  const isCompactAgentSection = section.title === "Run" || section.title === "Workbench" || section.title === "Plan" || section.title === "Observations";

  return (
    <details className="border-t border-border/60 pt-2" data-agent-section={`${messageId}:${section.title}:${index}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <ChevronDown className="h-3 w-3" />
        <span>{section.title}</span>
      </summary>
      <div className={cn("mt-2 text-[11px] leading-relaxed ai-chat-markdown text-muted-foreground [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0.5", !isCompactAgentSection && "pl-4")}>
        <MarkdownRenderer content={section.content} className="text-xs" linkPolicy="strict-ai" citationContracts={citationContracts} onCitationNavigate={onCitationNavigate} />
      </div>
    </details>
  );
}

const AgentResultSections = memo(function AgentResultSections({
  resultView,
  messageId,
  onOpenEvidence,
}: {
  resultView: AiResultViewModel;
  messageId: string;
  onOpenEvidence: (messageId: string, ref?: EvidenceRef) => void;
}) {
  const onCitationNavigate = useCallback((ref: EvidenceRef) => onOpenEvidence(messageId, ref), [messageId, onOpenEvidence]);
  return (
    <div className="space-y-2">
      {resultView.sections
        .filter((section) => section.kind !== "evidence" || !section.synthetic)
        .filter((section) => !(section.synthetic && section.kind === "next_actions"))
        .filter((section) => !["run", "plan"].includes(section.kind))
        .map((section, index) => (
        <AgentResultSection
          key={`${messageId}:${section.title}:${index}`}
          section={section}
          messageId={messageId}
          index={index}
          citationContracts={resultView.citationContracts}
          onCitationNavigate={onCitationNavigate}
        />
      ))}
    </div>
  );
});

const ChatMessageRow = memo(function ChatMessageRow({
  msg: currentMessage, retryPrompt, selected, isEvidencePanelOpen, showDocumentProgress, showProposal, diffCode, onToggleDiff, onContentRendered, onOpenEvidence, onOpenWorkbench,
}: {
  msg: ChatMessage;
  retryPrompt: string;
  selected: boolean;
  isEvidencePanelOpen: boolean;
  showDocumentProgress: boolean;
  showProposal: boolean;
  diffCode: string | null;
  onToggleDiff: (messageId: string, code: string | null) => void;
  onContentRendered: () => void;
  onOpenWorkbench?: () => void;
  onOpenEvidence: (messageId: string, ref?: EvidenceRef) => void;
}) {
  const { t } = useI18n();
  // Stream parsing is interruptible by typing/selection; completion is immediate.
  const [editing, setEditing] = useState(false);
  const closeEditor = useCallback(() => setEditing(false), []);
  const deferredMessage = useDeferredValue(currentMessage);
  const displayed = currentMessage.isStreaming ? deferredMessage : currentMessage;
  // Old persisted failures used the error as answer text. Render their metadata once.
  const msg = useMemo(() => displayed.error && displayed.content === 'Error: ' + displayed.error
    ? { ...displayed, content: '' } : displayed, [displayed]);
  const setComposerDraft = useAiChatStore((state) => state.setComposerDraft);
  const resultView = useMemo(() => msg.role === "assistant" ? buildAiResultViewModel(msg) : null, [msg]);
  const codeBlocks = useMemo(() => msg.role === "assistant" && !msg.isStreaming ? extractCodeBlocks(msg.content) : [], [msg.role, msg.isStreaming, msg.content]);
  const activeTabId = useWorkspaceStore((state) => codeBlocks.length ? state.getActiveTab()?.id ?? null : null);
  // Editor keystrokes must not redraw the conversation when no diff is open.
  const activeContent = useContentCacheStore((state) => {
    if (diffCode === null || !activeTabId) return null;
    const content = state.getContent(activeTabId)?.content;
    return typeof content === "string" ? content : null;
  });
  useEffect(() => { onContentRendered(); }, [msg.content, msg.isStreaming, onContentRendered]);
  return (
        <div
          data-message-role={msg.role}
          style={{ contentVisibility: "auto", containIntrinsicSize: "0 88px" }}
          className={cn(
            "group relative text-sm",
            msg.role === "user"
              ? "ml-auto max-w-[88%] rounded-md border border-border/60 bg-muted/60 px-3 py-2"
              : "mr-4 bg-transparent px-0 py-1",
            msg.origin?.kind === "selection-ai" && "ring-1 ring-primary/15"
          )}
        >
          <div className="text-[10px] text-muted-foreground mb-1 uppercase">
            {msg.role === "user" ? t('chat.you') : t('chat.ai')}
          </div>
          {msg.origin?.kind === "selection-ai" && (
            <SelectionOriginBadge origin={msg.origin} />
          )}
          {msg.role === 'user' && msg.attachments?.length ? <div className="mb-1 flex flex-wrap gap-1" data-testid="chat-message-attachments">
            {msg.attachments.map(attachment => <span key={attachment.id} className="max-w-56 truncate rounded border border-border px-1.5 py-0.5 text-[11px]" title={attachment.name}>{attachment.name}</span>)}
          </div> : null}
          {msg.role === "assistant" ? (
            <>
              {editing && !currentMessage.isStreaming ? (
                <AssistantMessageEditor messageId={msg.id} content={msg.content} onClose={closeEditor} />
              ) : resultView ? (
                <div className="space-y-2">
                  <AgentResultSections resultView={resultView} messageId={msg.id} onOpenEvidence={onOpenEvidence} />
                  {msg.isStreaming && <span className="animate-pulse text-xs">...</span>}
                  {resultView?.promptContext?.truncated && !msg.isStreaming ? (
                    <details
                      data-testid="ai-chat-context-truncated"
                      className="mt-1 text-[10px] text-muted-foreground"
                    >
                      <summary className="cursor-pointer">{t("chat.context.partial")}</summary>
                      <p className="mt-1">{t("chat.context.partialDetail")}</p>
                    </details>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs leading-relaxed ai-chat-markdown [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                  {msg.content.startsWith('Error: ') ? null : <MarkdownRenderer content={msg.content} className="text-xs" linkPolicy="strict-ai" citationContracts={[]} />}
                  {msg.isStreaming && <span className="animate-pulse">...</span>}
                </div>
              )}
              {msg.isInterrupted && <p className="mt-2 text-[11px] text-muted-foreground" data-testid="ai-chat-interrupted">{t('chat.interrupted')}</p>}
              {currentMessage.isStreaming && msg.content ? <CopyAnswerButton message={currentMessage} /> : null}
              {msg.error && <div role="alert" className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs" data-testid="ai-chat-request-error">
                <p className="break-words text-destructive">{msg.error}</p>
                {msg.content.trim() ? <p className="mt-1 text-muted-foreground">{t('chat.partialFailure')}</p> : null}
              </div>}
              <EvidenceSummaryButton
                messageId={msg.id}
                evidenceCount={resultView?.evidenceCount ?? 0}
                contextCount={resultView?.contextCount ?? 0}
                selected={selected}
                open={isEvidencePanelOpen}
                onToggle={onOpenEvidence}
              />
              {msg.agentResult?.sessionId && showDocumentProgress && <DocumentReadingProgress sessionId={msg.agentResult.sessionId} requestMode={msg.requestMode} reportedError={msg.error} />}
              {showProposal && (
                <PdfCompanionReview onNavigate={(ref) => onOpenEvidence(msg.id, ref)} />
              )}
              {!msg.isStreaming && (msg.draftSuggestion || msg.workspaceDraftId) && onOpenWorkbench && (
                <button type="button" onClick={onOpenWorkbench} data-testid="ai-chat-review-document"
                  className="mt-2 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent">
                  {msg.workspaceDraftId ? t('chat.workbench.reviewFile') : t('chat.workbench.reviewDocument')}
                </button>
              )}
              {!currentMessage.isStreaming && (msg.content || retryPrompt) && !editing && (
                <div className="flex items-center gap-1 mt-1">
                  {msg.content && <CopyAnswerButton message={msg} />}
                  {msg.content && <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    title={t("chat.edit")}
                    aria-label={t("chat.edit")}
                    data-testid="ai-chat-edit-message"
                  >
                    <Pencil className="h-3 w-3" />{t("chat.edit")}
                  </button>}
                  {retryPrompt ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (useAiChatStore.getState().isGenerating) return;
                        const sourceSessionId = msg.agentResult?.sessionId;
                        const session = sourceSessionId ? useAgentSessionStore.getState().getSession(sourceSessionId) : null;
                        const retrySynthesis = session?.executionContinuation
                          ? (await import('@/lib/ai/research-agent')).canRetryResearchAgentSynthesis(session)
                          : false;
                        if (useAiChatStore.getState().isGenerating) return;
                        const priorMessages = useAiChatStore.getState().getActiveConversation()?.messages ?? [];
                        const failedIndex = priorMessages.findIndex(message => message.id === msg.id);
                        const attachmentIds = priorMessages.slice(0, failedIndex).findLast(message => message.role === 'user')?.attachments?.map(ref => ref.id);
                        setComposerDraft(retrySynthesis && sourceSessionId && session
                          ? { text: session.task, mode: 'agent', submit: true, attachmentIds, continuation: { sourceSessionId, approvalResume: true } }
                          : session?.documentResearch && sourceSessionId
                            ? { text: session.task, mode: msg.requestMode ?? 'agent', submit: true, attachmentIds, continuation: { sourceSessionId, documentResume: true } }
                          : { text: retryPrompt, mode: msg.requestMode ?? 'chat', submit: true, attachmentIds });
                      }}
                      className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-muted hover:text-foreground"
                      title={t("chat.retry")}
                      aria-label={t("chat.retry")}
                      data-testid="ai-chat-retry"
                    >
                      {t("chat.retry")}
                    </button>
                  ) : null}
                  {msg.agentResult?.sessionId && (
                    <button
                      onClick={() => {
                        focusAgentSession(useAgentSessionStore.getState(), msg.agentResult?.sessionId, "trace");
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={t("chat.agentResult.openTrace")}
                      aria-label={t("chat.agentResult.openTrace")}
                      data-testid="ai-chat-open-trace"
                    >
                      <ListTodo className="w-3 h-3" />
                    </button>
                  )}
                  {msg.agentResult?.sessionId && msg.agentResult.memorySummary?.pendingSuggestionCount ? (
                    <button
                      onClick={() => {
                        focusAgentSession(useAgentSessionStore.getState(), msg.agentResult?.sessionId, "memory");
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={t("chat.agentResult.reviewMemory")}
                      aria-label={t("chat.agentResult.reviewMemory")}
                      data-testid="ai-chat-review-memory"
                    >
                      <Database className="w-3 h-3" />
                    </button>
                  ) : null}
                  {codeBlocks.length > 0 && activeTabId && (
                    <button
                      onClick={() => {
                        const blocks = codeBlocks;
                        if (blocks.length > 0) {
                          onToggleDiff(msg.id, blocks[0].code);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={t("chat.previewChanges")}
                      aria-label={t("chat.previewChanges")}
                      data-testid="ai-chat-preview-changes"
                    >
                      <GitCompareArrows className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
              {diffCode !== null && activeContent && activeTabId && (
                <DiffPreview
                  original={activeContent}
                  modified={diffCode}
                  onAccept={(result) => {
                    useContentCacheStore.getState().setContent(activeTabId, result);
                    onToggleDiff(msg.id, null);
                  }}
                  onReject={() => onToggleDiff(msg.id, null)}
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
  );
});

export function ChatTimeline({
  onOpenEvidence,
  onOpenWorkbench,
  selectedEvidenceMessageId,
  isEvidencePanelOpen,
}: {
  onOpenEvidence: (messageId: string, ref?: EvidenceRef) => void;
  onOpenWorkbench?: () => void;
  selectedEvidenceMessageId: string | null;
  isEvidencePanelOpen: boolean;
}) {
  const { t } = useI18n();
  const conv = useAiChatStore((s) => s.getActiveConversation());
  const proposalMessageId = useAiPdfCompanionStore((s) => s.sourceMessageId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const [diffState, setDiffState] = useState<{ msgId: string; code: string } | null>(null);
  const onToggleDiff = useCallback((msgId: string, code: string | null) => {
    setDiffState(current => code === null || current?.msgId === msgId ? null : { msgId, code });
  }, []);
  const { rows, lastSessionMessageIds } = useMemo(() => {
    let latestPrompt = "";
    const lastSessionMessageIds = new Map<string, string>();
    const rows: Array<{ msg: ChatMessage; retryPrompt: string }> = [];
    for (const msg of conv?.messages ?? []) {
      if (msg.role === "user") latestPrompt = msg.content.trim();
      if (msg.agentResult?.sessionId) lastSessionMessageIds.set(msg.agentResult.sessionId, msg.id);
      rows.push({ msg, retryPrompt: msg.role === "assistant" && (msg.error || msg.isInterrupted || msg.content.startsWith("Error:")) ? latestPrompt : "" });
    }
    return { rows, lastSessionMessageIds };
  }, [conv?.messages]);

  const scheduleAutoScroll = useCallback(() => {
    if (scrollFrameRef.current !== null || !shouldAutoScrollRef.current) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const scrollElement = scrollRef.current;
      if (scrollElement && shouldAutoScrollRef.current) scrollElement.scrollTop = scrollElement.scrollHeight;
    });
  }, []);
  useEffect(() => {
    scheduleAutoScroll();
  }, [conv?.messages, scheduleAutoScroll]);
  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const handleScroll = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
    shouldAutoScrollRef.current = distanceFromBottom <= CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  if (!conv || conv.messages.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 flex-col items-start justify-start gap-2 overflow-y-auto p-3"
        data-testid="ai-chat-message-scroll"
      >
        <div className="flex w-full flex-col items-start justify-start border-b border-border/60 pb-2" data-testid="ai-chat-empty-state">
          <div className="text-xs font-medium text-foreground">{t("chat.workspace.quickStart")}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t("chat.empty")}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              t("chat.workspace.quickStart.explain"),
              t("chat.workspace.quickStart.summarize"),
              t("chat.workspace.quickStart.plan"),
            ].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => useAiChatStore.getState().setComposerDraft({ text: prompt, mode: "chat" })}
                className="rounded border border-border/70 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
      data-testid="ai-chat-message-scroll"
    >
      {rows.map(({ msg, retryPrompt }) => (
        <ChatMessageRow
          key={msg.id}
          msg={msg}
          retryPrompt={retryPrompt}
          selected={selectedEvidenceMessageId === msg.id}
          isEvidencePanelOpen={isEvidencePanelOpen}
          showDocumentProgress={Boolean(msg.agentResult?.sessionId && lastSessionMessageIds.get(msg.agentResult.sessionId) === msg.id)}
          showProposal={proposalMessageId === msg.id}
          diffCode={diffState?.msgId === msg.id ? diffState.code : null}
          onToggleDiff={onToggleDiff}
          onContentRendered={scheduleAutoScroll}
          onOpenEvidence={onOpenEvidence}
          onOpenWorkbench={onOpenWorkbench}
        />
      ))}
    </div>
  );
}
