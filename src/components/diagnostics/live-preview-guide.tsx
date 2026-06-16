"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVE_PREVIEW_GUIDE_SCENARIOS } from "./live-preview-content";

const ObsidianMarkdownViewer = dynamic(
  () => import("@/components/editor/obsidian-markdown-viewer").then((mod) => mod.ObsidianMarkdownViewer),
  { ssr: false }
);

interface LivePreviewGuideProps {
  surface?: "page" | "dialog";
  onClose?: () => void;
}

export function LivePreviewGuide({ surface = "page", onClose }: LivePreviewGuideProps) {
  const isDialog = surface === "dialog";
  const [selectedId, setSelectedId] = useState(LIVE_PREVIEW_GUIDE_SCENARIOS[0].id);
  const selected = useMemo(
    () => LIVE_PREVIEW_GUIDE_SCENARIOS.find((item) => item.id === selectedId) ?? LIVE_PREVIEW_GUIDE_SCENARIOS[0],
    [selectedId]
  );
  const [contentById, setContentById] = useState<Record<string, string>>(() =>
    Object.fromEntries(LIVE_PREVIEW_GUIDE_SCENARIOS.map((item) => [item.id, item.content]))
  );
  const content = contentById[selected.id] ?? selected.content;

  const handleSelect = useCallback((id: string) => {
    const next = LIVE_PREVIEW_GUIDE_SCENARIOS.find((item) => item.id === id);
    if (!next) return;
    setSelectedId(id);
  }, []);

  const handleContentChange = useCallback((nextContent: string) => {
    setContentById((previous) => ({
      ...previous,
      [selected.id]: nextContent,
    }));
  }, [selected.id]);

  const handleResetCurrent = useCallback(() => {
    setContentById((previous) => ({
      ...previous,
      [selected.id]: selected.content,
    }));
  }, [selected.content, selected.id]);

  return (
    <div className={cn("flex flex-col bg-background text-foreground", isDialog ? "h-full" : "min-h-screen")}>
      <header className="border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Live Preview Guide</div>
            <h1 className="text-2xl font-semibold">实时预览语法指南</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              这里既是用户指南，也是交互式练习场。每个示例都可以直接编辑、点击、切换源码态与渲染态，
              用真实交互理解 Lattice 的实时预览逻辑。
            </p>
          </div>
          {isDialog && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close guide"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <main className={cn("mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-6", isDialog && "min-h-0 overflow-hidden")}>
        <aside className="sticky top-6 h-fit w-[320px] shrink-0 space-y-4 self-start">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">学习路径</h2>
              <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                {LIVE_PREVIEW_GUIDE_SCENARIOS.length} 个主题
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {LIVE_PREVIEW_GUIDE_SCENARIOS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition",
                    item.id === selectedId
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:bg-muted/50"
                  )}
                >
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">当前语法</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.syntax.map((syntax) => (
                <code key={syntax} className="rounded bg-muted px-2 py-1 text-xs text-foreground">
                  {syntax}
                </code>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">你会学到</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              {selected.focus.map((item) => (
                <li key={item} className="rounded-lg bg-muted/40 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">{selected.title}</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{selected.summary}</p>
              </div>
              <button
                type="button"
                onClick={handleResetCurrent}
                className="rounded border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                重置当前示例
              </button>
            </div>
          </div>
          <div className={cn("overflow-hidden", isDialog ? "h-full min-h-0" : "h-[calc(100vh-220px)] min-h-[640px]")}>
            <ObsidianMarkdownViewer
              key={selected.id}
              content={content}
              onChange={handleContentChange}
              fileName={`guide-${selected.id}.md`}
              fileId={`guide-${selected.id}`}
              paneId="diagnostics-guide-pane"
              filePath={`guide-${selected.id}.md`}
              initialMode="live"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
