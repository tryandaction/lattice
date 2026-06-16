"use client";

import { useCallback, useEffect, useMemo } from "react";
import { AiChatPanel } from "@/components/ai/ai-chat-panel";
import { AgentTracePanel } from "@/components/ai/agent-trace-panel";
import { executeAgentTool } from "@/lib/ai/agent-tool-broker";
import { getMessageText, type AiGenerateOptions, type AiMessage, type AiModel, type AiProvider } from "@/lib/ai/types";
import { clearProviderOverrides, setProviderOverride } from "@/lib/ai/providers";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { PaneNode, TabState } from "@/types/layout";
import { DEFAULT_SETTINGS } from "@/types/settings";

const DIAGNOSTICS_MODEL: AiModel = {
  id: "ai-chat-research-regression",
  name: "AI Chat Research Regression",
  provider: "openai",
  contextWindow: 32000,
  supportsStreaming: true,
};

const DIAGNOSTICS_PANE_ID = "pane-ai-chat-research-agent-diagnostics";
const DIAGNOSTICS_TAB_ID = "tab-ai-chat-research-agent-diagnostics";
const DIAGNOSTICS_FILE_NAME = "ai-chat-research-agent.md";
const DIAGNOSTICS_FILE_PATH = `diagnostics/${DIAGNOSTICS_FILE_NAME}`;
const DIAGNOSTICS_CONTENT = [
  "# AI Chat Research Agent Diagnostics",
  "",
  "This file validates the product-facing AI Chat Research Agent path.",
  "",
  "The agent should collect current file context, resolve evidence, write an evidence-backed answer into chat, and keep planner audit metadata visible after compaction.",
].join("\n");

const diagnosticsProvider: AiProvider = {
  id: "openai",
  name: "AI Chat Diagnostics Local Provider",
  isConfigured: () => true,
  testConnection: async () => ({ ok: true, message: "local diagnostics provider ready" }),
  getAvailableModels: async () => [DIAGNOSTICS_MODEL],
  estimateTokens: (text) => Math.ceil(text.length / 4),
  generate: async (messages: AiMessage[], _options?: AiGenerateOptions) => {
    const system = getMessageText(messages[0]?.content ?? "");
    const user = getMessageText(messages[messages.length - 1]?.content ?? "");

    if (system.includes("planning module") || user.includes("You are planning a Lattice Research Agent run")) {
      return {
        model: DIAGNOSTICS_MODEL.id,
        text: JSON.stringify({
          steps: [
            {
              id: "context-pack",
              title: "Collect AI Chat diagnostics context",
              description: "Collect active file and prompt context from AI Chat.",
            },
            {
              id: "evidence-resolve",
              title: "Resolve AI Chat diagnostics evidence",
              description: "Resolve evidence through the Tool Broker.",
              toolName: "evidence.resolve",
            },
            {
              id: "synthesize-answer",
              title: "Synthesize AI Chat diagnostics answer",
              description: "Write an evidence-backed answer into AI Chat.",
            },
          ],
        }),
      };
    }

    return {
      model: DIAGNOSTICS_MODEL.id,
      text: "AI Chat diagnostics provider response.",
    };
  },
  stream: async function* (messages: AiMessage[], options?: AiGenerateOptions) {
    const result = await diagnosticsProvider.generate(messages, options);
    yield { type: "text", text: result.text };
    yield { type: "done" };
  },
};

function createDiagnosticsFileHandle(): FileSystemFileHandle {
  return {
    kind: "file",
    name: DIAGNOSTICS_FILE_NAME,
    getFile: async () => new File([DIAGNOSTICS_CONTENT], DIAGNOSTICS_FILE_NAME, { type: "text/markdown" }),
  } as FileSystemFileHandle;
}

function createDiagnosticsTab(): TabState {
  return {
    id: DIAGNOSTICS_TAB_ID,
    kind: "file",
    fileHandle: createDiagnosticsFileHandle(),
    fileName: DIAGNOSTICS_FILE_NAME,
    filePath: DIAGNOSTICS_FILE_PATH,
    isDirty: false,
    scrollPosition: 0,
  };
}

function resetDiagnosticsStores() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("lattice-ai-chat");
  }

  const tab = createDiagnosticsTab();
  const pane: PaneNode = {
    type: "pane",
    id: DIAGNOSTICS_PANE_ID,
    tabs: [tab],
    activeTabIndex: 0,
  };

  useContentCacheStore.getState().clearCache();
  useContentCacheStore.getState().setContent(DIAGNOSTICS_TAB_ID, DIAGNOSTICS_CONTENT, DIAGNOSTICS_CONTENT);
  useAiChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isOpen: true,
    isGenerating: false,
    abortController: null,
  });
  useAiWorkbenchStore.setState({
    drafts: [],
    proposals: [],
    highlightedProposalId: null,
  });
  useAgentSessionStore.setState({
    sessions: [],
    activeSessionId: null,
  });
  useWorkspaceStore.setState({
    rootHandle: null,
    workspaceRootHandle: null,
    workspaceRootPath: "diagnostics",
    workspaceIdentity: {
      workspaceKey: "diagnostics-ai-chat-research-agent",
      displayPath: "diagnostics",
      rootName: "diagnostics",
      hostKind: "web",
      handleFingerprint: null,
      lastUsedAt: Date.now(),
    },
    layout: {
      root: pane,
      activePaneId: DIAGNOSTICS_PANE_ID,
    },
  });
}

