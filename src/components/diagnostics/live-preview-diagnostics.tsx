"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const ObsidianMarkdownViewer = dynamic(
  () => import("@/components/editor/obsidian-markdown-viewer").then((mod) => mod.ObsidianMarkdownViewer),
  { ssr: false }
);

type DiagnosticResult = {
  ok: boolean;
  errors: string[];
  counts: Record<string, number>;
};

const FILES = [
  { id: "test-syntax-hiding.md", label: "语法隐藏", url: "/test-syntax-hiding.md" },
  { id: "test-nested-formatting.md", label: "嵌套格式", url: "/test-nested-formatting.md" },
  { id: "test-10000-lines.md", label: "超长文档", url: "/test-10000-lines.md" },
];

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

export function LivePreviewDiagnostics() {
  const [selectedId, setSelectedId] = useState(FILES[0].id);
  const selected = useMemo(
    () => FILES.find((f) => f.id === selectedId) ?? FILES[0],
    [selectedId]
  );
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    setContent("");
    setResult(null);

    fetch(selected.url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load ${selected.url}: ${res.status}`);
        }
        return res.text();
      })
      .then((text) => {
        if (!alive) return;
        setContent(text);
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      alive = false;
    };
  }, [selected.url]);

  const runDiagnostics = async () => {
    if (!content) return;
    setIsRunning(true);
    setResult(null);

    const { parseDocumentFromText, resolveConflicts, ElementType } = await import(
      "@/components/editor/codemirror/live-preview/decoration-coordinator"
    );

    const elements = resolveConflicts(parseDocumentFromText(content));
    const errors: string[] = [];
    const counts: Record<string, number> = {};

    const inlineTypes = new Set([
      ElementType.INLINE_BOLD,
      ElementType.INLINE_ITALIC,
      ElementType.INLINE_CODE,
      ElementType.INLINE_LINK,
      ElementType.INLINE_IMAGE,
      ElementType.INLINE_TAG,
      ElementType.INLINE_OTHER,
      ElementType.MATH_INLINE,
    ]);

    const noNestingTypes = new Set([
      ElementType.INLINE_CODE,
      ElementType.MATH_INLINE,
    ]);

    for (const element of elements) {
      const name = ElementType[element.type];
      counts[name] = (counts[name] || 0) + 1;

      if (element.from < 0 || element.to < element.from || element.to > content.length) {
        errors.push(`非法范围: ${name} [${element.from}, ${element.to}]`);
      }

      if (inlineTypes.has(element.type) && isEscaped(content, element.from)) {
        errors.push(`转义误匹配: ${name} @ ${element.from}`);
      }
    }

    for (const container of elements) {
      if (!noNestingTypes.has(container.type)) continue;
      for (const other of elements) {
        if (other === container) continue;
        const inside = other.from >= container.from && other.to <= container.to;
        if (!inside) continue;
        if (other.type === container.type) continue;
        errors.push(
          `嵌套冲突: ${ElementType[container.type]} 包含 ${ElementType[other.type]}`
        );
        break;
      }
    }

    setResult({ ok: errors.length === 0, errors, counts });
    setIsRunning(false);
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h1 className="text-sm font-medium">Live Preview 自检面板</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>文件：</span>
          {FILES.map((file) => (
            <button
              key={file.id}
              onClick={() => setSelectedId(file.id)}
              className={cn(
                "rounded px-2 py-1",
                selectedId === file.id
                  ? "bg-muted text-foreground"
                  : "hover:bg-muted/50"
              )}
            >
              {file.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            onClick={runDiagnostics}
            disabled={!content || isRunning}
            className={cn(
              "rounded px-3 py-1",
              "border border-border",
              isRunning ? "opacity-60" : "hover:bg-muted"
            )}
          >
            {isRunning ? "检测中..." : "运行自检"}
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <section className="w-2/3 border-r border-border">
          {loadError ? (
            <div className="p-4 text-sm text-destructive">{loadError}</div>
          ) : content ? (
            <ObsidianMarkdownViewer
              content={content}
              onChange={setContent}
              fileName={selected.id}
              fileId={selected.id}
              initialMode="live"
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">加载中...</div>
          )}
        </section>

        <section className="w-1/3 p-4 text-xs">
          <div className="mb-2 text-sm font-medium">诊断结果</div>
          {result ? (
            <div className="space-y-3">
              <div className={cn("rounded p-2 text-xs", result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                {result.ok ? "通过：未发现异常" : "失败：存在异常"}
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase text-muted-foreground">元素统计</div>
                <pre className="rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
{JSON.stringify(result.counts, null, 2)}
                </pre>
              </div>
              {result.errors.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] uppercase text-muted-foreground">异常明细</div>
                  <pre className="rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
{result.errors.join("\n")}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground">点击“运行自检”开始检测。</div>
          )}
        </section>
      </main>
    </div>
  );
}
