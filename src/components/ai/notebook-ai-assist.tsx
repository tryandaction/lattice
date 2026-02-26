"use client";

import { useState, useCallback } from "react";
import { Loader2, Wand2, AlertCircle, BarChart3 } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { getDefaultProvider, getProvider } from "@/lib/ai/providers";
import type { AiProviderId } from "@/lib/ai/types";

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

export function NotebookAiAssist({ cellSource, cellOutput, cellError, onInsertCode }: NotebookAiAssistProps) {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [prompt, setPrompt] = useState("");
  const settings = useSettingsStore((s) => s.settings);

  const getAiProvider = useCallback(() => {
    if (!settings.aiEnabled) return null;
    const providerId = (settings.aiProvider ?? undefined) as AiProviderId | undefined;
    return providerId ? getProvider(providerId) : getDefaultProvider();
  }, [settings]);

  const runAction = useCallback(async (action: AiAction) => {
    const provider = getAiProvider();
    if (!provider) return;

    setLoading(true);
    setShowResult(true);
    setResult("");

    let systemPrompt = "";
    let userPrompt = "";

    switch (action) {
      case "generate":
        systemPrompt = "You are a Python coding assistant for Jupyter notebooks. Generate clean, well-commented Python code. Return ONLY the code, no markdown fences.";
        userPrompt = prompt
          ? `Generate Python code: ${prompt}\n\nExisting code context:\n${cellSource}`
          : `Continue or improve this code:\n${cellSource}`;
        break;
      case "explain-error":
        systemPrompt = "You are a Python debugging assistant. Explain the error concisely and suggest a fix.";
        userPrompt = `Code:\n${cellSource}\n\nError:\n${cellError}`;
        break;
      case "interpret-output":
        systemPrompt = "You are a data science assistant. Interpret the output of this code concisely.";
        userPrompt = `Code:\n${cellSource}\n\nOutput:\n${cellOutput}`;
        break;
    }

    try {
      const stream = provider.stream(
        [{ role: "user", content: userPrompt }],
        { systemPrompt, temperature: 0.3 }
      );

      let accumulated = "";
      for await (const chunk of stream) {
        if (chunk.type === "text" && chunk.text) {
          accumulated += chunk.text;
          setResult(accumulated);
        } else if (chunk.type === "error") {
          setResult(`Error: ${chunk.error}`);
          break;
        }
      }
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    }
    setLoading(false);
  }, [cellSource, cellOutput, cellError, prompt, getAiProvider]);

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
