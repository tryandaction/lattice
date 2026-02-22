"use client";

import { useState, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { getDefaultProvider, getProvider } from "@/lib/ai/providers";
import {
  summarizeSelection,
  translateText,
  explainFormula,
  improveWriting,
  continueWriting,
} from "@/lib/ai/inline-actions";
import {
  Sparkles,
  Languages,
  FileText,
  Pencil,
  ArrowRight,
  X,
  Loader2,
  Calculator,
} from "lucide-react";
import type { AiProviderId } from "@/lib/ai/types";

interface AiInlineMenuProps {
  selectedText: string;
  position: { x: number; y: number };
  onInsert: (text: string) => void;
  onReplace: (text: string) => void;
  onClose: () => void;
}

type ActionId = "summarize" | "translate" | "explain" | "improve" | "continue";

const ACTIONS: Array<{ id: ActionId; label: string; icon: typeof Sparkles }> = [
  { id: "summarize", label: "Summarize", icon: FileText },
  { id: "improve", label: "Improve Writing", icon: Pencil },
  { id: "translate", label: "Translate", icon: Languages },
  { id: "explain", label: "Explain Formula", icon: Calculator },
  { id: "continue", label: "Continue Writing", icon: ArrowRight },
];

export function AiInlineMenu({ selectedText, position, onInsert, onReplace, onClose }: AiInlineMenuProps) {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const settings = useSettingsStore((s) => s.settings);

  const runAction = useCallback(async (actionId: ActionId) => {
    if (!settings.aiEnabled) return;

    const providerId = (settings.aiProvider ?? undefined) as AiProviderId | undefined;
    const provider = providerId ? getProvider(providerId) : getDefaultProvider();
    if (!provider) return;

    setLoading(true);
    setActiveAction(actionId);
    setResult("");

    try {
      let stream: AsyncIterable<string>;
      switch (actionId) {
        case "summarize":
          stream = summarizeSelection(selectedText, provider);
          break;
        case "translate":
          stream = translateText(selectedText, "English", provider);
          break;
        case "explain":
          stream = explainFormula(selectedText, provider);
          break;
        case "improve":
          stream = improveWriting(selectedText, provider);
          break;
        case "continue":
          stream = continueWriting(selectedText, provider);
          break;
      }

      let accumulated = "";
      for await (const chunk of stream) {
        accumulated += chunk;
        setResult(accumulated);
      }
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    }
    setLoading(false);
  }, [selectedText, settings]);

  if (!settings.aiEnabled) return null;

  return (
    <div
      className="fixed z-[100] rounded-lg border border-border bg-popover shadow-lg"
      style={{ left: position.x, top: position.y, maxWidth: 360 }}
    >
      {!activeAction ? (
        <div className="p-1">
          <div className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI Actions
          </div>
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => runAction(action.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors"
            >
              <action.icon className="h-3.5 w-3.5 text-muted-foreground" />
              {action.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="p-3 max-w-[360px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium capitalize">{activeAction}</span>
            <button onClick={onClose} className="p-0.5 rounded hover:bg-accent">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">
            {loading && !result && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {result}
            {loading && result && <span className="animate-pulse">▊</span>}
          </div>
          {!loading && result && (
            <div className="flex gap-1 mt-2 pt-2 border-t border-border">
              <button
                onClick={() => { onInsert(result); onClose(); }}
                className="flex-1 rounded bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20 transition-colors"
              >
                Insert Below
              </button>
              <button
                onClick={() => { onReplace(result); onClose(); }}
                className="flex-1 rounded bg-muted px-2 py-1 text-xs hover:bg-accent transition-colors"
              >
                Replace
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
