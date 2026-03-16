"use client";

import { useState, useCallback } from "react";
import { Sparkles, FileText, Search, MessageSquare, Loader2, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { aiOrchestrator } from "@/lib/ai/orchestrator";
import type { AiRuntimeSettings } from "@/lib/ai/types";

interface PdfAiPanelProps {
  /** Extracted text content from the PDF */
  pdfText: string;
  /** File name for context */
  fileName: string;
  /** Close handler */
  onClose: () => void;
}

type PdfAction = "summarize" | "findings" | "ask";

export function PdfAiPanel({ pdfText, fileName: _fileName, onClose }: PdfAiPanelProps) {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<PdfAction | null>(null);
  const [question, setQuestion] = useState("");
  const settings = useSettingsStore((s) => s.settings);

  const runAction = useCallback(async (action: PdfAction, userQuestion?: string) => {
    if (!settings.aiEnabled) return;

    setLoading(true);
    setActiveAction(action);
    setResult("");

    const truncatedText = pdfText.length > 12000 ? pdfText.slice(0, 12000) + "\n\n[... truncated]" : pdfText;
    const runtimeSettings: AiRuntimeSettings = {
      aiEnabled: settings.aiEnabled,
      providerId: (settings.aiProvider as AiRuntimeSettings["providerId"]) ?? null,
      model: settings.aiModel,
      temperature: settings.aiTemperature,
      maxTokens: settings.aiMaxTokens,
      systemPrompt: settings.aiSystemPrompt,
      preferLocal: settings.aiProvider === "ollama",
    };

    let researchAction: "summarize_paper" | "extract_findings" | "answer_question";
    let prompt: string;

    switch (action) {
      case "summarize":
        researchAction = "summarize_paper";
        prompt = `File: ${_fileName}\n\n${truncatedText}`;
        break;
      case "findings":
        researchAction = "extract_findings";
        prompt = `File: ${_fileName}\n\n${truncatedText}`;
        break;
      case "ask":
        researchAction = "answer_question";
        prompt = `Paper content:\n\n${truncatedText}\n\nQuestion: ${userQuestion}`;
        break;
    }

    try {
      const response = await aiOrchestrator.runResearchAction({
        action: researchAction,
        prompt,
        content: truncatedText,
        filePath: _fileName,
        settings: runtimeSettings,
      });
      setResult(response.text);
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    }
    setLoading(false);
  }, [pdfText, settings, _fileName]);

  const handleAsk = useCallback(() => {
    if (!question.trim()) return;
    runAction("ask", question);
  }, [question, runAction]);

  if (!settings.aiEnabled) {
    return (
      <div className="w-80 border-l border-border bg-background p-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">AI Assistant</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">Enable AI in Settings to use this feature.</p>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-border bg-background flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Paper AI</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Actions */}
      <div className="p-2 space-y-1 border-b border-border">
        <button
          onClick={() => runAction("summarize")}
          disabled={loading}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          Summarize Paper
        </button>
        <button
          onClick={() => runAction("findings")}
          disabled={loading}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          Extract Key Findings
        </button>
      </div>

      {/* Ask question */}
      <div className="p-2 border-b border-border">
        <div className="flex gap-1">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            placeholder="Ask about this paper..."
            className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={loading}
          />
          <button
            onClick={handleAsk}
            disabled={loading || !question.trim()}
            className="rounded bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Result */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && !result && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{activeAction === "summarize" ? "Summarizing..." : activeAction === "findings" ? "Extracting..." : "Thinking..."}</span>
          </div>
        )}
        {result && (
          <div className="text-xs whitespace-pre-wrap break-words leading-relaxed">
            {result}
            {loading && <span className="animate-pulse">▊</span>}
          </div>
        )}
        {!loading && !result && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Select an action above or ask a question about this paper.
          </p>
        )}
      </div>
    </div>
  );
}

export default PdfAiPanel;
