"use client";

import { useMemo, useState } from "react";
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { academicThemeExtension } from "@/components/editor/codemirror/academic-theme";
import { decorationCoordinatorExtension } from "@/components/editor/codemirror/live-preview/decoration-coordinator";
import { cursorContextPlugin } from "@/components/editor/codemirror/live-preview/cursor-context-plugin";

interface BenchmarkSpec {
  id: string;
  label: string;
  description: string;
  thresholdMs: number;
  unitLabel: string;
  run: () => Promise<{ durationMs: number; sampleSize: number }>;
}

interface BenchmarkResult {
  id: string;
  label: string;
  description: string;
  durationMs: number;
  thresholdMs: number;
  unitLabel: string;
  sampleSize: number;
  passed: boolean;
}

function generateMarkdownDocument(lines: number) {
  return Array.from({ length: lines }, (_, index) => {
    const lineNumber = index + 1;
    return lineNumber % 18 === 1
      ? `## Heading ${lineNumber}\n- item ${lineNumber}\n- item ${lineNumber + 1}\n`
      : `Paragraph ${lineNumber}: performance baseline content with [[Wiki Link ${lineNumber}]] and \`inline code ${lineNumber}\`.\n`;
  }).join("\n");
}

function generateJavaScriptDocument(lines: number) {
  return Array.from({ length: lines }, (_, index) => {
    const lineNumber = index + 1;
    return `export const value${lineNumber} = (${lineNumber} * 3) + ${lineNumber % 7};`;
  }).join("\n");
}

function createHiddenContainer() {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "1280px";
  container.style.height = "900px";
  container.style.opacity = "0";
  document.body.appendChild(container);
  return container;
}

async function measureEditorRender(doc: string, extensions: Extension[]) {
  const container = createHiddenContainer();
  const startedAt = performance.now();

  const state = EditorState.create({
    doc,
    extensions,
  });

  const view = new EditorView({
    state,
    parent: container,
  });

  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const durationMs = performance.now() - startedAt;

  view.destroy();
  document.body.removeChild(container);

  return {
    durationMs,
    sampleSize: state.doc.lines,
  };
}

function buildCodeEditorExtensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    keymap.of([
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    academicThemeExtension,
    javascript({ typescript: false }),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        height: "100%",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
    }),
  ] satisfies Extension[];
}

function buildMarkdownLivePreviewExtensions() {
  return [
    markdown(),
    cursorContextPlugin,
    decorationCoordinatorExtension,
  ] satisfies Extension[];
}

function runAnnotationLookupBenchmark(entryCount: number, lookupCount: number) {
  const annotations = Array.from({ length: entryCount }, (_, index) => ({
    id: `annotation-${index}`,
    page: (index % 12) + 1,
  }));
  const lookupIds = Array.from({ length: lookupCount }, (_, index) => `annotation-${lookupCount - index - 1}`);

  const startedAt = performance.now();
  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation] as const));
  let checksum = 0;

  lookupIds.forEach((id) => {
    checksum += annotationById.get(id)?.page ?? 0;
  });

  if (checksum === 0) {
    throw new Error("Annotation lookup checksum failed.");
  }

  return {
    durationMs: performance.now() - startedAt,
    sampleSize: lookupCount,
  };
}

