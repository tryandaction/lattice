/**
 * Shared execution output panel.
 */

"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Info, Terminal, Trash2 } from "lucide-react";
import type { ExecutionDiagnostic, ExecutionOutput, ExecutionPanelMeta } from "@/lib/runner/types";
import { cn } from "@/lib/utils";

interface OutputAreaProps {
  outputs: ExecutionOutput[];
  className?: string;
  onClear?: () => void;
  variant?: "compact" | "full";
  meta?: ExecutionPanelMeta;
}

const COLLAPSE_THRESHOLD = 20;

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded p-1 hover:bg-background/60 transition-colors"
      title="Copy output"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

function groupOutputs(outputs: ExecutionOutput[]): ExecutionOutput[] {
  const grouped: ExecutionOutput[] = [];

  for (const output of outputs) {
    const previous = grouped[grouped.length - 1];
    if (
      previous?.type === "text" &&
      output.type === "text" &&
      previous.channel === output.channel
    ) {
      previous.content += output.content;
      continue;
    }
    grouped.push({ ...output });
  }

  return grouped;
}

function parseError(output: ExecutionOutput & { type: "error" }): { type: string; message: string; traceback: string[] } {
  if (output.errorName || output.traceback?.length) {
    return {
      type: output.errorName || "ExecutionError",
      message: output.errorValue || output.content,
      traceback: output.traceback || [],
    };
  }

  const lines = output.content.split("\n");
  const lastLine = lines[lines.length - 1] || "";
  const match = lastLine.match(/^(\w+Error|\w+Exception|Error):\s*(.*)$/);
  if (match) {
    return {
      type: match[1],
      message: match[2] || lastLine,
      traceback: lines.slice(0, -1),
    };
  }

  return {
    type: "Error",
    message: output.content,
    traceback: [],
  };
}

function SourceBadge({ meta }: { meta: ExecutionPanelMeta | undefined }) {
  if (!meta?.origin) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
        <Terminal className="h-3 w-3" />
        {meta.origin.sourceLabel}
      </span>
      <span className="truncate">{meta.origin.detailLabel}</span>
    </div>
  );
}

function DiagnosticBanner({ diagnostic }: { diagnostic: ExecutionDiagnostic }) {
  const tone =
    diagnostic.severity === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : diagnostic.severity === "warning"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
        : "border-border bg-muted/50 text-muted-foreground";

  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs", tone)}>
      <div className="flex items-start gap-2">
        {diagnostic.severity === "info" ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0">
          <div className="font-medium">{diagnostic.title}</div>
          <div className="mt-0.5 whitespace-pre-wrap break-words">{diagnostic.message}</div>
          {diagnostic.hint ? <div className="mt-1 opacity-90">建议：{diagnostic.hint}</div> : null}
        </div>
      </div>
    </div>
  );
}

function TextOutput({ content, channel, compact }: { content: string; channel?: "stdout" | "stderr"; compact: boolean }) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const lines = content.split("\n");
  const isLong = lines.length > COLLAPSE_THRESHOLD;
  const displayContent = isLong && isCollapsed
    ? `${lines.slice(0, COLLAPSE_THRESHOLD).join("\n")}\n...`
    : content;

  return (
    <div className="relative group">
      <div className="mb-1 flex items-center justify-between">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wide",
            channel === "stderr" ? "text-yellow-700 dark:text-yellow-300" : "text-muted-foreground",
          )}
        >
          {channel || "output"}
        </span>
      </div>
      <pre
        className={cn(
          "whitespace-pre-wrap break-words font-mono rounded-md pr-8",
          compact ? "text-xs p-2.5" : "text-sm p-3",
          channel === "stderr" ? "bg-yellow-500/10 text-yellow-900 dark:text-yellow-100" : "bg-muted text-foreground",
        )}
      >
        {displayContent}
      </pre>
      <div className="absolute right-2 top-7 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton content={content} />
      </div>
      {isLong ? (
        <button
          type="button"
          onClick={() => setIsCollapsed((value) => !value)}
          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{isCollapsed ? `Show ${lines.length - COLLAPSE_THRESHOLD} more lines` : "Collapse"}</span>
        </button>
      ) : null}
    </div>
  );
}

