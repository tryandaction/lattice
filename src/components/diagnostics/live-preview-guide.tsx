"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { LIVE_PREVIEW_GUIDE_SCENARIOS } from "./live-preview-content";
import { resolveAppRoute } from "@/lib/app-route";

const ObsidianMarkdownViewer = dynamic(
  () => import("@/components/editor/obsidian-markdown-viewer").then((mod) => mod.ObsidianMarkdownViewer),
  { ssr: false }
);

export function LivePreviewGuide() {
  const homeHref = resolveAppRoute("/");
  const diagnosticsHref = resolveAppRoute("/diagnostics");
  const [selectedId, setSelectedId] = useState(LIVE_PREVIEW_GUIDE_SCENARIOS[0].id);
  const selected = useMemo(
    () => LIVE_PREVIEW_GUIDE_SCENARIOS.find((item) => item.id === selectedId) ?? LIVE_PREVIEW_GUIDE_SCENARIOS[0],
    [selectedId]
  );
  const [content, setContent] = useState(selected.content);

  const handleSelect = (id: string) => {
    const next = LIVE_PREVIEW_GUIDE_SCENARIOS.find((item) => item.id === id);
    if (!next) return;
    setSelectedId(id);
    setContent(next.content);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Live Preview Guide</div>
            <h1 className="text-2xl font-semibold">实时预览语法指南</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              这里不只是开发自检页面，而是面向用户的学习入口。你可以直接在示例里输入、编辑、点击公式、点击表格，
              感受 Lattice 的实时预览如何按照渲染后的视觉结果来响应点击与光标定位。
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href={homeHref} className="rounded border border-border px-3 py-2 text-muted-foreground transition hover:bg-muted hover:text-foreground">
              返回工作台
            </Link>
            <Link href={diagnosticsHref} className="rounded border border-border px-3 py-2 text-muted-foreground transition hover:bg-muted hover:text-foreground">
              打开自检面板
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-6">
        <aside className="w-[320px] shrink-0 space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">学习路径</h2>
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
            <div className="text-lg font-semibold">{selected.title}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{selected.summary}</p>
          </div>
          <div className="h-[calc(100vh-220px)] min-h-[640px] overflow-hidden">
            <ObsidianMarkdownViewer
              content={content}
              onChange={setContent}
              fileName={`guide-${selected.id}.md`}
              fileId={`guide-${selected.id}`}
              initialMode="live"
            />
          </div>
        </section>
      </main>
    </div>
  );
}


