"use client";

import { AlertTriangle, Info, TerminalSquare } from "lucide-react";
import type { ExecutionProblem, RunnerHealthAction } from "@/lib/runner/types";
import { cn } from "@/lib/utils";

interface ProblemsPanelProps {
  problems: ExecutionProblem[];
  className?: string;
  variant?: "compact" | "full";
  onSelectProblem?: (problem: ExecutionProblem) => void;
  onAction?: (problem: ExecutionProblem, action: RunnerHealthAction) => void;
}

function severityTone(problem: ExecutionProblem): string {
  if (problem.severity === "error") {
    return "border-destructive/40 bg-destructive/10";
  }
  if (problem.severity === "warning") {
    return "border-yellow-500/40 bg-yellow-500/10";
  }
  return "border-border bg-muted/40";
}

function sourceLabel(problem: ExecutionProblem): string {
  switch (problem.source) {
    case "syntax":
      return "Syntax";
    case "preflight":
      return "Preflight";
    case "runtime":
      return "Runtime";
    case "health":
      return "Runner Health";
    default:
      return "Problem";
  }
}

function contextLabel(problem: ExecutionProblem): string | null {
  const context = problem.context;
  if (!context) {
    return null;
  }

  if (context.kind === "notebook-cell") {
    const cellLabel = context.label ?? context.cellId ?? "Notebook Cell";
    return context.line ? `${cellLabel} · Line ${context.line}` : cellLabel;
  }

  const fileLabel = context.filePath ?? context.fileName ?? context.label ?? null;
  if (context.kind === "markdown-block" && context.range?.startLine) {
    return `${fileLabel ?? "Markdown"} · Block line ${context.range.startLine}${context.line ? ` · Error line ${context.line}` : ""}`;
  }

  if (fileLabel && context.line) {
    return `${fileLabel} · Line ${context.line}`;
  }

  return fileLabel;
}

export function ProblemsPanel({
  problems,
  className,
  variant = "full",
  onSelectProblem,
  onAction,
}: ProblemsPanelProps) {
  if (problems.length === 0) {
    return null;
  }

  const compact = variant === "compact";

  return (
    <div className={cn("space-y-2", className)}>
      {problems.map((problem) => {
        const clickable = Boolean(onSelectProblem);
        const location = contextLabel(problem);

        return (
          <div
            key={problem.id}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onSelectProblem?.(problem) : undefined}
            onKeyDown={clickable ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectProblem?.(problem);
              }
            } : undefined}
            className={cn(
              "rounded-md border px-3 py-2",
              severityTone(problem),
              clickable && "cursor-pointer transition-colors hover:bg-muted/60",
            )}
          >
            <div className="flex items-start gap-2">
              {problem.severity === "info" ? (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-current" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <TerminalSquare className="h-3 w-3" />
                    {sourceLabel(problem)}
                  </span>
                  {location ? <span className="truncate normal-case tracking-normal">{location}</span> : null}
                </div>
                <div className={cn("mt-1 font-medium", compact ? "text-xs" : "text-sm")}>{problem.title}</div>
                <div className={cn("mt-1 whitespace-pre-wrap break-words text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
                  {problem.message}
                </div>
                {problem.hint ? (
                  <div className={cn("mt-2 whitespace-pre-wrap break-words", compact ? "text-[11px]" : "text-xs")}>
                    建议：{problem.hint}
                  </div>
                ) : null}
                {problem.actions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {problem.actions.map((action) => (
                      <button
                        key={`${problem.id}:${action.kind}:${action.label}`}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onAction?.(problem, action);
                        }}
                        className="rounded border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ProblemsPanel;
