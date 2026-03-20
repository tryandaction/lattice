"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { resolveAppRoute } from "@/lib/app-route";
import { createSelectionContext } from "@/lib/ai/selection-context";
import { getMessageText, type AiGenerateOptions, type AiMessage, type AiModel, type AiProvider } from "@/lib/ai/types";
import { clearProviderOverrides, setProviderOverride } from "@/lib/ai/providers";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiWorkbenchStore } from "@/stores/ai-workbench-store";
import { useSelectionAiStore } from "@/stores/selection-ai-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";

const DIAGNOSTICS_MODEL: AiModel = {
  id: "selection-regression",
  name: "Selection Regression",
  provider: "openai",
  contextWindow: 32000,
  supportsStreaming: true,
};

const diagnosticsProvider: AiProvider = {
  id: "openai",
  name: "Diagnostics Local Provider",
  isConfigured: () => true,
  testConnection: async () => ({ ok: true, message: "local diagnostics provider ready" }),
  getAvailableModels: async () => [DIAGNOSTICS_MODEL],
  estimateTokens: (text) => Math.ceil(text.length / 4),
  generate: async (messages: AiMessage[], _options?: AiGenerateOptions) => {
    const system = getMessageText(messages[0]?.content ?? "");
    const user = getMessageText(messages[messages.length - 1]?.content ?? "");

    if (system.includes("safe, half-automatic research task proposal")) {
      return {
        model: DIAGNOSTICS_MODEL.id,
        text: JSON.stringify({
          summary: "Selection regression plan",
          steps: [
            { title: "Review selection", description: "Inspect the selected paragraph and local context." },
            { title: "Draft note", description: "Prepare a reviewable note draft and write target." },
          ],
          requiredApprovals: ["Confirm target note path"],
          plannedWrites: [
            {
              targetPath: "AI Drafts/selection-regression.md",
              mode: "create",
              contentPreview: "Create a structured note from the selected paragraph.",
            },
          ],
        }),
      };
    }

    if (user.includes("Act as a research agent")) {
      return {
        model: DIAGNOSTICS_MODEL.id,
        text: [
          "Conclusion",
          "",
          "Agent result entered the AI Chat with evidence-first framing.",
          "",
          "Evidence",
          "",
          "- diagnostics/selection-regression.md supports the selected claim.",
          "",
          "Next Actions",
          "",
          "- Review the cited evidence and decide whether to create a draft.",
        ].join("\n"),
      };
    }

    return {
      model: DIAGNOSTICS_MODEL.id,
      text: "Quick chat response anchored to the current selection.",
    };
  },
  stream: async function* (messages: AiMessage[], options?: AiGenerateOptions) {
    const result = await diagnosticsProvider.generate(messages, options);
    yield { type: "text", text: result.text };
    yield { type: "done" };
  },
};

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

function resetDiagnosticsStores() {
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
  const preferredMode = useSelectionAiStore((state) => state.preferredMode);
  const recentPrompts = useSelectionAiStore((state) => state.recentPrompts);

  const latestAssistant = useMemo(
    () => [...(activeConversation?.messages ?? [])].reverse().find((message) => message.role === "assistant") ?? null,
    [activeConversation],
  );
  const latestUser = useMemo(
    () => [...(activeConversation?.messages ?? [])].reverse().find((message) => message.role === "user") ?? null,
    [activeConversation],
  );

  const resetState = useCallback(() => {
    resetDiagnosticsStores();
    setHubOpen(true);
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
    <div className="flex h-screen w-screen flex-col bg-background text-foreground" data-testid="selection-ai-regression-ready">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">Selection AI Regression</h1>
          <p className="text-xs text-muted-foreground">
            使用 diagnostics provider override 走真实 Selection AI -&gt; orchestrator -&gt; store 主链路。
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            data-testid="reset-selection-ai-diagnostics"
            onClick={resetState}
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
            <br />
            Assistant provider：<span data-testid="selection-ai-provider">{latestAssistant?.model?.providerName ?? "无"}</span>
            <br />
            Assistant model：<span data-testid="selection-ai-model">{latestAssistant?.model?.model ?? "无"}</span>
          </div>

          <div className="rounded-lg border border-border p-3 leading-6">
            Proposal 数量：<span data-testid="selection-ai-proposal-count">{proposals.length}</span>
            <br />
            高亮 proposal：<span data-testid="selection-ai-highlighted-proposal">{highlightedProposalId ?? "无"}</span>
            <br />
            最近 proposal：<span data-testid="selection-ai-latest-proposal">{proposals[0]?.summary ?? "无"}</span>
          </div>

          <div className="rounded-lg border border-border p-3 leading-6">
            Preferred mode：<span data-testid="selection-ai-preferred-mode">{preferredMode}</span>
            <br />
            Recent prompt 数：<span data-testid="selection-ai-recent-prompt-count">{recentPrompts.length}</span>
            <br />
            最近 prompt：<span data-testid="selection-ai-latest-prompt">{recentPrompts[0]?.prompt ?? "无"}</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
