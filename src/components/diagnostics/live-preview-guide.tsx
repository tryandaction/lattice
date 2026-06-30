"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, ArrowRight, CheckCircle2, MapPin, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LATTICE_GUIDE_SECTIONS, type SupportedGuideLocale } from "./live-preview-content";
import { useI18n } from "@/hooks/use-i18n";

const ObsidianMarkdownViewer = dynamic(
  () => import("@/components/editor/obsidian-markdown-viewer").then((mod) => mod.ObsidianMarkdownViewer),
  { ssr: false }
);

interface LivePreviewGuideProps {
  surface?: "page" | "dialog";
  onClose?: () => void;
}

const GUIDE_COPY = {
  "zh-CN": {
    eyebrow: "Lattice Guide",
    title: "Lattice 用户指南",
    subtitle: "用最短路径了解 Lattice 的核心工作流：文件、Markdown、PDF、公式、AI、插件与链接。",
    sections: "指南模块",
    moduleCount: "个模块",
    keyActions: "关键操作",
    tips: "使用建议",
    related: "相关入口",
    demo: "可编辑示例",
    resetDemo: "重置示例",
    previous: "上一项",
    next: "下一项",
    close: "关闭指南",
  },
  "en-US": {
    eyebrow: "Lattice Guide",
    title: "Lattice User Guide",
    subtitle: "A concise path through Lattice: files, Markdown, PDFs, formulas, AI, plugins, and links.",
    sections: "Guide Sections",
    moduleCount: "sections",
    keyActions: "Key Actions",
    tips: "Tips",
    related: "Entry Points",
    demo: "Editable Demo",
    resetDemo: "Reset Demo",
    previous: "Previous",
    next: "Next",
    close: "Close guide",
  },
} as const;

function resolveGuideLocale(locale: string): SupportedGuideLocale {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

function text(sectionText: Record<SupportedGuideLocale, string>, locale: SupportedGuideLocale): string {
  return sectionText[locale] ?? sectionText["en-US"];
}

function GuideList({
  title,
  items,
}: {
  title: string;
  items: Array<{ __localized: string }>;
}) {
  return (
    <section className="rounded-lg border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="flex gap-2 rounded-md bg-muted/35 px-3 py-2 text-sm leading-6">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{item.__localized}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LivePreviewGuide({ surface = "page", onClose }: LivePreviewGuideProps) {
  const { locale } = useI18n();
  const guideLocale = resolveGuideLocale(locale);
  const copy = GUIDE_COPY[guideLocale];
  const isDialog = surface === "dialog";
  const [selectedId, setSelectedId] = useState(LATTICE_GUIDE_SECTIONS[0].id);
  const selectedIndex = Math.max(0, LATTICE_GUIDE_SECTIONS.findIndex((item) => item.id === selectedId));
  const selected = LATTICE_GUIDE_SECTIONS[selectedIndex] ?? LATTICE_GUIDE_SECTIONS[0];
  const demoKey = `${selected.id}:${guideLocale}`;
  const [demoByKey, setDemoByKey] = useState<Record<string, string>>({});
  const demoMarkdown = selected.demoMarkdown ? demoByKey[demoKey] ?? text(selected.demoMarkdown, guideLocale) : null;

  const localizedSections = useMemo(() => LATTICE_GUIDE_SECTIONS.map((section) => ({
    ...section,
    localizedTitle: text(section.title, guideLocale),
    localizedSummary: text(section.summary, guideLocale),
  })), [guideLocale]);

  function handleSelect(id: string) {
    if (LATTICE_GUIDE_SECTIONS.some((item) => item.id === id)) {
      setSelectedId(id);
    }
  }

  function goToOffset(offset: number) {
    const nextIndex = Math.min(Math.max(selectedIndex + offset, 0), LATTICE_GUIDE_SECTIONS.length - 1);
    setSelectedId(LATTICE_GUIDE_SECTIONS[nextIndex].id);
  }

  function handleDemoChange(nextContent: string) {
    setDemoByKey((previous) => ({
      ...previous,
      [demoKey]: nextContent,
    }));
  }

  function handleResetDemo() {
    if (!selected.demoMarkdown) return;
    setDemoByKey((previous) => ({
      ...previous,
      [demoKey]: text(selected.demoMarkdown!, guideLocale),
    }));
  }

  const localizedActions = selected.actions.map((item) => ({ ...item, __localized: text(item, guideLocale) }));
  const localizedTips = selected.tips.map((item) => ({ ...item, __localized: text(item, guideLocale) }));
  const localizedRelated = selected.related.map((item) => ({ ...item, __localized: text(item, guideLocale) }));

  return (
    <div className={cn("flex flex-col bg-background text-foreground", isDialog ? "h-full" : "min-h-screen")}>
      <header className="shrink-0 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-start justify-between gap-6">
          <div className="min-w-0 space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary">{copy.eyebrow}</div>
            <h1 className="text-2xl font-semibold">{copy.title}</h1>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
          </div>
          {isDialog && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label={copy.close}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <main className={cn(
        "mx-auto grid w-full max-w-7xl flex-1 gap-5 px-5 py-5 lg:grid-cols-[300px_minmax(0,1fr)]",
        isDialog ? "min-h-0 overflow-hidden" : "min-h-[calc(100vh-112px)]"
      )}>
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{copy.sections}</h2>
            <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              {LATTICE_GUIDE_SECTIONS.length} {copy.moduleCount}
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {localizedSections.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                aria-current={item.id === selected.id ? "page" : undefined}
                className={cn(
                  "w-full rounded-lg border px-3 py-3 text-left transition",
                  item.id === selected.id
                    ? "border-primary bg-primary/10 text-foreground shadow-sm"
                    : "border-border bg-background hover:bg-muted/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium">{item.localizedTitle}</span>
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.localizedSummary}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{text(selected.title, guideLocale)}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{text(selected.summary, guideLocale)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => goToOffset(-1)}
                disabled={selectedIndex === 0}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {copy.previous}
              </button>
              <button
                type="button"
                onClick={() => goToOffset(1)}
                disabled={selectedIndex === LATTICE_GUIDE_SECTIONS.length - 1}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copy.next}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className={cn("min-h-0 overflow-y-auto p-5", isDialog ? "flex-1" : "min-h-[640px]")}>
            <div className="mb-4 rounded-lg border border-border bg-muted/25 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4 text-primary" />
                {text(selected.entry, guideLocale)}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <GuideList title={copy.keyActions} items={localizedActions} />
              <GuideList title={copy.tips} items={localizedTips} />
              <GuideList title={copy.related} items={localizedRelated} />
            </div>

            {demoMarkdown ? (
              <section className="mt-5 overflow-hidden rounded-xl border border-border bg-background">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">{copy.demo}</h3>
                  <button
                    type="button"
                    onClick={handleResetDemo}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {copy.resetDemo}
                  </button>
                </div>
                <div className="h-[420px] min-h-0 overflow-hidden">
                  <ObsidianMarkdownViewer
                    key={`${selected.id}-${guideLocale}`}
                    content={demoMarkdown}
                    onChange={handleDemoChange}
                    fileName={`guide-${selected.id}.md`}
                    fileId={`guide-${selected.id}`}
                    paneId="diagnostics-guide-pane"
                    filePath={`guide-${selected.id}.md`}
                    initialMode="live"
                  />
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