export function AiChatResearchAgentDiagnostics() {
  const activeConversation = useAiChatStore((state) =>
    state.conversations.find((conversation) => conversation.id === state.activeConversationId) ?? null,
  );
  const isGenerating = useAiChatStore((state) => state.isGenerating);
  const activeAgentSession = useAgentSessionStore((state) =>
    state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0] ?? null,
  );
  const drafts = useAiWorkbenchStore((state) => state.drafts);
  const proposals = useAiWorkbenchStore((state) => state.proposals);

  const latestAssistant = useMemo(
    () => [...(activeConversation?.messages ?? [])].reverse().find((message) => message.role === "assistant") ?? null,
    [activeConversation],
  );
  const latestUser = useMemo(
    () => [...(activeConversation?.messages ?? [])].reverse().find((message) => message.role === "user") ?? null,
    [activeConversation],
  );
  const planCreatedEvent = useMemo(
    () => activeAgentSession?.trace.find((event) =>
      event.kind === "planning" && typeof event.metadata?.planSource === "string",
    ) ?? null,
    [activeAgentSession],
  );
  const latestCompaction = activeAgentSession?.compactions.at(-1) ?? null;
  const approvalCounts = useMemo(() => {
    const approvals = activeAgentSession?.pendingApprovals ?? [];
    return {
      pending: approvals.filter((approval) => approval.status === "pending").length,
      completed: approvals.filter((approval) => approval.status === "completed").length,
      failed: approvals.filter((approval) => approval.status === "failed" || approval.status === "rejected").length,
      tools: approvals.map((approval) => `${approval.toolName}:${approval.status}`).join(",") || "none",
      latestResult: [...approvals].reverse().find((approval) => approval.resultPreview)?.resultPreview ?? "none",
    };
  }, [activeAgentSession]);
  const latestDraft = drafts[0] ?? null;
  const latestProposal = proposals[0] ?? null;
  const latestWorkflowLabel = latestAssistant?.agentResult?.workflowLabel ?? "none";
  const latestWorkflowInferred = String(Boolean(latestAssistant?.agentResult?.workflowInferred));
  const latestFollowUpKinds = latestAssistant?.followUpActions?.map((action) => action.kind).join(",") || "none";
  const latestDraftSuggestionTitle = latestAssistant?.draftSuggestion?.title ?? "none";
  const hasLatestDraftAction = Boolean(latestAssistant?.followUpActions?.some((action) => action.kind === "create_draft"));
  const hasLatestProposalAction = Boolean(latestAssistant?.followUpActions?.some((action) => action.kind === "propose_task"));
  const latestWorkbenchMode = hasLatestDraftAction && hasLatestProposalAction
    ? "draft-and-proposal"
    : hasLatestDraftAction
      ? "draft-ready"
      : hasLatestProposalAction
        ? "proposal-ready"
        : latestAssistant
          ? "answer-only"
          : "none";

  const resetState = useCallback(() => {
    resetDiagnosticsStores();
  }, []);

  const createApprovalFixture = useCallback(async () => {
    const store = useAgentSessionStore.getState();
    const sessionId = "agent-session-diagnostics-approval";
    store.createSession({
      id: sessionId,
      profile: "research",
      task: "Diagnostics approval fixture",
      title: "Diagnostics approval fixture",
      now: Date.now(),
    });
    store.appendTrace(sessionId, {
      id: `${sessionId}:plan-created`,
      kind: "planning",
      timestamp: Date.now(),
      message: "Created diagnostics approval fixture plan.",
      metadata: {
        agentKind: "research_agent",
        planSource: "diagnostics",
        planStepCount: 1,
        planWarningCount: 0,
      },
    });
    await executeAgentTool({
      name: "runner.runCode",
      args: {
        language: "javascript",
        code: "console.log('diagnostics approval ok')",
      },
    }, { sessionId });
  }, []);

  useEffect(() => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiProvider: "openai",
        aiModel: DIAGNOSTICS_MODEL.id,
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    resetDiagnosticsStores();
    setProviderOverride("openai", diagnosticsProvider);

    return () => {
      clearProviderOverrides();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground" data-testid="ai-chat-research-agent-ready">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">AI Chat Research Agent Regression</h1>
          <p className="text-xs text-muted-foreground">
            Product-facing AI Chat Research Agent path with diagnostics provider override.
          </p>
        </div>

        <button
          type="button"
          data-testid="reset-ai-chat-research-agent-diagnostics"
          onClick={resetState}
          className="ml-auto rounded border border-border px-3 py-1 text-xs hover:bg-muted"
        >
          Reset
        </button>
        <button
          type="button"
          data-testid="create-ai-chat-agent-approval-fixture"
          onClick={() => void createApprovalFixture()}
          className="rounded border border-border px-3 py-1 text-xs hover:bg-muted"
        >
          Create approval fixture
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-3 p-3">
        <section className="min-h-0 rounded-lg border border-border">
          <AiChatPanel className="h-full" />
        </section>

        <aside className="min-h-0 overflow-auto rounded-lg border border-border bg-muted/20 p-3 text-xs leading-6">
          <div className="rounded-lg border border-border bg-background p-3">
            Latest user: <span data-testid="ai-chat-latest-user">{latestUser?.content ?? "none"}</span>
            <br />
            Latest assistant: <span data-testid="ai-chat-latest-assistant">{latestAssistant?.content.slice(0, 240) ?? "none"}</span>
            <br />
            Chat generating: <span data-testid="ai-chat-is-generating">{String(isGenerating)}</span>
            <br />
            Evidence count: <span data-testid="ai-chat-evidence-count">{latestAssistant?.evidenceRefs?.length ?? 0}</span>
            <br />
            Prompt context nodes: <span data-testid="ai-chat-prompt-context-node-count">{latestAssistant?.promptContext?.nodes.length ?? 0}</span>
            <br />
            Assistant model: <span data-testid="ai-chat-assistant-model">{latestAssistant?.model?.model ?? "none"}</span>
            <br />
            Workflow label: <span data-testid="ai-chat-workflow-label">{latestWorkflowLabel}</span>
            <br />
            Workflow inferred: <span data-testid="ai-chat-workflow-inferred">{latestWorkflowInferred}</span>
            <br />
            Workbench mode: <span data-testid="ai-chat-workbench-mode">{latestWorkbenchMode}</span>
            <br />
            Follow-up actions: <span data-testid="ai-chat-follow-up-kinds">{latestFollowUpKinds}</span>
            <br />
            Draft suggestion: <span data-testid="ai-chat-draft-suggestion-title">{latestDraftSuggestionTitle}</span>
            <br />
            Save draft visible: <span data-testid="ai-chat-save-draft-visible">{String(hasLatestDraftAction)}</span>
            <br />
            Proposal visible: <span data-testid="ai-chat-proposal-visible">{String(hasLatestProposalAction)}</span>
            <br />
            Workbench draft count: <span data-testid="ai-chat-workbench-draft-count">{drafts.length}</span>
            <br />
            Latest draft title: <span data-testid="ai-chat-workbench-latest-draft-title">{latestDraft?.title ?? "none"}</span>
            <br />
            Workbench proposal count: <span data-testid="ai-chat-workbench-proposal-count">{proposals.length}</span>
            <br />
            Latest proposal title: <span data-testid="ai-chat-workbench-latest-proposal-title">{latestProposal?.summary ?? "none"}</span>
          </div>

          <div className="mt-3 rounded-lg border border-border bg-background p-3">
            Agent session: <span data-testid="ai-chat-agent-session-id">{activeAgentSession?.id ?? "none"}</span>
            <br />
            Agent status: <span data-testid="ai-chat-agent-status">{activeAgentSession?.status ?? "none"}</span>
            <br />
            Agent trace count: <span data-testid="ai-chat-agent-trace-count">{activeAgentSession?.trace.length ?? 0}</span>
            <br />
            Plan source: <span data-testid="ai-chat-agent-plan-source">{String(planCreatedEvent?.metadata?.planSource ?? "none")}</span>
            <br />
            Plan warnings: <span data-testid="ai-chat-agent-plan-warning-count">{String(planCreatedEvent?.metadata?.planWarningCount ?? "0")}</span>
            <br />
            Planner prompt preview: <span data-testid="ai-chat-agent-planner-prompt-preview">{String(planCreatedEvent?.metadata?.plannerPromptPreview ?? "none")}</span>
            <br />
            Planner raw preview: <span data-testid="ai-chat-agent-planner-raw-preview">{String(planCreatedEvent?.metadata?.plannerRawOutputPreview ?? "none")}</span>
            <br />
            Compaction count: <span data-testid="ai-chat-agent-compaction-count">{activeAgentSession?.compactions.length ?? 0}</span>
            <br />
            Latest compaction: <span data-testid="ai-chat-agent-latest-compaction">{latestCompaction?.summary ?? "none"}</span>
            <br />
            Pending approvals: <span data-testid="ai-chat-agent-pending-approval-count">{approvalCounts.pending}</span>
            <br />
            Completed approvals: <span data-testid="ai-chat-agent-completed-approval-count">{approvalCounts.completed}</span>
            <br />
            Failed approvals: <span data-testid="ai-chat-agent-failed-approval-count">{approvalCounts.failed}</span>
            <br />
            Approval tools: <span data-testid="ai-chat-agent-approval-tools">{approvalCounts.tools}</span>
            <br />
            Latest approval result: <span data-testid="ai-chat-agent-latest-approval-result">{approvalCounts.latestResult}</span>
          </div>

          <div
            className="mt-3 rounded-lg border border-border bg-background"
            data-testid="ai-chat-agent-approval-trace"
          >
            <AgentTracePanel
              runCode={async () => ({ output: "diagnostics approval ok" })}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
