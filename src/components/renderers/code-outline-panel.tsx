"use client";

import { ListTree, X } from "lucide-react";
import type { CodeOutlineSymbol } from "@/lib/code-outline";
import { useI18n } from "@/hooks/use-i18n";

interface CodeOutlinePanelProps {
  symbols: CodeOutlineSymbol[];
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (line: number) => void;
}

const KIND_LABELS: Record<CodeOutlineSymbol["kind"], string> = {
  heading: "#",
  class: "C",
  function: "fn",
  method: "m",
  variable: "v",
  type: "T",
  interface: "I",
  enum: "E",
  struct: "S",
};

export function CodeOutlinePanel({
  symbols,
  isOpen,
  onClose,
  onNavigate,
}: CodeOutlinePanelProps) {
  const { t } = useI18n();

  if (!isOpen) {
    return null;
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ListTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {t("code.outline.title")}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("code.outline.close")}
          aria-label={t("code.outline.close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {symbols.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {t("code.outline.empty")}
          </p>
        ) : (
          symbols.map((symbol) => (
            <button
              key={symbol.id}
              type="button"
              onClick={() => onNavigate(symbol.line)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              style={{ paddingLeft: `${Math.min(symbol.level - 1, 5) * 12 + 8}px` }}
              title={`${symbol.name} - ${t("code.outline.line", { line: symbol.line })}`}
            >
              <span className="w-5 shrink-0 rounded border border-border px-1 py-0.5 text-center text-[10px] leading-none text-muted-foreground">
                {KIND_LABELS[symbol.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{symbol.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{symbol.line}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

export default CodeOutlinePanel;
