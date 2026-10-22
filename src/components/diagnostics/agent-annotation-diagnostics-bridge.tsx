"use client";

import { useEffect, useState } from "react";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiPdfCompanionStore } from "@/stores/ai-pdf-companion-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentSessionStore } from '@/stores/agent-session-store';

/** Isolated regression setup only: the real provider performs real loopback HTTP. */
export function AgentAnnotationDiagnosticsBridge() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chat = useAiChatStore((state) => JSON.stringify({
    generating: state.isGenerating,
    latest: state.conversations.find((item) => item.id === state.activeConversationId)?.messages.filter((message) => message.role === "assistant").at(-1),
  }));
  const review = useAiPdfCompanionStore((state) => JSON.stringify({
    proposed: state.transientAnnotations, saved: state.savedAnnotations,
    pendingInjection: state.pendingInjection, pendingUndo: state.pendingUndo,
    error: state.error, sourceMessageId: state.sourceMessageId,
  }));
  const task = useAgentSessionStore(state => JSON.stringify(state.sessions.find(session => session.id === state.activeSessionId) ?? null));
  useEffect(() => {
    let disposed = false;
    const initialize = async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const endpoint = new URL(params.get("agentEndpoint") ?? "");
      if (params.get("isolatedAgentTest") !== "1" || endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname)) {
        throw new Error("Agent annotation diagnostics require an isolated session and a loopback HTTP endpoint");
      }
      const profile = {
        ...createDefaultAiProviderProfile("custom-anthropic-messages", {
          id: "diagnostics-annotation-loopback", name: "Local mock — no external AI", model: "local-fixture", baseUrl: endpoint.href.replace(/\/$/, ""), isDefault: true,
        }),
        authMode: "none" as const, maxRetries: 0,
      };
      const diagnosticLimit = (name: string, current: number, maximum: number) => {
        const raw = params.get(name), value = raw === null ? NaN : Number(raw);
        return Number.isFinite(value) ? Math.max(1000, Math.min(maximum, value)) : current;
      };
      profile.timeoutMs = diagnosticLimit('agentIdleMs', profile.timeoutMs, 300000);
      profile.firstResponseTimeoutMs = diagnosticLimit('agentFirstResponseMs', profile.firstResponseTimeoutMs ?? 120000, 300000);
      profile.maxRequestDurationMs = diagnosticLimit('agentTotalMs', profile.maxRequestDurationMs ?? 600000, 1800000);
      // No persistence API: this fixture changes only the isolated page's stores.
      useAiProviderProfileStore.setState({ profiles: [profile], activeProfileId: profile.id, isInitialized: true, isLoading: false, error: null });
      useSettingsStore.setState((state) => ({ settings: { ...state.settings, aiEnabled: true, aiProvider: "custom", aiModel: "local-fixture", aiMaxTokens: diagnosticLimit('agentMaxTokens', state.settings.aiMaxTokens, 128000) } }));
      useAiPdfCompanionStore.getState().clear();
      useAiChatStore.setState({ conversations: [], activeConversationId: null, isOpen: true, composerMode: "chat", selectedResearchWorkflowId: null, isGenerating: false, abortController: null });
      useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
      if (params.get('agentRestore') === '1') {
        await Promise.all([useAgentSessionStore.getState().loadSessions(), useAiChatStore.getState().loadConversations()]);
        useAiChatStore.setState({ isOpen: true, isGenerating: false, abortController: null });
      }
      if (!disposed) setReady(true);
    } catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    void initialize();
    return () => { disposed = true; };
  }, []);
  return <>
    <p data-testid="local-agent-test-notice" role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-950">本机模拟接口测试 / Local mock: no external AI requests. 此窗口仅验证产品流程，不代表真实模型回答质量。</p>
    {error && <p role="alert">{error}</p>}
    <output hidden data-testid="agent-annotation-diagnostics">{JSON.stringify({ ready, error, chat: JSON.parse(chat), review: JSON.parse(review), task: JSON.parse(task) })}</output>
  </>;
}
