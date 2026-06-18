"use client";

import { useState, useCallback } from "react";
import { Loader2, Wand2, AlertCircle, BarChart3 } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { aiOrchestrator } from "@/lib/ai/orchestrator";
import type { AiRuntimeSettings } from "@/lib/ai/types";
import {
  createAgentToolSession,
  executeAgentTool,
} from "@/lib/ai/agent-tool-broker";
import { useAgentSessionStore } from "@/stores/agent-session-store";

interface NotebookAiAssistProps {
  /** Current cell source code */
  cellSource: string;
  /** Cell outputs as text (for interpretation) */
  cellOutput?: string;
  /** Error text (for explanation) */
  cellError?: string;
  /** Callback to insert generated code */
  onInsertCode: (code: string) => void;
}

type AiAction = "generate" | "explain-error" | "interpret-output";

function failSessionIfOpen(sessionId: string, error: string) {
  const store = useAgentSessionStore.getState();
  const session = store.getSession(sessionId);
  if (!session || session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
    return;
  }
  store.failSession(sessionId, error);
}

export function NotebookAiAssist({ cellSource, cellOutput, cellError, onInsertCode }: NotebookAiAssistProps) {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [prompt, setPrompt] = useState("");
  const settings = useSettingsStore((s) => s.settings);

  const runAction = useCallback(async (action: AiAction) => {
    if (!settings.aiEnabled) return;

    setLoading(true);
    setShowResult(true);
    setResult("");

    const runtimeSettings: AiRuntimeSettings = {
      aiEnabled: settings.aiEnabled,
      providerId: (settings.aiProvider as AiRuntimeSettings["providerId"]) ?? null,
      model: settings.aiModel,
      temperature: settings.aiTemperature,
      maxTokens: settings.aiMaxTokens,
      systemPrompt: settings.aiSystemPrompt,
      preferLocal: settings.aiProvider === "ollama",
      agentOmittedSummaryEnabled: settings.aiAgentOmittedSummaryEnabled,
    };

    let researchAction: "answer_question" | "explain_code" | "interpret_output";
    let userPrompt = "";

    switch (action) {
      case "generate":
        researchAction = "answer_question";
        userPrompt = prompt
          ? `Generate Python code: ${prompt}\n\nExisting code context:\n${cellSource}`
          : `Continue or improve this code:\n${cellSource}`;
        break;
      case "explain-error":
        researchAction = "explain_code";
        userPrompt = `Code:\n${cellSource}\n\nError:\n${cellError}`;
        break;
      case "interpret-output":
        researchAction = "interpret_output";
        userPrompt = `Code:\n${cellSource}\n\nOutput:\n${cellOutput}`;
        break;
    }

    const agentStore = useAgentSessionStore.getState();
    const sessionId = createAgentToolSession({
      profile: "research",
      task: `Notebook AI assist: ${action}`,
      title: `Notebook AI - ${action}`,
    });

    try {
      const resolvedContext = await executeAgentTool({
        name: "evidence.resolve",
        args: {
          filePath: "notebook-cell.py",
          content: cellSource,
          selection: cellSource,
          query: userPrompt,
        },
      }, { sessionId });

      if (resolvedContext.status === "denied" || resolvedContext.status === "failed") {
        throw new Error(resolvedContext.error ?? "Notebook context resolution failed.");
      }

      agentStore.appendTrace(sessionId, {
        kind: "planning",
        message: `Notebook AI action ${action} is running with resolved cell context.`,
        evidenceRefs: resolvedContext.result?.evidenceRefs,
      });

      const response = await aiOrchestrator.runResearchAction({
        action: researchAction,
        prompt: userPrompt,
        content: cellSource,
        selection: cellSource,
        explicitEvidenceRefs: resolvedContext.result?.evidenceRefs,
        settings: runtimeSettings,
      });
      setResult(response.text);
      agentStore.appendTrace(sessionId, {
        kind: "completed",
        message: response.text.slice(0, 240) || "Notebook AI assist completed.",
        model: response.model,
        evidenceRefs: response.evidenceRefs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult(`Error: ${message}`);
      failSessionIfOpen(sessionId, message);
    }
    setLoading(false);
  }, [cellSource, cellOutput, cellError, prompt, settings]);

  if (!settings.aiEnabled) return null;

  return (
    <div className="mt-1">
      {/* Action buttons row */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* Generate code with prompt */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAction("generate")}
            placeholder="Ask AI to generate code..."
            className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={loading}
          />
          <button
            onClick={() => runAction("generate")}
            disabled={loading}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
            title="Generate code"
          >
            <Wand2 className="h-3 w-3" />
          </button>
        </div>

        {cellError && (
          <button
            onClick={() => runAction("explain-error")}
            disabled={loading}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            title="Explain error"
          >
            <AlertCircle className="h-3 w-3" />
            <span className="hidden sm:inline">Explain</span>
          </button>
        )}

        {cellOutput && (
          <button
            onClick={() => runAction("interpret-output")}
            disabled={loading}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
            title="Interpret output"
          >
            <BarChart3 className="h-3 w-3" />
            <span className="hidden sm:inline">Interpret</span>
          </button>
        )}
      </div>

      {/* Result area */}
      {showResult && (
        <div className="mt-1.5 rounded border border-border bg-muted/30 p-2 relative group/result">
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/result:opacity-100 transition-opacity z-10">
            {!loading && result && (
              <button
                onClick={() => onInsertCode(result)}
                className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20"
              >
                Insert
              </button>
            )}
            <button
              onClick={() => { setShowResult(false); setResult(""); }}
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              title="Close"
            >✕</button>
          </div>
          <div className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed font-mono pr-14">
            {loading && !result && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {result}
            {loading && result && <span className="animate-pulse">▊</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotebookAiAssist;
