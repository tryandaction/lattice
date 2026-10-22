"use client";

import type { EvidenceRef } from "@/lib/ai/types";
import { useAiPdfCompanionStore } from "@/stores/ai-pdf-companion-store";

export function PdfCompanionReview({ onNavigate }: { onNavigate?: (ref: EvidenceRef) => void }) {
  const state = useAiPdfCompanionStore();
  const annotations = state.transientAnnotations;
  if (!annotations.length && !state.savedAnnotations.length && !state.error) return null;
  const groups = [...new Set(annotations.map((item) => item.documentPath))];
  const busy = Boolean(state.pendingInjection || state.pendingUndo);
  return (
    <section className="rounded-lg border border-border p-3 text-xs space-y-3" data-testid="pdf-companion-review">
      {annotations.length > 0 && <>
        <div className="font-medium">高亮建议 · {annotations.length} 条，尚未写入</div>
        <p className="text-muted-foreground">核对原文与理由后应用。多文件建议按文件确认，仅保存旁注，不修改原 PDF。</p>
        {groups.map((path) => {
          const group = annotations.filter((item) => item.documentPath === path);
          return <div key={path} className="space-y-2">
            <div className="truncate font-medium" title={path}>{path.split(/[\\/]/).pop()}</div>
            {group.map((annotation) => <div key={annotation.id} className="border-l-2 border-amber-300 pl-2">
              <button type="button" className="text-left hover:underline" disabled={!onNavigate} onClick={() => onNavigate?.(annotation.source)}>
                <span className="text-muted-foreground">p.{annotation.page} </span>“{annotation.quote}”
              </button>
              {annotation.reason && <p className="mt-1 text-muted-foreground">{annotation.reason}</p>}
              <button type="button" disabled={busy} onClick={() => state.discard([annotation.id])} className="mt-1 text-muted-foreground hover:text-foreground disabled:opacity-50">移除此建议</button>
            </div>)}
            <button type="button" disabled={busy} className="rounded border px-2 py-1.5 disabled:opacity-50" data-testid={groups.length === 1 ? "pdf-companion-confirm-all" : undefined}
              onClick={() => { onNavigate?.(group[0].source); state.requestInjection(group.map((item) => item.id)); }}>
              应用到此 PDF（{group.length} 条）
            </button>
          </div>;
        })}
        <button type="button" disabled={busy} onClick={() => state.discard()} data-testid="pdf-companion-discard-all" className="text-muted-foreground disabled:opacity-50">丢弃全部未应用建议</button>
      </>}
      {state.pendingInjection && <p role="status">正在定位原文并保存；尚未完成。若目标文件未打开，请先点击引文打开 PDF。</p>}
      {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      {state.savedAnnotations.length > 0 && <div className="space-y-1">
        <p role="status">已保存 {state.savedAnnotations.length} 条高亮。可在 PDF 批注栏继续编辑或删除。</p>
        {[...new Set(state.savedAnnotations.map((item) => item.documentPath))].map((path) => (
          <button key={path} type="button" disabled={busy} onClick={() => {
            const target = state.savedAnnotations.find((item) => item.documentPath === path)?.annotation.target;
            if (target?.type === 'pdf') onNavigate?.({ kind: 'pdf_annotation', label: path.split(/[\\/]/).pop() ?? path, locator: path, anchor: { page: target.page, snippet: target.textQuote?.exact } });
            state.requestUndo(path);
          }} className="block underline disabled:opacity-50">撤销此文件本次高亮：{path.split(/[\\/]/).pop()}</button>
        ))}
        {state.pendingUndo && <p role="status">正在撤销并保存…</p>}
      </div>}
    </section>
  );
}