export default function PerformanceTestPage() {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [statusMessage, setStatusMessage] = useState("未开始");

  const benchmarks = useMemo<BenchmarkSpec[]>(() => [
    {
      id: "markdown-live-preview-10000",
      label: "Markdown Live Preview 10k 行",
      description: "覆盖 decoration coordinator 与 cursor context 插件初始化。",
      thresholdMs: 7000,
      unitLabel: "10k 行",
      run: () => measureEditorRender(
        generateMarkdownDocument(10_000),
        buildMarkdownLivePreviewExtensions(),
      ),
    },
    {
      id: "code-editor-javascript-5000",
      label: "Code Editor JavaScript 5k 行",
      description: "覆盖代码编辑器常用扩展、补全与主题初始化。",
      thresholdMs: 1600,
      unitLabel: "5k 行",
      run: () => measureEditorRender(
        generateJavaScriptDocument(5_000),
        buildCodeEditorExtensions(),
      ),
    },
    {
      id: "annotation-index-lookup-8000",
      label: "PDF Annotation Index 8k 查找",
      description: "覆盖 PDF 批注索引的 Map 构建与高频查找。",
      thresholdMs: 40,
      unitLabel: "8k 次",
      run: async () => runAnnotationLookupBenchmark(8_000, 8_000),
    },
  ], []);

  const failedCount = results.filter((result) => !result.passed).length;
  const averageDuration = results.length > 0
    ? results.reduce((sum, result) => sum + result.durationMs, 0) / results.length
    : 0;

  const runBenchmarks = async () => {
    setResults([]);
    setIsRunning(true);
    setStatus("running");
    setStatusMessage("正在执行性能基线…");

    const nextResults: BenchmarkResult[] = [];

    try {
      for (const benchmark of benchmarks) {
        setStatusMessage(`正在执行：${benchmark.label}`);
        const measurement = await benchmark.run();
        nextResults.push({
          id: benchmark.id,
          label: benchmark.label,
          description: benchmark.description,
          durationMs: measurement.durationMs,
          thresholdMs: benchmark.thresholdMs,
          unitLabel: benchmark.unitLabel,
          sampleSize: measurement.sampleSize,
          passed: measurement.durationMs <= benchmark.thresholdMs,
        });
        setResults([...nextResults]);
      }

      const nextFailedCount = nextResults.filter((result) => !result.passed).length;
      setStatus(nextFailedCount === 0 ? "completed" : "failed");
      setStatusMessage(nextFailedCount === 0 ? "性能基线通过" : `性能基线失败：${nextFailedCount} 项超出阈值`);
    } catch (error) {
      console.error("Performance baseline failed:", error);
      setStatus("failed");
      setStatusMessage(error instanceof Error ? error.message : "性能基线执行失败");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto p-8" data-testid="performance-test-ready">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Performance Baseline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          覆盖 Markdown Live Preview、代码编辑器初始化和 PDF 批注索引三条高风险性能基线。
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void runBenchmarks()}
          disabled={isRunning}
          data-testid="run-performance-baseline"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRunning ? "Running..." : "Run Performance Baseline"}
        </button>
        <div
          className="rounded border border-border bg-muted/30 px-4 py-2 text-sm"
          data-testid="performance-baseline-message"
        >
          {statusMessage}
        </div>
      </div>

      <div className="sr-only" aria-hidden="true">
        <span data-testid="performance-baseline-status">{status}</span>
        <span data-testid="performance-baseline-failures">{failedCount}</span>
        <span data-testid="performance-baseline-count">{results.length}</span>
        <span data-testid="performance-baseline-average">{averageDuration.toFixed(2)}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-4 py-3">Benchmark</th>
              <th className="px-4 py-3">Sample</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Threshold</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((benchmark) => {
              const result = results.find((item) => item.id === benchmark.id);
              const statusLabel = !result
                ? "Pending"
                : result.passed
                  ? "Pass"
                  : "Fail";

              return (
                <tr key={benchmark.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{benchmark.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{benchmark.description}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {result ? `${result.sampleSize.toLocaleString()} ${result.unitLabel}` : benchmark.unitLabel}
                  </td>
                  <td className="px-4 py-3">
                    <span data-testid={`performance-result-${benchmark.id}`}>
                      {result ? result.durationMs.toFixed(2) : "0.00"}
                    </span>
                    <span className="ml-1 text-muted-foreground">ms</span>
                  </td>
                  <td className="px-4 py-3">
                    <span data-testid={`performance-threshold-${benchmark.id}`}>{benchmark.thresholdMs.toFixed(2)}</span>
                    <span className="ml-1 text-muted-foreground">ms</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      data-testid={`performance-status-${benchmark.id}`}
                      className={result
                        ? result.passed
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                        : "text-muted-foreground"}
                    >
                      {statusLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
