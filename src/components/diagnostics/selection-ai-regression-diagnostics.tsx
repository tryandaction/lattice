"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { resolveAppRoute } from "@/lib/app-route";
import { createSelectionContext, defaultPromptForSelectionMode, type SelectionAiMode } from "@/lib/ai/selection-context";
import { buildSelectionOrigin } from "@/lib/ai/selection-ui";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { useSelectionAiStore } from "@/stores/selection-ai-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";
import type { AiRuntimeSettings } from "@/lib/ai/types";

function buildDiagnosticsContext() {
  return createSelectionContext({
    sourceKind: "markdown",
    paneId: "selection-ai-diagnostics-pane",
    fileName: "selection-regression.md",
    filePath: "diagnostics/selection-regression.md",
    selectedText: "This selected paragraph should drive Chat, Agent, and Plan through distinct product paths.",
    documentText: [
      "# Selection Regression",
      "",
      "This selected paragraph should drive Chat, Agent, and Plan through distinct product paths.",
      "",
      "Additional local context helps validate evidence and workbench wiring.",
    ].join("\n"),
    contextText: "Additional local context helps validate evidence and workbench wiring.",
    blockLabel: "Selection Regression",
  });
}

export function SelectionAiRegressionDiagnostics() {
  const pdfHref = resolveAppRoute("/diagnostics/pdf-regression");
  const imageHref = resolveAppRoute("/diagnostics/image-annotation");
  const [hubOpen, setHubOpen] = useState(true);
  const context = useMemo(() => buildDiagnosticsContext(), []);

  const activeConversation = useAiChatStore((state) =>
    state.conversations.find((conversation) => conversation.id === state.activeConversationId) ?? null,
  );
  const highlightedProposalId = useAiWorkbenchStore((state) => state.highlightedProposalId);
  const proposals = useAiWorkbenchStore((state) => state.proposals);

  const latestAssistant = useMemo(
    () => [...(activeConversation?.messages ?? [])].reverse().find((message) => message.role === "assistant") ?? null,
    [activeConversation],
  );
  const latestUser = useMemo(
    () => [...(activeConversation?.messages ?? [])].reverse().find((message) => message.role === "user") ?? null,
    [activeConversation],
  );

  useEffect(() => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useAiChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isOpen: false,
      isGenerating: false,
      abortController: null,
    });
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
      highlightedProposalId: null,
    });
    useSelectionAiStore.setState({
      preferredMode: "chat",
      recentPrompts: [],
    });
  }, []);

  const runMode = useCallback(async (input: {
    context: typeof context;
    mode: SelectionAiMode;
    prompt: string;
    settings: AiRuntimeSettings;
  }): Promise<{ kind: "chat" | "proposal"; title: string }> => {
    const origin = buildSelectionOrigin(input.context, input.mode);
    const chatStore = useAiChatStore.getState();
    const workbenchStore = useAiWorkbenchStore.getState();
    const displayPrompt = input.prompt.trim() || defaultPromptForSelectionMode(input.mode, input.context);

    if (input.mode === "plan") {
      workbenchStore.addProposal({
        id: "selection-regression-proposal",
        summary: "Selection regression mock plan",
        steps: [
          { id: "step-1", title: "Review selection", description: "Inspect the selected paragraph and local context." },
        ],
        requiredApprovals: ["Confirm target note path"],
        plannedWrites: [
          {
            targetPath: "AI Drafts/selection-regression.md",
            mode: "create",
            contentPreview: "Create a structured plan draft from the selected paragraph.",
          },
        ],
        sourceRefs: input.context.evidenceRefs,
        status: "pending",
        confirmedApprovals: [],
        approvedWrites: ["AI Drafts/selection-regression.md"],
        generatedDraftTargets: [],
        createdAt: Date.now(),
        origin,
      });
      chatStore.setOpen(true);
      return { kind: "proposal", title: "Selection regression mock plan" };
    }

    chatStore.setOpen(true);
    chatStore.addUserMessage(displayPrompt, { origin });
    const messageId = chatStore.startAssistantMessage();
    chatStore.appendToAssistantMessage(
      messageId,
      input.mode === "agent"
        ? "Conclusion\n\nMock agent analysis with explicit evidence.\n\nNext Actions\n\nReview the linked source."
        : "Quick chat response anchored to the current selection.",
    );
    chatStore.finishAssistantMessage(messageId);
    chatStore.setAssistantMetadata(messageId, {
      model: {
        providerId: "openai",
        providerName: "Mock Diagnostics",
        model: "selection-regression",
        source: "cloud",
      },
      evidenceRefs: input.mode === "agent" ? input.context.evidenceRefs : [],
      promptContext: {
        nodes: [],
        prompt: displayPrompt,
        evidenceRefs: input.mode === "agent" ? input.context.evidenceRefs : [],
        truncated: false,
      },
      followUpActions: [],
      origin,
    });

    return { kind: "chat", title: displayPrompt };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground" data-testid="selection-ai-regression-ready">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">Selection AI Regression</h1>
          <p className="text-xs text-muted-foreground">
            使用 mocked runner 验证 Chat / Agent / Plan 三种入口进入正确主链路。
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            data-testid="reset-selection-ai-diagnostics"
            onClick={() => {
              useAiChatStore.setState({
                conversations: [],
                activeConversationId: null,
                isOpen: false,
                isGenerating: false,
                abortController: null,
              });
              useAiWorkbenchStore.setState({
                drafts: [],
                proposals: [],
                highlightedProposalId: null,
              });
              setHubOpen(true);
            }}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            重置状态
          </button>
          <Link href={pdfHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            PDF 分屏诊断
          </Link>
          <Link href={imageHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            图片句柄诊断
          </Link>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-3 overflow-hidden p-3">
        <section className="min-h-0 overflow-auto rounded-xl border border-border">
          {hubOpen ? (
            <SelectionAiHub
              context={context}
              initialMode="chat"
              runMode={runMode}
              onClose={() => setHubOpen(false)}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <button
                type="button"
                data-testid="reopen-selection-ai-hub"
                onClick={() => setHubOpen(true)}
                className="rounded border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                重新打开 Selection AI Hub
              </button>
            </div>
          )}
        </section>

        <aside className="space-y-3 overflow-auto rounded-xl border border-border p-3 text-xs text-muted-foreground">
          <div className="rounded-lg border border-dashed border-border p-3 leading-6">
            当前选区来源：{context.sourceLabel}
            <br />
            最近用户 prompt：<span data-testid="selection-ai-latest-user">{latestUser?.content ?? "无"}</span>
            <br />
            最近 assistant origin：<span data-testid="selection-ai-latest-origin">{latestAssistant?.origin?.mode ?? "无"}</span>
            <br />
            最近 evidence 数量：<span data-testid="selection-ai-evidence-count">{latestAssistant?.evidenceRefs?.length ?? 0}</span>
          </div>

          <div className="rounded-lg border border-border p-3 leading-6">
            Proposal 数量：<span data-testid="selection-ai-proposal-count">{proposals.length}</span>
            <br />
            高亮 proposal：<span data-testid="selection-ai-highlighted-proposal">{highlightedProposalId ?? "无"}</span>
            <br />
            最近 proposal：<span data-testid="selection-ai-latest-proposal">{proposals[0]?.summary ?? "无"}</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