function ImageOutput({ src, compact }: { src: string; compact: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-md overflow-hidden bg-white dark:bg-gray-900 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Plot output"
        className={cn(
          "max-w-full h-auto cursor-pointer transition-all",
          isExpanded ? "" : compact ? "max-h-[240px] object-contain" : "max-h-[400px] object-contain",
        )}
        onClick={() => setIsExpanded((value) => !value)}
        title={isExpanded ? "Click to collapse" : "Click to expand"}
      />
    </div>
  );
}

export function HtmlOutput({ content }: { content: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(150);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{margin:0;padding:8px;font-family:system-ui,sans-serif;font-size:13px;background:transparent}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{border:1px solid #e2e8f0;padding:4px 8px;text-align:left}
  th{background:#f8fafc;font-weight:600}
  tr:nth-child(even){background:#f8fafc}
</style></head><body>${content}
<script>
  function rh(){window.parent.postMessage({type:'ih',h:document.body.scrollHeight},'*')}
  window.addEventListener('load',rh);setTimeout(rh,300);setTimeout(rh,1200);
</script></body></html>`);
    doc.close();
  }, [content]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "ih") {
        setHeight(Math.min(Math.max(event.data.h + 16, 80), 600));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <div className="rounded-md overflow-hidden border border-border">
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        style={{ width: "100%", height, border: "none", display: "block" }}
        title="output"
      />
    </div>
  );
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "")
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, "")
    .replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, "");
}

function SvgOutput({ content }: { content: string }) {
  return (
    <div
      className="rounded-md overflow-hidden bg-white dark:bg-gray-900 p-2 max-w-full overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: sanitizeSvg(content) }}
    />
  );
}

function ErrorOutput({ output, compact }: { output: ExecutionOutput & { type: "error" }; compact: boolean }) {
  const [showTraceback, setShowTraceback] = useState(false);
  const { type, message, traceback } = parseError(output);
  const hasTraceback = traceback.length > 0;

  return (
    <div className="rounded-md overflow-hidden border border-destructive/40">
      <div className={cn("flex items-start gap-2 bg-destructive/10", compact ? "p-2.5" : "p-3")}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-destructive">{type}</div>
          <pre className={cn("mt-1 whitespace-pre-wrap break-words font-mono text-destructive", compact ? "text-xs" : "text-sm")}>
            {message}
          </pre>
        </div>
      </div>
      {hasTraceback ? (
        <>
          <button
            type="button"
            onClick={() => setShowTraceback((value) => !value)}
            className="flex w-full items-center gap-1 border-t border-destructive/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {showTraceback ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span>{showTraceback ? "Hide" : "Show"} traceback ({traceback.length} lines)</span>
          </button>
          {showTraceback ? (
            <pre className={cn("max-h-[300px] overflow-auto whitespace-pre-wrap break-words border-t border-destructive/30 bg-muted/30 font-mono text-destructive/80", compact ? "p-2.5 text-[11px]" : "p-3 text-xs")}>
              {traceback.join("\n")}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function OutputItem({ output, compact }: { output: ExecutionOutput; compact: boolean }) {
  switch (output.type) {
    case "text":
      return <TextOutput content={output.content} channel={output.channel} compact={compact} />;
    case "image":
      return <ImageOutput src={output.content} compact={compact} />;
    case "html":
      return <HtmlOutput content={output.content} />;
    case "svg":
      return <SvgOutput content={output.content} />;
    case "error":
      return <ErrorOutput output={output} compact={compact} />;
    default:
      return null;
  }
}

export const OutputArea = memo(function OutputArea({
  outputs,
  className = "",
  onClear,
  variant = "full",
  meta,
}: OutputAreaProps) {
  const compact = variant === "compact";
  const normalizedOutputs = groupOutputs(outputs);
  const hasDiagnostics = Boolean(meta?.diagnostics.length);

  if (normalizedOutputs.length === 0 && !hasDiagnostics) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <SourceBadge meta={meta} />
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear</span>
          </button>
        ) : null}
      </div>

      {meta?.diagnostics.map((diagnostic, index) => (
        <DiagnosticBanner key={`${diagnostic.title}-${index}`} diagnostic={diagnostic} />
      ))}

      {normalizedOutputs.map((output, index) => (
        <OutputItem key={`${output.type}-${index}`} output={output} compact={compact} />
      ))}
    </div>
  );
});

export default OutputArea;
